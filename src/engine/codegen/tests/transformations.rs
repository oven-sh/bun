//! What the passes for memory, loops and control flow are expected to do, and to leave alone.

mod support;

use bun_engine_asm::{Cond, Sign, Size};
use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, Binary, Block, Builder, Checked, EffectFlags, Effects, Exit,
    Function, Heap, HeapRange, Lanes, NodeInfo, NodeKind, Op, Output, PatchpointData,
    PatchpointFlags, State, Successor, Token, Type, Value,
};
use bun_engine_codegen::passes::{
    Analyses, LoopEffects, cost_of_copying, edge_from_preheader, peel_loops,
};
use support::sketch::{add_entry, count, empty_function, run_passes};

const FIRST: Heap = Heap::at(2);
const SECOND: Heap = Heap::at(3);
const BOTH: Heap = Heap::at(4);

const READ: NodeKind = NodeKind(0);
const TEST: NodeKind = NodeKind(1);
const MAKE: NodeKind = NodeKind(2);

const fn reading(name: &'static str, reads: Heap, flags: EffectFlags) -> NodeInfo {
    NodeInfo {
        name,
        effects: Effects {
            reads,
            writes: Heap::NOTHING,
            flags,
        },
        elements: &[],
    }
}

static KINDS: [NodeInfo; 3] = [
    reading("Read", FIRST, EffectFlags::CONTROL_DEPENDENT),
    reading("Test", FIRST, EffectFlags::EXITS),
    reading("Make", Heap::NOTHING, EffectFlags::DISTINCT),
];

/// Two I64 and two I32.
#[derive(Clone, Copy)]
struct Params {
    p: Value,
    q: Value,
    m: Value,
    n: Value,
}

/// `body` gives the result.
fn build(body: impl FnOnce(&mut Builder<'_>, Params) -> Value) -> Function {
    let mut function = empty_function();
    function.set_node_kinds(&KINDS);
    for (start, end) in [(0, 1), (1, 2), (0, 2)] {
        function.add_heap(HeapRange { start, end });
    }
    let types = [Type::I64, Type::I64, Type::I32, Type::I32];
    let (entry, params) = add_entry(&mut function, &types);
    let [p, q, m, n] = params[..] else {
        unreachable!()
    };
    let mut builder = Builder::at_end(&mut function, entry);
    let mut result = body(&mut builder, Params { p, q, m, n });
    if builder.type_of(result) == Type::I32 {
        result = builder.zero_extend(result);
    }
    builder.ret(&[result]);
    function
}

fn after(names: &[&str], body: impl FnOnce(&mut Builder<'_>, Params) -> Value) -> Function {
    let mut function = build(body);
    run_passes(&mut function, names);
    Analyses::default().cfg(&mut function);
    function
}

fn exit(b: &mut Builder<'_>, values: &[Value]) -> Exit {
    Exit {
        token: Token(0),
        state: b.add_state(values),
    }
}

fn check(b: &mut Builder<'_>, condition: Value) {
    let exit = exit(b, &[]);
    b.check(condition, exit);
}

fn call(b: &mut Builder<'_>) {
    let data = PatchpointData::new(Action::Custom, Token(0), Effects::CALL);
    b.patchpoint(&data, &[], &[]);
}

fn with(heap: Heap, flags: AccessFlags) -> Access {
    Access::new(heap, flags)
}

/// The arms give the arguments for parameters of these types.
fn choose<const N: usize>(
    b: &mut Builder<'_>,
    condition: Value,
    types: [Type; N],
    mut arm: impl FnMut(&mut Builder<'_>, bool) -> [Value; N],
) -> [Value; N] {
    let [then, or, join] = [(); 3].map(|()| b.new_block());
    let params = types.map(|ty| b.add_param(join, ty));
    b.branch(condition, then, or);
    for (block, holds) in [(then, true), (or, false)] {
        b.switch_to(block);
        let args = arm(b, holds);
        b.jump(join, &args);
    }
    b.switch_to(join);
    params
}

fn rarely(b: &mut Builder<'_>, condition: Value, arm: impl FnOnce(&mut Builder<'_>)) {
    let [then, join] = [(); 2].map(|()| b.new_block());
    b.branch(condition, then.rare(), join);
    b.switch_to(then);
    arm(b);
    b.jump(join, &[]);
    b.switch_to(join);
}

#[derive(Clone, Copy, PartialEq)]
enum Test {
    First,
    Last,
    FirstAndLast,
}

/// While the counter stands in the relation `cond` to `limit`.
fn repeat(
    b: &mut Builder<'_>,
    test: Test,
    (first, step): (Value, i32),
    (cond, entry_cond, limit): (Cond, Cond, Value),
    body: impl FnOnce(&mut Builder<'_>, Value),
) {
    let [header, inside, done] = [(); 3].map(|()| b.new_block());
    let counter = b.add_param(header, Type::I32);
    if test == Test::FirstAndLast {
        let enters = b.compare(entry_cond, first, limit);
        b.branch(enters, Successor::new(header, &[first]), done);
    } else {
        b.jump(header, &[first]);
    }
    b.switch_to(header);
    if test == Test::First {
        let goes_on = b.compare(cond, counter, limit);
        b.branch(goes_on, inside, done);
        b.switch_to(inside);
    }
    body(b, counter);
    let next = b.add(counter, step);
    if test == Test::First {
        b.jump(header, &[next]);
    } else {
        let goes_on = b.compare(cond, next, limit);
        b.branch(goes_on, Successor::new(header, &[next]), done);
    }
    b.switch_to(done);
}

/// From zero up to `limit`.
fn count_up(
    b: &mut Builder<'_>,
    test: Test,
    limit: Value,
    body: impl FnOnce(&mut Builder<'_>, Value),
) {
    let zero = b.const32(0);
    repeat(b, test, (zero, 1), (Cond::Lt, Cond::Lt, limit), body);
}

fn loads(function: &Function) -> usize {
    count(function, |op| matches!(op, Op::Load { .. }))
}

fn stores(function: &Function) -> usize {
    count(function, |op| matches!(op, Op::Store { .. }))
}

fn checks(function: &Function) -> usize {
    count(function, |op| op.exit().is_some())
}

fn branches(function: &Function) -> usize {
    count(function, |op| matches!(op, Op::Branch(_)))
}

fn nodes(function: &Function) -> usize {
    count(function, |op| op.node().is_some())
}

fn promises(function: &Function) -> usize {
    let is_promised = |access: Access| access.has(AccessFlags::ALWAYS_READABLE);
    count(function, |op| op.access().is_some_and(is_promised))
}

fn loop_depth(function: &Function, value: Value) -> u32 {
    Cfg::new(function).depth(function.block_of(value))
}

fn loop_count(function: &Function) -> usize {
    let cfg = Cfg::new(function);
    assert!(cfg.loops().values().all(|data| data.is_natural));
    cfg.loops().len()
}

mod memory {
    use super::*;

    const PASS: [&str; 1] = ["eliminate_redundant_memory"];

    /// Of two loads with `between` them.
    fn loads_left(flags: AccessFlags, between: impl Fn(&mut Builder<'_>, Params)) -> usize {
        loads(&after(&PASS, |b, params| {
            let first = b.load(Type::I64, params.p, 8, with(FIRST, flags));
            choose(b, params.m, [], |b, holds| {
                if holds {
                    between(b, params);
                }
                []
            });
            let second = b.load(Type::I64, params.p, 8, FIRST);
            b.add(first, second)
        }))
    }

    #[test]
    fn a_load_is_good_until_something_may_write_the_place() {
        let plain = AccessFlags::empty();
        assert_eq!(loads_left(plain, |b, x| b.store(x.q, x.q, 0, SECOND)), 1);
        assert_eq!(loads_left(plain, |b, x| b.store(x.q, x.p, 0, FIRST)), 1);
        assert_eq!(loads_left(plain, |b, x| b.store(x.q, x.p, 16, BOTH)), 1);
        assert_eq!(loads_left(plain, |b, x| check(b, x.n)), 1);
        assert_eq!(loads_left(plain, |b, x| b.store(x.q, x.p, 1, FIRST)), 2);
        assert_eq!(loads_left(plain, |b, x| b.store(x.m, x.p, 15, FIRST)), 2);
        assert_eq!(loads_left(plain, |b, x| b.store(x.q, x.q, 0, BOTH)), 2);
        assert_eq!(loads_left(plain, |b, _| call(b)), 2);
        assert_eq!(loads_left(AccessFlags::IMMUTABLE, |b, _| call(b)), 1);
    }

    #[test]
    fn what_is_stored_is_loaded_in_the_form_that_is_wanted() {
        let function = after(&PASS, |b, Params { p, q, .. }| {
            b.store_sized(Size::S16, q, p, 0, FIRST);
            let signed = b.load_narrow(Size::S16, Sign::Signed, p, 0, FIRST);
            let byte = b.load_narrow(Size::S8, Sign::Unsigned, p, 0, FIRST);
            b.store(q, p, 8, FIRST);
            let half = b.load(Type::I32, p, 8, FIRST);
            let float = b.load(Type::F64, p, 8, FIRST);
            b.store(float, p, 16, FIRST);
            let too_wide = b.load(Type::I32, p, 0, FIRST);
            let sum = [byte, half, too_wide];
            sum.into_iter().fold(signed, |sum, next| b.add(sum, next))
        });
        assert_eq!(loads(&function), 1);
    }

    /// Of a load before a store and one after it, with the addresses that `address` gives.
    fn loads_with(address: impl Fn(&mut Builder<'_>, Params, usize) -> (Value, i32)) -> usize {
        loads(&after(&PASS, |b, params| {
            let [before, written, again] = [0, 1, 2].map(|which| address(b, params, which));
            let first = b.load(Type::I32, before.0, before.1, FIRST);
            b.store(params.n, written.0, written.1, FIRST);
            let second = b.load(Type::I32, again.0, again.1, FIRST);
            b.add(first, second)
        }))
    }

    fn element(b: &mut Builder<'_>, x: Params, sign: Sign, step: i32) -> Value {
        let index = b.add(x.m, step);
        let wide = b.convert(bun_engine_codegen::ir::Unary::Widen(sign), Type::I64, index);
        let scaled = b.shl(wide, 2);
        b.add(x.p, scaled)
    }

    #[test]
    fn narrow_indices_tell_places_apart_but_may_wrap() {
        use Sign::{Signed, Unsigned};
        let steps = |steps: [(Sign, i32, i32); 3]| {
            loads_with(|b, x, which| {
                let (sign, step, offset) = steps[which];
                (element(b, x, sign, step), offset)
            })
        };
        let neighbour = (Unsigned, 2, 0);
        assert_eq!(steps([(Unsigned, 1, 0), neighbour, (Unsigned, 1, 0)]), 1);
        assert_eq!(steps([(Signed, 1, 0), neighbour, (Signed, 1, 0)]), 1);
        assert_eq!(steps([(Unsigned, 1, 0), neighbour, (Unsigned, 0, 4)]), 2);
        assert_eq!(steps([(Unsigned, 1, 0), neighbour, (Signed, 1, 0)]), 2);
        assert_eq!(steps([(Signed, 1, 4), neighbour, (Signed, 1, 4)]), 2);
    }

    #[test]
    fn a_load_is_put_together_from_what_is_known_of_its_parts() {
        let function = after(&PASS, |b, Params { p, q, m, n }| {
            b.store(m, p, 0, FIRST);
            b.store(n, p, 4, FIRST);
            let whole = b.load(Type::I64, p, 0, FIRST);
            b.store(q, p, 16, FIRST);
            let high = b.load(Type::I32, p, 20, FIRST);
            let low = b.load_narrow(Size::S8, Sign::Unsigned, p, 17, FIRST);
            let last = b.load_narrow(Size::S16, Sign::Signed, p, 22, FIRST);
            let sum = [low, last]
                .into_iter()
                .fold(high, |sum, next| b.add(sum, next));
            let wide = b.zero_extend(sum);
            b.add(whole, wide)
        });
        assert_eq!(loads(&function), 0, "{function:?}");
        assert_eq!(
            count(&function, |op| matches!(op, Op::Binary(Binary::Or, _))),
            1
        );
    }

    #[test]
    fn a_vector_is_put_together_from_two_words() {
        let function = after(&PASS, |b, Params { p, q, .. }| {
            b.store(q, p, 0, FIRST);
            b.store(q, p, 8, FIRST);
            let vector = b.load(Type::V128, p, 0, FIRST);
            let lane = b.extract_lane(Lanes::Int(Size::S64), Sign::Unsigned, vector, 1);
            b.add(lane, q)
        });
        assert_eq!(loads(&function), 0, "{function:?}");
        assert_eq!(count(&function, |op| matches!(op, Op::Splat(..))), 1);
    }

    #[test]
    fn parts_are_only_used_while_nothing_may_have_written_them() {
        let left = |offset, heap: Heap, is_wide| {
            loads(&after(&PASS, |b, x| {
                b.store(x.m, x.p, 0, FIRST);
                b.store(x.n, x.p, 4, FIRST);
                if is_wide {
                    b.store(x.q, x.p, offset, heap);
                } else {
                    b.store(x.m, x.p, offset, heap);
                }
                b.load(Type::I64, x.p, 0, FIRST)
            }))
        };
        assert_eq!(left(16, FIRST, true), 0);
        assert_eq!(left(8, SECOND, true), 0);
        assert_eq!(left(0, FIRST, true), 0);
        assert_eq!(left(4, FIRST, false), 0);
        assert_eq!(left(2, FIRST, false), 1);
        assert_eq!(left(6, FIRST, false), 1);
    }

    #[test]
    fn values_that_all_ways_have_become_a_parameter() {
        let function = after(&PASS, |b, Params { p, q, m, n }| {
            choose(b, m, [], |b, holds| {
                if holds {
                    b.store(q, p, 0, FIRST);
                } else {
                    choose(b, n, [], |b, holds| {
                        let value = b.add(q, 1 + i32::from(holds));
                        b.store(value, p, 0, FIRST);
                        []
                    });
                }
                []
            });
            check(b, n);
            b.load(Type::I64, p, 0, FIRST)
        });
        assert_eq!(loads(&function), 0);
    }

    #[test]
    fn a_value_goes_around_a_loop_in_a_parameter() {
        for test in [Test::First, Test::Last] {
            let function = after(&PASS, |b, Params { p, q, n, .. }| {
                b.store(q, p, 0, FIRST);
                count_up(b, test, n, |b, counter| {
                    let old = b.load(Type::I64, p, 0, FIRST);
                    rarely(b, counter, |b| {
                        let new = b.add(old, 1);
                        b.store(new, p, 0, FIRST);
                    });
                    check(b, old);
                });
                b.load(Type::I64, p, 0, FIRST)
            });
            assert_eq!(loads(&function), 0, "{function:?}");
        }
    }

    #[test]
    fn what_is_there_already_is_not_stored_again() {
        let left = |flags, was_stored| {
            stores(&after(&PASS, |b, Params { p, q, .. }| {
                let value = if was_stored {
                    b.store(q, p, 0, with(FIRST, flags));
                    q
                } else {
                    b.load(Type::I64, p, 0, with(FIRST, flags))
                };
                check(b, value);
                b.store(value, p, 0, with(FIRST, flags));
                value
            }))
        };
        assert_eq!(left(AccessFlags::empty(), false), 0);
        assert_eq!(left(AccessFlags::empty(), true), 1);
        assert_eq!(left(AccessFlags::TRAPS, false), 1);
        assert_eq!(left(AccessFlags::TRAPS, true), 1);
    }

    #[test]
    fn stores_go_if_they_are_overwritten_unseen() {
        let left = |flags: [AccessFlags; 2], between: fn(&mut Builder<'_>, Params)| {
            stores(&after(&PASS, |b, x| {
                b.store(x.n, x.p, 4, with(FIRST, flags[0]));
                between(b, x);
                choose(b, x.m, [], |b, holds| {
                    let value = b.add(x.q, i32::from(holds));
                    b.store(value, x.p, 0, with(FIRST, flags[1]));
                    []
                });
                x.q
            }))
        };
        let (plain, traps) = (AccessFlags::empty(), AccessFlags::TRAPS);
        let load = |b: &mut Builder<'_>, address, offset, heap: Heap| {
            b.load(Type::I32, address, offset, heap);
        };
        assert_eq!(left([plain; 2], |_, _| {}), 2);
        assert_eq!(left([traps, plain], |_, _| {}), 3);
        assert_eq!(left([plain, traps], |_, _| {}), 3);
        assert_eq!(left([plain; 2], |b, x| check(b, x.n)), 3);
        assert_eq!(left([plain; 2], |b, _| b.fence(BOTH, Heap::NOTHING)), 3);
        for (offset, heap, is_other, expected) in [
            (8, FIRST, false, 2),
            (0, SECOND, true, 2),
            (2, FIRST, false, 3),
            (8, FIRST, true, 3),
        ] {
            let function = after(&PASS, |b, x| {
                b.store(x.n, x.p, 4, FIRST);
                load(b, if is_other { x.q } else { x.p }, offset, heap);
                b.store(x.q, x.p, 0, FIRST);
                b.store(x.q, x.p, 32, FIRST);
                x.q
            });
            assert_eq!(stores(&function), expected);
        }
    }

    #[test]
    fn nodes_are_merged_while_they_would_find_the_same() {
        let left = |kind, ty, heap: Heap| {
            nodes(&after(&PASS, |b, Params { p, q, m, .. }| {
                b.node(kind, ty, &[p, q, m], 7, State::NONE);
                b.store(q, q, 0, heap);
                b.node(kind, ty, &[p, q, m], 7, State::NONE);
                b.node(kind, ty, &[p, q, m], 8, State::NONE);
                q
            }))
        };
        assert_eq!(left(READ, Type::I64, SECOND), 2);
        assert_eq!(left(TEST, Type::Void, SECOND), 2);
        assert_eq!(left(READ, Type::I64, FIRST), 3);
        assert_eq!(left(TEST, Type::Void, BOTH), 3);
        assert_eq!(left(MAKE, Type::I64, SECOND), 3);
    }
}

mod hoisting {
    use super::*;

    /// The number of loops around the value in the end, of which there are two at first.
    fn depth(test: Test, body: impl FnOnce(&mut Builder<'_>, Params, [Value; 2]) -> Value) -> u32 {
        let mut value = Value::NONE;
        let function = after(&["hoist_loop_invariants"], |b, x| {
            count_up(b, test, x.n, |b, outer| {
                count_up(b, test, x.n, |b, inner| value = body(b, x, [outer, inner]));
            });
            x.q
        });
        loop_depth(&function, value)
    }

    #[test]
    fn values_leave_the_loops_that_do_not_change_their_operands() {
        assert_eq!(depth(Test::First, |b, x, _| b.mul(x.p, x.q)), 0);
        assert_eq!(depth(Test::First, |b, x, [i, _]| b.mul(x.m, i)), 1);
        assert_eq!(depth(Test::First, |b, x, [_, j]| b.mul(x.m, j)), 2);
        let made = |b: &mut Builder<'_>| b.node(MAKE, Type::I64, &[], 0, State::NONE);
        assert_eq!(depth(Test::Last, |b, _, _| made(b)), 2);
    }

    #[test]
    fn what_may_fault_moves_only_if_it_is_certain_to_run() {
        let load =
            |b: &mut Builder<'_>, x: Params, flags| b.load(Type::I64, x.p, 0, with(FIRST, flags));
        let (plain, safe) = (AccessFlags::empty(), AccessFlags::ALWAYS_READABLE);
        assert_eq!(depth(Test::Last, |b, x, _| load(b, x, plain)), 0);
        assert_eq!(depth(Test::First, |b, x, _| load(b, x, plain)), 2);
        assert_eq!(depth(Test::First, |b, x, _| load(b, x, safe)), 0);
        let after_check = |flags| {
            depth(Test::Last, |b, x, [_, j]| {
                check(b, j);
                load(b, x, flags)
            })
        };
        assert_eq!((after_check(plain), after_check(safe)), (2, 0));
        let divide = |b: &mut Builder<'_>, x: Params| b.binary(Binary::Div, x.m, x.n);
        assert_eq!(depth(Test::First, |b, x, _| divide(b, x)), 2);
        assert_eq!(depth(Test::Last, |b, x, _| divide(b, x)), 0);
    }

    #[test]
    fn loads_stay_with_the_writes_that_matter_to_them() {
        let with_store = |flags, offset, heap: Heap, is_first| {
            depth(Test::Last, |b, x, _| {
                if is_first {
                    b.store(x.q, x.p, offset, heap);
                }
                let value = b.load(Type::I64, x.p, 0, with(FIRST, flags));
                if !is_first {
                    b.store(x.q, x.p, offset, heap);
                }
                value
            })
        };
        let (plain, traps) = (AccessFlags::empty(), AccessFlags::TRAPS);
        assert_eq!(with_store(plain, 0, FIRST, false), 2);
        assert_eq!(with_store(plain, 8, FIRST, true), 0);
        assert_eq!(with_store(plain, 0, SECOND, true), 0);
        assert_eq!(with_store(traps, 8, FIRST, false), 0);
        assert_eq!(with_store(traps, 8, FIRST, true), 2);
        assert_eq!(with_store(AccessFlags::IMMUTABLE, 0, FIRST, true), 2);
    }

    #[test]
    fn a_node_that_only_reads_moves_like_a_load() {
        let read = |b: &mut Builder<'_>, x: Params| b.node(READ, Type::I64, &[x.p], 3, State::NONE);
        assert_eq!(depth(Test::Last, |b, x, _| read(b, x)), 0);
        let with_write = |heap: Heap| {
            depth(Test::Last, |b, x, _| {
                let value = read(b, x);
                b.store(x.q, x.p, 0, heap);
                value
            })
        };
        assert_eq!((with_write(SECOND), with_write(FIRST)), (0, 2));
        let exiting = depth(Test::Last, |b, x, _| {
            let state = b.add_state(&[x.p]);
            b.node(TEST, Type::Void, &[x.p], 3, state);
            x.q
        });
        assert_eq!(exiting, 0);
    }

    #[test]
    fn nothing_leaves_a_rare_path() {
        let rare = depth(Test::Last, |b, x, [_, j]| {
            let mut product = Value::NONE;
            rarely(b, j, |b| product = b.mul(x.p, x.q));
            product
        });
        assert_eq!(rare, 2);
    }

    #[test]
    fn parts_of_other_instructions_move_only_to_free_registers() {
        let tested = |frees: bool| {
            depth(Test::Last, |b, x, [_, j]| {
                let (low, high) = (b.mul(x.p, 3), b.mul(x.q, 3));
                let holds = b.below(low, high);
                rarely(b, holds, call);
                if !frees {
                    b.store(low, x.p, 0, FIRST);
                }
                check(b, j);
                holds
            })
        };
        assert_eq!((tested(true), tested(false)), (0, 2));
        let address = |is_variant: bool| {
            depth(Test::Last, |b, x, [_, j]| {
                let scaled = b.shl(x.q, 3);
                let address = b.add(x.p, scaled);
                let value = b.load(Type::I32, address, 0, FIRST);
                b.store(x.q, x.p, 0, if is_variant { FIRST } else { SECOND });
                let sum = b.add(value, j);
                check(b, sum);
                scaled
            })
        };
        assert_eq!((address(false), address(true)), (0, 0));
    }

    #[test]
    fn a_check_at_the_top_takes_the_state_of_the_first_turn() {
        let mut first = Value::NONE;
        let function = after(&["hoist_loop_invariants"], |b, x| {
            first = b.mul(x.n, 3);
            let limit = (Cond::Lt, Cond::Lt, x.n);
            repeat(b, Test::Last, (first, 1), limit, |b, counter| {
                let state = b.add_described_state([counter, x.p], 42);
                b.retag(state, 1, x.p, 5);
                let token = Token(0);
                b.check(x.m, Exit { token, state });
            });
            x.q
        });
        let entry = function.entries()[0].block;
        let check = function.previous(function.last(entry));
        let state = function.op(check).exit().unwrap().state;
        assert_eq!(function.state(state)[0], first);
        assert_eq!(function.state_layout(state), 42);
        assert_eq!(function.state_tags(state), [0, 5]);
    }
}

mod paths {
    use super::*;

    const PASS: [&str; 1] = ["fold_path_constants"];

    #[test]
    fn counters_stay_within_their_limits() {
        use Cond::{Ge, Le, Lt, Ne};
        let left = |test, is_up: bool, conds: (Cond, Cond), step: i32| {
            checks(&after(&PASS, |b, x| {
                let (length, zero) = (b.shr(x.n, 1), b.const32(0));
                let last = b.add(length, -1);
                let (first, limit) = if is_up { (zero, length) } else { (last, zero) };
                let limit = (conds.0, conds.1, limit);
                repeat(b, test, (first, step), limit, |b, counter| {
                    let is_outside = b.above_or_equal(counter, length);
                    check(b, is_outside);
                });
                x.q
            }))
        };
        assert_eq!(left(Test::First, true, (Lt, Lt), 1), 0);
        assert_eq!(left(Test::FirstAndLast, true, (Lt, Lt), 1), 0);
        assert_eq!(left(Test::FirstAndLast, true, (Ne, Lt), 1), 0);
        assert_eq!(left(Test::First, false, (Ge, Ge), -1), 0);
        assert_eq!(left(Test::FirstAndLast, false, (Ge, Ge), -3), 0);
        assert_eq!(left(Test::Last, true, (Lt, Lt), 1), 1);
        assert_eq!(left(Test::First, true, (Le, Le), 1), 1);
        assert_eq!(left(Test::First, true, (Lt, Lt), 2), 1);
        assert_eq!(left(Test::FirstAndLast, true, (Ne, Lt), 2), 1);
        assert_eq!(left(Test::FirstAndLast, true, (Ne, Ne), 1), 0);
        let with_any_limit = |test, conds: (Cond, Cond), step: i32| {
            checks(&after(&PASS, |b, x| {
                let (length, zero) = (b.sar(x.n, 1), b.const32(0));
                let limit = (conds.0, conds.1, length);
                repeat(b, test, (zero, step), limit, |b, counter| {
                    let is_outside = b.above_or_equal(counter, length);
                    check(b, is_outside);
                });
                x.q
            }))
        };
        assert_eq!(with_any_limit(Test::FirstAndLast, (Lt, Lt), 1), 0);
        assert_eq!(with_any_limit(Test::First, (Lt, Lt), 1), 0);
        assert_eq!(with_any_limit(Test::FirstAndLast, (Ne, Ne), 1), 1);
    }

    #[test]
    fn what_is_less_than_something_can_grow_by_one() {
        let left = |cond, by| {
            checks(&after(&PASS, |b, Params { m, n, .. }| {
                let holds = b.compare(cond, m, n);
                choose(b, holds, [Type::I32], |b, holds| {
                    let exit = exit(b, &[]);
                    [if holds {
                        b.checked(Checked::Add, m, by, exit)
                    } else {
                        n
                    }]
                })[0]
            }))
        };
        assert_eq!((left(Cond::Lt, 1), left(Cond::Gt, -1)), (0, 0));
        assert_eq!((left(Cond::Le, 1), left(Cond::Lt, 2)), (1, 1));
    }

    #[test]
    fn a_value_that_equals_a_constant_is_replaced_unless_that_may_be_an_address() {
        for (constant, is_replaced) in [(7, true), (-1 << 50, true), (0x7f00_0000_1000, false)] {
            let mut store = Value::NONE;
            let function = after(&PASS, |b, Params { p, q, .. }| {
                let differs = b.not_equal(q, constant);
                check(b, differs);
                b.store(q, p, 0, FIRST);
                store = b.last(b.block());
                let again = b.equal(q, constant);
                b.select(again, p, q)
            });
            let stored = function.operands(store)[0];
            assert_eq!(function.is_int_constant(stored, constant), is_replaced);
            assert_eq!(count(&function, |op| matches!(op, Op::Select(_))), 0);
        }
    }

    #[test]
    fn switches_lose_the_keys_that_are_ruled_out() {
        let function = after(&PASS, |b, Params { p, m, .. }| {
            let is_large = b.above(m, 2);
            check(b, is_large);
            let [arm, done] = [(); 2].map(|()| b.new_block());
            let cases = [(1, arm.into()), (5, done.into()), (2, done.into())];
            b.switch(m, &cases, done.into());
            b.switch_to(arm);
            b.store(m, p, 0, FIRST);
            b.jump(done, &[]);
            b.switch_to(done);
            p
        });
        let entry = function.entries()[0].block;
        let Op::Switch(_, cases) = *function.op(function.last(entry)) else {
            panic!("{function:?}")
        };
        assert_eq!(function.cases(cases), [1, 2]);
        let arm = function.target(function.successor(entry, 0));
        assert!(function.is_int_constant(function.operands(function.first(arm))[0], 1));
    }

    #[test]
    fn division_needs_no_special_cases_for_divisors_that_are_ruled_out() {
        let is_total = |cond| {
            let function = after(&PASS, |b, Params { m, n, .. }| {
                let fails = b.compare(cond, n, 0);
                check(b, fails);
                b.binary(Binary::TotalDiv, m, n)
            });
            count(&function, |op| {
                matches!(op, Op::Binary(Binary::TotalDiv, _))
            }) == 1
        };
        assert!(!is_total(Cond::Le) && is_total(Cond::Eq) && is_total(Cond::Lt));
    }
}

mod tails {
    use super::*;

    const PASSES: [&str; 2] = ["duplicate_tails", "simplify"];

    /// Branches on a parameter that is one on one way and the result of a comparison on the other.
    fn either(b: &mut Builder<'_>, x: Params, in_tail: impl FnOnce(&mut Builder<'_>)) -> Value {
        let [holds] = choose(b, x.m, [Type::I32], |b, holds| {
            call(b);
            [if holds {
                b.const32(1)
            } else {
                b.less_than(x.p, x.q)
            }]
        });
        in_tail(b);
        choose(b, holds, [Type::I64], |b, holds| {
            (0..3).for_each(|_| call(b));
            [if holds { x.p } else { x.q }]
        })[0]
    }

    fn branches_on_params(function: &Function) -> usize {
        let is_param = |value| matches!(function.op(value), Op::Param(_));
        count(function, |op| matches!(*op, Op::Branch(on) if is_param(on)))
    }

    #[test]
    fn truth_values_need_no_register() {
        let function = after(&PASSES, |b, x| either(b, x, |_| {}));
        assert_eq!((branches(&function), branches_on_params(&function)), (2, 1));
    }

    #[test]
    fn unique_code_is_not_copied() {
        let function = after(&PASSES, |b, x| {
            either(b, x, |b| {
                let effects = Effects::with_flags(EffectFlags::KEPT);
                let mut data = PatchpointData::new(Action::Custom, Token(0), effects);
                data.flags = PatchpointFlags::UNIQUE;
                b.patchpoint(&data, &[], &[]);
            })
        });
        assert_eq!((branches(&function), branches_on_params(&function)), (2, 2));
    }

    #[test]
    fn a_second_test_follows_from_the_first() {
        let function = after(&PASSES, |b, Params { q, m, .. }| {
            for limit in [5, 10] {
                let holds = b.less_than(m, limit);
                rarely(b, holds, call);
            }
            q
        });
        let entry = function.entries()[0].block;
        let arm = function.target(function.successor(entry, 0));
        assert_eq!(*function.op(function.last(arm)), Op::Jump);
        let calls = function.target(function.successor(arm, 0));
        assert!(matches!(
            function.op(function.first(calls)),
            Op::Patchpoint(_)
        ));
    }

    #[test]
    fn long_rows_of_tails_do_not_multiply_parameters() {
        const LENGTH: usize = 300;
        let function = after(&PASSES[..1], |b, Params { p, q, m, .. }| {
            let (mut condition, mut all) = (m, Vec::new());
            for offset in 0..LENGTH as i32 {
                [condition] = choose(b, condition, [Type::I32], |b, holds| {
                    b.store(q, p, offset, FIRST);
                    [if holds {
                        b.const32(1)
                    } else {
                        b.load(Type::I32, q, offset, FIRST)
                    }]
                });
                all.push(condition);
            }
            all.into_iter().fold(m, |sum, next| b.add(sum, next))
        });
        let params = function.blocks().map(|block| function.params(block).len());
        assert!(params.sum::<usize>() < 8 * LENGTH);
    }

    #[test]
    fn chains_of_four_keys_become_switches() {
        let switches = |keys: &[i32]| {
            let function = after(&["infer_switches"], |b, Params { p, m, .. }| {
                let done = b.new_block();
                for &key in keys {
                    let (next, is_equal) = (b.new_block(), b.equal(m, key));
                    b.branch(is_equal, done, next);
                    b.switch_to(next);
                }
                b.jump(done, &[]);
                b.switch_to(done);
                p
            });
            count(&function, |op| matches!(op, Op::Switch(..)))
        };
        assert_eq!(switches(&[1, 9, 4, 0]), 1);
        assert_eq!(switches(&[1, 9, 4, 9]), 0);
    }
}

mod selections {
    use super::*;

    #[test]
    fn a_constant_that_settles_a_check_gets_a_way_of_its_own() {
        let specialized = |is_settled: bool| {
            after(&["specialize_selects"], |b, Params { p, q, m, .. }| {
                let (fits, last) = (b.below(q, 8), b.const64(7));
                let index = b.select(fits, q, last);
                let other = if is_settled { last } else { p };
                let fails = b.above(index, other);
                check(b, fails);
                let address = b.add(p, index);
                let access = with(FIRST, AccessFlags::ALWAYS_READABLE);
                let value = b.load(Type::I32, address, 0, access);
                b.add(value, m)
            })
        };
        let summary = |f: &Function| (branches(f), checks(f), promises(f));
        assert_eq!(summary(&specialized(true)), (1, 1, 0));
        assert_eq!(summary(&specialized(false)), (0, 1, 1));
    }

    #[test]
    fn extremes_and_truth_values_need_no_branch() {
        let left = |cond, is_rare, args: fn(&mut Builder<'_>, Params) -> [Value; 2]| {
            branches(&after(&["branches_to_selects"], |b, x| {
                let (join, holds, [then, or]) =
                    (b.new_block(), b.compare(cond, x.m, x.n), args(b, x));
                let result = b.add_param(join, Type::I32);
                let then = Successor {
                    is_rare,
                    ..Successor::new(join, std::slice::from_ref(&then))
                };
                b.branch(holds, then, Successor::new(join, &[or]));
                b.switch_to(join);
                result
            }))
        };
        assert_eq!(left(Cond::Lt, false, |_, x| [x.n, x.m]), 0);
        assert_eq!(
            left(Cond::Eq, false, |b, _| [0, 1].map(|n| b.const32(n))),
            0
        );
        assert_eq!(left(Cond::Lt, true, |_, x| [x.n, x.m]), 1);
        assert_eq!(left(Cond::Lt, false, |b, x| [x.n, b.const32(3)]), 1);
    }
}

mod sinking {
    use super::*;

    /// Whether the value that `make` gives, which only a rare path uses, leaves the entry.
    fn sinks(make: impl FnOnce(&mut Builder<'_>, Params) -> Value) -> bool {
        let mut value = Value::NONE;
        let function = after(&["sink_into_cold_blocks"], |b, x| {
            value = make(b, x);
            rarely(b, x.n, |b| b.store(value, x.q, 0, SECOND));
            x.q
        });
        function.block_of(value) != function.entries()[0].block
    }

    #[test]
    fn values_pass_what_does_not_matter_to_them() {
        let load =
            |b: &mut Builder<'_>, x: Params, flags| b.load(Type::I32, x.p, 0, with(FIRST, flags));
        let plain = AccessFlags::empty();
        let after_call = |value: fn(&mut Builder<'_>, Params) -> Value| {
            sinks(|b, x| {
                let value = value(b, x);
                call(b);
                value
            })
        };
        let before_store = |heap: Heap| {
            sinks(|b, x| {
                let value = load(b, x, plain);
                b.store(x.q, x.q, 0, heap);
                value
            })
        };
        assert!(after_call(|b, x| b.mul(x.m, x.n)));
        assert!(after_call(|b, x| b.load(
            Type::I32,
            x.p,
            0,
            with(FIRST, AccessFlags::IMMUTABLE)
        )));
        assert!(!after_call(|b, x| b.add(x.p, x.q)));
        assert_eq!((before_store(SECOND), before_store(FIRST)), (true, false));
        assert!(sinks(|b, x| {
            let sum = b.add(x.p, x.q);
            check(b, x.m);
            sum
        }));
        assert!(!sinks(|b, x| load(b, x, AccessFlags::TRAPS)));
    }

    #[test]
    fn nothing_goes_into_a_loop() {
        let mut value = Value::NONE;
        let function = after(&["sink_into_cold_blocks"], |b, x| {
            value = b.mul(x.m, x.n);
            count_up(b, Test::Last, x.n, |b, counter| {
                rarely(b, counter, |b| b.store(value, x.q, 0, FIRST));
            });
            x.q
        });
        assert_eq!(loop_depth(&function, value), 0);
    }

    #[test]
    fn the_argument_of_a_rare_edge_is_computed_on_it() {
        let mut value = Value::NONE;
        let function = after(&["sink_into_cold_blocks"], |b, x| {
            let [usual, join] = [(); 2].map(|()| b.new_block());
            let result = b.add_param(join, Type::I32);
            value = b.mul(x.m, x.n);
            b.branch(x.p, Successor::new(join, &[value]).rare(), usual);
            b.switch_to(usual);
            b.jump(join, &[x.m]);
            b.switch_to(join);
            result
        });
        let rare = function.successor(function.entries()[0].block, 0);
        assert_eq!(function.block_of(value), function.target(rare));
    }
}

mod loops {
    use super::*;

    fn headers(function: &Function) -> Vec<Block> {
        let cfg = Cfg::new(function);
        cfg.loops().values().map(|data| data.header).collect()
    }

    #[test]
    fn the_test_moves_to_the_bottom_and_lets_loads_out() {
        let mut value = Value::NONE;
        let function = after(&["rotate_loops", "simplify"], |b, x| {
            count_up(b, Test::First, x.n, |b, counter| {
                value = b.load(Type::I32, x.p, 0, FIRST);
                let sum = b.add(value, counter);
                b.store(sum, x.q, 0, SECOND);
            });
            x.q
        });
        let header = headers(&function)[0];
        assert_eq!(function.target(function.successor(header, 0)), header);
        assert_eq!(loop_depth(&function, value), 0);
    }

    /// The header of the first leads straight to those of the second, inside it, and of the third, after it.
    fn adjoining(b: &mut Builder<'_>, x: Params) -> Value {
        let [first, second, body, third, last_body, done] = [(); 6].map(|()| b.new_block());
        b.jump(first, &[]);
        for (header, inside, outside) in [
            (first, second, third),
            (second, body, first),
            (third, last_body, done),
        ] {
            b.switch_to(header);
            let goes_on = b.load(Type::I32, x.p, 0, FIRST);
            b.branch(goes_on, inside, outside);
        }
        for (block, header) in [(body, second), (last_body, third)] {
            b.switch_to(block);
            call(b);
            b.jump(header, &[]);
        }
        b.switch_to(done);
        x.q
    }

    #[test]
    fn loops_that_adjoin_keep_their_shape() {
        assert_eq!(loop_count(&after(&["rotate_loops"], adjoining)), 3);
        let mut function = build(adjoining);
        peel_loops(&mut function, &mut Analyses::default(), |_, _, _| true);
        bun_engine_codegen::ir::validate(&function).unwrap();
        assert_eq!(loop_count(&function), 4);
    }

    /// The number of loops and of loads.
    fn unrolled(test: Test, limit: Option<i32>) -> (usize, usize) {
        let function = after(&["unroll_loops", "simplify"], |b, x| {
            let limit = limit.map_or(x.n, |limit| b.const32(limit));
            count_up(b, test, limit, |b, counter| {
                let value = b.load(Type::I32, x.p, 0, FIRST);
                let sum = b.add(value, counter);
                b.store(sum, x.q, 0, FIRST);
            });
            x.q
        });
        (loop_count(&function), loads(&function))
    }

    #[test]
    fn few_turns_are_written_out_and_many_go_in_fours() {
        for test in [Test::First, Test::Last] {
            assert_eq!(unrolled(test, Some(3)), (0, 3));
            assert_eq!(unrolled(test, Some(4)), (0, 4));
            assert_eq!(unrolled(test, Some(100)), (1, 4));
            assert_eq!(unrolled(test, None), (1, 4));
        }
    }

    #[test]
    fn copies_of_a_turn_keep_the_tags_and_the_layout_of_its_state() {
        let function = after(&["unroll_loops"], |b, x| {
            let three = b.const32(3);
            count_up(b, Test::Last, three, |b, counter| {
                let state = b.add_described_state([counter, x.p], 42);
                b.retag(state, 1, x.p, 5);
                let token = Token(0);
                b.check(x.m, Exit { token, state });
            });
            x.q
        });
        let values = function
            .blocks()
            .flat_map(|block| function.instructions(block));
        let states: Vec<_> = values
            .filter_map(|value| function.op(value).exit())
            .map(|exit| exit.state)
            .collect();
        assert_eq!(states.len(), 3);
        for state in states {
            assert_eq!(function.state(state).len(), 2);
            assert_eq!(function.state_layout(state), 42);
            assert_eq!(function.state_tags(state), [0, 5]);
        }
    }

    #[test]
    fn a_tuple_at_the_end_of_a_block_is_not_copied() {
        let function = build(|b, x| {
            count_up(b, Test::Last, x.n, |b, _| {
                let next = b.new_block();
                let data = PatchpointData::new(Action::Custom, Token(0), Effects::NONE);
                let results = [(Type::I64, Output::Register); 2];
                b.terminal_patchpoint(&data, &[], &results, &[next.into()]);
                b.switch_to(next);
            });
            x.q
        });
        let cfg = Cfg::new(&function);
        let only = cfg.loops().keys().next().unwrap();
        assert_eq!(cost_of_copying(&function, cfg.blocks_of(only), 100), None);
    }

    #[test]
    fn effects_include_those_of_inner_loops() {
        let mut function = build(|b, x| {
            count_up(b, Test::FirstAndLast, x.n, |b, _| {
                b.store(x.q, x.p, 0, SECOND);
                count_up(b, Test::Last, x.n, check);
            });
            x.q
        });
        let cfg = Cfg::new(&function);
        let [outer, inner] = [0, 1].map(|index| cfg.loops().keys().nth(index).unwrap());
        let mut effects = LoopEffects::new(&function, &cfg);
        assert!(effects.flags(outer).contains(EffectFlags::EXITS));
        assert!(!effects.flags(outer).contains(EffectFlags::FENCE));
        assert!(effects.may_write(&function, outer, BOTH));
        assert!(!effects.may_write(&function, outer, FIRST));
        assert!(!effects.may_write(&function, inner, BOTH));
        let edge = edge_from_preheader(&mut function, &cfg, outer);
        assert_eq!(*function.op(function.last(function.source(edge))), Op::Jump);
        assert_eq!(function.target(edge), cfg.loops()[outer].header);
    }
}
