use bun_sema::atom::{Atom, known};
use bun_sema::check::aot::{MemberLookup, ObjectMemberKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{self, ExprId, ExprKind, JsxId, PropId, PropKey, PropKind};
use bun_sema::import_sites::{has_static_children, is_ignored_key, jsx_children};
use smallvec::SmallVec;

use super::Element;
use crate::ir::{LayoutId, PropertyKeyId, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::object::{self, ObjectBuilder};
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, convert, expression, layouts};

struct Children {
    value: ValueId,
    source: Option<ExprId>,
}

fn collect_attributes(
    hir: &hir::File<'_>,
    jsx: JsxId,
    excluded: Option<PropId>,
) -> SmallVec<[PropId; 8]> {
    hir[jsx]
        .attrs
        .iter()
        .filter(|&attribute| Some(attribute) != excluded && !is_ignored_key(hir, attribute))
        .collect()
}

fn find_props_literal(hir: &hir::File<'_>, attributes: &[PropId]) -> Option<ExprId> {
    let &[mut property] = attributes else {
        return None;
    };
    let mut found = None;
    loop {
        let prop = hir[property];
        if prop.kind != PropKind::Spread {
            return found;
        }
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(prop.value)].kind else {
            return found;
        };
        found = Some(prop.value);
        if properties.len() != 1 {
            return found;
        }
        property = properties.at(0);
    }
}

fn find_props_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    element: Element,
) -> Option<CheckerTypeId> {
    file.queries.jsx_attributes_type(element.expression).ok().flatten()
}

fn find_props_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    props_type: Option<CheckerTypeId>,
    attributes: &[PropId],
    has_children: bool,
) -> LayoutId {
    if let Some(ty) = props_type
        && let Some(layout) = layouts::object_type_layout(file, ty)
    {
        return layout;
    }
    let hir = file.hir;
    let mut members: SmallVec<[(PropertyKeyId, ObjectMemberKind); 8]> = SmallVec::new();
    for &attribute in attributes {
        match hir[attribute].key {
            PropKey::Name(name) => {
                members.push((member::name_key(file, name), ObjectMemberKind::Field));
            }
            PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {}
        }
    }
    if has_children {
        members.push((member::name_key(file, known::children), ObjectMemberKind::Field));
    }
    layouts::untyped_layout(file, &members)
}

pub(super) fn lower_attribute_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    attribute: PropId,
) -> ValueId {
    let hir = lowering.file.hir;
    lowering.set_position(hir[attribute].pos);
    let Some(value) = hir[attribute].value.some() else {
        return lowering.builder.boolean(true);
    };
    if matches!(hir[value].kind, ExprKind::String(_)) {
        expression::emit_constant(lowering, Constant::String(hir.jsx_attribute_text(value)))
    } else {
        expression::lower_expression(lowering, value)
    }
}

fn lower_property_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    attribute: PropId,
    name: Atom,
) -> ValueId {
    let hir = lowering.file.hir;
    match hir[attribute].value.some() {
        Some(value) if !matches!(hir[value].kind, ExprKind::String(_)) => {
            lowering.set_position(hir[attribute].pos);
            let name = PropertyName::Constant(member::name_key(lowering.file, name));
            expression::lower_named_evaluation(lowering, value, name)
        }
        _ => lower_attribute_value(lowering, attribute),
    }
}

fn add_named_property(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    name: Atom,
    value: ValueId,
    source: Option<ExprId>,
) {
    let name = PropertyName::Constant(member::name_key(lowering.file, name));
    match source {
        Some(source) => object::add_property_with_source(lowering, object, name, value, source),
        None => object::add_property(lowering, object, name, value),
    }
}

fn add_attributes(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    props_type: Option<CheckerTypeId>,
    attributes: &[PropId],
) {
    let hir = lowering.file.hir;
    for &attribute in attributes {
        let prop = hir[attribute];
        if prop.kind == PropKind::Spread {
            let source = expression::lower_expression(lowering, prop.value);
            lowering.set_position(prop.pos);
            if let Some(props_type) = props_type {
                convert::record_spread_flow(lowering.file, prop.value, props_type);
            }
            object::add_spread(lowering, object, source);
            continue;
        }
        let PropKey::Name(name) = prop.key else {
            debug_assert!(false, "a JSX attribute is a spread or has a name");
            continue;
        };
        if name == known::__proto__ {
            let value = lower_attribute_value(lowering, attribute);
            lowering.set_position(prop.pos);
            object::set_prototype(lowering, object, value);
        } else {
            let value = lower_property_value(lowering, attribute, name);
            lowering.set_position(prop.pos);
            add_named_property(lowering, object, name, value, prop.value.some());
        }
    }
}

pub(super) fn lower_child_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    position: u32,
    leading: &[ValueId],
    children: &[ExprId],
) -> ValueId {
    expression::lower_argument_list(lowering, leading, children, position)
}

fn record_flow_into_child_list(
    file: &mut FileLowering<'_, '_, '_, '_>,
    props_type: Option<CheckerTypeId>,
    children: &[ExprId],
) {
    let Some(props_type) = props_type else {
        return;
    };
    let Ok(MemberLookup::Member(member)) = file.queries.find_member(props_type, known::children)
    else {
        return;
    };
    if let Ok(list) = member.types.checked {
        convert::record_list_flow(file, children, list);
    }
}

fn lower_children(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
    props_type: Option<CheckerTypeId>,
) -> Option<Children> {
    let hir = lowering.file.hir;
    let children: SmallVec<[ExprId; 8]> = jsx_children(hir, element.jsx).collect();
    if has_static_children(hir, element.jsx) {
        record_flow_into_child_list(lowering.file, props_type, &children);
        return Some(Children {
            value: lower_child_list(lowering, element.position, &[], &children),
            source: None,
        });
    }
    let name = PropertyName::Constant(member::name_key(lowering.file, known::children));
    children.first().map(|&only| Children {
        value: expression::lower_named_evaluation(lowering, only, name),
        source: Some(only),
    })
}

pub(super) fn lower_runtime_props(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
) -> ValueId {
    let hir = lowering.file.hir;
    let attributes = collect_attributes(hir, element.jsx, element.key);
    let props_type = find_props_type(lowering.file, element);
    if let Some(literal) = find_props_literal(hir, &attributes) {
        let props = expression::lower_expression(lowering, literal);
        if let (Some(props_type), Ok(own)) =
            (props_type, lowering.file.queries.expression_type(literal))
        {
            convert::record_type_flow(lowering.file, own, props_type, hir[literal].pos);
        }
        if let Some(children) = lower_children(lowering, element, props_type) {
            let name = PropertyName::Constant(member::name_key(lowering.file, known::children));
            lowering.set_position(element.position);
            member::emit_define(lowering, props, name, children.value);
        }
        return props;
    }
    let has_children = jsx_children(hir, element.jsx).next().is_some();
    let layout = find_props_layout(lowering.file, props_type, &attributes, has_children);
    let mut object = object::begin_object(lowering, layout);
    add_attributes(lowering, &mut object, props_type, &attributes);
    if let Some(children) = lower_children(lowering, element, props_type) {
        lowering.set_position(element.position);
        let Children { value, source } = children;
        add_named_property(lowering, &mut object, known::children, value, source);
    }
    lowering.set_position(element.position);
    object::finish_object(lowering, object)
}

pub(super) fn lower_create_element_props(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    element: Element,
) -> ValueId {
    let attributes = collect_attributes(lowering.file.hir, element.jsx, None);
    if attributes.is_empty() {
        lowering.set_position(element.position);
        return lowering.builder.null();
    }
    let props_type = find_props_type(lowering.file, element);
    let layout = find_props_layout(lowering.file, props_type, &attributes, false);
    let mut object = object::begin_object(lowering, layout);
    add_attributes(lowering, &mut object, props_type, &attributes);
    lowering.set_position(element.position);
    object::finish_object(lowering, object)
}
