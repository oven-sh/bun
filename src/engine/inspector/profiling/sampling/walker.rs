//! Copies the headers of the frames of a thread that has been stopped at any instruction. Reads nothing that the words
//! on its stack point to, and neither allocates nor waits.

use core::ops::Range;

use bun_engine_exec_memory::{FrameInUse, Owners};
use bun_engine_platform::StackBounds;
use bun_engine_platform::suspend::Registers;
use bun_engine_vm::heap::stack::load_word;
use bun_engine_vm::{CallFrame, EntryRecord};

/// Each word may be anything.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(super) struct RawFrame {
    pub(super) code_block: usize,
    pub(super) callee: u64,
    /// Where it is, or what its callee returns to. Zero if that is not known.
    pub(super) address: usize,
    pub(super) call_site: u32,
}

/// What the walk has found out about the first frame.
#[derive(Clone, Copy)]
pub(super) struct FirstFrame {
    /// From it to the frame that it links to, if it may be the native frame of a function of the interpreter.
    pub(super) doubtful_size: Option<usize>,
    /// It is where the last frame was that called out.
    pub(super) is_top_call_frame: bool,
    /// The thread was in native code.
    pub(super) has_called_out: bool,
    /// Its address is what a call returns to.
    pub(super) has_return_address: bool,
}

pub(super) struct Walk {
    pub(super) depth: usize,
    pub(super) is_cut_short: bool,
    pub(super) first: FirstFrame,
}

/// What the `Vm` knows of the stack.
pub(super) struct Tops {
    pub(super) call_frame: usize,
    pub(super) entry_frame: usize,
    /// Nothing below `call_frame` is of interest.
    pub(super) is_searching: bool,
}

const WORD: usize = size_of::<usize>();
/// What generated code calls without telling the `Vm` does not go deep.
const MOST_NATIVE_FRAMES: usize = 32;

pub(super) struct Walker<'a> {
    in_use: Range<usize>,
    static_code: Range<usize>,
    owners: &'a Owners,
}

impl<'a> Walker<'a> {
    /// # Safety
    /// The thread that has the stack and the registers is suspended for as long as the result exists.
    pub(super) unsafe fn new(
        stack: StackBounds,
        registers: &Registers,
        owners: &'a Owners,
    ) -> Option<Walker<'a>> {
        stack.contains(registers.stack_pointer).then(|| Walker {
            in_use: registers.stack_pointer..stack.origin,
            static_code: bun_engine_vm::call::code_in_call_frames(),
            owners,
        })
    }

    fn load(&self, address: usize) -> Option<usize> {
        let is_readable = self.in_use.contains(&address) && address.is_multiple_of(WORD);
        // SAFETY: the part of the stack that is in use is mapped, and it ends at a multiple of a word.
        is_readable.then(|| unsafe { load_word(address) })
    }

    fn load_at(&self, frame: usize, offset: usize) -> Option<usize> {
        self.load(frame.checked_add(offset)?)
    }

    fn frame_in_use_at(&self, address: usize) -> FrameInUse {
        if bun_engine_exec_memory::contains(address) {
            self.owners.frame_in_use_at(address)
        } else if self.static_code.contains(&address) {
            FrameInUse::Own
        } else {
            FrameInUse::Native
        }
    }

    fn runs_in_call_frame(&self, address: usize) -> bool {
        self.frame_in_use_at(address) != FrameInUse::Native
    }

    /// Of a routine that has been called and has no frame. May be anything if it has been jumped to.
    fn return_address_of_routine(&self, registers: &Registers) -> Option<usize> {
        #[cfg(target_arch = "aarch64")]
        return Some(registers.link_register);
        #[cfg(target_arch = "x86_64")]
        self.load(registers.stack_pointer)
    }

    /// Of a function that has no frame, or not yet, or no more.
    #[cfg(target_arch = "aarch64")]
    fn unsaved_return_address(&self, registers: &Registers) -> Option<usize> {
        let saved = self.load_at(registers.frame_pointer, CallFrame::OFFSET_OF_RETURN_ADDRESS);
        Some(registers.link_register).filter(|&address| saved != Some(address))
    }

    /// Of a function that has no frame yet, or no more.
    #[cfg(target_arch = "x86_64")]
    fn unsaved_return_address(&self, registers: &Registers) -> Option<usize> {
        const PUSH_RBP: u8 = 0x55;
        const RET: u8 = 0xc3;
        const MOV_RBP_RSP: [u8; 3] = [0x48, 0x89, 0xe5];
        let instruction = core::ptr::with_exposed_provenance::<u8>(registers.program_counter);
        // SAFETY: the instruction that is about to run goes on for as long as it starts like one that does.
        let byte = |index: usize| unsafe { instruction.add(index).read_volatile() };
        if matches!(byte(0), PUSH_RBP | RET) {
            self.load(registers.stack_pointer)
        } else if (0..MOV_RBP_RSP.len()).all(|index| byte(index) == MOV_RBP_RSP[index]) {
            self.load_at(registers.stack_pointer, WORD)
        } else {
            None
        }
    }

    /// From native code up to what has called it. Returns the frame and the address in its code.
    fn climb(&self, registers: &Registers, top: usize) -> Option<(usize, usize)> {
        let mut frame = registers.frame_pointer;
        if let Some(address) = self.unsaved_return_address(registers)
            && self.runs_in_call_frame(address)
        {
            return Some((frame, address));
        }
        for _ in 0..MOST_NATIVE_FRAMES {
            if frame == top {
                return None;
            }
            let address = self.load_at(frame, CallFrame::OFFSET_OF_RETURN_ADDRESS)?;
            frame = self.load(frame).filter(|&caller| caller > frame)?;
            if self.runs_in_call_frame(address) {
                return Some((frame, address));
            }
        }
        None
    }

    /// Those around the entry frame: the call frame and the entry frame.
    fn outer_tops(&self, entry_frame: usize) -> Option<(usize, usize)> {
        let record = entry_frame.checked_sub(EntryRecord::DISTANCE)?;
        let is_outside = |&frame: &usize| frame == 0 || frame > entry_frame;
        Some((
            (self.load_at(record, EntryRecord::OFFSET_OF_TOP_CALL_FRAME)).filter(is_outside)?,
            (self.load_at(record, EntryRecord::OFFSET_OF_TOP_ENTRY_FRAME)).filter(is_outside)?,
        ))
    }

    /// Innermost first. `None` if the chain of frames is broken.
    pub(super) fn walk(
        &self,
        registers: &Registers,
        tops: &Tops,
        out: &mut [RawFrame],
    ) -> Option<Walk> {
        let top = (tops.call_frame, 0);
        if tops.is_searching {
            return self.walk_from(top, registers, tops, out);
        }
        let mut address = registers.program_counter;
        let mut in_use = self.frame_in_use_at(address);
        if in_use == FrameInUse::Callers {
            address = self.return_address_of_routine(registers)?;
            if bun_engine_exec_memory::contains(address) {
                in_use = self.frame_in_use_at(address);
            }
        }
        let start = match in_use {
            // The frames of an interpreter of WebAssembly stand inside the native frame that the frame pointer leads
            // to, so there what the `Vm` has is the innermost of the two.
            FrameInUse::Native => (self.climb(registers, tops.call_frame))
                .filter(|&(frame, _)| tops.call_frame == 0 || frame <= tops.call_frame),
            _ => Some((registers.frame_pointer, address)),
        };
        // Not all native frames are linked through the frame pointer. On Windows for x86-64 hardly any is.
        (start.and_then(|start| self.walk_from(start, registers, tops, out)))
            .or_else(|| self.walk_from(top, registers, tops, out))
    }

    fn walk_from(
        &self,
        (mut frame, mut address): (usize, usize),
        registers: &Registers,
        tops: &Tops,
        out: &mut [RawFrame],
    ) -> Option<Walk> {
        let mut entry_frame = tops.entry_frame;
        // It is being entered or left.
        while entry_frame != 0 && entry_frame < frame {
            (_, entry_frame) = self.outer_tops(entry_frame)?;
        }
        let here = registers.program_counter;
        let is_in_static_code = |address| self.static_code.contains(&address);
        let mut walk = Walk {
            depth: 0,
            is_cut_short: false,
            first: FirstFrame {
                doubtful_size: (self.load(frame))
                    .filter(|&caller| is_in_static_code(address) && caller != entry_frame)
                    .map(|caller| caller.wrapping_sub(frame)),
                is_top_call_frame: frame == tops.call_frame,
                has_called_out: !is_in_static_code(here) && !bun_engine_exec_memory::contains(here),
                has_return_address: address != here,
            },
        };
        while frame != 0 {
            if frame > entry_frame {
                return None;
            }
            if frame == entry_frame {
                (frame, entry_frame) = self.outer_tops(entry_frame)?;
                address = 0;
                continue;
            }
            let Some(slot) = out.get_mut(walk.depth) else {
                walk.is_cut_short = true;
                break;
            };
            let count_and_call_site = self.load_at(frame, CallFrame::OFFSET_OF_ARGUMENT_COUNT)?;
            *slot = RawFrame {
                code_block: self.load_at(frame, CallFrame::OFFSET_OF_CODE_BLOCK)?,
                callee: self.load_at(frame, CallFrame::OFFSET_OF_CALLEE)? as u64,
                address,
                call_site: (count_and_call_site >> 32) as u32,
            };
            walk.depth += 1;
            address = self.load_at(frame, CallFrame::OFFSET_OF_RETURN_ADDRESS)?;
            frame = self.load(frame).filter(|&caller| caller > frame)?;
        }
        Some(walk)
    }
}
