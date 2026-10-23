mod array;
mod object;
mod view;

use bun_sema::check::aot::{PositionTypes, WrittenType};
use bun_sema::hir::{ExprId, PatId};

use self::view::NodeShape;
use super::expression::{self, AssignmentTarget};
use super::member::{self, KeyConversion, PropertyName, Reference};
use super::positions::{self, SiteOrigin};
use super::{FunctionLowering, call, commonjs, condition, convert, scope};
use crate::ir::ValueId;
use crate::ir::generated::TypeSiteKind;

#[derive(Copy, Clone, Debug)]
enum PatternNode {
    Binding(PatId),
    Assignment(ExprId),
}

enum PreparedTarget {
    AtStore,
    Reference(Reference),
}

pub(crate) fn bind_pattern(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
    value: ValueId,
    source: Option<ExprId>,
) {
    convert::record_binding_pattern_flow(lowering.file, pattern, source);
    destructure(lowering, PatternNode::Binding(pattern), value, source);
}

pub(crate) fn assign_pattern(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: ExprId,
    value: ValueId,
    source: Option<ExprId>,
) {
    if let Some(source) = source {
        convert::record_assignment_pattern_flow(lowering.file, target, source);
    }
    destructure(lowering, PatternNode::Assignment(target), value, source);
}

fn destructure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    value: ValueId,
    source: Option<ExprId>,
) {
    match view::node_shape(lowering.file, node) {
        NodeShape::Hole => {}
        NodeShape::Leaf => store_leaf(lowering, node, value, source),
        NodeShape::Object => {
            let module =
                source.and_then(|source| commonjs::find_destructured_module(lowering.file, source));
            if let Some(module) = module {
                if enter_pattern(lowering, node) {
                    object::destructure_exports(lowering, node, module);
                    lowering.leave_nesting();
                }
            } else if enter_pattern(lowering, node) {
                let value = convert_element(lowering, node, value);
                let source_position =
                    source.map(|source| call::last_reported_position(lowering.file, source));
                object::destructure_object(lowering, node, value, source_position);
                lowering.leave_nesting();
            }
        }
        NodeShape::Array => {
            if enter_pattern(lowering, node) {
                let value = convert_element(lowering, node, value);
                array::destructure_array(lowering, node, value);
                lowering.leave_nesting();
            }
        }
    }
}

fn enter_pattern(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, node: PatternNode) -> bool {
    let position = view::node_position(lowering.file, node);
    lowering.set_position(position);
    lowering.enter_nesting(position)
}

// What a pattern takes out of an object or a list has the type the checker gives the node that receives it.
fn convert_element(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    value: ValueId,
) -> ValueId {
    match node {
        PatternNode::Binding(pattern) => convert::convert_pattern_element(lowering, pattern, value),
        PatternNode::Assignment(_) => value,
    }
}

fn store_leaf(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    value: ValueId,
    source: Option<ExprId>,
) {
    let position = view::node_position(lowering.file, node);
    lowering.set_position(position);
    let value = convert_element(lowering, node, value);
    match node {
        PatternNode::Binding(pattern) => {
            scope::initialize_pattern_name(lowering, pattern, value, source);
        }
        PatternNode::Assignment(target) => {
            let reference = member::lower_reference(lowering, target, KeyConversion::AtAccess);
            member::put_reference(lowering, &reference, value, source);
        }
    }
}

fn prepare_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: PatternNode,
) -> PreparedTarget {
    let PatternNode::Assignment(expression) = target else {
        return PreparedTarget::AtStore;
    };
    match expression::classify_assignment_target(lowering.file, expression) {
        AssignmentTarget::Expression => {
            let reference = member::lower_reference(lowering, expression, KeyConversion::AtAccess);
            PreparedTarget::Reference(reference)
        }
        _ => PreparedTarget::AtStore,
    }
}

fn finish_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: PatternNode,
    prepared: PreparedTarget,
    value: ValueId,
) {
    match prepared {
        PreparedTarget::Reference(reference) => {
            let position = view::node_position(lowering.file, target);
            lowering.set_position(position);
            member::put_reference(lowering, &reference, value, None);
        }
        PreparedTarget::AtStore => destructure(lowering, target, value, None),
    }
}

// Under an annotation the node has the type the annotation gives the member, and the default is converted to it.
fn convert_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: PatternNode,
    default: ExprId,
    value: ValueId,
) -> ValueId {
    let PatternNode::Binding(pattern) = target else {
        return value;
    };
    if !view::has_annotated_root(lowering.file, target) {
        return value;
    }
    let types = PositionTypes {
        written: WrittenType::Unwritten,
        checked: lowering.file.queries.binding_type(pattern),
    };
    let origin = SiteOrigin {
        kind: TypeSiteKind::Variable,
        position: lowering.file.hir[pattern].pos,
    };
    let position = positions::create_position(lowering.file, types, origin);
    convert::convert_initializer(lowering, value, position, Some(default))
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    default: ExprId,
    target: PatternNode,
) -> ValueId {
    if default.is_none() {
        return value;
    }
    let result = lowering.builder.create_variable(None);
    let use_default = lowering.create_block();
    let join = lowering.create_block();
    let present = condition::branch_if_undefined(lowering, value, use_default);
    lowering.builder.write_variable(result, present);
    lowering.jump(join);
    lowering.continue_in(use_default);
    let name = match view::node_shape(lowering.file, target) {
        NodeShape::Leaf => view::default_function_name(lowering.file, target),
        NodeShape::Object | NodeShape::Array | NodeShape::Hole => None,
    };
    let default_value = match name {
        Some(name) => {
            let key = member::name_key(lowering.file, name);
            expression::lower_named_evaluation(lowering, default, PropertyName::Constant(key))
        }
        None => expression::lower_expression(lowering, default),
    };
    let default_value = convert_default(lowering, target, default, default_value);
    lowering.builder.write_variable(result, default_value);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}
