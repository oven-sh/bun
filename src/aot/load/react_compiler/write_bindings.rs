use super::writer::{TreeWriter, UnsupportedNode, Written};
use bun_ast::binding::Data as BindingData;
use bun_ast::{B, Binding, G, flags};
use bun_sema::hir::{
    ExprId, Flags, NameKind, Param, ParamId, PatElem, PatElemId, PatId, PatKind, PatProp,
    PatPropId, PropKey, Span, TextRange, TypeNodeId,
};

const PRESERVED_PARAMETER_FLAGS: Flags = Flags::OPTIONAL
    .union(Flags::REPARSED)
    .union(Flags::PUBLIC)
    .union(Flags::PRIVATE)
    .union(Flags::PROTECTED)
    .union(Flags::READONLY)
    .union(Flags::OVERRIDE)
    .union(Flags::PARAMETER_PROPERTY);

impl TreeWriter<'_, '_> {
    pub(super) fn write_parameters(
        &mut self,
        parameters: &[G::Arg],
        function_flags: flags::FunctionSet,
        original: Span<ParamId>,
    ) -> Written<Span<ParamId>> {
        let has_rest = function_flags.contains(flags::Function::HasRestArg);
        let last_required = original.iter().rposition(|id| {
            let omittable = Flags::OPTIONAL.union(Flags::REST);
            self.file[id].default.is_none() && !self.file[id].flags.intersects(omittable)
        });
        let mut written = Vec::with_capacity(parameters.len());
        for (index, parameter) in parameters.iter().enumerate() {
            let is_before_required = last_required.is_some_and(|last| index < last);
            let replaced = (index < original.len())
                .then(|| (self.file[original.at(index)], is_before_required));
            let is_rest = has_rest && index + 1 == parameters.len();
            written.push(self.write_parameter(parameter, is_rest, replaced)?);
        }
        Ok(self.file.add_params(&written))
    }

    pub(super) fn write_binding(&mut self, binding: &Binding) -> Written<PatId> {
        if !self.stack.is_safe_to_recurse() {
            return Err(UnsupportedNode("nesting"));
        }
        let kind = match binding.data {
            BindingData::BIdentifier(identifier) => PatKind::Ident(self.name_of(identifier.r#ref)),
            BindingData::BArray(array) => PatKind::Array(self.write_binding_elements(&array)?),
            BindingData::BObject(object) => {
                PatKind::Object(self.write_binding_properties(&object)?)
            }
            BindingData::BMissing(_) => PatKind::Missing,
        };
        let (start, end) = self.range_of(binding.loc);
        Ok(self.file.pat(kind, start, end))
    }

    fn write_parameter(
        &mut self,
        parameter: &G::Arg,
        is_rest: bool,
        replaced: Option<(Param, bool)>,
    ) -> Written<Param> {
        if !parameter.ts_decorators.is_empty() || parameter.is_typescript_ctor_field {
            return Err(UnsupportedNode("TypeScript parameter"));
        }
        let pat = self.write_binding(&parameter.binding)?;
        let default = self.write_expression_or_none(parameter.default.as_ref())?;
        let (start, binding_end) = self.range_of(parameter.binding.loc);
        let is_identifier = matches!(parameter.binding.data, BindingData::BIdentifier(_));
        let can_be_optional = is_identifier && !is_rest && default.is_none();
        let (ty, mut flags) =
            self.annotate_parameter(replaced, default, can_be_optional, binding_end);
        flags.set(Flags::REST, is_rest);
        let type_end = ty.some().map_or(binding_end, |ty| self.file[ty].end);
        Ok(Param {
            pat,
            ty,
            default,
            flags,
            pos: start,
            loc: TextRange {
                pos: start,
                end: self.end_with_default(binding_end.max(type_end), default),
            },
        })
    }

    fn annotate_parameter(
        &mut self,
        replaced: Option<(Param, bool)>,
        default: ExprId,
        can_be_optional: bool,
        position: u32,
    ) -> (TypeNodeId, Flags) {
        let is_typescript = !self.file.is_js;
        let Some((parameter, is_before_required)) = replaced else {
            // A nested function has lost its `?` and its defaults: a caller may omit any of its parameters.
            return match (is_typescript, can_be_optional) {
                (true, true) => (self.any_type(position), Flags::OPTIONAL),
                (true, false) => (self.any_type(position), Flags::empty()),
                (false, _) => (TypeNodeId::NONE, Flags::empty()),
            };
        };
        let flags = parameter.flags & PRESERVED_PARAMETER_FLAGS;
        // The compiler moves a default into the body: `(a = 1)` becomes `(t0)`, which a caller may still omit.
        let has_default_in_body = parameter.default.is_some() && default.is_none();
        if !has_default_in_body {
            return (parameter.ty, flags);
        }
        let is_optional = can_be_optional && !is_before_required;
        let reuses_annotation = !is_typescript || is_optional && parameter.ty.is_some();
        let ty = match reuses_annotation {
            true => parameter.ty,
            false => self.any_type(position),
        };
        match is_optional {
            true => (ty, flags | Flags::OPTIONAL),
            false => (ty, flags),
        }
    }

    fn write_binding_elements(&mut self, array: &B::Array) -> Written<Span<PatElemId>> {
        let items = array.items();
        let mut written = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            let pat = self.write_binding(&item.binding)?;
            let default = self.write_expression_or_none(item.default_value.as_ref())?;
            let (start, end) = self.range_of(item.binding.loc);
            written.push(PatElem {
                pat,
                default,
                is_rest: array.has_spread && index + 1 == items.len(),
                start,
                end: self.end_with_default(end, default),
            });
        }
        Ok(self.file.add_pat_elems(&written))
    }

    fn write_binding_properties(&mut self, object: &B::Object) -> Written<Span<PatPropId>> {
        let properties = object.properties();
        let mut written = Vec::with_capacity(properties.len());
        for property in properties {
            written.push(self.write_binding_property(property)?);
        }
        Ok(self.file.add_pat_props(&written))
    }

    fn write_binding_property(&mut self, property: &B::Property) -> Written<PatProp> {
        let is_rest = property.flags.contains(flags::Property::IsSpread);
        let (key, name_kind) = match is_rest {
            true => (PropKey::None, NameKind::Identifier),
            false => self.write_property_key(&property.key, property.flags)?,
        };
        let value = self.write_binding(&property.value)?;
        let default = self.write_expression_or_none(property.default_value.as_ref())?;
        let (value_start, value_end) = self.range_of(property.value.loc);
        let key_pos = match is_rest {
            true => value_start,
            false => self.range_of(property.key.loc).0,
        };
        Ok(PatProp {
            key,
            name_kind,
            value,
            default,
            is_rest,
            pos: key_pos,
            key_pos,
            end: self.end_with_default(value_end, default),
        })
    }

    fn end_with_default(&self, end: u32, default: ExprId) -> u32 {
        default
            .some()
            .map_or(end, |default| end.max(self.file[default].end))
    }
}
