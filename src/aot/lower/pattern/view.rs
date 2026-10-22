use bun_sema::atom::Atom;
use bun_sema::bind::PatParent;
use bun_sema::hir::{ExprId, ExprKind, NameKind, PatKind, PropKey, PropKind};
use smallvec::SmallVec;

use super::PatternNode;
use crate::lower::FileLowering;
use crate::lower::expression::{self, AssignmentTarget};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum NodeShape {
    Hole,
    Leaf,
    Object,
    Array,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct PatternProperty {
    pub(super) key: PropKey,
    pub(super) name_kind: NameKind,
    pub(super) target: PatternNode,
    pub(super) default: ExprId,
    pub(super) is_rest: bool,
    pub(super) position: u32,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct PatternElement {
    pub(super) target: PatternNode,
    pub(super) default: ExprId,
    pub(super) is_rest: bool,
}

pub(super) fn node_shape(file: &FileLowering<'_, '_, '_, '_>, node: PatternNode) -> NodeShape {
    match node {
        PatternNode::Binding(pattern) => match file.hir[pattern].kind {
            PatKind::Missing => NodeShape::Hole,
            PatKind::Ident(_) => NodeShape::Leaf,
            PatKind::Object(_) => NodeShape::Object,
            PatKind::Array(_) => NodeShape::Array,
        },
        PatternNode::Assignment(target) => {
            match expression::classify_assignment_target(file, target) {
                AssignmentTarget::Elision => NodeShape::Hole,
                AssignmentTarget::ObjectPattern(_) => NodeShape::Object,
                AssignmentTarget::ArrayPattern(_) => NodeShape::Array,
                AssignmentTarget::Identifier { .. } | AssignmentTarget::Expression => {
                    NodeShape::Leaf
                }
            }
        }
    }
}

pub(super) fn has_annotated_root(file: &FileLowering<'_, '_, '_, '_>, node: PatternNode) -> bool {
    let PatternNode::Binding(mut pattern) = node else {
        return false;
    };
    loop {
        match file.bound.pat_parent[pattern.idx()] {
            PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pattern = parent,
            PatParent::Var(declaration) => return file.hir[declaration].ty.is_some(),
            PatParent::Param(parameter) => return file.hir[parameter].ty.is_some(),
            PatParent::None => return false,
        }
    }
}

pub(super) fn node_position(file: &FileLowering<'_, '_, '_, '_>, node: PatternNode) -> u32 {
    match node {
        PatternNode::Binding(pattern) => file.hir[pattern].pos,
        PatternNode::Assignment(target) => file.hir[target].pos,
    }
}

pub(super) fn pattern_properties(
    file: &FileLowering<'_, '_, '_, '_>,
    node: PatternNode,
) -> SmallVec<[PatternProperty; 8]> {
    let hir = file.hir;
    let mut properties = SmallVec::new();
    match node {
        PatternNode::Binding(pattern) => {
            let PatKind::Object(list) = hir[pattern].kind else {
                return properties;
            };
            for id in list.iter() {
                let property = hir[id];
                properties.push(PatternProperty {
                    key: hir.runtime_binding_key(id),
                    name_kind: property.name_kind,
                    target: PatternNode::Binding(property.value),
                    default: property.default,
                    is_rest: property.is_rest,
                    position: property.pos,
                });
            }
        }
        PatternNode::Assignment(literal) => {
            let AssignmentTarget::ObjectPattern(list) =
                expression::classify_assignment_target(file, literal)
            else {
                return properties;
            };
            for id in list.iter() {
                let property = hir[id];
                let (target, default, is_rest) = match property.kind {
                    PropKind::Spread => (skip_spread(file, property.value), ExprId::NONE, true),
                    PropKind::Init | PropKind::Shorthand => {
                        let (target, default) = split_assignment_default(file, property.value);
                        (target, default, false)
                    }
                    PropKind::Method | PropKind::Getter | PropKind::Setter => continue,
                };
                properties.push(PatternProperty {
                    key: hir.runtime_property_key(id),
                    name_kind: property.name_kind,
                    target: PatternNode::Assignment(target),
                    default,
                    is_rest,
                    position: property.pos,
                });
            }
        }
    }
    properties
}

pub(super) fn pattern_elements(
    file: &FileLowering<'_, '_, '_, '_>,
    node: PatternNode,
) -> SmallVec<[PatternElement; 8]> {
    let hir = file.hir;
    let mut elements = SmallVec::new();
    match node {
        PatternNode::Binding(pattern) => {
            let PatKind::Array(list) = hir[pattern].kind else {
                return elements;
            };
            for id in list.iter() {
                let element = hir[id];
                elements.push(PatternElement {
                    target: PatternNode::Binding(element.pat),
                    default: element.default,
                    is_rest: element.is_rest,
                });
            }
        }
        PatternNode::Assignment(literal) => {
            let AssignmentTarget::ArrayPattern(list) =
                expression::classify_assignment_target(file, literal)
            else {
                return elements;
            };
            for item in hir.ids(list) {
                let is_rest = matches!(hir[item].kind, ExprKind::Spread(_));
                let (target, default) = if is_rest {
                    (skip_spread(file, item), ExprId::NONE)
                } else {
                    split_assignment_default(file, item)
                };
                elements.push(PatternElement {
                    target: PatternNode::Assignment(target),
                    default,
                    is_rest,
                });
            }
        }
    }
    elements
}

pub(super) fn written_leaf_name(
    file: &FileLowering<'_, '_, '_, '_>,
    node: PatternNode,
) -> Option<Atom> {
    match node {
        PatternNode::Binding(pattern) => match file.hir[pattern].kind {
            PatKind::Ident(name) => Some(name),
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => None,
        },
        PatternNode::Assignment(target) => {
            let (identifier, _) = identifier_target(file, target)?;
            let ExprKind::Ident(written) = file.hir[identifier].kind else {
                return None;
            };
            Some(written)
        }
    }
}

pub(super) fn default_function_name(
    file: &FileLowering<'_, '_, '_, '_>,
    node: PatternNode,
) -> Option<Atom> {
    match node {
        PatternNode::Binding(_) => written_leaf_name(file, node),
        PatternNode::Assignment(target) => identifier_target(file, target).map(|(_, name)| name),
    }
}

pub(super) fn property_name(
    file: &FileLowering<'_, '_, '_, '_>,
    property: &PatternProperty,
) -> Option<Atom> {
    match property.key {
        PropKey::Name(name) => Some(name),
        PropKey::None => written_leaf_name(file, property.target),
        PropKey::Private(_) | PropKey::Computed(_) => None,
    }
}

pub(super) fn nullish_error_name(
    file: &FileLowering<'_, '_, '_, '_>,
    properties: &[PatternProperty],
) -> Option<Atom> {
    let first = properties.first().filter(|property| !property.is_rest)?;
    match first.name_kind {
        NameKind::ComputedString | NameKind::ComputedNumber => None,
        NameKind::Identifier
        | NameKind::StringLiteral
        | NameKind::NumericLiteral
        | NameKind::Jsx => property_name(file, first),
    }
}

fn skip_spread(file: &FileLowering<'_, '_, '_, '_>, element: ExprId) -> ExprId {
    if let ExprKind::Spread(target) = file.hir[element].kind {
        target
    } else {
        element
    }
}

fn split_assignment_default(
    file: &FileLowering<'_, '_, '_, '_>,
    element: ExprId,
) -> (ExprId, ExprId) {
    let erased = expression::skip_type_syntax(file, element);
    let ExprKind::Assign { op, target, value } = file.hir[erased].kind else {
        return (element, ExprId::NONE);
    };
    if op.is_none() {
        (target, value)
    } else {
        (element, ExprId::NONE)
    }
}

fn identifier_target(
    file: &FileLowering<'_, '_, '_, '_>,
    target: ExprId,
) -> Option<(ExprId, Atom)> {
    match expression::classify_assignment_target(file, target) {
        AssignmentTarget::Identifier { identifier, name } => Some((identifier, name)),
        AssignmentTarget::Elision
        | AssignmentTarget::ArrayPattern(_)
        | AssignmentTarget::ObjectPattern(_)
        | AssignmentTarget::Expression => None,
    }
}
