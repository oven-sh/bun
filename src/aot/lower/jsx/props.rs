use bun_sema::atom::{Atom, known};
use bun_sema::check::aot::{MemberLookup, ObjectMemberKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{self, ExprId, ExprKind, JsxId, PropId, PropKey, PropKind};
use bun_sema::import_sites::{has_static_children, is_ignored_key, jsx_children};
use smallvec::SmallVec;

use super::Element;
use crate::ir::{LayoutId, PropertyKeyId, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::object::{self, ObjectBuilder};
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, convert};

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

impl FileLowering<'_, '_, '_, '_> {
    fn find_props_type(&mut self, element: Element) -> Option<CheckerTypeId> {
        self.queries
            .jsx_attributes_type(element.expression)
            .ok()
            .flatten()
    }

    fn find_props_layout(
        &mut self,
        props_type: Option<CheckerTypeId>,
        attributes: &[PropId],
        has_children: bool,
    ) -> LayoutId {
        if let Some(ty) = props_type
            && let Some(layout) = self.object_type_layout(ty)
        {
            return layout;
        }
        let hir = self.hir;
        let mut members: SmallVec<[(PropertyKeyId, ObjectMemberKind); 8]> = SmallVec::new();
        for &attribute in attributes {
            match hir[attribute].key {
                PropKey::Name(name) => {
                    members.push((self.name_key(name), ObjectMemberKind::Field));
                }
                PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {}
            }
        }
        if has_children {
            members.push((self.name_key(known::children), ObjectMemberKind::Field));
        }
        self.untyped_layout(&members)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_attribute_value(&mut self, attribute: PropId) -> ValueId {
        let hir = self.file.hir;
        self.set_position(hir[attribute].pos);
        let Some(value) = hir[attribute].value.some() else {
            return self.builder.boolean(true);
        };
        if matches!(hir[value].kind, ExprKind::String(_)) {
            self.emit_constant(Constant::String(hir.jsx_attribute_text(value)))
        } else {
            self.lower_expression(value)
        }
    }

    fn lower_property_value(&mut self, attribute: PropId, name: Atom) -> ValueId {
        let hir = self.file.hir;
        match hir[attribute].value.some() {
            Some(value) if !matches!(hir[value].kind, ExprKind::String(_)) => {
                self.set_position(hir[attribute].pos);
                let name = PropertyName::Constant(self.file.name_key(name));
                self.lower_named_evaluation(value, name)
            }
            _ => self.lower_attribute_value(attribute),
        }
    }

    fn add_named_property(
        &mut self,
        object: &mut ObjectBuilder,
        name: Atom,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        let name = PropertyName::Constant(self.file.name_key(name));
        self.add_property(object, name, value, source);
    }

    fn add_attributes(
        &mut self,
        object: &mut ObjectBuilder,
        props_type: Option<CheckerTypeId>,
        attributes: &[PropId],
    ) {
        let hir = self.file.hir;
        for &attribute in attributes {
            let prop = hir[attribute];
            if prop.kind == PropKind::Spread {
                let source = self.lower_expression(prop.value);
                self.set_position(prop.pos);
                if let Some(props_type) = props_type {
                    convert::record_spread_flow(self.file, prop.value, props_type);
                }
                self.add_spread(object, source);
                continue;
            }
            let PropKey::Name(name) = prop.key else {
                debug_assert!(false, "a JSX attribute is a spread or has a name");
                continue;
            };
            if name == known::__proto__ {
                let value = self.lower_attribute_value(attribute);
                self.set_position(prop.pos);
                object::set_prototype(self, object, value);
            } else {
                let value = self.lower_property_value(attribute, name);
                self.set_position(prop.pos);
                self.add_named_property(object, name, value, prop.value.some());
            }
        }
    }

    fn lower_children(
        &mut self,
        element: Element,
        props_type: Option<CheckerTypeId>,
    ) -> Option<(ValueId, Option<ExprId>)> {
        let hir = self.file.hir;
        let children: SmallVec<[ExprId; 8]> = jsx_children(hir, element.jsx).collect();
        if has_static_children(hir, element.jsx) {
            if let Some(props_type) = props_type
                && let Ok(MemberLookup::Member(member)) =
                    self.file.queries.find_member(props_type, known::children)
                && let Ok(list) = member.types.checked
            {
                self.file.record_list_flow(&children, list);
            }
            let list = self.lower_argument_list(&[], &children, element.position);
            return Some((list, None));
        }
        let name = PropertyName::Constant(self.file.name_key(known::children));
        let &only = children.first()?;
        Some((self.lower_named_evaluation(only, name), Some(only)))
    }

    pub(super) fn lower_runtime_props(&mut self, element: Element) -> ValueId {
        let hir = self.file.hir;
        let attributes = collect_attributes(hir, element.jsx, element.key);
        let props_type = self.file.find_props_type(element);
        if let Some(literal) = find_props_literal(hir, &attributes) {
            let props = self.lower_expression(literal);
            if let (Some(props_type), Ok(own)) =
                (props_type, self.file.queries.expression_type(literal))
            {
                self.file
                    .record_type_flow(own, props_type, hir[literal].pos);
            }
            if let Some((children, _)) = self.lower_children(element, props_type) {
                let name = PropertyName::Constant(self.file.name_key(known::children));
                self.set_position(element.position);
                self.emit_define(props, name, children);
            }
            return props;
        }
        let has_children = jsx_children(hir, element.jsx).next().is_some();
        let layout = self
            .file
            .find_props_layout(props_type, &attributes, has_children);
        let mut object = self.begin_object(layout);
        self.add_attributes(&mut object, props_type, &attributes);
        if let Some((value, source)) = self.lower_children(element, props_type) {
            self.set_position(element.position);
            self.add_named_property(&mut object, known::children, value, source);
        }
        self.set_position(element.position);
        object::finish_object(self, object)
    }

    pub(super) fn lower_create_element_props(&mut self, element: Element) -> ValueId {
        let attributes = collect_attributes(self.file.hir, element.jsx, None);
        if attributes.is_empty() {
            self.set_position(element.position);
            return self.builder.null();
        }
        let props_type = self.file.find_props_type(element);
        let layout = self.file.find_props_layout(props_type, &attributes, false);
        let mut object = self.begin_object(layout);
        self.add_attributes(&mut object, props_type, &attributes);
        self.set_position(element.position);
        object::finish_object(self, object)
    }
}
