//! Compact notation, with patterns such as "0K" and "00 thousand". ICU4C: number_compact.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::memory::{Appendable, TryClone, try_concat, try_push, try_with_capacity};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::slice_ext::SliceExt;
use crate::common::uresimp::{ures_get_all_items_with_fallback, ures_open};
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::Field;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_modifiers::MiddleModifier;
use crate::i18n::number_patternmodifier::{ImmutablePatternModifier, PatternModifier};
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::number_rounding::{MultiplierProducer, RoundingImpl};
use crate::i18n::plurrule::PluralRules;
use crate::i18n::standardplural::{self, PluralForm};
use crate::i18n::unicode::unum::UNUM_COMPACT_FIELD;

const COMPACT_MAX_DIGITS: usize = 20;
const COMPACT_FIELD: Field = Field::number(UNUM_COMPACT_FIELD);
const ZERO: u16 = 0x30;

#[derive(Clone, Copy, PartialEq, Default)]
enum Entry {
    #[default]
    Missing,
    /// The pattern "0": use the non-compact pattern and ignore parent locales.
    UseFallback,
    /// Index into `CompactData::patterns`. It fits because each entry adds at most one pattern.
    Pattern(u8),
}

#[derive(Clone, Copy, Default)]
struct PowerOfTen {
    by_plural: [Entry; standardplural::COUNT],
    /// -3 for "00K"; 0 until a pattern determines it.
    multiplier: i8,
}

struct CompactData {
    by_magnitude: [PowerOfTen; COMPACT_MAX_DIGITS],
    /// UTF-16 strings as the bytes of a `U16s`.
    patterns: Vec<&'static [u8]>,
    largest_magnitude: usize,
    is_empty: bool,
}

impl CompactData {
    fn for_locale(
        locale: &Locale,
        ns_name: &[u8],
        is_long: bool,
        is_currency: bool,
    ) -> Result<Self, UErrorCode> {
        let bundle = ures_open(None, locale.get_name())?;
        let patterns = try_with_capacity(32)?;
        let mut data = Self {
            by_magnitude: Default::default(),
            patterns,
            largest_magnitude: 0,
            is_empty: true,
        };
        let styles: &[&[u8]] = if is_long {
            &[b"/patternsLong", b"/patternsShort"]
        } else {
            &[b"/patternsShort"]
        };
        let format: &[u8] = if is_currency {
            b"/currencyFormat"
        } else {
            b"/decimalFormat"
        };
        let ns_names: &[&[u8]] = if ns_name == b"latn" {
            &[b"latn"]
        } else {
            &[ns_name, b"latn"]
        };
        for style in styles {
            for ns_name in ns_names {
                let key = try_concat(&[b"NumberElements/", ns_name, style, format])?;
                // What was read before an error counts.
                _ = ures_get_all_items_with_fallback(&bundle, &key, &mut data);
                if !data.is_empty {
                    return Ok(data);
                }
            }
        }
        Err(U_INTERNAL_PROGRAM_ERROR)
    }

    fn power_of_ten(&self, magnitude: i32) -> Option<&PowerOfTen> {
        self.by_magnitude
            .get(usize::try_from(magnitude).ok()?.min(self.largest_magnitude))
    }

    /// Returns an index into `patterns`. `magnitude` is the magnitude before the multiplier was applied.
    fn get_pattern(
        &self,
        magnitude: i32,
        rules: &PluralRules,
        quantity: &DecimalQuantity,
    ) -> Option<usize> {
        let by_plural = &self.power_of_ten(magnitude)?.by_plural;
        let exact = [PluralForm::Eq0, PluralForm::Eq1].map(|form| by_plural.at(form.index()));
        let mut found = Entry::Missing;
        if exact != [Entry::Missing; 2] && quantity.has_integer_value() {
            let value = usize::try_from(quantity.to_long()).ok();
            found = value
                .and_then(|value| exact.get(value).copied())
                .unwrap_or(found);
        }
        if found == Entry::Missing {
            found = by_plural.at(rules.select(quantity).index());
        }
        if found == Entry::Missing {
            found = by_plural.at(PluralForm::Other.index());
        }
        if let Entry::Pattern(index) = found {
            Some(usize::from(index))
        } else {
            None
        }
    }

    /// Returns whether a magnitude with a multiplier may lack a compact pattern for some plural form.
    fn may_lack_pattern(&self) -> bool {
        self.by_magnitude.iter().any(
            |PowerOfTen {
                 by_plural,
                 multiplier,
             }| {
                *multiplier != 0
                    && (by_plural.contains(&Entry::UseFallback)
                        || by_plural.at(PluralForm::Other.index()) == Entry::Missing)
            },
        )
    }
}

impl MultiplierProducer for CompactData {
    fn get_multiplier(&self, magnitude: i32) -> i32 {
        self.power_of_ten(magnitude)
            .map_or(0, |power| i32::from(power.multiplier))
    }
}

/// Called for each bundle from the locale to root. Existing entries are not overwritten.
impl ResourceSink for CompactData {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        for (key, value) in value.get_table()?.iter() {
            // Keys have the form "10000". Eight bits of the length count.
            let magnitude = usize::from((key.len() as u8).wrapping_sub(1));
            let Some(power) = self.by_magnitude.get_mut(magnitude) else {
                continue;
            };
            let mut multiplier = power.multiplier;

            for (key, value) in value.get_table()?.iter() {
                let plural = PluralForm::from_keyword(key).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
                let plural = plural.index();
                if power.by_plural.at(plural) != Entry::Missing {
                    continue;
                }
                // The pattern ends at a NUL, but zeros are counted in the whole string.
                let pattern = value.get_string()?;
                if let (Some(ZERO), None | Some(0)) = (pattern.get(0), pattern.get(1)) {
                    power.by_plural.set(plural, Entry::UseFallback);
                    continue;
                }
                if multiplier == 0 {
                    let zeros = pattern
                        .iter()
                        .skip_while(|&c| c != ZERO)
                        .take_while(|&c| c == ZERO)
                        .count();
                    // Some patterns have no zeros, such as Italian "mille".
                    if zeros > 0 {
                        multiplier = zeros.wrapping_sub(magnitude + 1) as i8;
                    }
                }
                let index = self.patterns.len() as u8;
                try_push(&mut self.patterns, pattern.as_bytes())?;
                power.by_plural.set(plural, Entry::Pattern(index));
            }
            power.multiplier = multiplier;
            self.largest_magnitude = self.largest_magnitude.max(magnitude);
            self.is_empty = false;
        }
        Ok(())
    }
}

fn parse(pattern: &[u8]) -> Result<ParsedPatternInfo, UErrorCode> {
    ParsedPatternInfo::parse(U16s::of(pattern).until_nul().try_to_vec()?)
}

/// Scales and rounds a number, and supplies its compact pattern as the middle modifier.
pub(crate) struct CompactHandler {
    rules: PluralRules,
    data: CompactData,
    may_lack_pattern: bool,
    /// Parallel to `data.patterns` after `precompute_all_modifiers`, empty before.
    precomputed: Vec<ImmutablePatternModifier>,
}

impl CompactHandler {
    pub(crate) fn new(
        locale: &Locale,
        ns_name: &[u8],
        is_long: bool,
        is_currency: bool,
        rules: PluralRules,
    ) -> Result<Self, UErrorCode> {
        let data = CompactData::for_locale(locale, ns_name, is_long, is_currency)?;
        Ok(Self {
            rules,
            may_lack_pattern: data.may_lack_pattern(),
            data,
            precomputed: Vec::new(),
        })
    }

    /// Builds the modifiers of each distinct pattern. The handler must not be used after an error.
    pub(crate) fn precompute_all_modifiers(
        &mut self,
        builder: &PatternModifier,
    ) -> Result<(), UErrorCode> {
        let mut unique = try_with_capacity(self.data.patterns.len())?;
        for entry in self
            .data
            .by_magnitude
            .iter_mut()
            .flat_map(|power| &mut power.by_plural)
        {
            let Entry::Pattern(index) = entry else {
                continue;
            };
            let pattern = self.data.patterns.at(usize::from(*index));
            let known = unique.iter().rposition(|&known| known == pattern);
            *index = known.unwrap_or(unique.len()) as u8;
            if known.is_none() {
                try_push(
                    &mut self.precomputed,
                    builder.create_immutable((&parse(pattern)?, COMPACT_FIELD))?,
                )?;
                unique.add(pattern);
            }
        }
        self.data.patterns = unique;
        Ok(())
    }

    pub(crate) fn process_quantity(
        &self,
        quantity: &mut DecimalQuantity,
        rounder: &mut RoundingImpl,
        builder: &PatternModifier,
    ) -> Result<Option<MiddleModifier<'_>>, UErrorCode> {
        let original = if self.may_lack_pattern {
            Some(quantity.try_clone()?)
        } else {
            None
        };
        let mut multiplier = if quantity.is_zeroish() {
            rounder.apply(quantity).map(|()| 0)
        } else {
            rounder.choose_multiplier_and_apply(quantity, &self.data)
        }?;
        // Zero, NaN and infinity are treated as magnitude 0.
        let magnitude = if quantity.is_zeroish() {
            0
        } else {
            quantity.get_magnitude()
        }
        .wrapping_sub(multiplier);
        let mut modifier = None;
        if let Some(index) = self.data.get_pattern(magnitude, &self.rules, quantity) {
            modifier = Some(match self.precomputed.get(index) {
                Some(modifiers) => modifiers.modifier_for_quantity(builder, rounder, quantity),
                None => {
                    let pattern = (&parse(self.data.patterns.at(index))?, COMPACT_FIELD);
                    builder.create_one_shot(pattern, quantity.signum(), PluralForm::Other)
                }
            }?);
        } else if let Some(original) = original
            && multiplier != 0
            && self.data.get_multiplier(magnitude) == multiplier
            && !quantity.is_zeroish()
        {
            *quantity = original;
            multiplier = 0;
            rounder.apply(quantity)?;
        }
        // Must follow plural selection.
        quantity.adjust_exponent(-multiplier);
        rounder.rounding = None;
        Ok(modifier)
    }
}
