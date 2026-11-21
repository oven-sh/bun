//! A number formatter with given symbols. ICU4C: decimfmt.cpp, number_mapper.cpp

use crate::common::memory::{try_shared, try_to_vec};
use crate::common::sink::TextBuf;
use crate::common::slice_ext::SliceExt;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::number_fluent::{LocalizedNumberFormatter, MacroProps, UFormattedNumberData};
use crate::i18n::number_grouping::Grouper;
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::number_rounding::{Digits, Rounding};
use std::sync::Arc;

/// Formats an integer for the patterns "0" and "#,##0" without building a formatter.
#[derive(Clone, Copy)]
struct FastFormat {
    zero: u16,
    grouping_separator: Option<u16>,
}

impl FastFormat {
    fn new(pattern: &ParsedPatternInfo, symbols: &DecimalFormatSymbols) -> Option<Self> {
        if pattern.min_integer_digits != 1 || pattern.fraction_digits.min != 0 {
            return None;
        }
        let separator = symbols.get_const_symbol(Symbol::GroupingSeparator);
        Some(Self {
            zero: symbols.zero_unit()?,
            grouping_separator: match (pattern.group_sizes, separator) {
                (None, _) => None,
                (Some((3, 3)), &[separator]) => Some(separator),
                _ => return None,
            },
        })
    }

    fn format(self, mut number: u32, output: &mut dyn TextBuf) {
        // Ten digits and three separators.
        let (mut buffer, mut start) = ([0; 13], 13);
        for count in 0..10 {
            if let Some(separator) = self.grouping_separator
                && matches!(count, 3 | 6 | 9)
            {
                start -= 1;
                buffer.set(start, separator);
            }
            start -= 1;
            buffer.set(start, self.zero + (number % 10) as u16);
            number /= 10;
            if number == 0 {
                break;
            }
        }
        output.add_all(buffer.slice(start..));
    }
}

pub(crate) struct DecimalFormat {
    symbols: Arc<DecimalFormatSymbols>,
    pub(crate) formatter: LocalizedNumberFormatter,
    fast_format: Option<FastFormat>,
}

impl DecimalFormat {
    /// Shows up to three fraction digits and groups as the locale of `symbols` does.
    pub(crate) fn for_locale(symbols: DecimalFormatSymbols) -> Result<Self, UErrorCode> {
        let symbols = try_shared(symbols)?;
        let mut macros = MacroProps::new(symbols.get_locale().clone());
        macros.rounder.rounding = Some(Rounding::Fraction(Digits::new(0, 3)));
        macros.symbols = Some(Arc::clone(&symbols));
        Ok(Self {
            symbols,
            formatter: LocalizedNumberFormatter::new(macros),
            fast_format: None,
        })
    }

    /// `pattern` has at least one zero before the point, and no affixes.
    pub(crate) fn with_pattern(
        pattern: &[u16],
        symbols: &Arc<DecimalFormatSymbols>,
    ) -> Result<Self, UErrorCode> {
        let parsed = ParsedPatternInfo::parse(try_to_vec(pattern)?)?;
        if parsed.has_affixes() || parsed.min_integer_digits == 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let mut macros = MacroProps::new(symbols.get_locale().clone());
        macros.rounder.rounding = Some(Rounding::Fraction(parsed.fraction_digits));
        macros.min_integer_digits = parsed.min_integer_digits;
        macros.grouper = Grouper::AsInPattern;
        macros.symbols = Some(Arc::clone(symbols));
        macros.pattern = Some(try_to_vec(pattern)?);
        Ok(Self {
            symbols: Arc::clone(symbols),
            formatter: LocalizedNumberFormatter::new(macros),
            fast_format: FastFormat::new(&parsed, symbols),
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
        if let Some(fast_format) = self.fast_format
            && f64::from(number as u32).to_bits() == number.to_bits()
        {
            fast_format.format(number as u32, append_to);
            return Ok(());
        }
        let mut output = UFormattedNumberData::new();
        output.quantity.set_to_double(number);
        self.formatter.format(&mut output)?;
        append_to.add_all(output.text());
        Ok(())
    }
}
