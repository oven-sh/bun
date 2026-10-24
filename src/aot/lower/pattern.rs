mod array;
mod object;
mod view;

use bun_sema::check::aot::{PositionTypes, WrittenType};
use bun_sema::hir::{ExprId, PatId};

use self::view::NodeShape;
use super::FunctionLowering;
use super::expression::AssignmentTarget;
use super::member::{KeyConversion, PropertyName, Reference};
use super::positions::SiteOrigin;
use crate::ir::ValueId;
use crate::ir::generated::TypeSiteKind;

#[derive(Copy, Clone, Debug)]
pub(super) enum PatternNode {
    Binding(PatId),
    Assignment(ExprId),
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn bind_pattern(&mut self, pattern: PatId, value: ValueId, source: Option<ExprId>) {
        self.file.record_binding_pattern_flow(pattern, source);
        self.destructure(PatternNode::Binding(pattern), value, source);
    }

    pub(crate) fn assign_pattern(
        &mut self,
        target: ExprId,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        if let Some(source) = source {
            self.file.record_assignment_pattern_flow(target, source);
        }
        self.destructure(PatternNode::Assignment(target), value, source);
    }

    fn destructure(&mut self, node: PatternNode, value: ValueId, source: Option<ExprId>) {
        match self.file.node_shape(node) {
            NodeShape::Hole => {}
            NodeShape::Leaf => {
                let position = self.file.node_position(node);
                self.set_position(position);
                let value = self.convert_element(node, value);
                match node {
                    PatternNode::Binding(pattern) => {
                        self.initialize_pattern_name(pattern, value, source);
                    }
                    PatternNode::Assignment(target) => {
                        let reference = self.lower_reference(target, KeyConversion::AtAccess);
                        self.put_reference(&reference, value, source);
                    }
                }
            }
            NodeShape::Object => {
                let module = source.and_then(|source| self.file.find_destructured_module(source));
                if let Some(module) = module {
                    if self.enter_pattern(node) {
                        self.destructure_exports(node, module);
                        self.leave_nesting();
                    }
                } else if self.enter_pattern(node) {
                    let value = self.convert_element(node, value);
                    let source_position =
                        source.map(|source| self.file.last_reported_position(source));
                    self.destructure_object(node, value, source_position);
                    self.leave_nesting();
                }
            }
            NodeShape::Array => {
                if self.enter_pattern(node) {
                    let value = self.convert_element(node, value);
                    array::destructure_array(self, node, value);
                    self.leave_nesting();
                }
            }
        }
    }

    fn enter_pattern(&mut self, node: PatternNode) -> bool {
        let position = self.file.node_position(node);
        self.set_position(position);
        self.enter_nesting(position)
    }

    // What a pattern takes out of an object or a list has the type the checker gives the node that receives it.
    fn convert_element(&mut self, node: PatternNode, value: ValueId) -> ValueId {
        match node {
            PatternNode::Binding(pattern) => self.convert_pattern_element(pattern, value),
            PatternNode::Assignment(_) => value,
        }
    }

    // The reference of `[a.b] = ..` is evaluated before the value is read. Every other target is resolved at the store.
    fn prepare_target(&mut self, target: PatternNode) -> Option<Reference> {
        let PatternNode::Assignment(expression) = target else {
            return None;
        };
        match self.file.classify_assignment_target(expression) {
            AssignmentTarget::Expression => {
                Some(self.lower_reference(expression, KeyConversion::AtAccess))
            }
            _ => None,
        }
    }

    fn finish_target(&mut self, target: PatternNode, prepared: Option<Reference>, value: ValueId) {
        match prepared {
            Some(reference) => {
                let position = self.file.node_position(target);
                self.set_position(position);
                self.put_reference(&reference, value, None);
            }
            None => self.destructure(target, value, None),
        }
    }
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    default: ExprId,
    target: PatternNode,
) -> ValueId {
    // Under an annotation the node has the type the annotation gives the member, and the default is converted to it.
    apply_default_with(lowering, value, default, target, &mut |lowering, value| {
        let pattern = match target {
            PatternNode::Binding(pattern) if lowering.file.has_annotated_root(target) => pattern,
            PatternNode::Binding(_) | PatternNode::Assignment(_) => return value,
        };
        let types = PositionTypes {
            written: WrittenType::Unwritten,
            checked: lowering.file.queries.binding_type(pattern),
        };
        let origin = SiteOrigin {
            kind: TypeSiteKind::Variable,
            position: lowering.file.hir[pattern].pos,
        };
        let position = lowering.file.create_position(types, origin);
        lowering.convert_initializer(value, position, Some(default))
    })
}

// The default is evaluated where the value is `undefined`, and `convert` gives it the type of what receives it.
pub(super) fn apply_default_with(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    default: ExprId,
    target: PatternNode,
    convert: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, ValueId) -> ValueId,
) -> ValueId {
    if default.is_none() {
        return value;
    }
    let result = lowering.builder.create_variable(None);
    let use_default = lowering.create_block();
    let join = lowering.create_block();
    let present = lowering.branch_if_undefined(value, use_default);
    lowering.builder.write_variable(result, present);
    lowering.jump(join);
    lowering.continue_in(use_default);
    let name = match lowering.file.node_shape(target) {
        NodeShape::Leaf => lowering.file.default_function_name(target),
        NodeShape::Object | NodeShape::Array | NodeShape::Hole => None,
    };
    let default_value = match name {
        Some((binding, name)) => {
            let key = lowering.file.function_name_key(binding, name);
            lowering.lower_named_evaluation(default, PropertyName::Constant(key))
        }
        None => lowering.lower_expression(default),
    };
    let default_value = convert(lowering, default_value);
    lowering.builder.write_variable(result, default_value);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}
