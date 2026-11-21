//! Modifiers add text around the digits of a number. ICU4C: number_modifiers.cpp

use crate::common::memory::try_box;
use crate::common::simpleformatter::{ARG_NUM_LIMIT, SimpleFormatter};
use crate::common::uchar::u_char_type;
use crate::common::unicode::uchar::{U_GC_ND_MASK, U_GC_S_MASK, U_GC_Z_MASK};
use crate::common::unistr::{SmallUString, UStr};
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::number_decimalquantity::Signum;
use crate::i18n::standardplural::{self, PluralForm};
use crate::i18n::unicode::unum::UNUM_CURRENCY_FIELD;
use std::ops::Deref;
use std::ptr;

const CURRENCY_FIELD: Field = Field::number(UNUM_CURRENCY_FIELD);

pub(crate) trait Modifier {
    /// Applies the modifier to `output[left..right]`. Returns the new end, which can be less than `right`.
    fn apply(&self, output: &mut FormattedStringBuilder, left: usize, right: usize) -> usize;
}

/// The text before and after the argument of a pattern such as "{0} meters".
pub(crate) struct SimpleModifier {
    formatter: SimpleFormatter,
    field: Field,
    prefix_length: u16,
    suffix_length: u16,
}

impl SimpleModifier {
    /// Requires an argument limit of at most 1.
    pub(crate) fn new(formatter: SimpleFormatter, field: Field) -> Self {
        let pattern = formatter.compiled_pattern();
        let text_length = |unit: u16| unit.saturating_sub(ARG_NUM_LIMIT as u16);
        let prefix_length = text_length(pattern.char_at(1));
        let suffix_length = pattern
            .get(Self::suffix_offset(prefix_length))
            .copied()
            .map_or(0, text_length);
        Self {
            formatter,
            field,
            prefix_length,
            suffix_length,
        }
    }

    /// Returns the index of the suffix length in the compiled pattern.
    fn suffix_offset(prefix_length: u16) -> usize {
        if prefix_length > 0 {
            3 + usize::from(prefix_length)
        } else {
            2
        }
    }

    pub(crate) fn prefix(&self) -> &[u16] {
        self.formatter
            .compiled_pattern()
            .temp_sub_string(2, self.prefix_length.into())
    }

    fn suffix(&self) -> &[u16] {
        let start = Self::suffix_offset(self.prefix_length) + 1;
        self.formatter
            .compiled_pattern()
            .temp_sub_string(start, self.suffix_length.into())
    }
}

/// A pattern without an argument replaces the range.
impl Modifier for SimpleModifier {
    fn apply(&self, output: &mut FormattedStringBuilder, left: usize, right: usize) -> usize {
        if self.formatter.get_argument_limit() == 0 {
            output.remove(left, right);
            return left + output.insert(left, self.prefix(), self.field);
        }
        let right = right + output.insert(left, self.prefix(), self.field);
        right + output.insert(right, self.suffix(), self.field)
    }
}

/// The name of a unit or currency for each plural form.
pub(crate) type PluralModifiers = [SimpleModifier; standardplural::COUNT];

#[derive(Clone, Copy)]
pub(crate) struct OuterModifier<'a> {
    pub(crate) by_plural: &'a PluralModifiers,
    pub(crate) plural: PluralForm,
}

impl<'a> OuterModifier<'a> {
    pub(crate) fn get(&self) -> Option<&'a SimpleModifier> {
        self.by_plural.get(self.plural.index())
    }
}

impl Modifier for Option<OuterModifier<'_>> {
    fn apply(&self, output: &mut FormattedStringBuilder, left: usize, right: usize) -> usize {
        let modifier = self.as_ref().and_then(OuterModifier::get);
        modifier.map_or(right, |modifier| modifier.apply(output, left, right))
    }
}

fn is_in_categories(c: u32, mask: i32) -> bool {
    (1 << u_char_type(c)) & mask != 0
}

/// The text to insert between a currency symbol and a digit.
struct CurrencySpacing(SmallUString);

impl CurrencySpacing {
    /// Takes the code point of the affix that is adjacent to the number, and its field.
    fn new(
        adjacent: Option<(u32, &Field)>,
        symbols: &DecimalFormatSymbols,
        is_suffix: bool,
    ) -> Result<Option<Self>, UErrorCode> {
        let Some((c, &CURRENCY_FIELD)) = adjacent else {
            return Ok(None);
        };
        if is_in_categories(c, U_GC_S_MASK | U_GC_Z_MASK) {
            return Ok(None);
        }
        let mut text = SmallUString::new();
        text.set(symbols.currency_spacing(is_suffix))
            .map(|()| Some(Self(text)))
    }

    fn text_next_to(&self, adjacent: Option<u32>) -> &[u16] {
        if adjacent.is_some_and(|c| is_in_categories(c, U_GC_ND_MASK)) {
            &self.0
        } else {
            &[]
        }
    }
}

/// The affixes of a number pattern, with the symbols filled in.
pub(crate) struct ConstantMultiFieldModifier {
    pub(crate) prefix: FormattedStringBuilder,
    pub(crate) suffix: FormattedStringBuilder,
    /// Whether the pattern has no number body, so that the affixes replace the number.
    pub(crate) overwrite: bool,
    after_prefix: Option<CurrencySpacing>,
    before_suffix: Option<CurrencySpacing>,
}

impl ConstantMultiFieldModifier {
    pub(crate) fn new() -> Self {
        Self {
            prefix: FormattedStringBuilder::new(),
            suffix: FormattedStringBuilder::new(),
            overwrite: false,
            after_prefix: None,
            before_suffix: None,
        }
    }

    pub(crate) fn enable_currency_spacing(
        &mut self,
        symbols: &DecimalFormatSymbols,
    ) -> Result<(), UErrorCode> {
        let last = self
            .prefix
            .last_code_point()
            .zip(self.prefix.fields().last());
        let first = self
            .suffix
            .first_code_point()
            .zip(self.suffix.fields().first());
        self.after_prefix = CurrencySpacing::new(last, symbols, false)?;
        self.before_suffix = CurrencySpacing::new(first, symbols, true)?;
        Ok(())
    }

    /// Returns the length of the spacing that `apply` inserts between the prefix and a number that starts at `left`.
    pub(crate) fn spacing_after_prefix(
        &self,
        output: &FormattedStringBuilder,
        left: usize,
    ) -> usize {
        let spacing = self.after_prefix.as_ref().filter(|_| !self.overwrite);
        spacing.map_or(0, |spacing| {
            spacing.text_next_to(output.code_point_at(left)).len()
        })
    }

    pub(crate) fn code_point_count(&self) -> usize {
        self.prefix.code_point_count() + self.suffix.code_point_count()
    }

    pub(crate) fn strict_equals(&self, other: &Self) -> bool {
        ptr::eq(self, other)
            || self.prefix.content_equals(&other.prefix)
                && self.suffix.content_equals(&other.suffix)
                && self.overwrite == other.overwrite
    }
}

impl Modifier for ConstantMultiFieldModifier {
    fn apply(&self, output: &mut FormattedStringBuilder, left: usize, mut right: usize) -> usize {
        if right > left && !self.overwrite {
            if let Some(spacing) = &self.after_prefix {
                right += output.insert(
                    left,
                    spacing.text_next_to(output.code_point_at(left)),
                    UNDEFINED_FIELD,
                );
            }
            if let Some(spacing) = &self.before_suffix {
                right += output.insert(
                    right,
                    spacing.text_next_to(output.code_point_before(right)),
                    UNDEFINED_FIELD,
                );
            }
        }
        let prefix_length = output.insert_builder(left, &self.prefix);
        right += prefix_length;
        if self.overwrite {
            output.remove(left + prefix_length, right);
            right = left + prefix_length;
        }
        right + output.insert_builder(right, &self.suffix)
    }
}

/// The affixes for one number: precomputed by the formatter, or built for this number.
pub(crate) enum MiddleModifier<'a> {
    Borrowed(&'a ConstantMultiFieldModifier),
    Owned(Box<ConstantMultiFieldModifier>),
}

impl Deref for MiddleModifier<'_> {
    type Target = ConstantMultiFieldModifier;

    fn deref(&self) -> &Self::Target {
        match self {
            Self::Borrowed(modifier) => modifier,
            Self::Owned(modifier) => modifier,
        }
    }
}

pub(crate) struct AdoptingSignumModifierStore(Box<[ConstantMultiFieldModifier; 4]>);

impl AdoptingSignumModifierStore {
    pub(crate) fn new(
        fill: impl Fn(&mut ConstantMultiFieldModifier, Signum) -> Result<(), UErrorCode>,
    ) -> Result<Self, UErrorCode> {
        let mut modifiers = try_box([(); 4].map(|()| ConstantMultiFieldModifier::new()))?;
        for (modifier, signum) in
            modifiers
                .iter_mut()
                .zip([Signum::Pos, Signum::NegZero, Signum::PosZero, Signum::Neg])
        {
            fill(modifier, signum)?;
        }
        Ok(Self(modifiers))
    }

    pub(crate) fn get(&self, signum: Signum) -> &ConstantMultiFieldModifier {
        let [pos, neg_zero, pos_zero, neg] = &*self.0;
        match signum {
            Signum::Pos => pos,
            Signum::NegZero => neg_zero,
            Signum::PosZero => pos_zero,
            Signum::Neg => neg,
        }
    }
}
