//! The machine code that is not up to the back end.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Code, RegOrImm, Scratch};
use bun_engine_codegen::ir::{Origin, Token};
use bun_engine_codegen::{CallSite as CallEnd, Client, Compiled, ExitSite, Frame, PatchpointSite};
use bun_engine_wasm_format::{CodeIndex, FuncIndex, TypeIndex};

use super::map::Map;
use super::translator::pins_memory_base;
use crate::abi::{
    Callable, FunctionSlot, INSTANCE, InstanceLayout, MEMORY_BASE, Operation, SLOT, Signature,
    Trap, UNCHECKED_FRAME_SIZE, UNCHECKED_STACK_EXTENSION, callee_word, frame,
};
use crate::allocation;
use crate::clauses::{Scope, Scopes};
use crate::output::{CallSite, Clause, CompiledFunction, DirectCall, Environment, InlineFrame};
use crate::tail_call;

#[derive(Clone, Copy)]
pub(super) enum Callee {
    Code(CodeIndex),
    Import(FuncIndex),
    /// At this distance from the last operand.
    Callable {
        offset: i32,
    },
}

/// What a patchpoint does.
#[derive(Clone, Copy)]
pub(super) enum Site {
    Nothing,
    Trap(Trap),
    Truncate {
        from: FloatWidth,
        sign: Sign,
        to: Width,
    },
    /// The cell, and the threshold.
    WriteBarrier,
    /// The threshold.
    Publish,
    Poll,
    /// Leaves the fields or elements as they are.
    New {
        ty: TypeIndex,
        allocator: i32,
        cell_size: u32,
        /// For an array.
        length: Option<u32>,
    },
    /// The length, a vector of elements, and the bits of one unless it is the default.
    NewFilled(TypeIndex),
    Call {
        callee: Callee,
        may_leave_instance: bool,
        scope: Scope,
    },
    /// A call of an operation.
    Throw(Scope),
    TailCall(Callee, TypeIndex),
}

/// An origin is zero for the function itself, and otherwise one more than the position of the inline frame.
#[derive(Default)]
pub(super) struct Sites {
    sites: Vec<Site>,
    inline_frames: Vec<InlineFrame>,
    pub(super) scopes: Scopes,
    clauses: Vec<Clause>,
    makes_calls: bool,
}

impl Sites {
    pub(super) const NOTHING: Token = Token(0);
    pub(super) const WRITE_BARRIER: Token = Token(1);
    pub(super) const PUBLISH: Token = Token(2);
    pub(super) const POLL: Token = Token(3);

    /// But for the scopes, which blocks that are open refer to.
    pub(super) fn clear(&mut self) {
        self.sites.clear();
        (self.sites).extend([Site::Nothing, Site::WriteBarrier, Site::Publish, Site::Poll]);
        self.inline_frames.clear();
        self.makes_calls = false;
    }

    /// There will be no more.
    pub(super) fn finish(&mut self) {
        self.clauses = self.scopes.finish();
    }

    pub(super) fn add(&mut self, site: Site) -> Token {
        self.makes_calls |= matches!(site, Site::Call { .. } | Site::TailCall(..));
        self.sites.push(site);
        Token(self.sites.len() as u32 - 1)
    }

    pub(super) fn add_inline_frame(&mut self, frame: InlineFrame) -> u32 {
        self.inline_frames.push(frame);
        self.inline_frames.len() as u32 - 1
    }

    pub(super) fn has_inline_frames(&self) -> bool {
        !self.inline_frames.is_empty()
    }

    pub(super) fn inline_frame(origin: Origin) -> u32 {
        origin.0.wrapping_sub(1)
    }

    #[inline]
    pub(super) fn exit_token(trap: Trap, origin: Origin) -> Token {
        Token(origin.0 * Trap::COUNT as u32 + trap as u32)
    }
}

struct Barrier {
    start: Label,
    end: Label,
    cell: Gpr,
    temp: Gpr,
}

#[derive(Clone, Copy)]
enum Contents {
    Fields,
    Defaults { length: RegOrImm },
    Copies { length: Gpr, bits: Gpr },
}

#[derive(Clone, Copy)]
struct SlowAllocation {
    start: Label,
    end: Label,
    ty: TypeIndex,
    contents: Contents,
    cell: Gpr,
    saved: RegisterSet,
    vector_bytes: i32,
    origin: Origin,
}

struct Switch {
    start: Label,
    end: Label,
    to: Address,
    loads_base: bool,
}

struct Return {
    address: Label,
    handler: Option<(Scope, Label)>,
    origin: Origin,
}

#[derive(Default)]
pub(super) struct Tables {
    /// By the token of the exit.
    traps: Vec<Option<Label>>,
    thunks: Vec<(CodeIndex, Label)>,
    thunk_of: Map<Label>,
    barriers: Vec<Barrier>,
    /// Where the call starts, and where it goes back to.
    polls: Vec<(Label, Label, Origin)>,
    switches: Vec<Switch>,
    allocations: Vec<SlowAllocation>,
    returns: Vec<Return>,
    direct_calls: Vec<(Label, CodeIndex)>,
}

pub(super) struct Emitter<'a> {
    env: &'a Environment<'a>,
    code: CodeIndex,
    takes_over_frame: bool,
    sites: &'a Sites,
    tables: &'a mut Tables,
    entry: Label,
    /// Where it starts, and where it goes back to.
    entry_check: Option<(Label, Label)>,
}

/// For code before and after which no register but those of arguments and results has a value.
const USUAL_SCRATCH: Scratch = Scratch {
    #[cfg(target_arch = "x86_64")]
    gprs: [Some(abi::SCRATCH_GPR), None],
    #[cfg(target_arch = "aarch64")]
    gprs: [Some(abi::SCRATCH_GPRS[0]), Some(abi::SCRATCH_GPRS[1])],
    fprs: [Some(abi::SCRATCH_FPRS[0]), None],
};

fn in_frame(offset: i32) -> Address {
    Address::new(abi::FRAME_POINTER, offset)
}

impl<'a> Emitter<'a> {
    pub(super) fn new(
        env: &'a Environment<'a>,
        code: CodeIndex,
        takes_over_frame: bool,
        sites: &'a Sites,
        tables: &'a mut Tables,
        masm: &mut MacroAssembler,
    ) -> Self {
        tables.traps.clear();
        (tables.traps).resize((sites.inline_frames.len() + 1) * Trap::COUNT, None);
        tables.thunks.clear();
        tables.thunk_of.clear();
        tables.barriers.clear();
        tables.polls.clear();
        tables.switches.clear();
        tables.allocations.clear();
        tables.returns.clear();
        tables.direct_calls.clear();
        Self {
            env,
            code,
            takes_over_frame,
            sites,
            tables,
            entry: masm.new_label(),
            entry_check: None,
        }
    }

    pub(super) fn finish(self, code: Code, compiled: &Compiled) -> CompiledFunction {
        let call_site = |site: &Return| CallSite {
            return_offset: code.offset_of(site.address),
            first_clause: (site.handler)
                .map_or(u32::MAX, |it| self.sites.scopes.first_clause(it.0)),
            handler_offset: (site.handler).map_or(0, |it| code.offset_of(it.1)),
            inline_frame: Sites::inline_frame(site.origin),
        };
        let direct_call = |&(end, callee): &(Label, CodeIndex)| DirectCall {
            end_offset: code.offset_of(end),
            callee,
        };
        let range = |&(start, origin): &(Label, Origin)| {
            (code.offset_of(start), Sites::inline_frame(origin))
        };
        CompiledFunction {
            entry_offset: code.offset_of(self.entry),
            frame_size: compiled.frame.size,
            call_sites: self.tables.returns.iter().map(call_site).collect(),
            clauses: self.sites.clauses.clone(),
            inline_frames: self.sites.inline_frames.clone(),
            inline_ranges: compiled.emitted.origins.iter().map(range).collect(),
            direct_calls: self.tables.direct_calls.iter().map(direct_call).collect(),
            code,
        }
    }

    fn trap_label(&mut self, masm: &mut MacroAssembler, token: Token) -> Label {
        *self.tables.traps[token.0 as usize].get_or_insert_with(|| masm.new_label())
    }

    fn note_return(&mut self, address: Label, handler: Option<(Scope, Label)>, origin: Origin) {
        if handler.is_some() || self.sites.has_inline_frames() {
            self.tables.returns.push(Return {
                address,
                handler,
                origin,
            });
        }
    }

    fn call_trap(&mut self, masm: &mut MacroAssembler, trap: Trap, origin: Origin) {
        masm.call_address(self.env.stubs.traps[trap as usize]);
        let address = masm.mark();
        self.note_return(address, None, origin);
    }

    fn load_memory_base(&self, masm: &mut MacroAssembler) {
        let offset = InstanceLayout::memory_base(self.env.host);
        masm.load64(MEMORY_BASE, Address::new(INSTANCE, offset));
    }

    /// Sets up the registers that the callee finds, other than arguments. Returns where a direct call goes.
    fn prepare_call(
        &mut self,
        masm: &mut MacroAssembler,
        callee: Callee,
        site: &PatchpointSite<'_>,
    ) -> Option<CodeIndex> {
        match callee {
            Callee::Code(code) => Some(code),
            Callee::Import(func) => {
                const _: () = assert!(Callable::SLOT + 8 == Callable::INSTANCE);
                let import = Address::new(INSTANCE, self.env.layout.import(func));
                masm.load_pair64(SLOT, INSTANCE, import.plus(Callable::SLOT));
                self.load_memory_base(masm);
                None
            }
            Callee::Callable { offset } => {
                let base = site.operands[site.operands.len() - 1].gpr();
                let callable = Address::new(base, offset);
                // What overwrites `base` comes last.
                if base != SLOT {
                    masm.load64(SLOT, callable.plus(Callable::SLOT));
                }
                self.switch_instance(masm, callable.plus(Callable::INSTANCE), true);
                if base == SLOT {
                    masm.load64(SLOT, callable.plus(Callable::SLOT));
                }
                None
            }
        }
    }

    /// Mostly it stays the same, and then nothing has to wait for the loads.
    fn switch_instance(&mut self, masm: &mut MacroAssembler, to: Address, loads_base: bool) {
        let start = masm.new_label();
        masm.branch64(Cond::Ne, INSTANCE, to, start);
        self.tables.switches.push(Switch {
            start,
            end: masm.here(),
            to,
            loads_base,
        });
    }

    fn thunk(&mut self, masm: &mut MacroAssembler, callee: CodeIndex) -> Label {
        let Tables {
            thunks, thunk_of, ..
        } = self.tables;
        thunk_of.get_or_insert_with(callee.0.into(), || {
            let label = masm.new_label();
            thunks.push((callee, label));
            label
        })
    }

    fn call(&mut self, masm: &mut MacroAssembler, callee: Callee, site: &PatchpointSite<'_>) {
        match self.prepare_call(masm, callee, site) {
            None => masm.call_indirect(Address::new(SLOT, FunctionSlot::ENTRY)),
            Some(code) if code == self.code && !self.takes_over_frame => masm.call(self.entry),
            Some(code) => {
                let thunk = self.thunk(masm, code);
                let end = masm.patchable_call(thunk);
                self.tables.direct_calls.push((end, code));
            }
        }
    }

    fn tail_call(
        &mut self,
        masm: &mut MacroAssembler,
        callee: Callee,
        ty: TypeIndex,
        site: &PatchpointSite<'_>,
    ) {
        let (module, direct) = (self.env.module, self.prepare_call(masm, callee, site));
        masm.set_scratch(USUAL_SCRATCH);
        tail_call::leave_frame(
            masm,
            &Signature::new(module.func_type(module.func_index(self.code))),
            &Signature::new(module.types().func_type(ty)),
        );
        match direct {
            None => masm.jump_indirect(Address::new(SLOT, FunctionSlot::ENTRY)),
            Some(code) => {
                let thunk = self.thunk(masm, code);
                let end = masm.patchable_jump(thunk);
                self.tables.direct_calls.push((end, code));
            }
        }
    }

    fn write_barrier(&mut self, masm: &mut MacroAssembler, site: &PatchpointSite<'_>) {
        let (cell, threshold) = (site.operands[0].gpr(), site.operands[1].gpr());
        let (state, start) = (site.scratch_gprs[0], masm.new_label());
        masm.load8(state, Address::new(cell, self.env.host.cell_state));
        masm.branch32(Cond::BelowEq, state, threshold, start);
        self.tables.barriers.push(Barrier {
            start,
            end: masm.here(),
            cell,
            temp: state,
        });
    }

    fn call_barrier(&self, masm: &mut MacroAssembler, barrier: &Barrier) {
        masm.bind(barrier.start);
        masm.move64(barrier.temp, SLOT);
        masm.move64(SLOT, barrier.cell);
        masm.call_address(self.env.stubs.write_barrier);
        masm.move64(SLOT, barrier.temp);
        masm.jump(barrier.end);
    }
}

impl Emitter<'_> {
    fn note_slow_allocation(
        &mut self,
        masm: &mut MacroAssembler,
        start: Label,
        ty: TypeIndex,
        contents: Contents,
        site: &PatchpointSite<'_>,
    ) {
        let lost_vectors = site.live_vectors & abi::CALLEE_SAVED_LOW_HALF;
        self.tables.allocations.push(SlowAllocation {
            start,
            end: masm.here(),
            ty,
            contents,
            cell: site.results[0].gpr(),
            saved: site.live_registers & abi::CALLER_SAVED | lost_vectors,
            vector_bytes: if site.live_vectors.is_empty() { 8 } else { 16 },
            origin: site.origin,
        });
    }

    fn new_object(
        &mut self,
        masm: &mut MacroAssembler,
        ty: TypeIndex,
        (allocator, cell_size): (i32, u32),
        length: Option<u32>,
        site: &PatchpointSite<'_>,
    ) {
        let (cell, slow) = (site.results[0].gpr(), masm.new_label());
        let (first, temp) = (site.scratch_gprs[0], site.scratch_gprs[1]);
        let class = (allocator, cell_size);
        allocation::take_cell(masm, self.env, class, cell, [first, temp], slow);
        let length = length.map(RegOrImm::from);
        lend(masm, first);
        allocation::write_header(masm, self.env, ty, cell, temp, length);
        let contents = length.map_or(Contents::Fields, |length| Contents::Defaults { length });
        self.note_slow_allocation(masm, slow, ty, contents, site);
    }

    fn new_filled_array(
        &mut self,
        masm: &mut MacroAssembler,
        ty: TypeIndex,
        site: &PatchpointSite<'_>,
    ) {
        let (cell, slow) = (site.results[0].gpr(), masm.new_label());
        let (length, pattern) = (site.operands[0].gpr(), site.operands[1].fpr());
        let [end, allocator, temp] = *site.scratch_gprs else {
            unreachable!("it asks for three")
        };
        let (operands, temps) = ((length, pattern), [end, allocator, temp]);
        allocation::new_filled_array(masm, self.env, ty, cell, operands, temps, slow);
        let contents = match site.operands.get(2) {
            Some(bits) => Contents::Copies {
                length,
                bits: bits.gpr(),
            },
            None => Contents::Defaults {
                length: length.into(),
            },
        };
        self.note_slow_allocation(masm, slow, ty, contents, site);
    }

    fn allocate_slowly(&mut self, masm: &mut MacroAssembler, slow: &SlowAllocation) {
        let (stack_pointer, [_, ty, second, third, fourth, ..]) =
            (abi::STACK_POINTER, abi::ARGUMENT_GPRS);
        let (header, saved) = (
            Address::new(stack_pointer, 0),
            Address::new(stack_pointer, frame::ARGUMENTS - frame::INSTANCE),
        );
        let count = |bank| slow.saved.in_bank(bank).len() as i32;
        let size = saved.offset() + count(Bank::Gpr) * 8 + count(Bank::Fpr) * slow.vector_bytes;
        let size = (size as u32).next_multiple_of(16);
        masm.bind(slow.start);
        masm.sub64(stack_pointer, stack_pointer, size);
        masm.store_registers(slow.saved, slow.vector_bytes, saved);
        let operation = match slow.contents {
            Contents::Fields => Operation::StructNew,
            Contents::Defaults { length } => {
                masm.move64(second, length);
                Operation::ArrayNewDefault
            }
            Contents::Copies { length, bits } => {
                masm.store_pair64(header, bits, length);
                masm.load_pair64(second, fourth, header);
                masm.move32(third, 0);
                Operation::ArrayNew
            }
        };
        masm.move32(ty, slow.ty.0);
        masm.call_address(self.env.stubs.operations[operation as usize]);
        let address = masm.mark();
        self.note_return(address, None, slow.origin);
        masm.move64(slow.cell, abi::RETURN_GPRS[0]);
        masm.load_registers(slow.saved, slow.vector_bytes, saved);
        masm.add64(stack_pointer, stack_pointer, size);
        masm.jump(slow.end);
    }
}

/// For the rest of the patchpoint, where the macro assembler has no scratch register of its own.
fn lend(masm: &mut MacroAssembler, temp: Gpr) {
    let mut scratch = masm.scratch();
    scratch.gprs[0].get_or_insert(temp);
    masm.set_scratch(scratch);
}

impl Client<MacroAssembler> for Emitter<'_> {
    fn prologue(&mut self, masm: &mut MacroAssembler, _: usize, frame: &Frame) {
        let (stack_pointer, bottom) = (abi::STACK_POINTER, in_frame(-(frame.size as i32)));
        masm.bind(self.entry);
        if self.takes_over_frame {
            return masm.compute_address(stack_pointer, bottom);
        }
        masm.enter_frame();
        let callee = callee_word(self.env.module.func_index(self.code));
        if cfg!(target_arch = "x86_64") {
            masm.store64(in_frame(frame::INSTANCE), INSTANCE);
            masm.store64(in_frame(frame::CALLEE), callee);
        } else {
            masm.move32(SLOT, callee);
            masm.store_pair64(in_frame(frame::INSTANCE), INSTANCE, SLOT);
        }
        let bottom = match frame.size <= UNCHECKED_STACK_EXTENSION {
            true => stack_pointer,
            false => SLOT,
        };
        if frame.size != 0 {
            masm.sub64(bottom, stack_pointer, frame.size);
        }
        if self.sites.makes_calls || frame.size > UNCHECKED_FRAME_SIZE {
            let limit = Address::new(INSTANCE, InstanceLayout::entry_limit(self.env.host));
            let start = masm.new_label();
            masm.branch64(Cond::Lt, bottom, limit, start);
            self.entry_check = Some((start, masm.here()));
        }
        masm.move64(stack_pointer, bottom);
    }

    fn shared_exit(&mut self, masm: &mut MacroAssembler, token: Token) -> Option<Label> {
        Some(self.trap_label(masm, token))
    }

    fn exit(&mut self, _: &mut MacroAssembler, _: &ExitSite<'_>) {
        unreachable!("all exits are shared")
    }

    fn patchpoint(&mut self, masm: &mut MacroAssembler, site: &PatchpointSite<'_>) {
        match self.sites.sites[site.token.0 as usize] {
            Site::Nothing => {}
            Site::Trap(trap) => self.call_trap(masm, trap, site.origin),
            Site::Truncate { from, sign, to } => {
                let token = Sites::exit_token(Trap::TruncationOutOfRange, site.origin);
                let failure = self.trap_label(masm, token);
                let (dst, src) = (site.results[0].gpr(), site.operands[0].fpr());
                if let [temp] = *site.scratch_gprs {
                    lend(masm, temp);
                }
                masm.truncate_float_or_branch(from, sign, to, dst, src, failure);
            }
            Site::WriteBarrier => self.write_barrier(masm, site),
            Site::Publish => {
                let done = masm.new_label();
                masm.branch_if_zero32(site.operands[0].gpr(), done);
                masm.store_fence();
                masm.bind(done);
            }
            Site::Poll => {
                let limit = Address::new(INSTANCE, InstanceLayout::entry_limit(self.env.host));
                let start = masm.new_label();
                masm.branch64(Cond::Lt, abi::FRAME_POINTER, limit, start);
                self.tables.polls.push((start, masm.here(), site.origin));
            }
            Site::New {
                ty,
                allocator,
                cell_size,
                length,
            } => self.new_object(masm, ty, (allocator, cell_size), length, site),
            Site::NewFilled(ty) => self.new_filled_array(masm, ty, site),
            Site::Call { callee, .. } => self.call(masm, callee, site),
            Site::Throw(_) => unreachable!("the back end calls"),
            Site::TailCall(callee, ty) => self.tail_call(masm, callee, ty, site),
        }
    }

    fn after_call(&mut self, masm: &mut MacroAssembler, site: &CallEnd<'_>) {
        let scope = match self.sites.sites[site.token.0 as usize] {
            Site::Call { scope, .. } | Site::Throw(scope) => scope,
            _ => Scope::NONE,
        };
        let handler = site.handlers.first().map(|&label| (scope, label));
        self.note_return(site.return_address, handler, site.origin);
        let (own, loads_base) = (in_frame(frame::INSTANCE), pins_memory_base(self.env));
        match self.sites.sites[site.token.0 as usize] {
            Site::Call {
                callee: Callee::Import(_),
                ..
            } => {
                masm.load64(INSTANCE, own);
                if loads_base {
                    self.load_memory_base(masm);
                }
            }
            Site::Call {
                may_leave_instance: true,
                ..
            } => self.switch_instance(masm, own, loads_base),
            _ => {}
        }
    }

    fn out_of_line(&mut self, masm: &mut MacroAssembler) {
        for barrier in &self.tables.barriers {
            self.call_barrier(masm, barrier);
        }
        for switch in &self.tables.switches {
            masm.bind(switch.start);
            masm.load64(INSTANCE, switch.to);
            if switch.loads_base {
                self.load_memory_base(masm);
            }
            masm.jump(switch.end);
        }
        for index in 0..self.tables.allocations.len() {
            let slow = self.tables.allocations[index];
            self.allocate_slowly(masm, &slow);
        }
        for index in 0..self.tables.polls.len() {
            let (start, end, origin) = self.tables.polls[index];
            masm.bind(start);
            masm.call_address(self.env.stubs.poll);
            let address = masm.mark();
            self.note_return(address, None, origin);
            masm.jump(end);
        }
        if let Some((start, end)) = self.entry_check {
            masm.bind(start);
            masm.call_address(self.env.stubs.check_entry);
            let address = masm.mark();
            self.note_return(address, None, Origin::default());
            masm.jump(end);
        }
        for &(callee, label) in &self.tables.thunks {
            masm.bind(label);
            masm.move64(SLOT, self.env.slots + callee.usize() * FunctionSlot::SIZE);
            masm.jump_indirect(Address::new(SLOT, FunctionSlot::ENTRY));
        }
        for token in 0..self.tables.traps.len() {
            if let Some(label) = self.tables.traps[token] {
                masm.bind(label);
                let origin = Origin((token / Trap::COUNT) as u32);
                self.call_trap(masm, Trap::ALL[token % Trap::COUNT], origin);
            }
        }
    }
}
