use core::ops::Deref;

use bun_engine_number::NumberText;
use smallvec::SmallVec;

use super::digit_options::{
    DigitOptions, DigitRange, RoundingIncrement, RoundingMode, RoundingType, TrailingZeroDisplay,
};
use super::options::{
    CompactDisplay, CurrencyDisplay, CurrencySign, Grouping, Notation, Options, SignDisplay,
    StyleOptions, UnitDisplay,
};

/// A number skeleton of ICU. What is the default there is left out.
#[derive(Default)]
pub(crate) struct Skeleton(SmallVec<[u16; 96]>);

impl Skeleton {
    pub(crate) fn push_stem(&mut self, stem: &str) {
        if !self.0.is_empty() {
            self.append(b" ");
        }
        self.append(stem.as_bytes());
    }

    /// Continues the last stem.
    pub(crate) fn append(&mut self, ascii: &[u8]) {
        self.0.extend(ascii.iter().map(|&byte| u16::from(byte)));
    }

    pub(crate) fn append_repeated(&mut self, ascii: u8, count: usize) {
        self.0.extend(core::iter::repeat_n(u16::from(ascii), count));
    }

    fn append_range(&mut self, required: u8, range: DigitRange) {
        self.append_repeated(required, range.minimum.into());
        self.append_repeated(b'#', range.maximum.saturating_sub(range.minimum).into());
    }

    fn push_style(&mut self, style: StyleOptions) {
        let width = match style {
            StyleOptions::Decimal => return,
            StyleOptions::Percent => return self.push_stem("percent scale/100"),
            StyleOptions::Currency {
                currency, display, ..
            } => {
                self.push_stem("currency/");
                self.append(&currency.code());
                match display {
                    CurrencyDisplay::Code => "unit-width-iso-code",
                    CurrencyDisplay::Symbol => return,
                    CurrencyDisplay::NarrowSymbol => "unit-width-narrow",
                    CurrencyDisplay::Name => "unit-width-full-name",
                }
            }
            StyleOptions::Unit { unit, display } => {
                self.push_stem("unit/");
                self.append(&unit.identifier());
                match display {
                    UnitDisplay::Short => return,
                    UnitDisplay::Narrow => "unit-width-narrow",
                    UnitDisplay::Long => "unit-width-full-name",
                }
            }
        };
        self.push_stem(width);
    }

    fn push_sign_display(&mut self, display: SignDisplay, style: StyleOptions) {
        let sign = match style {
            StyleOptions::Currency { sign, .. } => sign,
            _ => CurrencySign::Standard,
        };
        self.push_stem(match (sign, display) {
            (_, SignDisplay::Never) => "sign-never",
            (CurrencySign::Standard, SignDisplay::Auto) => return,
            (CurrencySign::Standard, SignDisplay::Always) => "sign-always",
            (CurrencySign::Standard, SignDisplay::ExceptZero) => "sign-except-zero",
            (CurrencySign::Standard, SignDisplay::Negative) => "sign-negative",
            (CurrencySign::Accounting, SignDisplay::Auto) => "sign-accounting",
            (CurrencySign::Accounting, SignDisplay::Always) => "sign-accounting-always",
            (CurrencySign::Accounting, SignDisplay::ExceptZero) => "sign-accounting-except-zero",
            (CurrencySign::Accounting, SignDisplay::Negative) => "sign-accounting-negative",
        });
    }

    fn push_grouping(&mut self, grouping: Option<Grouping>, notation: Notation) {
        self.push_stem(match grouping {
            Some(default) if default == Grouping::default_for(notation) => return,
            None => "group-off",
            Some(Grouping::Min2) => "group-min2",
            Some(Grouping::Auto) => "group-auto",
            Some(Grouping::Always) => "group-on-aligned",
        });
    }

    pub(crate) fn push_digit_options(&mut self, options: &DigitOptions) {
        self.push_stem(match options.rounding_mode {
            RoundingMode::Ceil => "rounding-mode-ceiling",
            RoundingMode::Floor => "rounding-mode-floor",
            RoundingMode::Expand => "rounding-mode-up",
            RoundingMode::Trunc => "rounding-mode-down",
            RoundingMode::HalfCeil => "rounding-mode-half-ceiling",
            RoundingMode::HalfFloor => "rounding-mode-half-floor",
            RoundingMode::HalfExpand => "rounding-mode-half-up",
            RoundingMode::HalfTrunc => "rounding-mode-half-down",
            RoundingMode::HalfEven => "rounding-mode-half-even",
        });
        let integer_digits = options.minimum_integer_digits.get();
        if integer_digits != 1 {
            self.push_stem("integer-width/*");
            self.append_repeated(b'0', integer_digits.into());
        }
        match options.rounding_type {
            RoundingType::FractionDigits(fraction)
                if options.rounding_increment != RoundingIncrement::default() =>
            {
                self.push_increment(options.rounding_increment, fraction.maximum.into());
            }
            RoundingType::FractionDigits(fraction) => {
                self.push_stem(".");
                self.append_range(b'0', fraction);
            }
            RoundingType::SignificantDigits(significant) => {
                self.push_stem("");
                self.append_range(b'@', significant);
            }
            RoundingType::MorePrecision {
                fraction,
                significant,
            } => self.push_both_ranges(fraction, significant, b"r"),
            RoundingType::LessPrecision {
                fraction,
                significant,
            } => self.push_both_ranges(fraction, significant, b"s"),
        }
        if options.trailing_zero_display == TrailingZeroDisplay::StripIfInteger {
            self.append(b"/w");
        }
    }

    fn push_both_ranges(&mut self, fraction: DigitRange, significant: DigitRange, priority: &[u8]) {
        self.push_stem(".");
        self.append_range(b'0', fraction);
        self.append(b"/");
        self.append_range(b'@', significant);
        self.append(priority);
    }

    /// In units of the last fraction digit.
    fn push_increment(&mut self, increment: RoundingIncrement, fraction_digits: usize) {
        let digits = NumberText::from(u32::from(increment.get()));
        let (integer, fraction) = digits.split_at(digits.len().saturating_sub(fraction_digits));
        self.push_stem("precision-increment/");
        self.append(if integer.is_empty() { b"0" } else { integer });
        self.append(b".");
        self.append_repeated(b'0', fraction_digits - fraction.len());
        self.append(fraction);
    }

    pub(crate) fn push_notation(&mut self, notation: Notation, compact_display: CompactDisplay) {
        self.push_stem(match (notation, compact_display) {
            (Notation::Standard, _) => return,
            (Notation::Scientific, _) => "scientific",
            (Notation::Engineering, _) => "engineering",
            (Notation::Compact, CompactDisplay::Short) => "compact-short",
            (Notation::Compact, CompactDisplay::Long) => "compact-long",
        });
    }
}

impl From<&Options> for Skeleton {
    fn from(options: &Options) -> Skeleton {
        let mut skeleton = Skeleton::default();
        skeleton.push_style(options.style);
        skeleton.push_digit_options(&options.digits);
        skeleton.push_notation(options.notation, options.compact_display);
        skeleton.push_sign_display(options.sign_display, options.style);
        skeleton.push_grouping(options.grouping, options.notation);
        skeleton
    }
}

impl Deref for Skeleton {
    type Target = [u16];

    fn deref(&self) -> &[u16] {
        &self.0
    }
}
