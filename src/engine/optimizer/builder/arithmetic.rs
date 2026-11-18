//! Operators that compute.

use bun_engine_bytecode::{MetadataKind, Operand, Register};
use bun_engine_codegen::ir::{Binary, Value as Ssa};
use bun_engine_vm::{Arithmetic, ArithmeticProfile, SpeculatedType as T, Value};
use smallvec::SmallVec;

use super::Builder;
use crate::graph::{ArithmeticData, ExitKind, InLine, Kind, Operator};

const QUIET: T = T::BOXED_NUMBER.union(T::BOOLEAN).union(T::NULLISH);
const NUMERIC: T = T::BOXED_NUMBER.union(T::BIGINT);

/// The operands of an instruction, and what they are likely to be.
struct Operands {
    values: SmallVec<[Ssa; 2]>,
    likely: SmallVec<[T; 2]>,
    seen: Arithmetic,
}

impl Operands {
    fn are_likely(&self, ty: T) -> bool {
        self.likely.iter().all(|&it| ty.contains(it))
    }
}

/// What an operator does to numbers.
enum OnNumbers {
    Node(Kind),
    /// With 1.
    Step(Kind),
    Bits(Binary),
    Complement,
}

impl Operator {
    fn on_numbers(self) -> OnNumbers {
        match self {
            Self::Add => OnNumbers::Node(Kind::NumberAdd),
            Self::Subtract => OnNumbers::Node(Kind::NumberSubtract),
            Self::Multiply => OnNumbers::Node(Kind::NumberMultiply),
            Self::Divide => OnNumbers::Node(Kind::NumberDivide),
            Self::Remainder => OnNumbers::Node(Kind::NumberRemainder),
            Self::Exponentiate => OnNumbers::Node(Kind::NumberPower),
            Self::Negate => OnNumbers::Node(Kind::NumberNegate),
            Self::ToNumber | Self::ToNumeric => OnNumbers::Node(Kind::NumberToNumber),
            Self::Increment => OnNumbers::Step(Kind::NumberAdd),
            Self::Decrement => OnNumbers::Step(Kind::NumberSubtract),
            Self::BitAnd => OnNumbers::Bits(Binary::And),
            Self::BitOr => OnNumbers::Bits(Binary::Or),
            Self::BitXor => OnNumbers::Bits(Binary::Xor),
            Self::ShiftLeft => OnNumbers::Bits(Binary::Shl),
            Self::ShiftRight => OnNumbers::Bits(Binary::Sar),
            Self::ShiftRightUnsigned | Self::ShiftRightUnsignedBits => OnNumbers::Bits(Binary::Shr),
            Self::BitNot => OnNumbers::Complement,
        }
    }

    fn takes_bigints(self) -> bool {
        !matches!(
            self,
            Self::ShiftRightUnsigned | Self::ShiftRightUnsignedBits | Self::ToNumber
        )
    }

    /// What it can give for operands of these types.
    fn results(self, operands: &[T]) -> T {
        let may_become = |ty: T| move |operand: &T| operand.intersects(ty | T::OBJECT);
        let mut results = match self.on_numbers() {
            _ if self == Self::ShiftRightUnsigned => T::BOXED_NUMBER,
            OnNumbers::Bits(_) | OnNumbers::Complement => T::INT32,
            _ => T::BOXED_NUMBER,
        };
        if self.takes_bigints() && operands.iter().all(may_become(T::BIGINT)) {
            results |= T::BIGINT;
        }
        if self == Self::Add && operands.iter().any(|&it| T::STRING.contains(it)) {
            return T::STRING;
        }
        if self == Self::Add && operands.iter().any(may_become(T::STRING)) {
            results |= T::STRING;
        }
        results
    }
}

impl Builder<'_> {
    /// What the profile of a function has seen says little about what one caller passes.
    fn likely(&self, value: Ssa, seen: T) -> T {
        let (frame, root, expected) = (self.frame(), self.graph.root(value), self.expected(value));
        let is_passed = |register| self.graph.root(frame.get(register)) == root;
        let failures = [
            ExitKind::BadType,
            ExitKind::NotANumber,
            ExitKind::ExoticObject,
        ];
        if !frame.is_root()
            && !expected.is_empty()
            && frame.argument_registers().any(is_passed)
            && !failures.into_iter().any(|kind| self.has_exited(kind))
        {
            return expected;
        }
        let seen = seen & self.knowledge.type_of(&self.graph, value);
        if seen.is_empty() { expected } else { seen }
    }

    /// `None` if there is nothing to go by, in which case the code exits.
    fn operands(&mut self, operands: &[Operand], metadata: Option<u32>) -> Option<Operands> {
        let kind = match operands {
            [_] => MetadataKind::UnaryArithmetic,
            _ => MetadataKind::BinaryArithmetic,
        };
        let code_block = self.frame().code_block;
        let seen = metadata.map(|it| {
            code_block
                .checked_metadata::<ArithmeticProfile>(kind, it)
                .get()
        });
        let values: SmallVec<[Ssa; 2]> = operands.iter().map(|&it| self.get_value(it)).collect();
        let is_number = |&it: &Ssa| {
            let expected = self.expected(it);
            !expected.is_empty() && T::BOXED_NUMBER.contains(expected)
        };
        if seen.is_some_and(|it| it.is_empty())
            && !self.has_exited(ExitKind::NeverExecuted)
            && !values.iter().all(is_number)
        {
            self.force_exit(ExitKind::NeverExecuted);
            return None;
        }
        let seen = seen.unwrap_or_default();
        let types = [seen.types_of_lhs(), seen.types_of_rhs()];
        let likely = (values.iter().zip(types)).map(|(&value, seen)| self.likely(value, seen));
        Some(Operands {
            likely: likely.collect(),
            values,
            seen,
        })
    }

    pub(super) fn number_node(
        &mut self,
        kind: Kind,
        operands: &[Ssa],
        seen: ArithmeticData,
    ) -> Ssa {
        let roots: SmallVec<[Ssa; 2]> = operands
            .iter()
            .map(|&operand| self.graph.root(operand))
            .collect();
        let result = self.node(kind, &roots, seen.bits());
        self.graph.predict(result, T::empty());
        result
    }

    pub(super) fn quiet_to_number(&mut self, value: Ssa, likely: T) -> Ssa {
        if self.is(value, T::BOXED_NUMBER) {
            return value;
        }
        let (root, data) = (self.graph.root(value), self.graph.intern_type(likely));
        self.profiled_node(Kind::QuietToNumber, &[root], data, T::empty())
    }

    /// Replaces the operands with numbers, or with what has yet to be checked to be one. False if that is not likely
    /// to work out.
    fn try_numbers(&mut self, operands: &mut Operands) -> bool {
        if operands.are_likely(T::BOXED_NUMBER) && !self.has_exited(ExitKind::NotANumber) {
            return true;
        }
        let is_possible = operands.are_likely(QUIET) && !self.has_exited(ExitKind::ExoticObject);
        if is_possible {
            for (value, &likely) in operands.values.iter_mut().zip(&operands.likely) {
                *value = self.quiet_to_number(*value, likely);
            }
        }
        is_possible
    }

    fn on_numbers(&mut self, operator: Operator, operands: &mut Operands) -> Option<Ssa> {
        let seen = ArithmeticData::new(operands.seen, self.graph.site(self.origin).exits);
        let truncates = operands.are_likely(QUIET) && !self.has_exited(ExitKind::ExoticObject);
        match operator.on_numbers() {
            OnNumbers::Node(Kind::NumberToNumber) if self.is(operands.values[0], NUMERIC) => {
                let value = operands.values[0];
                (operator == Operator::ToNumeric || self.is(value, T::BOXED_NUMBER))
                    .then_some(value)
            }
            OnNumbers::Node(kind) => {
                (self.try_numbers(operands)).then(|| self.number_node(kind, &operands.values, seen))
            }
            OnNumbers::Step(kind) => self.try_numbers(operands).then(|| {
                let one = self.value(Value::int32(1));
                self.number_node(kind, &[operands.values[0], one], seen)
            }),
            OnNumbers::Bits(op) => truncates.then(|| {
                let [lhs, rhs] = [0, 1].map(|it| self.truncate(operands.values[it]));
                let bits = self.ir().binary(op, lhs, rhs);
                if operator == Operator::ShiftRightUnsigned {
                    self.number_node(Kind::UInt32ToNumber, &[bits], seen)
                } else {
                    self.box_int32(bits)
                }
            }),
            OnNumbers::Complement => truncates.then(|| {
                let bits = self.truncate(operands.values[0]);
                let bits = self.ir().xor(bits, -1);
                self.box_int32(bits)
            }),
        }
    }

    fn add_strings(&mut self, operands: &Operands) -> Option<Ssa> {
        let is_string = |&it: &T| !it.is_empty() && T::STRING.contains(it);
        let position = operands.likely.iter().position(is_string)?;
        let (string, other) = (operands.values[position], operands.values[1 - position]);
        let is_possible = (self.is(string, T::STRING) || !self.has_exited(ExitKind::BadType))
            && self.may_be_primitive(other, operands.likely[1 - position]);
        is_possible.then(|| {
            self.check_type(string, T::STRING);
            self.concatenate((operands.values.iter().copied()).zip(operands.likely.iter().copied()))
        })
    }

    pub(super) fn may_be_primitive(&self, value: Ssa, likely: T) -> bool {
        self.is(value, !T::OBJECT)
            || !likely.intersects(T::OBJECT) && !self.has_exited(ExitKind::ExoticObject)
    }

    fn on_bigints(&mut self, operator: Operator, operands: &Operands) -> Option<Ssa> {
        let is_possible = operator.takes_bigints()
            && operands.are_likely(T::BIGINT)
            && (operands.values.iter())
                .all(|&it| self.is(it, T::BIGINT) || !self.has_exited(ExitKind::BadType));
        is_possible.then(|| {
            let checked: SmallVec<[Ssa; 2]> = (operands.values.iter())
                .map(|&it| self.check_type(it, T::BIGINT))
                .collect();
            match operator {
                Operator::ToNumeric => checked[0],
                _ => self.node(Kind::BigIntOperator, &checked, operator as u32),
            }
        })
    }

    fn on_anything(&mut self, operator: Operator, operands: &Operands) -> Ssa {
        let pairs = || operands.values.iter().zip(&operands.likely);
        let are_primitive = pairs().all(|(&value, &likely)| self.may_be_primitive(value, likely));
        let (kind, wanted) = if are_primitive {
            (Kind::PrimitiveOperator, !T::OBJECT)
        } else {
            (Kind::GenericOperator, T::all())
        };
        let checked: SmallVec<[Ssa; 2]> = (operands.values.iter())
            .map(|&it| self.check_type_or(it, wanted, ExitKind::ExoticObject))
            .collect();
        let known = |&it: &Ssa| self.knowledge.type_of(&self.graph, it);
        let results = operator.results(&checked.iter().map(known).collect::<SmallVec<[T; 2]>>());
        let in_line = InLine::for_operands(&operands.likely);
        let result = self.node(kind, &checked, operator as u32 | in_line.bits());
        let seen = operands.seen.types_of_result() & results;
        self.graph.declare(result, results);
        (self.graph).predict(result, if seen.is_empty() { results } else { seen });
        result
    }

    fn operate(&mut self, operator: Operator, operands: &mut Operands) -> Ssa {
        let sum = (operator == Operator::Add).then(|| self.add_strings(operands));
        (sum.flatten())
            .or_else(|| self.on_numbers(operator, operands))
            .or_else(|| self.on_bigints(operator, operands))
            .unwrap_or_else(|| self.on_anything(operator, operands))
    }

    pub(super) fn operator(
        &mut self,
        operator: Operator,
        dst: Register,
        operands: &[Operand],
        metadata: impl Into<Option<u32>>,
    ) {
        if let Some(mut operands) = self.operands(operands, metadata.into()) {
            let result = self.operate(operator, &mut operands);
            self.set(dst, result);
        }
    }

    /// `old` gets the numeric value from before.
    pub(super) fn step_afterwards(
        &mut self,
        operator: Operator,
        old: Register,
        value: Register,
        metadata: u32,
    ) {
        let Some(mut operands) = self.operands(&[value.into()], Some(metadata)) else {
            return;
        };
        let result = self.on_numbers(operator, &mut operands).unwrap_or_else(|| {
            let numeric = (self.on_bigints(Operator::ToNumeric, &operands))
                .unwrap_or_else(|| self.on_anything(Operator::ToNumeric, &operands));
            (operands.values[0], operands.likely[0]) = (numeric, self.expected(numeric));
            if self.is(numeric, T::BIGINT) {
                self.node(Kind::BigIntOperator, &[numeric], operator as u32)
            } else {
                self.on_anything(operator, &operands)
            }
        });
        self.set(old, operands.values[0]);
        self.set(value, result);
    }
}
