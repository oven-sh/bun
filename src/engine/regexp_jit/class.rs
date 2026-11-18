//! Tests whether a character is in a class.

use core::ops::Range;

use bun_engine_asm::prelude::*;
use bun_engine_regexp::program::{ClassId, Program, Step};
use bun_engine_regexp::set::{CharRange, Set};
use bun_engine_unicode::MAX_CODE_POINT;

use crate::frame::{CONSTANT, POSITION};
use crate::generator::Generator;
use crate::tables::{Lookup, Membership};

/// Falls through otherwise.
#[derive(Clone, Copy)]
pub(crate) enum Branch {
    If(Label),
    Unless(Label),
}

impl Branch {
    /// For what holds where `cond` does.
    pub(crate) fn on(self, cond: Cond) -> (Cond, Label) {
        match self {
            Branch::If(target) => (cond, target),
            Branch::Unless(target) => (cond.inverted(), target),
        }
    }

    fn on_bits(self) -> (TestCond, Label) {
        match self {
            Branch::If(target) => (TestCond::NonZero, target),
            Branch::Unless(target) => (TestCond::Zero, target),
        }
    }

    fn inverted_if(self, is_inverted: bool) -> Branch {
        match (self, is_inverted) {
            (_, false) => self,
            (Branch::If(target), true) => Branch::Unless(target),
            (Branch::Unless(target), true) => Branch::If(target),
        }
    }

    /// Where members go and where the others go, given the label of what follows.
    fn targets(self, next: Label) -> [Label; 2] {
        match self {
            Branch::If(target) => [target, next],
            Branch::Unless(target) => [next, target],
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Test {
    shape: Shape,
    is_inverted: bool,
}

impl Test {
    pub(crate) fn always_passes(&self) -> bool {
        matches!(self.shape, Shape::Always) && !self.is_inverted
    }
}

#[derive(Clone, Copy)]
enum Shape {
    Always,
    /// `first <= c | mask <= last`, and nothing is above `max`.
    Range {
        mask: u32,
        first: u32,
        last: u32,
        max: u32,
    },
    /// The members are among the 64 characters from `first` on.
    Bits {
        first: u32,
        bits: u64,
    },
    Tree(Tree),
    Bytes {
        table: Membership,
        above: Above,
    },
    Lookup {
        table: Lookup,
        max: u32,
    },
}

/// The characters at which membership changes, as indices into those of [`Plans`].
#[derive(Clone, Copy)]
struct Tree {
    start: u32,
    end: u32,
    /// Below the first.
    starts_inside: bool,
}

/// For the characters above U+00FF.
#[derive(Clone, Copy)]
enum Above {
    Impossible,
    All(bool),
    Tree(Tree),
    Lookup { table: Lookup, max: u32 },
}

#[derive(Default)]
pub(crate) struct Plans {
    for_units: Vec<Option<Test>>,
    for_code_points: Vec<Option<Test>>,
    boundaries: Vec<u32>,
}

impl Plans {
    pub(crate) fn start(&mut self, program: &Program) {
        self.for_units.clear();
        self.for_units.resize(program.class_count(), None);
        self.for_code_points.clear();
        if program.reads_pairs() {
            self.for_code_points.resize(program.class_count(), None);
        }
        self.boundaries.clear();
    }

    /// Of the part of the ranges from `min` to `max`.
    fn add_tree(&mut self, ranges: impl Iterator<Item = CharRange>, min: u32, max: u32) -> Tree {
        let start = self.boundaries.len() as u32;
        let mut starts_inside = false;
        for range in ranges.take_while(|range| range.first <= max) {
            match range.first <= min {
                true => starts_inside = true,
                false => self.boundaries.push(range.first),
            }
            if range.last < max {
                self.boundaries.push(range.last + 1);
            }
        }
        Tree {
            start,
            end: self.boundaries.len() as u32,
            starts_inside,
        }
    }
}

impl Tree {
    fn indices(self) -> Range<usize> {
        self.start as usize..self.end as usize
    }
}

const BOUNDARIES_COMPARED: usize = 4;
const BOUNDARIES_COMPARED_ABOVE_LATIN1: usize = 16;

/// For ranges between the boundaries that are not touching zero or `max`.
fn simple_shape(boundaries: &[u32], max: u32) -> Option<Shape> {
    let range = |mask, first, last| Shape::Range {
        mask,
        first,
        last,
        max,
    };
    match *boundaries {
        [first] => return Some(range(0, first, max)),
        [first, end] => return Some(range(0, first, end - 1)),
        [a, a_end, b, b_end] if a_end - a == b_end - b && (b - a).is_power_of_two() => {
            let bit = b - a;
            let stays_in_half = a & bit == 0 && a ^ (a_end - 1) < bit;
            if stays_in_half {
                return Some(range(bit, b, b_end - 1));
            }
        }
        _ => {}
    }
    let (&first, &end) = (boundaries.first()?, boundaries.last()?);
    if boundaries.len() % 2 != 0 || end - first > 64 || boundaries.len() <= BOUNDARIES_COMPARED {
        return None;
    }
    let ones = |&[from, to]: &[u32; 2]| u64::MAX >> (64 - (to - from)) << (from - first);
    let bits = boundaries.as_chunks().0.iter().map(ones);
    Some(Shape::Bits {
        first,
        bits: bits.fold(0, |all, bits| all | bits),
    })
}

impl Generator<'_> {
    pub(crate) fn plan_for_units(&mut self, class: ClassId) -> Test {
        if let Some(test) = self.plans.for_units[class.index()] {
            return test;
        }
        let max = self.program.width().max_unit().into();
        let test = self.plan(self.program.class(class).set(), max);
        self.plans.for_units[class.index()] = Some(test);
        test
    }

    pub(crate) fn plan_for_step(&mut self, step: Step) -> Test {
        match step {
            Step::Class(class) => self.plan_for_units(class),
            Step::Unit { value, mask } => Test {
                shape: Shape::Range {
                    mask: mask.into(),
                    first: value.into(),
                    last: value.into(),
                    max: self.program.width().max_unit().into(),
                },
                is_inverted: false,
            },
        }
    }

    pub(crate) fn plan_for_code_points(&mut self, class: ClassId) -> Test {
        if let Some(test) = self
            .plans
            .for_code_points
            .get(class.index())
            .copied()
            .flatten()
        {
            return test;
        }
        let test = self.plan(self.program.class(class).set(), MAX_CODE_POINT);
        if let Some(plan) = self.plans.for_code_points.get_mut(class.index()) {
            *plan = Some(test);
        }
        test
    }

    fn plan(&mut self, set: &Set, max: u32) -> Test {
        let above = set.above().partition_point(|range| range.first <= max);
        if above <= BOUNDARIES_COMPARED_ABOVE_LATIN1 / 2 {
            return self.plan_for_few_ranges(set, max);
        }
        let Some((table, has_latin1)) = self.tables.lookup(set, max) else {
            self.has_failed = true;
            return Test {
                shape: Shape::Always,
                is_inverted: false,
            };
        };
        match has_latin1 {
            true => Test {
                shape: Shape::Lookup { table, max },
                is_inverted: false,
            },
            false => self.plan_bytes(set, Above::Lookup { table, max }),
        }
    }

    fn plan_for_few_ranges(&mut self, set: &Set, max: u32) -> Test {
        let tree = self.plans.add_tree(set.ranges(), 0, max);
        let boundaries = &self.plans.boundaries[tree.indices()];
        let simple = match boundaries {
            [] => Some((Shape::Always, !tree.starts_inside)),
            _ => simple_shape(boundaries, max).map(|shape| (shape, tree.starts_inside)),
        };
        if simple.is_none() && boundaries.len() <= BOUNDARIES_COMPARED {
            return Test {
                shape: Shape::Tree(tree),
                is_inverted: false,
            };
        }
        self.plans.boundaries.truncate(tree.start as usize);
        if let Some((shape, is_inverted)) = simple {
            return Test { shape, is_inverted };
        }
        if max <= 0xff {
            return self.plan_bytes(set, Above::Impossible);
        }
        let tree = self.plans.add_tree(set.above().iter().copied(), 0x100, max);
        match tree.indices().is_empty() {
            true => self.plan_bytes(set, Above::All(tree.starts_inside)),
            false => self.plan_bytes(set, Above::Tree(tree)),
        }
    }

    fn plan_bytes(&mut self, set: &Set, above: Above) -> Test {
        let (table, is_inverted) = self.tables.membership(set.latin1());
        Test {
            shape: Shape::Bytes { table, above },
            is_inverted,
        }
    }

    pub(crate) fn test_unit(&mut self, offset: i32, step: Step, branch: Branch) {
        let (c, test) = (self.frame.temporary(0), self.plan_for_step(step));
        self.load_unit(c, POSITION, offset);
        self.test_class(test, c, branch);
    }

    /// Overwrites `c` and the third temporary register.
    pub(crate) fn test_class(&mut self, test: Test, c: Gpr, branch: Branch) {
        self.prepare_test(test);
        self.holding_constant(|generator| generator.prepared_test(test, c, branch));
    }

    /// Does what a loop need not repeat.
    pub(crate) fn prepare_test(&mut self, test: Test) {
        match test.shape {
            Shape::Bits { bits, .. } => self.masm.move64(CONSTANT, Untrusted(bits)),
            Shape::Bytes { table, above } if !matches!(above, Above::Lookup { .. }) => {
                self.masm.move64(CONSTANT, table.address);
            }
            _ => {}
        }
    }

    pub(crate) fn prepared_test(&mut self, test: Test, c: Gpr, branch: Branch) {
        let inner = branch.inverted_if(test.is_inverted);
        match test.shape {
            Shape::Always => {
                if let Branch::If(target) = inner {
                    self.masm.jump(target);
                }
            }
            Shape::Range {
                mask,
                first,
                last,
                max,
            } => {
                if mask != 0 {
                    self.masm.or32(c, c, mask);
                }
                self.test_range(c, first, last, max, inner);
            }
            Shape::Bits { first, bits } => {
                let next = self.masm.new_label();
                let [_, outside] = inner.targets(next);
                self.masm.sub32(c, c, first);
                (self.masm).branch32(Cond::Above, c, bits.ilog2(), outside);
                let (cond, target) = inner.on_bits();
                self.masm.branch_test_bit64(cond, CONSTANT, c, target);
                self.masm.bind(next);
            }
            Shape::Tree(tree) => {
                let next = self.masm.new_label();
                self.test_tree(c, tree, inner.targets(next), Some(next));
                self.masm.bind(next);
            }
            Shape::Bytes { table, above } => {
                let next = self.masm.new_label();
                self.branch_if_above_latin1(c, above, branch.targets(next));
                if let Above::Lookup { .. } = above {
                    self.masm.move64(CONSTANT, table.address);
                }
                let (cond, target) = inner.on_bits();
                let byte = Address::indexed(CONSTANT, c, Scale::One, 0);
                self.masm.branch_test8(cond, byte, table.bit.into(), target);
                self.masm.bind(next);
            }
            Shape::Lookup { table, max } => {
                let next = self.masm.new_label();
                self.look_up(c, table, max, inner, next);
                self.masm.bind(next);
            }
        }
    }

    fn test_range(&mut self, c: Gpr, first: u32, last: u32, max: u32, branch: Branch) {
        let (cond, value) = if first == last {
            (Cond::Eq, first)
        } else if last == max {
            (Cond::AboveEq, first)
        } else {
            self.masm.sub32(c, c, first);
            (Cond::BelowEq, last - first)
        };
        let (cond, target) = branch.on(cond);
        self.masm.branch32(cond, c, value, target);
    }

    /// `next` is the label of what follows.
    fn test_tree(&mut self, c: Gpr, tree: Tree, targets: [Label; 2], next: Option<Label>) {
        let target = |is_inside: bool| targets[usize::from(!is_inside)];
        let count = tree.end - tree.start;
        if count == 0 {
            if Some(target(tree.starts_inside)) != next {
                self.masm.jump(target(tree.starts_inside));
            }
            return;
        }
        // Text has more characters above the controls and the punctuation that are singled out than below them.
        let middle = if count <= BOUNDARIES_COMPARED as u32 {
            tree.end - 1
        } else {
            tree.start + count / 2
        };
        let boundary = self.plans.boundaries[middle as usize];
        let lower = Tree {
            end: middle,
            ..tree
        };
        let upper = Tree {
            start: middle + 1,
            end: tree.end,
            starts_inside: tree.starts_inside == ((middle - tree.start) % 2 != 0),
        };
        if !upper.indices().is_empty() {
            let is_upper = self.masm.new_label();
            self.masm.branch32(Cond::AboveEq, c, boundary, is_upper);
            self.test_tree(c, lower, targets, None);
            self.masm.bind(is_upper);
            return self.test_tree(c, upper, targets, next);
        }
        if lower.indices().is_empty() && Some(target(upper.starts_inside)) == next {
            return (self.masm).branch32(Cond::Below, c, boundary, target(lower.starts_inside));
        }
        (self.masm).branch32(Cond::AboveEq, c, boundary, target(upper.starts_inside));
        self.test_tree(c, lower, targets, next);
    }

    fn branch_if_above_latin1(&mut self, c: Gpr, above: Above, targets: [Label; 2]) {
        let target = match above {
            Above::Impossible => return,
            Above::All(is_member) => targets[usize::from(!is_member)],
            Above::Tree(tree) => {
                self.defer(move |generator| generator.test_tree(c, tree, targets, None))
            }
            Above::Lookup { table, max } => self.defer(move |generator| {
                generator.look_up(c, table, max, Branch::If(targets[0]), targets[1]);
                generator.masm.jump(targets[1]);
            }),
        };
        self.masm.branch32(Cond::Above, c, 0xff, target);
    }

    fn look_up(&mut self, c: Gpr, table: Lookup, max: u32, branch: Branch, next: Label) {
        let word = self.frame.temporary(2);
        if table.limit <= max {
            let beyond = branch.targets(next)[usize::from(!table.contains_beyond_limit)];
            self.masm.branch32(Cond::AboveEq, c, table.limit, beyond);
        }
        let masm = &mut *self.masm;
        masm.shr32(word, c, 6);
        masm.move64(CONSTANT, table.index);
        masm.load16(word, Address::indexed(CONSTANT, word, Scale::Two, 0));
        masm.move64(CONSTANT, table.words);
        masm.load64(word, Address::indexed(CONSTANT, word, Scale::Eight, 0));
        let (cond, target) = branch.on_bits();
        masm.branch_test_bit64(cond, word, c, target);
    }
}
