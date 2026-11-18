//! `Intl.NumberFormat`

mod currency;
mod digit_options;
mod digits;
mod layout;
mod mathematical_value;
mod options;
pub(crate) mod parts;
mod skeleton;
mod unit;

use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::CStr;
use std::rc::Rc;

use bun_engine_text::{StringImpl, StringRef};
use bun_icu::formatted_value::FormattedValue;
use bun_icu::number_format::{
    Collapse, FormattedNumber, FormattedNumberRange, IdentityFallback, NumberFormatter,
    NumberRangeFormatter,
};

pub use currency::Currency;
pub use digit_options::{
    DigitOptions, DigitRange, MinimumIntegerDigits, RequestedDigits, RoundingIncrement,
    RoundingMode, RoundingPriority, RoundingType, TrailingZeroDisplay,
};
use layout::Layout;
pub use mathematical_value::MathematicalValue;
use mathematical_value::NumberInput;
pub use options::{
    CompactDisplay, CurrencyDisplay, CurrencySign, Grouping, Notation, Options, RequestedStyle,
    SignDisplay, Style, StyleOptions, UnitDisplay,
};
use parts::{FieldContext, align_spans, collect_fields, push_flattened, push_number_parts};
pub(crate) use skeleton::Skeleton;
pub(crate) use unit::SANCTIONED_UNITS;
pub use unit::Unit;

use crate::error::IcuResult;
use crate::numbering_system::NumericLocale;
use crate::parts::new_string;
use crate::{
    Cache, Error, KeywordValue, LanguageTag, NumberingSystem, Part, Parts, Result, Source,
};

pub(crate) const ESTIMATED_FORMATTER_SIZE: usize = 8 << 10;
const ESTIMATED_COMPACT_FORMATTER_SIZE: usize = 30 << 10;
pub(crate) const ESTIMATED_RANGE_FORMATTER_SIZE: usize = 20 << 10;

/// To learn a layout takes about as long as so many calls.
const CALLS_WITHOUT_LAYOUT: u8 = 32;

/// Those with the same locale and options are one.
#[derive(Clone)]
pub struct NumberFormat(Rc<Shared>);

struct Shared {
    locale: NumericLocale,
    options: Options,
    formatter: ReusingFormatter,
    range_formatter: OnceCell<NumberRangeFormatter>,
    calls_until_layout: Cell<u8>,
    layout: OnceCell<Option<Layout>>,
}

impl NumberFormat {
    pub fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        numbering_system: Option<&KeywordValue>,
        options: Options,
    ) -> Result<NumberFormat> {
        let locale = NumericLocale::resolve(cache, requested, numbering_system)?;
        cache.number_formats.find_or_insert(
            |it| it.0.options == options && it.0.locale == locale,
            || {
                cache.note_allocation(match options.notation {
                    Notation::Compact => ESTIMATED_COMPACT_FORMATTER_SIZE,
                    _ => ESTIMATED_FORMATTER_SIZE,
                });
                let skeleton = Skeleton::from(&options);
                let formatter =
                    ReusingFormatter::open(&skeleton, &locale.icu_locale()?, &options.digits)
                        .or_type_error("Failed to initialize NumberFormat")?;
                Ok(NumberFormat(Rc::new(Shared {
                    locale: locale.clone(),
                    options,
                    formatter,
                    range_formatter: OnceCell::new(),
                    calls_until_layout: Cell::new(CALLS_WITHOUT_LAYOUT),
                    layout: OnceCell::new(),
                })))
            },
        )
    }

    /// `toLocaleString` of a Number or a BigInt, with no options and no list of locales.
    pub fn format_by_default(
        cache: &Cache,
        locale: Option<&StringImpl>,
        value: &MathematicalValue,
    ) -> Result<StringRef> {
        cache.default_number_formats.with(
            cache,
            locale,
            |requested| NumberFormat::new(cache, requested, None, Options::default()),
            |format| format.format(value),
        )
    }

    pub fn locale(&self) -> &LanguageTag {
        self.0.locale.tag()
    }

    pub fn numbering_system(&self) -> Result<NumberingSystem> {
        self.0.locale.numbering_system()
    }

    pub fn options(&self) -> &Options {
        &self.0.options
    }

    pub fn format(&self, value: &MathematicalValue) -> Result<StringRef> {
        if let Some(number) = value.as_number()
            && let Some(text) = self.layout().and_then(|layout| layout.format(number))
        {
            return text;
        }
        let failure = match value.as_number() {
            Some(_) => "Failed to format a number.",
            None => "Failed to format a BigInt.",
        };
        self.0.formatter.format(value, failure, |result| {
            let text = result.value().and_then(FormattedValue::text);
            new_string(text.or_type_error(failure)?)
        })
    }

    pub fn format_to_parts(&self, value: &MathematicalValue) -> Result<Parts> {
        self.parts_with_source(value, None)
    }

    fn parts_with_source(
        &self,
        value: &MathematicalValue,
        source: Option<Source>,
    ) -> Result<Parts> {
        let failure = "Failed to format a number.";
        self.0.formatter.format(value, failure, |result| {
            let mut parts = Parts::default();
            let number = result.value().or_type_error(failure)?;
            push_number_parts(&mut parts, number, self.context(value), |kind| Part {
                source,
                ..kind.into()
            })?;
            Ok(parts)
        })
    }

    pub fn format_range(
        &self,
        cache: &Cache,
        start: &MathematicalValue,
        end: &MathematicalValue,
    ) -> Result<StringRef> {
        let range = self.range(cache, start, end)?;
        let text = range.value().and_then(FormattedValue::text);
        new_string(text.or_type_error("failed to format a range")?)
    }

    pub fn format_range_to_parts(
        &self,
        cache: &Cache,
        start: &MathematicalValue,
        end: &MathematicalValue,
    ) -> Result<Parts> {
        let range = self.range(cache, start, end)?;
        let range = range.value().or_type_error("failed to format a range")?;
        let failure = "Failed to format number range";
        let text = range.text().or_type_error(failure)?;
        let mut fields = collect_fields(range, failure)?;
        let [start_span, end_span] = align_spans(&mut fields);
        // The approximately sign has a field of its own from ICU 71 on.
        if start_span.is_empty() && bun_icu::library_version().major < 71 {
            return self.parts_with_source(start, Some(Source::Shared));
        }

        let mut parts = Parts::default();
        push_flattened(&mut parts, text, fields, |field, at| {
            let (source, value) = if start_span.contains(&at) {
                (Source::StartRange, start)
            } else if end_span.contains(&at) {
                (Source::EndRange, end)
            } else {
                (Source::Shared, start)
            };
            Part {
                kind: self.context(value).kind_of(field),
                unit: None,
                source: Some(source),
            }
        })?;
        Ok(parts)
    }

    fn layout(&self) -> Option<&Layout> {
        if let Some(remaining) = self.0.calls_until_layout.get().checked_sub(1) {
            self.0.calls_until_layout.set(remaining);
            return None;
        }
        let learn = || {
            Layout::learn(&self.0.options, |number| {
                self.format_to_parts(&number.into()).ok()
            })
        };
        self.0.layout.get_or_init(learn).as_ref()
    }

    fn range(
        &self,
        cache: &Cache,
        start: &MathematicalValue,
        end: &MathematicalValue,
    ) -> Result<FormattedNumberRange> {
        check_range(start, end)?;
        let formatter = self.0.range_formatter.get_or_try_init(|| {
            cache.note_allocation(ESTIMATED_RANGE_FORMATTER_SIZE);
            NumberRangeFormatter::open(
                &Skeleton::from(&self.0.options),
                &self.0.locale.icu_locale()?,
                Collapse::Auto,
                IdentityFallback::Approximately,
            )
            .or_type_error("failed to initialize NumberFormat")
        })?;
        start
            .format_range_to(end, formatter, (&self.0.options.digits).into())
            .or_type_error("failed to format a range")
    }

    fn context(&self, value: &MathematicalValue) -> FieldContext {
        FieldContext {
            is_negative: value.is_negative(),
            is_infinite: value.is_infinite(),
            is_nan: value.is_nan(),
            is_unit_style: self.0.options.style.style() == Style::Unit,
        }
    }
}

pub(crate) fn check_range(start: &MathematicalValue, end: &MathematicalValue) -> Result<()> {
    if start.is_nan() || end.is_nan() {
        return Err(Error::Range("Passed numbers are out of range"));
    }
    Ok(())
}

/// Keeps the object that takes the results.
pub(crate) struct ReusingFormatter {
    formatter: NumberFormatter,
    input: NumberInput,
    result: RefCell<FormattedNumber>,
}

impl ReusingFormatter {
    pub(crate) fn open(
        skeleton: &Skeleton,
        locale: &CStr,
        digits: &DigitOptions,
    ) -> bun_icu::Result<ReusingFormatter> {
        Ok(ReusingFormatter {
            formatter: NumberFormatter::open(skeleton, locale)?,
            input: digits.into(),
            result: RefCell::new(FormattedNumber::open()?),
        })
    }

    pub(crate) fn format<T>(
        &self,
        value: &MathematicalValue,
        failure: &'static str,
        read: impl FnOnce(&FormattedNumber) -> Result<T>,
    ) -> Result<T> {
        let format_into = |result: &mut FormattedNumber| {
            value
                .format(&self.formatter, self.input, result)
                .or_type_error(failure)?;
            read(result)
        };
        match value.as_number() {
            Some(_) => format_into(&mut self.result.borrow_mut()),
            // It can be long, and a result object keeps the memory that it has grown to.
            None => format_into(&mut FormattedNumber::open().or_type_error(failure)?),
        }
    }
}
