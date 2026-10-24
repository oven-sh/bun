use bun_sema::atom::{Atom, number_to_string};
use bun_sema::bind::Binding;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, MemberKey, PropKey};

use super::PropertyName;
use crate::builtins::table;
use crate::builtins::{
    Intrinsic, IntrinsicPosition, Mutability, Resolved, SourceDialect, find_intrinsic,
    find_symbol_key,
};
use crate::ir::generated::NameClass;
use crate::ir::{PropertyKey, PropertyKeyId, PropertyKeyKind, StringId, ValueId};
use crate::lower::{FileLowering, FunctionLowering, expression};
use crate::modules::ModuleRef;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn name_key(&mut self, name: Atom) -> PropertyKeyId {
        match self.source.dialect() {
            SourceDialect::Program => self.atom_key(name),
            SourceDialect::Runtime => self.runtime_name_key(name),
        }
    }

    pub(in crate::lower) fn function_name_key(
        &mut self,
        binding: Binding,
        written: Atom,
    ) -> PropertyKeyId {
        match self.short_function_name(binding) {
            Some(name) => self.text_key(name),
            None => self.name_key(written),
        }
    }

    // The key that the engine gives the symbol of `const name = Symbol(..)`: where the call stands, and the description.
    pub(in crate::lower) fn created_symbol_key(&mut self, name: Atom) -> Option<PropertyKeyId> {
        let creation = self.queries.symbol_creation(name)?;
        if !self.queries.files().is_compiled(creation.file)
            || self.inputs.is_left_out(creation.file)
        {
            return None;
        }
        let module = self.fragment.declare_module(ModuleRef::File(creation.file));
        let description = creation.description.map(|text| self.intern_atom(text));
        let key = PropertyKey::from_created_symbol(module, creation.position, description);
        Some(self.fragment.property_keys.intern(key))
    }

    fn runtime_name_key(&mut self, name: Atom) -> PropertyKeyId {
        let names = self.inputs.builtin_names;
        if let Some(symbol) = find_symbol_key(names, name) {
            return self.symbol_key(symbol);
        }
        let private_name = match find_intrinsic(names, name, IntrinsicPosition::Member) {
            Some(Intrinsic::PrivateName) => names.get_private(name),
            Some(_) | None => None,
        };
        let Some(private_name) = private_name else {
            return self.atom_key(name);
        };
        let text = self.intern_bytes(table::text_of_name(private_name));
        let key = PropertyKey::from_engine_private_name(text);
        self.fragment.property_keys.intern(key)
    }

    fn find_constant_key(&mut self, key: ExprId) -> Option<PropertyKeyId> {
        match expression::find_constant(self, key) {
            Some(Constant::String(name)) => Some(self.name_key(name)),
            Some(Constant::Number(number)) => {
                let text = self.intern_bytes(&number_to_string(number));
                Some(self.text_key(text))
            }
            Some(
                Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_),
            ) => None,
            None => self.find_locked_symbol_key(key),
        }
    }

    fn find_locked_symbol_key(&mut self, key: ExprId) -> Option<PropertyKeyId> {
        let path = match self.builtins.of_expr(self.skip_type_syntax(key)) {
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

    fn find_element_index(&self, key: PropertyKeyId) -> Option<u32> {
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

    /// What the property `name` of a function defined under a well-known symbol holds: "[Symbol.dispose]".
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
            PropKey::Computed(computed) => {
                if let Some(found) = self.file.find_constant_key(computed) {
                    return PropertyName::Constant(found);
                }
                let value = self.lower_expression(computed);
                self.set_position(self.file.hir[computed].pos);
                PropertyName::Computed(self.builder.to_property_key(value))
            }
            PropKey::Private(_) | PropKey::None => {
                debug_assert!(false, "the caller handles private names");
                PropertyName::Computed(self.builder.undefined())
            }
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
                debug_assert!(false, "no constant is the value of a key of this kind");
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
        match self.file.find_constant_key(key) {
            Some(found) => self.normalize_access_key(found),
            None => PropertyName::Computed(self.lower_expression(key)),
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
        PropertyKeyKind::WellKnownSymbol | PropertyKeyKind::CreatedSymbol => None,
        _ => key.string_name(),
    }
}
