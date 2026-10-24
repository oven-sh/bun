use bun_sema::bind::SymbolId;
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, MemberKey};

use crate::ir::generated::NameClass;
use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::expression::find_constant;
use crate::lower::{FileLowering, FunctionLowering, scope};

#[derive(Copy, Clone)]
pub(in crate::lower) struct TestedField {
    holder: SymbolId,
    holder_value: ValueId,
    key: PropertyKeyId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // Call right after lowering `expression`: reading the holder can rebind it to a converted value.
    pub(in crate::lower) fn find_tested_field(
        &mut self,
        expression: ExprId,
    ) -> Option<TestedField> {
        let access = self.file.skip_type_syntax(expression);
        let (object, member_key) = self.file.hir.member_key(access)?;
        if self.file.is_chain_root(access) {
            return None;
        }
        let identifier = self.file.tested_identifier(object)?;
        let holder = scope::find_tested_local(self, identifier)?;
        if !self.file.is_runtime_property_read(expression, access) {
            return None;
        }
        let key = find_field_key(self.file, member_key)?;
        Some(TestedField {
            holder,
            holder_value: self.read_local(holder),
            key,
        })
    }

    pub(in crate::lower) fn is_holder_unchanged(&mut self, field: TestedField) -> bool {
        self.read_local(field.holder) == field.holder_value
    }

    // The store to the holder can split the current block, so continue in `builder.current_block()`.
    pub(in crate::lower) fn narrow_holder(
        &mut self,
        field: TestedField,
        read: ValueId,
    ) -> Option<TestedField> {
        if !self.is_holder_unchanged(field) {
            return None;
        }
        let (holder, key) = (field.holder_value, field.key);
        let narrowed = self.builder.narrow_by_field(holder, read, key);
        self.rebind_local(field.holder, narrowed);
        Some(TestedField {
            holder_value: narrowed,
            ..field
        })
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn has_unit_type(&mut self, expression: ExprId) -> bool {
        let Ok(ty) = self.queries.expression_type(expression) else {
            return false;
        };
        let Ok(shape) = self.queries.type_shape(ty) else {
            return false;
        };
        matches!(
            shape.kind,
            ShapeKind::Undefined
                | ShapeKind::Null
                | ShapeKind::BooleanLiteral(_)
                | ShapeKind::NumberLiteral(_)
                | ShapeKind::NumericEnumMember(_)
                | ShapeKind::StringLiteral(_)
        )
    }

    // NarrowByField removes null and undefined from the holder, so the read must really run.
    fn is_runtime_property_read(&mut self, expression: ExprId, access: ExprId) -> bool {
        let mut layer = Some(expression);
        while let Some(current) = layer {
            if self.is_statically_resolved(current) {
                return false;
            }
            layer = self.hir.type_assertion_operand(current);
        }
        let modules = self.inputs.modules;
        if modules.member_binding(self.file, access).is_some() {
            return false;
        }
        if !self.hir.has_typescript_semantics() {
            return true;
        }
        match self.queries.constant_enum_access(access) {
            Ok(Some(_)) => false,
            Ok(None) | Err(_) => true,
        }
    }
}

fn find_field_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member_key: MemberKey,
) -> Option<PropertyKeyId> {
    let name = match member_key {
        MemberKey::Name(name) => name,
        MemberKey::Computed(key) => match find_constant(file, key) {
            Some(Constant::String(name)) => name,
            Some(
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::Number(_)
                | Constant::BigInt(_),
            )
            | None => return None,
        },
        MemberKey::PrivateName(_) => return None,
    };
    let key = file.name_key(name);
    let text = file.find_key_text(key)?;
    (file.fragment.strings.name_class(text) != NameClass::Index).then_some(key)
}
