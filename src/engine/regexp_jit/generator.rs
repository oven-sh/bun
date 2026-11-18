//! One operation after the other.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{CodeTooLarge, RegOrImm, Scratch};
use bun_engine_regexp::program::{
    Comparison, Direction, Op, Place, Program, Slot, Step, Target, WORK_OF_GOING_BACK,
    Width as SubjectWidth, join_halves,
};
use bun_engine_regexp::{Context, FUEL};
use smallvec::SmallVec;

use crate::call::{Helper, Stubs};
use crate::class::{Branch, Plans};
use crate::frame::{CONSTANT, CONTEXT, END, Frame, Location, ORIGIN, POSITION};
use crate::{NO_MATCH, Options, TOO_SLOW, Tables};

pub(crate) struct Generator<'a> {
    pub(crate) masm: &'a mut MacroAssembler,
    pub(crate) program: &'a Program,
    pub(crate) frame: Frame,
    pub(crate) tables: Tables,
    pub(crate) plans: &'a mut Plans,
    pub(crate) stubs: Stubs,
    labels: &'a [Option<Label>],
    /// Code that seldom runs, to be written after the rest.
    deferred: SmallVec<[Deferred<'a>; 16]>,
    leave: Label,
    /// The code cannot be used.
    pub(crate) has_failed: bool,
    /// The fuel does not show that some units are passed many at a time.
    pub(crate) passes_vectors: bool,
}

type Deferred<'a> = Box<dyn FnOnce(&mut Generator<'a>) + 'a>;

/// What is kept from one program to the next, besides the assembler.
#[derive(Default)]
pub(crate) struct Memory {
    labels: Vec<Option<Label>>,
    plans: Plans,
}

impl Memory {
    /// In operations.
    pub(crate) fn capacity(&self) -> usize {
        self.labels.capacity()
    }
}

/// The assembler is empty.
pub(crate) fn generate(
    program: &Program,
    options: &Options,
    masm: &mut MacroAssembler,
    memory: &mut Memory,
) -> Result<Tables, CodeTooLarge> {
    let (ops, Memory { labels, plans }) = (program.ops(), memory);
    if ops.len() > options.max_code_size / 2 {
        return Err(CodeTooLarge);
    }
    masm.reserve(ops.len() * 24);
    labels.clear();
    labels.resize(ops.len(), None);
    for target in program.targets() {
        labels[target.index()] = Some(masm.new_label());
    }
    plans.start(program);
    let mut generator = Generator {
        leave: masm.new_label(),
        masm,
        program,
        frame: Frame::new(program),
        tables: Tables::default(),
        plans,
        stubs: Stubs::default(),
        labels,
        deferred: SmallVec::new(),
        has_failed: false,
        passes_vectors: false,
    };
    generator.enter(options.max_units);
    let mut next = usize::from(generator.skips_first_step());
    while next < ops.len() {
        if let Some(label) = generator.labels[next] {
            generator.masm.bind(label);
        }
        next += generator.op(next);
        if generator.size() > options.max_code_size || generator.has_failed {
            return Err(CodeTooLarge);
        }
    }
    while let Some(write) = generator.deferred.pop() {
        write(&mut generator);
    }
    generator.write_stubs();
    generator.masm.bind(generator.leave);
    generator.frame.leave(generator.masm);
    if generator.size() > options.max_code_size || generator.has_failed {
        return Err(CodeTooLarge);
    }
    Ok(generator.tables)
}

const RESULT: [Gpr; 2] = abi::RETURN_GPRS;

/// Whether all four bytes of the number say something.
pub(crate) fn is_large(number: i64) -> bool {
    number.unsigned_abs() >= 1 << 23
}

/// A number of them that the pattern has a say in. An operation with a large one can overwrite [`CONSTANT`].
pub(crate) fn units(number: impl Into<i64>) -> RegOrImm {
    match number.into() {
        number if is_large(number) => Untrusted(number).into(),
        number => number.into(),
    }
}

impl<'a> Generator<'a> {
    fn size(&self) -> usize {
        self.masm.size() + self.tables.size()
    }

    pub(crate) fn label(&self, target: Target) -> Label {
        let target = match self.program.ops()[target.index()] {
            Op::Again { to } => to,
            _ => target,
        };
        self.labels[target.index()].expect("the verifier has checked the targets")
    }

    /// Returns the label of the code.
    pub(crate) fn defer(&mut self, write: impl FnOnce(&mut Generator<'a>) + 'a) -> Label {
        let label = self.masm.new_label();
        self.deferred.push(Box::new(move |generator| {
            generator.masm.bind(label);
            write(generator);
        }));
        label
    }

    /// Keeps the macro assembler from overwriting [`CONSTANT`].
    pub(crate) fn holding_constant<T>(&mut self, write: impl FnOnce(&mut Self) -> T) -> T {
        let all = self.masm.scratch();
        self.masm.set_scratch(Scratch {
            gprs: all.gprs.map(|it| it.filter(|&it| it != CONSTANT)),
            ..all
        });
        let result = write(self);
        self.masm.set_scratch(all);
        result
    }

    pub(crate) fn unit_size(&self) -> Size {
        match self.program.width() {
            SubjectWidth::Latin1 => Size::S8,
            SubjectWidth::Utf16 => Size::S16,
        }
    }

    pub(crate) fn unit_address(&self, position: Gpr, offset: i32) -> Address {
        let size = self.unit_size();
        Address::indexed(END, position, size.into(), offset * i32::from(size.bytes()))
    }

    pub(crate) fn load_unit(&mut self, dst: Gpr, position: Gpr, offset: i32) {
        let address = self.unit_address(position, offset);
        self.masm.load(self.unit_size(), dst, address);
    }

    pub(crate) fn return_with(&mut self, code: impl Into<RegOrImm>) {
        self.masm.move32(RESULT[0], code);
        self.leave();
    }

    fn leave(&mut self) {
        match self.frame.is_left_quickly() {
            true => self.frame.leave(self.masm),
            false => self.masm.jump(self.leave),
        }
    }

    fn enter(&mut self, max_units: Option<u32>) {
        let (first, second) = (self.frame.temporary(0), self.frame.temporary(1));
        let of_context = |offset: usize| Address::new(CONTEXT, offset as i32);
        self.frame.enter(self.masm);
        let end = Address::indexed(END, ORIGIN, self.unit_size().into(), 0);
        self.masm.compute_address(END, end);
        self.masm.neg64(ORIGIN, ORIGIN);
        let before = -i32::from(self.skips_first_step());
        let start = Address::indexed(POSITION, ORIGIN, Scale::One, before);
        self.masm.compute_address(POSITION, start);
        if let Some(most) = max_units {
            let too_many = self.defer(|generator| generator.return_with(TOO_SLOW));
            (self.masm).branch64(Cond::Lt, POSITION, -i64::from(most), too_many);
        }
        if !self.starts_with_check_of_length() {
            let past_end = self.defer(|generator| generator.return_with(NO_MATCH));
            self.masm.branch64(Cond::Gt, POSITION, before, past_end);
        }
        if self.frame.fuel.is_some() {
            (self.masm).store32(of_context(Context::OFFSET_OF_HAS_POLLED), 0);
        }
        self.forget_what_is_reported();
        if let Some(stack) = self.frame.stack {
            self.load_stack_limit(stack, CONTEXT);
        }
        if let Some(words) = self.frame.words_in_context {
            let masm = &mut *self.masm;
            masm.load64(first, of_context(Context::OFFSET_OF_CELLS_START));
            masm.load64(second, of_context(Context::OFFSET_OF_CELLS_END));
            masm.sub64(second, second, first);
            let (grow, grown) = self.call_out_of_line(Helper::GrowCells);
            self.masm.branch64(Cond::Below, second, words * 4, grow);
            self.masm.bind(grown);
        }
        if let Some(stack) = self.frame.stack {
            let start = of_context(Context::OFFSET_OF_STACK_START);
            self.masm.load64(second, start);
            if let Some(copy) = stack.start {
                self.masm.store64(copy, second);
            }
            self.masm.move64(stack.top, second);
        }
        if self.frame.words_in_context.is_some() {
            self.masm.move64(self.frame.cells.base(), first);
        }
        match self.frame.fuel {
            Some(fuel) if self.program.counts_turns() => {
                let context = self.context_in_register(first);
                let given = Address::new(context, Context::OFFSET_OF_FUEL as i32);
                self.masm.load32(fuel, given);
            }
            Some(fuel) => self.masm.move32(fuel, FUEL),
            None => {}
        }
        if let Some(scanned) = self.frame.scanned {
            // Far from any start, even one that is past the end.
            self.masm.move64(scanned.position, 1u64 << 40);
        }
    }

    /// Its own, or `dst`.
    pub(crate) fn context_in_register(&mut self, dst: Gpr) -> Gpr {
        match self.frame.context.expect("the frame keeps the context") {
            Location::Register(register) => register,
            Location::Memory(address) => {
                self.masm.load64(dst, address);
                dst
            }
        }
    }

    /// Which a start that is past the end fails too.
    fn starts_with_check_of_length(&self) -> bool {
        let ops = self.program.ops();
        let first = match ops[0] {
            Op::Jump { to } => ops[to.index()],
            op => op,
        };
        match first {
            Op::Need {
                direction: Direction::Forward,
                fail,
                ..
            }
            | Op::Scan { fail, .. } => ops[fail.index()] == Op::NoMatch,
            _ => false,
        }
    }

    /// Whether the code starts by jumping over a step, which it can take as well from one unit before.
    fn skips_first_step(&self) -> bool {
        let ops = self.program.ops();
        matches!(*ops, [Op::Jump { to }, Op::Advance { by: 1 }, ..] if to.index() == 2)
            && self.labels[0].is_none()
    }

    /// The operation after `at`, if that is the only way to it.
    fn follower(&self, at: usize) -> Option<Op> {
        let op = self.program.ops().get(at + 1)?;
        self.labels[at + 1].is_none().then_some(*op)
    }

    /// For a test: where to branch, and how many operations that takes care of.
    fn branch_after(&self, at: usize, fail: Target) -> (Branch, usize) {
        match self.follower(at) {
            Some(Op::Jump { to } | Op::Again { to }) if fail.index() == at + 2 => {
                (Branch::If(self.label(to)), 2)
            }
            _ => (Branch::Unless(self.label(fail)), 1),
        }
    }

    fn jump(&mut self, from: usize, to: Target) {
        if to.index() != from + 1 {
            self.masm.jump(self.label(to));
        }
    }

    /// Returns the number of operations that are taken care of.
    fn op(&mut self, at: usize) -> usize {
        let (first, second) = (self.frame.temporary(0), self.frame.temporary(1));
        if self.program.counts_turns() {
            self.use_fuel(work_counted_in_race(self.program.ops()[at]));
        }
        match self.program.ops()[at] {
            Op::Jump { to } | Op::Again { to } | Op::Turned { to, .. } => self.jump(at, to),
            Op::NoMatch => self.return_with(NO_MATCH),
            Op::Match { start, end } => {
                self.index_of_place(RESULT[0], start);
                self.masm.sub64(POSITION, POSITION, ORIGIN);
                self.masm.add64(RESULT[1], POSITION, i32::from(end));
                self.leave();
            }
            Op::MatchHere { start, end } => {
                self.masm.sub64(POSITION, POSITION, ORIGIN);
                self.masm.add64(RESULT[0], POSITION, i32::from(start));
                self.masm.add64(RESULT[1], POSITION, i32::from(end));
                self.leave();
            }
            Op::Need {
                direction,
                count,
                fail,
            } => {
                let (branch, taken) = self.branch_after(at, fail);
                self.branch_on_room(POSITION, direction, count, branch);
                return taken;
            }
            Op::AtEdge {
                direction,
                offset,
                fail,
            } => {
                let (branch, taken) = self.branch_after(at, fail);
                let (cond, target) = branch.on(Cond::Eq);
                match direction {
                    Direction::Forward => {
                        self.masm
                            .branch64(cond, POSITION, -i32::from(offset), target);
                    }
                    Direction::Backward => {
                        let edge = self.plus(first, POSITION, offset.into());
                        self.masm.branch64(cond, edge, ORIGIN, target);
                    }
                }
                return taken;
            }
            Op::NotInPair { offset, fail } => {
                let position = self.plus(second, POSITION, offset.into());
                self.branch_if_in_pair(position, self.label(fail));
            }
            Op::Unit {
                offset,
                value,
                mask,
                fail,
            } => {
                let (branch, taken) = self.branch_after(at, fail);
                self.word(self.unit_size(), offset, value.into(), mask.into(), branch);
                return taken;
            }
            Op::Word {
                bytes,
                offset,
                value,
                mask,
                fail,
            } => {
                let (branch, taken) = self.branch_after(at, fail);
                let size = match bytes {
                    2 => Size::S16,
                    4 => Size::S32,
                    _ => Size::S64,
                };
                self.word(size, offset, join_halves(value), join_halves(mask), branch);
                return taken;
            }
            Op::Class {
                offset,
                class,
                fail,
            } => {
                let (branch, taken) = self.branch_after(at, fail);
                self.test_unit(offset.into(), Step::Class(class), branch);
                return taken;
            }
            Op::ClassCount {
                offset,
                count,
                class,
                fail,
            } => self.class_count(offset, count, class, self.label(fail)),
            Op::Pair {
                offset,
                class,
                fail,
            } => self.pair(offset, class, self.label(fail)),
            Op::Switch { offset, table } => {
                self.load_unit(first, POSITION, offset.into());
                self.switch(self.program.switch(table).cases());
            }
            Op::Advance { by } => match self.follower(at) {
                Some(run @ Op::Run { .. }) if !self.program.counts_turns() => {
                    self.run(run, by);
                    return 2;
                }
                _ => self.masm.add64(POSITION, POSITION, units(by)),
            },
            Op::LeavePair => self.leave_pair(),
            Op::SkipToTail { length } => {
                self.masm.move64(first, units(-i64::from(length)));
                (self.masm).select64(Cond::Lt, POSITION, POSITION, first, first, POSITION);
            }
            Op::Scan { id, fail } => {
                let goes_on = self.program.ops()[fail.index()] != Op::NoMatch;
                self.scan(self.program.scan(id), self.label(fail), goes_on);
            }
            Op::WalkBack {
                slot, class, max, ..
            } => self.walk_back(slot, class, max),
            Op::Save { slot } => self.save(slot),
            Op::SaveStart { slot, fail } => {
                (self.masm).branch64(Cond::Ne, POSITION, ORIGIN, self.label(fail));
                if self.frame.cell(slot.cell) != Location::Register(ORIGIN) {
                    self.save(slot);
                }
            }
            Op::Load { from, metered } => {
                if metered {
                    let from = self.place_in_register(first, from);
                    self.go_back_to(from, 0);
                } else {
                    let from = self.place_in_register(POSITION, from);
                    self.masm.move64(POSITION, from);
                }
            }
            Op::ComparePlace {
                when,
                offset,
                place,
                to,
            } => {
                let distance = i64::from(place.delta) - i64::from(offset);
                self.compare_position(signed(when), place.slot, distance, self.label(to));
            }
            run @ Op::Run { .. } => self.run(run, 0),
            Op::GiveBack {
                direction,
                stride,
                floor,
                filter,
                fail,
            } => self.give_back(direction, stride, floor, filter.class(), self.label(fail)),
            Op::CodePoint {
                direction,
                class,
                reserve,
                fail,
            } => {
                let test = self.plan_for_code_points(class);
                self.code_point(direction, test, reserve, self.label(fail));
            }
            Op::BackReference {
                direction,
                ignore_case,
                first,
                count,
                reserve,
                fail,
            } => {
                let pairs = self.program.referenced_pairs(first, count);
                self.back_reference(direction, ignore_case, pairs, reserve, self.label(fail));
            }
            Op::Capture { offset, entry } => {
                return self.capture(offset, entry, self.follower(at));
            }
            Op::CapturePlace { place, entry } => {
                self.index_of_place(first, place);
                self.masm
                    .store32(self.capture_address(entry as usize), first);
            }
            Op::Clear { pairs } => self.clear(pairs),
            Op::SaveCaptures { slot, pairs } => {
                let entries = pairs.entries();
                let cells = self.frame.cells.plus(slot.cell as i32 * 4);
                self.copy_words(cells, self.capture_address(entries.start), entries.len());
            }
            Op::RestoreCaptures { slot, pairs } => {
                let entries = pairs.entries();
                let cells = self.frame.cells.plus(slot.cell as i32 * 4);
                self.copy_words(self.capture_address(entries.start), cells, entries.len());
            }
            Op::Zero { slot } => self.set_number(slot.cell, 0),
            Op::Increment { slot } => self.add_to_number(slot.cell, 1),
            Op::RaiseTo { slot, value } => self.set_number(slot.cell, Untrusted(value)),
            Op::CompareNumber {
                when,
                slot,
                value,
                to,
            } => self.compare_number(unsigned(when), slot.cell, value, self.label(to)),
            Op::Spend { work } => self.spend(work),
            Op::CountTurn => self.count_turns(1),
            Op::Choose { slot, index, .. } => {
                if self.program.choice_targets(slot).len() > 1 {
                    self.set_number(slot.cell, index);
                }
            }
            Op::Resume { slot } => self.resume(at, slot),
            Op::Enter { id } => self.set_number(self.program.loops()[id.index()].turns_cell(), 0),
            Op::Push { id } => self.push(&self.program.loops()[id.index()]),
            Op::Pop { id } => self.pop(&self.program.loops()[id.index()]),
            Op::Retreat { id, none } => {
                let it = &self.program.loops()[id.index()];
                self.compare_number(Cond::Eq, it.turns_cell(), 0, self.label(none));
                self.jump(at, it.back_into_turn());
            }
            Op::Mark { slot } => self.mark(slot.cell),
            Op::Cut { slot } => self.cut(slot.cell),
            Op::Visit { .. }
            | Op::VisitRun { .. }
            | Op::EnterLook { .. }
            | Op::LeaveLook { .. }
            | Op::DoubtVisit => unreachable!("the program does not memoize"),
        }
        1
    }

    pub(crate) fn save(&mut self, slot: Slot) {
        match self.frame.cell(slot.cell) {
            Location::Register(cell) => self.masm.move64(cell, POSITION),
            Location::Memory(cell) => self.masm.store32(cell, POSITION),
        }
    }

    /// From the start of the subject.
    pub(crate) fn index_of_place(&mut self, dst: Gpr, place: Place) {
        if self.frame.cell(place.slot.cell) == Location::Register(ORIGIN) {
            return self.masm.move32(dst, units(place.delta));
        }
        let position = self.place_in_register(self.frame.temporary(0), place);
        self.masm.sub32(dst, position, ORIGIN);
    }

    /// `base`, or `dst` with the sum.
    pub(crate) fn plus(&mut self, dst: Gpr, base: Gpr, distance: i64) -> Gpr {
        if distance == 0 {
            return base;
        }
        self.masm.add64(dst, base, units(distance));
        dst
    }

    /// The register of the cell, or `dst` with the position.
    pub(crate) fn place_in_register(&mut self, dst: Gpr, place: Place) -> Gpr {
        self.slot_plus(dst, place.slot, place.delta.into())
    }

    pub(crate) fn slot_plus(&mut self, dst: Gpr, slot: Slot, distance: i64) -> Gpr {
        match self.frame.cell(slot.cell) {
            Location::Register(cell) => self.plus(dst, cell, distance),
            Location::Memory(cell) => {
                self.masm.load32_signed64(dst, cell);
                self.plus(dst, dst, distance)
            }
        }
    }

    pub(crate) fn compare_position(
        &mut self,
        cond: Cond,
        slot: Slot,
        distance: i64,
        target: Label,
    ) {
        match self.frame.cell(slot.cell) {
            Location::Memory(cell) if distance == 0 => {
                self.masm.branch32(cond, POSITION, cell, target);
            }
            _ => {
                let other = self.slot_plus(self.frame.temporary(0), slot, distance);
                self.masm.branch64(cond, POSITION, other, target);
            }
        }
    }

    /// The condition is that `count` units are between the position and the edge.
    pub(crate) fn branch_on_room(
        &mut self,
        position: Gpr,
        direction: Direction,
        count: u32,
        branch: Branch,
    ) {
        match direction {
            Direction::Forward => {
                let (cond, target) = branch.on(Cond::Le);
                (self.masm).branch64(cond, position, units(-i64::from(count)), target);
            }
            Direction::Backward if count == 1 => {
                let (cond, target) = branch.on(Cond::Gt);
                self.masm.branch64(cond, position, ORIGIN, target);
            }
            Direction::Backward => {
                let (cond, target) = branch.on(Cond::Ge);
                let least = self.plus(self.frame.temporary(0), ORIGIN, count.into());
                self.masm.branch64(cond, position, least, target);
            }
        }
    }

    fn word(&mut self, size: Size, offset: i16, value: u64, mask: u64, branch: Branch) {
        let address = self.unit_address(POSITION, offset.into());
        let (cond, target) = branch.on(Cond::Eq);
        let width = size.width();
        if mask == 0 && size == Size::S8 {
            return self.masm.branch8(cond, address, value as i32, target);
        }
        if mask == 0 && size != Size::S16 {
            return self
                .masm
                .branch(width, cond, address, Untrusted(value), target);
        }
        let loaded = self.frame.temporary(0);
        self.masm.load(size, loaded, address);
        if mask != 0 {
            self.masm.or(width, loaded, loaded, Untrusted(mask));
        }
        self.masm
            .branch(width, cond, loaded, Untrusted(value), target);
    }

    pub(crate) fn set_number(&mut self, cell: u32, value: impl Into<RegOrImm>) {
        match self.frame.cell(cell) {
            Location::Register(cell) => self.masm.move32(cell, value),
            Location::Memory(cell) => self.masm.store32(cell, value),
        }
    }

    pub(crate) fn add_to_number(&mut self, cell: u32, value: i32) {
        match self.frame.cell(cell) {
            Location::Register(cell) => self.masm.add32(cell, cell, value),
            Location::Memory(cell) => self.masm.add32_to_memory(cell, value),
        }
    }

    pub(crate) fn compare_number(&mut self, cond: Cond, cell: u32, value: u32, target: Label) {
        match self.frame.cell(cell) {
            Location::Register(cell) => self.masm.branch32(cond, cell, Untrusted(value), target),
            Location::Memory(cell) => self.masm.branch32(cond, cell, Untrusted(value), target),
        }
    }

    fn resume(&mut self, at: usize, slot: Slot) {
        const COMPARED: usize = 4;
        let targets = self.program.choice_targets(slot);
        let (&last, others) = targets.split_last().expect("a choice has a target");
        if others.len() <= COMPARED {
            for (index, &target) in others.iter().enumerate() {
                self.compare_number(Cond::Eq, slot.cell, index as u32, self.label(target));
            }
            return self.jump(at, last);
        }
        let index = self.frame.temporary(0);
        match self.frame.cell(slot.cell) {
            Location::Register(cell) => self.masm.move32(index, cell),
            Location::Memory(cell) => self.masm.load32(index, cell),
        }
        let labels: Vec<Label> = others.iter().map(|&it| self.label(it)).collect();
        (self.masm).branch32(Cond::AboveEq, index, labels.len(), self.label(last));
        self.masm.jump_table(index, &labels);
    }

    pub(crate) fn count_turns(&mut self, count: impl Into<RegOrImm>) {
        match self.frame.turns.expect("the survey has seen the operation") {
            Location::Register(turns) => self.masm.add64(turns, turns, count.into()),
            Location::Memory(turns) => self.masm.add64_to_memory(turns, count),
        }
    }

    pub(crate) fn forget_what_is_reported(&mut self) {
        if let Some(saved) = self.frame.saved_work {
            self.masm.move32(saved, 0);
        }
        match self.frame.turns {
            Some(Location::Register(turns)) => self.masm.move32(turns, 0),
            Some(Location::Memory(turns)) => self.masm.store64(turns, 0),
            None => {}
        }
    }

    /// Without looking at what is left.
    pub(crate) fn use_fuel(&mut self, amount: u32) {
        if let Some(fuel) = self.frame.fuel {
            self.plus(fuel, fuel, -i64::from(amount));
        }
    }

    pub(crate) fn spend(&mut self, work: u32) {
        let fuel = self.frame.fuel.expect("the survey has seen the operation");
        let (poll, polled) = self.call_out_of_line(Helper::Poll);
        (self.masm).branch_sub64(ResultCond::Negative, fuel, fuel, work, poll);
        self.masm.bind(polled);
    }

    /// Counts the distance to `position` as work, and `more`. It is not the second temporary register.
    pub(crate) fn go_back_to(&mut self, position: Gpr, more: u32) {
        let fuel = self.frame.fuel.expect("the survey has seen the operation");
        let (poll, polled) = self.call_out_of_line(Helper::PollInAttempt);
        let work = WORK_OF_GOING_BACK + more;
        if self.frame.moves_backward {
            let distance = self.frame.temporary(1);
            self.masm.sub64(distance, POSITION, position);
            self.holding_constant(|generator| {
                let masm = &mut *generator.masm;
                masm.neg64(CONSTANT, distance);
                masm.select64(Cond::Lt, distance, distance, 0, CONSTANT, distance);
            });
            self.masm.sub64(fuel, fuel, distance);
            (self.masm).branch_sub64(ResultCond::Negative, fuel, fuel, work, poll);
        } else {
            let left = Address::indexed(fuel, position, Scale::One, -(work as i32));
            self.masm.compute_address(fuel, left);
            (self.masm).branch_sub64(ResultCond::Negative, fuel, fuel, POSITION, poll);
        }
        self.masm.bind(polled);
        self.masm.move64(POSITION, position);
    }
}

/// The other side gets time for what this one counts.
fn work_counted_in_race(op: Op) -> u32 {
    match op {
        Op::CountTurn => 1,
        Op::Run { .. } | Op::Pair { .. } | Op::CodePoint { .. } => 2,
        Op::Switch { .. } | Op::BackReference { .. } => 4,
        Op::ClassCount { count, .. } => u32::from(count) / 2,
        Op::Clear { pairs }
        | Op::SaveCaptures { pairs, .. }
        | Op::RestoreCaptures { pairs, .. } => u32::from(pairs.end - pairs.first).min(16),
        _ => 0,
    }
}

fn signed(comparison: Comparison) -> Cond {
    match comparison {
        Comparison::Equal => Cond::Eq,
        Comparison::Below => Cond::Lt,
        Comparison::AtLeast => Cond::Ge,
        Comparison::Above => Cond::Gt,
        Comparison::AtMost => Cond::Le,
    }
}

fn unsigned(comparison: Comparison) -> Cond {
    match comparison {
        Comparison::Equal => Cond::Eq,
        Comparison::Below => Cond::Below,
        Comparison::AtLeast => Cond::AboveEq,
        Comparison::Above => Cond::Above,
        Comparison::AtMost => Cond::BelowEq,
    }
}
