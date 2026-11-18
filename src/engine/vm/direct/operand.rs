use bun_engine_number::exact_int52;
use bun_engine_number::math::MAX_EXPONENT_BY_SQUARING;
use bun_engine_regexp::Flags;
use bun_engine_text::StringImpl;
use bun_engine_unicode::MAX_CODE_POINT;

use super::State;
use crate::{
    CellKind, CellType, Cx, DateInstance, Gc, GlobalObject, JsBigInt, JsResult, JsString,
    JsStringIterator, JsSymbol, PlainMatchIterator, PlainRegExp, RealmSlot, RegExp, RegExpObject,
    RegExpStringIterator, SpeculatedType as T, StringObject, Value,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Operand {
    pub kind: Kind,
    /// If not, it only has to be of the kind.
    pub is_passed: bool,
}

/// What a value has to be, and what is passed for it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// Or missing.
    Undefined,
    /// In 32 bits, and from `min` to `max` once it has been converted.
    Integer {
        conversion: Conversion,
        min: i32,
        max: i32,
        /// Stands in for an argument that is missing or undefined.
        default: Option<i32>,
    },
    /// In 64 bits.
    Int52,
    /// As a double.
    Number,
    /// ToNumber of a number, a boolean, undefined or null, as a double.
    ToNumber,
    /// As it is.
    Value(T),
    Cell(CellType),
    /// An object that has the shape in that slot of the realm of the callee.
    Original(RealmSlot, T),
    /// A string that is no rope. Its fiber is passed to a leaf, which reads what that leads to: nothing collects
    /// between the load and the call.
    Characters,
    /// A string of length 1. The code unit is passed, in 32 bits.
    Unit,
    /// A string without `$`, as it is.
    Literal,
    /// A RegExp object that has the original shape and a number in `lastIndex`.
    PlainRegExp,
    /// The same. Its `RegExp` is passed.
    Pattern(Searches),
    /// A `RegExpStringIterator` whose matcher is a `PlainRegExp`.
    PlainMatchIterator,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Conversion {
    /// The value is an int32.
    None,
    /// Of a number, a boolean, undefined or null.
    ToInt32,
    /// Of a number: towards zero, to the nearest int32, and NaN to zero.
    Clamp,
}

/// What else holds of an object of which only the pattern is passed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Searches {
    AnyWay,
    /// Neither global nor sticky.
    Once,
    /// Global, and `lastIndex` is the int32 0.
    AllFromStart,
}

impl Searches {
    pub fn suits(self, flags: Flags) -> bool {
        match self {
            Searches::AnyWay => true,
            Searches::Once => !flags.intersects(Flags::GLOBAL | Flags::STICKY),
            Searches::AllFromStart => flags.contains(Flags::GLOBAL),
        }
    }
}

const QUIETLY_CONVERTED: T = T::FULL_NUMBER.union(T::BOOLEAN).union(T::NULLISH);

impl Kind {
    /// No value of another type is of the kind. The type says all only of `Undefined`, `Number`, `ToNumber` and `Value`.
    pub const fn types(self) -> T {
        match self {
            Kind::Undefined => T::UNDEFINED,
            Kind::Integer {
                conversion,
                default,
                ..
            } => {
                let converted = match conversion {
                    Conversion::None => T::INT32,
                    Conversion::ToInt32 => QUIETLY_CONVERTED,
                    Conversion::Clamp => T::FULL_NUMBER,
                };
                match default {
                    Some(_) => converted.union(T::UNDEFINED),
                    None => converted,
                }
            }
            Kind::Int52 => T::INT32.union(T::INT52).union(T::INT_AS_DOUBLE),
            Kind::Number => T::FULL_NUMBER,
            Kind::ToNumber => QUIETLY_CONVERTED,
            Kind::Value(types) | Kind::Original(_, types) => types,
            Kind::Cell(cell_type) => T::of_cell_type(cell_type),
            Kind::Characters => T::FLAT_STRING,
            Kind::Unit | Kind::Literal => T::STRING,
            Kind::PlainRegExp | Kind::Pattern(_) => T::REGEXP_OBJECT,
            Kind::PlainMatchIterator => T::OTHER_OBJECT,
        }
    }

    /// What can change so that a value is no longer of the kind, or something else has to be passed for it.
    pub const fn reads(self) -> State {
        let plain = State::SHAPE.union(State::LAST_INDEX);
        match self {
            Kind::Original(..) => State::SHAPE,
            Kind::PlainRegExp | Kind::PlainMatchIterator => plain,
            Kind::Pattern(_) => plain.union(State::PATTERN),
            Kind::Undefined
            | Kind::Integer { .. }
            | Kind::Int52
            | Kind::Number
            | Kind::ToNumber
            | Kind::Value(_)
            | Kind::Cell(_)
            | Kind::Characters
            | Kind::Unit
            | Kind::Literal => State::empty(),
        }
    }

    pub const fn is_double(self) -> bool {
        matches!(self, Kind::Number | Kind::ToNumber)
    }

    pub const fn can_be_missing(self) -> bool {
        matches!(
            self,
            Kind::Undefined
                | Kind::Integer {
                    default: Some(_),
                    ..
                }
        )
    }

    /// Where the realm has the shape that the value, or its matcher, has to have.
    pub const fn original_shape(self) -> Option<RealmSlot> {
        match self {
            Kind::Original(slot, _) => Some(slot),
            Kind::PlainRegExp | Kind::Pattern(_) | Kind::PlainMatchIterator => {
                Some(RealmSlot::regexp_shape)
            }
            _ => None,
        }
    }

    pub(super) const fn can_lead_to_rope(self) -> bool {
        let with_strings = T::OBJECT.difference(T::DATE.union(T::REGEXP_OBJECT));
        !matches!(self, Kind::Unit) && self.types().intersects(with_strings.union(T::ROPE_STRING))
    }

    /// What is passed for a value that is no cell, if it is of the kind. `None` is a missing argument.
    pub fn pass_immediate(self, value: Option<Value>) -> Option<u64> {
        let is_absent = value.is_none_or(Value::is_undefined);
        let number = || match value? {
            Value::UNDEFINED => Some(f64::NAN),
            Value::NULL | Value::FALSE => Some(0.0),
            Value::TRUE => Some(1.0),
            other => other.as_number(),
        };
        match self {
            Kind::Undefined => is_absent.then_some(0),
            Kind::Integer {
                conversion,
                min,
                max,
                default,
            } => {
                let integer = match (default, conversion) {
                    (Some(default), _) if is_absent => default,
                    (_, Conversion::None) => value?.as_int32()?,
                    (_, Conversion::ToInt32) => bun_engine_number::to_int32(number()?),
                    (_, Conversion::Clamp) => value?.as_number()? as i32,
                };
                (min..=max)
                    .contains(&integer)
                    .then_some(u64::from(integer as u32))
            }
            Kind::Int52 => exact_int52(value?.as_number()?).map(|integer| integer as u64),
            Kind::Number => value?.as_number().map(f64::to_bits),
            Kind::ToNumber => number().map(f64::to_bits),
            Kind::Value(types) => value
                .filter(|&it| types.contains(T::of(Some(it))))
                .map(Value::to_bits),
            _ => None,
        }
    }

    /// The same, for any value.
    pub(super) fn pass(self, global: &GlobalObject, value: Option<Value>) -> Option<u64> {
        let Some(cell) = value.and_then(Value::as_cell) else {
            return self.pass_immediate(value);
        };
        let itself = cell.address() as u64;
        if self == Kind::PlainMatchIterator {
            let matcher = cell.downcast::<RegExpStringIterator>()?.matcher();
            return (Kind::PlainRegExp.pass(global, Some(matcher.into()))).map(|_| itself);
        }
        if let Some(slot) = self.original_shape()
            && global.slot_if_initialized(slot) != Some(cell.shape().cell())
        {
            return None;
        }
        let plain = || cell.downcast::<RegExpObject>().filter(|it| it.is_plain());
        match self {
            Kind::Value(types) => types.contains(T::of_cell(&cell)).then_some(itself),
            Kind::Cell(cell_type) => (cell.cell_type() == cell_type).then_some(itself),
            Kind::Original(..) => Some(itself),
            Kind::Characters => {
                (cell.downcast::<JsString>()?.try_impl()).map(|it| it.address() as u64)
            }
            Kind::Unit => {
                let view = cell.downcast::<JsString>()?.try_view()?;
                (view.text().len() == 1).then(|| view.text().at(0).into())
            }
            Kind::Literal => {
                let view = cell.downcast::<JsString>()?.try_view()?;
                (!view.text().contains_unit(b'$'.into())).then_some(itself)
            }
            Kind::PlainRegExp => plain().map(|_| itself),
            Kind::Pattern(searches) => {
                let (regexp, last_index) = plain().map(|it| (it.regexp(), it.last_index()))?;
                let is_at_start = searches != Searches::AllFromStart || last_index == Value::ZERO;
                (is_at_start && searches.suits(regexp.flags())).then(|| regexp.address() as u64)
            }
            _ => None,
        }
    }
}

/// # Safety
/// What `Kind::pass` gives is a valid `Self` in the low bits of a register.
pub(super) unsafe trait Parameter {
    const KIND: Kind;
}

#[cfg(debug_assertions)]
pub(super) trait Passed: Parameter {
    fn to_register(&self) -> u64;
}

macro_rules! parameters {
    ($($type:ty = $kind:expr, |$it:ident| $register:expr;)*) => {$(
        // SAFETY: a number, a reference or a value, or transparently one of them.
        unsafe impl Parameter for $type {
            const KIND: Kind = $kind;
        }

        #[cfg(debug_assertions)]
        impl Passed for $type {
            fn to_register(&self) -> u64 {
                let $it = self;
                $register
            }
        }
    )*};
}

macro_rules! cells {
    ($($type:ty = $kind:path,)*) => {
        parameters! {$(
            Gc<$type> = $kind(<$type as CellKind>::CELL_TYPE), |it| it.address() as u64;
        )*}
    };
}

const fn value_of(cell_type: CellType) -> Kind {
    Kind::Value(T::of_cell_type(cell_type))
}

cells! {
    JsString = value_of,
    JsSymbol = value_of,
    JsBigInt = value_of,
    DateInstance = value_of,
    RegExpObject = value_of,
    StringObject = value_of,
    JsStringIterator = Kind::Cell,
}

const fn integer(conversion: Conversion, min: i32, max: i32, default: Option<i32>) -> Kind {
    assert!(!matches!(conversion, Conversion::ToInt32) || matches!(default, None | Some(0)));
    Kind::Integer {
        conversion,
        min,
        max,
        default,
    }
}

parameters! {
    i32 = integer(Conversion::None, i32::MIN, i32::MAX, None), |it| u64::from(*it as u32);
    i64 = Kind::Int52, |it| *it as u64;
    f64 = Kind::Number, |it| it.to_bits();
    Value = Kind::Value(T::HEAP_TOP), |it| it.to_bits();
    &StringImpl = Kind::Characters, |it| it.address() as u64;
    ToNumber = Kind::ToNumber, |it| it.0.to_bits();
    Unit = Kind::Unit, |it| it.0.into();
    Primitive = Kind::Value(NUMBER_LIKE.union(T::BIGINT)), |it| it.0.to_bits();
    NumberLike = Kind::Value(NUMBER_LIKE), |it| it.0.to_bits();
    Original<StringObject> = Kind::Original(RealmSlot::string_object_shape, T::STRING_OBJECT),
        |it| it.0.address() as u64;
    Original<DateInstance> = Kind::Original(RealmSlot::date_shape, T::DATE),
        |it| it.0.address() as u64;
    Original<RegExpObject> = Kind::Original(RealmSlot::regexp_shape, T::REGEXP_OBJECT),
        |it| it.0.address() as u64;
    Literal = Kind::Literal, |it| it.0.address() as u64;
    PlainMatchIterator<'_> = Kind::PlainMatchIterator, |it| it.address() as u64;
    PlainRegExp<'_> = Kind::PlainRegExp, |it| it.address() as u64;
}

#[derive(Clone, Copy)]
#[repr(transparent)]
pub(super) struct ToNumber(pub(super) f64);

#[derive(Clone, Copy)]
#[repr(transparent)]
pub(super) struct Unit(u32);

impl Unit {
    #[inline(always)]
    pub(super) fn get(self) -> u16 {
        self.0 as u16
    }
}

/// One that ToString takes without throwing a TypeError.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(super) struct Primitive(pub(super) Value);

/// One that ToNumber takes in the same way.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(super) struct NumberLike(pub(super) Value);

const NUMBER_LIKE: T = T::HEAP_TOP.difference(T::CELL).union(T::STRING);

#[derive(Clone, Copy)]
#[repr(transparent)]
pub(super) struct Original<O>(pub(super) Gc<O>);

#[derive(Clone, Copy)]
#[repr(transparent)]
pub(super) struct Literal(pub(super) Gc<JsString>);

macro_rules! patterns {
    ($($name:ident = $searches:ident,)*) => {$(
        #[derive(Clone, Copy)]
        #[repr(transparent)]
        pub(super) struct $name(pub(super) Gc<RegExp>);

        parameters! {
            $name = Kind::Pattern(Searches::$searches), |it| it.0.address() as u64;
        }
    )*};
}

patterns! {
    AnyPattern = AnyWay,
    PatternSearchingOnce = Once,
    GlobalPattern = AllFromStart,
}

macro_rules! conditions {
    ($($(#[$doc:meta])* $name:ident = $kind:expr;)*) => {$(
        $(#[$doc])*
        pub(super) enum $name {}

        // SAFETY: not passed, since no function can be called with it.
        unsafe impl Parameter for $name {
            const KIND: Kind = $kind;
        }
    )*};
}

conditions! {
    Undefined = Kind::Undefined;
    /// The default radix.
    Ten = integer(Conversion::None, 10, 10, Some(10));
}

macro_rules! integers {
    ($($(#[$doc:meta])* $visibility:vis $name:ident = $conversion:ident, $min:expr, $max:expr, $default:expr;)*) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy)]
        #[repr(transparent)]
        $visibility struct $name($visibility i32);

        parameters! {
            $name = integer(Conversion::$conversion, $min, $max, $default), |it| u64::from(it.0 as u32);
        }
    )*};
}

const MIN: i32 = i32::MIN;
const MAX: i32 = i32::MAX;

integers! {
    pub ToInt32 = ToInt32, MIN, MAX, None;
    /// A position in a string. None is long enough for the clamping to show.
    pub Start = Clamp, MIN, MAX, Some(0);
    pub End = Clamp, MIN, MAX, Some(MAX);
    /// For a search backwards, where NaN is the end.
    pub LastStart = None, MIN, MAX, Some(MAX);
    /// To be taken as unsigned.
    pub(super) Limit = None, MIN, MAX, Some(-1);
    /// One whose magnitude is an int32.
    pub(super) Negatable = None, -MAX, MAX, None;
    pub(super) CodePoint = None, 0, MAX_CODE_POINT as i32, None;
    pub ParseRadix = ToInt32, MIN, MAX, Some(0);
    pub(super) Radix = Clamp, 2, 36, Some(10);
    pub(super) FractionDigits = Clamp, 0, 100, Some(0);
    pub(super) Precision = Clamp, 1, 100, None;
    pub(super) Count = None, 0, MAX, None;
    pub(super) SmallExponent = None, 0, MAX_EXPONENT_BY_SQUARING, None;
}

impl LastStart {
    #[inline(always)]
    pub fn convert(cx: &mut Cx, value: Value) -> JsResult<LastStart> {
        Ok(LastStart(match value.as_int32() {
            Some(position) => position,
            None if value.is_undefined() => MAX,
            None => match value.to_number(cx)? {
                position if position.is_nan() => MAX,
                position => position as i32,
            },
        }))
    }

    #[inline(always)]
    pub(super) fn get(self) -> u32 {
        self.0.max(0) as u32
    }
}

impl ParseRadix {
    #[inline(always)]
    pub fn convert(cx: &mut Cx, value: Value) -> JsResult<ParseRadix> {
        match value {
            Value::UNDEFINED => Ok(ParseRadix(0)),
            _ => value.to_int32(cx).map(ParseRadix),
        }
    }
}

impl Radix {
    #[inline(always)]
    pub(super) fn get(self) -> bun_engine_number::Radix {
        bun_engine_number::Radix::new(self.0).unwrap_or(bun_engine_number::Radix::DECIMAL)
    }
}

macro_rules! positions {
    ($($name:ident = $default:expr,)*) => {$(
        impl $name {
            #[inline(always)]
            pub fn convert(cx: &mut Cx, value: Value) -> JsResult<$name> {
                Ok($name(match value.as_int32() {
                    Some(position) => position,
                    None if value.is_undefined() => $default,
                    None => value.to_number(cx)? as i32,
                }))
            }

            /// Where a negative position does not count from the end.
            #[inline(always)]
            pub(super) fn within(self, length: usize) -> usize {
                (self.0.max(0) as usize).min(length)
            }
        }
    )*};
}

positions! {
    Start = 0,
    End = MAX,
}
