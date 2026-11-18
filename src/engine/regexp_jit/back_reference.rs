//! Compares the text of a capture with that at the position.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::Width as SubjectWidth;
use bun_engine_regexp::program::{Direction, UNSET};

use crate::call::Helper;
use crate::class::Branch;
use crate::frame::{CONSTANT, ORIGIN, POSITION};
use crate::generator::Generator;

/// The lower case of what has both cases in Latin-1.
static FOLDED_LATIN1: [u8; 256] = {
    let (mut folded, mut c) = ([0; 256], 0);
    while c < folded.len() {
        let is_upper = matches!(c as u8, b'A'..=b'Z' | 0xc0..=0xd6 | 0xd8..=0xde);
        folded[c] = if is_upper { c as u8 | 0x20 } else { c as u8 };
        c += 1;
    }
    folded
};

const WORK_OF_CALL: i32 = 32;

impl Generator<'_> {
    pub(crate) fn back_reference(
        &mut self,
        direction: Direction,
        ignore_case: bool,
        pairs: &[u16],
        reserve: u32,
        fail: Label,
    ) {
        let temporary = |index| self.frame.temporary(index);
        let (start, end, cursor) = (temporary(2), temporary(3), temporary(4));
        let (found, done) = (self.masm.new_label(), self.masm.new_label());
        for (index, &pair) in pairs.iter().enumerate() {
            let address = self.capture_address(usize::from(pair) * 2);
            self.masm.load_pair32(start, end, address);
            match index + 1 == pairs.len() {
                true => self.masm.branch32(Cond::Eq, start, UNSET, done),
                false => self.masm.branch32(Cond::Ne, start, UNSET, found),
            }
        }
        if pairs.is_empty() {
            return;
        }
        self.masm.bind(found);
        // Nothing has proved what a capture holds.
        self.masm.branch32(Cond::Above, start, end, fail);
        self.masm.add64(start, start, ORIGIN);
        self.masm.add64(end, end, ORIGIN);
        self.masm.branch64(Cond::Gt, end, 0, fail);
        self.masm.branch64(Cond::Eq, start, end, done);

        let differs = match self.frame.fuel {
            None => fail,
            Some(fuel) => self.defer(move |generator| {
                let (farther, nearer) = match direction {
                    Direction::Forward => (cursor, POSITION),
                    Direction::Backward => (POSITION, cursor),
                };
                generator.masm.sub64(fuel, fuel, farther);
                generator.masm.add64(fuel, fuel, nearer);
                generator.masm.jump(fail);
            }),
        };
        let (from, to) = match direction {
            Direction::Forward => (start, end),
            Direction::Backward => (end, start),
        };
        if ignore_case && self.program.reads_pairs() {
            self.compare_code_points(direction, from, to, differs);
            self.branch_on_room(cursor, direction, reserve, Branch::Unless(differs));
        } else {
            self.masm.sub64(cursor, to, from);
            self.masm.add64(cursor, cursor, POSITION);
            self.branch_on_room(cursor, direction, reserve, Branch::Unless(fail));
            if self.program.reads_pairs() {
                self.branch_if_in_pair(cursor, fail);
            }
            self.compare_units(direction, ignore_case, from, to, differs);
        }
        self.masm.move64(POSITION, cursor);
        self.masm.bind(done);
    }

    /// The last temporary register has the position after the text, and has it again afterwards.
    fn compare_units(
        &mut self,
        direction: Direction,
        ignore_case: bool,
        from: Gpr,
        to: Gpr,
        fail: Label,
    ) {
        let temporary = |index| self.frame.temporary(index);
        let (a, b, cursor) = (temporary(0), temporary(1), temporary(4));
        let (offset, step) = match direction {
            Direction::Forward => (0, 1),
            Direction::Backward => (-1, -1),
        };
        self.masm.move64(cursor, POSITION);
        let again = self.masm.here();
        self.load_unit(a, from, offset);
        self.load_unit(b, cursor, offset);
        match ignore_case {
            true => self.fail_unless_equal_ignoring_case(fail),
            false => self.masm.branch32(Cond::Ne, a, b, fail),
        }
        self.masm.add64(cursor, cursor, step);
        self.masm.add64(from, from, step);
        self.masm.branch64(Cond::Ne, from, to, again);
    }

    /// Leaves the position after the text in the last temporary register.
    fn compare_code_points(&mut self, direction: Direction, from: Gpr, to: Gpr, fail: Label) {
        let temporary = |index| self.frame.temporary(index);
        let (a, b, cursor) = (temporary(0), temporary(1), temporary(4));
        self.masm.move64(cursor, POSITION);
        let again = self.masm.here();
        self.read_code_point(direction, a, from, to, CONSTANT);
        match direction {
            Direction::Forward => {
                self.masm.branch_if_zero64(cursor, fail);
                self.read_code_point(direction, b, cursor, 0, CONSTANT);
            }
            Direction::Backward => {
                self.masm.branch64(Cond::Eq, cursor, ORIGIN, fail);
                self.read_code_point(direction, b, cursor, ORIGIN, CONSTANT);
            }
        }
        self.fail_unless_equal_ignoring_case(fail);
        self.masm.branch64(Cond::Ne, from, to, again);
    }

    fn fail_unless_equal_ignoring_case(&mut self, fail: Label) {
        let (a, b) = (self.frame.temporary(0), self.frame.temporary(1));
        let equal = self.masm.new_label();
        let differ = self.defer(move |generator| {
            if generator.program.width() == SubjectWidth::Latin1 {
                let masm = &mut *generator.masm;
                masm.move64(CONSTANT, FOLDED_LATIN1.as_ptr().expose_provenance());
                masm.load8(a, Address::indexed(CONSTANT, a, Scale::One, 0));
                masm.load8(b, Address::indexed(CONSTANT, b, Scale::One, 0));
                masm.branch32(Cond::Eq, a, b, equal);
            } else {
                if let Some(fuel) = generator.frame.fuel {
                    generator.masm.sub64(fuel, fuel, WORK_OF_CALL);
                }
                let (call, back) = generator.call_out_of_line(Helper::EqualIgnoringCase);
                generator.masm.jump(call);
                generator.masm.bind(back);
                generator.masm.branch_if_not_zero32(a, equal);
            }
            generator.masm.jump(fail);
        });
        self.masm.branch32(Cond::Ne, a, b, differ);
        self.masm.bind(equal);
    }
}
