//! A number formatter and its settings. ICU4C: number_fluent.cpp

use crate::common::locid::Locale;
use crate::common::memory::{get_or_try_init, try_box_result};
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::formatted_string_builder::UNDEFINED_FIELD;
use crate::i18n::formattedval_impl::FormattedValueStringBuilderImpl;
use crate::i18n::measunit::MeasureUnit;
use crate::i18n::number_decimalquantity::{DecimalQuantity, RoundingMode};
use crate::i18n::number_formatimpl::{BuildMode, NumberFormatterImpl};
use crate::i18n::number_grouping::Grouper;
use crate::i18n::number_rounding::{Digits, Rounding, RoundingImpl};
use crate::i18n::number_scientific::ScientificHandler;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

#[derive(Clone, Copy)]
pub(crate) enum Notation {
    Simple,
    Scientific(ScientificHandler),
    Compact { is_long: bool },
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum UnitWidth {
    Narrow,
    Short,
    FullName,
    IsoCode,
    Formal,
    Hidden,
}

#[derive(Clone, Copy)]
pub(crate) enum SignDisplay {
    Auto,
    Always,
    Never,
    ExceptZero,
    Negative,
}

pub(crate) struct MacroProps {
    pub(crate) locale: Locale,
    pub(crate) notation: Notation,
    pub(crate) unit: MeasureUnit,
    pub(crate) unit_width: UnitWidth,
    pub(crate) rounder: RoundingImpl,
    pub(crate) grouper: Grouper,
    pub(crate) min_integer_digits: i32,
    pub(crate) sign: SignDisplay,
    pub(crate) is_accounting: bool,
    /// The power of ten by which the number is multiplied.
    pub(crate) scale: i32,
    /// Replaces the symbols of `locale`.
    pub(crate) symbols: Option<Arc<DecimalFormatSymbols>>,
    /// Replaces the pattern of `locale`.
    pub(crate) pattern: Option<Vec<u16>>,
}

impl MacroProps {
    pub(crate) fn new(locale: Locale) -> Self {
        Self {
            locale,
            notation: Notation::Simple,
            unit: MeasureUnit::None,
            unit_width: UnitWidth::Short,
            rounder: RoundingImpl {
                rounding: Some(Rounding::Fraction(Digits::new(0, 6))),
                mode: RoundingMode::HalfEven,
                hide_zeros_if_whole: false,
            },
            grouper: Grouper::Auto,
            min_integer_digits: 1,
            sign: SignDisplay::Auto,
            is_accounting: false,
            scale: 0,
            symbols: None,
            pattern: None,
        }
    }
}

pub(crate) struct UFormattedNumberData {
    pub(crate) base: FormattedValueStringBuilderImpl,
    /// The input, and after formatting the scaled and rounded number.
    pub(crate) quantity: DecimalQuantity,
}

impl UFormattedNumberData {
    pub(crate) fn new() -> Self {
        Self {
            base: FormattedValueStringBuilderImpl::new(UNDEFINED_FIELD),
            quantity: DecimalQuantity::new(),
        }
    }

    pub(crate) fn text(&self) -> &[u16] {
        self.base.string().chars()
    }
}

/// The number of the call that builds the reusable formatter. Each earlier call builds a one-shot formatter.
const THRESHOLD: u32 = 3;

/// `None` if building it has failed.
type Compiled = Option<Box<NumberFormatterImpl>>;

pub(crate) struct LocalizedNumberFormatter {
    macros: MacroProps,
    compiled: OnceLock<Compiled>,
    call_count: AtomicU32,
}

impl LocalizedNumberFormatter {
    pub(crate) fn new(macros: MacroProps) -> Self {
        Self {
            macros,
            compiled: OnceLock::new(),
            call_count: AtomicU32::new(0),
        }
    }

    /// Formats `results.quantity` into the string of `results`, which must be empty.
    pub(crate) fn format(&self, results: &mut UFormattedNumberData) -> Result<(), UErrorCode> {
        let outcome = self.compute_compiled().and_then(|compiled| match compiled {
            Some(Some(formatter)) => formatter.format(results),
            Some(None) => Err(U_INTERNAL_PROGRAM_ERROR),
            None => self.format_static(results),
        });
        results.base.finish(outcome)
    }

    fn format_static(&self, results: &mut UFormattedNumberData) -> Result<(), UErrorCode> {
        NumberFormatterImpl::new(&self.macros, BuildMode::OneShot)?.format(results)
    }

    #[inline]
    fn compute_compiled(&self) -> Result<Option<&Compiled>, UErrorCode> {
        match self.compiled.get() {
            Some(compiled) => Ok(Some(compiled)),
            None if self.call_count.fetch_add(1, Ordering::Relaxed) < THRESHOLD - 1 => Ok(None),
            None => self.compile().map(Some),
        }
    }

    /// Caches any failure but that of an allocation. Only the call that builds returns the error code.
    #[cold]
    fn compile(&self) -> Result<&Compiled, UErrorCode> {
        let mut outcome = Ok(());
        let compiled = get_or_try_init(&self.compiled, || {
            let mut built = NumberFormatterImpl::new(&self.macros, BuildMode::Reusable);
            let built = try_box_result(&mut built);
            Ok(built.inspect_err(|&code| outcome = Err(code)).ok())
        })?;
        outcome.map(|()| compiled)
    }
}
