//! Optimized code as the rest of the engine sees it.

use core::any::Any;
use core::cell::Cell;
use std::rc::Rc;

use bun_engine_bytecode::Register;
use bun_engine_codegen::ir::Origin;
use bun_engine_exec_memory::{CodeHandle, replace_with_jump};
use bun_engine_text::Identifier;
use bun_engine_vm::heap::Survivors;
use bun_engine_vm::{
    CallFrame, CodeBlock, CodeOrigin, CompiledCode, Coroutine, Gc, InlineFrame, JsCell, RealmSlot,
    Shape, Value, ValueVec, Visitor, Vm, Watchpoint,
};
use smallvec::SmallVec;

use super::Thunks;
use super::exits::Saved;
use super::tiering::give_up_on;
use crate::graph::{
    ARGUMENT_COUNT, CallKind, Entry, Format, FrameIndex, Layout, NO_LAYOUT, Position,
};
use crate::lower::output::{CallSite, Description, Held, Place, PlacedState};

pub(super) struct Compiled {
    pub(super) tables: Description,
    pub(super) handle: CodeHandle,
    pub(super) kind: Entry,
    pub(super) entry: usize,
    /// The addresses of the cells that the code keeps alive.
    pub(super) kept: Box<[usize]>,
    /// Of those that it dies with. The shapes come first.
    pub(super) named: Box<[usize]>,
    pub(super) shape_count: usize,
    pub(super) has_lost_named: Cell<bool>,
    pub(super) exits_taken: Cell<u32>,
    pub(super) _names: Box<[Identifier]>,
    pub(super) _watchpoint: Watchpoint,
}

/// The part of a state that is about one function.
pub(super) struct StateOfFrame<'a> {
    pub(super) position: Position,
    pub(super) registers: &'a [Register],
    pub(super) held: &'a [Held],
}

impl Compiled {
    pub(super) fn of(code_block: &CodeBlock) -> Rc<Compiled> {
        let compiled: Rc<dyn Any> = code_block.compiled().expect("optimized");
        compiled.downcast().expect("there is one optimizer")
    }

    pub(super) fn code_block_of(&self, frame: FrameIndex) -> Gc<CodeBlock> {
        // SAFETY: among those that are kept.
        unsafe { Gc::from_address(self.tables.frames[frame.index()].code_block) }
    }

    pub(super) fn position(&self, origin: Origin) -> Position {
        self.tables.positions[origin.0 as usize]
    }

    fn code_origin(&self, origin: Origin) -> CodeOrigin {
        let Position { frame, offset } = self.position(origin);
        CodeOrigin {
            bytecode_offset: offset,
            inline_frame: (frame != FrameIndex::ROOT).then_some(frame.0),
        }
    }

    /// `None` between call sites.
    pub(super) fn call_site(&self, number: u32) -> Option<&CallSite> {
        Some(&self.tables.call_sites[number.checked_sub(1)? as usize])
    }

    /// The outermost first.
    pub(super) fn frames_of(&self, state: PlacedState) -> SmallVec<[StateOfFrame<'_>; 6]> {
        let layout = |index| (index != NO_LAYOUT).then(|| &self.tables.layouts[index as usize]);
        let chain = core::iter::successors(layout(state.layout), |it| layout(it.caller));
        let chain: SmallVec<[&Layout; 6]> = chain.collect();
        let mut rest = &self.tables.held[state.first as usize..];
        let part = |layout: &&Layout| {
            let count = layout.register_count as usize;
            StateOfFrame {
                position: self.position(layout.resume),
                registers: &self.tables.layout_registers[layout.first_register as usize..][..count],
                held: rest.split_off(..count).expect("a value for each register"),
            }
        };
        chain.iter().rev().map(part).collect()
    }

    /// With its tag.
    ///
    /// # Safety
    /// `frame` runs this code and is where the state has been recorded.
    pub(super) unsafe fn read(&self, held: Held, frame: &CallFrame, saved: Option<&Saved>) -> u64 {
        let saved = || saved.expect("what is in registers does not outlast a call");
        let bits = match held.place() {
            Place::Frame(offset) => {
                let address = frame.address().wrapping_add_signed(offset as isize);
                // SAFETY: the caller's. Of 32 bits there may be no more than that.
                unsafe { core::ptr::with_exposed_provenance::<u64>(address).read_unaligned() }
            }
            Place::Gpr(number) => saved().gpr(number),
            Place::Fpr(number) => saved().fpr(number),
            Place::Constant(position) => self.tables.constants[position as usize],
        };
        match held.format() {
            Format::Tagged | Format::Virtual => bits,
            Format::Int32 => Value::int32(bits as i32).to_bits(),
            Format::Int52 => Value::number(bits as i64 as f64).to_bits(),
            Format::Double => Value::double(f64::from_bits(bits)).to_bits(),
            Format::Boolean => Value::boolean(bits as u32 != 0).to_bits(),
            Format::Saved => {
                let coroutine = Coroutine::of_frame(frame).expect("resumed");
                let address = coroutine.address() + bits as usize;
                // SAFETY: what the code has loaded the value from.
                unsafe { core::ptr::with_exposed_provenance::<u64>(address).read() }
            }
        }
    }

    /// With the empty value for an object that has not been made.
    ///
    /// # Safety
    /// As for `inline_callee`.
    unsafe fn for_each_register_of(
        &self,
        frame: &CallFrame,
        index: u32,
        mut visit: impl FnMut(Register, u64),
    ) {
        let Some(site) = self.call_site(frame.call_site()) else {
            return;
        };
        let frames = self.frames_of(site.state);
        let states = frames.iter().filter(|it| it.position.frame.0 == index);
        for (&register, &held) in states.flat_map(|it| it.registers.iter().zip(it.held)) {
            let bits = match held.format() {
                Format::Virtual => 0,
                // SAFETY: the caller's.
                _ => unsafe { self.read(held, frame, None) },
            };
            visit(register, bits);
        }
    }
}

fn visit_all(cells: &[usize], visitor: &mut Visitor) {
    for &address in cells {
        // SAFETY: alive when the code was installed. It is invalidated, and lets go of them, when that changes.
        visitor.append(unsafe { Gc::<JsCell>::from_address(address) });
    }
}

impl CompiledCode for Compiled {
    fn origin_of_call_site(&self, call_site: u32) -> CodeOrigin {
        self.code_origin(self.call_site(call_site).map_or(Origin(0), |it| it.origin))
    }

    fn has_call_site(&self, call_site: u32) -> bool {
        call_site as usize <= self.tables.call_sites.len()
    }

    fn origin_of_address(&self, address: usize) -> Option<CodeOrigin> {
        if !self.handle.contains(address) {
            return None;
        }
        let (offset, origins) = (address - self.handle.start(), &self.tables.origins);
        let after = origins.partition_point(|&(start, _)| start as usize <= offset);
        Some(self.code_origin(origins[..after].last()?.1))
    }

    fn inline_frame(&self, _: &Vm, index: u32) -> InlineFrame {
        let info = &self.tables.frames[index as usize];
        InlineFrame {
            code_block: self.code_block_of(FrameIndex(index)),
            caller: self.code_origin(info.caller),
            is_tail_call: info.kind == CallKind::TailCall,
            specialization: info.kind.specialization(),
        }
    }

    unsafe fn inline_callee(&self, frame: &CallFrame, index: u32) -> Value {
        let mut callee = Some(Value::UNDEFINED);
        // SAFETY: the caller's.
        unsafe {
            self.for_each_register_of(frame, index, |register, bits| {
                if register == Register::CALLEE {
                    callee = Value::from_bits_or_empty(bits);
                }
            });
        }
        callee.unwrap_or_else(|| {
            let realm = self.code_block_of(FrameIndex(index)).global();
            let absent = realm.slot_if_initialized(RealmSlot::absent_callee);
            absent.expect("made with the graph").as_value()
        })
    }

    unsafe fn current_arguments(&self, frame: &CallFrame, index: Option<u32>, out: &mut ValueVec) {
        let mut count = out.len();
        // SAFETY: the caller's.
        unsafe {
            self.for_each_register_of(frame, index.unwrap_or(0), |register, bits| {
                let position = (register.offset() - Register::argument(0).offset()) as usize;
                let value = || Value::from_bits_or_empty(bits).unwrap_or_default();
                if register == ARGUMENT_COUNT {
                    count = bits as usize - 1;
                } else if position < out.len() {
                    out[position] = value();
                } else if position < count {
                    out.push(value());
                }
            });
        }
    }

    fn catch_address(&self, _: u32, _: CodeOrigin, _: u32) -> usize {
        Thunks::get().expect("the code calls them").catch
    }

    fn visit(&self, _: &CodeBlock, visitor: &mut Visitor) {
        visit_all(&self.kept, visitor);
        if self.shape_count != 0 {
            visitor.constrain_by_current_cell();
        }
    }

    fn visit_output_constraints(&self, visitor: &mut Visitor) {
        if !self.has_lost_named.get() {
            for &address in &self.named[..self.shape_count] {
                // SAFETY: as in `visit_all`.
                unsafe { Gc::<Shape>::from_address(address) }.visit_if_class_lives(visitor);
            }
        }
    }

    /// What looks like a frame may be a leftover on the stack.
    fn visit_while_running(&self, visitor: &mut Visitor) {
        if !self.has_lost_named.get() {
            visit_all(&self.named, visitor);
        }
    }

    fn reconcile_weak_references(&self, owner: &CodeBlock, survivors: &Survivors) {
        if self.tables.writes_profiles {
            let frames = (0..self.tables.frames.len() as u32).map(FrameIndex);
            frames.for_each(|it| self.code_block_of(it).reconcile_profiles(survivors));
        }
        let has_lost = &self.has_lost_named;
        if !has_lost.get() && !self.named.iter().all(|&it| survivors.contains_address(it)) {
            has_lost.set(true);
            give_up_on(survivors.vm(), owner, "has lost a cell");
        }
    }

    fn invalidate(&self) {
        for point in &self.tables.invalidation_points {
            let [at, target] = [point.offset, point.target].map(|it| self.handle.address(it));
            // SAFETY: a place that was made for it. The one thread that runs the code is here.
            unsafe { replace_with_jump(at, target) }.expect("within one piece of code");
        }
    }

    fn addresses(&self) -> core::ops::Range<usize> {
        self.handle.addresses()
    }

    fn size(&self) -> usize {
        let tables = &self.tables;
        self.handle.len()
            + size_of_val(&*tables.exits)
            + size_of_val(&*tables.call_sites)
            + size_of_val(&*tables.held)
            + size_of_val(&*tables.constants)
            + size_of_val(&*tables.invalidation_points)
            + size_of_val(&*tables.frames)
            + size_of_val(&*tables.layouts)
            + size_of_val(&*tables.layout_registers)
            + size_of_val(&*tables.recipes)
            + size_of_val(&*tables.positions)
            + size_of_val(&*self.kept)
            + size_of_val(&*self.named)
    }
}
