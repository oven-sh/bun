//! Looks for the start of a match.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::program::Scan;
use smallvec::SmallVec;

use crate::class::Branch;
use crate::frame::{ORIGIN, POSITION, Scanned};
use crate::generator::{Generator, is_large, units};
use crate::vector::{Lanes, VectorTest, Vectors};

type Tests = SmallVec<[(i32, VectorTest); 4]>;

impl<'a> Generator<'a> {
    fn plan_scan(&self, scan: &Scan) -> Option<(Vectors, Tests)> {
        let probes = || core::iter::once(scan.first()).chain(scan.others().iter().copied());
        let lanes = match self.unit_size() {
            Size::S16 if !scan.rows().is_empty() => Lanes::Narrowed,
            _ => self.lanes_for(scan.first().step)?,
        };
        let (mut vectors, mut tests) = (Vectors::new(lanes), Tests::new());
        let mut add = |offset: i16, test: VectorTest| {
            if vectors.reserve(&test) {
                tests.push((offset.into(), test));
            }
        };
        if scan.rows().is_empty() {
            for (index, probe) in probes().enumerate() {
                match self.plan_probe(probe.step, lanes) {
                    Some(test) => add(probe.offset, test),
                    None if index == 0 => return None,
                    None => {}
                }
            }
        } else {
            for row in scan.rows() {
                add(row.offset, VectorTest::of_rows(row));
            }
        }
        Some((vectors, tests))
    }

    pub(crate) fn scan(&mut self, scan: &'a Scan, fail: Label, fail_reads_position: bool) {
        let Some((vectors, tests)) = self.plan_scan(scan) else {
            return self.scan_units(scan, fail);
        };
        let (lanes, last) = (vectors.lanes, -i64::from(scan.need()));
        let offsets = || tests.iter().map(|it| i64::from(it.0));
        let (nearest, farthest) = (offsets().min().unwrap_or(0), offsets().max().unwrap_or(0));
        let last_vector = -farthest.max(0) - i64::from(lanes.units());
        let reaches_past_last = last_vector + i64::from(lanes.units()) - 1 > last;
        let exhausted = match fail_reads_position {
            false => fail,
            true => self.defer(move |generator| {
                generator.masm.move64(POSITION, units(last + 1));
                generator.masm.jump(fail);
            }),
        };
        let (bits, from) = (self.frame.temporary(0), self.frame.temporary(1));
        let [load, found, fresh, done] = [(); 4].map(|()| self.masm.new_label());

        let start = self.masm.here();
        if fail_reads_position {
            self.masm.branch64(Cond::Gt, POSITION, units(last), fail);
        }
        if let Some(scanned) = self.frame.scanned {
            self.look_again(scanned, lanes, fresh);
        }
        let few_are_left = self.defer(move |generator| {
            let by_units = generator.masm.new_label();
            generator
                .masm
                .branch64(Cond::Gt, POSITION, units(last), exhausted);
            (generator.masm).branch64(Cond::Gt, ORIGIN, last_vector + nearest, by_units);
            generator.masm.move64(POSITION, last_vector);
            generator.masm.jump(load);
            generator.masm.bind(by_units);
            generator.scan_units(scan, fail);
            generator.masm.jump(done);
        });
        self.masm.move64(from, POSITION);
        self.masm
            .branch64(Cond::Gt, POSITION, last_vector, few_are_left);
        self.masm.bind(load);
        self.load_constants(&vectors);
        let end = last_vector + i64::from(lanes.units());
        self.vector_loop(lanes, end, exhausted, |generator| {
            let mask = match scan.rows().is_empty() {
                true => generator.test_all(&vectors, &tests),
                false => generator.test_rows(&vectors, &tests),
            };
            generator.branch_if_any_passes(mask, found);
        });
        self.masm.bind(found);
        let began_inside = self.defer(move |generator| {
            generator.masm.sub64(from, from, POSITION);
            generator.drop_first_lanes(lanes, from);
            generator.masm.branch_if_zero64(bits, exhausted);
            generator.masm.jump(fresh);
        });
        if let Some(scanned) = self.frame.scanned {
            self.masm.move64(scanned.position, POSITION);
            self.masm.move64(scanned.bits, bits);
        }
        self.masm.branch64(Cond::Gt, from, POSITION, began_inside);
        self.masm.bind(fresh);
        let lane = self.first_lane(lanes);
        self.masm.add64(POSITION, POSITION, lane);
        if reaches_past_last {
            self.masm
                .branch64(Cond::Gt, POSITION, units(last), exhausted);
        }
        if scan.rows().is_empty() && !tests[0].1.is_exact {
            let mistaken = self.defer(move |generator| {
                generator.masm.add64(POSITION, POSITION, 1);
                generator.masm.jump(start);
            });
            let probe = scan.first();
            self.test_unit(probe.offset.into(), probe.step, Branch::Unless(mistaken));
        }
        self.masm.bind(done);
    }

    /// Goes to `found` if the last vector has more from the position on, as if it had just been loaded.
    fn look_again(&mut self, scanned: Scanned, lanes: Lanes, found: Label) {
        let (bits, passed) = (self.frame.temporary(0), self.frame.temporary(1));
        let elsewhere = self.masm.new_label();
        self.masm.sub64(passed, POSITION, scanned.position);
        (self.masm).branch64(Cond::AboveEq, passed, lanes.units(), elsewhere);
        self.masm.move64(bits, scanned.bits);
        self.masm.move64(POSITION, scanned.position);
        self.drop_first_lanes(lanes, passed);
        self.masm.branch_if_not_zero64(bits, found);
        self.masm.add64(POSITION, POSITION, lanes.units());
        self.masm.bind(elsewhere);
    }

    fn scan_units(&mut self, scan: &Scan, fail: Label) {
        let (probe, c) = (scan.first(), self.frame.temporary(0));
        let test = self.plan_for_step(probe.step);
        let mut last = units(-i64::from(scan.need()));
        if is_large(scan.need().into()) {
            self.masm.move64(self.frame.temporary(1), last);
            last = self.frame.temporary(1).into();
        }
        self.masm.sub64(POSITION, POSITION, 1);
        self.prepare_test(test);
        let again = self.masm.here();
        self.masm.add64(POSITION, POSITION, 1);
        self.masm.branch64(Cond::Gt, POSITION, last, fail);
        self.load_unit(c, POSITION, probe.offset.into());
        self.holding_constant(|generator| generator.prepared_test(test, c, Branch::Unless(again)));
    }
}
