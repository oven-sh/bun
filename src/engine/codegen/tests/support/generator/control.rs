//! Statements, and structured control flow.

#[path = "control_shapes.rs"]
mod shapes;

use bun_engine_asm::Cond;
use bun_engine_codegen::ir::{Binary, Block, Checked, Op, Successor, Type, Value, Variable};

use super::accesses::Pointer;
use super::sites::Site;
use super::{Class, Generator, Mark};
use crate::support::memory::Region;

/// A block whose parameters are the sum, unless a variable holds it, those that the caller manages, and values of
/// these classes.
#[derive(Clone)]
pub(super) struct Join {
    pub(super) block: Block,
    classes: Vec<Class>,
    managed: usize,
}

#[derive(Clone, Copy)]
enum Progress {
    By(i64),
    CheckedBy(i64),
    Halve,
    ClearLowestBit,
}

#[derive(Clone, Copy)]
enum Counter {
    Param(Value),
    Variable(Variable),
}

#[derive(Clone)]
pub(super) struct Loop {
    /// Is the header if `advances`.
    again: Join,
    advances: Option<(Counter, Progress)>,
    exit: Join,
}

pub(super) struct Way {
    target: Block,
    args: Vec<Value>,
    /// Of the last arguments.
    classes: Vec<Class>,
    is_rare: bool,
}

impl Way {
    fn successor(&self) -> Successor<'_> {
        Successor {
            target: self.target,
            args: &self.args,
            is_rare: self.is_rare,
        }
    }
}

#[derive(Clone, Copy)]
enum Statement {
    Theme,
    Template,
    Integer,
    Addressing,
    Float,
    Vector,
    Access,
    TrappingAccess,
    Atomic,
    Check,
    Patchpoint,
    Call,
    CallWithHandlers,
    Node,
    PinnedIndex,
    Variable,
    Branch,
    Loop,
    Switch,
    Graph,
    Pressure,
    Shape,
}

impl Generator<'_> {
    /// Control comes out at the end.
    pub(super) fn body(&mut self, mut budget: u32) {
        while budget != 0 {
            budget -= 1;
            self.statement(&mut budget);
        }
    }

    fn share_of(&mut self, budget: &mut u32) -> u32 {
        let share = self
            .random
            .below(*budget as usize + 1)
            .min(self.random.below(*budget as usize + 1) + 2) as u32;
        *budget -= share;
        share
    }

    fn statement(&mut self, budget: &mut u32) {
        let weights = self.shape.weights;
        let if_nests = |weight| {
            if self.nesting < self.shape.nesting {
                weight
            } else {
                0
            }
        };
        let if_turns = |weight| {
            if self.trips * 3 <= self.shape.trips {
                if_nests(weight)
            } else {
                0
            }
        };
        let statement = self.random.weighted(&[
            (weights.themes, Statement::Theme),
            (weights.templates, Statement::Template),
            (weights.integers, Statement::Integer),
            (weights.addressing, Statement::Addressing),
            (weights.floats, Statement::Float),
            (weights.vectors, Statement::Vector),
            (weights.accesses, Statement::Access),
            (weights.trapping_accesses, Statement::TrappingAccess),
            (weights.atomics, Statement::Atomic),
            (weights.checks, Statement::Check),
            (weights.patchpoints, Statement::Patchpoint),
            (weights.calls, Statement::Call),
            (weights.nodes, Statement::Node),
            (
                if_nests(weights.branches.min(weights.accesses) / 4),
                Statement::PinnedIndex,
            ),
            (
                if_nests(weights.calls.div_ceil(3)),
                Statement::CallWithHandlers,
            ),
            (weights.variables, Statement::Variable),
            (if_nests(weights.branches), Statement::Branch),
            (if_turns(weights.loops), Statement::Loop),
            (if_nests(weights.switches), Statement::Switch),
            (if_turns(weights.graphs), Statement::Graph),
            (if_nests(weights.pressure), Statement::Pressure),
            (if_nests(weights.shapes), Statement::Shape),
        ]);
        match statement {
            Statement::Theme => {
                let ty = self.data_type();
                let (value, class) = self.themed(ty);
                self.keep(value, class);
            }
            Statement::Template => self.template_statement(),
            Statement::Integer => {
                let ty = self.int_type();
                self.fresh_int(ty);
            }
            Statement::Float => {
                let ty = self.float_type();
                self.fresh_float(ty);
            }
            Statement::Vector => {
                self.fresh_vector();
            }
            Statement::Access => self.access_statement(),
            Statement::Addressing => self.addressing_statement(),
            Statement::TrappingAccess => self.trapping_access(),
            Statement::Atomic => self.atomic_statement(),
            Statement::Check => self.check_statement(),
            Statement::Patchpoint => self.patchpoint_statement(),
            Statement::Call => self.call_statement(),
            Statement::Node => self.node_statement(),
            Statement::Variable => self.variable_statement(budget),
            _ => {
                let share = self.share_of(budget);
                self.nesting += 1;
                match statement {
                    Statement::CallWithHandlers => self.call_with_handlers(share),
                    Statement::Branch => self.branch_statement(share),
                    Statement::PinnedIndex => self.pinned_index(share),
                    Statement::Loop => self.loop_statement(share),
                    Statement::Switch => self.switch_statement(share),
                    Statement::Graph => self.graph_statement(share),
                    Statement::Shape => self.shape_statement(share),
                    _ => self.pressure(share),
                }
                self.nesting -= 1;
            }
        }
    }

    // Blocks with parameters

    pub(super) fn join(&mut self, managed: &[Type]) -> Join {
        let count = self.random.below(self.shape.params as usize + 1);
        let classes: Vec<Class> = (0..count).map(|_| self.class_of_param()).collect();
        let block = self.function.new_block();
        let sum = self.sum_variable.is_none().then_some(Type::I64);
        for ty in sum
            .into_iter()
            .chain(managed.iter().copied())
            .chain(classes.iter().map(|class| class.ty()))
        {
            self.function.add_param(block, ty);
        }
        Join {
            block,
            classes,
            managed: managed.len(),
        }
    }

    /// The parameters after the sum.
    fn params_of(&self, join: &Join) -> Vec<Value> {
        self.function.params(join.block)[usize::from(self.sum_variable.is_none())..].to_vec()
    }

    /// Returns the managed parameters.
    pub(super) fn enter(&mut self, join: &Join) -> Vec<Value> {
        self.block = join.block;
        if self.sum_variable.is_none() {
            self.sum = self.function.params(join.block)[0];
        }
        let mut params = self.params_of(join);
        for (param, &class) in params.drain(join.managed..).zip(&join.classes) {
            if class == Class::Narrowable {
                self.use_narrowable(param);
            } else {
                self.keep(param, class);
            }
        }
        params
    }

    /// Lacks the sum, which `seal` adds. With `is_inside`, the block dominates this place.
    pub(super) fn way_to(&mut self, join: &Join, managed: &[Value], is_inside: bool) -> Way {
        let params = self.params_of(join).split_off(join.managed);
        let mut args = managed.to_vec();
        for (position, &class) in join.classes.iter().enumerate() {
            let other = self.random.below(params.len());
            let arg = match self.random.below(8) {
                0 | 1 if is_inside => params[position],
                2 | 3 if is_inside && join.classes[other].satisfies(class) => params[other],
                _ => self.value_of(class),
            };
            args.push(arg);
        }
        Way {
            target: join.block,
            args,
            classes: join.classes.clone(),
            is_rare: self.random.one_in(6),
        }
    }

    pub(super) fn seal(&mut self, ways: &mut [Way]) {
        if self.sum_variable.is_none() {
            for way in ways
                .iter_mut()
                .filter(|way| way.args.len() < self.function.params(way.target).len())
            {
                way.args.insert(0, self.sum);
            }
        }
    }

    pub(super) fn plain_way(&mut self) -> Way {
        Way {
            target: self.function.new_block(),
            args: Vec::new(),
            classes: Vec::new(),
            is_rare: self.random.one_in(6),
        }
    }

    pub(super) fn jump(&mut self, mut way: Way, mark: Mark) {
        self.use_up(mark);
        self.seal(std::slice::from_mut(&mut way));
        self.builder().jump(way.target, &way.args);
    }

    pub(super) fn branch(&mut self, condition: Value, mut ways: [Way; 2]) {
        self.seal(&mut ways);
        let successors = [ways[0].successor(), ways[1].successor()];
        if self.shape.folds {
            self.builder()
                .branch(condition, successors[0], successors[1]);
        } else {
            self.emit(Op::Branch(condition), Type::Void);
            self.function.set_successors(self.block, &successors);
        }
    }

    /// Takes the first way if `condition` is not zero.
    pub(super) fn branch_either_way(&mut self, condition: Value, [then, or]: [Way; 2]) {
        if self.random.one_in(3) {
            let inverse = self.compare_constant(Cond::Eq, condition, 0);
            self.branch(inverse, [or, then]);
        } else {
            self.branch(condition, [then, or]);
        }
    }

    /// Goes on in the first way.
    pub(super) fn branch_on_fuel(&mut self, fuel: Value, ways: [Way; 2]) {
        let next = ways[0].target;
        self.branch_either_way(fuel, ways);
        self.block = next;
    }

    pub(super) fn finish_with_return(&mut self, mark: Mark) {
        let mut results: Vec<Value> = self.results.clone()[1..]
            .iter()
            .map(|&ty| self.loose(ty).0)
            .collect();
        self.use_up(mark);
        results.insert(0, self.get_sum());
        self.builder().ret(&results);
    }

    fn leave(&mut self, mark: Mark) {
        if self.loops.is_empty() || self.random.one_in(4) {
            if self.shape.weights.patchpoints != 0 && self.random.one_in(4) {
                self.use_up(mark);
                let sum = self.get_sum();
                self.terminal_patchpoint(&[], sum);
                return;
            }
            return self.finish_with_return(mark);
        }
        let outward = if self.random.flip() {
            0
        } else {
            self.random.below(self.loops.len())
        };
        let target = self.loops[self.loops.len() - 1 - outward].clone();
        let way = match target.advances {
            _ if self.random.flip() => self.way_to(&target.exit, &[], false),
            Some((counter, progress)) => {
                let next = self.advance(counter, progress).1;
                self.way_to(&target.again, next.as_slice(), true)
            }
            None => self.way_to(&target.again, &[], false),
        };
        self.jump(way, mark);
    }

    // Branches

    fn arm(&mut self, budget: u32, join: &Join, leaves: bool) {
        let mark = self.mark();
        self.body(budget);
        if leaves {
            self.leave(mark);
        } else {
            let way = self.way_to(join, &[], false);
            self.jump(way, mark);
        }
        self.restore(mark);
    }

    fn branch_statement(&mut self, mut budget: u32) {
        let join = self.join(&[]);
        let kind = self.random.below(16);
        let mut later = None;
        let (condition, learnt) = match kind {
            12 | 13 => {
                let (condition, related) = self.related_conditions();
                later = Some(related);
                (condition, None)
            }
            0..4 => {
                let (holds, value, class) = self.guard();
                (holds, Some((value, class)))
            }
            4..7 => (self.unlikely_condition(), None),
            7 => {
                let ty = self.int_type();
                let any = self.known_int(ty);
                let low = self.binary_constant(Binary::And, any, 7);
                (self.compare_constant(Cond::Above, low, 7), None)
            }
            _ => (self.condition(), None),
        };
        let has_arms = match kind {
            8 => [false, false],
            9..12 => self.random.pick(&[[true, false], [false, true]]),
            _ => [true, true],
        };
        let ways = has_arms.map(|has_arm| {
            if has_arm {
                self.plain_way()
            } else {
                self.way_to(&join, &[], false)
            }
        });
        let [then, or] = [ways[0].target, ways[1].target];
        if let Some(related) = later {
            let early = self.emit(related, Type::I32);
            self.scope.conditions.extend([early; 3]);
        }
        self.branch_either_way(condition, ways);
        let leaving = if (4..7).contains(&kind) || self.random.one_in(5) {
            self.random.pick(&[0, 0, 0, 1])
        } else {
            2
        };
        if kind == 7 {
            self.block = then;
            self.builder().unreachable();
        } else if has_arms[0] {
            self.block = then;
            let (mark, share) = (self.mark(), self.share_of(&mut budget));
            if let Some((value, class)) = learnt {
                self.learn(value, class);
                self.use_guarded(value, class);
            }
            self.arm(share, &join, leaving == 0);
            self.restore(mark);
        }
        if has_arms[1] {
            self.block = or;
            self.arm(budget, &join, leaving == 1 && kind != 7);
        }
        self.enter(&join);
    }

    /// An address can be read wherever it can be computed if that is below the branch only.
    fn pinned_index(&mut self, budget: u32) {
        let ty = self.int_type();
        let (index, divisor) = (self.known_int(ty), self.value_of(Class::Divisor(ty)));
        let (below, how) = (self.random.pick(&[4, 8, 13]), self.random.below(5));
        if self.random.flip() {
            let early = self.pinned(index, how, divisor);
            self.keep(early, Class::Data(ty));
        }
        let (fits, join) = (
            self.compare_constant(Cond::Below, index, below.into()),
            self.join(&[]),
        );
        let ways = [self.plain_way(), self.way_to(&join, &[], false)];
        let arm = ways[0].target;
        self.branch_either_way(fits, ways);
        self.block = arm;
        let mark = self.mark();
        let pinned = self.pinned(index, how, divisor);
        let is_guarded = false;
        self.learn(
            pinned,
            Class::Index {
                ty,
                below,
                is_guarded,
            },
        );
        let loaded = self.load_trusting(pinned, below);
        self.keep(loaded, Class::Data(Type::I64));
        self.use_up(mark);
        self.arm(budget, &join, false);
        self.restore(mark);
        self.enter(&join);
    }

    fn use_guarded(&mut self, value: Value, class: Class) {
        if let Class::Divisor(ty) = class {
            let op = self.random.pick(&[
                Binary::Div,
                Binary::Rem,
                Binary::UnsignedDiv,
                Binary::UnsignedRem,
            ]);
            let dividend = self.int(ty);
            let result = self.binary(op, dividend, value);
            let mark = self.mark();
            self.keep(result, Class::Data(ty));
            self.use_up(mark);
        } else if self.shape.weights.accesses != 0 {
            let mark = self.mark();
            self.access_statement();
            self.use_up(mark);
        }
    }

    // Loops

    fn read(&mut self, counter: Counter) -> Value {
        match counter {
            Counter::Param(param) => param,
            Counter::Variable(variable) => self.builder().get(variable),
        }
    }

    /// The next value, and the argument for the header.
    fn advance(&mut self, counter: Counter, progress: Progress) -> (Value, Option<Value>) {
        let current = self.read(counter);
        let next = match progress {
            Progress::By(step) if self.random.one_in(4) => {
                self.binary_constant(Binary::Sub, current, -step)
            }
            Progress::By(step) => self.binary_constant(Binary::Add, current, step),
            Progress::CheckedBy(step) => {
                let step = self.constant(self.type_of(current), step);
                self.checked(Checked::Add, current, step)
            }
            Progress::Halve => self.binary_constant(Binary::Shr, current, 1),
            Progress::ClearLowestBit => {
                let below = self.binary_constant(Binary::Add, current, -1);
                self.commutative(Binary::And, current, below)
            }
        };
        match counter {
            Counter::Param(_) => (next, Some(next)),
            Counter::Variable(variable) => {
                self.builder().set(variable, next);
                (next, None)
            }
        }
    }

    fn loop_statement(&mut self, budget: u32) {
        let allowed = self.shape.trips / self.trips;
        let most = self.random.pick(&[2, 3, 4, 6, 8, 16, 32]).min(allowed);
        let tests_first = self.random.flip();
        let mut ty = self.int_type();
        let count = self.value_of(Class::Index {
            ty,
            below: most + 1,
            is_guarded: true,
        });
        let index = |below| Class::Index {
            ty,
            below,
            is_guarded: true,
        };
        let step = self.random.pick(&[1, 1, 1, 2, 3]);
        let (first, progress, cond, limit, class) = match self.random.below(10) {
            0 | 1 => {
                let cond = if tests_first && step == 1 {
                    self.random.pick(&[Cond::Ne, Cond::Gt])
                } else {
                    Cond::Gt
                };
                (
                    count,
                    Progress::By(-step),
                    cond,
                    self.constant(ty, 0),
                    index(most + 1),
                )
            }
            2 => {
                let progress = self
                    .random
                    .pick(&[Progress::Halve, Progress::ClearLowestBit]);
                let any = self.int(ty);
                let first = self.binary_constant(Binary::And, any, (1 << most.min(31)) - 1);
                (
                    first,
                    progress,
                    Cond::Ne,
                    self.constant(ty, 0),
                    Class::Data(ty),
                )
            }
            3 if self.shape.weights.accesses != 0 => {
                let (stride, most) = (self.random.pick(&[1, 4, 8]), most.min(14));
                let steps = self.value_of(Class::Index {
                    ty: Type::I64,
                    below: most + 1,
                    is_guarded: true,
                });
                let start = self.address_in(Region::Arrays, 0);
                let length = self.binary_constant(Binary::Mul, steps, stride.into());
                let end = self.binary(Binary::Add, start, length);
                let cond = if tests_first {
                    self.random.pick(&[Cond::Ne, Cond::Below])
                } else {
                    Cond::Below
                };
                ty = Type::I64;
                let class = Class::Pointer(Pointer::walking(Region::Arrays, 0, stride, most));
                (start, Progress::By(stride.into()), cond, end, class)
            }
            kind => {
                let start = self.random.pick(&[0, 0, 0, 1]);
                let cond = if tests_first && step == 1 && start == 0 {
                    self.random.pick(&[Cond::Ne, Cond::Lt, Cond::Below])
                } else {
                    self.random.pick(&[Cond::Lt, Cond::Below, Cond::Le])
                };
                let progress = if kind == 4 {
                    Progress::CheckedBy(step)
                } else {
                    Progress::By(step)
                };
                let below = most.max(2) + u32::from(cond == Cond::Le);
                (
                    self.constant(ty, start),
                    progress,
                    cond,
                    count,
                    index(below),
                )
            }
        };

        let variable = (self.shape.weights.variables != 0 && self.random.flip())
            .then(|| self.function.add_variable(ty));
        let header = self.join(if variable.is_some() {
            &[]
        } else {
            std::slice::from_ref(&ty)
        });
        let exit = self.join(&[]);
        if let Some(variable) = variable {
            self.builder().set(variable, first);
        }
        let way = self.way_to(
            &header,
            if variable.is_some() {
                &[]
            } else {
                std::slice::from_ref(&first)
            },
            false,
        );
        self.jump(way, self.mark());
        let before = self.mark();
        let managed = self.enter(&header);
        let counter = variable.map_or_else(|| Counter::Param(managed[0]), Counter::Variable);
        let outer_trips = self.trips;
        self.trips *= most + 1;

        if tests_first {
            if self.random.one_in(3) {
                self.body(1);
            }
            let current = self.read(counter);
            let goes_on = self.compare(cond, current, limit);
            let ways = [self.plain_way(), self.way_to(&exit, &[], false)];
            let body = ways[0].target;
            self.branch_either_way(goes_on, ways);
            let after_test = self.mark();
            self.block = body;
            self.learn(current, class);
            self.loops.push(Loop {
                again: header.clone(),
                advances: Some((counter, progress)),
                exit: exit.clone(),
            });
            self.body(budget);
            self.loops.pop();
            let next = self.advance(counter, progress).1;
            let way = self.way_to(&header, next.as_slice(), true);
            self.jump(way, before);
            self.restore(after_test);
        } else {
            let after_header = self.mark();
            let current = self.read(counter);
            self.learn(current, class);
            let latch = self.random.flip().then(|| self.join(&[]));
            if let Some(latch) = &latch {
                self.loops.push(Loop {
                    again: latch.clone(),
                    advances: None,
                    exit: exit.clone(),
                });
            }
            self.body(budget);
            if let Some(latch) = &latch {
                self.loops.pop();
                let way = self.way_to(latch, &[], false);
                self.jump(way, after_header);
                self.restore(after_header);
                self.enter(latch);
            }
            let (next, arg) = self.advance(counter, progress);
            let goes_on = self.compare(cond, next, limit);
            let ways = [
                self.way_to(&header, arg.as_slice(), true),
                self.way_to(&exit, &[], false),
            ];
            self.use_up(before);
            self.branch_either_way(goes_on, ways);
            self.restore(after_header);
        }
        self.trips = outer_trips;
        self.enter(&exit);
    }

    // Switches

    /// Ends the block, and can take any of the ways, of which there are at least two.
    pub(super) fn choose_among(&mut self, mut ways: Vec<Way>, mark: Mark) -> Option<Site> {
        let count = ways.len();
        let ty = self.int_type();
        match self.random.below(8) {
            0 if self.shape.weights.patchpoints != 0 => {
                let chooser = self.int(ty);
                self.use_up(mark);
                self.seal(&mut ways);
                let successors: Vec<_> = ways.iter().map(Way::successor).collect();
                let site = if self.shape.weights.nodes != 0 && self.random.flip() {
                    self.terminal_node(&successors, chooser)
                } else {
                    self.terminal_patchpoint(&successors, chooser)
                };
                self.pass_on(site.0, &ways);
                return Some(site);
            }
            1 | 2 => {
                let length = self.random.between(1, 3 * count as i64) as u32;
                let index = self.value_of(Class::Index {
                    ty: Type::I32,
                    below: length,
                    is_guarded: true,
                });
                let table: Vec<u32> = (0..length)
                    .map(|_| self.random.below(count) as u32)
                    .collect();
                self.use_up(mark);
                self.seal(&mut ways);
                let successors: Vec<_> = ways.iter().map(Way::successor).collect();
                self.builder().jump_table(index, table, &successors);
            }
            _ => {
                let range = (count as u32 * self.random.pick(&[1, 1, 2, 4])).next_power_of_two();
                let stride = self.random.pick(&[1, 1, 1, 2, 7, 1000, 0x1000_0001]);
                let base = if self.random.flip() {
                    0
                } else {
                    self.number(ty)
                };
                let index = self.value_of(Class::Index {
                    ty,
                    below: range,
                    is_guarded: true,
                });
                let value = match (stride, base) {
                    _ if self.random.one_in(8) => self.int(ty),
                    (1, 0) => index,
                    _ => {
                        let scaled = self.binary_constant(Binary::Mul, index, stride);
                        self.binary_constant(Binary::Add, scaled, base)
                    }
                };
                let mut keys: Vec<i64> = (0..i64::from(range))
                    .map(|n| base.wrapping_add(n * stride))
                    .collect();
                if ty == Type::I32 {
                    keys.iter_mut().for_each(|key| *key = (*key as i32).into());
                }
                self.random.shuffle(&mut keys);
                self.use_up(mark);
                self.seal(&mut ways);
                let cases: Vec<_> = keys
                    .into_iter()
                    .zip(ways[1..].iter().map(Way::successor))
                    .collect();
                self.builder().switch(value, &cases, ways[0].successor());
            }
        }
        None
    }

    /// Makes the result of the end of the block an argument of some of its first edges.
    fn pass_on(&mut self, result: Value, ways: &[Way]) {
        let ty = self.type_of(result);
        for (edge, way) in self.function.successors(self.block).zip(ways) {
            let args = self.function.args_mut(edge).iter_mut().rev();
            for (arg, &class) in args.zip(way.classes.iter().rev()) {
                if ty.is_data() && Class::Data(ty).satisfies(class) && self.random.flip() {
                    *arg = result;
                }
            }
        }
    }

    fn call_with_handlers(&mut self, mut budget: u32) {
        let join = self.join(&[]);
        let handlers: Vec<Join> = (0..self.random.between(1, 2))
            .map(|_| self.join(&[]))
            .collect();
        let has_arm = self.random.flip();
        let mut ways = vec![if has_arm {
            self.plain_way()
        } else {
            self.way_to(&join, &[], false)
        }];
        for handler in &handlers {
            ways.push(self.way_to(handler, &[], false));
        }
        self.seal(&mut ways);
        let successors: Vec<_> = ways.iter().map(Way::successor).collect();
        let before = self.mark();
        let site = self.terminal_call(&successors);
        self.pass_on(site.0, &ways[..1]);
        if has_arm {
            let (mark, share) = (self.mark(), self.share_of(&mut budget));
            self.block = ways[0].target;
            self.keep_results(site);
            self.use_up(mark);
            self.arm(share, &join, false);
            self.restore(mark);
        }
        for handler in &handlers {
            let (mark, share) = (self.mark(), self.share_of(&mut budget));
            let leaves = self.random.one_in(3);
            self.enter(handler);
            self.use_up(mark);
            self.arm(share, &join, leaves);
            self.restore(mark);
        }
        self.enter(&join);
        self.use_up(before);
    }

    fn switch_statement(&mut self, mut budget: u32) {
        let join = self.join(&[]);
        let arms: Vec<Join> = (0..self.random.between(1, 4))
            .map(|_| self.join(&[]))
            .collect();
        let count = self.random.pick(&[1, 2, 3, 5, 8, 14, 40]);
        let shares_args = self.random.flip();
        let mut ways: Vec<Way> = Vec::new();
        for _ in 0..count {
            let target = arms.get(self.random.below(arms.len() + 1)).unwrap_or(&join);
            let way = match ways.iter().find(|way| way.target == target.block) {
                Some(way) if shares_args || count > 8 => Way {
                    args: way.args.clone(),
                    classes: way.classes.clone(),
                    ..*way
                },
                _ => self.way_to(target, &[], false),
            };
            ways.push(way);
        }
        ways.push(self.way_to(&join, &[], false));
        self.random.shuffle(&mut ways);
        let site = self.choose_among(ways, self.mark());
        for (position, arm) in arms.iter().enumerate() {
            let (mark, share) = (self.mark(), self.share_of(&mut budget));
            self.enter(arm);
            site.into_iter().for_each(|site| self.keep_results(site));
            self.body(share);
            if self.random.one_in(5) {
                self.leave(mark);
            } else {
                let next = arms.get(position + 1).filter(|_| self.random.one_in(3));
                let way = self.way_to(next.unwrap_or(&join), &[], false);
                self.jump(way, mark);
            }
            self.restore(mark);
        }
        self.enter(&join);
        site.into_iter().for_each(|site| self.keep_results(site));
    }

    // The rest

    fn variable_statement(&mut self, budget: &mut u32) {
        let (variable, class) = self.random.pick(&self.variables);
        match self.random.below(12) {
            0..5 => {
                let value = self.builder().get(variable);
                self.keep(value, class);
            }
            5..11 => {
                let value = self.value_of(class);
                self.builder().set(variable, value);
            }
            _ => self.set_on_one_path(class, budget),
        }
    }

    /// The variable has no value on the path on which it is not read.
    fn set_on_one_path(&mut self, class: Class, budget: &mut u32) {
        let variable = self.function.add_variable(class.ty());
        let condition = self.condition();
        for reads in [false, true] {
            let join = self.join(&[]);
            let ways = [self.plain_way(), self.way_to(&join, &[], false)];
            let arm = ways[0].target;
            self.branch(condition, ways);
            self.block = arm;
            let mark = self.mark();
            if reads {
                let value = self.builder().get(variable);
                self.keep(value, class.guarded());
            } else {
                let value = self.value_of(class);
                self.builder().set(variable, value);
            }
            let way = self.way_to(&join, &[], false);
            self.jump(way, mark);
            self.restore(mark);
            self.enter(&join);
            let share = self.share_of(budget).min(2);
            self.body(share);
        }
    }

    fn pressure(&mut self, budget: u32) {
        let mark = self.mark();
        let held: Vec<Value> = (0..self.random.between(8, 40))
            .map(|_| {
                let ty = self.data_type();
                let value = if ty.is_int() {
                    self.fresh_int(ty)
                } else {
                    self.data(ty)
                };
                self.learn(value, Class::Data(ty));
                value
            })
            .collect();
        self.use_up(mark);
        self.body(budget + 1);
        held.into_iter().for_each(|value| self.add_to_sum(value));
    }
}
