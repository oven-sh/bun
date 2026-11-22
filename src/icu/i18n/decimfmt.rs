//! A number formatter with given symbols. ICU4C: decimfmt.cpp

use crate::common::memory::{TryClone, try_shared};
use crate::common::sink::TextBuf;
use crate::common::slice_ext::SliceExt;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_decimfmtprops::DecimalFormatProperties;
use crate::i18n::number_fluent::{LocalizedNumberFormatter, MacroProps, UFormattedNumberData};
use crate::i18n::number_mapper::old_to_new;
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::number_rounding::{Digits, Rounding};
use std::sync::Arc;

/// Formats an integer for patterns such as "0" and "#,##0" without building a formatter.
#[derive(Clone, Copy)]
struct FastFormat {
    zero: u16,
    /// 0 if grouping is off.
    grouping_separator: u16,
    minus_sign: u16,
    min_int: u8,
    max_int: u8,
}

/// The digits of `i32::MAX`.
const MAX_FAST_DIGITS: i32 = 10;

impl FastFormat {
    fn new(properties: &DecimalFormatProperties, macros: &MacroProps) -> Option<Self> {
        let (symbols, from_pattern) = (macros.symbols.as_ref()?, macros.from_pattern.as_ref()?);
        if !properties.equals_default_except_fast_format()
            || !from_pattern.affixes.has_trivial_affixes()
            || from_pattern.affixes.currency_as_decimal
            || macros.min_integer_digits > MAX_FAST_DIGITS
            || !matches!(macros.rounder.rounding, Some(Rounding::Fraction(digits)) if digits.min <= 0)
        {
            return None;
        }
        let separator = symbols.get_const_symbol(Symbol::GroupingSeparator);
        let grouping = (properties.grouping_used, properties.grouping_size);
        let grouping_separator = match (grouping, separator) {
            ((true, 3), &[separator]) => separator,
            ((false, _), _) | ((true, ..=0), [_]) => 0,
            _ => return None,
        };
        let &[minus_sign] = symbols.get_const_symbol(Symbol::MinusSign) else {
            return None;
        };
        Some(Self {
            zero: symbols.zero_of_consecutive_digits()?,
            grouping_separator,
            minus_sign,
            min_int: macros.min_integer_digits.max(1) as u8,
            max_int: match from_pattern.layout.max_integer_digits {
                max @ 0..MAX_FAST_DIGITS => max,
                _ => MAX_FAST_DIGITS,
            } as u8,
        })
    }

    fn format(self, is_negative: bool, mut number: u32, output: &mut dyn TextBuf) {
        if is_negative {
            output.add(self.minus_sign);
        }
        // Ten digits and three separators.
        let (mut buffer, mut start) = ([0; 13], 13);
        for count in 0..self.max_int {
            if number == 0 && count >= self.min_int {
                break;
            }
            if self.grouping_separator != 0 && matches!(count, 3 | 6 | 9) {
                start -= 1;
                buffer.set(start, self.grouping_separator);
            }
            start -= 1;
            buffer.set(start, self.zero.wrapping_add((number % 10) as u16));
            number /= 10;
        }
        output.add_all(buffer.slice(start..));
    }
}

pub(crate) struct DecimalFormat {
    symbols: Arc<DecimalFormatSymbols>,
    properties: DecimalFormatProperties,
    pub(crate) formatter: LocalizedNumberFormatter,
    fast_format: Option<FastFormat>,
}

impl TryClone for DecimalFormat {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        self.changed(&|_| {})
    }
}

impl DecimalFormat {
    /// What `for_relative_times` makes of the pattern of any locale in the linked data.
    pub(crate) fn for_linked_locale(symbols: DecimalFormatSymbols) -> Result<Self, UErrorCode> {
        let symbols = try_shared(symbols)?;
        let mut macros = MacroProps::new(symbols.get_locale().clone());
        macros.rounder.rounding = Some(Rounding::Fraction(Digits::new(0, 3)));
        macros.symbols = Some(Arc::clone(&symbols));
        Ok(Self {
            symbols,
            properties: DecimalFormatProperties::default(),
            formatter: LocalizedNumberFormatter::new(macros),
            fast_format: None,
        })
    }

    pub(crate) fn with_pattern(
        pattern: Vec<u16>,
        symbols: &Arc<DecimalFormatSymbols>,
    ) -> Result<Self, UErrorCode> {
        let (affixes, properties) = ParsedPatternInfo::parse_to_properties(pattern)?;
        let (format, currency_status) = Self::new(affixes, &properties, symbols)?;
        currency_status.map(|()| format)
    }

    /// The format is usable even if the lookups for its currency have failed.
    fn new(
        affixes: ParsedPatternInfo,
        properties: &DecimalFormatProperties,
        symbols: &Arc<DecimalFormatSymbols>,
    ) -> Result<(Self, Result<(), UErrorCode>), UErrorCode> {
        let (macros, currency_status) = old_to_new(affixes, properties, symbols)?;
        let format = Self {
            symbols: Arc::clone(symbols),
            properties: *properties,
            fast_format: FastFormat::new(properties, &macros),
            formatter: LocalizedNumberFormatter::new(macros),
        };
        Ok((format, currency_status))
    }

    /// Fails for a format from `for_linked_locale`. The result counts its own calls.
    #[cold]
    fn changed(&self, change: &dyn Fn(&mut DecimalFormatProperties)) -> Result<Self, UErrorCode> {
        let affixes = self.formatter.affixes().ok_or(U_UNSUPPORTED_ERROR)?;
        let mut properties = self.properties;
        change(&mut properties);
        Ok(Self::new(affixes.try_clone()?, &properties, &self.symbols)?.0)
    }

    /// Shows up to three fraction digits and groups as the locale does.
    pub(crate) fn for_relative_times(&self) -> Result<Self, UErrorCode> {
        self.changed(&|properties| {
            properties.set_minimum_integer_digits(1);
            properties.set_minimum_fraction_digits(0);
            properties.set_maximum_fraction_digits(3);
            properties.grouping_used = true;
            properties.grouping_size = -2;
            properties.secondary_grouping_size = -2;
            properties.minimum_grouping_digits = -2;
        })
    }

    // ICU4C: smpdtfmt.cpp, fixNumberFormatForDates, zeroPaddingNumber
    pub(crate) fn for_dates(&self, min_int: i32, max_int: i32) -> Result<Self, UErrorCode> {
        self.changed(&|properties| {
            properties.grouping_used = false;
            properties.decimal_separator_always_shown = false;
            properties.set_minimum_fraction_digits(0);
            properties.set_minimum_integer_digits(min_int);
            properties.set_maximum_integer_digits(max_int);
        })
    }

    pub(crate) fn get_decimal_format_symbols(&self) -> &Arc<DecimalFormatSymbols> {
        &self.symbols
    }

    pub(crate) fn format_double(
        &self,
        number: f64,
        append_to: &mut dyn TextBuf,
    ) -> Result<(), UErrorCode> {
        let integer = number.abs() as i32;
        if let Some(fast_format) = self.fast_format
            && f64::from(integer) == number.abs()
        {
            fast_format.format(number.is_sign_negative(), integer.unsigned_abs(), append_to);
            return Ok(());
        }
        let mut output = UFormattedNumberData::new();
        output.quantity.set_to_double(number);
        self.append(output, append_to)
    }

    pub(crate) fn format_int64(
        &self,
        number: i64,
        append_to: &mut dyn TextBuf,
    ) -> Result<(), UErrorCode> {
        if let Some(fast_format) = self.fast_format
            && let Ok(integer) = i32::try_from(number.unsigned_abs())
        {
            fast_format.format(number < 0, integer.unsigned_abs(), append_to);
            return Ok(());
        }
        let mut output = UFormattedNumberData::new();
        output.quantity = DecimalQuantity::from_long(number);
        self.append(output, append_to)
    }

    /// Formats `output.quantity`, and appends the text even after a failure.
    fn append(
        &self,
        mut output: UFormattedNumberData,
        append_to: &mut dyn TextBuf,
    ) -> Result<(), UErrorCode> {
        let outcome = self.formatter.format(&mut output);
        append_to.add_all(output.text());
        outcome
    }
}
