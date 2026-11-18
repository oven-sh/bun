use bun_engine_vm::{JsBigInt, PreferredType, Thrown};

use super::legacy;
use super::prelude::*;
use super::state::throw;
use crate::Error;
use crate::number_format::{
    DigitOptions, Grouping, MathematicalValue, MinimumIntegerDigits, Notation, NumberFormat,
    Options, RequestedDigits, RequestedStyle, RoundingIncrement, Style, StyleOptions,
};

#[cell(name = "Object")]
struct JsNumberFormat {
    base: JsDestructibleObject,
    format: NumberFormat,
    pub(self) bound_format: Field<Option<Gc<JsObject>>>,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    getter(names::format, get_format),
    StaticProperty::function(names::formatRange, format_range, 2),
    StaticProperty::function(names::formatRangeToParts, format_range_to_parts, 2),
    StaticProperty::function(names::formatToParts, format_to_parts, 1),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlNumberFormat),
]);

define_class!(
    NumberFormat: JsNumberFormat, "Intl.NumberFormat", length 0, GENERAL_CONSTRUCTOR_PROPERTIES,
    init_number_format_constructor, init_number_format_shape
);

fn new_number_format(cx: &mut Cx, locales: Value, options: Value) -> JsResult<NumberFormat> {
    let requested = canonicalize_locale_list(cx, locales)?;
    let options = OptionBag::coerce(cx, options)?;
    options.check_locale_matcher(cx)?;
    let numbering_system = options.numbering_system(cx)?;
    let style = read_style(cx, options)?;
    let notation = options.value_or_default(cx, names::notation)?;
    let options = Options {
        style,
        notation,
        digits: read_digits(cx, options, |digits, to_number| {
            style.resolve_digits(digits, notation, to_number)
        })?,
        compact_display: options.value_or_default(cx, names::compactDisplay)?,
        grouping: read_grouping(cx, options, notation)?,
        sign_display: options.value_or_default(cx, names::signDisplay)?,
    };
    with_cache(cx, |cache| {
        NumberFormat::new(cache, &requested, numbering_system.as_ref(), options)
    })
}

/// SetNumberFormatUnitOptions
fn read_style(cx: &mut Cx, options: OptionBag) -> JsResult<StyleOptions> {
    let style: Style = options.value_or_default(cx, names::style)?;
    let currency = options.string(cx, names::currency)?;
    let currency = (style.currency(currency.as_ref().map(|it| it.text()))).or_throw(cx)?;
    let currency_display = options.value_or_default(cx, names::currencyDisplay)?;
    let currency_sign = options.value_or_default(cx, names::currencySign)?;
    let unit = options.string(cx, names::unit)?;
    let requested = RequestedStyle {
        style,
        currency,
        currency_display,
        currency_sign,
        unit: (style.unit(unit.as_ref().map(|it| it.text()))).or_throw(cx)?,
        unit_display: options.value_or_default(cx, names::unitDisplay)?,
    };
    requested.resolve().or_throw(cx)
}

pub(super) enum Failure {
    Thrown(Thrown),
    Invalid(Error),
}

impl From<Error> for Failure {
    fn from(error: Error) -> Failure {
        Failure::Invalid(error)
    }
}

/// SetNumberFormatDigitOptions
pub(super) fn read_digits(
    cx: &mut Cx,
    options: OptionBag,
    resolve: impl FnOnce(
        RequestedDigits<Value>,
        &mut dyn FnMut(Value) -> Result<f64, Failure>,
    ) -> Result<DigitOptions, Failure>,
) -> JsResult<DigitOptions> {
    let requested = RequestedDigits {
        minimum_integer_digits: options
            .number(cx, names::minimumIntegerDigits, MinimumIntegerDigits::new)?
            .unwrap_or_default(),
        minimum_fraction_digits: options.get(cx, names::minimumFractionDigits)?,
        maximum_fraction_digits: options.get(cx, names::maximumFractionDigits)?,
        minimum_significant_digits: options.get(cx, names::minimumSignificantDigits)?,
        maximum_significant_digits: options.get(cx, names::maximumSignificantDigits)?,
        rounding_increment: options
            .number(cx, names::roundingIncrement, RoundingIncrement::new)?
            .unwrap_or_default(),
        rounding_mode: options.value_or_default(cx, names::roundingMode)?,
        rounding_priority: options.value_or_default(cx, names::roundingPriority)?,
        trailing_zero_display: options.value_or_default(cx, names::trailingZeroDisplay)?,
    };
    let resolved = resolve(requested, &mut |value| {
        value.to_number(cx).map_err(Failure::Thrown)
    });
    resolved.map_err(|failure| match failure {
        Failure::Thrown(thrown) => thrown,
        Failure::Invalid(error) => throw(cx, &error),
    })
}

fn read_grouping(
    cx: &mut Cx,
    options: OptionBag,
    notation: Notation,
) -> JsResult<Option<Grouping>> {
    match options.get(cx, names::useGrouping)? {
        None => Ok(Some(Grouping::default_for(notation))),
        Some(value) if value.is_true() => Ok(Some(Grouping::Always)),
        Some(value) if !value.to_boolean(cx) => Ok(None),
        Some(value) => {
            let string = value.to_string_view(cx)?;
            Grouping::parse(string.text(), notation)
                .or_throw(cx)
                .map(Some)
        }
    }
}

/// ToIntlMathematicalValue
#[inline]
pub(super) fn to_mathematical_value(cx: &mut Cx, value: Value) -> JsResult<MathematicalValue> {
    if let Some(number) = value.as_number() {
        return Ok(number.into());
    }
    let primitive = value.to_primitive(cx, PreferredType::Number)?;
    if let Some(integer) = primitive.as_bigint() {
        return from_bigint(cx, integer);
    }
    match primitive.as_string() {
        Some(string) => MathematicalValue::from_string(string.view(cx)?.text()).or_throw(cx),
        None => Ok(primitive.to_number(cx)?.into()),
    }
}

fn from_bigint(cx: &Cx, value: Gc<JsBigInt>) -> JsResult<MathematicalValue> {
    let mut poll = || cx.is_termination_requested();
    MathematicalValue::from_bigint(value.value(), &mut poll).or_throw(cx)
}

/// The arguments of a method that takes a range.
pub(super) fn to_range(cx: &mut Cx, frame: &CallFrame) -> JsResult<[MathematicalValue; 2]> {
    let (start, end) = (frame.argument(0), frame.argument(1));
    if start.is_undefined() || end.is_undefined() {
        return Err(cx.throw_type_error("start or end is undefined"));
    }
    Ok([
        to_mathematical_value(cx, start)?,
        to_mathematical_value(cx, end)?,
    ])
}

fn create(cx: &mut Cx, shape: Gc<Shape>, frame: &CallFrame) -> JsResult<Value> {
    let format = new_number_format(cx, frame.argument(0), frame.argument(1))?;
    let object = cx.allocate::<JsNumberFormat>(JsNumberFormatInit {
        base: JsObjectInit::new(cx, shape),
        format,
        bound_format: None,
    });
    Ok(object.into())
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = cx.number_format_shape();
    let instance = create(cx, shape, frame)?;
    legacy::chain(cx, frame, instance)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::number_format_shape)?;
    create(cx, shape, frame)
}

#[native_abi]
fn get_format(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let this = legacy::unwrap::<JsNumberFormat>(cx, this, Cx::number_format_constructor)?;
    let this: Gc<JsNumberFormat> = this!(cx, this, "NumberFormat", "format")?;
    if let Some(bound) = this.bound_format() {
        return Ok(bound.into());
    }
    let bound = bind_method(cx, this.upcast(), names::format, 1, format)?;
    this.set_bound_format(Some(bound));
    Ok(bound.into())
}

#[native_abi]
fn format(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsNumberFormat> = this!(cx, frame.this_value(), "NumberFormat", "format")?;
    let value = to_mathematical_value(cx, frame.argument(0))?;
    Ok(JsString::new(cx, this.format.format(&value).or_throw(cx)?).into())
}

#[native_abi]
fn format_range(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsNumberFormat> = this!(cx, frame.this_value(), "NumberFormat", "formatRange")?;
    let [start, end] = to_range(cx, frame)?;
    let range = with_cache(cx, |cache| this.format.format_range(cache, &start, &end))?;
    Ok(JsString::new(cx, range).into())
}

#[native_abi]
fn format_range_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsNumberFormat> =
        this!(cx, frame.this_value(), "NumberFormat", "formatRangeToParts")?;
    let [start, end] = to_range(cx, frame)?;
    let parts = with_cache(cx, |cache| {
        this.format.format_range_to_parts(cache, &start, &end)
    })?;
    parts_to_array(cx, &parts)
}

#[native_abi]
fn format_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsNumberFormat> = this!(cx, frame.this_value(), "NumberFormat", "formatToParts")?;
    let value = to_mathematical_value(cx, frame.argument(0))?;
    parts_to_array(cx, &this.format.format_to_parts(&value).or_throw(cx)?)
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    let this = legacy::unwrap::<JsNumberFormat>(cx, this, Cx::number_format_constructor)?;
    let this: Gc<JsNumberFormat> = this!(cx, this, "NumberFormat", "resolvedOptions")?;
    let resolved = *this.format.options();
    let numbering_system = this.format.numbering_system().or_throw(cx)?;

    let options = Record::with_locale(cx, this.format.locale().string().clone());
    options.put_string(names::numberingSystem, numbering_system.to_string_ref());
    options.put_named(names::style, resolved.style.style());
    match resolved.style {
        StyleOptions::Decimal | StyleOptions::Percent => {}
        StyleOptions::Currency {
            currency,
            display,
            sign,
        } => {
            options.put_string(names::currency, currency.to_string_ref());
            options.put_named(names::currencyDisplay, display);
            options.put_named(names::currencySign, sign);
        }
        StyleOptions::Unit { unit, display } => {
            options.put_string(names::unit, unit.to_string_ref());
            options.put_named(names::unitDisplay, display);
        }
    }
    put_digit_counts(&options, &resolved.digits);
    match resolved.grouping {
        Some(grouping) => options.put_named(names::useGrouping, grouping),
        None => options.put(names::useGrouping, false),
    }
    options.put_named(names::notation, resolved.notation);
    if resolved.notation == Notation::Compact {
        options.put_named(names::compactDisplay, resolved.compact_display);
    }
    options.put_named(names::signDisplay, resolved.sign_display);
    put_rounding(&options, &resolved.digits);
    Ok(options.finish())
}

pub(super) fn put_digit_counts(options: &Record<'_>, digits: &DigitOptions) {
    let put = |name, count: u8| options.put(name, Value::int32(count.into()));
    put(
        names::minimumIntegerDigits,
        digits.minimum_integer_digits.get(),
    );
    if let Some(fraction) = digits.rounding_type.fraction_digits() {
        put(names::minimumFractionDigits, fraction.minimum);
        put(names::maximumFractionDigits, fraction.maximum);
    }
    if let Some(significant) = digits.rounding_type.significant_digits() {
        put(names::minimumSignificantDigits, significant.minimum);
        put(names::maximumSignificantDigits, significant.maximum);
    }
}

pub(super) fn put_rounding(options: &Record<'_>, digits: &DigitOptions) {
    let increment = digits.rounding_increment.get();
    options.put(names::roundingIncrement, Value::int32(increment.into()));
    options.put_named(names::roundingMode, digits.rounding_mode);
    options.put_named(names::roundingPriority, digits.rounding_type.priority());
    options.put_named(names::trailingZeroDisplay, digits.trailing_zero_display);
}

/// `Number.prototype.toLocaleString`, after ThisNumberValue.
pub fn number_to_locale_string(
    cx: &mut Cx,
    value: f64,
    locales: Value,
    options: Value,
) -> JsResult<Gc<JsString>> {
    to_locale_string(cx, &value.into(), locales, options)
}

/// `BigInt.prototype.toLocaleString`, after ThisBigIntValue.
pub fn bigint_to_locale_string(
    cx: &mut Cx,
    value: Gc<JsBigInt>,
    locales: Value,
    options: Value,
) -> JsResult<Gc<JsString>> {
    let value = from_bigint(cx, value)?;
    to_locale_string(cx, &value, locales, options)
}

fn to_locale_string(
    cx: &mut Cx,
    value: &MathematicalValue,
    locales: Value,
    options: Value,
) -> JsResult<Gc<JsString>> {
    let string = if options.is_undefined() && (locales.is_undefined() || locales.is_string()) {
        let locale = locales.as_string().map(|it| it.resolve(cx)).transpose()?;
        with_cache(cx, |cache| {
            NumberFormat::format_by_default(cache, locale.as_deref(), value)
        })?
    } else {
        let format = new_number_format(cx, locales, options)?;
        format.format(value).or_throw(cx)?
    };
    Ok(JsString::new(cx, string))
}
