//! Operators, as values and as conditions.

use bun_engine_number::exact_int32;
use bun_engine_syntax::ast::{
    BinaryOperator, Expr, ExprId, ExprKind, LogicalOperator, ResultType, UnaryOperator,
};
use smallvec::SmallVec;

use super::{Dest, Generator, Tail};
use crate::assembler::Label;
use crate::constant::Constant;
use crate::operand::{CellType, Operand, Register, Unresolved};

/// The two ways to go on from a condition, and which of them comes next in the code.
#[derive(Clone, Copy)]
pub(super) struct Branch {
    pub(super) if_true: Label,
    pub(super) if_false: Label,
    pub(super) falls_to: bool,
}

impl Branch {
    fn inverted(self) -> Branch {
        Branch {
            if_true: self.if_false,
            if_false: self.if_true,
            falls_to: !self.falls_to,
        }
    }

    /// The outcome to jump on, and where to.
    fn jump(self) -> (bool, Label) {
        if self.falls_to {
            (false, self.if_false)
        } else {
            (true, self.if_true)
        }
    }
}

#[derive(Clone, Copy)]
enum TypeTest {
    Undefined,
    Object,
    Function,
    Boolean,
    Number,
    Cell(CellType),
}

/// A comparison whose operands have been evaluated.
#[derive(Clone, Copy)]
enum Test {
    Compare(BinaryOperator, Operand, Operand),
    Below(Operand, Operand),
    BelowEqual(Operand, Operand),
    Identical(Operand, Operand),
    EqualNull(Operand),
    Type(TypeTest, Operand),
}

const MOST_CONCATENATED: u32 = 64;

impl Generator<'_> {
    #[inline(never)]
    pub(super) fn unary(
        &mut self,
        start: u32,
        operator: UnaryOperator,
        operand: ExprId,
        dst: Dest,
    ) -> Operand {
        if operator == UnaryOperator::Void
            || (operator == UnaryOperator::Not && dst == Dest::Ignore)
        {
            self.effect(operand);
            let undefined = self.undefined();
            return self.deliver(dst, undefined);
        }
        let mark = self.top;
        let value = self.expr(operand, Dest::Any);
        self.position_at(start);
        self.top = mark;
        let dst = self.final_dst(dst);
        match operator {
            UnaryOperator::Not => self.asm().not(dst, value),
            UnaryOperator::BitNot => self.asm().bit_not(dst, value),
            UnaryOperator::Negate => self.asm().negate(dst, value),
            UnaryOperator::Plus | UnaryOperator::Void => self.asm().to_number(dst, value),
        }
        dst.into()
    }

    fn typeof_operand(&mut self, operand: ExprId, end: u32) -> Operand {
        let node = &self.ast[operand];
        let ExprKind::Identifier(name) = node.kind else {
            return self.expr(operand, Dest::Any);
        };
        if self.builtin(name).is_some() {
            return self.expr(operand, Dest::Any);
        }
        let variable = self.resolve_for_use(name, node.start);
        if let Some(constant) = self.global_constant(&variable) {
            return constant;
        }
        let start = end - self.name_length(name).min(end);
        if variable.register().is_some() || variable.is_checked {
            self.position(start, start, end);
        }
        let mark = self.top;
        let holder = self.holder(&variable);
        self.top = mark;
        let value = self.load(&variable, holder, Dest::Any, Unresolved::Undefined);
        self.position(start, start, end);
        value
    }

    #[inline(never)]
    pub(super) fn type_of(&mut self, operand: ExprId, end: u32, dst: Dest) -> Operand {
        let mark = self.top;
        let value = self.typeof_operand(operand, end);
        self.top = mark;
        if dst == Dest::Ignore {
            return self.undefined();
        }
        let dst = self.final_dst(dst);
        self.asm().type_of(dst, value);
        dst.into()
    }

    // Arithmetic

    fn arithmetic(&mut self, operator: BinaryOperator, dst: Register, lhs: Operand, rhs: Operand) {
        let asm = self.asm();
        match operator {
            BinaryOperator::Add => asm.add(dst, lhs, rhs),
            BinaryOperator::Subtract => asm.subtract(dst, lhs, rhs),
            BinaryOperator::Multiply => asm.multiply(dst, lhs, rhs),
            BinaryOperator::Divide => asm.divide(dst, lhs, rhs),
            BinaryOperator::Remainder => asm.remainder(dst, lhs, rhs),
            BinaryOperator::Exponentiate => asm.exponentiate(dst, lhs, rhs),
            BinaryOperator::BitAnd => asm.bit_and(dst, lhs, rhs),
            BinaryOperator::BitOr => asm.bit_or(dst, lhs, rhs),
            BinaryOperator::BitXor => asm.bit_xor(dst, lhs, rhs),
            BinaryOperator::ShiftLeft => asm.shift_left(dst, lhs, rhs),
            BinaryOperator::ShiftRight => asm.shift_right(dst, lhs, rhs),
            BinaryOperator::ShiftRightUnsigned => asm.shift_right_unsigned(dst, lhs, rhs),
            BinaryOperator::Equal => asm.equal(dst, lhs, rhs),
            BinaryOperator::NotEqual => asm.not_equal(dst, lhs, rhs),
            BinaryOperator::StrictEqual => asm.strict_equal(dst, lhs, rhs),
            BinaryOperator::StrictNotEqual => asm.strict_not_equal(dst, lhs, rhs),
            BinaryOperator::Less => asm.less(dst, lhs, rhs),
            BinaryOperator::LessEqual => asm.less_equal(dst, lhs, rhs),
            BinaryOperator::Greater => asm.greater(dst, lhs, rhs),
            BinaryOperator::GreaterEqual => asm.greater_equal(dst, lhs, rhs),
        }
    }

    fn is_empty_string(&self, value: Operand) -> bool {
        matches!(self.constant_of(value), Some(Constant::String(string)) if string.is_empty())
    }

    #[inline(never)]
    fn apply(&mut self, operator: BinaryOperator, dst: Register, lhs: Operand, rhs: Operand) {
        if operator == BinaryOperator::Add
            && let Some(other) = [(lhs, rhs), (rhs, lhs)]
                .into_iter()
                .find_map(|(empty, other)| self.is_empty_string(empty).then_some(other))
        {
            let primitive = self.temp();
            self.asm().to_primitive(primitive, other);
            self.asm().to_string(dst, primitive);
            self.top -= 1;
            return;
        }
        self.arithmetic(operator, dst, lhs, rhs);
    }

    fn string_addition(&self, id: ExprId) -> Option<(ExprId, ExprId)> {
        let node = &self.ast[id];
        match node.kind {
            ExprKind::Binary {
                operator: BinaryOperator::Add,
                lhs,
                rhs,
                ..
            } if node.result.is_only(ResultType::STRING) => Some((lhs, rhs)),
            _ => None,
        }
    }

    /// `dst = old operator value`
    pub(super) fn modify(
        &mut self,
        dst: Register,
        old: Operand,
        operator: BinaryOperator,
        value: ExprId,
        range: Option<(u32, u32, u32)>,
    ) {
        let mark = self.top;
        if operator == BinaryOperator::Add
            && let Some((lhs, rhs)) = self.string_addition(value)
        {
            let first = self.temp();
            let count = self.concatenation_operands(lhs, rhs);
            if let Some((divot, start, end)) = range {
                self.position(divot, start, end);
            }
            self.asm().to_primitive(first, old);
            self.asm().concatenate(dst, first, count + 1);
        } else {
            let value = self.expr(value, Dest::Any);
            if let Some((divot, start, end)) = range {
                self.position(divot, start, end);
            }
            self.apply(operator, dst, old, value);
        }
        self.top = mark;
    }

    /// Puts the operands of a chain of additions of strings in a run of registers, converted in the order in which
    /// the additions would. Returns how many they are.
    fn concatenation_operands(&mut self, mut leftmost: ExprId, last: ExprId) -> u32 {
        let mut rest: SmallVec<[ExprId; 16]> = SmallVec::new();
        rest.push(last);
        while let Some((lhs, rhs)) = self.string_addition(leftmost) {
            rest.push(rhs);
            leftmost = lhs;
        }
        let needs_conversion = |generator: &Self, id| {
            !(generator.ast[id] as Expr)
                .result
                .is_only(ResultType::STRING)
        };
        let first = self.expr_to_temp(leftmost);
        let mut unconverted = needs_conversion(self, leftmost).then_some(first);
        let mut count = 1;
        for &operand in rest.iter().rev() {
            if count == MOST_CONCATENATED {
                self.asm().concatenate(first, first, count);
                self.top -= count - 1;
                count = 1;
            }
            let register = self.expr_to_temp(operand);
            if let Some(first) = unconverted.take() {
                self.asm().to_primitive(first, first);
            }
            if needs_conversion(self, operand) {
                self.asm().to_primitive(register, register);
            }
            count += 1;
        }
        count
    }

    fn is_unsigned_shift(&self, id: ExprId) -> bool {
        matches!(
            self.ast[id].kind,
            ExprKind::Binary {
                operator: BinaryOperator::ShiftRightUnsigned,
                ..
            }
        )
    }

    /// An operand of which only the low 32 bits count.
    #[inline]
    fn bits(&mut self, id: ExprId, later_assigns: bool) -> Operand {
        if self.is_unsigned_shift(id) {
            self.unsigned_shift_bits(id)
        } else {
            self.stable_expr(id, later_assigns)
        }
    }

    #[inline(never)]
    fn unsigned_shift_bits(&mut self, mut id: ExprId) -> Operand {
        if !self.can_recurse() {
            return self.undefined();
        }
        let (floor, mark, mut later_assigns) = (self.b.spine.len(), self.top, false);
        while let ExprKind::Binary {
            operator: BinaryOperator::ShiftRightUnsigned,
            lhs,
            rhs_assigns,
            ..
        } = self.ast[id].kind
        {
            self.b.spine.push(id);
            (id, later_assigns) = (lhs, rhs_assigns);
        }
        let mut value = self.stable_expr(id, later_assigns);
        while let Some(shift) = self.pop_spine(floor)
            && let ExprKind::Binary { rhs, .. } = self.ast[shift].kind
        {
            let rhs = self.bits(rhs, false);
            self.position_at(self.ast[shift].start);
            self.top = mark;
            let dst = self.temp();
            self.asm().shift_right_unsigned_bits(dst, value, rhs);
            value = dst.into();
        }
        value
    }

    /// Past the operators that [`Generator::binary`] looks into.
    pub(super) fn leftmost_operand(&self, operator: BinaryOperator, lhs: ExprId) -> Option<ExprId> {
        let mut leftmost = lhs;
        while operator == BinaryOperator::Add
            && let Some((lhs, _)) = self.string_addition(leftmost)
        {
            leftmost = lhs;
        }
        while leftmost == lhs || self.is_unsigned_shift(lhs) {
            match self.ast[leftmost].kind {
                ExprKind::Binary {
                    operator: BinaryOperator::ShiftRightUnsigned,
                    lhs,
                    ..
                } => leftmost = lhs,
                ExprKind::Typeof { .. } => return None,
                _ => break,
            }
        }
        Some(leftmost)
    }

    /// `a ** b ** c`, which is `a ** (b ** c)`.
    #[cold]
    #[inline(never)]
    fn powers(&mut self, &(mut node): &Expr, dst: Dest) -> Operand {
        let mark = self.top;
        let mut bases = Vec::new();
        let mut exponent = loop {
            let ExprKind::Binary {
                lhs,
                rhs,
                rhs_assigns,
                ..
            } = node.kind
            else {
                return self.undefined();
            };
            bases.push((self.stable_expr(lhs, rhs_assigns), node.start));
            if !self.is_power(rhs) {
                break self.expr(rhs, Dest::Any);
            }
            node = self.ast[rhs];
        };
        let inner = self.temp();
        while let Some((base, start)) = bases.pop() {
            self.position_at(start);
            self.top = mark;
            let dst = if bases.is_empty() {
                self.final_dst(dst)
            } else {
                inner
            };
            self.asm().exponentiate(dst, base, exponent);
            exponent = dst.into();
        }
        exponent
    }

    fn is_power(&self, id: ExprId) -> bool {
        matches!(
            self.ast[id].kind,
            ExprKind::Binary {
                operator: BinaryOperator::Exponentiate,
                ..
            }
        )
    }

    #[inline(never)]
    pub(super) fn binary(&mut self, node: &Expr, dst: Dest) -> Operand {
        let ExprKind::Binary {
            operator,
            lhs,
            rhs,
            rhs_assigns,
        } = node.kind
        else {
            return self.undefined();
        };
        let mark = self.top;
        if let Some((test, is_negated)) = self.test(node) {
            self.top = mark;
            return self.test_value(test, is_negated, dst);
        }
        if operator == BinaryOperator::Add && self.string_addition(lhs).is_some() {
            self.position_at(node.start);
            let count = self.concatenation_operands(lhs, rhs);
            self.top = mark;
            let dst = self.final_dst(dst);
            self.asm().concatenate(dst, Register::local(mark), count);
            return dst.into();
        }
        let (lhs, rhs) = match operator {
            BinaryOperator::Exponentiate if self.is_power(rhs) => return self.powers(node, dst),
            BinaryOperator::BitAnd
            | BinaryOperator::BitOr
            | BinaryOperator::BitXor
            | BinaryOperator::ShiftLeft
            | BinaryOperator::ShiftRight
            | BinaryOperator::ShiftRightUnsigned => {
                (self.bits(lhs, rhs_assigns), self.bits(rhs, false))
            }
            _ => (
                self.stable_expr(lhs, rhs_assigns),
                self.expr(rhs, Dest::Any),
            ),
        };
        self.position_at(node.start);
        self.top = mark;
        let dst = self.final_dst(dst);
        self.apply(operator, dst, lhs, rhs);
        dst.into()
    }

    #[inline(never)]
    pub(super) fn relation(&mut self, node: &Expr, dst: Dest) -> Operand {
        let ExprKind::Relation {
            is_instanceof,
            rhs_assigns,
            lhs,
            rhs,
            lhs_start,
            divot,
            end,
        } = node.kind
        else {
            return self.undefined();
        };
        let mark = self.top;
        if let ExprKind::PrivateName(name) = self.ast[lhs].kind {
            let base = self.expr(rhs, Dest::Any);
            return self.has_private(name, base, mark, dst);
        }
        if let Some(name) = self.literal_key(lhs).filter(|_| !is_instanceof) {
            let base = self.expr(rhs, Dest::Any);
            self.position(divot, lhs_start, end);
            self.top = mark;
            let (dst, name) = (self.final_dst(dst), self.identifier(name));
            self.asm().in_by_id(dst, base, name);
            return dst.into();
        }
        let lhs = self.stable_expr(lhs, rhs_assigns);
        let rhs = self.expr(rhs, Dest::Any);
        self.position(divot, lhs_start, end);
        let scratch = is_instanceof.then(|| self.temp());
        self.top = mark;
        let dst = self.final_dst(dst);
        match scratch {
            Some(scratch) => {
                let done = self.asm().label();
                self.asm().get_has_instance(scratch, rhs);
                self.asm().instanceof_custom(dst, lhs, rhs, scratch, done);
                self.get_by_id(scratch, rhs, bun_engine_syntax::Name::PROTOTYPE);
                self.asm().instanceof(dst, lhs, scratch);
                self.asm().bind(done);
            }
            None => self.in_by_val(dst, rhs, lhs),
        }
        dst.into()
    }

    // Comparisons

    fn type_test(&self, name: ExprId) -> Option<TypeTest> {
        let ExprKind::String(name) = self.ast[name].kind else {
            return None;
        };
        let text = self.text_of(name);
        [
            ("undefined", TypeTest::Undefined),
            ("object", TypeTest::Object),
            ("function", TypeTest::Function),
            ("boolean", TypeTest::Boolean),
            ("number", TypeTest::Number),
            ("string", TypeTest::Cell(CellType::STRING)),
            ("symbol", TypeTest::Cell(CellType::SYMBOL)),
            ("bigint", TypeTest::Cell(CellType::BIGINT)),
        ]
        .into_iter()
        .find_map(|(candidate, test)| text.eq_ascii(candidate).then_some(test))
    }

    fn typeof_test(&mut self, subject: ExprId, test: TypeTest) -> Option<Test> {
        let node = &self.ast[subject];
        let ExprKind::Typeof { operand, end } = node.kind else {
            return None;
        };
        self.pause_before(node);
        Some(Test::Type(test, self.typeof_operand(operand, end)))
    }

    fn is_small_natural(&self, id: ExprId) -> bool {
        matches!(
            self.ast[id].kind,
            ExprKind::Number { value, is_integer: true }
                if exact_int32(value.get()).is_some_and(|value| value >= 0)
        )
    }

    /// Evaluates the operands, if it is a comparison. The flag says that the outcome is to be negated.
    fn test(&mut self, node: &Expr) -> Option<(Test, bool)> {
        let ExprKind::Binary {
            operator,
            lhs,
            rhs,
            rhs_assigns,
        } = node.kind
        else {
            return None;
        };
        match operator {
            BinaryOperator::Equal
            | BinaryOperator::NotEqual
            | BinaryOperator::StrictEqual
            | BinaryOperator::StrictNotEqual => {
                Some(self.equality(node.start, operator, lhs, rhs, rhs_assigns))
            }
            BinaryOperator::Less
            | BinaryOperator::LessEqual
            | BinaryOperator::Greater
            | BinaryOperator::GreaterEqual => {
                Some(self.ordering(node.start, operator, lhs, rhs, rhs_assigns))
            }
            _ => None,
        }
    }

    #[inline(never)]
    fn equality(
        &mut self,
        start: u32,
        operator: BinaryOperator,
        lhs: ExprId,
        rhs: ExprId,
        rhs_assigns: bool,
    ) -> (Test, bool) {
        let is_negated = matches!(
            operator,
            BinaryOperator::NotEqual | BinaryOperator::StrictNotEqual
        );
        for (subject, name) in [(lhs, rhs), (rhs, lhs)] {
            if let Some(test) = self.type_test(name)
                && let Some(test) = self.typeof_test(subject, test)
            {
                return (test, is_negated);
            }
        }
        let lhs = self.stable_expr(lhs, rhs_assigns);
        let rhs = self.expr(rhs, Dest::Any);
        if is_negated {
            self.position_at(start);
        }
        if let BinaryOperator::StrictEqual | BinaryOperator::StrictNotEqual = operator {
            if self.has_identity(lhs) || self.has_identity(rhs) {
                return (Test::Identical(lhs, rhs), is_negated);
            }
            return (
                Test::Compare(BinaryOperator::StrictEqual, lhs, rhs),
                is_negated,
            );
        }
        for (nullish, other) in [(rhs, lhs), (lhs, rhs)] {
            if let Some(Constant::Null | Constant::Undefined) = self.constant_of(nullish) {
                return (Test::EqualNull(other), is_negated);
            }
        }
        (Test::Compare(BinaryOperator::Equal, lhs, rhs), is_negated)
    }

    #[inline(never)]
    fn ordering(
        &mut self,
        start: u32,
        operator: BinaryOperator,
        lhs: ExprId,
        rhs: ExprId,
        rhs_assigns: bool,
    ) -> (Test, bool) {
        // Minifiers write `typeof x > "u"`: no other type has a name that sorts after it.
        if let BinaryOperator::Greater | BinaryOperator::Less = operator
            && let ExprKind::String(name) = self.ast[rhs].kind
            && self.text_of(name).eq_ascii("u")
            && let Some(test) = self.typeof_test(lhs, TypeTest::Undefined)
        {
            return (test, operator == BinaryOperator::Less);
        }
        let shifts = (self.is_unsigned_shift(lhs), self.is_unsigned_shift(rhs));
        if (shifts.0 || shifts.1)
            && (shifts.0 || self.is_small_natural(lhs))
            && (shifts.1 || self.is_small_natural(rhs))
        {
            let (lhs, rhs) = (self.bits(lhs, rhs_assigns), self.bits(rhs, false));
            let test = match operator {
                BinaryOperator::Less => Test::Below(lhs, rhs),
                BinaryOperator::LessEqual => Test::BelowEqual(lhs, rhs),
                BinaryOperator::Greater => Test::Below(rhs, lhs),
                _ => Test::BelowEqual(rhs, lhs),
            };
            return (test, false);
        }
        let lhs = self.stable_expr(lhs, rhs_assigns);
        let rhs = self.expr(rhs, Dest::Any);
        self.position_at(start);
        (Test::Compare(operator, lhs, rhs), false)
    }

    fn type_test_value(&mut self, test: TypeTest, dst: Register, value: Operand) {
        let asm = self.asm();
        match test {
            TypeTest::Undefined => asm.typeof_is_undefined(dst, value),
            TypeTest::Object => asm.typeof_is_object(dst, value),
            TypeTest::Function => asm.typeof_is_function(dst, value),
            TypeTest::Boolean => asm.is_boolean(dst, value),
            TypeTest::Number => asm.is_number(dst, value),
            TypeTest::Cell(cell_type) => asm.is_cell_of_type(dst, value, cell_type),
        }
    }

    #[inline(never)]
    fn test_value(&mut self, test: Test, is_negated: bool, dst: Dest) -> Operand {
        let dst = self.final_dst(dst);
        match (test, is_negated) {
            (Test::Compare(BinaryOperator::Equal, lhs, rhs), true) => {
                self.asm().not_equal(dst, lhs, rhs);
            }
            (Test::Compare(_, lhs, rhs), true) => self.asm().strict_not_equal(dst, lhs, rhs),
            (Test::Compare(operator, lhs, rhs), false) => self.arithmetic(operator, dst, lhs, rhs),
            (Test::Below(lhs, rhs), _) => self.asm().below(dst, lhs, rhs),
            (Test::BelowEqual(lhs, rhs), _) => self.asm().below_equal(dst, lhs, rhs),
            (Test::Identical(lhs, rhs), false) => self.asm().identical(dst, lhs, rhs),
            (Test::Identical(lhs, rhs), true) => self.asm().not_identical(dst, lhs, rhs),
            (Test::EqualNull(value), false) => self.asm().equal_null(dst, value),
            (Test::EqualNull(value), true) => self.asm().not_equal_null(dst, value),
            (Test::Type(test, value), _) => {
                self.type_test_value(test, dst, value);
                if is_negated {
                    self.asm().not(dst, dst);
                }
            }
        }
        dst.into()
    }

    #[inline(never)]
    fn jump_on_test(&mut self, test: Test, outcome: bool, target: Label) {
        use BinaryOperator::{Equal, Greater, GreaterEqual, Less, LessEqual};
        if let Test::Identical(a, b) = test
            && self.has_identity(a)
            && self.has_identity(b)
        {
            if (a == b) == outcome {
                self.asm().jump(target);
            }
            return;
        }
        let asm = self.asm();
        match (test, outcome) {
            (Test::Compare(Equal, a, b), true) => asm.jump_if_equal(a, b, target),
            (Test::Compare(Equal, a, b), false) => asm.jump_if_not_equal(a, b, target),
            (Test::Compare(Less, a, b), true) => asm.jump_if_less(a, b, target),
            (Test::Compare(Less, a, b), false) => asm.jump_if_not_less(a, b, target),
            (Test::Compare(LessEqual, a, b), true) => asm.jump_if_less_equal(a, b, target),
            (Test::Compare(LessEqual, a, b), false) => asm.jump_if_not_less_equal(a, b, target),
            (Test::Compare(Greater, a, b), true) => asm.jump_if_greater(a, b, target),
            (Test::Compare(Greater, a, b), false) => asm.jump_if_not_greater(a, b, target),
            (Test::Compare(GreaterEqual, a, b), true) => asm.jump_if_greater_equal(a, b, target),
            (Test::Compare(GreaterEqual, a, b), false) => {
                asm.jump_if_not_greater_equal(a, b, target);
            }
            (Test::Compare(_, a, b), true) => asm.jump_if_strict_equal(a, b, target),
            (Test::Compare(_, a, b), false) => asm.jump_if_strict_not_equal(a, b, target),
            (Test::Below(a, b), true) => asm.jump_if_below(a, b, target),
            (Test::Below(a, b), false) => asm.jump_if_below_equal(b, a, target),
            (Test::BelowEqual(a, b), true) => asm.jump_if_below_equal(a, b, target),
            (Test::BelowEqual(a, b), false) => asm.jump_if_below(b, a, target),
            (Test::Identical(a, b), true) => asm.jump_if_identical(a, b, target),
            (Test::Identical(a, b), false) => asm.jump_if_not_identical(a, b, target),
            (Test::EqualNull(a), true) => asm.jump_if_equal_null(a, target),
            (Test::EqualNull(a), false) => asm.jump_if_not_equal_null(a, target),
            (Test::Type(TypeTest::Undefined, a), true) => asm.jump_if_typeof_undefined(a, target),
            (Test::Type(TypeTest::Undefined, a), false) => {
                asm.jump_if_typeof_not_undefined(a, target);
            }
            (Test::Type(TypeTest::Object, a), true) => asm.jump_if_typeof_object(a, target),
            (Test::Type(TypeTest::Object, a), false) => asm.jump_if_typeof_not_object(a, target),
            (Test::Type(TypeTest::Function, a), true) => asm.jump_if_typeof_function(a, target),
            (Test::Type(TypeTest::Function, a), false) => {
                asm.jump_if_typeof_not_function(a, target);
            }
            (Test::Type(TypeTest::Number, a), true) => asm.jump_if_number(a, target),
            (Test::Type(TypeTest::Number, a), false) => asm.jump_if_not_number(a, target),
            (Test::Type(TypeTest::Cell(cell), a), true) => {
                asm.jump_if_cell_of_type(a, cell, target)
            }
            (Test::Type(TypeTest::Cell(cell), a), false) => {
                asm.jump_if_not_cell_of_type(a, cell, target);
            }
            (Test::Type(TypeTest::Boolean, a), _) => {
                let result = self.temp();
                self.asm().is_boolean(result, a);
                self.jump_on_value(result.into(), outcome, target);
            }
        }
    }

    pub(super) fn jump_on_value(&mut self, value: Operand, outcome: bool, target: Label) {
        if outcome {
            self.asm().jump_if_true(value, target);
        } else {
            self.asm().jump_if_false(value, target);
        }
    }

    // Conditions

    fn literal_truth(&self, node: &Expr) -> Option<bool> {
        match node.kind {
            ExprKind::Null => Some(false),
            ExprKind::Boolean(value) => Some(value),
            ExprKind::Number { value, .. } => Some(value.get() != 0.0 && !value.get().is_nan()),
            ExprKind::String(name) => Some(self.name_length(name) != 0),
            _ => None,
        }
    }

    /// `x === true` and `(x | y) !== 0` ask no more than the truth of the operand that is no literal, where its
    /// type is known. The flag says whether they ask for the opposite.
    fn comparison_of_truth(&self, node: &Expr) -> Option<(ExprId, bool)> {
        let ExprKind::Binary {
            operator, lhs, rhs, ..
        } = node.kind
        else {
            return None;
        };
        let is_equal = match operator {
            BinaryOperator::Equal | BinaryOperator::StrictEqual => true,
            BinaryOperator::NotEqual | BinaryOperator::StrictNotEqual => false,
            _ => return None,
        };
        let (literal, other) = if self.is_literal(lhs) {
            (lhs, rhs)
        } else {
            (rhs, lhs)
        };
        let result = self.ast[other].result;
        let is_loose = matches!(operator, BinaryOperator::Equal | BinaryOperator::NotEqual);
        let truth = match self.ast[literal].kind {
            ExprKind::Boolean(value) if result.is_only(ResultType::BOOLEAN) => value,
            ExprKind::Number { value, .. }
                if value.get() == 0.0
                    && result.contains(ResultType::INT32)
                    && (is_loose || result.is_only(ResultType::NUMBER) || self.is_int32(other)) =>
            {
                false
            }
            _ => return None,
        };
        Some((other, truth != is_equal))
    }

    /// A bitwise operator with a number for an operand yields no BigInt.
    fn is_int32(&self, id: ExprId) -> bool {
        match self.ast[id].kind {
            ExprKind::Binary { lhs, rhs, .. } => [lhs, rhs]
                .into_iter()
                .any(|operand| self.ast[operand].result.is_only(ResultType::NUMBER)),
            _ => false,
        }
    }

    /// What decides the truth of the expression, and whether it is the opposite.
    fn truth_operand(&self, node: &Expr) -> Option<(ExprId, bool)> {
        match node.kind {
            ExprKind::Unary {
                operator: UnaryOperator::Not,
                operand,
            } => Some((operand, true)),
            _ => self.comparison_of_truth(node),
        }
    }

    pub(super) fn condition(&mut self, mut id: ExprId, mut branch: Branch) {
        if !self.can_recurse() {
            return;
        }
        let mut node = &self.ast[id];
        while let Some((operand, is_inverted)) = self.truth_operand(node) {
            self.pause_before(node);
            if is_inverted {
                branch = branch.inverted();
            }
            (id, node) = (operand, &self.ast[operand]);
        }
        let mark = self.top;
        match node.kind {
            ExprKind::Logical { operator, lhs, rhs } => {
                self.pause_before(node);
                self.logical_condition(operator, lhs, rhs, branch);
            }
            ExprKind::Binary { .. } => {
                self.pause_before(node);
                if let Some((test, is_negated)) = self.test(node) {
                    let (outcome, target) = branch.jump();
                    self.jump_on_test(test, outcome != is_negated, target);
                } else {
                    let value = self.binary(node, Dest::Any);
                    self.branch_on_value(value, branch);
                }
            }
            ExprKind::Conditional {
                test,
                consequent,
                alternate,
            } => {
                self.pause_before(node);
                let (otherwise, done) = (self.asm().label(), self.asm().label());
                self.enter_if_true(test, otherwise);
                self.cover_expression(consequent, self.ast[consequent].end);
                self.condition(consequent, branch);
                self.asm().jump(done);
                self.asm().bind(otherwise);
                self.cover(self.ast[consequent].end, self.ast[alternate].end);
                self.condition(alternate, branch);
                self.asm().bind(done);
            }
            ExprKind::Sequence(list) => {
                self.pause_before(node);
                let last = self.all_but_last(list);
                self.condition(last, branch);
            }
            ExprKind::OptionalChain {
                chain,
                is_outermost: true,
            } if !matches!(self.ast[chain].kind, ExprKind::Delete { .. }) => {
                self.pause_before(node);
                (self.b.optional_chains).push((branch.if_false, self.ast[chain].end));
                self.condition(chain, branch);
                self.b.optional_chains.pop();
            }
            ExprKind::Call { .. } if self.intrinsic_condition(node, branch) => {}
            _ => match self.literal_truth(node) {
                Some(truth) => {
                    self.pause_before(node);
                    let (outcome, target) = branch.jump();
                    if truth == outcome {
                        self.asm().jump(target);
                    }
                }
                None => {
                    let value = self.expr(id, Dest::Any);
                    self.branch_on_value(value, branch);
                }
            },
        }
        self.top = mark;
    }

    pub(super) fn branch_on_value(&mut self, value: Operand, branch: Branch) {
        let (outcome, target) = branch.jump();
        self.jump_on_value(value, outcome, target);
    }

    pub(super) fn branch_target(branch: Branch) -> (bool, Label) {
        branch.jump()
    }

    /// Goes on with the next instruction if `test` holds.
    pub(super) fn enter_if_true(&mut self, test: ExprId, otherwise: Label) {
        let if_true = self.asm().label();
        let branch = Branch {
            if_true,
            if_false: otherwise,
            falls_to: true,
        };
        self.condition(test, branch);
        self.asm().bind(if_true);
    }

    pub(super) fn enter_if_false(&mut self, test: ExprId, otherwise: Label) {
        let if_false = self.asm().label();
        let branch = Branch {
            if_true: otherwise,
            if_false,
            falls_to: false,
        };
        self.condition(test, branch);
        self.asm().bind(if_false);
    }

    /// The left side of `??`. A chain that ends early jumps to `nullish`.
    fn coalesce_subject(&mut self, lhs: ExprId, dst: Dest, nullish: Label) -> Operand {
        match self.ast[lhs].kind {
            ExprKind::OptionalChain { chain, .. }
                if !matches!(self.ast[chain].kind, ExprKind::Delete { .. }) =>
            {
                self.b.optional_chains.push((nullish, self.ast[chain].end));
                let value = self.expr(chain, dst);
                self.b.optional_chains.pop();
                value
            }
            _ => self.expr(lhs, dst),
        }
    }

    /// Hands `decide` the operands of `lhs`, as far as they are those of `operator`, and then covers `rhs`.
    #[inline(always)]
    fn before_last_operand(
        &mut self,
        operator: LogicalOperator,
        lhs: ExprId,
        rhs: ExprId,
        decide: impl Fn(&mut Self, ExprId),
    ) {
        let (ast, floor, mut operand) = (self.ast, self.b.spine.len(), lhs);
        while let ExprKind::Logical {
            operator: inner,
            lhs,
            ..
        } = ast[operand].kind
            && inner == operator
        {
            self.b.spine.push(operand);
            operand = lhs;
        }
        loop {
            decide(self, operand);
            let inner = self.pop_spine(floor).map(|it| ast[it].kind);
            let Some(ExprKind::Logical { lhs, rhs, .. }) = inner else {
                return self.cover(ast[lhs].end, ast[rhs].end);
            };
            self.cover(ast[lhs].end, ast[rhs].end);
            operand = rhs;
        }
    }

    #[inline(never)]
    fn logical_condition(
        &mut self,
        operator: LogicalOperator,
        lhs: ExprId,
        rhs: ExprId,
        branch: Branch,
    ) {
        self.before_last_operand(operator, lhs, rhs, |it, operand| match operator {
            LogicalOperator::And => it.enter_if_true(operand, branch.if_false),
            LogicalOperator::Or => it.enter_if_false(operand, branch.if_true),
            LogicalOperator::Coalesce => {
                let (mark, nullish) = (it.top, it.asm().label());
                let value = it.coalesce_subject(operand, Dest::Any, nullish);
                it.asm().jump_if_nullish(value, nullish);
                it.asm().jump_if_true(value, branch.if_true);
                it.asm().jump(branch.if_false);
                it.asm().bind(nullish);
                it.top = mark;
            }
        });
        self.condition(rhs, branch);
    }

    #[inline(never)]
    pub(super) fn logical(
        &mut self,
        operator: LogicalOperator,
        lhs: ExprId,
        rhs: ExprId,
        dst: Dest,
        tail: Tail,
    ) -> Operand {
        let done = self.asm().label();
        if dst == Dest::Ignore && operator != LogicalOperator::Coalesce {
            match operator {
                LogicalOperator::And => self.enter_if_true(lhs, done),
                _ => self.enter_if_false(lhs, done),
            }
            self.cover(self.ast[lhs].end, self.ast[rhs].end);
            self.effect(rhs);
            self.asm().bind(done);
            return self.undefined();
        }
        let result = self.temp_dst(dst);
        self.before_last_operand(operator, lhs, rhs, |it, operand| {
            if operator == LogicalOperator::Coalesce {
                let nullish = it.asm().label();
                it.coalesce_subject(operand, Dest::Temp(result), nullish);
                it.asm().jump_if_not_nullish(result, done);
                it.asm().bind(nullish);
            } else {
                it.expr(operand, Dest::Temp(result));
                it.jump_on_value(result.into(), operator == LogicalOperator::Or, done);
            }
        });
        self.expr_in(rhs, Dest::Temp(result), tail);
        self.asm().bind(done);
        self.deliver(dst, result)
    }

    #[inline(never)]
    pub(super) fn conditional(&mut self, node: &Expr, dst: Dest, tail: Tail) -> Operand {
        let ExprKind::Conditional {
            test,
            consequent,
            alternate,
        } = node.kind
        else {
            return self.undefined();
        };
        let dst = match dst {
            Dest::Local(_) | Dest::Ignore => dst,
            _ => Dest::Temp(self.temp_dst(dst)),
        };
        let (otherwise, done) = (self.asm().label(), self.asm().label());
        let mark = self.top;
        self.enter_if_true(test, otherwise);
        self.cover_expression(consequent, self.ast[consequent].end);
        self.expr_in(consequent, dst, tail);
        self.top = mark;
        self.asm().jump(done);
        self.asm().bind(otherwise);
        self.cover(self.ast[consequent].end, self.ast[alternate].end);
        let value = self.expr_in(alternate, dst, tail);
        self.asm().bind(done);
        value
    }
}
