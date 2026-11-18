//! Writes numbers without ICU, from what it wrote for a few samples.

use bun_engine_text::{CodeUnit, StringRef, StringWriter, Text};
use bun_icu::Buffer;
use smallvec::SmallVec;

use super::digits::Digits;
use super::{
    CurrencyDisplay, Notation, Options, RoundingPriority, RoundingType, StyleOptions,
    TrailingZeroDisplay,
};
use crate::{PartKind, Parts, Result};

#[derive(Default)]
struct Affixes {
    prefix: Buffer<u16>,
    suffix: Buffer<u16>,
}

struct Groups {
    separator: u16,
    /// Of the last group.
    primary_size: usize,
    secondary_size: usize,
    /// An integer part with fewer digits has no groups.
    minimum_digits: usize,
}

/// Of a format in which the text around the digits depends on nothing but the sign.
pub(super) struct Layout {
    options: Options,
    negative: Affixes,
    negative_zero: Affixes,
    zero: Affixes,
    positive: Affixes,
    /// By the low bits of the ASCII digit.
    digits: [u16; 16],
    decimal_separator: u16,
    groups: Option<Groups>,
    is_latin1: bool,
}

struct Sample {
    affixes: Affixes,
    /// From the first to the last.
    group_sizes: SmallVec<[usize; 8]>,
    last_integer_unit: u16,
    group_separator: Option<u16>,
    decimal_separator: Option<u16>,
}

impl Sample {
    fn new(parts: &Parts) -> Option<Sample> {
        let mut sample = Sample {
            affixes: Affixes::default(),
            group_sizes: SmallVec::new(),
            last_integer_unit: 0,
            group_separator: None,
            decimal_separator: None,
        };
        for (part, value) in parts.slices() {
            match (part.kind, value) {
                (PartKind::Integer, &[.., last]) => {
                    sample.group_sizes.push(value.len());
                    sample.last_integer_unit = last;
                }
                (PartKind::Group, &[separator]) => sample.group_separator = Some(separator),
                (PartKind::Decimal, &[separator]) => sample.decimal_separator = Some(separator),
                (PartKind::Group | PartKind::Decimal, _) => return None,
                (PartKind::Fraction, _) => {}
                _ if sample.group_sizes.is_empty() => {
                    sample.affixes.prefix.extend_from_slice(value);
                }
                _ => sample.affixes.suffix.extend_from_slice(value),
            }
        }
        Some(sample)
    }
}

fn scale(options: &Options) -> i32 {
    match options.style {
        StyleOptions::Percent => 2,
        _ => 0,
    }
}

impl Layout {
    /// `None` if the format is not of this kind.
    pub(super) fn learn(
        options: &Options,
        format: impl Fn(f64) -> Option<Parts>,
    ) -> Option<Layout> {
        const CHECKS: [f64; 5] = [1234567.891, -98765432109.5, 0.000123, -0.0001, 1005.0];

        let has_plurals = match options.style {
            StyleOptions::Decimal | StyleOptions::Percent => false,
            StyleOptions::Currency { display, .. } => display == CurrencyDisplay::Name,
            StyleOptions::Unit { .. } => true,
        };
        if has_plurals
            || options.notation != Notation::Standard
            || options.digits.rounding_increment.get() != 1
            || options.digits.rounding_type.priority() != RoundingPriority::Auto
        {
            return None;
        }
        let divisor = 10f64.powi(scale(options));
        let sample = |shown: f64| Sample::new(&format(shown / divisor)?);

        let mut digits = [0; 16];
        for (digit, value) in digits.iter_mut().zip(0..10) {
            *digit = sample(value.into())?.last_integer_unit;
        }
        let mut layout = Layout {
            options: *options,
            negative: sample(-1.0)?.affixes,
            negative_zero: sample(-0.0)?.affixes,
            zero: sample(0.0)?.affixes,
            positive: sample(1.0)?.affixes,
            digits,
            // A format that does not show it here never does.
            decimal_separator: sample(0.5)?.decimal_separator.unwrap_or_default(),
            groups: Groups::learn(sample),
            is_latin1: false,
        };
        layout.is_latin1 = layout.fits_latin1();
        let agrees = |number| {
            Some(layout.format(number)?.ok()?.text() == Text::Utf16(format(number)?.text()))
        };
        (CHECKS.into_iter())
            .all(|number| agrees(number) == Some(true))
            .then_some(layout)
    }

    /// `None` for a number that is left to ICU.
    pub(super) fn format(&self, number: f64) -> Option<Result<StringRef>> {
        /// More than the options allow.
        const MAX_PLACES: usize = 128;

        let options = &self.options.digits;
        let is_negative = number.is_sign_negative();
        let mut digits = Digits::new(number.abs())?;
        digits.multiply_by_power_of_ten(scale(&self.options));

        let mut minimum_fraction = match options.rounding_type {
            RoundingType::FractionDigits(range) => {
                let magnitude = -i32::from(range.maximum);
                digits.round(magnitude, options.rounding_mode, is_negative);
                i32::from(range.minimum)
            }
            RoundingType::SignificantDigits(range) => {
                let magnitude = digits.point() - i32::from(range.maximum);
                digits.round(magnitude, options.rounding_mode, is_negative);
                i32::from(range.minimum) - digits.point()
            }
            RoundingType::MorePrecision { .. } | RoundingType::LessPrecision { .. } => return None,
        };
        if options.trailing_zero_display == TrailingZeroDisplay::StripIfInteger
            && digits.fraction_length() == 0
        {
            minimum_fraction = 0;
        }
        let integer_length = (digits.point()).max(options.minimum_integer_digits.get().into());
        let fraction_length = digits.fraction_length().max(minimum_fraction);
        let mut places = [b'0'; MAX_PLACES];
        let places = places.get_mut(..(integer_length + fraction_length) as usize)?;
        digits.place(places, integer_length)?;
        let (integer, fraction) = places.split_at(integer_length as usize);
        let affixes = match (is_negative, digits.is_zero()) {
            (true, false) => &self.negative,
            (true, true) => &self.negative_zero,
            (false, true) => &self.zero,
            (false, false) => &self.positive,
        };

        Some(if self.is_latin1 {
            self.write::<u8>(affixes, integer, fraction)
        } else {
            self.write::<u16>(affixes, integer, fraction)
        })
    }

    fn write<T: CodeUnit>(
        &self,
        affixes: &Affixes,
        integer: &[u8],
        fraction: &[u8],
    ) -> Result<StringRef> {
        let groups = (self.groups.as_ref()).filter(|it| integer.len() >= it.minimum_digits);
        let (mut group_size, mut group_separators) = (integer.len(), 0);
        if let Some(groups) = groups {
            (group_size, group_separators) = (group_size - groups.primary_size, 1);
            while group_size > groups.secondary_size {
                group_size -= groups.secondary_size;
                group_separators += 1;
            }
        }
        let separators = group_separators + usize::from(!fraction.is_empty());
        let mut out = StringWriter::<T>::try_new(
            affixes.prefix.len()
                + integer.len()
                + fraction.len()
                + separators
                + affixes.suffix.len(),
        )?;

        let digit = |ascii: u8| T::from_u16_truncating(self.digits[usize::from(ascii & 0xf)]);
        out.push_mapped(&affixes.prefix, T::from_u16_truncating);
        let mut rest = integer;
        if let Some(groups) = groups {
            for _ in 0..group_separators {
                let group;
                (group, rest) = rest.split_at(group_size);
                out.push_mapped(group, digit);
                out.push(T::from_u16_truncating(groups.separator));
                group_size = groups.secondary_size;
            }
        }
        out.push_mapped(rest, digit);
        if !fraction.is_empty() {
            out.push(T::from_u16_truncating(self.decimal_separator));
            out.push_mapped(fraction, digit);
        }
        out.push_mapped(&affixes.suffix, T::from_u16_truncating);
        Ok(out.finish())
    }

    fn fits_latin1(&self) -> bool {
        let group_separator = self.groups.as_ref().map_or(0, |it| it.separator);
        let affixes = [
            &self.negative,
            &self.negative_zero,
            &self.zero,
            &self.positive,
        ];
        (affixes.iter().flat_map(|it| [&it.prefix[..], &it.suffix]))
            .chain([&self.digits[..], &[self.decimal_separator, group_separator]])
            .all(|units| Text::Utf16(units).fits_latin1())
    }
}

impl Groups {
    fn learn(sample: impl Fn(f64) -> Option<Sample>) -> Option<Groups> {
        let long = sample(1e15)?;
        let &[.., secondary_size, primary_size] = &*long.group_sizes else {
            return None;
        };
        let first_with_groups = (primary_size..15)
            .filter_map(|exponent| sample(10f64.powi(exponent as i32)))
            .find(|it| it.group_separator.is_some())?;
        Some(Groups {
            separator: long.group_separator?,
            primary_size,
            secondary_size,
            minimum_digits: (primary_size + 1).max(first_with_groups.group_sizes.iter().sum()),
        })
    }
}
