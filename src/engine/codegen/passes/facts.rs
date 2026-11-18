//! What is known of values at a point in a walk down the tree of dominators.

use bun_engine_asm::{Cond, Sign, Width};

use super::bounds::Bounds;
use super::orderings::Orderings;
use crate::analysis::Cfg;
use crate::ir::{Binary, Checked, Entity, Function, Op, Table, Unary, Value};

const DEPTH: u32 = 3;
const MOST_RELATIONS_SEARCHED: usize = 12;
const MOST_ARGS_JOINED: usize = 4;
const NONE: u32 = u32::MAX;

struct Known<T> {
    subject: Value,
    fact: T,
    earlier: u32,
}

#[derive(Clone, Copy)]
struct Latest {
    bounds: u32,
    relation: u32,
}

#[derive(Clone, Copy)]
pub(super) struct Mark {
    bounds: usize,
    relations: usize,
}

pub(super) struct Facts<'a> {
    cfg: &'a Cfg,
    latest: Table<Value, Latest>,
    bounds: Vec<Known<Bounds>>,
    /// How the subject is ordered relative to a constant or to a value with a lower number.
    relations: Vec<Known<(Value, Orderings)>>,
}

fn is_subject(function: &Function, a: Value, b: Value) -> bool {
    match (function.op(a).is_floating(), function.op(b).is_floating()) {
        (false, true) => true,
        (true, false) => false,
        _ => a > b,
    }
}

impl<'a> Facts<'a> {
    pub(super) fn new(function: &Function, cfg: &'a Cfg) -> Self {
        Self {
            cfg,
            latest: function.value_table(Latest {
                bounds: NONE,
                relation: NONE,
            }),
            bounds: Vec::new(),
            relations: Vec::new(),
        }
    }

    pub(super) fn mark(&self) -> Mark {
        Mark {
            bounds: self.bounds.len(),
            relations: self.relations.len(),
        }
    }

    pub(super) fn forget_since(&mut self, mark: Mark) {
        for known in self.bounds.drain(mark.bounds..).rev() {
            self.latest[known.subject].bounds = known.earlier;
        }
        for known in self.relations.drain(mark.relations..).rev() {
            self.latest[known.subject].relation = known.earlier;
        }
    }

    #[inline]
    fn latest(&self, value: Value) -> Latest {
        if value.index() < self.latest.len() {
            self.latest[value]
        } else {
            Latest {
                bounds: NONE,
                relation: NONE,
            }
        }
    }

    #[inline]
    fn learnt_bounds(&self, value: Value) -> Option<&Bounds> {
        let known = self.bounds.get(self.latest(value).bounds as usize)?;
        Some(&known.fact)
    }

    /// With its sign extended, for a value that is not a constant everywhere.
    #[inline]
    pub(super) fn constant(&self, value: Value) -> Option<i64> {
        self.learnt_bounds(value)?.only_value()
    }

    pub(super) fn bounds(&self, function: &Function, value: Value) -> Bounds {
        self.bounds_to_depth(function, value, DEPTH)
    }

    fn bounds_to_depth(&self, function: &Function, value: Value, depth: u32) -> Bounds {
        let value = function.resolve(value);
        let width = function.type_of(value).width();
        let evident = match (function.op(value), depth.checked_sub(1)) {
            (&Op::Param(position), Some(depth)) => {
                self.bounds_of_args(function, value, position, depth)
            }
            (_, Some(depth)) => Bounds::of(function, value, |operand| {
                self.bounds_to_depth(function, operand, depth)
            }),
            (_, None) => match function.int_constant(value) {
                Some(constant) => Bounds::constant(width, constant),
                None => Bounds::any(width),
            },
        };
        let Some(learnt) = self.learnt_bounds(value) else {
            return evident;
        };
        // They contradict each other only where control never gets.
        Some(evident.intersection(learnt))
            .filter(|both| !both.is_empty())
            .unwrap_or(evident)
    }

    fn bounds_of_args(
        &self,
        function: &Function,
        param: Value,
        position: u32,
        depth: u32,
    ) -> Bounds {
        let block = function.block_of(param);
        let edges = self.cfg.predecessors(block);
        let any = Bounds::any(function.type_of(param).width());
        if edges.len() > MOST_ARGS_JOINED || self.cfg.loop_headed_by(block).is_some() {
            return any;
        }
        let args = edges
            .iter()
            .map(|&edge| function.args(edge)[position as usize]);
        args.map(|arg| self.bounds_to_depth(function, arg, depth))
            .reduce(|a, b| a.hull(&b))
            .unwrap_or(any)
    }

    fn learnt_orderings(&self, function: &Function, a: Value, b: Value) -> Orderings {
        if !is_subject(function, a, b) {
            return self.learnt_orderings_of(b, a).commuted();
        }
        self.learnt_orderings_of(a, b)
    }

    fn learnt_orderings_of(&self, subject: Value, other: Value) -> Orderings {
        let get = |index: u32| self.relations.get(index as usize);
        core::iter::successors(get(self.latest(subject).relation), |known| {
            get(known.earlier)
        })
        .take(MOST_RELATIONS_SEARCHED)
        .find(|known| known.fact.0 == other)
        .map_or(Orderings::all(), |known| known.fact.1)
    }

    pub(super) fn compare(
        &self,
        function: &Function,
        cond: Cond,
        a: Value,
        b: Value,
    ) -> Option<bool> {
        let learnt = self.learnt_orderings(function, a, b) - Orderings::UNORDERED;
        learnt.decide(cond).or_else(|| {
            let (a, b) = (self.bounds(function, a), self.bounds(function, b));
            (learnt & Orderings::between(&a, &b)).decide(cond)
        })
    }

    /// Whether a comparison holds, regardless of what has been learnt of its result.
    pub(super) fn decide(&self, function: &Function, comparison: Value) -> Option<bool> {
        let resolve = |value| function.resolve(value);
        match *function.op(comparison) {
            Op::Compare(cond, [a, b]) => self.compare(function, cond, resolve(a), resolve(b)),
            Op::FloatCompare(cond, [a, b]) => self
                .learnt_orderings(function, resolve(a), resolve(b))
                .decide(cond),
            _ => None,
        }
    }

    pub(super) fn is_not_zero(&self, function: &Function, value: Value) -> Option<bool> {
        self.is_not_zero_to_depth(function, value, DEPTH)
    }

    fn is_not_zero_to_depth(&self, function: &Function, value: Value, depth: u32) -> Option<bool> {
        let value = function.resolve(value);
        let by = |bounds: &Bounds| match (bounds.least_unsigned, bounds.greatest_unsigned) {
            (_, 0) => Some(false),
            (0, _) => None,
            _ => Some(true),
        };
        if let Some(known) = self.learnt_bounds(value).and_then(by) {
            return Some(known);
        }
        let of = |operand| self.is_not_zero_to_depth(function, operand, depth.checked_sub(1)?);
        let is_boolean = |operand| self.bounds(function, operand).is_boolean();
        match *function.op(value) {
            Op::Compare(..) | Op::FloatCompare(..) => self.decide(function, value),
            Op::Unary(Unary::Widen(_), narrow) => of(narrow),
            Op::Binary(Binary::And, [a, b]) => match (of(a), of(b)) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) if is_boolean(a) && is_boolean(b) => Some(true),
                _ => None,
            },
            Op::Binary(Binary::Or, [a, b]) => match (of(a), of(b)) {
                (Some(true), _) | (_, Some(true)) => Some(true),
                (Some(false), Some(false)) => Some(false),
                _ => None,
            },
            Op::Binary(Binary::Xor, [a, b]) if function.is_int_constant(b, 1) && is_boolean(a) => {
                of(a).map(|holds| !holds)
            }
            _ => by(&self.bounds(function, value)),
        }
    }

    /// The value is within `bounds`, which are within those that `Self::bounds` gives.
    pub(super) fn learn_bounds(&mut self, function: &Function, value: Value, bounds: Bounds) {
        self.learn_bounds_to_depth(function, value, bounds, DEPTH);
    }

    fn learn_bounds_to_depth(
        &mut self,
        function: &Function,
        value: Value,
        bounds: Bounds,
        depth: u32,
    ) {
        if bounds.is_empty()
            || function.op(value).is_constant()
            || self.learnt_bounds(value) == Some(&bounds)
        {
            return;
        }
        let latest = &mut self.latest[value].bounds;
        let earlier = core::mem::replace(latest, self.bounds.len() as u32);
        self.bounds.push(Known {
            subject: value,
            fact: bounds,
            earlier,
        });
        let Some(depth) = depth.checked_sub(1) else {
            return;
        };
        let (operand, implied) = match *function.op(value) {
            Op::Binary(Binary::Add, [operand, added])
            | Op::Checked(Checked::Add, [operand, added], _) => {
                let Some(added) = function.int_constant(added) else {
                    return;
                };
                let width = function.type_of(value).width();
                let added = Bounds::constant(width, added);
                (operand, Bounds::wrapping(Checked::Sub, &bounds, &added))
            }
            Op::Unary(Unary::Widen(Sign::Signed), operand) => (
                operand,
                Bounds::signed(Width::W32, bounds.least, bounds.greatest),
            ),
            Op::Unary(Unary::Widen(Sign::Unsigned), operand) => (
                operand,
                Bounds::unsigned(Width::W32, bounds.least_unsigned, bounds.greatest_unsigned),
            ),
            _ => return,
        };
        let operand = function.resolve(operand);
        let both = self.bounds(function, operand).intersection(&implied);
        self.learn_bounds_to_depth(function, operand, both, depth);
    }

    fn learn_orderings(&mut self, function: &Function, a: Value, b: Value, new: Orderings) {
        let (subject, other, new) = if is_subject(function, a, b) {
            (a, b, new)
        } else {
            (b, a, new.commuted())
        };
        let old = self.learnt_orderings_of(subject, other);
        if function.op(subject).is_constant() || new.contains(old) {
            return;
        }
        let latest = &mut self.latest[subject].relation;
        let earlier = core::mem::replace(latest, self.relations.len() as u32);
        self.relations.push(Known {
            subject,
            fact: (other, old & new),
            earlier,
        });
    }

    pub(super) fn learn_comparison(&mut self, function: &Function, cond: Cond, a: Value, b: Value) {
        let (of_a, of_b) = (self.bounds(function, a), self.bounds(function, b));
        self.learn_bounds(function, a, of_a.where_holds(cond, &of_b));
        self.learn_bounds(function, b, of_b.where_holds(cond.commuted(), &of_a));
        if cond == Cond::Ne || !function.op(a).is_constant() && !function.op(b).is_constant() {
            self.learn_orderings(function, a, b, cond.into());
        }
    }

    pub(super) fn learn_whether_zero(&mut self, function: &Function, value: Value, is_zero: bool) {
        self.learn_whether_zero_to_depth(function, value, is_zero, DEPTH);
    }

    fn learn_whether_zero_to_depth(
        &mut self,
        function: &Function,
        value: Value,
        is_zero: bool,
        depth: u32,
    ) {
        let value = function.resolve(value);
        let zero = Bounds::constant(function.type_of(value).width(), 0);
        let cond = if is_zero { Cond::Eq } else { Cond::Ne };
        let bounds = self.bounds(function, value).where_holds(cond, &zero);
        self.learn_bounds(function, value, bounds);
        let Some(depth) = depth.checked_sub(1) else {
            return;
        };
        match *function.op(value) {
            Op::Compare(cond, operands) => {
                let [a, b] = operands.map(|operand| function.resolve(operand));
                let cond = if is_zero { cond.inverted() } else { cond };
                if matches!(cond, Cond::Eq | Cond::Ne) && function.is_int_constant(b, 0) {
                    self.learn_whether_zero_to_depth(function, a, cond == Cond::Eq, depth);
                } else {
                    self.learn_comparison(function, cond, a, b);
                }
            }
            Op::FloatCompare(cond, operands) => {
                let [a, b] = operands.map(|operand| function.resolve(operand));
                let cond = if is_zero { cond.inverted() } else { cond };
                self.learn_orderings(function, a, b, cond.into());
            }
            Op::Binary(op @ (Binary::And | Binary::Or), operands)
                if is_zero == (op == Binary::Or) =>
            {
                for operand in operands {
                    self.learn_whether_zero_to_depth(function, operand, is_zero, depth);
                }
            }
            Op::Binary(Binary::Xor, [a, b])
                if function.is_int_constant(b, 1) && self.bounds(function, a).is_boolean() =>
            {
                self.learn_whether_zero_to_depth(function, a, !is_zero, depth);
            }
            Op::Unary(Unary::Widen(_), narrow) => {
                self.learn_whether_zero_to_depth(function, narrow, is_zero, depth);
            }
            _ => {}
        }
    }
}
