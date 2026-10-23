use bun_sema::atom::Atom;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind};
use smallvec::SmallVec;

use super::intrinsic::{
    IntrinsicCall, Lowered, Misuse, engine_private_key, lower_intrinsic_argument,
};
use crate::builtins::{Intrinsic, Resolved};
use crate::ir::generated::{
    EntryField, IllTypedCause, MAX_TRACKED_INTEGER, OperandKind, PayloadKind,
};
use crate::ir::{ABSENT_WORD, DeclaredType, Opcode, Type, TypeId, TypeTable, ValueId};
use crate::lower::expression::{find_constant, skip_type_syntax};
use crate::lower::{FileLowering, FunctionLowering};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum KeySpelling {
    Text,
    EnginePrivateName,
}

#[derive(Copy, Clone)]
enum FieldValue {
    Operand(ValueId, OperandKind),
    Absent,
    Words(u64, u32),
}

pub(super) fn lower_operation(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    opcode: Opcode,
    keys: KeySpelling,
) -> Lowered<ValueId> {
    let Some(fields) = opcode.simple_fields() else {
        return Err((site.call, Misuse::Position));
    };
    let values = lower_field_values(lowering, site, fields, keys)?;
    let position = lowering.file.hir[site.call].pos;
    lowering.set_position(position);
    let mut words: SmallVec<[u32; 8]> = SmallVec::new();
    for value in values {
        match value {
            FieldValue::Operand(operand, kind) => {
                words.push(claim_operand_kind(lowering, operand, kind).to_word());
            }
            FieldValue::Absent => words.push(ABSENT_WORD),
            FieldValue::Words(bits, count) => {
                let halves = [bits as u32, (bits >> 32) as u32];
                words.extend_from_slice(&halves[..count as usize]);
            }
        }
    }
    let value = lowering.builder.emit(opcode, &words);
    if opcode.has_result() {
        Ok(value)
    } else {
        Ok(lowering.builder.undefined())
    }
}

fn lower_field_values(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    fields: &[EntryField],
    keys: KeySpelling,
) -> Lowered<SmallVec<[FieldValue; 6]>> {
    let mut values: SmallVec<[FieldValue; 6]> = SmallVec::new();
    let mut remaining = site.arguments.iter().copied();
    for &field in fields {
        let value = match (field, remaining.next()) {
            (EntryField::Operand { kind, .. }, Some(argument)) => {
                FieldValue::Operand(lower_intrinsic_argument(lowering, argument)?, kind)
            }
            (EntryField::Payload { kind, .. }, Some(argument)) => {
                let Some(bits) = payload_bits(lowering, kind, keys, argument) else {
                    return Err((argument, Misuse::ArgumentNotLiteral));
                };
                FieldValue::Words(bits, kind.words())
            }
            (
                EntryField::Operand { is_optional, .. } | EntryField::Payload { is_optional, .. },
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
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    kind: PayloadKind,
    keys: KeySpelling,
    argument: ExprId,
) -> Option<u64> {
    match kind {
        PayloadKind::String => {
            let text = find_string_literal(lowering.file, argument)?;
            Some(u64::from(lowering.file.intern_atom(text).to_word()))
        }
        PayloadKind::PropertyKey => {
            let text = find_string_literal(lowering.file, argument)?;
            let key = match keys {
                KeySpelling::Text => lowering.file.atom_key(text),
                KeySpelling::EnginePrivateName => {
                    let bytes = lowering.file.queries.atom_bytes(text);
                    engine_private_key(lowering.file, bytes)
                }
            };
            Some(u64::from(key.to_word()))
        }
        PayloadKind::UInt32 | PayloadKind::Enum | PayloadKind::Flags | PayloadKind::External => {
            let word = u32::try_from(constant_integer(lowering.file, argument)?).ok()?;
            (word != ABSENT_WORD).then_some(u64::from(word))
        }
        PayloadKind::Bool => constant_boolean(lowering.file, argument).map(u64::from),
        PayloadKind::Int64 => constant_integer(lowering.file, argument).map(|value| value as u64),
        PayloadKind::Double => constant_number(lowering.file, argument).map(f64::to_bits),
        PayloadKind::Function
        | PayloadKind::Layout
        | PayloadKind::Field
        | PayloadKind::Variable
        | PayloadKind::Module
        | PayloadKind::ModuleFailure
        | PayloadKind::Type
        | PayloadKind::TypeSite
        | PayloadKind::EvalScope
        | PayloadKind::Data
        | PayloadKind::ExpectedResult
        | PayloadKind::Builtin
        | PayloadKind::Record
        | PayloadKind::Variant
        | PayloadKind::List => None,
    }
}

fn find_string_literal(file: &FileLowering<'_, '_, '_, '_>, literal: ExprId) -> Option<Atom> {
    let ExprKind::String(text) = file.hir[literal].kind else {
        return None;
    };
    Some(text)
}

fn constant_number(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Option<f64> {
    let Some(Constant::Number(number)) = find_constant(file, expression) else {
        return None;
    };
    Some(number)
}

fn constant_integer(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Option<i64> {
    let inner = skip_type_syntax(file, expression);
    if let Some(Resolved::Intrinsic(Intrinsic::Int(value))) = file.builtins.of_expr(inner) {
        return Some(value);
    }
    let number = constant_number(file, expression)?;
    (number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER).then_some(number as i64)
}

fn constant_boolean(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Option<bool> {
    let inner = skip_type_syntax(file, expression);
    if let Some(Resolved::Intrinsic(Intrinsic::Bool(value))) = file.builtins.of_expr(inner) {
        return Some(value);
    }
    let Some(Constant::Boolean(value)) = find_constant(file, expression) else {
        return None;
    };
    Some(value)
}

pub(super) fn claim_operand_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    kind: OperandKind,
) -> ValueId {
    let Some(required) = operand_kind_type(&mut lowering.file.fragment.types, kind) else {
        return value;
    };
    let position = DeclaredType::from_compiler(required);
    lowering
        .builder
        .convert(value, position, IllTypedCause::None)
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
        OperandKind::Any
        | OperandKind::Layout
        | OperandKind::Declared
        | OperandKind::Environment
        | OperandKind::EvalOperand
        | OperandKind::Results
        | OperandKind::IteratorState
        | OperandKind::Enumerator
        | OperandKind::Exception
        | OperandKind::ClassToken => None,
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
