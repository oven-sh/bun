//! Works out facts when rules ask for them, and remembers them.

use bun_engine_asm::{Sign, Size, VectorReduce, Width};

use super::facts::{Facts, greatest, least, low_bits};
use super::numbering::unchecked;
use super::{Effort, Simplifier};
use crate::ir::{Binary, Checked, Lanes, Load, Op, Type, Unary, Value};

/// At the start of `Tables::facts`.
pub(super) const COMMON: [Facts; 3] = [
    Facts::none(Width::W32),
    Facts::none(Width::W64),
    Facts::BOOLEAN,
];

impl Simplifier<'_> {
    #[inline(always)]
    fn depth(&self) -> u32 {
        match self.effort {
            Effort::Low => 2,
            Effort::High => 6,
        }
    }

    #[inline(always)]
    pub(super) fn facts(&mut self, value: Value) -> Facts {
        self.facts_within(value, self.depth())
    }

    /// Of an operation that may have no value yet.
    pub(super) fn facts_of(&mut self, op: Op, ty: Type) -> Facts {
        self.work_out(op, ty.width(), self.depth())
    }

    pub(super) fn is_boolean(&mut self, value: Value) -> bool {
        self.facts(value).is_boolean()
    }

    pub(super) fn is_not_negative(&mut self, value: Value) -> bool {
        self.facts(value).min >= 0
    }

    #[inline(always)]
    fn facts_within(&mut self, value: Value, depth: u32) -> Facts {
        match self.tables.values[value].facts.checked_sub(1) {
            Some(index) => self.tables.facts[index as usize],
            None => self.learn(value, depth),
        }
    }

    fn learn(&mut self, value: Value, depth: u32) -> Facts {
        let width = self.type_of(value).width();
        let nothing = width as u32 + 1;
        let facts = match self.op(value) {
            Op::Const32(constant) => Facts::constant(width, constant.into()),
            Op::Const64(constant) => Facts::constant(width, constant.get() as i64),
            Op::Alias(other) => return self.facts_within(self.function.resolve(other), depth),
            Op::Compare(..) | Op::FloatCompare(..) => {
                self.tables.values[value].facts = COMMON.len() as u32;
                return Facts::BOOLEAN;
            }
            _ if depth == 0 => return Facts::none(width),
            Op::Param(_) if self.effort == Effort::Low => Facts::none(width),
            Op::Param(position) => {
                // This is what a cycle finds when it comes back here.
                self.tables.values[value].facts = nothing;
                self.work_out_param(value, position as usize, width, depth - 1)
            }
            op => self.work_out(op, width, depth - 1),
        };
        self.tables.values[value].facts = if facts == Facts::none(width) {
            nothing
        } else {
            self.tables.facts.push(facts);
            self.tables.facts.len() as u32
        };
        facts
    }

    fn work_out(&mut self, op: Op, width: Width, depth: u32) -> Facts {
        let up_to = |bits: u32| Facts::of_range(width, 0, low_bits(bits) as i64);
        match op {
            Op::Binary(op, [a, b]) => {
                let (a, b) = (self.facts_within(a, depth), self.facts_within(b, depth));
                Facts::of_binary(op, width, a, b)
            }
            Op::Checked(op, [a, b], _) => {
                let (a, b) = (self.facts_within(a, depth), self.facts_within(b, depth));
                Facts::of_checked(unchecked(op), width, a, b)
            }
            Op::Unary(Unary::FloatToHalfBits, _) => up_to(16),
            Op::Unary(op, a) if op != Unary::Opaque && self.type_of(a).is_int() => {
                let from = self.type_of(a).width();
                Facts::of_unary(op, from, self.facts_within(a, depth))
            }
            Op::Compare(..) | Op::FloatCompare(..) => Facts::BOOLEAN,
            Op::Select([condition, then, or]) => {
                let (mut a, mut b) = (self.facts_within(then, depth), self.facts_within(or, depth));
                if let Op::Compare(cond, [x, y]) = self.op(condition) {
                    for (cond, x, y) in [(cond, x, y), (cond.commuted(), y, x)] {
                        if x == then {
                            a = a.given(width, cond, self.facts_within(y, depth));
                        } else if x == or {
                            b = b.given(width, cond.inverted(), self.facts_within(y, depth));
                        }
                    }
                }
                a.or(b)
            }
            Op::Load {
                kind: Load::Narrow(size, sign),
                ..
            } => Facts::of_size(width, size, sign),
            Op::ExtractLane {
                lanes: Lanes::Int(size),
                sign,
                ..
            } if size < Size::S32 => Facts::of_size(width, size, sign),
            Op::AtomicUpdate { size, .. } | Op::AtomicCompareExchange { size, .. } => {
                Facts::of_size(width, size, Sign::Unsigned)
            }
            Op::VectorReduce(op, _) => match op {
                VectorReduce::I8x16Bitmask => up_to(16),
                VectorReduce::I16x8Bitmask => up_to(8),
                VectorReduce::I32x4Bitmask => up_to(4),
                VectorReduce::I64x2Bitmask => up_to(2),
                _ => Facts::BOOLEAN,
            },
            _ => Facts::none(width),
        }
    }

    /// By how much `arg` exceeds `param`, and whether the sum is known to fit.
    fn as_step_of(&self, param: Value, arg: Value) -> Option<(i64, bool)> {
        let ([a, b], fits) = match self.op(arg) {
            Op::Binary(Binary::Add, args) => (args, false),
            Op::Checked(Checked::Add, args, _) => (args, true),
            _ => return None,
        };
        let step = self.int(self.function.resolve(b))?;
        (self.function.resolve(a) == param).then_some((step, fits))
    }

    fn work_out_param(&mut self, param: Value, position: usize, width: Width, depth: u32) -> Facts {
        const MOST_PREDECESSORS: usize = 6;
        let incoming = self.cfg.predecessors(self.function.block_of(param));
        if incoming.len() > MOST_PREDECESSORS {
            return Facts::none(width);
        }
        let (mut known, mut unchanged_bits) = (None::<Facts>, u64::MAX);
        let (mut may_fall, mut may_rise) = (false, false);
        for &edge in incoming {
            if !self.function.is_attached(edge) {
                continue;
            }
            let arg = self.function.resolve(self.function.args(edge)[position]);
            if arg == param {
                continue;
            }
            if let Some((step, fits)) = self.as_step_of(param, arg) {
                unchanged_bits &= low_bits(step.trailing_zeros());
                may_fall |= step < 0 || !fits;
                may_rise |= step > 0 || !fits;
                continue;
            }
            let facts = self.facts_within(arg, depth);
            if facts == Facts::none(width) {
                return facts;
            }
            known = Some(known.map_or(facts, |known| known.or(facts)));
        }
        let Some(known) = known else {
            return Facts::none(width);
        };
        if unchanged_bits == u64::MAX {
            return known;
        }
        let range = Facts::of_range(
            width,
            if may_fall { least(width) } else { known.min },
            if may_rise { greatest(width) } else { known.max },
        );
        Facts {
            zeros: range.zeros | known.zeros & unchanged_bits,
            ones: range.ones | known.ones & unchanged_bits,
            ..range
        }
    }
}
