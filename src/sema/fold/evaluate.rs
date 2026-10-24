use super::Constant;
use crate::atom::{Atom, Interner, known, number_to_string};
use crate::hir::{BinOp, UnOp};
use crate::util::LocalVec;
use bun_core::fmt::js_string_to_number;
use bun_core::strings;
use std::cell::Cell;
use std::cmp::Ordering;

const MAX_EXACT_INTEGER: u64 = 1 << f64::MANTISSA_DIGITS;
const UINT32_MODULUS: f64 = 4_294_967_296.0;

#[derive(Copy, Clone, Debug)]
pub(super) struct ScratchString(u32);

#[derive(Copy, Clone, Debug)]
pub(super) enum Primitive {
    Constant(Constant),
    ScratchString(ScratchString),
}

#[derive(Copy, Clone, Debug)]
pub(super) enum Value {
    Unknown,
    Known(Primitive),
}

impl From<Constant> for Value {
    fn from(constant: Constant) -> Value {
        Value::Known(Primitive::Constant(constant))
    }
}

impl Value {
    fn boolean(value: bool) -> Value {
        Value::from(Constant::Boolean(value))
    }

    fn number(number: f64) -> Value {
        Value::from(Constant::Number(canonicalize_nan(number)))
    }

    fn string(text: Atom) -> Value {
        Value::from(Constant::String(text))
    }
}

#[derive(Copy, Clone)]
enum Operand<'a> {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(&'a [u8]),
    BigInt(&'a [u8]),
}

pub(super) struct Evaluator<'a, 's> {
    atoms: &'a Interner<'s>,
    max_string_bytes: usize,
    over_limit_count: &'a Cell<u32>,
    scratch_strings: LocalVec<Box<[u8]>>,
}

impl<'a, 's> Evaluator<'a, 's> {
    pub(super) fn new(
        atoms: &'a Interner<'s>,
        max_string_bytes: usize,
        over_limit_count: &'a Cell<u32>,
    ) -> Self {
        Evaluator {
            atoms,
            max_string_bytes,
            over_limit_count,
            scratch_strings: LocalVec::new(),
        }
    }

    pub(super) fn max_string_bytes(&self) -> usize {
        self.max_string_bytes
    }

    pub(super) fn over_limit_count(&self) -> u32 {
        self.over_limit_count.get()
    }

    pub(super) fn note_over_limit(&self) {
        let count = self.over_limit_count.get();
        self.over_limit_count.set(count.saturating_add(1));
    }

    pub(super) fn to_constant(&self, primitive: Primitive) -> Constant {
        match primitive {
            Primitive::Constant(constant) => constant,
            Primitive::ScratchString(ScratchString(index)) => {
                Constant::String(self.atoms.intern(self.scratch_strings.get(index)))
            }
        }
    }

    pub(super) fn unary(&self, op: UnOp, operand: Value) -> Value {
        match (op, operand) {
            (UnOp::Void, _) => Value::from(Constant::Undefined),
            (UnOp::Plus, Value::Known(operand)) => self.unary_numeric(operand, |number| number),
            (UnOp::Minus, Value::Known(operand)) => self.unary_numeric(operand, |number| -number),
            (UnOp::BitNot, Value::Known(operand)) => {
                self.unary_numeric(operand, |number| f64::from(!to_int32(number)))
            }
            (UnOp::Not, Value::Known(operand)) => Value::boolean(!self.to_boolean(operand)),
            (UnOp::Typeof, Value::Known(operand)) => Value::string(type_of(self.operand(operand))),
            (
                UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof,
                Value::Unknown,
            )
            | (UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, _) => {
                Value::Unknown
            }
        }
    }

    pub(super) fn binary(&self, op: BinOp, left: Value, right: Value) -> Value {
        let addends = [left, right];
        let (Value::Known(left), Value::Known(right)) = (left, right) else {
            return Value::Unknown;
        };
        let (left, right) = (self.operand(left), self.operand(right));
        match op {
            BinOp::Add => self.add_all(addends),
            BinOp::Lt => evaluate_relational(left, right, Ordering::is_lt),
            BinOp::Le => evaluate_relational(left, right, Ordering::is_le),
            BinOp::Gt => evaluate_relational(left, right, Ordering::is_gt),
            BinOp::Ge => evaluate_relational(left, right, Ordering::is_ge),
            BinOp::EqEq => evaluate_loose_equality(left, right),
            BinOp::NotEq => self.unary(UnOp::Not, evaluate_loose_equality(left, right)),
            BinOp::EqEqEq => Value::boolean(is_strictly_equal(left, right)),
            BinOp::NotEqEq => Value::boolean(!is_strictly_equal(left, right)),
            BinOp::In | BinOp::Instanceof => Value::Unknown,
            BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma => {
                debug_assert!(false, "the folder owns the evaluation order of {op:?}");
                Value::Unknown
            }
            _ => evaluate_numeric_operands(op, left, right),
        }
    }

    pub(super) fn to_boolean(&self, primitive: Primitive) -> bool {
        match self.operand(primitive) {
            Operand::Undefined | Operand::Null => false,
            Operand::Boolean(value) => value,
            Operand::Number(number) => number != 0.0 && !number.is_nan(),
            Operand::String(text) => !text.is_empty(),
            Operand::BigInt(digits) => digits != b"0",
        }
    }

    pub(super) fn is_nullish(&self, primitive: Primitive) -> bool {
        match self.operand(primitive) {
            Operand::Undefined | Operand::Null => true,
            Operand::Boolean(_) | Operand::Number(_) | Operand::String(_) | Operand::BigInt(_) => {
                false
            }
        }
    }

    pub(super) fn is_string(&self, primitive: Primitive) -> bool {
        is_string(self.operand(primitive))
    }

    pub(super) fn push_text(&self, text: &mut Vec<u8>, primitive: Primitive) {
        push_string(text, self.operand(primitive));
    }

    pub(super) fn concatenate(&self, texts: &[Atom], values: &[Value]) -> Value {
        let Some((&first, rest)) = texts.split_first() else {
            return Value::Unknown;
        };
        if rest.len() != values.len() {
            return Value::Unknown;
        }
        if rest.is_empty() {
            return Value::string(first);
        }
        let substitutions = values
            .iter()
            .zip(rest)
            .flat_map(|(&value, &text)| [value, Value::string(text)]);
        self.join(std::iter::once(Value::string(first)).chain(substitutions))
    }

    pub(super) fn add_all(&self, addends: impl IntoIterator<Item = Value>) -> Value {
        let mut addends = addends.into_iter();
        let Some(mut sum) = addends.next() else {
            return Value::Unknown;
        };
        while let Some(addend) = addends.next() {
            let (Value::Known(left), Value::Known(right)) = (sum, addend) else {
                return Value::Unknown;
            };
            let (left, right) = (self.operand(left), self.operand(right));
            if is_string(left) || is_string(right) {
                return self.join([sum, addend].into_iter().chain(addends));
            }
            sum = evaluate_numeric_operands(BinOp::Add, left, right);
        }
        sum
    }

    fn join(&self, parts: impl IntoIterator<Item = Value>) -> Value {
        let mut text = Vec::new();
        for part in parts {
            let Value::Known(part) = part else {
                return Value::Unknown;
            };
            push_string(&mut text, self.operand(part));
            if text.len() > self.max_string_bytes {
                self.note_over_limit();
                return Value::Unknown;
            }
        }
        let index = self.scratch_strings.push(text.into_boxed_slice());
        Value::Known(Primitive::ScratchString(ScratchString(index)))
    }

    fn operand(&self, primitive: Primitive) -> Operand<'_> {
        match primitive {
            Primitive::Constant(Constant::Undefined) => Operand::Undefined,
            Primitive::Constant(Constant::Null) => Operand::Null,
            Primitive::Constant(Constant::Boolean(value)) => Operand::Boolean(value),
            Primitive::Constant(Constant::Number(number)) => Operand::Number(number),
            Primitive::Constant(Constant::String(text)) => Operand::String(self.atoms.bytes(text)),
            Primitive::Constant(Constant::BigInt(digits)) => {
                Operand::BigInt(self.atoms.bytes(digits))
            }
            Primitive::ScratchString(ScratchString(index)) => {
                Operand::String(self.scratch_strings.get(index))
            }
        }
    }

    fn unary_numeric(&self, operand: Primitive, operation: fn(f64) -> f64) -> Value {
        match to_number(self.operand(operand)) {
            Some(number) => Value::number(operation(number)),
            None => Value::Unknown,
        }
    }
}

fn evaluate_numeric(op: BinOp, left: f64, right: f64) -> Option<f64> {
    let result = match op {
        BinOp::Add => left + right,
        BinOp::Sub => left - right,
        BinOp::Mul => left * right,
        BinOp::Div => left / right,
        BinOp::Rem => left % right,
        BinOp::Pow => exponentiate(left, right)?,
        BinOp::Shl => f64::from(to_int32(left).wrapping_shl(to_uint32(right))),
        BinOp::Shr => f64::from(to_int32(left).wrapping_shr(to_uint32(right))),
        BinOp::UShr => f64::from(to_uint32(left).wrapping_shr(to_uint32(right))),
        BinOp::BitAnd => f64::from(to_int32(left) & to_int32(right)),
        BinOp::BitOr => f64::from(to_int32(left) | to_int32(right)),
        BinOp::BitXor => f64::from(to_int32(left) ^ to_int32(right)),
        _ => return None,
    };
    Some(canonicalize_nan(result))
}

fn to_int32(number: f64) -> i32 {
    to_uint32(number) as i32
}

fn to_uint32(number: f64) -> u32 {
    if number.is_finite() {
        number.trunc().rem_euclid(UINT32_MODULUS) as u32
    } else {
        0
    }
}

fn canonicalize_nan(number: f64) -> f64 {
    if number.is_nan() { f64::NAN } else { number }
}

fn to_number(operand: Operand<'_>) -> Option<f64> {
    match operand {
        Operand::Undefined => Some(f64::NAN),
        Operand::Null => Some(0.0),
        Operand::Boolean(value) => Some(f64::from(u8::from(value))),
        Operand::Number(number) => Some(number),
        Operand::String(text) => string_to_number(text),
        Operand::BigInt(_) => None,
    }
}

fn type_of(operand: Operand<'_>) -> Atom {
    match operand {
        Operand::Undefined => known::undefined,
        Operand::Null => known::object,
        Operand::Boolean(_) => known::boolean,
        Operand::Number(_) => known::number,
        Operand::String(_) => known::string,
        Operand::BigInt(_) => known::bigint,
    }
}

fn push_string(text: &mut Vec<u8>, operand: Operand<'_>) {
    match operand {
        Operand::Undefined => text.extend_from_slice(b"undefined"),
        Operand::Null => text.extend_from_slice(b"null"),
        Operand::Boolean(true) => text.extend_from_slice(b"true"),
        Operand::Boolean(false) => text.extend_from_slice(b"false"),
        Operand::Number(number) => text.extend_from_slice(&number_to_string(number)),
        Operand::String(part) | Operand::BigInt(part) => strings::push_wtf8(text, part),
    }
}

fn evaluate_numeric_operands(op: BinOp, left: Operand<'_>, right: Operand<'_>) -> Value {
    match (to_number(left), to_number(right)) {
        (Some(left), Some(right)) => {
            evaluate_numeric(op, left, right).map_or(Value::Unknown, Value::number)
        }
        (None, _) | (_, None) => Value::Unknown,
    }
}

fn evaluate_relational(
    left: Operand<'_>,
    right: Operand<'_>,
    accepts: fn(Ordering) -> bool,
) -> Value {
    if let (Operand::String(left), Operand::String(right)) = (left, right) {
        return if left.is_ascii() && right.is_ascii() {
            Value::boolean(accepts(left.cmp(right)))
        } else {
            Value::Unknown
        };
    }
    match (to_number(left), to_number(right)) {
        (Some(left), Some(right)) => Value::boolean(left.partial_cmp(&right).is_some_and(accepts)),
        (None, _) | (_, None) => Value::Unknown,
    }
}

fn evaluate_loose_equality(left: Operand<'_>, right: Operand<'_>) -> Value {
    match (left, right) {
        (Operand::Undefined | Operand::Null, Operand::Undefined | Operand::Null) => {
            Value::boolean(true)
        }
        (Operand::Undefined | Operand::Null, _) | (_, Operand::Undefined | Operand::Null) => {
            Value::boolean(false)
        }
        (Operand::String(left), Operand::String(right))
        | (Operand::BigInt(left), Operand::BigInt(right)) => Value::boolean(left == right),
        (Operand::BigInt(_), _) | (_, Operand::BigInt(_)) => Value::Unknown,
        (
            Operand::Boolean(_) | Operand::Number(_) | Operand::String(_),
            Operand::Boolean(_) | Operand::Number(_) | Operand::String(_),
        ) => match (to_number(left), to_number(right)) {
            (Some(left), Some(right)) => Value::boolean(left == right),
            (None, _) | (_, None) => Value::Unknown,
        },
    }
}

fn is_string(operand: Operand<'_>) -> bool {
    matches!(operand, Operand::String(_))
}

fn is_strictly_equal(left: Operand<'_>, right: Operand<'_>) -> bool {
    match (left, right) {
        (Operand::Undefined, Operand::Undefined) | (Operand::Null, Operand::Null) => true,
        (Operand::Boolean(left), Operand::Boolean(right)) => left == right,
        (Operand::Number(left), Operand::Number(right)) => left == right,
        (Operand::String(left), Operand::String(right))
        | (Operand::BigInt(left), Operand::BigInt(right)) => left == right,
        (
            Operand::Undefined
            | Operand::Null
            | Operand::Boolean(_)
            | Operand::Number(_)
            | Operand::String(_)
            | Operand::BigInt(_),
            _,
        ) => false,
    }
}

fn string_to_number(text: &[u8]) -> Option<f64> {
    if !text.is_ascii() {
        return None;
    }
    let integer_bits = match strings::trim_js_whitespace(text) {
        [b'0', b'x' | b'X', digits @ ..] => 4 * digits.len(),
        [b'0', b'o' | b'O', digits @ ..] => 3 * digits.len(),
        [b'0', b'b' | b'B', digits @ ..] => digits.len(),
        _ => 0,
    };
    let number = js_string_to_number(text);
    let is_exact = integer_bits <= f64::MANTISSA_DIGITS as usize;
    (is_exact || number.is_nan()).then_some(number)
}

pub(crate) fn is_exact_power(base: f64, exponent: f64) -> bool {
    exponentiate(base, exponent).is_some()
}

fn exponentiate(base: f64, exponent: f64) -> Option<f64> {
    if exponent.is_nan() {
        return Some(f64::NAN);
    }
    if exponent == 0.0 {
        return Some(1.0);
    }
    if exponent.is_infinite() && base.abs() == 1.0 {
        return Some(f64::NAN);
    }
    let magnitude = base.abs();
    let is_integer_power = base.fract() == 0.0
        && exponent.fract() == 0.0
        && exponent > 0.0
        && exponent.is_finite()
        && magnitude <= MAX_EXACT_INTEGER as f64;
    if !is_integer_power {
        return None;
    }
    let power = if magnitude <= 1.0 {
        magnitude
    } else if exponent > f64::from(f64::MANTISSA_DIGITS) {
        return None;
    } else {
        let factor = magnitude as u64;
        let mut power: u64 = 1;
        for _ in 0..exponent as u32 {
            let product = power.checked_mul(factor)?;
            if product > MAX_EXACT_INTEGER {
                return None;
            }
            power = product;
        }
        power as f64
    };
    let is_negative = base.is_sign_negative() && exponent % 2.0 != 0.0;
    Some(if is_negative { -power } else { power })
}

#[cfg(test)]
mod tests;
