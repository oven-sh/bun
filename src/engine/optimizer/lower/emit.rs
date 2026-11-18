//! The machine code that the back end leaves to its client, and the tables that describe the result.

mod search;

use core::ops::Range;

use bun_engine_asm::Code;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::Specialization;
use bun_engine_codegen::ir::{Function, Location, Origin, Token};
use bun_engine_codegen::{Client, Compiled, ExitSite, Frame, PatchpointSite, Seed, StateLocations};
use bun_engine_vm::heap::{Allocator, Heap};
use bun_engine_vm::{
    CallFrame, CellType, CodeBlock, Executable, FastHashMap, Forbidden, JsCell, JsFunction, Value,
    Vm, call,
};

use search::Searching;

use super::output::{
    CallSite, Description, ExitRecord, Held, InvalidationPoint, Output, Place, PlacedState,
};
use crate::graph::probes::{Probe, is_wanted};
use crate::graph::{Entry, ExitInfo, Format, Graph, NO_LAYOUT, Shapes};
use crate::runtime::Thunks;
use crate::runtime::operations::THREW;
use crate::runtime::registers::*;
use crate::runtime::varargs::Form;

/// How a function of the run time tells that an exception is pending.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Threw {
    Never,
    IfZero,
    /// If the 32 bits that it returns are `THREW`.
    IfMarked,
    /// What it returns does not tell.
    IfPending,
    /// The code goes on, to an exit.
    Unnoticed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Callee {
    /// The executable is in its register.
    Known,
    Native(Native),
    Function,
    Anything,
}

/// Addresses.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Native {
    pub(super) function: usize,
    pub(super) realm: usize,
}

#[derive(Clone, Copy)]
pub(super) struct Call {
    pub(super) origin: Origin,
    pub(super) callee: Callee,
    pub(super) specialization: Specialization,
    /// With `this`.
    pub(super) count: u32,
}

/// What a patchpoint is for. The tokens are those of exits.
#[derive(Clone, Copy)]
pub(super) enum Site {
    Nothing,
    Probe(Probe),
    InvalidationPoint(Token),
    PollTraps(Token),
    CountTurn,
    /// These ask for better code for as long as the counter has run out.
    TierUpAtReturn,
    TierUpInLoop(Token),
    Barrier,
    /// The distance of the allocator from the `Vm`, and the size of its cells.
    Allocate(i32, u32),
    /// The operand is the address of the allocator.
    AllocateFrom,
    /// Stores the word to the elements from one odd index to another.
    FillPairs(u64, u32, u32),
    /// From index 1 to the second operand, which is odd and greater.
    FillPairsBelow(u64),
    /// Address, and a number of words that is even and not zero.
    ClearPairs,
    /// Target, source and number.
    CopyWords,
    /// Storage, first index, end and word.
    FillWords,
    /// As the node.
    FindWord,
    TruncateDouble,
    /// With a position in `Graph::searches`. These give zero if there is more to it than a slot.
    SearchAndLoad(u32),
    SearchForStore(u32),
    Operation(Origin, Threw),
    /// A call of the code of a pattern, whose `RegExp` is in `PATTERN`.
    Search(Origin),
    /// Of an access through a cache, with its address.
    SecondStep(Origin, usize),
    Call(Call),
    TailCall(Call),
    /// With a position in `Graph::wasm_calls`.
    CallWasm(Origin, u32),
    /// Whether it is a tail call.
    CallVarargs(Origin, Form, bool),
}

/// What happens out of the way, between two labels.
#[derive(Clone, Copy)]
enum Cold {
    Exit(ExitInfo, PlacedState),
    /// A thunk that keeps the registers, with what it takes and where its result goes.
    Keeping(usize, Argument, Option<Gpr>),
    Search(Searching),
    /// The slot is not the usual one.
    LoadFound(Searching),
    /// An exit that may come back.
    TierUp(ExitInfo, PlacedState),
    FindTarget(Specialization),
    PadArguments,
    Interrupted,
}

#[derive(Default)]
pub(super) struct Tables {
    exits: Vec<(Label, ExitInfo, PlacedState)>,
    call_sites: Vec<CallSite>,
    held: Vec<Held>,
    constants: Vec<u64>,
    constant_positions: hashbrown::HashMap<u64, u32, Seed>,
    /// By the keys of the locations.
    placed: FastHashMap<u32, PlacedState>,
    invalidation_points: Vec<(Label, Label)>,
    cold: Vec<(Range<Label>, Cold)>,
    probes: Vec<Probe>,
}

impl Tables {
    fn constant(&mut self, bits: u64) -> Place {
        Place::Constant(*self.constant_positions.entry(bits).or_insert_with(|| {
            self.constants.push(bits);
            self.constants.len() as u32 - 1
        }))
    }

    fn place_of(&mut self, location: Location) -> Place {
        match location {
            Location::Gpr(reg) => Place::Gpr(reg.number()),
            Location::Fpr(reg) => Place::Fpr(reg.number()),
            Location::Frame(offset) => Place::Frame(offset),
            Location::Constant(bits) => self.constant(bits.get()),
            Location::Displaced(abi::NUMBER_TAG, by) => {
                self.constant(Value::NUMBER_TAG.wrapping_add_signed(by.into()))
            }
            Location::Displaced(abi::NOT_CELL_MASK, by) => {
                self.constant(Value::NOT_CELL_MASK.wrapping_add_signed(by.into()))
            }
            Location::Displaced(..) | Location::VectorConstant(_) => {
                unreachable!("no value of the language")
            }
        }
    }

    fn place(&mut self, function: &Function, locations: StateLocations<'_>) -> PlacedState {
        let (state, first) = (locations.state(), self.held.len() as u32);
        if state.is_none() {
            let layout = NO_LAYOUT;
            return PlacedState { layout, first };
        }
        let layout = function.state_layout(state);
        let placed = PlacedState { layout, first };
        if locations.is_empty() {
            return placed;
        }
        if let Some(&known) = self.placed.get(&locations.key()) {
            return known;
        }
        for (location, &tag) in locations.iter().zip(function.state_tags(state)) {
            let place = self.place_of(location);
            self.held.push(Held::new(place, Format::from_tag(tag)));
        }
        self.placed.insert(locations.key(), placed);
        placed
    }

    pub(super) fn finish(&mut self, code: Code, compiled: &Compiled, graph: Graph) -> Output {
        let at = |label| code.offset_of(label);
        let record = |(end, info, state)| ExitRecord {
            return_offset: at(end),
            info,
            state,
        };
        let mut exits: Box<[ExitRecord]> = self.exits.drain(..).map(record).collect();
        exits.sort_unstable_by_key(|exit| exit.return_offset);
        let point = |(point, exit)| InvalidationPoint {
            offset: at(point),
            target: at(exit),
        };
        let is_probed = !self.probes.is_empty();
        let tables = Description {
            frame_size: compiled.frame.size,
            writes_profiles: graph.writes_profiles,
            exits,
            call_sites: self.call_sites.as_slice().into(),
            held: self.held.as_slice().into(),
            constants: self.constants.as_slice().into(),
            invalidation_points: self.invalidation_points.drain(..).map(point).collect(),
            frames: graph.frames.into(),
            layouts: graph.layouts.into(),
            layout_registers: graph.layout_registers.into(),
            recipes: graph.recipes.into(),
            positions: graph.sites.iter().map(|site| site.position).collect(),
            origins: (compiled.emitted.origins.iter())
                .map(|&(start, origin)| (at(start), origin))
                .collect(),
            probes: self.probes.drain(..).collect(),
            shapes: if is_probed {
                graph.shapes
            } else {
                Shapes::default()
            },
            intrinsics: (graph.sites.iter().filter(|_| is_probed))
                .map(|site| site.intrinsic)
                .collect(),
        };
        Output {
            entry: at(compiled.emitted.entries[0]),
            code,
            tables,
            assumptions: graph.assumptions,
        }
    }
}

pub(super) struct Emitter<'a> {
    pub(super) graph: &'a Graph,
    pub(super) thunks: &'a Thunks,
    sites: &'a [Site],
    pub(super) forbidden: &'a [Forbidden],
    tables: &'a mut Tables,
    frame_size: u32,
    interrupted: Option<Label>,
}

const STACK_LIMIT: Address = at(VM, Vm::OFFSET_OF_STACK_LIMIT);
const ARGUMENT_COUNT: Address = at(FP, CallFrame::OFFSET_OF_ARGUMENT_COUNT);
const RUNNING_REGEXP: Address = at(VM, Vm::OFFSET_OF_RUNNING_REGEXP);
/// The code takes no argument there.
pub(super) const PATTERN: Gpr = abi::ARGUMENT_GPRS[5];

fn in_heap(field: &str) -> Address {
    at(VM, Vm::OFFSET_OF_HEAP + Heap::offset_of_field(field))
}

impl<'a> Emitter<'a> {
    pub(super) fn new(
        graph: &'a Graph,
        thunks: &'a Thunks,
        sites: &'a [Site],
        forbidden: &'a [Forbidden],
        tables: &'a mut Tables,
    ) -> Self {
        tables.exits.clear();
        tables.call_sites.clear();
        tables.held.clear();
        tables.constants.clear();
        tables.constant_positions.clear();
        tables.placed.clear();
        tables.invalidation_points.clear();
        tables.cold.clear();
        tables.probes.clear();
        Self {
            graph,
            thunks,
            sites,
            forbidden,
            tables,
            frame_size: 0,
            interrupted: None,
        }
    }

    /// The labels where it starts and where it comes back to, which the caller binds.
    fn cold(&mut self, m: &mut MacroAssembler, cold: Cold) -> Range<Label> {
        let labels = m.new_label()..m.new_label();
        self.tables.cold.push((labels.clone(), cold));
        labels
    }

    fn cold_exit(
        &mut self,
        m: &mut MacroAssembler,
        site: &PatchpointSite<'_>,
        exit: Token,
    ) -> Label {
        let state = self.tables.place(site.function, site.state);
        let info = self.graph.exits[exit.0 as usize];
        self.cold(m, Cold::Exit(info, state)).start
    }

    pub(super) fn number_for(&mut self, probe: Probe) -> i32 {
        self.tables.probes.push(probe);
        self.tables.probes.len() as i32 - 1
    }

    /// Of a function of a script, which has left the stack pointer anywhere.
    fn after_script(&mut self, m: &mut MacroAssembler) {
        if is_wanted(|it| it.operation_to_throw != 0) {
            m.compute_address(SP, Address::new(FP, -(self.frame_size as i32)));
        }
        self.probe_return(m, true);
    }

    fn emit_exit(&mut self, m: &mut MacroAssembler, info: ExitInfo, state: PlacedState) {
        m.call_address(self.thunks.exit);
        self.tables.exits.push((m.mark(), info, state));
    }

    fn store_call_site(&mut self, m: &mut MacroAssembler, origin: Origin, state: PlacedState) {
        self.tables.call_sites.push(CallSite { origin, state });
        let number = self.tables.call_sites.len() as i32;
        m.store32(at(FP, CallFrame::OFFSET_OF_CALL_SITE), number);
    }

    fn counter(m: &mut MacroAssembler, temp: Gpr) -> Address {
        m.load64(temp, at(FP, CallFrame::OFFSET_OF_CODE_BLOCK));
        at(temp, CodeBlock::OFFSET_OF_EXECUTION_COUNTER)
    }

    fn count(m: &mut MacroAssembler, weight: i32, temp: Gpr, has_run_out: Label) {
        let counter = Self::counter(m, temp);
        m.branch_add32_to_memory(ResultCond::NonNegative, counter, weight, has_run_out);
    }

    fn allocate(
        &mut self,
        m: &mut MacroAssembler,
        allocator: Address,
        size: Option<u32>,
        [cell, temp]: [Gpr; 2],
    ) {
        let slow = Cold::Keeping(
            self.thunks.allocate,
            Argument::AddressOf(allocator),
            Some(cell),
        );
        let slow = self.cold(m, slow);
        let field = |offset: usize| allocator.plus(offset as i32);
        m.load64(cell, field(Allocator::OFFSET_OF_START));
        m.branch64(
            Cond::AboveEq,
            cell,
            field(Allocator::OFFSET_OF_END),
            slow.start,
        );
        match size {
            Some(size) => m.add64(temp, cell, size),
            None => {
                m.load32(temp, field(Allocator::OFFSET_OF_CELL_SIZE));
                m.add64(temp, temp, cell);
            }
        }
        m.store64(field(Allocator::OFFSET_OF_START), temp);
        m.bind(slow.end);
    }

    fn barrier(&mut self, m: &mut MacroAssembler, owner: Gpr, temp: Gpr) {
        let slow = self.cold(m, Cold::Keeping(self.thunks.remember, owner.into(), None));
        m.load8(temp, at(owner, JsCell::OFFSET_OF_STATE));
        let threshold = in_heap("barrier_threshold");
        m.branch32(Cond::BelowEq, temp, threshold, slow.start);
        m.bind(slow.end);
    }

    /// Completes the header, and leaves the entry in its register. All registers that are not pinned are free.
    fn prepare_call(&mut self, m: &mut MacroAssembler, site: &PatchpointSite<'_>, call: Call) {
        let state = self.tables.place(site.function, site.state);
        self.store_call_site(m, call.origin, state);
        m.store64(new_frame(CallFrame::OFFSET_OF_ARGUMENT_COUNT), call.count);
        if let Callee::Native(_) = call.callee {
            return m.store64(new_frame(CallFrame::OFFSET_OF_CODE_BLOCK), 0);
        }
        let mut found = None;
        if call.callee == Callee::Anything {
            let other = self.cold(m, Cold::FindTarget(call.specialization));
            let (first, last) = (CellType::FUNCTIONS.first.0, CellType::FUNCTIONS.last.0);
            m.branch_if_not_cell(CALLEE, other.start);
            m.load8(ENTRY, at(CALLEE, JsCell::OFFSET_OF_TYPE));
            m.sub32(ENTRY, ENTRY, i32::from(first));
            m.branch32(Cond::Above, ENTRY, i32::from(last - first), other.start);
            found = Some(other.end);
        }
        if call.callee != Callee::Known {
            m.load64(EXECUTABLE, at(CALLEE, JsFunction::OFFSET_OF_EXECUTABLE));
        }
        let code_block = Executable::offset_of_code_block(call.specialization);
        m.load64(ENTRY, at(EXECUTABLE, code_block));
        m.store64(new_frame(CallFrame::OFFSET_OF_CODE_BLOCK), ENTRY);
        m.load64(
            ENTRY,
            at(EXECUTABLE, Executable::offset_of_entry(call.specialization)),
        );
        found.inspect(|&found| m.bind(found));
    }

    /// With both pointers at the frame of the function.
    fn enter_native(m: &mut MacroAssembler, native: Native) {
        m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        m.move64(abi::ARGUMENT_GPRS[0], native.realm);
        m.move64(abi::ARGUMENT_GPRS[1], FP);
        m.call_address(native.function);
    }

    fn take_native_result(m: &mut MacroAssembler) {
        let [result, undefined] = abi::RETURN_GPRS;
        let throw = m.external_address(call::throw_from_frame());
        m.branch64(Cond::Ne, at(VM, Vm::OFFSET_OF_EXCEPTION), 0, throw);
        m.move64(undefined, Value::UNDEFINED.to_bits());
        m.select_test64(TestCond::Zero, result, result, -1, undefined, result);
    }

    fn call(m: &mut MacroAssembler, callee: Callee) {
        let Callee::Native(native) = callee else {
            return m.call_indirect(ENTRY);
        };
        let returned = m.new_label();
        m.move_label_address(ENTRY, returned);
        m.push_pair(FP, ENTRY);
        m.move64(FP, SP);
        Self::enter_native(m, native);
        m.bind(returned);
        m.load64(FP, at(FP, CallFrame::OFFSET_OF_CALLER));
        Self::take_native_result(m);
    }

    /// With the frame pointer at the frame that has taken the place of this one. A native function comes back to this
    /// code, whose owner is in place of the entry and has to stay on the stack.
    fn tail_call(m: &mut MacroAssembler, callee: Callee) {
        let Callee::Native(native) = callee else {
            m.leave_frame();
            return m.jump_indirect(ENTRY);
        };
        m.move64(SP, FP);
        m.push_pair(ENTRY, ENTRY);
        Self::enter_native(m, native);
        Self::take_native_result(m);
        m.leave_frame();
        m.ret();
    }

    /// Moves the new frame to where this one ends.
    fn replace_frame(&mut self, m: &mut MacroAssembler, count: u32) {
        let [words, target, caller, return_address] = TEMPORARIES;
        let (parameters, header) = (
            self.graph.frames[0].parameters,
            CallFrame::HEADER_WORDS as u32,
        );
        m.load32(words, ARGUMENT_COUNT);
        if parameters > 1 {
            m.move32(target, parameters);
            m.select32(Cond::Below, words, words, target, target, words);
        }
        m.add32(words, words, header + 1);
        m.and32(words, words, -2);
        let distance = (header + count).next_multiple_of(2) as i32 * -8;
        m.compute_address(target, Address::indexed(FP, words, Scale::Eight, distance));
        m.load_pair64(caller, return_address, at(FP, 0));
        for offset in (CallFrame::LINKAGE_SIZE..(header + count) as usize * 8)
            .step_by(8)
            .rev()
        {
            m.load64(words, new_frame(offset));
            m.store64(at(target, offset), words);
        }
        m.store_pair64(at(target, 0), caller, return_address);
        m.move64(FP, target);
    }

    fn call_keeping(m: &mut MacroAssembler, thunk: usize, argument: Argument, result: Option<Gpr>) {
        m.compute_address(SP, Address::new(SP, -16));
        let temp = || result.expect("a register that is free");
        match argument {
            Argument::Gpr(gpr) => m.store64(at(SP, 0), gpr),
            Argument::Fpr(fpr) => m.store_f64(at(SP, 0), fpr),
            Argument::Imm(value) => m.store64(at(SP, 0), value as i32),
            Argument::AddressOf(address) => {
                m.compute_address(temp(), address);
                m.store64(at(SP, 0), temp());
            }
            _ => unreachable!("is not loaded"),
        }
        m.call_address(thunk);
        result.inspect(|&result| m.load64(result, at(SP, 0)));
        m.compute_address(SP, at(SP, 16));
    }

    fn interrupted(&mut self, m: &mut MacroAssembler) -> Label {
        match self.interrupted {
            Some(label) => label,
            None => {
                let label = self.cold(m, Cold::Interrupted).start;
                *self.interrupted.insert(label)
            }
        }
    }

    fn emit_cold(&mut self, m: &mut MacroAssembler, cold: Cold, back: Label) {
        match cold {
            Cold::Exit(info, state) => return self.emit_exit(m, info, state),
            Cold::Keeping(thunk, argument, result) => {
                Self::call_keeping(m, thunk, argument, result)
            }
            Cold::Search(searching) => searching.call_thunk(m),
            Cold::LoadFound(searching) => searching.load_found(m),
            Cold::TierUp(info, state) => self.emit_exit(m, info, state),
            Cold::FindTarget(specialization) => {
                m.call_address(self.thunks.find_target[specialization as usize]);
            }
            Cold::PadArguments => {
                let parameters = self.graph.frames[0].parameters;
                let needed = (self.frame_size + parameters * 8) as i32;
                let interrupted = self.interrupted(m);
                m.compute_address(CALLEE, Address::new(FP, -needed));
                m.branch64(Cond::Lt, CALLEE, STACK_LIMIT, interrupted);
                m.move32(abi::ARGUMENT_GPRS[0], parameters);
                m.call_address(call::pad_arguments());
            }
            Cold::Interrupted => {
                m.move64(CALLEE, self.graph.frames[0].code_block);
                m.store64(at(FP, CallFrame::OFFSET_OF_CODE_BLOCK), CALLEE);
                m.leave_frame();
                return m.jump_address(bun_engine_interpreter::entry());
            }
        }
        m.jump(back);
    }
}

impl Client<MacroAssembler> for Emitter<'_> {
    fn prologue(&mut self, m: &mut MacroAssembler, _: usize, frame: &Frame) {
        self.frame_size = frame.size;
        let bottom = Address::new(FP, -(frame.size as i32));
        if self.graph.entry != Entry::Function {
            m.compute_address(SP, bottom);
            return Self::clobber_frame(m, self.graph.frames[0].frame_words * 8);
        }
        m.enter_frame();
        let parameters = self.graph.frames[0].parameters;
        if parameters > 1 {
            let pad = self.cold(m, Cold::PadArguments);
            m.branch32(Cond::Below, ARGUMENT_COUNT, parameters, pad.start);
            m.bind(pad.end);
        }
        let interrupted = self.interrupted(m);
        m.compute_address(CALLEE, bottom);
        m.branch64(Cond::Lt, CALLEE, STACK_LIMIT, interrupted);
        m.move64(SP, CALLEE);
        Self::clobber_frame(m, 0);
        if self.graph.writes_profiles {
            m.load64(CALLEE, at(FP, CallFrame::OFFSET_OF_CODE_BLOCK));
            self.barrier(m, CALLEE, ENTRY);
        }
    }

    fn shared_exit(&mut self, _: &mut MacroAssembler, _: Token) -> Option<Label> {
        None
    }

    fn exit(&mut self, m: &mut MacroAssembler, site: &ExitSite<'_>) {
        let state = self.tables.place(site.function, site.state);
        self.emit_exit(m, self.graph.exits[site.token.0 as usize], state);
    }

    fn after_check(&mut self, m: &mut MacroAssembler, token: Token, exit: Label) -> bool {
        self.probe_check(m, token, exit)
    }

    fn patchpoint(&mut self, m: &mut MacroAssembler, site: &PatchpointSite<'_>) {
        let temp = || site.scratch_gprs[0];
        match self.sites[site.token.0 as usize] {
            Site::Nothing | Site::Operation(..) | Site::Search(_) => {}
            Site::Probe(probe) => self.probe(m, probe, site.operands, None),
            Site::InvalidationPoint(token) => {
                let exit = self.cold_exit(m, site, token);
                self.probe_check(m, token, exit);
                let point = m.replaceable_point();
                self.tables.invalidation_points.push((point, exit));
            }
            Site::PollTraps(token) => {
                let exit = self.cold_exit(m, site, token);
                self.probe_check(m, token, exit);
                m.branch64(Cond::Below, FP, STACK_LIMIT, exit);
            }
            Site::CountTurn => {
                let counter = Self::counter(m, temp());
                m.add_to_memory(Size::S32, counter, 1);
            }
            Site::TierUpAtReturn => {
                let slow = self.cold(m, Cold::Keeping(self.thunks.tier_up, 0.into(), None));
                Self::count(m, CodeBlock::ENTRY_WEIGHT, temp(), slow.start);
                m.bind(slow.end);
            }
            Site::TierUpInLoop(exit) => {
                let state = self.tables.place(site.function, site.state);
                let slow = self.cold(m, Cold::TierUp(self.graph.exits[exit.0 as usize], state));
                Self::count(m, 1, temp(), slow.start);
                m.bind(slow.end);
            }
            Site::Barrier => self.barrier(m, site.operands[0].gpr(), temp()),
            Site::Allocate(allocator, size) => {
                let registers = [site.results[0].gpr(), temp()];
                self.allocate(m, Address::new(VM, allocator), Some(size), registers);
            }
            Site::AllocateFrom => {
                let registers = [site.results[0].gpr(), temp()];
                self.allocate(m, at(site.operands[0].gpr(), 0), None, registers);
            }
            Site::FillPairs(word, from, to) => {
                let (storage, pair) = (site.operands[0].gpr(), site.scratch_fprs[0]);
                m.move_vector_constant(pair, u128::from(word) << 64 | u128::from(word));
                for index in (from..to).step_by(2) {
                    m.store_vector(at(storage, index as usize * 8), pair);
                }
            }
            Site::FillPairsBelow(word) => {
                let [storage, end] = [0, 1].map(|it| site.operands[it].gpr());
                let pair = site.scratch_fprs[0];
                m.move_vector_constant(pair, u128::from(word) << 64 | u128::from(word));
                let next = m.here();
                m.sub32(end, end, 2);
                m.store_vector(Address::indexed(storage, end, Scale::Eight, 0), pair);
                m.branch32(Cond::Above, end, 1, next);
            }
            Site::ClearPairs => {
                let [first, end] = [0, 1].map(|it| site.operands[it].gpr());
                m.move_vector_constant(site.scratch_fprs[0], 0);
                let next = m.here();
                m.sub32(end, end, 2);
                let pair = Address::indexed(first, end, Scale::Eight, 0);
                m.store_vector(pair, site.scratch_fprs[0]);
                m.branch_if_not_zero32(end, next);
            }
            Site::FillWords => {
                let [storage, first, end, word] = [0, 1, 2, 3].map(|it| site.operands[it].gpr());
                let done = m.new_label();
                m.branch32(Cond::BelowEq, end, first, done);
                let next = m.here();
                m.sub32(end, end, 1);
                m.store64(Address::indexed(storage, end, Scale::Eight, 0), word);
                m.branch32(Cond::Above, end, first, next);
                m.bind(done);
            }
            Site::FindWord => {
                let [storage, start, end, word] = [0, 1, 2, 3].map(|it| site.operands[it].gpr());
                let (index, missing, done) = (site.results[0].gpr(), m.new_label(), m.new_label());
                m.move32(index, start);
                m.branch32(Cond::AboveEq, index, end, missing);
                let next = m.here();
                let element = Address::indexed(storage, index, Scale::Eight, 0);
                m.branch64(Cond::Eq, word, element, done);
                m.add32(index, index, 1);
                m.branch32(Cond::Below, index, end, next);
                m.bind(missing);
                m.move32(index, -1);
                m.bind(done);
            }
            Site::CopyWords => {
                let [target, source, count] = [0, 1, 2].map(|it| site.operands[it].gpr());
                let done = m.new_label();
                m.branch_if_zero32(count, done);
                let next = m.here();
                m.sub32(count, count, 1);
                m.load64(temp(), Address::indexed(source, count, Scale::Eight, 0));
                m.store64(Address::indexed(target, count, Scale::Eight, 0), temp());
                m.branch_if_not_zero32(count, next);
                m.bind(done);
            }
            Site::TruncateDouble => {
                let (result, number) = (site.results[0].gpr(), site.operands[0].fpr());
                let slow = Cold::Keeping(self.thunks.to_int32, number.into(), Some(result));
                let slow = self.cold(m, slow);
                m.truncate_f64_to_int32_modular(result, number, slow.start);
                m.bind(slow.end);
            }
            Site::SearchAndLoad(search) => self.search_and_load(m, site, search),
            Site::SearchForStore(search) => self.search_for_store(m, site, search),
            Site::SecondStep(origin, address) => {
                let state = self.tables.place(site.function, site.state);
                self.store_call_site(m, origin, state);
                m.call_address(address);
                self.after_script(m);
            }
            Site::Call(call) => {
                self.prepare_call(m, site, call);
                Self::call(m, call.callee);
                self.after_script(m);
            }
            Site::CallWasm(origin, call) => {
                let state = self.tables.place(site.function, site.state);
                self.store_call_site(m, origin, state);
                self.graph.wasm_calls[call as usize].emit(m);
                self.after_script(m);
            }
            Site::CallVarargs(origin, form, is_tail_call) => {
                let state = self.tables.place(site.function, site.state);
                self.store_call_site(m, origin, state);
                m.move64(FORM, form.0);
                if is_tail_call {
                    return m.jump_address(self.thunks.tail_call_varargs);
                }
                let filled = m.new_label();
                m.move_label_address(CONTINUATION, filled);
                m.jump_address(self.thunks.fill_varargs_frame);
                m.bind(filled);
                m.call_indirect(ENTRY);
                self.after_script(m);
            }
            Site::TailCall(call) => {
                self.prepare_call(m, site, call);
                if let Callee::Native(_) = call.callee {
                    m.load64(ENTRY, at(FP, CallFrame::OFFSET_OF_CODE_BLOCK));
                }
                self.replace_frame(m, call.count);
                Self::tail_call(m, call.callee);
            }
        }
    }

    fn before_call(&mut self, m: &mut MacroAssembler, token: Token, _: Origin) {
        self.forbid_what_is_not_expected(m, token);
        let (site, layout, first) = (self.sites[token.0 as usize], NO_LAYOUT, 0);
        match site {
            Site::Operation(_, Threw::Never) => {
                m.store32(at(FP, CallFrame::OFFSET_OF_CALL_SITE), 0);
            }
            Site::Operation(origin, _) | Site::Search(origin) => {
                self.store_call_site(m, origin, PlacedState { layout, first });
            }
            _ => return,
        }
        m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        if let Site::Search(_) = site {
            m.store64(RUNNING_REGEXP, PATTERN);
        }
    }

    fn after_call(&mut self, m: &mut MacroAssembler, site: &bun_engine_codegen::CallSite<'_>) {
        Self::allow_everything(m);
        let threw = match self.sites[site.token.0 as usize] {
            Site::Operation(_, Threw::Unnoticed) => return,
            Site::Search(_) => return m.store64(RUNNING_REGEXP, 0),
            Site::Operation(_, threw) if threw != Threw::Never => threw,
            _ => return self.probe_return(m, false),
        };
        let state = self.tables.place(site.function, site.state);
        let call_site = self.tables.call_sites.last_mut().expect("from before");
        call_site.state = state;
        let throw = m.external_address(call::throw_from_frame());
        match threw {
            Threw::IfZero => m.branch_if_zero64(abi::RETURN_GPRS[0], throw),
            Threw::IfMarked => m.branch32(Cond::Eq, abi::RETURN_GPRS[0], THREW, throw),
            _ => m.branch64(Cond::Ne, at(VM, Vm::OFFSET_OF_EXCEPTION), 0, throw),
        }
        self.probe_return(m, true);
    }

    fn after_patchpoint(&mut self, m: &mut MacroAssembler, dead: impl FnOnce() -> RegisterSet) {
        Self::clobber(m, dead);
    }

    fn out_of_line(&mut self, m: &mut MacroAssembler) {
        while let Some((labels, cold)) = self.tables.cold.pop() {
            m.bind(labels.start);
            self.emit_cold(m, cold, labels.end);
        }
    }
}
