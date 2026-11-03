use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, PatParent};
use bun_sema::hir::{ExprId, ExprKind, NameKind, PatId, PatKind, PropKey, PropKind};
use smallvec::SmallVec;

use super::PatternNode;
use crate::lower::FileLowering;
use crate::lower::expression::AssignmentTarget;

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

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn node_shape(&self, node: PatternNode) -> NodeShape {
        match node {
            PatternNode::Binding(pattern) => match self.hir[pattern].kind {
                PatKind::Missing => NodeShape::Hole,
                PatKind::Ident(_) => NodeShape::Leaf,
                PatKind::Object(_) => NodeShape::Object,
                PatKind::Array(_) => NodeShape::Array,
            },
            PatternNode::Assignment(target) => match self.classify_assignment_target(target) {
                AssignmentTarget::Elision => NodeShape::Hole,
                AssignmentTarget::ObjectPattern(_) => NodeShape::Object,
                AssignmentTarget::ArrayPattern(_) => NodeShape::Array,
                AssignmentTarget::Identifier { .. } | AssignmentTarget::Expression => {
                    NodeShape::Leaf
                }
            },
        }
    }

    // A property is printed as its key, its target and its default.
    pub(super) fn last_mapped_key_position(&self, property: &PatternProperty) -> u32 {
        match property.key {
            PropKey::Computed(key) => self.last_mapped_position(key),
            PropKey::None | PropKey::Name(_) | PropKey::Private(_) => property.position,
        }
    }

    // JSC reports the store to a member of an object pattern at the end of the member.
    pub(super) fn last_mapped_target_position(&self, target: PatternNode) -> u32 {
        match target {
            PatternNode::Binding(pattern) => self.hir[pattern].pos,
            PatternNode::Assignment(target) => self.last_mapped_position(target),
        }
    }

    pub(super) fn last_mapped_element_position(&self, element: &PatternElement) -> Option<u32> {
        if let Some(default) = element.default.some() {
            return Some(self.last_mapped_position(default));
        }
        match element.target {
            PatternNode::Binding(pattern) => self.last_mapped_pattern_position(pattern),
            PatternNode::Assignment(target) => match self.node_shape(element.target) {
                NodeShape::Hole => None,
                _ => Some(self.last_mapped_position(target)),
            },
        }
    }

    pub(super) fn has_annotated_root(&self, node: PatternNode) -> bool {
        let PatternNode::Binding(mut pattern) = node else {
            return false;
        };
        loop {
            match self.bound.pat_parent[pattern.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => pattern = parent,
                PatParent::Var(declaration) => return self.hir[declaration].ty.is_some(),
                PatParent::Param(parameter) => return self.hir[parameter].ty.is_some(),
                PatParent::None => return false,
            }
        }
    }

    // JSC records the store to a name that is declared where the name ends, which the source map takes back to where it starts.
    pub(in crate::lower) fn recorded_binding_position(&self, name: PatId) -> u32 {
        let name = self.hir[name];
        match self.runs_as_written() {
            true => name.end,
            false => name.pos,
        }
    }

    pub(super) fn node_position(&self, node: PatternNode) -> u32 {
        match node {
            PatternNode::Binding(pattern) => self.hir[pattern].pos,
            PatternNode::Assignment(target) => self.hir[target].pos,
        }
    }

    pub(super) fn pattern_properties(&self, node: PatternNode) -> SmallVec<[PatternProperty; 8]> {
        let hir = self.hir;
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
                    self.classify_assignment_target(literal)
                else {
                    return properties;
                };
                for id in list.iter() {
                    let property = hir[id];
                    let (target, default, is_rest) = match property.kind {
                        PropKind::Spread => (skip_spread(self, property.value), ExprId::NONE, true),
                        PropKind::Init | PropKind::Shorthand => {
                            let (target, default) = self.split_assignment_default(property.value);
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

    pub(super) fn pattern_elements(&self, node: PatternNode) -> SmallVec<[PatternElement; 8]> {
        let hir = self.hir;
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
                let AssignmentTarget::ArrayPattern(list) = self.classify_assignment_target(literal)
                else {
                    return elements;
                };
                for item in hir.ids(list) {
                    let is_rest = matches!(hir[item].kind, ExprKind::Spread(_));
                    let (target, default) = if is_rest {
                        (skip_spread(self, item), ExprId::NONE)
                    } else {
                        self.split_assignment_default(item)
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

    pub(super) fn written_leaf_name(&self, node: PatternNode) -> Option<Atom> {
        match node {
            PatternNode::Binding(pattern) => match self.hir[pattern].kind {
                PatKind::Ident(name) => Some(name),
                PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => None,
            },
            PatternNode::Assignment(target) => {
                let (identifier, _) = self.identifier_target(target)?;
                let ExprKind::Ident(written) = self.hir[identifier].kind else {
                    return None;
                };
                Some(written)
            }
        }
    }

    pub(super) fn default_function_name(&self, node: PatternNode) -> Option<(Binding, Atom, u32)> {
        match node {
            PatternNode::Binding(pattern) => {
                let name = self.written_leaf_name(node)?;
                let binding = self.bound.initialized_binding(pattern);
                Some((binding, name, self.hir[pattern].pos))
            }
            PatternNode::Assignment(target) => {
                let (identifier, name) = self.identifier_target(target)?;
                let binding = self.bound.binding(identifier);
                Some((binding, name, self.hir[identifier].pos))
            }
        }
    }

    pub(super) fn property_name(&self, property: &PatternProperty) -> Option<Atom> {
        match property.key {
            PropKey::Name(name) => Some(name),
            PropKey::None => self.written_leaf_name(property.target),
            PropKey::Private(_) | PropKey::Computed(_) => None,
        }
    }

    pub(super) fn nullish_error_name(&self, properties: &[PatternProperty]) -> Option<Atom> {
        let first = properties.first().filter(|property| !property.is_rest)?;
        match first.name_kind {
            NameKind::ComputedString | NameKind::ComputedNumber => None,
            _ => self.property_name(first),
        }
    }

    fn split_assignment_default(&self, element: ExprId) -> (ExprId, ExprId) {
        let erased = self.skip_type_syntax(element);
        let ExprKind::Assign { op, target, value } = self.hir[erased].kind else {
            return (element, ExprId::NONE);
        };
        if op.is_none() {
            (target, value)
        } else {
            (element, ExprId::NONE)
        }
    }

    fn identifier_target(&self, target: ExprId) -> Option<(ExprId, Atom)> {
        match self.classify_assignment_target(target) {
            AssignmentTarget::Identifier { identifier, name } => Some((identifier, name)),
            _ => None,
        }
    }
}

fn skip_spread(file: &FileLowering<'_, '_, '_, '_>, element: ExprId) -> ExprId {
    if let ExprKind::Spread(target) = file.hir[element].kind {
        target
    } else {
        element
    }
}
