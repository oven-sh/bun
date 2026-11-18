//! The analyses against their definitions, on random graphs.

mod support;

use bun_engine_asm::RegisterSet;
use bun_engine_codegen::analysis::{Cfg, Dominators, Frequencies, Loop};
use bun_engine_codegen::ir::{Block, Builder, Entity, Function, Successor};
use support::harness::number_setting;
use support::random::Random;

fn random_graph(seed: u64) -> Function {
    let mut random = Random::new(seed);
    let mut function = Function::new(RegisterSet::EMPTY);
    let entries = random.pick(&[1, 1, 1, 2, 3]);
    let mut blocks: Vec<Block> = (0..entries).map(|_| function.add_entry(&[])).collect();
    let count = entries + random.pick(&[1, 3, 6, 10, 24, 60]);
    blocks.extend((entries..count).map(|_| function.new_block()));
    random.shuffle(&mut blocks[entries..]);
    let (reach, backward) = (random.pick(&[1, 3, 100]), random.pick(&[0, 10, 30, 50]));
    for (position, &block) in (0..).zip(&blocks) {
        let successors: Vec<Successor<'_>> = (0..random.pick(&[0, 1, 1, 1, 2, 2, 2, 3]))
            .map(|_| {
                let target = if random.percent(backward) {
                    position - random.between(0, reach)
                } else {
                    position + random.between(1, reach)
                };
                Successor {
                    is_rare: random.one_in(6),
                    ..blocks[target.clamp(entries as i64, count as i64 - 1) as usize].into()
                }
            })
            .collect();
        let mut builder = Builder::at_end(&mut function, block);
        if successors.is_empty() {
            builder.ret(&[]);
        } else {
            let index = builder.const32(0);
            builder.jump_table(index, 0..successors.len() as u32, &successors);
        }
    }
    function
}

fn targets(function: &Function, block: Block) -> impl Iterator<Item = Block> {
    function.successors(block).map(|edge| function.target(edge))
}

fn reach(
    function: &Function,
    from: impl Iterator<Item = Block>,
    may_pass: impl Fn(Block) -> bool,
) -> Vec<bool> {
    let mut is_reached = vec![false; function.block_count()];
    let mut pending: Vec<Block> = from.collect();
    while let Some(block) = pending.pop() {
        if may_pass(block) && !std::mem::replace(&mut is_reached[block.index()], true) {
            pending.extend(targets(function, block));
        }
    }
    is_reached
}

fn entries(function: &Function) -> impl Iterator<Item = Block> {
    function.entries().iter().map(|entry| entry.block)
}

fn for_random_graphs(check: impl Fn(&Function, &Cfg)) {
    let first = number_setting("SEED", 0);
    let mut cfg = Cfg::default();
    for seed in first..first + number_setting("COUNT", 1500) {
        let function = random_graph(seed);
        cfg.compute(&function);
        check(&function, &cfg);
    }
}

#[test]
fn the_order_has_the_reachable_blocks_and_their_edges() {
    for_random_graphs(|function, cfg| {
        let is_reached = reach(function, entries(function), |_| true);
        for block in function.blocks() {
            assert_eq!(cfg.is_reachable(block), is_reached[block.index()]);
            let mut expected: Vec<_> = (cfg.order().iter())
                .flat_map(|&source| function.successors(source))
                .filter(|&edge| function.target(edge) == block)
                .collect();
            let mut actual = cfg.predecessors(block).to_vec();
            expected.sort();
            actual.sort();
            assert_eq!(actual, expected);
        }
        let reachable = is_reached.iter().filter(|&&is_reached| is_reached).count();
        assert_eq!(cfg.order().len(), reachable);
        assert_eq!(cfg.order()[0], function.entries()[0].block);
        for (position, &block) in (0..).zip(cfg.order()) {
            assert_eq!(cfg.position(block), position);
            let mut incoming = cfg.predecessors(block).iter();
            let is_entry = incoming.len() == 0;
            assert!(is_entry || incoming.any(|&edge| !cfg.is_backward(function, edge)));
        }
    });
}

#[test]
fn a_block_dominates_what_cannot_be_reached_without_it() {
    for_random_graphs(|function, cfg| {
        let dominators = Dominators::new(function, cfg);
        let dominates = |a: Block| {
            let without = reach(function, entries(function), |block| block != a);
            move |b: Block| !without[b.index()]
        };
        let relation: Vec<_> = cfg.order().iter().map(|&a| (a, dominates(a))).collect();
        for &b in cfg.order() {
            let above: Vec<Block> = (relation.iter())
                .filter_map(|(a, dominates)| dominates(b).then_some(*a))
                .collect();
            for &a in cfg.order() {
                assert_eq!(
                    dominators.dominates(a, b),
                    above.contains(&a),
                    "{function:?}"
                );
                assert_eq!(
                    dominators.strictly_dominates(a, b),
                    a != b && above.contains(&a)
                );
                let common = above.iter().rfind(|&&other| dominators.dominates(other, a));
                assert_eq!(dominators.common_dominator(a, b), common.copied());
            }
            assert_eq!(above.last(), Some(&b));
            assert_eq!(dominators.parent(b), above.iter().nth_back(1).copied());
            let children = cfg.order().iter().copied();
            let children = children.filter(|&child| dominators.parent(child) == Some(b));
            assert!(dominators.children(b).eq(children));
        }
    });
}

#[test]
fn the_walk_of_the_dominators_comes_to_a_block_after_its_forward_predecessors() {
    for_random_graphs(|function, cfg| {
        let dominators = Dominators::new(function, cfg);
        let walk = dominators.pre_order();
        assert_eq!(walk.len(), cfg.order().len());
        let is_reducible = cfg.loops().values().all(|data| data.is_natural);
        for (position, &block) in walk.iter().enumerate() {
            let below = walk.iter().filter(|&&b| dominators.dominates(block, b));
            assert!(below.clone().eq(&walk[position..position + below.count()]));
            for &edge in cfg.predecessors(block) {
                let is_passed = walk[..position].contains(&function.source(edge));
                assert!(!is_reducible || is_passed != cfg.is_backward(function, edge));
            }
        }
    });
}

fn encloses(cfg: &Cfg, outer: Loop, block: Block) -> bool {
    let mut around = std::iter::successors(cfg.loop_of(block).expand(), |&inner| {
        cfg.loops()[inner].parent.expand()
    });
    around.any(|found| found == outer)
}

#[test]
fn loops_are_nested_cycles_without_gaps() {
    for_random_graphs(|function, cfg| {
        let dominators = Dominators::new(function, cfg);
        for found in cfg.loops().keys() {
            let data = cfg.loops()[found];
            let blocks = cfg.blocks_of(found);
            assert_eq!(blocks[0], data.header);
            assert_eq!(cfg.loop_headed_by(data.header), Some(found));
            match data.parent.expand() {
                None => assert_eq!(data.depth, 1),
                Some(parent) => {
                    assert!(parent < found && cfg.includes(parent, data.header));
                    assert_eq!(data.depth, cfg.loops()[parent].depth + 1);
                }
            }
            let is_inside = |block| blocks.contains(&block);
            let from_header = reach(function, targets(function, data.header), is_inside);
            for &block in cfg.order() {
                assert_eq!(cfg.includes(found, block), is_inside(block));
                assert_eq!(encloses(cfg, found, block), is_inside(block));
            }
            for &block in blocks {
                let onward = reach(function, targets(function, block), is_inside);
                assert!(from_header[block.index()] && onward[data.header.index()]);
            }
            let is_entered_elsewhere = blocks[1..].iter().any(|&block| {
                let mut sources = cfg.predecessors(block).iter();
                sources.any(|&edge| !is_inside(function.source(edge)))
            });
            assert_eq!(data.is_natural, !is_entered_elsewhere, "{function:?}");
            if data.is_natural {
                assert!(blocks.iter().all(|&b| dominators.dominates(data.header, b)));
            }
        }
        for &block in cfg.order() {
            let is_in_cycle = reach(function, targets(function, block), |_| true)[block.index()];
            assert_eq!(cfg.depth(block) != 0, is_in_cycle);
            for edge in function.successors(block) {
                if cfg.is_backward(function, edge) {
                    let closed = cfg.loop_headed_by(function.target(edge));
                    assert!(closed.is_some_and(|closed| cfg.includes(closed, block)));
                }
            }
        }
    });
}

#[test]
fn what_enters_a_block_leaves_it() {
    for_random_graphs(|function, cfg| {
        let frequencies = Frequencies::new(function, cfg);
        let is_near = |a: f32, b: f32| (a - b).abs() <= a.max(b) * 1e-4;
        let not_rarely = {
            let mut is_reached = vec![false; function.block_count()];
            for &block in cfg.order() {
                let mut incoming = cfg.predecessors(block).iter();
                is_reached[block.index()] = incoming.len() == 0
                    || incoming.any(|&edge| {
                        is_reached[function.source(edge).index()] && !function.is_rare(edge)
                    });
            }
            is_reached
        };
        for &block in cfg.order() {
            let frequency = frequencies.of_block(block);
            assert!(frequency.is_finite() && frequency >= 0.0);
            assert_eq!(frequencies.is_cold(block), !not_rarely[block.index()]);
            let edges = function.successors(block);
            if edges.len() != 0 {
                let leaving = edges.map(|edge| frequencies.of_edge(edge)).sum();
                assert!(is_near(frequency, leaving));
            }
            if cfg.loop_headed_by(block).is_none() && !cfg.predecessors(block).is_empty() {
                let incoming = cfg.predecessors(block).iter();
                let entering = incoming.map(|&edge| frequencies.of_edge(edge)).sum();
                assert!(is_near(frequency, entering));
            }
        }
    });
}

#[test]
fn unreachable_blocks_are_removed() {
    for_random_graphs(|function, cfg| {
        let mut function = function.clone();
        let had_any = function.blocks().count() != cfg.order().len();
        assert_eq!(cfg.remove_unreachable_blocks(&mut function), had_any);
        assert!(function.blocks().all(|block| cfg.is_reachable(block)));
        assert_eq!(Cfg::new(&function).order(), cfg.order());
    });
}
