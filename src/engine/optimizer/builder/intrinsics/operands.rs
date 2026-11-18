//! Whether values are likely to be what a form wants, and the code that sees to it.

use bun_engine_asm::Sign;
use bun_engine_codegen::ir::{Type, Unary, Value as Ssa};
use bun_engine_vm::direct::{Conversion, Kind as Wanted};
use bun_engine_vm::{
    CellType, Gc, GlobalObject, JsObject, JsString, RealmSlot, Shape, SpeculatedType as T, Value,
};

use crate::builder::Builder;
use crate::graph::{ExitKind, Kind, ShapeSet};

const WHOLE: T = T::INT32.union(T::INT_AS_DOUBLE);

impl Builder<'_> {
    /// Empty if there is no telling yet.
    pub(super) fn likely_type(&self, value: Ssa) -> T {
        let (root, expected) = (self.graph.root(value), self.expected(value));
        let known = self.knowledge.type_of(&self.graph, root);
        match self.graph.node(root) {
            _ if expected.intersects(T::FULL_NUMBER) => expected,
            Some((kind, 0)) if kind.has_arithmetic_data() => T::INT32,
            Some((kind, _)) if kind.has_arithmetic_data() => T::BOXED_NUMBER,
            // What is computed on one of the ways here has no prediction yet.
            None if known.intersects(T::INT32) && !known.intersects(T::OBJECT) => {
                expected | T::INT32
            }
            _ => expected,
        }
    }

    /// Whether it is, or is worth a check that fails in that way.
    pub(super) fn expects(&self, value: Ssa, ty: T, failure: ExitKind) -> bool {
        let known = self.knowledge.type_of(&self.graph, value);
        ty.contains(known)
            || ty.intersects(known)
                && ty.contains(self.likely_type(value))
                && !self.has_exited(failure)
    }

    /// The profiles get one chance to learn.
    fn bad_argument(&self) -> ExitKind {
        if self.has_exited(ExitKind::BadArgument) {
            ExitKind::BadArgumentAgain
        } else {
            ExitKind::BadArgument
        }
    }

    pub(super) fn expects_argument(&self, value: Ssa, ty: T) -> bool {
        self.expects(value, ty, self.bad_argument())
    }

    pub(super) fn check_argument(&mut self, value: Ssa, ty: T) -> Ssa {
        self.check_type_or(value, ty, self.bad_argument())
    }

    /// `None` is a missing argument.
    pub(super) fn suits(
        &mut self,
        kind: Wanted,
        value: Option<Ssa>,
        realm: Gc<GlobalObject>,
        may_guess_pattern: bool,
    ) -> bool {
        let Some(value) = value else {
            return kind.can_be_missing();
        };
        if let Some(constant) = self.constant_value(value).filter(|it| !it.is_cell()) {
            return kind.pass_immediate(Some(constant)).is_some();
        }
        match kind {
            Wanted::Integer {
                conversion,
                min,
                max,
                default,
            } => {
                let takes_all = (min, max) == (i32::MIN, i32::MAX);
                default.is_some() && self.is_likely_absent(value)
                    || min != max
                        && (takes_all || !self.has_exited(ExitKind::OutOfBounds))
                        && self.suits_conversion(value, conversion, default.is_some())
            }
            Wanted::Int52 => self.expects(value, kind.types(), ExitKind::BadType),
            Wanted::Number => self.expects(value, T::FULL_NUMBER, ExitKind::NotANumber),
            Wanted::ToNumber => self.expects(value, kind.types(), ExitKind::ExoticObject),
            Wanted::Undefined => self.is_likely_absent(value),
            Wanted::Value(_) | Wanted::Cell(_) => self.expects_argument(value, kind.types()),
            Wanted::Original(slot, types) => self.expects_original(value, types, realm, slot),
            Wanted::Characters => {
                self.expects_argument(value, T::STRING)
                    && self.expects(value, T::FLAT_STRING, ExitKind::Rope)
            }
            Wanted::Unit => self.only_unit(value).is_some(),
            Wanted::Literal => self.has_no_dollar_sign(value),
            Wanted::PlainRegExp => self.expects_plain_regexp(value, realm),
            Wanted::Pattern(searches) => {
                self.expects_plain_regexp(value, realm)
                    && self.expects_pattern(value, searches, realm, may_guess_pattern)
            }
            Wanted::PlainMatchIterator => {
                self.expects_argument(value, kind.types()) && !self.has_exited(ExitKind::BadShape)
            }
        }
    }

    /// What is passed for a value that suits.
    pub(super) fn pass(
        &mut self,
        kind: Wanted,
        value: Option<Ssa>,
        realm: Gc<GlobalObject>,
    ) -> Ssa {
        let constant = value.map(|it| self.constant_value(it).filter(|it| !it.is_cell()));
        let (Some(value), Some(None)) = (value, constant) else {
            let bits = kind.pass_immediate(constant.flatten()).expect("suits");
            let function = &mut self.graph.function;
            return match kind {
                Wanted::Integer { .. } => function.const32(bits as i32),
                _ if kind.is_double() => function.const_f64(f64::from_bits(bits)),
                _ => function.const64(bits as i64),
            };
        };
        match kind {
            Wanted::Integer {
                conversion,
                min,
                max,
                default,
            } => match default {
                Some(default) if self.is_likely_absent(value) => {
                    self.check_argument(value, T::UNDEFINED);
                    self.int32(default)
                }
                _ => {
                    let integer = self.to_integer(value, conversion, default);
                    self.check_range(integer, min, max)
                }
            },
            Wanted::Int52 => self.node(Kind::AsInt52, &[self.graph.root(value)], 0),
            Wanted::Number => self.as_number(value),
            Wanted::ToNumber => self.to_double(value),
            Wanted::Undefined | Wanted::Value(_) => self.check_argument(value, kind.types()),
            Wanted::Literal => self.alias(value),
            Wanted::Cell(cell_type) => self.check_cell_type(value, cell_type),
            Wanted::Original(slot, types) => self.check_original(value, types, realm, slot),
            Wanted::Characters => {
                self.check_argument(value, T::STRING);
                self.check_type_or(value, T::FLAT_STRING, ExitKind::Rope)
            }
            Wanted::Unit => self.only_unit(value).expect("suits"),
            Wanted::PlainRegExp => self.check_plain_regexp(value, realm).0,
            Wanted::Pattern(searches) => self.pattern_of(value, searches, realm),
            Wanted::PlainMatchIterator => self.check_plain_match_iterator(value, realm),
        }
    }

    fn is_likely_absent(&self, value: Ssa) -> bool {
        self.is(value, T::UNDEFINED)
            || self.likely_type(value) == T::UNDEFINED && self.expects_argument(value, T::UNDEFINED)
    }

    fn suits_conversion(&self, value: Ssa, conversion: Conversion, has_default: bool) -> bool {
        let quiet = Wanted::ToNumber.types();
        let may_be_absent = has_default && self.likely_type(value).intersects(T::UNDEFINED);
        match conversion {
            Conversion::ToInt32 => self.expects(value, quiet, ExitKind::ExoticObject),
            Conversion::None if may_be_absent => {
                self.expects_argument(value, T::INT32 | T::UNDEFINED)
            }
            Conversion::None => self.expects(value, T::INT32, ExitKind::BadType),
            Conversion::Clamp if may_be_absent => {
                self.expects_argument(value, T::BOXED_NUMBER | T::UNDEFINED)
            }
            Conversion::Clamp => self.expects(value, T::FULL_NUMBER, ExitKind::NotANumber),
        }
    }

    fn to_integer(&mut self, value: Ssa, conversion: Conversion, default: Option<i32>) -> Ssa {
        let default = default.filter(|_| self.likely_type(value).intersects(T::UNDEFINED));
        match (conversion, default) {
            (Conversion::ToInt32, _) => self.truncate(value),
            (Conversion::None, None) => self.as_int32(value),
            (Conversion::Clamp, None) => self.clamp(value),
            (_, Some(default)) => {
                let few = T::INT32 | T::UNDEFINED;
                let present = if conversion == Conversion::None || self.expects_argument(value, few)
                {
                    let checked = self.check_argument(value, few);
                    self.ir().wrap(checked)
                } else {
                    let checked = self.check_argument(value, T::BOXED_NUMBER | T::UNDEFINED);
                    let number = self.node(Kind::PrimitiveToDouble, &[checked], 0);
                    self.saturate(number)
                };
                let (root, default) = (self.graph.root(value), self.int32(default));
                let mut ir = self.ir();
                let is_absent = ir.equal(root, Value::UNDEFINED.to_bits());
                ir.select(is_absent, default, present)
            }
        }
    }

    /// ToIntegerOrInfinity of a number, and then the nearest int32.
    pub(super) fn clamp(&mut self, value: Ssa) -> Ssa {
        if self.expects(value, WHOLE, ExitKind::NotAnInteger) {
            return self.as_index(value);
        }
        let number = self.as_number(value);
        self.saturate(number)
    }

    fn saturate(&mut self, number: Ssa) -> Ssa {
        let op = Unary::FloatToIntSaturating(Sign::Signed);
        self.ir().convert(op, Type::I32, number)
    }

    pub(super) fn to_double(&mut self, value: Ssa) -> Ssa {
        if self.is(value, T::BOXED_NUMBER) {
            return self.as_double(value);
        }
        self.node(Kind::ToDouble, &[self.graph.root(value)], 0)
    }

    fn check_range(&mut self, integer: Ssa, min: i32, max: i32) -> Ssa {
        if (min, max) == (i32::MIN, i32::MAX) {
            return integer;
        }
        let mut ir = self.ir();
        let distance = ir.sub(integer, min);
        let is_outside = ir.above(distance, max.wrapping_sub(min));
        self.exit_if(is_outside, ExitKind::OutOfBounds);
        self.node(Kind::InBounds, &[integer], 0)
    }

    pub(super) fn check_cell_type(&mut self, value: Ssa, cell_type: CellType) -> Ssa {
        let cell = self.check_argument(value, T::of_cell_type(cell_type));
        let is_it = self.node(Kind::IsCellOfType, &[cell], cell_type.0.into());
        let is_other = self.not(is_it);
        self.exit_if(is_other, ExitKind::ExoticObject);
        self.tie_down(value)
    }

    fn original_shape(&mut self, realm: Gc<GlobalObject>, slot: RealmSlot) -> ShapeSet {
        ShapeSet::single(self.shape(realm.slot(self.vm, slot).cast::<Shape>()))
    }

    pub(super) fn expects_original(
        &mut self,
        value: Ssa,
        types: T,
        realm: Gc<GlobalObject>,
        slot: RealmSlot,
    ) -> bool {
        if !self.expects_argument(value, types) {
            return false;
        }
        let original = self.original_shape(realm, slot);
        let known = self.knowledge.shapes_of(&mut self.graph, value);
        let has_other = |it: Gc<JsObject>| it.shape().cell() != realm.slot(self.vm, slot);
        known == original
            || self.graph.shapes.is_subset(original, known)
                && !self.has_exited(ExitKind::BadShape)
                && !self.constant_cell(value).is_some_and(has_other)
    }

    pub(super) fn check_original(
        &mut self,
        value: Ssa,
        types: T,
        realm: Gc<GlobalObject>,
        slot: RealmSlot,
    ) -> Ssa {
        self.check_argument(value, types);
        let original = self.original_shape(realm, slot);
        self.check_shapes(value, original)
    }

    fn has_no_dollar_sign(&self, value: Ssa) -> bool {
        const MOST_SEARCHED: u32 = 1000;
        let short = (self.constant_cell::<JsString>(value)).filter(|it| it.len() <= MOST_SEARCHED);
        (short.and_then(|it| it.try_view())).is_some_and(|it| !it.text().contains_unit(b'$'.into()))
    }
}
