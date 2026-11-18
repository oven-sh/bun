//! Dominators, the construction of SSA form and switches, on more blocks, variables and keys than random programs have.

mod support;

use bun_engine_codegen::analysis::{Cfg, Dominators};
use bun_engine_codegen::ir::{
    Block, Builder, Entity, Function, Op, Successor, Type, Value, Variable,
};
use support::harness::number_setting;
use support::random::Random;
use support::sketch::{add_entry, assert_same, case, count, empty_function, run_passes};

fn seeds(default_count: u64) -> std::ops::Range<u64> {
    let first = number_setting("SEED", 0);
    first..first + number_setting("COUNT", default_count)
}

/// Every node leads to the next, and the one after the last is the exit.
struct Graph {
    entries: usize,
    other_successor: Vec<Option<usize>>,
}

impl Graph {
    fn draw(random: &mut Random) -> Self {
        let entries = random.pick(&[1, 1, 2, 3]);
        let count = entries + random.pick(&[2, 5, 12, 40, 150]);
        let reach = random.pick(&[2, 4, 10, 1000]);
        let (forward, backward) = (random.pick(&[10, 40, 80]), random.pick(&[0, 5, 20, 50]));
        let favourite = random.between(entries as i64, count as i64);
        let other = |node: usize| {
            let (least, node, greatest) = (entries as i64, node as i64, count as i64);
            let target = if random.percent(backward) {
                random.between(node - reach, node)
            } else if random.percent(forward) {
                random.between(node + 1, node + 1 + reach)
            } else if random.percent(20) {
                favourite
            } else {
                return None;
            };
            Some(target.clamp(least, greatest) as usize)
        };
        Self {
            entries,
            other_successor: (0..count).map(other).collect(),
        }
    }

    /// Calls `fill` for each node and the exit, where it gives the result.
    fn build(
        &self,
        function: &mut Function,
        mut fill: impl FnMut(&mut Builder<'_>, usize) -> Value,
    ) {
        let count = self.other_successor.len();
        let (fuel, choices) = (
            function.add_variable(Type::I32),
            function.add_variable(Type::I64),
        );
        let new_block = |node| match node < self.entries {
            true => add_entry(function, &[Type::I32, Type::I64]).0,
            false => function.new_block(),
        };
        let blocks: Vec<Block> = (0..=count).map(new_block).collect();
        for (node, &block) in blocks.iter().enumerate() {
            let mut builder = Builder::at_end(function, block);
            if let &[initial_fuel, initial_choices] = builder.params(block) {
                builder.set(fuel, initial_fuel);
                builder.set(choices, initial_choices);
            }
            let result = fill(&mut builder, node);
            let next = blocks.get((node + 1).max(self.entries));
            match (next, self.other_successor.get(node).copied().flatten()) {
                (None, _) => builder.ret(&[result]),
                (Some(&next), None) => builder.jump(next, &[]),
                (Some(&next), Some(other)) => {
                    let bits = builder.get(choices);
                    let turned =
                        builder.binary(bun_engine_codegen::ir::Binary::RotateLeft, bits, 1);
                    builder.set(choices, turned);
                    let mut condition = builder.less_than(bits, 0);
                    if other <= node {
                        let left = builder.get(fuel);
                        let less = builder.add(left, -1);
                        builder.set(fuel, less);
                        let has_fuel = builder.greater_than(left, 0);
                        condition = builder.and(condition, has_fuel);
                    }
                    builder.branch(condition, blocks[other], next);
                }
            }
        }
    }
}

#[test]
fn dominators_are_what_cannot_be_avoided() {
    for seed in seeds(80) {
        let mut function = empty_function();
        Graph::draw(&mut Random::new(seed)).build(&mut function, |builder, _| builder.const64(0));
        let cfg = Cfg::new(&function);
        let dominators = Dominators::new(&function, &cfg);
        for &avoided in cfg.order() {
            let mut is_reached = vec![false; function.block_count()];
            let mut pending: Vec<Block> =
                function.entries().iter().map(|entry| entry.block).collect();
            while let Some(block) = pending.pop() {
                if block != avoided && !std::mem::replace(&mut is_reached[block.index()], true) {
                    pending.extend(function.successors(block).map(|edge| function.target(edge)));
                }
            }
            for &block in cfg.order() {
                let dominates = dominators.dominates(avoided, block);
                assert_eq!(dominates, !is_reached[block.index()], "seed {seed}");
                let mut above = std::iter::successors(Some(block), |&at| dominators.parent(at));
                let common = above.find(|&at| dominators.dominates(at, avoided));
                assert_eq!(dominators.common_dominator(block, avoided), common);
            }
        }
    }
}

/// With `sets_zero`, the entries set all variables to zero. The seed gives the same function otherwise.
fn function_with_variables(seed: u64, sets_zero: bool) -> Function {
    let mut random = Random::new(seed);
    let graph = Graph::draw(&mut random);
    let mut function = empty_function();
    let variables: Vec<Variable> = (0..random.pick(&[1, 3, 20, 70, 300]))
        .map(|_| function.add_variable(Type::I64))
        .collect();
    let sum = function.add_variable(Type::I64);
    let (window, nodes) = (random.pick(&[2, 8, 1000]), graph.other_successor.len() + 1);
    let copies_percent = random.pick(&[0, 30]);
    graph.build(&mut function, |builder, node| {
        if node < graph.entries && sets_zero {
            let zero = builder.const64(0);
            for &variable in variables.iter().chain([&sum]) {
                builder.set(variable, zero);
            }
        }
        let centre = (node * variables.len() / nodes) as i64;
        let nearby = |random: &mut Random| {
            let (least, greatest) = ((centre - window).max(0), centre + window);
            variables[random.between(least, greatest.min(variables.len() as i64 - 1)) as usize]
        };
        for _ in 0..random.below(8) {
            let variable = nearby(&mut random);
            if random.percent(copies_percent) {
                let value = builder.get(nearby(&mut random));
                builder.set(variable, value);
            } else if random.flip() {
                let (old, value) = (builder.get(sum), builder.get(variable));
                let stirred = builder.mul(old, 31);
                let new = builder.add(stirred, value);
                builder.set(sum, new);
            } else {
                let old = builder.get(sum);
                let value = builder.add(old, random.between(1, 1000));
                builder.set(variable, value);
            }
        }
        builder.get(sum)
    });
    function
}

fn assert_all_params_are_used(function: &Function) {
    let cfg = Cfg::new(function);
    let mut is_used = vec![false; function.value_count()];
    let mut pending: Vec<Value> = Vec::new();
    for &block in cfg.order() {
        for value in function.instructions(block) {
            pending.extend(function.operands(value));
        }
    }
    while let Some(value) = pending.pop() {
        if !std::mem::replace(&mut is_used[value.index()], true)
            && let Op::Param(position) = *function.op(value)
        {
            let edges = cfg.predecessors(function.block_of(value)).iter();
            pending.extend(edges.map(|&edge| function.args(edge)[position as usize]));
        }
    }
    for &block in &cfg.order()[function.entries().len()..] {
        let is_entry = cfg.predecessors(block).is_empty();
        for &param in function.params(block) {
            assert!(
                is_entry || is_used[param.index()],
                "{param:?}\n{function:?}"
            );
        }
    }
}

#[test]
fn variables_become_parameters() {
    for seed in seeds(80) {
        let reference = function_with_variables(seed, true);
        let mut random = Random::new(seed);
        let input = |_| {
            let args = vec![random.below(30) as u128, random.next().into()];
            (random.below(reference.entries().len()), args)
        };
        let case = case(&reference, &(0..4).map(input).collect::<Vec<_>>());
        for sets_zero in [false, true] {
            let mut function = function_with_variables(seed, sets_zero);
            run_passes(&mut function, &["construct_ssa"]);
            assert_same(&case, &function);
            let is_left = |op: &Op| matches!(op, Op::GetVariable(_) | Op::SetVariable(..));
            assert_eq!(count(&function, is_left) + function.variable_count(), 0);
            assert_all_params_are_used(&function);
        }
    }
}

#[test]
fn a_variable_that_a_loop_does_not_set_needs_no_parameter() {
    let mut function = empty_function();
    let (entry, params) = add_entry(&mut function, &[Type::I64]);
    let [kept, counter] = [(); 2].map(|()| function.add_variable(Type::I64));
    let [header, exit] = [(); 2].map(|()| function.new_block());
    let mut builder = Builder::at_end(&mut function, entry);
    builder.set(kept, params[0]);
    builder.jump(header, &[]);
    builder.switch_to(header);
    let old = builder.get(counter);
    let new = builder.add(old, 1);
    builder.set(counter, new);
    let same = builder.get(kept);
    builder.set(kept, same);
    let goes_on = builder.below(new, 3);
    builder.branch(goes_on, header, exit);
    builder.switch_to(exit);
    let result = builder.get(kept);
    builder.ret(&[result]);
    run_passes(&mut function, &["construct_ssa"]);
    assert_eq!(function.params(header).len(), 1);
    assert_eq!(function.operands(function.last(exit)), params);
}

/// Goes to one of `targets` blocks by the first parameter. The last destination is the default.
fn switch(ty: Type, mask: Option<i64>, cases: &[(i64, Destination)], targets: usize) -> Function {
    let mut function = empty_function();
    let (entry, params) = add_entry(&mut function, &[ty]);
    let blocks: Vec<Block> = (0..targets).map(|_| function.new_block()).collect();
    for (number, &block) in blocks.iter().enumerate() {
        let params: Vec<Value> = (0..number % 3 * 3)
            .map(|_| function.add_param(block, Type::I64))
            .collect();
        let mut builder = Builder::at_end(&mut function, block);
        let number = builder.const64(1000 * number as i64);
        let sum = params
            .into_iter()
            .fold(number, |sum, param| builder.add(param, sum));
        builder.ret(&[sum]);
    }
    let args: Vec<Vec<Value>> = cases
        .iter()
        .map(|(_, to)| vec![function.const64(to.arg); to.target % 3 * 3])
        .collect();
    let successor = |(&(key, to), args): (&(i64, Destination), &'_ Vec<Value>)| {
        (key, blocks[to.target], to.is_rare, args.clone())
    };
    let all: Vec<_> = cases.iter().zip(&args).map(successor).collect();
    let mut successors: Vec<(i64, Successor<'_>)> = all
        .iter()
        .map(|(key, target, is_rare, args)| {
            let (target, is_rare) = (*target, *is_rare);
            (
                *key,
                Successor {
                    target,
                    args,
                    is_rare,
                },
            )
        })
        .collect();
    let default = successors.pop().unwrap().1;
    let mut builder = Builder::at_end(&mut function, entry);
    let subject = mask.map_or(params[0], |mask| builder.and(params[0], mask));
    builder.switch(subject, &successors, default);
    function
}

#[derive(Clone, Copy)]
struct Destination {
    target: usize,
    arg: i64,
    is_rare: bool,
}

fn to(target: usize) -> Destination {
    Destination {
        target,
        arg: 0,
        is_rare: false,
    }
}

fn narrowed(ty: Type, key: i64) -> i64 {
    if ty == Type::I32 {
        (key as i32).into()
    } else {
        key
    }
}

#[test]
fn switches_go_where_they_went() {
    const STARTS: [i64; 12] = [
        0,
        1,
        5,
        -3,
        -70,
        40,
        i32::MIN as i64,
        i32::MAX as i64 - 20,
        u32::MAX as i64 - 20,
        i64::MIN,
        i64::MAX - 20,
        1 << 40,
    ];
    for seed in seeds(150) {
        let mut random = Random::new(seed);
        let ty = random.pick(&[Type::I32, Type::I64]);
        let targets = random.pick(&[2, 3, 4, 5, 9, 30]);
        let (rare, stays, args) = (
            random.pick(&[0, 0, 50, 90, 100]),
            random.pick(&[0, 50, 90]),
            random.pick(&[1, 1, 3]),
        );
        let destination = |random: &mut Random| Destination {
            target: random.below(targets),
            arg: random.below(args) as i64,
            is_rare: random.percent(rare),
        };
        let mut cases = std::collections::BTreeMap::new();
        for _ in 0..random.below(5) {
            let (mut key, gap) = (random.pick(&STARTS), random.pick(&[1, 1, 2, 4, 9, 100]));
            let mut current = destination(&mut random);
            for _ in 0..random.pick(&[1, 2, 4, 7, 12, 40, 70]) {
                cases.insert(narrowed(ty, key), current);
                key = key.wrapping_add(random.between(1, gap));
                if !random.percent(stays) {
                    current = destination(&mut random);
                }
            }
        }
        let mut cases: Vec<_> = cases.into_iter().collect();
        random.shuffle(&mut cases);
        let around_keys = cases
            .iter()
            .flat_map(|&(key, _)| [-1, 0, 1, 32, 64, 1 << 32].map(|by| key.wrapping_add(by)));
        let bits = |key: i64| u128::from(key as u64) & u128::MAX >> (128 - 8 * ty.bytes());
        let inputs: Vec<_> = around_keys
            .chain(STARTS)
            .map(|key| (0, vec![bits(key)]))
            .collect();
        cases.push((0, destination(&mut random)));
        let mask = random.pick(&[None, None, None, Some(7), Some(31), Some(63), Some(255)]);
        let mut function = switch(ty, mask, &cases, targets);
        let case = case(&function, &inputs);
        run_passes(&mut function, &["lower_switches"]);
        assert_same(&case, &function);
        assert_eq!(count(&function, |op| matches!(op, Op::Switch(..))), 0);
    }
}

/// The number of branches and of jump tables.
fn lowered(mask: Option<i64>, cases: &[(i64, Destination)]) -> (usize, usize) {
    let targets = cases.iter().map(|(_, to)| to.target + 1).max().unwrap();
    let mut function = switch(Type::I32, mask, cases, targets);
    run_passes(&mut function, &["lower_switches"]);
    (
        count(&function, |op| matches!(op, Op::Branch(_))),
        count(&function, |op| matches!(op, Op::JumpTable(..))),
    )
}

#[test]
fn switches_take_the_short_way() {
    let dense: Vec<_> = (0..9).map(|key| (key, to(key as usize))).collect();
    assert_eq!(lowered(None, &dense), (1, 1));
    assert_eq!(lowered(Some(7), &dense), (0, 1));

    let outlier = [&[(100_000, to(9))], &dense[..]].concat();
    assert_eq!(lowered(None, &outlier), (2, 1));

    let vowels = [b'a', b'e', b'i', b'o', b'u', 0].map(|key| (key.into(), to((key == 0).into())));
    assert_eq!(lowered(None, &vowels), (2, 0));

    let digits = (b'0'..=b'9').map(|key| (key.into(), to(0)));
    let digits: Vec<_> = digits.chain([(0, to(1))]).collect();
    assert_eq!(lowered(None, &digits), (1, 0));

    let pointless = [(1, to(0)), (7, to(0)), (0, to(0))];
    assert_eq!(lowered(None, &pointless), (0, 0));
}

#[test]
fn the_likely_key_is_tested_first() {
    let case = |key: i64| Destination {
        is_rare: key != 7,
        ..to(key as usize)
    };
    let cases: Vec<_> = (0..12).map(|key| (key * 1000, case(key))).collect();
    let mut function = switch(Type::I32, None, &cases, 12);
    run_passes(&mut function, &["lower_switches"]);
    let entry = function.entries()[0].block;
    let Op::Branch(condition) = *function.op(function.last(entry)) else {
        panic!("{function:?}")
    };
    assert!(function.is_int_constant(function.operands(condition)[1], 7000));
    assert!(function.is_rare(function.successor(entry, 1)));
}
