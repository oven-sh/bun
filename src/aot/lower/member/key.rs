use bun_sema::atom::{Atom, number_to_string};
use bun_sema::bind::Binding;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, Flags, MemberId, MemberKey, PropKey};

use super::{GivenName, PropertyName};
use crate::builtins::table;
use crate::builtins::{
    Intrinsic, IntrinsicPosition, Mutability, Resolved, SourceDialect, find_intrinsic,
    find_symbol_key,
};
use crate::ir::generated::NameClass;
use crate::ir::{PropertyKey, PropertyKeyId, PropertyKeyKind, StringId, ValueId, WellKnownSymbol};
use crate::lower::{FileLowering, FunctionLowering, expression};
use crate::modules::ModuleRef;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn name_key(&mut self, name: Atom) -> PropertyKeyId {
        match self.source.dialect() {
            SourceDialect::Program => self.atom_key(name),
            SourceDialect::Runtime => self.runtime_name_key(name),
        }
    }

    pub(in crate::lower) fn name_given_by_binding(
        &mut self,
        binding: Binding,
        written: Atom,
    ) -> GivenName {
        let shown = match self.short_function_name(binding) {
            Some(name) => self.text_key(name),
            None => self.name_key(written),
        };
        GivenName::of_binding(written, PropertyName::Constant(shown))
    }

    pub(in crate::lower) fn name_as_written(&mut self, given: GivenName) -> GivenName {
        match given.written_name {
            Some(written) => PropertyName::Constant(self.name_key(written)).into(),
            None => given,
        }
    }

    pub(in crate::lower) fn created_symbol_key(&mut self, name: Atom) -> Option<PropertyKeyId> {
        let creation = self.queries.symbol_creation(name)?;
        if creation.is_registered {
            let text = self.intern_atom(creation.description?);
            let key = PropertyKey::from_registered_symbol(text);
            return Some(self.fragment.property_keys.intern(key));
        }
        if !self.queries.files().is_compiled(creation.file)
            || self.inputs.is_left_out(creation.file)
        {
            return None;
        }
        let module = self.fragment.declare_module(ModuleRef::File(creation.file));
        let description = creation.description.map(|text| self.intern_atom(text));
        let key = PropertyKey::from_created_symbol(module, creation.call_number, description);
        Some(self.fragment.property_keys.intern(key))
    }

    pub(in crate::lower) fn symbol_key_of_member(&mut self, name: Atom) -> Option<PropertyKeyId> {
        if let Some(created) = self.created_symbol_key(name) {
            return Some(created);
        }
        let member = self.queries.member_of_symbol_constructor(name)?;
        let (&head, tail) = self.queries.atom_bytes(member).split_first()?;
        let symbol = WellKnownSymbol::ALL.into_iter().find(|symbol| {
            let (first, rest) = symbol.name().split_at(1);
            first.as_bytes() == [head.to_ascii_uppercase()] && rest.as_bytes() == tail
        })?;
        Some(self.symbol_key(symbol))
    }

    pub(in crate::lower) fn find_name_that_key_spells(&mut self, key: PropKey) -> Option<StringId> {
        let PropKey::Computed(key) = key else {
            return None;
        };
        let symbol = self.queries.symbol_member_name(self.file, key)?;
        let name = match self.queries.symbol_creation(symbol)?.description {
            Some(text) => [b"[", self.queries.atom_bytes(text), b"]"].concat(),
            None => Vec::new(),
        };
        Some(self.intern_bytes(&name))
    }

    fn runtime_name_key(&mut self, name: Atom) -> PropertyKeyId {
        let names = self.inputs.builtin_names;
        if let Some(symbol) = find_symbol_key(names, name) {
            return self.symbol_key(symbol);
        }
        let intrinsic = find_intrinsic(names, name, IntrinsicPosition::Member);
        let private_name = match intrinsic {
            Some(Intrinsic::PrivateName | Intrinsic::ModulePrivateName) => names.get_private(name),
            Some(_) | None => None,
        };
        let Some(private_name) = private_name else {
            return self.atom_key(name);
        };
        let text = self.intern_bytes(table::text_of_name(private_name));
        let key = match intrinsic {
            Some(Intrinsic::ModulePrivateName) => PropertyKey::from_module_private_name(text),
            _ => PropertyKey::from_engine_private_name(text),
        };
        self.fragment.property_keys.intern(key)
    }

    fn find_constant_in_brackets(&self, key: ExprId) -> Option<Constant> {
        let constant = expression::find_constant(self, key);
        constant.or_else(|| self.find_signed_enum_member(key))
    }

    pub(in crate::lower) fn find_constant_key(&mut self, key: ExprId) -> Option<PropertyKeyId> {
        match self.find_constant_in_brackets(key) {
            Some(constant) => self.find_key_of_constant(constant),
            None => self.find_locked_symbol_key(key),
        }
    }

    pub(in crate::lower) fn find_constant_written_as_key(
        &self,
        member: MemberId,
    ) -> Option<Constant> {
        let node = self.hir[member];
        match self.hir.runtime_member_key(member) {
            PropKey::Computed(key) => self.find_constant_in_brackets(key),
            PropKey::Name(_) if node.flags.contains(Flags::STRING_NAME) => None,
            PropKey::Name(digits) if node.key == PropKey::None => Some(Constant::BigInt(digits)),
            PropKey::Name(text)
                if node
                    .flags
                    .intersects(Flags::LITERAL_NAME | Flags::COMPUTED_NAME) =>
            {
                let text = core::str::from_utf8(self.queries.atom_bytes(text)).ok()?;
                text.parse().ok().map(Constant::Number)
            }
            PropKey::Name(_) | PropKey::Private(_) | PropKey::None => None,
        }
    }

    fn find_key_of_constant(&mut self, constant: Constant) -> Option<PropertyKeyId> {
        match constant {
            Constant::String(name) => Some(self.name_key(name)),
            Constant::Number(number) => {
                let text = self.intern_bytes(&number_to_string(number));
                Some(self.text_key(text))
            }
            Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_) => {
                None
            }
        }
    }

    pub(in crate::lower) fn find_locked_symbol_key(
        &mut self,
        key: ExprId,
    ) -> Option<PropertyKeyId> {
        let path = match self.builtins.of_pure_expr(self.skip_type_syntax(key)) {
            Some(Resolved::Builtin(path)) => path,
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => return None,
        };
        match path.mutability {
            Mutability::AlwaysLocked => {
                let symbol = table::well_known_symbol(path.id)?;
                Some(self.symbol_key(symbol))
            }
            Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn => None,
        }
    }

    pub(in crate::lower) fn find_element_index(&self, key: PropertyKeyId) -> Option<u32> {
        let key = self.fragment.property_keys.get(key);
        let text = match key.kind {
            PropertyKeyKind::Text => key.text?,
            _ => return None,
        };
        let strings = &self.fragment.strings;
        if strings.name_class(text) != NameClass::Index {
            return None;
        }
        let digits = strings.get(text).iter();
        Some(digits.fold(0, |index, digit| index * 10 + u32::from(digit - b'0')))
    }

    pub(in crate::lower) fn find_key_text(&self, key: PropertyKeyId) -> Option<StringId> {
        self.fragment.property_keys.get(key).string_name()
    }

    pub(in crate::lower) fn find_name_under_symbol(
        &mut self,
        key: PropertyKeyId,
    ) -> Option<StringId> {
        let key = self.fragment.property_keys.get(key);
        if key.kind != PropertyKeyKind::WellKnownSymbol {
            return None;
        }
        let (first, rest) = key.symbol?.name().split_at(1);
        let name = format!("[Symbol.{}{rest}]", first.to_ascii_lowercase());
        Some(self.intern_bytes(name.as_bytes()))
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_property_name(&mut self, key: PropKey) -> PropertyName {
        match key {
            PropKey::Name(name) => PropertyName::Constant(self.file.name_key(name)),
            PropKey::Computed(computed) => self.lower_computed_property_name(computed).0,
            PropKey::Private(_) | PropKey::None => {
                debug_assert!(false, "the caller handles private names");
                PropertyName::Computed(self.builder.undefined())
            }
        }
    }

    pub(crate) fn lower_computed_property_name(
        &mut self,
        computed: ExprId,
    ) -> (PropertyName, Option<ValueId>) {
        if let Some(found) = self.file.find_constant_key(computed) {
            return (PropertyName::Constant(found), None);
        }
        let position = self.position();
        let value = self.lower_expression(computed);
        if self.builder.is_constant(value) {
            let constant = expression::find_constant_outside_dead_zone(self.file, computed);
            if let Some(found) =
                constant.and_then(|constant| self.file.find_key_of_constant(constant))
            {
                self.set_position(position);
                return (PropertyName::Constant(found), Some(value));
            }
        }
        let key = self.builder.to_property_key(value);
        (PropertyName::Computed(key), Some(value))
    }

    pub(crate) fn lower_computed_name_read_by_pattern(&mut self, computed: ExprId) -> PropertyName {
        if let Some(found) = self.file.find_constant_key(computed) {
            return PropertyName::Constant(found);
        }
        let position = self.position();
        let value = self.lower_expression(computed);
        let constant = expression::find_constant_outside_dead_zone(self.file, computed);
        match constant.and_then(|constant| self.file.find_key_of_constant(constant)) {
            Some(found) => {
                self.set_position(position);
                PropertyName::Constant(found)
            }
            None => PropertyName::Computed(self.builder.to_property_key(value)),
        }
    }

    pub(crate) fn emit_name_value(&mut self, name: PropertyName) -> ValueId {
        let key = match name {
            PropertyName::Constant(key) => *self.file.fragment.property_keys.get(key),
            PropertyName::Computed(value) => return value,
        };
        match key.kind {
            PropertyKeyKind::Text => {
                let text = key.text.expect("a text key has its text");
                self.builder.string(text)
            }
            PropertyKeyKind::WellKnownSymbol => {
                let symbol = key
                    .symbol
                    .expect("a well-known symbol key names its symbol");
                self.emit_locked_builtin(table::symbol_constant(symbol))
            }
            _ => {
                debug_assert!(false, "a key of this kind has no constant value");
                self.builder.undefined()
            }
        }
    }

    pub(in crate::lower) fn lower_member_key(&mut self, member: MemberKey) -> PropertyName {
        match member {
            MemberKey::Name(name) => {
                let key = self.file.name_key(name);
                self.normalize_access_key(key)
            }
            MemberKey::Computed(key) => self.lower_computed_key(key),
            MemberKey::PrivateName(_) => {
                debug_assert!(false, "the caller handles private names");
                PropertyName::Computed(self.builder.undefined())
            }
        }
    }

    pub(in crate::lower) fn lower_computed_key(&mut self, key: ExprId) -> PropertyName {
        if let Some(found) = self.file.find_constant_key(key) {
            return self.normalize_access_key(found);
        }
        let position = self.position();
        let value = self.lower_expression(key);
        let constant = expression::find_constant_outside_dead_zone(self.file, key);
        match constant.and_then(|constant| self.file.find_key_of_constant(constant)) {
            Some(found) => {
                self.set_position(position);
                self.normalize_access_key(found)
            }
            None => PropertyName::Computed(value),
        }
    }

    pub(super) fn normalize_access_key(&mut self, key: PropertyKeyId) -> PropertyName {
        match self.file.find_element_index(key) {
            Some(index) => PropertyName::Computed(self.builder.integer(i64::from(index))),
            None => PropertyName::Constant(key),
        }
    }
}

pub(in crate::lower) fn find_function_name(
    file: &FileLowering<'_, '_, '_, '_>,
    key: PropertyKeyId,
) -> Option<StringId> {
    let key = file.fragment.property_keys.get(key);
    match key.kind {
        PropertyKeyKind::WellKnownSymbol
        | PropertyKeyKind::CreatedSymbol
        | PropertyKeyKind::RegisteredSymbol => None,
        _ => key.string_name(),
    }
}
