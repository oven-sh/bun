//! Lays out the blocks and has the architecture emit their instructions.

use bun_engine_asm::{
    Address, Bank, FloatAssembly, Fpr, Gpr, Label, MacroAssembly, Reg, RegisterSet, Scratch,
};
use smallvec::SmallVec;

use super::allocate::{Allocation, Stored};
use super::code::{AT_HOME, Class, Code, Home, Operand, Registers, Role, Site, VReg};
use super::layout::{Layout, Piece};
use super::lower::Instruction;
use super::moves::{Move, MoveKind, Spot, SpotKind};
use crate::analysis::{Cfg, Frequencies};
use crate::client::{CallSite, Client, ExitSite, Frame, PatchpointSite};
use crate::ir::{
    Action, Bits64, Block, Edge, Function, Input, Location, Op, Origin, Output, PatchpointFlags,
    Span, State, Table, Type, Value,
};

pub(crate) trait Isa: Instruction {
    type Masm: FloatAssembly + MacroAssembly<Features = Self::Features>;

    /// What the flags are known to tell. The default is nothing.
    type Flags: Copy + Default;

    fn registers(function: &Function) -> Registers;
    fn is_jump(self) -> bool;
    /// Leaves the macro assembler the registers that are never allocated.
    fn prepare(masm: &mut Self::Masm);
    fn emit<C: Client<Self::Masm>>(
        emitter: &mut Emitter<'_, Self, C>,
        instruction: Self,
        operands: Operands<'_>,
    );
    fn emit_move(
        masm: &mut Self::Masm,
        function: &Function,
        frame: &Frame,
        from: Location,
        to: Location,
        class: Class,
    );
    fn flags_after_move(flags: Self::Flags, from: Location, to: Location) -> Self::Flags;
    /// For the code up to `end`.
    fn align(masm: &mut Self::Masm, purpose: Alignment, end: Label);
    fn scratch(bank: Bank) -> Location;
    /// Computes the operand that `instruction` has overwritten with its result.
    fn recover(masm: &mut Self::Masm, instruction: Self, operands: Operands<'_>);
    /// Lets the client use the usual scratch registers if they are among the clobbered. Returns what undoes it.
    fn lend_scratch(masm: &mut Self::Masm, clobbered: RegisterSet) -> Scratch;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Alignment {
    Loop,
    /// The padding is executed.
    LoopEnteredFromAbove,
    /// From the target of a jump to the next jump.
    Run,
}

/// Where values live, now that the frame is laid out.
#[derive(Clone, Copy)]
pub(crate) struct Places<'a> {
    pub(crate) function: &'a Function,
    pub(crate) code: &'a Code,
    pub(crate) allocation: &'a Allocation,
    pub(crate) spare_offset: i32,
}

impl<'a> Places<'a> {
    pub(crate) fn home(self, vreg: VReg) -> Location {
        match self.code.vregs[vreg].home {
            Home::Spill => Location::Frame(self.allocation.slots.offset(vreg)),
            Home::Incoming(offset) => Location::Frame(offset),
            Home::Displaced(reg, offset) => Location::Displaced(reg, offset),
            Home::Constant(value) => match *self.function.op(value) {
                Op::Pinned(reg) => Location::Gpr(reg),
                Op::ConstV128(constant) => Location::VectorConstant(constant),
                _ => Location::Constant(Bits64::new(self.function.constant_bits(value).unwrap())),
            },
        }
    }

    #[inline]
    pub(crate) fn location(self, vreg: VReg, assigned: u8) -> Location {
        if assigned == AT_HOME {
            self.home(vreg)
        } else {
            register(Reg::from_index(assigned.into()))
        }
    }

    pub(crate) fn spot<I: Isa>(self, spot: Spot, class: Class) -> Location {
        match spot.kind() {
            SpotKind::Register(reg) => register(reg),
            SpotKind::Home(vreg) => self.home(vreg),
            SpotKind::Scratch => I::scratch(class.bank()),
            SpotKind::Spare => Location::Frame(self.spare_offset),
        }
    }

    /// The moves of an edge to a block that nothing else reaches are at the start of that block.
    pub(crate) fn moves_at_source(self, cfg: &Cfg, edge: Edge) -> &'a [Move] {
        if cfg.predecessors(self.function.target(edge)).len() == 1 {
            &[]
        } else {
            self.allocation.moves_on(edge)
        }
    }

    pub(crate) fn moves_at_start(
        self,
        cfg: &Cfg,
        block: Block,
    ) -> impl Iterator<Item = Move> + use<'a> {
        let incoming = if let [only] = *cfg.predecessors(block) {
            self.allocation.moves_on(only)
        } else {
            &[]
        };
        let params = self
            .code
            .params(block)
            .iter()
            .filter(|param| !param.is_none());
        let stores = params
            .filter_map(move |&param| self.store(param, self.allocation.entry_register(param)));
        incoming.iter().copied().chain(stores)
    }

    #[inline]
    fn store(self, vreg: VReg, reg: u8) -> Option<Move> {
        (self.allocation.stored(vreg) == Stored::AtDefinition).then(|| {
            Move::new(
                Spot::register(reg),
                Spot::home(vreg),
                self.code.vregs[vreg].class,
            )
        })
    }

    #[inline]
    pub(crate) fn moves_after(
        self,
        operands: &'a [Operand],
    ) -> impl Iterator<Item = Move> + use<'a> {
        let results = operands
            .iter()
            .take_while(|operand| matches!(operand.role, Role::Def | Role::EarlyDef));
        results.filter_map(move |result| self.store(result.vreg, result.assigned()))
    }
}

#[inline]
fn register(reg: Reg) -> Location {
    match reg.bank() {
        Bank::Gpr => Location::Gpr(reg.gpr()),
        Bank::Fpr => Location::Fpr(reg.fpr()),
    }
}

/// Where the values of a state are at one place in the code.
#[derive(Clone, Copy)]
pub struct StateLocations<'a> {
    places: Places<'a>,
    state: State,
    vregs: Span<VReg>,
    assigned: Span<u8>,
}

impl<'a> StateLocations<'a> {
    pub fn state(self) -> State {
        self.state
    }

    pub fn len(self) -> usize {
        self.vregs.len()
    }

    pub fn is_empty(self) -> bool {
        self.vregs.is_empty()
    }

    /// Two that are not empty and have the same key are of the same state and have the same locations.
    pub fn key(self) -> u32 {
        self.assigned.range().start as u32
    }

    pub fn iter(self) -> impl ExactSizeIterator<Item = Location> + use<'a> {
        let Places {
            code, allocation, ..
        } = self.places;
        let pairs = code.vreg_lists[self.vregs]
            .iter()
            .zip(&allocation.state_assigned[self.assigned]);
        pairs.map(move |(&vreg, &assigned)| self.places.location(vreg, assigned))
    }
}

/// Hands out the operands of an instruction in the order in which lowering gave them.
#[derive(Clone)]
pub(crate) struct Operands<'a> {
    places: Places<'a>,
    rest: core::slice::Iter<'a, Operand>,
}

impl Operands<'_> {
    #[inline]
    pub(crate) fn assigned(&mut self) -> u8 {
        self.rest.next().unwrap().assigned()
    }

    #[inline]
    pub(crate) fn gpr(&mut self) -> Gpr {
        Gpr::new(self.assigned())
    }

    #[inline]
    pub(crate) fn fpr(&mut self) -> Fpr {
        Reg::from_index(self.assigned().into()).fpr()
    }

    #[inline]
    pub(crate) fn location(&mut self) -> Location {
        let operand = self.rest.next().unwrap();
        self.places.location(operand.vreg, operand.assigned())
    }

    pub(crate) fn skip(&mut self, count: usize) {
        self.rest.nth(count - 1);
    }

    /// Numbers that are the same for the same values, for the next two operands or as many as there are.
    pub(crate) fn identities(&self) -> [u32; 2] {
        let identity = |operand: &Operand| match operand.vreg.expand() {
            Some(vreg) => vreg.0,
            None => u32::MAX - 1 - u32::from(operand.assigned()),
        };
        [0, 1].map(|index| self.rest.as_slice().get(index).map_or(u32::MAX, identity))
    }

    pub(crate) fn class_of_next(&self) -> Class {
        self.places.code.vregs[self.rest.as_slice()[0].vreg].class
    }

    pub(crate) fn function(&self) -> &Function {
        self.places.function
    }

    pub(crate) fn any_is_in(&self, reg: Gpr) -> bool {
        self.rest
            .as_slice()
            .iter()
            .any(|operand| operand.assigned() == reg.number())
    }
}

#[derive(Default)]
pub(crate) struct EmissionTables<Flags> {
    layout: Layout,
    labels: Table<Block, Option<Label>>,
    /// Of the moves of an edge that is reached by a jump.
    edge_labels: Table<Edge, Option<Label>>,
    jump_tables: Table<Block, Option<Label>>,
    /// For blocks that have one predecessor.
    flags_at_start: Table<Block, Flags>,
    /// Edges whose moves go where control next does not fall through.
    detours: Vec<Edge>,
    cold_detours: Vec<Edge>,
    exits: Vec<(Label, u32)>,
    locations: Vec<Location>,
}

pub(crate) struct Emitter<'a, I: Isa, C> {
    pub(crate) masm: &'a mut I::Masm,
    pub(crate) places: Places<'a>,
    pub(crate) frame: &'a Frame,
    client: &'a mut C,
    cfg: &'a Cfg,
    frequencies: &'a Frequencies,
    instructions: &'a [I],
    tables: &'a mut EmissionTables<I::Flags>,
    origins: Option<&'a mut Vec<(Label, Origin)>>,
    block: Block,
    next: Piece,
    falls_through: bool,
    is_thorough: bool,
    position: u32,
    /// How many more instructions may be emitted again to save jumps.
    allowance: u32,
    copies_in_a_row: u32,
    pub(crate) flags: I::Flags,
}

pub struct Emitted {
    pub entries: Vec<Label>,
    /// The code from each label up to the next stems from the origin. Empty unless asked for.
    pub origins: Vec<(Label, Origin)>,
}

/// One edge of a branch is reached by a jump, and the code of the other follows.
pub(crate) struct Fork {
    pub(crate) label: Label,
    /// Jump if the condition does not hold.
    pub(crate) is_inverted: bool,
    other: Edge,
    /// The moves of the edge that is reached by the jump come right after.
    taken_comes_next: Edge,
}

/// Code that is aligned as a whole.
struct Stretch {
    /// Among the pieces of the layout.
    last: usize,
    ends_at_jump: bool,
    end: Label,
}

const NOTHING: Piece = Piece {
    approach: Edge::NONE,
    block: Block::NONE,
};
const LONGEST_COPY: u32 = 4;
const LONGEST_COPY_IN_LOOP: u32 = 8;
const MOST_COPIES_IN_A_ROW: u32 = 2;
const LONGEST_ALIGNED_LOOP: u32 = 40;
const LONGEST_ALIGNED_RUN: u32 = 16;
const LEAST_ALLOWANCE: u32 = 256;

pub(crate) fn emit<I: Isa, C: Client<I::Masm>>(
    places: Places<'_>,
    cfg: &Cfg,
    frequencies: &Frequencies,
    instructions: &[I],
    frame: &Frame,
    tables: &mut EmissionTables<I::Flags>,
    masm: &mut I::Masm,
    client: &mut C,
    records_origins: bool,
    is_thorough: bool,
) -> Emitted {
    let function = places.function;
    (tables.layout).compute(places, cfg, frequencies, instructions, is_thorough);
    tables.labels.refill(function.block_count(), None);
    tables.edge_labels.refill(function.edge_count(), None);
    tables.jump_tables.refill(function.block_count(), None);
    (tables.flags_at_start).refill(function.block_count(), I::Flags::default());
    tables.exits.clear();
    masm.reserve(instructions.len() * 6);
    let mut origins = Vec::new();
    let mut emitter = Emitter {
        masm,
        places,
        frame,
        client,
        cfg,
        frequencies,
        instructions,
        tables,
        origins: records_origins.then_some(&mut origins),
        block: Block::NONE,
        next: NOTHING,
        falls_through: false,
        is_thorough,
        position: 0,
        allowance: if is_thorough {
            LEAST_ALLOWANCE + instructions.len() as u32 / 4
        } else {
            0
        },
        copies_in_a_row: 0,
        flags: I::Flags::default(),
    };
    emitter.emit_blocks();
    let entries = function.entries().iter();
    Emitted {
        entries: entries.map(|entry| emitter.label(entry.block)).collect(),
        origins,
    }
}

impl<'a, I: Isa, C: Client<I::Masm>> Emitter<'a, I, C> {
    #[inline]
    fn destination(&self, edge: Edge) -> Block {
        (self.tables.layout).destination(self.places.function.target(edge))
    }

    fn label(&mut self, block: Block) -> Label {
        *self.tables.labels[block].get_or_insert_with(|| self.masm.new_label())
    }

    fn operands_at(&self, position: u32) -> &'a [Operand] {
        &self.places.code.operands[self.places.code.heads[position as usize].operands()]
    }

    fn cursor(&self, position: u32) -> Operands<'a> {
        Operands {
            places: self.places,
            rest: self.operands_at(position).iter(),
        }
    }

    #[inline]
    fn note(&mut self, origin: Origin) {
        if let Some(origins) = &mut self.origins
            && origins.last().is_none_or(|&(_, last)| last != origin)
        {
            origins.push((self.masm.mark(), origin));
        }
    }

    fn emit_blocks(&mut self) {
        let places = self.places;
        I::prepare(self.masm);
        let mut stretch = None;
        for index in 0..self.tables.layout.pieces.len() {
            let Piece { approach, block } = self.tables.layout.pieces[index];
            let next = self.tables.layout.pieces.get(index + 1);
            self.next = next.copied().unwrap_or(NOTHING);
            if stretch.is_none() {
                stretch = self.start_stretch(index);
            }
            if let Some(edge) = approach.expand() {
                let label = self.label_of_edge(edge);
                self.masm.bind(label);
                self.emit_moves_at_source(edge);
            }
            let label = self.label(block);
            self.masm.bind(label);
            if self.cfg.predecessors(block).is_empty() {
                self.note(places.code.heads[places.code.blocks[block].first as usize].origin);
                let mut entries = places.function.entries().iter();
                let entry = entries.position(|entry| entry.block == block).unwrap();
                self.client.prologue(self.masm, entry, self.frame);
            }
            self.falls_through = false;
            self.emit_block(block);
            if let Some(stretch) = stretch.take_if(|stretch| {
                stretch.last == index || stretch.ends_at_jump && !self.falls_through
            }) {
                self.masm.bind(stretch.end);
            }
            self.emit_detours();
        }
        while !self.tables.cold_detours.is_empty() {
            core::mem::swap(&mut self.tables.detours, &mut self.tables.cold_detours);
            self.emit_detours();
        }
        for index in 0..self.tables.exits.len() {
            let (label, position) = self.tables.exits[index];
            debug_assert!(!self.falls_through);
            self.masm.bind(label);
            let check = places.code.sites[self.site(position)].value;
            self.note(places.function.origin(check));
            self.emit_exit(position);
        }
        self.client.out_of_line(self.masm);
    }

    /// Aligns a small loop, or what a jump in a loop leads to.
    fn start_stretch(&mut self, first: usize) -> Option<Stretch> {
        let pieces = &self.tables.layout.pieces[first..];
        let (cfg, block) = (self.cfg, pieces[0].block);
        let around = cfg.loop_of(block).expand()?;
        if !self.is_thorough || self.frequencies.is_cold(block) {
            return None;
        }
        let count_within = |most: u32| {
            let lengths = pieces.iter().map(|piece| {
                let data = &self.places.code.blocks[piece.block];
                (cfg.loop_of(piece.block) == around).then_some(data.end - data.first)
            });
            let totals = lengths.scan(0, |total, length| {
                *total += length?;
                (*total <= most).then_some(())
            });
            totals.count()
        };
        let is_whole_loop = |count: usize| {
            cfg.loops()[around].header == block
                && count != 0
                && (pieces.get(count)).is_none_or(|next| !cfg.includes(around, next.block))
        };
        let mut count = count_within(LONGEST_ALIGNED_LOOP);
        let ends_at_jump = !is_whole_loop(count);
        if ends_at_jump {
            count = count_within(LONGEST_ALIGNED_RUN);
            if self.falls_through || count == 0 {
                return None;
            }
        }
        let end = self.masm.new_label();
        let purpose = match (ends_at_jump, self.falls_through) {
            (true, _) => Alignment::Run,
            (false, true) => Alignment::LoopEnteredFromAbove,
            (false, false) => Alignment::Loop,
        };
        I::align(self.masm, purpose, end);
        Some(Stretch {
            last: first + count - 1,
            ends_at_jump,
            end,
        })
    }

    fn emit_block(&mut self, block: Block) {
        let (places, moves) = (self.places, &self.places.allocation.moves);
        let data = places.code.blocks[block];
        self.block = block;
        self.flags = self.tables.flags_at_start[block];
        self.note(places.code.heads[data.first as usize].origin);
        places
            .moves_at_start(self.cfg, block)
            .for_each(|step| self.emit_move(step));
        let mut next_move = self.tables.layout.first_move(block);
        for position in data.first..data.end {
            self.position = position;
            self.note(places.code.heads[position as usize].origin);
            while let Some(&(before, step)) = moves.get(next_move)
                && before == position
            {
                self.emit_move(step);
                next_move += 1;
            }
            I::emit(
                self,
                self.instructions[position as usize],
                self.cursor(position),
            );
            places
                .moves_after(self.operands_at(position))
                .for_each(|step| self.emit_move(step));
        }
    }

    /// The last may fall through.
    fn emit_detours(&mut self) {
        let next = self.next;
        let leads_on = |&edge: &Edge| self.destination(edge) == next.block;
        if let Some(index) = self.tables.detours.iter().position(leads_on) {
            self.tables.detours.swap(0, index);
        }
        // A block that is repeated may add more, which wait if it falls through.
        while !self.falls_through
            && let Some(edge) = self.tables.detours.pop()
        {
            let is_last = self.tables.detours.is_empty();
            self.next = if is_last { next } else { NOTHING };
            let label = self.label_of_edge(edge);
            self.masm.bind(label);
            self.follow(edge);
        }
    }

    fn emit_move(&mut self, step: Move) {
        let (from, to) = (
            self.places.spot::<I>(step.from, step.class),
            self.places.spot::<I>(step.to, step.class),
        );
        self.flags = I::flags_after_move(self.flags, from, to);
        if step.kind == MoveKind::Swap {
            self.flags = I::flags_after_move(self.flags, to, from);
            self.masm.swap(from.gpr(), to.gpr());
        } else if from != to {
            I::emit_move(
                self.masm,
                self.places.function,
                self.frame,
                from,
                to,
                step.class,
            );
        }
    }

    // Control

    fn emit_moves_at_source(&mut self, edge: Edge) {
        for &step in self.places.moves_at_source(self.cfg, edge) {
            self.emit_move(step);
        }
    }

    fn is_approach(&self, edge: Edge) -> bool {
        (self.tables.layout).is_approach(edge, self.destination(edge))
    }

    /// The moves have no place of their own yet.
    fn has_moves_to_place(&self, edge: Edge) -> bool {
        !self.places.moves_at_source(self.cfg, edge).is_empty()
            && self.tables.edge_labels[edge].is_none()
            && !self.is_approach(edge)
    }

    fn is_next(&self, edge: Edge) -> bool {
        match self.next.approach.expand() {
            Some(approach) => approach == edge,
            None => self.destination(edge) == self.next.block,
        }
    }

    /// Does the moves of the edge and goes to its target.
    fn follow(&mut self, edge: Edge) {
        let is_approach = self.is_approach(edge);
        if !is_approach {
            self.emit_moves_at_source(edge);
        }
        let target = self.destination(edge);
        if self.is_next(edge) {
            self.falls_through = true;
        } else if is_approach {
            let label = self.label_of_edge(edge);
            self.masm.jump(label);
        } else if let Some(length) = self.length_of_worthwhile_copy(edge) {
            self.allowance -= length;
            self.copies_in_a_row += 1;
            self.emit_block(target);
            self.copies_in_a_row -= 1;
        } else {
            let label = self.label(target);
            self.masm.jump(label);
        }
    }

    /// Whether to repeat the code of the target instead of jumping to it.
    fn length_of_worthwhile_copy(&self, edge: Edge) -> Option<u32> {
        let Places { function, code, .. } = self.places;
        let (source, target) = (function.source(edge), self.destination(edge));
        let data = &code.blocks[target];
        let longest = if self.cfg.loop_of(source).is_none() {
            LONGEST_COPY
        } else {
            LONGEST_COPY_IN_LOOP
        };
        let longest = longest.min(self.allowance);
        if data.end - data.first > longest
            || self.copies_in_a_row == MOST_COPIES_IN_A_ROW
            || source == target
            || self
                .cfg
                .loop_headed_by(target)
                .is_some_and(|it| !self.cfg.includes(it, source))
            || function.is_rare(edge)
            || self.frequencies.is_cold(source)
            || !matches!(
                function.op(function.last(target)),
                Op::Branch(_) | Op::JumpTable(..) | Op::Return(_)
            )
        {
            return None;
        }
        let heads = &code.heads[data.first as usize..data.end as usize];
        let moves = &self.places.allocation.moves[self.tables.layout.first_move(target)..];
        let moves = moves.iter().take_while(|step| step.0 < data.end).count()
            + self.places.moves_at_start(self.cfg, target).count();
        let length = heads.len() as u32 + moves as u32;
        (length <= longest && heads.iter().all(|head| head.site.is_none())).then_some(length)
    }

    fn label_of_edge(&mut self, edge: Edge) -> Label {
        if self.places.moves_at_source(self.cfg, edge).is_empty() {
            return self.label(self.destination(edge));
        }
        if let Some(label) = self.tables.edge_labels[edge] {
            return label;
        }
        if !self.is_approach(edge) {
            let is_cold = self.places.function.is_rare(edge)
                || self.frequencies.is_cold(self.destination(edge))
                    && !self.frequencies.is_cold(self.block);
            let tables = &mut *self.tables;
            (if is_cold {
                &mut tables.cold_detours
            } else {
                &mut tables.detours
            })
            .push(edge);
        }
        *self.tables.edge_labels[edge].insert(self.masm.new_label())
    }

    fn pass_flags_on(&mut self, mut edge: Edge) {
        let function = self.places.function;
        loop {
            let target = function.target(edge);
            if self.cfg.predecessors(target).len() != 1 {
                return;
            }
            if self.tables.layout.destination(target) == target {
                self.tables.flags_at_start[target] = self.flags;
                return;
            }
            edge = function.successor(target, 0);
        }
    }

    pub(crate) fn jump(&mut self) {
        let edge = self.places.function.successor(self.block, 0);
        self.pass_flags_on(edge);
        self.follow(edge);
    }

    /// Follows what sets the flags.
    pub(crate) fn fork(&mut self) -> Fork {
        let function = self.places.function;
        let [then, or] = [0, 1].map(|position| function.successor(self.block, position));
        self.pass_flags_on(then);
        self.pass_flags_on(or);
        let then_is_likelier = self.frequencies.of_edge(then) >= self.frequencies.of_edge(or);
        let (likelier, other) = if then_is_likelier {
            (then, or)
        } else {
            (or, then)
        };
        let likelier_follows = self.is_next(likelier)
            || self.has_moves_to_place(likelier)
            || !self.is_next(other)
                && !self.has_moves_to_place(other)
                && self.length_of_worthwhile_copy(likelier).is_some();
        let then_follows = then_is_likelier == likelier_follows;
        let (taken, other) = if then_follows { (or, then) } else { (then, or) };
        let mut taken_comes_next = Edge::NONE;
        if self.is_next(taken) && !self.is_next(other) && self.has_moves_to_place(taken) {
            taken_comes_next = taken;
            self.tables.edge_labels[taken] = Some(self.masm.new_label());
        }
        Fork {
            label: self.label_of_edge(taken),
            is_inverted: then_follows,
            other,
            taken_comes_next,
        }
    }

    pub(crate) fn finish_fork(&mut self, fork: &Fork) {
        let Some(taken) = fork.taken_comes_next.expand() else {
            return self.follow(fork.other);
        };
        let next = core::mem::replace(&mut self.next, NOTHING);
        self.follow(fork.other);
        self.next = next;
        self.masm.bind(fork.label);
        self.follow(taken);
    }

    /// `make` gets the labels of the successors.
    pub(crate) fn jump_table(
        &mut self,
        make: impl FnOnce(&mut I::Masm, &[Label]) -> Label,
    ) -> Label {
        if let Some(table) = self.tables.jump_tables[self.block] {
            return table;
        }
        let function = self.places.function;
        let Op::JumpTable(_, cases) = *function.op(self.last_value()) else {
            unreachable!("ends with a jump through a table")
        };
        let edges = function.successors(self.block);
        let labels: SmallVec<[_; 16]> = edges.map(|edge| self.label_of_edge(edge)).collect();
        let cases = function.cases(cases).iter();
        let targets: SmallVec<[_; 16]> = cases.map(|&edge| labels[edge as usize]).collect();
        *self.tables.jump_tables[self.block].insert(make(self.masm, &targets))
    }

    pub(crate) fn last_value(&self) -> Value {
        self.places.function.last(self.block)
    }

    // The client

    fn site(&self, position: u32) -> Site {
        self.places.code.heads[position as usize].site
    }

    pub(crate) fn exit_label(&mut self) -> Label {
        let site = &self.places.code.sites[self.site(self.position)];
        let token = self.places.function.op(site.value).exit().unwrap().token;
        self.client
            .shared_exit(self.masm, token)
            .unwrap_or_else(|| {
                let label = self.masm.new_label();
                self.tables.exits.push((label, self.position));
                label
            })
    }

    pub(crate) fn finish_check(&mut self, exit: Label) {
        let site = &self.places.code.sites[self.site(self.position)];
        let token = self.places.function.op(site.value).exit().unwrap().token;
        if self.client.after_check(self.masm, token, exit) {
            self.flags = I::Flags::default();
        }
    }

    fn state_at(&self, site: Site) -> StateLocations<'a> {
        let data = &self.places.code.sites[site];
        StateLocations {
            places: self.places,
            state: data.state,
            vregs: data.state_vregs,
            assigned: data.state_assigned,
        }
    }

    fn emit_exit(&mut self, position: u32) {
        let site = self.site(position);
        let data = &self.places.code.sites[site];
        let operands = self.operands_at(position);
        let is_overwritten = |operand: &Operand| {
            operand.vreg == data.recoverable
                && operand.is_use()
                && operand.assigned() == operands[0].assigned()
        };
        if !data.recoverable.is_none() && operands.iter().any(is_overwritten) {
            I::recover(
                self.masm,
                self.instructions[position as usize],
                self.cursor(position),
            );
        }
        self.client.exit(
            self.masm,
            &ExitSite {
                function: self.places.function,
                frame: self.frame,
                token: self.places.function.op(data.value).exit().unwrap().token,
                origin: self.places.function.origin(data.value),
                state: self.state_at(site),
            },
        );
    }

    pub(crate) fn outgoing(&self, offset: i32) -> Location {
        Location::Frame(offset - self.frame.size as i32)
    }

    pub(crate) fn patchpoint(&mut self, mut operands: Operands<'_>) {
        let function = self.places.function;
        let site = self.site(self.position);
        let site_data = &self.places.code.sites[site];
        let Op::Patchpoint(patchpoint) = *function.op(site_data.value) else {
            unreachable!()
        };
        let data = function.patchpoint(patchpoint);
        let origin = self.places.code.heads[self.position as usize].origin;
        let (inputs, outputs) = (function.inputs(patchpoint), function.outputs(patchpoint));

        self.tables.locations.clear();
        for &(_, output) in outputs {
            let location = if let Output::Outgoing(offset) = output {
                self.outgoing(offset)
            } else {
                operands.location()
            };
            self.tables.locations.push(location);
        }
        let scratch_gprs: SmallVec<[Gpr; 4]> =
            (0..data.scratch_gprs).map(|_| operands.gpr()).collect();
        let scratch_fprs: SmallVec<[Fpr; 4]> =
            (0..data.scratch_fprs).map(|_| operands.fpr()).collect();
        for &input in inputs {
            let location = if let Input::Outgoing(offset) = input {
                self.outgoing(offset)
            } else {
                operands.location()
            };
            self.tables.locations.push(location);
        }
        let state = self.state_at(site);
        let ends_block = site_data.value == self.last_value();
        let returns_to_first = ends_block && data.action != Action::Custom;
        let edges = function
            .successors(self.block)
            .filter(|_| ends_block)
            .skip(returns_to_first.into());
        let successors: SmallVec<[Label; 4]> = edges.map(|edge| self.label_of_edge(edge)).collect();
        let next_label = match self.next.approach.expand() {
            Some(edge) => Some(self.label_of_edge(edge)),
            None => self.next.block.expand().map(|next| self.label(next)),
        };
        let falls_through_to = (successors.iter()).position(|&label| Some(label) == next_label);
        self.falls_through |= falls_through_to.is_some();
        let (results, operands) = self.tables.locations.split_at(outputs.len());

        let own_scratch = I::lend_scratch(self.masm, data.clobbers_early & data.clobbers_late);
        if data.action != Action::Custom {
            self.client.before_call(self.masm, data.token, origin);
        }
        match data.action {
            Action::Custom | Action::CustomCall => self.client.patchpoint(
                self.masm,
                &PatchpointSite {
                    function,
                    frame: self.frame,
                    token: data.token,
                    origin,
                    results,
                    operands,
                    state,
                    scratch_gprs: &scratch_gprs,
                    scratch_fprs: &scratch_fprs,
                    live_registers: site_data.live_registers,
                    live_vectors: site_data.live_vectors,
                    falls_through_to,
                    successors: &successors,
                },
            ),
            Action::Call(target) => {
                let target = self.masm.external(target);
                self.masm.call(target);
            }
            Action::CallIndirect => match operands[0] {
                Location::Frame(offset) => {
                    self.masm
                        .call_indirect(Address::new(I::Masm::FRAME_POINTER, offset));
                }
                callee => self.masm.call_indirect(callee.gpr()),
            },
        }
        let return_address = (data.action != Action::Custom).then(|| self.masm.mark());
        if data.flags.contains(PatchpointFlags::MOVES_STACK_POINTER) {
            let bottom = Address::new(I::Masm::FRAME_POINTER, -(self.frame.size as i32));
            self.masm.compute_address(I::Masm::STACK_POINTER, bottom);
        }
        if let Some(return_address) = return_address {
            let site = CallSite {
                function,
                frame: self.frame,
                token: data.token,
                origin,
                return_address,
                state,
                handlers: &successors,
            };
            self.client.after_call(self.masm, &site);
        }
        if !ends_block {
            self.client.after_patchpoint(self.masm, || {
                let scratch = RegisterSet::of(&scratch_gprs, &scratch_fprs);
                let without = |dead: RegisterSet, result: &Location| match *result {
                    Location::Gpr(gpr) => dead - RegisterSet::of(&[gpr], &[]),
                    Location::Fpr(fpr) => dead - RegisterSet::of(&[], &[fpr]),
                    _ => dead,
                };
                let clobbered = data.clobbers_early | data.clobbers_late | scratch;
                results.iter().fold(clobbered, without)
            });
        }
        self.masm.set_scratch(own_scratch);
        if returns_to_first && function.successors(self.block).len() != 0 {
            if data.flags.contains(PatchpointFlags::UNEXTENDED_RESULTS) {
                for (&(ty, _), result) in outputs.iter().zip(&self.tables.locations) {
                    if ty == Type::I32 {
                        self.masm.zero_extend32(result.gpr(), result.gpr());
                    }
                }
            }
            self.jump();
        }
    }
}
