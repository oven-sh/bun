//! The numbers in a date. ICU4C: smpdtfmt.cpp, SimpleDateFormat::zeroPaddingNumber

use crate::common::locid::Locale;
use crate::common::memory::{TryClone, try_shared_result};
use crate::common::sink::TextBuf;
use crate::common::slice_ext::{SliceExt, to_int32};
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::decimfmt::DecimalFormat;
use crate::i18n::formatted_string_builder::FormattedStringBuilder;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::number_simple::SimpleNumberFormatter;
use crate::i18n::numfmt::NumberFormat;
use std::num::NonZero;
use std::sync::Arc;

pub(crate) struct SimpleNumbers {
    formatter: SimpleNumberFormatter,
    /// The digit zero, if the ten digits are consecutive code units and non-negative numbers have no affixes.
    zero: Option<u16>,
}

impl SimpleNumbers {
    fn new(locale: &Locale, symbols: &Arc<DecimalFormatSymbols>) -> Result<Self, UErrorCode> {
        let formatter = SimpleNumberFormatter::new(locale, Arc::clone(symbols))?;
        Ok(Self {
            zero: symbols.zero_unit().filter(|_| formatter.has_bare_digits()),
            formatter,
        })
    }

    fn format(&self, out: &mut dyn TextBuf, value: i32, min_digits: usize, max_digits: usize) {
        if let (Some(zero), Ok(value)) = (self.zero, u32::try_from(value)) {
            return write_digits(out, zero, value, min_digits, max_digits);
        }
        let (min, max) = (to_int32(min_digits), to_int32(max_digits));
        let mut text = FormattedStringBuilder::new();
        if self.formatter.write(value, min, max, &mut text).is_ok() {
            out.add_all(text.chars());
        }
    }
}

/// Fast path: appends the digits that `SimpleNumberFormatter` would produce.
fn write_digits(
    out: &mut dyn TextBuf,
    zero: u16,
    mut value: u32,
    min_digits: usize,
    max_digits: usize,
) {
    const TEN: NonZero<u32> = NonZero::<u32>::MIN.saturating_add(9);
    let (mut units, mut count) = ([0; 10], 0);
    if max_digits < units.len() {
        value %= TEN.saturating_pow(max_digits as u32);
    }
    let min_digits = min_digits.min(max_digits);
    for unit in units.iter_mut().rev() {
        if value == 0 && count >= min_digits {
            break;
        }
        *unit = zero + (value % 10) as u16;
        value /= 10;
        count += 1;
    }
    match *units.slice(units.len() - count..) {
        [unit] => out.add(unit),
        ref all => out.add_all(all),
    }
}

#[derive(Clone)]
pub(crate) enum DateNumberFormat {
    Decimal(Arc<SimpleNumbers>),
    /// Rules, or the format of a single field.
    Other(Arc<NumberFormat>),
}

impl DateNumberFormat {
    pub(crate) fn for_locale(locale: &Locale) -> Result<Self, UErrorCode> {
        static CACHE: LocaleCache<SimpleNumbers, 100> = LocaleCache::new();
        let format = NumberFormat::create_shared_instance(locale)?;
        match &*format {
            NumberFormat::Decimal(decimal) => {
                let symbols = decimal.get_decimal_format_symbols();
                let create = || try_shared_result(&mut SimpleNumbers::new(locale, symbols));
                CACHE
                    .get_or_try_insert_with(locale.get_name(), create)
                    .map(Self::Decimal)
            }
            NumberFormat::RuleBased(_) => Self::for_one_user(&format),
        }
    }

    pub(crate) fn for_field(locale: &Locale) -> Result<Self, UErrorCode> {
        Self::for_one_user(&NumberFormat::create_shared_instance(locale)?)
    }

    fn for_one_user(format: &Arc<NumberFormat>) -> Result<Self, UErrorCode> {
        NumberFormat::for_one_user(format, DecimalFormat::try_clone).map(Self::Other)
    }

    /// A clone shares the state of rules. This copy has its own.
    pub(crate) fn for_another_user(&self) -> Result<Self, UErrorCode> {
        match self {
            Self::Decimal(numbers) => Ok(Self::Decimal(Arc::clone(numbers))),
            Self::Other(format) => Self::for_one_user(format),
        }
    }

    /// Pads `value` to `min_digits` and appends its last `max_digits` digits. Rules ignore both.
    pub(crate) fn format(
        &self,
        out: &mut dyn TextBuf,
        value: i32,
        min_digits: usize,
        max_digits: usize,
    ) -> Result<(), UErrorCode> {
        match self {
            Self::Decimal(numbers) => numbers.format(out, value, min_digits, max_digits),
            Self::Other(format) => match &**format {
                NumberFormat::RuleBased(rules) => rules.format_int64(value.into(), out)?,
                NumberFormat::Decimal(decimal) => {
                    let copy = decimal.for_dates(to_int32(min_digits), to_int32(max_digits))?;
                    _ = copy.format_int64(value.into(), out);
                }
            },
        }
        Ok(())
    }
}
