use bun_engine_asm::{Cond, FloatCond};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::{RealmWatchpoint, SpeculatedType as T, Value};

use super::Specializer;
use crate::graph::{ExitKind, InLine, Kind, Relation, TypeCheck, TypeName};

/// Equal to nothing but the value with the same bits.
const BY_IDENTITY: T = T::OBJECT
    .union(T::SYMBOL)
    .union(T::OTHER_CELL)
    .union(T::BOOLEAN)
    .union(T::NULLISH)
    .union(T::EMPTY);
const INTEGER: T = T::INT32.union(T::INT52);
const QUIET: T = T::FULL_NUMBER.union(T::BOOLEAN).union(T::NULLISH);
/// Two values that are strictly equal are in the same of these.
const CLASSES: [T; 10] = [
    T::OBJECT,
    T::STRING,
    T::FULL_NUMBER,
    T::BOOLEAN,
    T::SYMBOL,
    T::BIGINT,
    T::UNDEFINED,
    T::NULL,
    T::OTHER_CELL,
    T::EMPTY,
];

/// Null or undefined, whichever is expected, and otherwise both.
fn nothing_like(expected: T) -> T {
    Some(expected & T::NULLISH)
        .filter(|it| !it.is_empty())
        .unwrap_or(T::NULLISH)
}

impl Specializer<'_> {
    fn both_expected(&self, lhs: Ssa, rhs: Ssa, ty: T) -> bool {
        self.both_expected_unless(ExitKind::BadType, lhs, rhs, ty)
    }

    fn both_expected_unless(&self, failure: ExitKind, lhs: Ssa, rhs: Ssa, ty: T) -> bool {
        let are_known = self.is(lhs, ty) && self.is(rhs, ty);
        are_known
            || ty.contains(self.expected(lhs) | self.expected(rhs)) && !self.has_exited(failure)
    }

    fn compare_numbers(
        &mut self,
        (cond, float_cond): (Cond, FloatCond),
        lhs: Ssa,
        rhs: Ssa,
    ) -> Option<Ssa> {
        if self.both_expected(lhs, rhs, T::INT32) {
            let [lhs, rhs] = [lhs, rhs].map(|operand| self.as_int32(operand, ExitKind::BadType));
            Some(self.ir().compare(cond, lhs, rhs))
        } else if self.both_expected(lhs, rhs, INTEGER) {
            let [lhs, rhs] = [lhs, rhs].map(|operand| self.as_int52(operand, ExitKind::BadType));
            Some(self.ir().compare(cond, lhs, rhs))
        } else if self.both_expected_unless(ExitKind::NotANumber, lhs, rhs, T::FULL_NUMBER) {
            let [lhs, rhs] = [lhs, rhs].map(|it| self.as_double(it, ExitKind::NotANumber));
            Some(self.ir().float_compare(float_cond, lhs, rhs))
        } else {
            None
        }
    }

    fn compare_bigints(&mut self, cond: Cond, lhs: Ssa, rhs: Ssa) -> Option<Ssa> {
        self.both_expected(lhs, rhs, T::BIGINT).then(|| {
            let operands = self.checked_both(lhs, rhs, T::BIGINT, ExitKind::BadType);
            let order = self.node(Kind::BigIntOrder, &operands, 0);
            self.ir().compare(cond, order, 0)
        })
    }

    fn checked_both(&mut self, lhs: Ssa, rhs: Ssa, ty: T, failure: ExitKind) -> [Ssa; 2] {
        [lhs, rhs].map(|operand| self.check_type(operand, ty, failure))
    }

    fn in_line(&self, operands: [Ssa; 2]) -> u32 {
        InLine::for_operands(&operands.map(|it| self.description_of(it).wanted)).bits()
    }

    pub(super) fn compare(&mut self, relation: Relation, lhs: Ssa, rhs: Ssa) -> Ssa {
        let (cond, float_cond) = relation.conditions();
        if let Some([lhs, rhs]) = self.only_units(lhs, rhs) {
            return self.ir().compare(cond, lhs, rhs);
        }
        let result = (self.compare_numbers((cond, float_cond), lhs, rhs))
            .or_else(|| self.compare_bigints(cond, lhs, rhs));
        if let Some(result) = result {
            return result;
        }
        if self.both_expected(lhs, rhs, T::STRING) {
            let [lhs, rhs] = self.checked_both(lhs, rhs, T::STRING, ExitKind::BadType);
            return self
                .compare_with_unit(relation, lhs, rhs)
                .unwrap_or_else(|| {
                    let order = self.node(Kind::StringOrder, &[lhs, rhs], 0);
                    self.ir().compare(cond, order, 1)
                });
        }
        if self.both_expected(lhs, rhs, QUIET) && !self.has_exited(ExitKind::ExoticObject) {
            let [lhs, rhs] = [lhs, rhs].map(|operand| self.to_double(operand));
            return self.ir().float_compare(float_cond, lhs, rhs);
        }
        let operands = self.checked_both(lhs, rhs, !T::OBJECT, ExitKind::ExoticObject);
        let data = relation as u32 | self.in_line(operands);
        self.node(Kind::PrimitiveCompare, &operands, data)
    }

    fn same_bits(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        let [lhs, rhs] = [lhs, rhs].map(|operand| self.graph.root(operand));
        self.ir().equal(lhs, rhs)
    }

    /// If both are results of `typeof`.
    fn equal_type_names(&mut self, lhs: Ssa, rhs: Ssa) -> Option<Ssa> {
        let is_name = |value| match self.graph.constant(value) {
            Some(bits) => self.graph.type_names.contains(&bits),
            None => matches!(
                self.graph.kind(value),
                Some(Kind::PlainTypeof | Kind::GenericTypeof)
            ),
        };
        let [lhs, rhs] = [lhs, rhs].map(|it| self.graph.root(it));
        if !is_name(lhs) || !is_name(rhs) {
            return None;
        }
        let [lhs, rhs] = [lhs, rhs].map(|found| self.likely_type_name(found).unwrap_or(found));
        Some(self.same_bits(lhs, rhs))
    }

    fn likely_type_name(&mut self, found: Ssa) -> Option<Ssa> {
        let value = self.graph.inside(found, Kind::PlainTypeof)?;
        let expected = self.description_of(value).wanted;
        let name = TypeName::of(expected).filter(|_| !self.has_exited(ExitKind::BadType))?;
        self.check_type(value, name.certain_types(expected), ExitKind::BadType);
        Some((self.graph.function).const64(self.graph.type_names[name as usize] as i64))
    }

    fn equal_strings(&mut self, lhs: Ssa, rhs: Ssa) -> Option<Ssa> {
        let texts = [lhs, rhs].map(|it| self.graph.text_of_constant(it));
        if let [Some(first), Some(second)] = texts.map(|it| it?.atom) {
            return Some(self.graph.function.const32((first == second).into()));
        }
        if let Some([lhs, rhs]) = self.only_units(lhs, rhs) {
            return Some(self.ir().equal(lhs, rhs));
        }
        if self.both_expected_unless(ExitKind::NotAnAtom, lhs, rhs, T::ATOM_STRING)
            && self.both_expected(lhs, rhs, T::STRING)
        {
            self.checked_both(lhs, rhs, T::STRING, ExitKind::BadType);
            let operands = self.checked_both(lhs, rhs, T::ATOM_STRING, ExitKind::NotAnAtom);
            return Some(self.node(Kind::AtomEqual, &operands, 0));
        }
        if !self.both_expected(lhs, rhs, T::STRING) {
            return None;
        }
        let [lhs, rhs] = self.checked_both(lhs, rhs, T::STRING, ExitKind::BadType);
        (self.equals_atom(lhs, rhs)).or_else(|| Some(self.node(Kind::StringEqual, &[lhs, rhs], 0)))
    }

    fn equals_atom(&mut self, lhs: Ssa, rhs: Ssa) -> Option<Ssa> {
        [(lhs, rhs), (rhs, lhs)]
            .into_iter()
            .find_map(|(value, constant)| {
                self.graph.text_of_constant(constant)?.atom?;
                Some(self.inspect(Kind::EqualsAtom, &[value, constant]))
            })
    }

    fn equal_of_one_type(&mut self, lhs: Ssa, rhs: Ssa) -> Option<Ssa> {
        (self.equal_type_names(lhs, rhs))
            .or_else(|| self.compare_numbers((Cond::Eq, FloatCond::Eq), lhs, rhs))
            .or_else(|| self.equal_strings(lhs, rhs))
            .or_else(|| self.compare_bigints(Cond::Eq, lhs, rhs))
    }

    /// Checks that one is of a type that is compared by identity, if that is likely.
    fn try_identity(&mut self, lhs: Ssa, rhs: Ssa) -> bool {
        const LIKELY: [T; 6] = [
            T::OBJECT,
            T::BOOLEAN,
            T::OBJECT.union(T::NULLISH),
            T::BOOLEAN.union(T::NULLISH),
            T::SYMBOL,
            BY_IDENTITY,
        ];
        if self.has_exited(ExitKind::BadType) {
            return false;
        }
        [(lhs, rhs), (rhs, lhs)].into_iter().any(|(value, other)| {
            let expected = self.expected(value);
            // What has been nothing so far is probably going to be like the other.
            let is_telling =
                !T::NULLISH.contains(expected) || BY_IDENTITY.contains(self.expected(other));
            let found = LIKELY.into_iter().find(|it| it.contains(expected));
            let found = found.filter(|_| is_telling);
            (found.map(|ty| self.check_type(value, ty, ExitKind::BadType))).is_some()
        })
    }

    pub(super) fn strict_equal(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        if self.is(lhs, BY_IDENTITY) || self.is(rhs, BY_IDENTITY) {
            return self.same_bits(lhs, rhs);
        }
        let known = [lhs, rhs].map(|it| self.type_of(it));
        if !(CLASSES.iter()).any(|class| known.iter().all(|it| it.intersects(*class))) {
            return self.graph.function.const32(0);
        }
        if let Some(result) = self.equal_of_one_type(lhs, rhs) {
            return result;
        }
        if self.try_identity(lhs, rhs) {
            return self.same_bits(lhs, rhs);
        }
        self.equals_atom(lhs, rhs).unwrap_or_else(|| {
            let descriptions = [lhs, rhs].map(|it| self.description_of(it));
            let data = self.graph.types.pair(descriptions);
            let operands = [lhs, rhs].map(|it| self.alias(it));
            self.node(Kind::GenericStrictEqual, &operands, data)
        })
    }

    pub(super) fn loose_equal(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        if let Some(result) = self.equal_of_one_type(lhs, rhs) {
            return result;
        }
        for ty in [T::OBJECT, T::BOOLEAN, T::SYMBOL] {
            if self.both_expected(lhs, rhs, ty) {
                self.checked_both(lhs, rhs, ty, ExitKind::BadType);
                return self.same_bits(lhs, rhs);
            }
        }
        let expected = self.expected(lhs) | self.expected(rhs);
        let one_class = (CLASSES.into_iter().map(|class| class | T::NULLISH))
            .find(|&it| self.both_expected_unless(ExitKind::Mixed, lhs, rhs, it));
        if let Some(ty) = one_class
            && (!ty.contains(T::OBJECT) || self.objects_are_what_they_seem())
        {
            self.checked_both(lhs, rhs, ty, ExitKind::Mixed);
            return self.equal_or_both_nullish(lhs, rhs);
        }
        if self.both_expected_unless(ExitKind::Mixed, lhs, rhs, T::FULL_NUMBER | T::BOOLEAN) {
            self.checked_both(lhs, rhs, T::FULL_NUMBER | T::BOOLEAN, ExitKind::Mixed);
            let [lhs, rhs] = [lhs, rhs].map(|operand| self.to_double(operand));
            return self.ir().float_compare(FloatCond::Eq, lhs, rhs);
        }
        let has_objects = expected.intersects(T::OBJECT);
        let quiet = if has_objects {
            T::OBJECT | T::NULLISH
        } else {
            !T::OBJECT
        };
        let operands = self.checked_both(lhs, rhs, quiet, ExitKind::ExoticObject);
        let data = self.in_line(operands);
        self.node(Kind::QuietLooseEqual, &operands, data)
    }

    fn equal_or_both_nullish(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        let is_same = self.strict_equal(lhs, rhs);
        let [first, second] = [lhs, rhs].map(|it| self.is_type(it, T::NULLISH));
        let mut ir = self.ir();
        if ir.is_int_constant(first, 0) || ir.is_int_constant(second, 0) {
            return is_same;
        }
        let are_nullish = ir.and(first, second);
        ir.or(is_same, are_nullish)
    }

    fn objects_are_what_they_seem(&mut self) -> bool {
        self.graph
            .try_to_assume(self.origin, RealmWatchpoint::NoObjectMasqueradesAsUndefined)
    }

    pub(super) fn is_type(&mut self, value: Ssa, wanted: T) -> Ssa {
        let known = self.type_of(value);
        if wanted.contains(known) || !wanted.intersects(known) {
            return self.graph.function.const32(wanted.contains(known).into());
        }
        let data = self.graph.type_check(TypeCheck::describing(wanted, known));
        let alias = self.alias(value);
        self.node(Kind::IsType, &[alias], data)
    }

    pub(super) fn equal_null(&mut self, value: Ssa) -> Ssa {
        if self.type_of(value).intersects(T::OTHER_OBJECT) && !self.objects_are_what_they_seem() {
            return self.node(Kind::GenericEqualNull, &[value], 0);
        }
        let expected = self.expected(value);
        if (T::CELL | T::NULLISH).contains(expected)
            && expected.intersects(T::CELL)
            && !self.is(value, T::CELL | T::NULLISH)
            && !self.has_exited(ExitKind::BadType)
            && let Some(result) =
                self.is_cell_and_check_later(value, false, [T::CELL, nothing_like(expected)])
        {
            return result;
        }
        self.is_type(value, T::NULLISH)
    }

    pub(super) fn to_boolean(&mut self, value: Ssa) -> Ssa {
        let expected = self.expected(value);
        let expects = |ty: T| {
            self.is(value, ty) || ty.contains(expected) && !self.has_exited(ExitKind::BadType)
        };
        if self.is(value, T::BOOLEAN) {
            return self.as_boolean(value, ExitKind::BadType);
        }
        let (others, root) = (T::BOOLEAN | T::NULLISH, self.graph.root(value));
        if self.is(value, others) || expects(others) && expected.intersects(T::BOOLEAN) {
            self.check_type(value, others, ExitKind::BadType);
            return self.ir().equal(root, Value::TRUE.to_bits());
        }
        if let Some(wide) = self.graph.inside(root, Kind::BoxInt52) {
            return self.ir().is_not_zero(wide);
        }
        if expects(T::INT32) {
            let int32 = self.as_int32(value, ExitKind::BadType);
            return self.ir().is_not_zero(int32);
        }
        if expects(T::FULL_NUMBER) && !expected.intersects(T::INT32)
            || self.is(value, T::FULL_DOUBLE)
        {
            let double = self.as_double(value, ExitKind::BadType);
            let zero = self.graph.function.const_f64(0.0);
            return self.ir().float_compare(FloatCond::Ne, double, zero);
        }
        let or_nothing = [T::STRING, T::OBJECT].map(|it| it | T::NULLISH);
        let likely = or_nothing.into_iter().find(|&it| expects(it));
        let likely = likely.filter(|_| !T::NULLISH.contains(expected));
        if self.type_of(value).intersects(T::OTHER_OBJECT)
            && likely != Some(or_nothing[0])
            && !self.objects_are_what_they_seem()
        {
            return self.node(Kind::GenericToBoolean, &[value], 0);
        }
        if likely == Some(or_nothing[1])
            && !self.is(value, or_nothing[1])
            && let Some(result) =
                self.is_cell_and_check_later(value, true, [T::OBJECT, nothing_like(expected)])
        {
            return result;
        }
        if let Some(ty) = likely {
            self.check_type(value, ty, ExitKind::BadType);
        }
        if self.is(value, or_nothing[1]) {
            return self.is_type(value, T::OBJECT);
        }
        let mut description = self.description_of(value);
        if T::NULLISH.contains(expected) {
            description.wanted |= T::OBJECT | T::STRING;
        }
        let (data, alias) = (self.graph.type_check(description), self.alias(value));
        self.node(Kind::PlainToBoolean, &[alias], data)
    }
}
