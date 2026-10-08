//! What is found out about a selector once, after it is parsed.

use super::program::{Bound, Id, Op, Program, TypeSet};
use crate::estree::NodeType;

/// What ESLint's `analyzeParsedSelector` finds.
#[derive(Default)]
pub(super) struct Analysis {
    /// The number of attributes, fields and `:nth-child()`s.
    pub(super) attribute_count: u32,
    /// The number of names of types.
    pub(super) identifier_count: u32,
}

impl Analysis {
    /// ESLint's `analyzeSelector`: the types of the nodes that the selector `id` can match. `None`:
    /// any.
    pub(super) fn analyze(&mut self, program: &Program, id: Id) -> Option<TypeSet> {
        match *program.ops.get(id as usize)? {
            Op::Identifier { node_type, is_exact } => {
                self.identifier_count += 1;
                Some(node_type.filter(|_| is_exact).map(|it| TypeSet::of(&[it])).unwrap_or_default())
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
                        intersection = Some(intersection.map_or(types, |all| all.intersection(types)));
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
                is_written_function: true,
                ..
            } => Some(types),
            Op::Class { .. } | Op::Wildcard | Op::ExactNode | Op::Has { .. } | Op::UnknownClass(_) => None,
        }
    }
}

/// The types of the nodes that `esquery` can find to match the selector `id`. `None`: any.
///
/// ESLint's analysis is not a substitute: it is about how names are written, and knows one class.
pub(super) fn possible_types(program: &Program, id: Id) -> Option<TypeSet> {
    let either = |a: Option<TypeSet>, b: Option<TypeSet>| a.zip(b).map(|(a, b)| a.union(b));
    match *program.ops.get(id as usize)? {
        Op::Identifier { node_type, .. } => Some(node_type.map(|it| TypeSet::of(&[it])).unwrap_or_default()),
        Op::Class { types, .. } => Some(types),
        Op::UnknownClass(_) => Some(TypeSet::default()),
        Op::Any(list) => {
            let each = list.of(&program.lists).iter().map(|&it| possible_types(program, it));
            each.fold(Some(TypeSet::default()), either)
        }
        Op::All(list) => {
            let each = list.of(&program.lists).iter().filter_map(|&it| possible_types(program, it));
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
            true => either(possible_types(program, left), possible_types(program, right)),
            false => possible_types(program, right),
        },
        _ => None,
    }
}

/// ESLint's `isAlwaysMatchingSelector`: a node of one of the types that the selector `id` can match
/// does match.
pub(super) fn always_matches(program: &Program, id: Id) -> bool {
    match program.ops.get(id as usize) {
        Some(Op::Identifier { .. } | Op::Wildcard) => true,
        Some(Op::Any(list)) => list.of(&program.lists).iter().all(|&it| always_matches(program, it)),
        _ => false,
    }
}

/// How much it takes to find out whether a node matches `op`, roughly.
fn cost(op: Op) -> u8 {
    match op {
        Op::Wildcard | Op::Identifier { .. } | Op::ExactNode | Op::UnknownClass(_) => 0,
        Op::Class { .. } => 1,
        Op::Attribute { .. } => 2,
        Op::Field(_) | Op::NthChild(_) => 3,
        Op::Has { .. } => 5,
        _ => 4,
    }
}

/// Changes `program` so that it finds the same with less work.
pub(super) fn optimize(program: &mut Program) {
    for id in 0..program.ops.len() {
        match program.ops[id] {
            Op::All(list) => {
                let ops = &program.ops;
                let cost_of = |id: &Id| ops.get(*id as usize).map_or(0, |it| cost(*it));
                list.of_mut(&mut program.lists).sort_by_key(cost_of);
                bind(program, list.of(&program.lists).to_vec().as_slice());
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

/// Of the selectors `all`, which a node has to match all of: if one is the name of a type, the first
/// key of each attribute is a field of that type.
fn bind(program: &mut Program, all: &[Id]) {
    let node_type: Option<NodeType> = all.iter().find_map(|&it| match program.ops.get(it as usize) {
        Some(Op::Identifier { node_type, .. }) => *node_type,
        _ => None,
    });
    let Some(node_type) = node_type else {
        return;
    };
    for &id in all {
        if let Some(Op::Attribute { path, first, .. }) = program.ops.get_mut(id as usize)
            && let Some(key) = path.of(&program.keys).first()
            && !key.property.is_of_nodes()
        {
            *first = match key.field.and_then(|it| node_type.field(it)) {
                Some(entry) => Bound::Entry(entry),
                None => Bound::Missing,
            };
        }
    }
}
