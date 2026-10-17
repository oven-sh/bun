use super::nullish::{Overlay, Slice, for_each_slice, has_handlers, targets_of};
use crate::declared::Declared;
use crate::id::V;
use crate::ir::{BinOp, CoerceReason, Def, Func, Op, Program, RelOp, Term, UnOp};
use bun_sema::util::InParallel;

type Range = (i64, i64);

const NO_BLOCK: usize = usize::MAX;

fn integer_only_range(described: &Declared) -> Option<Range> {
    let is_integer_only = described.prims == 0
        && described.parts.is_empty()
        && !described.any_object
        && !described.any_function;
    described.ints.filter(|_| is_integer_only)
}

fn integer_range(func: &Func, tys: &Overlay<'_>, value: V) -> Option<Range> {
    let ty = func.ty(value);
    if ty.is_none() || ty == tys.anything {
        return None;
    }
    integer_only_range(tys.get(ty))
}

fn strip_integer_conversions(func: &Func, tys: &Overlay<'_>, mut value: V) -> V {
    loop {
        let operand = match func.op(value) {
            Some(&Op::Unary {
                op: UnOp::ToNumber | UnOp::ToNumeric,
                a,
            }) => a,
            Some(&Op::Coerce {
                value,
                why:
                    CoerceReason::Store
                    | CoerceReason::Cast
                    | CoerceReason::Claim
                    | CoerceReason::Flow
                    | CoerceReason::Upcast,
                ..
            }) => value,
            _ => return value,
        };
        if integer_range(func, tys, operand).is_none() {
            return value;
        }
        value = operand;
    }
}

struct Dominators {
    immediate: Vec<usize>,
    incoming_edges: Vec<u32>,
}

impl Dominators {
    fn new(func: &Func) -> Dominators {
        let count = func.blocks.len();
        let mut postorder: Vec<usize> = Vec::with_capacity(count);
        let mut is_visited = vec![false; count];
        let mut stack: Vec<(usize, usize)> = vec![(Func::ENTRY.idx(), 0)];
        is_visited[Func::ENTRY.idx()] = true;
        while let Some(&(block, next)) = stack.last() {
            let targets = targets_of(func.blocks[block].term.as_ref());
            let Some(target) = targets.get(next) else {
                postorder.push(block);
                stack.pop();
                continue;
            };
            stack.last_mut().expect("the block is on the stack").1 += 1;
            let successor = target.block.idx();
            if !is_visited[successor] {
                is_visited[successor] = true;
                stack.push((successor, 0));
            }
        }
        let mut number = vec![0usize; count];
        for (index, &block) in postorder.iter().enumerate() {
            number[block] = index;
        }
        let mut predecessors: Vec<Vec<usize>> = vec![Vec::new(); count];
        for &block in &postorder {
            for target in targets_of(func.blocks[block].term.as_ref()) {
                predecessors[target.block.idx()].push(block);
            }
        }
        let mut immediate = vec![NO_BLOCK; count];
        immediate[Func::ENTRY.idx()] = Func::ENTRY.idx();
        loop {
            let mut has_changed = false;
            for &block in postorder.iter().rev().skip(1) {
                let mut found = NO_BLOCK;
                for &predecessor in predecessors[block]
                    .iter()
                    .filter(|&&predecessor| immediate[predecessor] != NO_BLOCK)
                {
                    if found == NO_BLOCK {
                        found = predecessor;
                        continue;
                    }
                    let mut other = predecessor;
                    while found != other {
                        while number[found] < number[other] {
                            found = immediate[found];
                        }
                        while number[other] < number[found] {
                            other = immediate[other];
                        }
                    }
                }
                has_changed |= immediate[block] != found;
                immediate[block] = found;
            }
            if !has_changed {
                break;
            }
        }
        Dominators {
            immediate,
            incoming_edges: predecessors
                .iter()
                .map(|predecessors| predecessors.len() as u32)
                .collect(),
        }
    }
}

fn negated(op: RelOp) -> RelOp {
    match op {
        RelOp::Lt => RelOp::Ge,
        RelOp::Le => RelOp::Gt,
        RelOp::Gt => RelOp::Le,
        RelOp::Ge => RelOp::Lt,
    }
}

fn flipped(op: RelOp) -> RelOp {
    match op {
        RelOp::Lt => RelOp::Gt,
        RelOp::Le => RelOp::Ge,
        RelOp::Gt => RelOp::Lt,
        RelOp::Ge => RelOp::Le,
    }
}

fn range_after_dominating_tests(
    func: &Func,
    tys: &Overlay<'_>,
    dominators: &Dominators,
    value: V,
    block: usize,
) -> Option<Range> {
    let tested = strip_integer_conversions(func, tys, value);
    let (mut minimum, mut maximum) = integer_range(func, tys, tested)?;
    let mut dominated = block;
    while dominated != Func::ENTRY.idx() {
        let dominator = dominators.immediate[dominated];
        if dominator == NO_BLOCK {
            return None;
        }
        if dominators.incoming_edges[dominated] == 1
            && let Some(Term::Branch {
                cond,
                then,
                otherwise,
            }) = &func.blocks[dominator].term
            && then.block != otherwise.block
        {
            let (mut condition, mut holds) = (*cond, then.block.idx() == dominated);
            while let Some(&Op::Not(inner)) = func.op(condition) {
                condition = inner;
                holds = !holds;
            }
            if let Some(&Op::Relational { op, a, b }) = func.op(condition)
                && let (Some(left), Some(right)) =
                    (integer_range(func, tys, a), integer_range(func, tys, b))
            {
                let op = if holds { op } else { negated(op) };
                let mut narrow = |op: RelOp, bound: Range| match op {
                    RelOp::Lt => maximum = maximum.min(bound.1 - 1),
                    RelOp::Le => maximum = maximum.min(bound.1),
                    RelOp::Gt => minimum = minimum.max(bound.0 + 1),
                    RelOp::Ge => minimum = minimum.max(bound.0),
                };
                if strip_integer_conversions(func, tys, a) == tested {
                    narrow(op, right);
                }
                if strip_integer_conversions(func, tys, b) == tested {
                    narrow(flipped(op), left);
                }
            }
        }
        dominated = dominator;
    }
    (minimum <= maximum).then_some((minimum, maximum))
}

pub(super) fn eliminate_redundant_integer_casts(
    program: &mut Program,
    in_parallel: InParallel<'_>,
) {
    let Program {
        tys: table, funcs, ..
    } = program;
    let mut unused = vec![false; funcs.len()];
    for_each_slice(
        table,
        funcs,
        &mut unused,
        in_parallel,
        &|Slice { funcs, tys, .. }| {
            let mut casts: Vec<(V, V, Range)> = Vec::new();
            for func in funcs.iter_mut() {
                casts.clear();
                for &cast in func.blocks.iter().flat_map(|block| &block.ops) {
                    if let Some(&Op::Coerce {
                        value,
                        to,
                        why: CoerceReason::Cast | CoerceReason::Store,
                    }) = func.op(cast)
                        && matches!(
                            func.op(value),
                            Some(Op::Binary {
                                op: BinOp::Add | BinOp::Sub,
                                ..
                            })
                        )
                        && to.is_some()
                        && to != tys.anything
                        && let (Some(have), Some(want)) = (
                            integer_range(func, tys, value),
                            integer_only_range(tys.get(to)),
                        )
                        && (have.0 < want.0 || have.1 > want.1)
                    {
                        casts.push((cast, value, want));
                    }
                }
                if casts.is_empty() || has_handlers(func) {
                    continue;
                }
                let dominators = Dominators::new(func);
                for &(cast, value, want) in &casts {
                    let Some(block) = func
                        .blocks
                        .iter()
                        .position(|block| block.ops.contains(&value))
                    else {
                        continue;
                    };
                    let Some(&Op::Binary { op, a, b }) = func.op(value) else {
                        continue;
                    };
                    let (Some(left), Some(right)) = (
                        range_after_dominating_tests(func, tys, &dominators, a, block),
                        range_after_dominating_tests(func, tys, &dominators, b, block),
                    ) else {
                        continue;
                    };
                    let (minimum, maximum) = if op == BinOp::Add {
                        (left.0 + right.0, left.1 + right.1)
                    } else {
                        (left.0 - right.1, left.1 - right.0)
                    };
                    if minimum < want.0 || maximum > want.1 {
                        continue;
                    }
                    func.values[value.idx()].ty = tys.intern(Declared::ints(minimum, maximum));
                    if let Def::Op(Op::Coerce { why, .. }) = &mut func.values[cast.idx()].def {
                        *why = CoerceReason::Upcast;
                    }
                }
            }
        },
    );
}
