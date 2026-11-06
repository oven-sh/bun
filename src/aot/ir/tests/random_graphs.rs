use super::graphs::{emit_read_marker, write_integer};
use super::handlers::emit_call;
use super::{Generator, print_alone};
use crate::ir::body::{BlockView, Body, TargetView, TerminatorView};
use crate::ir::builder::{Edge, FunctionBuilder, Handler, LocalVariable};
use crate::ir::generated::{Opcode, TerminatorKind};
use crate::ir::ids::{BlockId, Id};
use crate::ir::testing::{build_function, create_catch_handler};
use crate::ir::types::TypeTable;

const RANDOM_GRAPH_SEED: u64 = 1;
const RANDOM_GRAPH_COUNT: usize = 300;
const MIN_BLOCK_COUNT: usize = 2;
const MAX_BLOCK_COUNT: usize = 12;
const MAX_VARIABLE_COUNT: usize = 4;
const MAX_STEP_COUNT: usize = 4;
const WALK_COUNT: usize = 50;
const MAX_WALK_LENGTH: usize = 60;

#[derive(Copy, Clone, Debug)]
enum Step {
    Write { variable: usize, constant: i64 },
    Read { variable: usize },
}

#[derive(Copy, Clone, Debug)]
enum PlannedTerminator {
    Return,
    Jump(usize),
    Branch(usize, usize),
}

impl PlannedTerminator {
    fn targets(self) -> impl Iterator<Item = usize> {
        let (first, second) = match self {
            PlannedTerminator::Return => (None, None),
            PlannedTerminator::Jump(target) => (Some(target), None),
            PlannedTerminator::Branch(taken, not_taken) => (Some(taken), Some(not_taken)),
        };
        first.into_iter().chain(second)
    }

    fn target_after(self, is_taken: bool) -> Option<usize> {
        match self {
            PlannedTerminator::Return => None,
            PlannedTerminator::Jump(target) => Some(target),
            PlannedTerminator::Branch(taken, _) if is_taken => Some(taken),
            PlannedTerminator::Branch(_, not_taken) => Some(not_taken),
        }
    }
}

#[derive(Debug)]
struct PlannedBlock {
    steps: Vec<Step>,
    throwing_step: Option<usize>,
    terminator: PlannedTerminator,
}

#[derive(Debug)]
struct Plan {
    variable_count: usize,
    blocks: Vec<PlannedBlock>,
    landing_block: Option<usize>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Sealing {
    Early,
    Late,
}

#[derive(Copy, Clone)]
struct Choice {
    throws: bool,
    is_taken: bool,
}

#[derive(PartialEq, Eq, Debug, Default)]
struct Observation {
    constants: Vec<Option<i64>>,
    throw_count: usize,
}

struct PlanGenerator<'a> {
    generator: &'a mut Generator,
    block_count: usize,
    variable_count: usize,
    constant_count: i64,
}

impl PlanGenerator<'_> {
    fn create_write(&mut self, variable: usize) -> Step {
        self.constant_count += 1;
        Step::Write {
            variable,
            constant: self.constant_count,
        }
    }

    fn create_step(&mut self) -> Step {
        let variable = self.generator.below(self.variable_count);
        if self.generator.one_in(2) {
            self.create_write(variable)
        } else {
            Step::Read { variable }
        }
    }

    fn create_target(&mut self) -> usize {
        1 + self.generator.below(self.block_count - 1)
    }

    fn create_terminator(&mut self) -> PlannedTerminator {
        match self.generator.below(3) {
            0 => PlannedTerminator::Return,
            1 => PlannedTerminator::Jump(self.create_target()),
            _ => PlannedTerminator::Branch(self.create_target(), self.create_target()),
        }
    }

    fn create_block(&mut self, initialized_count: usize) -> PlannedBlock {
        let mut steps: Vec<Step> = (0..initialized_count)
            .map(|variable| self.create_write(variable))
            .collect();
        for _ in 0..self.generator.below(MAX_STEP_COUNT + 1) {
            steps.push(self.create_step());
        }
        PlannedBlock {
            steps,
            throwing_step: None,
            terminator: self.create_terminator(),
        }
    }

    fn cover_consecutive_blocks(&mut self, blocks: &mut [PlannedBlock]) {
        let first = self.create_target();
        let count = 1 + self.generator.below(self.block_count - first);
        for block in &mut blocks[first..first + count] {
            block.throwing_step = Some(self.generator.below(block.steps.len() + 1));
        }
    }
}

fn create_plan(generator: &mut Generator) -> Plan {
    let block_count = MIN_BLOCK_COUNT + generator.below(MAX_BLOCK_COUNT - MIN_BLOCK_COUNT + 1);
    let variable_count = 1 + generator.below(MAX_VARIABLE_COUNT);
    let mut plan_generator = PlanGenerator {
        generator,
        block_count,
        variable_count,
        constant_count: 0,
    };
    let mut blocks = vec![plan_generator.create_block(variable_count)];
    blocks.extend((1..block_count).map(|_| plan_generator.create_block(0)));
    let mut landing_block = None;
    if plan_generator.generator.one_in(3) {
        plan_generator.cover_consecutive_blocks(&mut blocks);
        landing_block = Some(blocks.len());
        blocks.push(plan_generator.create_block(0));
    }
    Plan {
        variable_count,
        blocks,
        landing_block,
    }
}

fn create_walk(generator: &mut Generator) -> Vec<Choice> {
    let create_choice = |_| Choice {
        throws: generator.one_in(3),
        is_taken: generator.one_in(2),
    };
    (0..MAX_WALK_LENGTH).map(create_choice).collect()
}

fn find_last_predecessors(plan: &Plan) -> Vec<Option<usize>> {
    let mut last_predecessors = vec![None; plan.blocks.len()];
    for (index, block) in plan.blocks.iter().enumerate() {
        for target in block.terminator.targets() {
            last_predecessors[target] = Some(index);
        }
    }
    last_predecessors
}

fn create_planned_block(
    builder: &mut FunctionBuilder,
    plan: &Plan,
    index: usize,
    handler: Option<Handler>,
) -> BlockId {
    if index == 0 {
        return builder.current_block();
    }
    match handler {
        Some(handler) if plan.landing_block == Some(index) => handler.block(),
        Some(_) if plan.blocks[index].throwing_step.is_some() => builder.create_block(handler),
        Some(_) | None => builder.create_block(None),
    }
}

fn fill_block(
    builder: &mut FunctionBuilder,
    planned: &PlannedBlock,
    variables: &[LocalVariable],
    blocks: &[BlockId],
) {
    builder.loop_hint();
    for index in 0..=planned.steps.len() {
        if planned.throwing_step == Some(index) {
            let callee = builder.parameter(1);
            emit_call(builder, callee);
        }
        match planned.steps.get(index) {
            Some(&Step::Write { variable, constant }) => {
                write_integer(builder, variables[variable], constant);
            }
            Some(&Step::Read { variable }) => emit_read_marker(builder, variables[variable]),
            None => {}
        }
    }
    match planned.terminator {
        PlannedTerminator::Return => builder.return_value(None),
        PlannedTerminator::Jump(target) => builder.jump(Edge::to(blocks[target])),
        PlannedTerminator::Branch(taken, not_taken) => {
            let condition = builder.parameter(0);
            let (taken, not_taken) = (Edge::to(blocks[taken]), Edge::to(blocks[not_taken]));
            builder.branch(condition, taken, not_taken);
        }
    }
}

fn fill_plan(builder: &mut FunctionBuilder, plan: &Plan, sealing: Sealing) {
    let variables: Vec<LocalVariable> = (0..plan.variable_count)
        .map(|_| builder.create_variable(None))
        .collect();
    let handler = plan.landing_block.map(|_| create_catch_handler(builder));
    let blocks: Vec<BlockId> = (0..plan.blocks.len())
        .map(|index| create_planned_block(builder, plan, index, handler))
        .collect();
    let last_predecessors = find_last_predecessors(plan);

    for (index, planned) in plan.blocks.iter().enumerate() {
        if sealing == Sealing::Early && last_predecessors[index].is_none() {
            builder.seal(blocks[index]);
        }
        builder.switch_to(blocks[index]);
        fill_block(builder, planned, &variables, &blocks);
        if sealing == Sealing::Early {
            for (target, &last_predecessor) in last_predecessors.iter().enumerate() {
                if last_predecessor == Some(index) {
                    builder.seal(blocks[target]);
                }
            }
        }
    }
    if sealing == Sealing::Late {
        for &block in &blocks {
            builder.seal(block);
        }
    }
}

fn run_plan(plan: &Plan, walk: &[Choice]) -> Observation {
    let mut constants = vec![None; plan.variable_count];
    let mut observation = Observation::default();
    let mut block = &plan.blocks[0];
    for choice in walk {
        let throwing_step = block.throwing_step.filter(|_| choice.throws);
        let step_count = throwing_step.unwrap_or(block.steps.len());
        for step in &block.steps[..step_count] {
            match *step {
                Step::Write { variable, constant } => constants[variable] = Some(constant),
                Step::Read { variable } => observation.constants.push(constants[variable]),
            }
        }
        let target = if throwing_step.is_some() {
            observation.throw_count += 1;
            plan.landing_block
        } else {
            block.terminator.target_after(choice.is_taken)
        };
        let Some(target) = target else {
            break;
        };
        block = &plan.blocks[target];
    }
    observation
}

enum BlockExit {
    WalkEnded,
    Threw,
    ReachedTerminator,
}

struct BodyRun<'a> {
    walk: &'a [Choice],
    visit_count: usize,
    environment: Vec<Option<i64>>,
    observation: Observation,
}

fn integer_constant(fields: &[u32]) -> i64 {
    ((u64::from(fields[1]) << 32) | u64::from(fields[0])) as i64
}

impl BodyRun<'_> {
    fn choice(&self) -> Choice {
        self.walk[self.visit_count - 1]
    }

    fn run_values(&mut self, block: BlockView<'_>) -> BlockExit {
        for value in block.values() {
            match value.opcode {
                Opcode::LoopHint if self.visit_count == self.walk.len() => {
                    return BlockExit::WalkEnded;
                }
                Opcode::LoopHint => self.visit_count += 1,
                Opcode::Integer => {
                    self.environment[value.id.index()] = Some(integer_constant(value.fields));
                }
                Opcode::TypeOf => {
                    let constant = self.environment[value.fields[0] as usize];
                    self.observation.constants.push(constant);
                }
                Opcode::Call if self.choice().throws => return BlockExit::Threw,
                Opcode::Call => {}
                opcode => panic!("no step emits {opcode:?}"),
            }
        }
        BlockExit::ReachedTerminator
    }

    fn find_target<'b>(&self, terminator: TerminatorView<'b>) -> Option<TargetView<'b>> {
        let index = match terminator.kind {
            TerminatorKind::Return => return None,
            TerminatorKind::Jump => 0,
            TerminatorKind::Branch => usize::from(!self.choice().is_taken),
            kind @ (TerminatorKind::Switch
            | TerminatorKind::SwitchString
            | TerminatorKind::ReturnCall
            | TerminatorKind::Throw
            | TerminatorKind::Rethrow
            | TerminatorKind::Unreachable) => panic!("no planned block ends in {kind:?}"),
        };
        let target = terminator.targets().nth(index);
        Some(target.expect("the terminator has a target for each choice"))
    }

    fn pass_arguments(&mut self, target: TargetView<'_>, block: BlockView<'_>) {
        let constants: Vec<Option<i64>> = target
            .arguments()
            .map(|argument| self.environment[argument.index()])
            .collect();
        assert_eq!(constants.len(), block.parameter_count());
        let first_parameter = block.first_parameter.index();
        let parameters = first_parameter..first_parameter + constants.len();
        self.environment[parameters].copy_from_slice(&constants);
    }
}

fn run_body(body: &Body, walk: &[Choice]) -> Observation {
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let mut run = BodyRun {
        walk,
        visit_count: 0,
        environment: vec![None; body.value_count as usize],
        observation: Observation::default(),
    };
    let mut block = blocks[0];
    loop {
        let target = match run.run_values(block) {
            BlockExit::WalkEnded => break,
            BlockExit::Threw => {
                run.observation.throw_count += 1;
                Some(
                    block
                        .handler()
                        .expect("a block with a throwing step is covered"),
                )
            }
            BlockExit::ReachedTerminator => run.find_target(block.terminator()),
        };
        let Some(target) = target else {
            break;
        };
        block = blocks[target.block.index()];
        run.pass_arguments(target, block);
    }
    run.observation
}

fn assert_plan_runs(plan: &Plan, sealing: Sealing, walks: &[Vec<Choice>]) -> Observation {
    let parameters = [TypeTable::BOOLEAN, TypeTable::ANYTHING];
    let function = build_function(&parameters, |builder| fill_plan(builder, plan, sealing));
    let mut all_walks = Observation::default();
    for (index, walk) in walks.iter().enumerate() {
        let expected = run_plan(plan, walk);
        assert_eq!(
            run_body(&function.body, walk),
            expected,
            "walk {index}, {sealing:?}, {plan:?}\n{}",
            print_alone(&function)
        );
        all_walks.constants.extend(expected.constants);
        all_walks.throw_count += expected.throw_count;
    }
    all_walks
}

#[test]
fn random_graphs_match_plans() {
    let mut generator = Generator::new(RANDOM_GRAPH_SEED);
    let (mut read_count, mut throw_count) = (0, 0);
    for _ in 0..RANDOM_GRAPH_COUNT {
        let plan = create_plan(&mut generator);
        let walks: Vec<Vec<Choice>> = (0..WALK_COUNT)
            .map(|_| create_walk(&mut generator))
            .collect();
        for sealing in [Sealing::Early, Sealing::Late] {
            let all_walks = assert_plan_runs(&plan, sealing, &walks);
            read_count += all_walks.constants.len();
            throw_count += all_walks.throw_count;
        }
    }
    assert!(read_count > 0, "no walk reads a variable");
    assert!(throw_count > 0, "no walk leaves for a landing block");
}

#[test]
fn thrown_walk_continues_with_values_at_throwing_step() {
    let write = |constant: i64| Step::Write {
        variable: 0,
        constant,
    };
    let read = Step::Read { variable: 0 };
    let plan = Plan {
        variable_count: 1,
        blocks: vec![
            PlannedBlock {
                steps: vec![write(1)],
                throwing_step: None,
                terminator: PlannedTerminator::Jump(1),
            },
            PlannedBlock {
                steps: vec![write(2), write(3)],
                throwing_step: Some(1),
                terminator: PlannedTerminator::Return,
            },
            PlannedBlock {
                steps: vec![read],
                throwing_step: None,
                terminator: PlannedTerminator::Return,
            },
        ],
        landing_block: Some(2),
    };
    let throwing = Choice {
        throws: true,
        is_taken: true,
    };
    let expected = Observation {
        constants: vec![Some(2)],
        throw_count: 1,
    };
    assert_eq!(run_plan(&plan, &[throwing; 3]), expected);
    for sealing in [Sealing::Early, Sealing::Late] {
        let all_walks = assert_plan_runs(&plan, sealing, &[vec![throwing; 3]]);
        assert_eq!(all_walks, expected);
    }
}
