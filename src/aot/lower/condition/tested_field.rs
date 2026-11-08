use bun_sema::bind::SymbolId;
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

use crate::ir::generated::NameClass;
use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::expression::{AssignmentTarget, find_constant};
use crate::lower::{FileLowering, FunctionLowering, scope};

#[derive(Copy, Clone)]
pub(in crate::lower) struct TestedField {
    holder: SymbolId,
    holder_value: ValueId,
    key: PropertyKeyId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn find_tested_field(
        &mut self,
        expression: ExprId,
    ) -> Option<TestedField> {
        let access = self.file.skip_type_syntax(expression);
        let (object, member_key) = self.file.hir.member_key(access)?;
        if self.file.is_chain_root(access) {
            return None;
        }
        let identifier = self.file.find_holder_identifier(object)?;
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

    fn find_holder_identifier(&self, object: ExprId) -> Option<ExprId> {
        let inner = self.skip_type_syntax(object);
        match self.hir[inner].kind {
            ExprKind::Ident(_) => Some(inner),
            ExprKind::Assign {
                op: None, target, ..
            } => match self.classify_assignment_target(target) {
                AssignmentTarget::Identifier { identifier, .. } => Some(identifier),
                _ => None,
            },
            _ => None,
        }
    }

    fn is_runtime_property_read(&mut self, expression: ExprId, access: ExprId) -> bool {
        let mut layer = Some(expression);
        while let Some(current) = layer {
            if self.is_statically_resolved(current) {
                return false;
            }
            layer = self.hir.type_assertion_operand(current);
        }
        let modules = self.inputs.modules;
        if modules.member_binding(self.file, access).is_some()
            || modules.member(self.file, access).is_some()
            || modules.answer_member(self.file, access).is_some()
        {
            return false;
        }
        if self.find_data_member_read(access).is_some() {
            return false;
        }
        self.find_enum_member_read(access).is_none()
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

#[cfg(test)]
mod tests {
    use crate::compile::testing::{default_settings, lower_program_with_settings};
    use crate::ir::Opcode;

    fn count_narrowed_holders(body: &str) -> usize {
        let source = format!("export function probe(s: any, t: any) {{ {body} }}\n");
        let files = [("main.ts", source.as_str())];
        let lowered = lower_program_with_settings(&files, &default_settings());
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let functions = fragments.flat_map(|fragment| &fragment.functions);
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        values
            .filter(|value| value.opcode == Opcode::NarrowByField)
            .count()
    }

    #[test]
    fn holder_has_a_value_of_its_own_behind_each_test_of_its_field() {
        let cases = [
            (
                "switch (s.kind) { case \"a\": return [s]; case \"b\": return s; } return t;",
                2,
            ),
            (
                "switch (s[\"kind\"]) { case 1: return [s]; default: return s; }",
                1,
            ),
            ("if (s.kind === \"a\") return [s]; return s;", 2),
            ("if (1 !== s.kind) return [s]; return s;", 2),
            ("return (s = t).kind === true ? [s] : s;", 2),
        ];
        for (body, expected) in cases {
            assert_eq!(count_narrowed_holders(body), expected, "{body}");
        }
    }

    #[test]
    fn holder_stays_as_it_is_where_the_test_says_nothing_of_it() {
        let bodies = [
            "if (s?.kind === \"a\") return [s]; return s;",
            "if (s.kind === t.kind) return [s]; return s;",
            "if (s.kind == \"a\") return [s]; return s;",
            "if (s[0] === \"a\") return [s]; return s;",
            "if (s.inner.kind === \"a\") return [s]; return s;",
            "if (s.kind === (s = t, \"a\")) return [s]; return s;",
            "switch (s.kind) { case (s = t): return [s]; } return s;",
            "const set = () => { s = t; }; if (s.kind === \"a\") return [s, set]; return s;",
        ];
        for body in bodies {
            assert_eq!(count_narrowed_holders(body), 0, "{body}");
        }
    }
}
