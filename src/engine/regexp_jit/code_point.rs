//! Surrogate pairs.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::program::{ClassId, Direction};

use crate::class::{Branch, Test};
use crate::frame::{ORIGIN, POSITION};
use crate::generator::Generator;

const LEAD: u32 = 0xd800;
const TRAIL: u32 = 0xdc00;
const PAYLOAD: u32 = 0x3ff;
const TAGS: u32 = 0xfc00_fc00;
const TAGS_OF_PAIR: u32 = TRAIL << 16 | LEAD;

impl Generator<'_> {
    /// There is a unit on either side of the position. Overwrites the first temporary register.
    fn branch_on_halves_around(&mut self, position: Gpr, branch: Branch) {
        let both = self.frame.temporary(0);
        self.masm.load32(both, self.unit_address(position, -1));
        self.masm.and32(both, both, TAGS);
        let (cond, target) = branch.on(Cond::Eq);
        self.masm.branch32(cond, both, TAGS_OF_PAIR, target);
    }

    pub(crate) fn branch_if_in_pair(&mut self, position: Gpr, target: Label) {
        let at_edge = self.masm.new_label();
        self.masm.branch64(Cond::Eq, position, ORIGIN, at_edge);
        self.masm.branch_if_zero64(position, at_edge);
        self.branch_on_halves_around(position, Branch::If(target));
        self.masm.bind(at_edge);
    }

    pub(crate) fn leave_pair(&mut self) {
        let done = self.masm.new_label();
        self.masm.branch64(Cond::Eq, POSITION, ORIGIN, done);
        self.masm.branch_if_zero64(POSITION, done);
        self.step_out_of_pair(-1);
        self.masm.bind(done);
    }

    /// There is a unit on either side of the position.
    pub(crate) fn step_out_of_pair(&mut self, step: i32) {
        let done = self.masm.new_label();
        self.branch_on_halves_around(POSITION, Branch::Unless(done));
        self.masm.add64(POSITION, POSITION, step);
        self.masm.bind(done);
    }

    /// `trail` has the payload only.
    fn join_halves(&mut self, dst: Gpr, lead: Gpr, trail: Gpr) {
        self.masm.shl32(lead, lead, 10);
        self.masm.add32(dst, lead, trail);
        self.masm.sub32(dst, dst, (LEAD << 10) - 0x1_0000);
    }

    pub(crate) fn pair(&mut self, offset: i16, class: ClassId, fail: Label) {
        let (c, trail) = (self.frame.temporary(0), self.frame.temporary(1));
        self.load_unit(c, POSITION, offset.into());
        self.masm.sub32(trail, c, LEAD);
        self.masm.branch32(Cond::Above, trail, PAYLOAD, fail);
        self.load_unit(trail, POSITION, i32::from(offset) + 1);
        self.masm.sub32(trail, trail, TRAIL);
        self.masm.branch32(Cond::Above, trail, PAYLOAD, fail);
        self.join_halves(c, c, trail);
        let test = self.plan_for_code_points(class);
        self.test_class(test, c, Branch::Unless(fail));
    }

    /// Reads the character after `cursor` and moves it past that. There is a unit, and none beyond `edge`.
    pub(crate) fn read_code_point(
        &mut self,
        direction: Direction,
        c: Gpr,
        cursor: Gpr,
        edge: impl Into<bun_engine_asm::RegOrImm>,
        other: Gpr,
    ) {
        let edge = edge.into();
        let (first_half, offset, step) = match direction {
            Direction::Forward => (LEAD, 0, 1),
            Direction::Backward => (TRAIL, -1, -1),
        };
        let done = self.masm.new_label();
        let half = self.defer(move |generator| {
            generator.masm.branch64(Cond::Eq, cursor, edge, done);
            generator.load_unit(other, cursor, offset);
            generator
                .masm
                .sub32(other, other, first_half ^ LEAD ^ TRAIL);
            generator.masm.branch32(Cond::Above, other, PAYLOAD, done);
            if direction == Direction::Backward {
                generator.masm.add32(other, other, LEAD);
                generator.masm.sub32(c, c, TRAIL);
                generator.join_halves(c, other, c);
            } else {
                generator.join_halves(c, c, other);
            }
            generator.masm.add64(cursor, cursor, step);
            generator.masm.jump(done);
        });
        self.load_unit(c, cursor, offset);
        self.masm.add64(cursor, cursor, step);
        self.masm.sub32(other, c, first_half);
        self.masm.branch32(Cond::BelowEq, other, PAYLOAD, half);
        self.masm.bind(done);
    }

    pub(crate) fn code_point(
        &mut self,
        direction: Direction,
        test: Test,
        reserve: u32,
        fail: Label,
    ) {
        let temporary = |index| self.frame.temporary(index);
        let (c, after, other) = (temporary(0), temporary(1), temporary(2));
        self.masm.move64(after, POSITION);
        match direction {
            Direction::Forward => self.read_code_point(direction, c, after, 0, other),
            Direction::Backward => self.read_code_point(direction, c, after, ORIGIN, other),
        }
        self.test_class(test, c, Branch::Unless(fail));
        if reserve != 0 {
            self.branch_on_room(after, direction, reserve, Branch::Unless(fail));
        }
        self.masm.move64(POSITION, after);
    }
}
