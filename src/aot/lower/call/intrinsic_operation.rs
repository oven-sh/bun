use bun_sema::atom::Atom;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind};
use smallvec::SmallVec;

use super::intrinsic::{IntrinsicCall, Lowered, Misuse};
use crate::builtins::{Intrinsic, Resolved};
use crate::ir::generated::{
    EntryField, IllTypedCause, MAX_TRACKED_INTEGER, OperandKind, PayloadKind,
};
use crate::ir::{ABSENT_WORD, DeclaredType, Opcode, Type, TypeId, TypeTable, ValueId};
use crate::lower::expression::find_constant;
use crate::lower::{FileLowering, FunctionLowering};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Copy, Clone)]
enum FieldValue {
    Operand(ValueId, OperandKind),
    Absent,
    Words(u64, u32),
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_operation(
        &mut self,
        site: IntrinsicCall<'_>,
        opcode: Opcode,
        private_key: bool,
    ) -> Lowered<ValueId> {
        let Some(fields) = opcode.simple_fields() else {
            return Err((site.call, Misuse::Position));
        };
        let values = self.lower_field_values(site, fields, private_key)?;
        self.set_position(self.file.hir[site.call].pos);
        let mut words: SmallVec<[u32; 8]> = SmallVec::new();
        for value in values {
            match value {
                FieldValue::Operand(operand, kind) => {
                    words.push(self.claim_operand_kind(operand, kind).to_word());
                }
                FieldValue::Absent => words.push(ABSENT_WORD),
                FieldValue::Words(bits, count) => {
                    let halves = [bits as u32, (bits >> 32) as u32];
                    words.extend_from_slice(&halves[..count as usize]);
                }
            }
        }
        let value = self.builder.emit(opcode, &words);
        if opcode.has_result() {
            Ok(value)
        } else {
            Ok(self.builder.undefined())
        }
    }

    fn lower_field_values(
        &mut self,
        site: IntrinsicCall<'_>,
        fields: &[EntryField],
        private_key: bool,
    ) -> Lowered<SmallVec<[FieldValue; 6]>> {
        let mut values: SmallVec<[FieldValue; 6]> = SmallVec::new();
        let mut remaining = site.arguments.iter().copied();
        for &field in fields {
            let value = match (field, remaining.next()) {
                (EntryField::Operand { kind, .. }, Some(argument)) => {
                    FieldValue::Operand(self.lower_intrinsic_argument(argument)?, kind)
                }
                (EntryField::Payload { kind, .. }, Some(argument)) => {
                    let Some(bits) = self.payload_bits(kind, private_key, argument) else {
                        return Err((argument, Misuse::ArgumentNotLiteral));
                    };
                    FieldValue::Words(bits, kind.words())
                }
                (
                    EntryField::Operand { is_optional, .. }
                    | EntryField::Payload { is_optional, .. },
                    None,
                ) => {
                    if !is_optional {
                        return Err((site.call, Misuse::ArgumentCount));
                    }
                    FieldValue::Absent
                }
            };
            values.push(value);
        }
        if remaining.next().is_some() {
            return Err((site.call, Misuse::ArgumentCount));
        }
        Ok(values)
    }

    fn payload_bits(
        &mut self,
        kind: PayloadKind,
        private_key: bool,
        argument: ExprId,
    ) -> Option<u64> {
        match kind {
            PayloadKind::String => {
                let text = self.file.find_string_literal(argument)?;
                Some(u64::from(self.file.intern_atom(text).to_word()))
            }
            PayloadKind::PropertyKey => {
                let text = self.file.find_string_literal(argument)?;
                let key = match private_key {
                    false => self.file.atom_key(text),
                    true => {
                        let bytes = self.file.queries.atom_bytes(text);
                        self.file.engine_private_key(bytes)
                    }
                };
                Some(u64::from(key.to_word()))
            }
            PayloadKind::UInt32
            | PayloadKind::Enum
            | PayloadKind::Flags
            | PayloadKind::External => {
                let word = u32::try_from(self.file.constant_integer(argument)?).ok()?;
                (word != ABSENT_WORD).then_some(u64::from(word))
            }
            PayloadKind::Bool => self.file.constant_boolean(argument).map(u64::from),
            PayloadKind::Int64 => self
                .file
                .constant_integer(argument)
                .map(|value| value as u64),
            PayloadKind::Double => self.file.constant_number(argument).map(f64::to_bits),
            _ => None,
        }
    }

    pub(super) fn claim_operand_kind(&mut self, value: ValueId, kind: OperandKind) -> ValueId {
        let Some(required) = operand_kind_type(&mut self.file.fragment.types, kind) else {
            return value;
        };
        let position = DeclaredType::from_compiler(required);
        self.builder.convert(value, position, IllTypedCause::None)
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_string_literal(&self, literal: ExprId) -> Option<Atom> {
        let ExprKind::String(text) = self.hir[literal].kind else {
            return None;
        };
        Some(text)
    }

    fn constant_number(&self, expression: ExprId) -> Option<f64> {
        let Some(Constant::Number(number)) = find_constant(self, expression) else {
            return None;
        };
        Some(number)
    }

    fn constant_integer(&self, expression: ExprId) -> Option<i64> {
        let inner = self.skip_type_syntax(expression);
        if let Some(Resolved::Intrinsic(Intrinsic::Int(value))) = self.builtins.of_expr(inner) {
            return Some(value);
        }
        let number = self.constant_number(expression)?;
        (number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER).then_some(number as i64)
    }

    fn constant_boolean(&self, expression: ExprId) -> Option<bool> {
        let inner = self.skip_type_syntax(expression);
        if let Some(Resolved::Intrinsic(Intrinsic::Bool(value))) = self.builtins.of_expr(inner) {
            return Some(value);
        }
        let Some(Constant::Boolean(value)) = find_constant(self, expression) else {
            return None;
        };
        Some(value)
    }
}

fn operand_kind_type(types: &mut TypeTable, kind: OperandKind) -> Option<TypeId> {
    match kind {
        OperandKind::Boolean => Some(TypeTable::BOOLEAN),
        OperandKind::Integer => {
            Some(types.intern(Type::integers(-MAX_TRACKED_INTEGER, MAX_TRACKED_INTEGER)))
        }
        OperandKind::Number => Some(TypeTable::NUMBER),
        OperandKind::String => Some(TypeTable::STRING),
        OperandKind::PropertyKey => Some(types.union(TypeTable::STRING, TypeTable::SYMBOL)),
        OperandKind::Object => Some(TypeTable::OBJECT),
        OperandKind::Callable => Some(TypeTable::FUNCTION),
        OperandKind::Array => Some(TypeTable::ARRAY),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::Primitives;

    #[test]
    fn typed_kinds_have_distinct_types() {
        let typed_kinds = [
            OperandKind::Boolean,
            OperandKind::Integer,
            OperandKind::Number,
            OperandKind::String,
            OperandKind::PropertyKey,
            OperandKind::Object,
            OperandKind::Callable,
            OperandKind::Array,
        ];
        let mut types = TypeTable::new();
        let mut found: Vec<TypeId> = Vec::new();
        for kind in typed_kinds {
            let ty = operand_kind_type(&mut types, kind).unwrap();
            assert!(!types.get(ty).is_never(), "{kind:?}");
            assert!(!found.contains(&ty), "{kind:?}");
            found.push(ty);
        }
    }

    #[test]
    fn property_key_kind_is_string_or_symbol() {
        let mut types = TypeTable::new();
        let key = operand_kind_type(&mut types, OperandKind::PropertyKey).unwrap();
        let expected = Type::primitives(Primitives::STRING | Primitives::SYMBOL);
        assert_eq!(*types.get(key), expected);
    }

    #[test]
    fn untyped_kinds_have_no_type() {
        let mut types = TypeTable::new();
        for kind in [
            OperandKind::Any,
            OperandKind::Declared,
            OperandKind::Results,
        ] {
            assert_eq!(operand_kind_type(&mut types, kind), None, "{kind:?}");
        }
    }
}
