//! Analysis done once on a selector, after it's parsed.

use super::program::{Bound, Id, Op, Program, Run, TypeSet};
use crate::estree::NodeType;

/// The results of ESLint's `analyzeParsedSelector`.
#[derive(Default)]
pub(super) struct Analysis {
    /// The number of attributes, fields and `:nth-child()`s.
    pub(super) attribute_count: u32,
    /// The number of type names.
    pub(super) identifier_count: u32,
    /// True if so many combinators are chained that they don't fit on the stack. `esquery` throws
    /// when it matches.
    pub(super) is_too_deep: bool,
}

impl Analysis {
    /// ESLint's `analyzeSelector`: the node types that selector `id` can match. `None` means any.
    pub(super) fn analyze(&mut self, program: &Program, id: Id) -> Option<TypeSet> {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            self.is_too_deep = true;
            return None;
        }
        match *program.ops.get(id as usize)? {
            Op::Identifier {
                node_type,
                is_exact,
            } => {
                self.identifier_count += 1;
                Some(
                    node_type
                        .filter(|_| is_exact)
                        .map(|it| TypeSet::of(&[it]))
                        .unwrap_or_default(),
                )
            }
            Op::NotAny(list) => {
                for &it in list.of(&program.lists) {
                    self.analyze(program, it);
                }
                None
            }
            Op::Any(list) => {
                let mut union = Some(TypeSet::default());
                for &it in list.of(&program.lists) {
                    let types = self.analyze(program, it);
                    union = union.zip(types).map(|(all, types)| all.union(types));
                }
                union
            }
            Op::All(list) => {
                let mut intersection: Option<TypeSet> = None;
                for &it in list.of(&program.lists) {
                    if let Some(types) = self.analyze(program, it) {
                        intersection =
                            Some(intersection.map_or(types, |all| all.intersection(types)));
                    }
                }
                intersection
            }
            Op::Attribute { .. } | Op::Field(_) | Op::NthChild(_) => {
                self.attribute_count += 1;
                None
            }
            Op::Child(left, right)
            | Op::Descendant(left, right)
            | Op::Sibling { left, right, .. }
            | Op::Adjacent { left, right, .. } => {
                self.analyze(program, left);
                self.analyze(program, right)
            }
            Op::Class {
                types,
                is_function_class: true,
                ..
            } => Some(types),
            Op::Class { .. }
            | Op::Wildcard
            | Op::ExactNode
            | Op::Has { .. }
            | Op::UnknownClass(_) => None,
        }
    }
}

/// The node types that `esquery` can match against selector `id`. `None` means any.
///
/// ESLint's analysis can't replace this: it goes by how names are spelled, and it only knows one class.
pub(super) fn possible_types(program: &Program, id: Id) -> Option<TypeSet> {
    let either = |a: Option<TypeSet>, b: Option<TypeSet>| a.zip(b).map(|(a, b)| a.union(b));
    match *program.ops.get(id as usize)? {
        Op::Identifier { node_type, .. } => {
            Some(node_type.map(|it| TypeSet::of(&[it])).unwrap_or_default())
        }
        Op::Class { types, .. } => Some(types),
        Op::UnknownClass(_) => Some(TypeSet::default()),
        Op::Any(list) => {
            let each = list
                .of(&program.lists)
                .iter()
                .map(|&it| possible_types(program, it));
            each.fold(Some(TypeSet::default()), either)
        }
        Op::All(list) => {
            let each = list
                .of(&program.lists)
                .iter()
                .filter_map(|&it| possible_types(program, it));
            each.reduce(TypeSet::intersection)
        }
        Op::Child(_, right) | Op::Descendant(_, right) => possible_types(program, right),
        Op::Sibling {
            left,
            right,
            left_is_subject: is_either,
        }
        | Op::Adjacent {
            left,
            right,
            right_is_subject: is_either,
        } => match is_either {
            true => either(
                possible_types(program, left),
                possible_types(program, right),
            ),
            false => possible_types(program, right),
        },
        _ => None,
    }
}

/// ESLint's `isAlwaysMatchingSelector`: true if every node of a type that selector `id` can match
/// does match.
pub(super) fn always_matches(program: &Program, id: Id) -> bool {
    match program.ops.get(id as usize) {
        Some(Op::Identifier { .. } | Op::Wildcard) => true,
        Some(Op::Any(list)) => list
            .of(&program.lists)
            .iter()
            .all(|&it| always_matches(program, it)),
        _ => false,
    }
}

/// A rough cost of testing a node against `op`.
fn cost(op: Op) -> u8 {
    match op {
        Op::Wildcard => 0,
        Op::Identifier { .. } | Op::ExactNode | Op::UnknownClass(_) | Op::Class { .. } => 1,
        Op::Attribute { .. } => 2,
        Op::Field(_) | Op::NthChild(_) => 3,
        Op::Has { .. } => 5,
        _ => 4,
    }
}

fn cost_of_op(ops: &[Op], id: Id) -> u8 {
    ops.get(id as usize).map_or(0, |it| cost(*it))
}

/// Rewrites `program` to get the same matches with less work.
pub(super) fn optimize(program: &mut Program) {
    for id in 0..program.ops.len() {
        match program.ops[id] {
            Op::All(list) => {
                let ops = &program.ops;
                let cost_of = |id: &Id| cost_of_op(ops, *id);
                crate::utils::sort::sort_by_key(list.of_mut(&mut program.lists), cost_of);
                bind(program, list);
                // `*` adds nothing, unless it's the only selector.
                let wildcards = list
                    .of(&program.lists)
                    .iter()
                    .take_while(|it| cost_of_op(&program.ops, **it) == 0)
                    .count() as u32;
                let skipped = wildcards.min(list.len.saturating_sub(1));
                let rest = Run {
                    start: list.start + skipped,
                    len: list.len - skipped,
                };
                program.ops[id] = match *rest.of(&program.lists) {
                    [only] => program
                        .ops
                        .get(only as usize)
                        .copied()
                        .unwrap_or(Op::All(rest)),
                    _ => Op::All(rest),
                };
            }
            Op::Attribute {
                path,
                test,
                first: Bound::No,
            } => {
                if let Some(key) = path
                    .of(&program.keys)
                    .first()
                    .filter(|it| !it.property.is_node_property())
                {
                    let first = key.field.map_or(Bound::Missing, Bound::Field);
                    program.ops[id] = Op::Attribute { path, test, first };
                }
            }
            Op::Has { selectors, .. } => {
                let is_about_children = selectors.of(&program.lists).iter().all(|&it| {
                    matches!(program.ops.get(it as usize), Some(&Op::Child(left, _))
                        if matches!(program.ops.get(left as usize), Some(Op::ExactNode)))
                });
                program.ops[id] = Op::Has {
                    selectors,
                    is_about_children,
                };
            }
            _ => {}
        }
    }
}

/// `all` is a list of selectors that a node has to match all of. If one of them is a type name, the
/// first key of each attribute is resolved as a field of that type.
fn bind(program: &mut Program, all: Run) {
    let Program {
        ops, lists, keys, ..
    } = program;
    let all = all.of(lists);
    let node_type: Option<NodeType> = all.iter().find_map(|&it| match ops.get(it as usize) {
        Some(Op::Identifier { node_type, .. }) => *node_type,
        _ => None,
    });
    let Some(node_type) = node_type else {
        return;
    };
    for &id in all {
        if let Some(Op::Attribute { path, first, .. }) = ops.get_mut(id as usize)
            && let Some(key) = path.of(keys).first()
            && !key.property.is_node_property()
        {
            *first = match key.field.and_then(|it| node_type.field(it)) {
                Some(entry) => Bound::Entry(entry),
                None => Bound::Missing,
            };
        }
    }
}
