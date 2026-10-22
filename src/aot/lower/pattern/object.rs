use bun_sema::hir::PropKey;
use smallvec::SmallVec;

use super::view::{self, PatternProperty};
use super::PatternNode;
use crate::ir::{LayoutId, ValueId};
use crate::ir::generated::RuntimeErrorKind;
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, commonjs, condition, exception, layouts};
use crate::modules::ModuleRef;

// JSC records no position for what an object pattern reads, so it is reported where the destructured expression ends.
pub(super) fn destructure_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    value: ValueId,
    source_position: Option<u32>,
) {
    let properties = view::pattern_properties(lowering.file, node);
    if let Some(position) = source_position {
        lowering.set_position(position);
    }
    let object = emit_object_coercible_check(lowering, &properties, value);
    let has_rest = properties.iter().any(|property| property.is_rest);
    let mut read_names: SmallVec<[PropertyName; 8]> = SmallVec::new();
    for property in &properties {
        lowering.set_position(property.position);
        if property.is_rest {
            destructure_rest(lowering, property, object, &read_names);
            continue;
        }
        let Some(name) = lower_pattern_key(lowering, property) else {
            continue;
        };
        let prepared = super::prepare_target(lowering, property.target);
        lowering.set_position(source_position.unwrap_or(property.position));
        let read = member::emit_get(lowering, object, name);
        lowering.set_position(property.position);
        let read = super::apply_default(lowering, read, property.default, property.target);
        super::finish_target(lowering, property.target, prepared, read);
        if has_rest {
            read_names.push(name);
        }
    }
}

// `const { a, b: c = d } = require(K)`, where nobody looks at what the call yields: each name is read once, here, from where the module keeps it.
pub(super) fn destructure_exports(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    module: ModuleRef,
) {
    for property in &view::pattern_properties(lowering.file, node) {
        debug_assert!(!property.is_rest, "a rest element looks at the object");
        lowering.set_position(property.position);
        let Some(name) = view::property_name(lowering.file, property) else {
            debug_assert!(false, "a computed key looks at the object");
            continue;
        };
        let prepared = super::prepare_target(lowering, property.target);
        lowering.set_position(property.position);
        let read = match commonjs::read_named_export(lowering, module, name) {
            Some(read) => read,
            None => lowering.builder.undefined(),
        };
        let read = super::apply_default(lowering, read, property.default, property.target);
        super::finish_target(lowering, property.target, prepared, read);
    }
}

fn emit_object_coercible_check(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    properties: &[PatternProperty],
    value: ValueId,
) -> ValueId {
    let error_name = view::nullish_error_name(lowering.file, properties)
        .map(|name| lowering.file.intern_atom(name));
    let nullish = lowering.create_unlikely_block();
    let object = condition::branch_if_nullish(lowering, value, nullish);
    let resume = lowering.builder.current_block();
    lowering.continue_in(nullish);
    exception::emit_throw_runtime_error(lowering, RuntimeErrorKind::NotDestructurable, error_name);
    lowering.builder.switch_to(resume);
    object
}

fn lower_pattern_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    property: &PatternProperty,
) -> Option<PropertyName> {
    match property.key {
        PropKey::Computed(_) => Some(member::lower_property_name(lowering, property.key)),
        PropKey::None | PropKey::Name(_) | PropKey::Private(_) => {
            let name = view::property_name(lowering.file, property)?;
            Some(PropertyName::Constant(member::name_key(lowering.file, name)))
        }
    }
}

fn destructure_rest(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    property: &PatternProperty,
    object: ValueId,
    read_names: &[PropertyName],
) {
    let prepared = super::prepare_target(lowering, property.target);
    lowering.set_position(property.position);
    let layout = find_rest_layout(lowering, property.target);
    let copy = crate::lower::object::emit_object_rest(lowering, object, read_names, layout);
    super::finish_target(lowering, property.target, prepared, copy);
}

// The copy is converted to the type of the binding, which only an object with the layout of that type passes.
fn find_rest_layout(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: PatternNode,
) -> Option<LayoutId> {
    let queries = &mut *lowering.file.queries;
    let ty = match target {
        PatternNode::Binding(pattern) => queries.binding_type(pattern).ok()?,
        PatternNode::Assignment(target) => {
            let assigned = queries.expression_type(target).ok()?;
            queries.without_nullish(assigned).ok()?
        }
    };
    layouts::object_type_layout(lowering.file, ty)
}
