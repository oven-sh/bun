//! Turns a frame of optimized code into those that a lower tier would have.

use bun_engine_bytecode::{RawInstruction, Register};
use bun_engine_macros::native_abi;
use bun_engine_platform::log;
use bun_engine_vm::{CallFrame, CodeBlock, Cx, ExitKind, Gc, SpeculatedType, Value, Vm, options};
use smallvec::SmallVec;

use super::code::{Compiled, StateOfFrame};
use super::materialize::{Described, materialize};
use super::{probes, tiering};
use crate::graph::{ARGUMENT_COUNT, CallKind, DEAD, Format, FrameIndex, Profile};
use crate::lower::output::{ExitRecord, Held, PlacedState};

/// The registers, by their numbers.
#[repr(C)]
pub(super) struct Saved {
    gprs: [u64; 32],
    fprs: [u64; 32],
}

impl Saved {
    pub(super) const fn offset_of_gpr(number: u8) -> usize {
        core::mem::offset_of!(Saved, gprs) + number as usize * 8
    }

    pub(super) const fn offset_of_fpr(number: u8) -> usize {
        core::mem::offset_of!(Saved, fprs) + number as usize * 8
    }

    pub(super) fn gpr(&self, number: u8) -> u64 {
        self.gprs[usize::from(number)]
    }

    pub(super) fn fpr(&self, number: u8) -> u64 {
        self.fprs[usize::from(number)]
    }
}

#[repr(C)]
pub(super) struct Resumption {
    frame: usize,
    /// Zero to stay in the code.
    address: usize,
}

/// What a state has.
struct Found<'a> {
    held: &'a [Held],
    values: SmallVec<[u64; 64]>,
    described: Described,
}

impl Found<'_> {
    /// Of an object that has not been made, only the type.
    fn at(&self, position: usize) -> (u64, SpeculatedType) {
        let bits = self.values[position];
        let mut described = self.described.iter();
        match self.held[position].format() {
            Format::Virtual => {
                let (_, recipe) = described.find(|it| it.0 as u64 == bits).expect("follows");
                (DEAD, recipe.ty())
            }
            _ => with_type(bits),
        }
    }
}

/// # Safety
/// As for `Compiled::read`.
unsafe fn read_all<'a>(
    compiled: &'a Compiled,
    state: PlacedState,
    states: &[StateOfFrame<'_>],
    frame: &CallFrame,
    saved: Option<&Saved>,
) -> Found<'a> {
    let held = &compiled.tables.held[state.first as usize..];
    let (mut values, mut described) = (SmallVec::new(), Described::new());
    let mut count = states.iter().map(|it| it.held.len()).sum();
    let mut last_start = 0;
    loop {
        for &held in &held[values.len()..count] {
            // SAFETY: the caller's.
            let bits = unsafe { compiled.read(held, frame, saved) };
            if held.format() == Format::Virtual {
                last_start = bits.max(last_start);
            }
            values.push(bits);
        }
        if count as u64 > last_start || last_start == 0 {
            break;
        }
        // SAFETY: as above.
        let recipe = unsafe { compiled.read(held[count], frame, saved) };
        let recipe = compiled.tables.recipes[recipe as usize];
        described.push((count, recipe));
        count += 1 + recipe.word_count();
    }
    Found {
        held: &held[..count],
        values,
        described,
    }
}

/// Returns the innermost frame.
///
/// # Safety
/// `root` runs the code and is never going to go on in it. The values are those of the states.
unsafe fn write_frames<'a>(
    vm: &Vm,
    compiled: &Compiled,
    states: &[StateOfFrame<'_>],
    found: &mut Found<'_>,
    root: &'a CallFrame,
) -> &'a CallFrame {
    let defer = vm.heap.defer_collection();
    // SAFETY: the caller's.
    unsafe { materialize(vm, &defer, &found.described, found.held, &mut found.values) };
    let (mut values, mut frame) = (found.values.iter(), root);
    for state in states {
        let code_block = compiled.code_block_of(state.position.frame);
        let info = &compiled.tables.frames[state.position.frame.index()];
        // SAFETY: the frame of the code is large enough for all that it has inlined.
        unsafe {
            if state.position.frame != FrameIndex::ROOT {
                let linkage = if info.kind == CallKind::TailCall {
                    [frame.caller_address(), frame.return_address()]
                } else {
                    [frame.address(), return_point(frame)]
                };
                frame = CallFrame::from_address(root.address() - info.distance as usize * 8);
                frame.slot(0).set(linkage[0] as u64);
                frame.slot(1).set(linkage[1] as u64);
            }
            if cfg!(debug_assertions) {
                (1..=code_block.locals() as isize).for_each(|it| frame.slot(-it).set(DEAD));
            }
            for (register, &value) in state.registers.iter().zip(&mut values) {
                frame.slot(register.offset() as isize).set(value);
            }
            frame.set_code_block(Some(code_block));
        }
        frame.set_call_site(code_block.call_site_of(state.position.offset));
        code_block.write_barrier_for_cell();
    }
    frame
}

fn return_point(caller: &CallFrame) -> usize {
    let code_block = caller.code_block().expect("just written");
    let offset = code_block.bytecode_offset_of(caller.call_site());
    bun_engine_interpreter::return_point(code_block.body().instructions(), offset)
        .expect("at a call")
}

const _: () = assert!(ARGUMENT_COUNT.offset() as usize * 8 == CallFrame::OFFSET_OF_ARGUMENT_COUNT);

fn type_of(bits: u64) -> SpeculatedType {
    // SAFETY: only called with what has been read from a state.
    SpeculatedType::of(unsafe { Value::from_bits_or_empty(bits) })
}

fn with_type(bits: u64) -> (u64, SpeculatedType) {
    (bits, type_of(bits))
}

fn learn_from(compiled: &Compiled, exit: &ExitRecord, values: &[u64]) {
    let position = compiled.position(exit.info.origin);
    let code_block = compiled.code_block_of(position.frame);
    let (owner, site) = position.exit_site(&compiled.tables.frames, |it| compiled.position(it));
    (compiled.code_block_of(owner)).add_exit_site(site, exit.info.kind);
    code_block.note_exit(exit.info.kind);
    code_block.update_array_profile(position.offset);
    if let Some((position, profile)) = exit.info.culprit {
        let widen = |it: SpeculatedType| it | type_of(values[position as usize]);
        match profile {
            Profile::Argument(index) => (compiled.code_block_of(FrameIndex::ROOT))
                .argument_prediction(index)
                .update(widen),
            Profile::Result(frame, word) => {
                compiled.code_block_of(frame).prediction(word).update(widen);
            }
        }
    }
}

/// `link` is the frame of the thunk that the exit has called.
#[native_abi]
pub(super) unsafe fn leave(vm: &Vm, saved: &Saved, link: &CallFrame) -> Resumption {
    // SAFETY: the frame that has called the thunk.
    let root = unsafe { CallFrame::from_address(link.caller_address()) };
    let optimized = root.code_block().expect("a frame of optimized code");
    let compiled = Compiled::of(&optimized);
    let offset = (link.return_address() - compiled.handle.start()) as u32;
    let exits = &compiled.tables.exits;
    let exit = &exits[exits.partition_point(|exit| exit.return_offset < offset)];
    assert!(exit.return_offset == offset);
    let states = compiled.frames_of(exit.state);
    vm.set_top_call_frame(root);
    root.set_call_site(0);
    vm.retract_exception();

    // SAFETY: that is where it is.
    let read = || unsafe { read_all(&compiled, exit.state, &states, root, Some(saved)) };
    let mut better = None;
    if exit.info.kind == ExitKind::TierUp {
        let found = read();
        let value_in = |register: Register| {
            let position = states[0].registers.iter().position(|&it| it == register);
            // SAFETY: what the state leaves out is in the frame.
            let in_place = || with_type(unsafe { root.slot(register.offset() as isize) }.get());
            position.map_or_else(in_place, |position| found.at(position))
        };
        let (offset, before) = (states[0].position.offset, vm.rearrangements());
        better = tiering::optimize_loop_fully(vm, optimized, root, offset, &value_in);
        if better.is_none() && !optimized.is_jettisoned() && vm.rearrangements() == before {
            let (frame, address) = (0, 0);
            return Resumption { frame, address };
        }
    }
    let mut found = read();
    if options().log_optimizer {
        describe(&compiled, exit, &states);
    }
    // SAFETY: as above.
    let innermost = unsafe { write_frames(vm, &compiled, &states, &mut found, root) };
    vm.set_top_call_frame(innermost);
    let is_counted = probes::counts(vm, &compiled, &exit.info) && exit.info.kind.is_counted();
    if is_counted {
        learn_from(&compiled, exit, &found.values);
    }
    let address = match better {
        Some(better) => tiering::enter_loop(root, better),
        None => {
            tiering::did_exit(vm, optimized, is_counted);
            bun_engine_baseline::resume_entry(&innermost.code_block().expect("just written"))
        }
    };
    let frame = innermost.address();
    Resumption { frame, address }
}

#[native_abi]
pub(super) unsafe fn end_of_frame(frame: &CallFrame) -> usize {
    let optimized = frame.code_block().expect("a frame of optimized code");
    frame.address() - Compiled::of(&optimized).tables.frame_size as usize
}

/// The frame is at a call site that has a handler for the pending exception. Returns the frame to unwind from.
#[native_abi]
pub(super) unsafe fn leave_to_unwind(root: &CallFrame) -> usize {
    let optimized: Gc<CodeBlock> = root.code_block().expect("a frame of optimized code");
    let compiled = Compiled::of(&optimized);
    let site = compiled.call_site(root.call_site()).expect("in a call");
    let states = compiled.frames_of(site.state);
    // SAFETY: that is where it is.
    unsafe {
        let mut found = read_all(&compiled, site.state, &states, root, None);
        let cx = Cx::from_global(optimized.global());
        write_frames(cx, &compiled, &states, &mut found, root).address()
    }
}

#[cold]
fn describe(compiled: &Compiled, exit: &ExitRecord, states: &[StateOfFrame<'_>]) {
    let (failed, resumed) = (
        compiled.position(exit.info.origin),
        states[states.len() - 1].position,
    );
    let code = compiled.code_block_of(failed.frame);
    log(format_args!(
        "exit {:?} from {} at {}:{} to {}:{} ({:?})\n",
        exit.info.kind,
        tiering::name_of(&compiled.code_block_of(FrameIndex::ROOT)),
        tiering::name_of(&compiled.code_block_of(failed.frame)),
        failed.offset,
        tiering::name_of(&compiled.code_block_of(resumed.frame)),
        resumed.offset,
        RawInstruction::read(code.body().instructions(), failed.offset).map(|it| it.opcode),
    ));
}
