//! The affixes of a number pattern with the symbols of the locale. ICU4C: number_patternmodifier.cpp

use crate::common::memory::{try_box, try_collect_results, try_to_vec};
use crate::common::ucurr::{CurrencyName, ucurr_get_name, ucurr_get_plural_name};
use crate::common::unicode::ucurr::*;
use crate::common::utypes::UErrorCode;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder};
use crate::i18n::measunit::CurrencyCode;
use crate::i18n::number_affixutils::{AffixToken, tokens};
use crate::i18n::number_decimalquantity::{DecimalQuantity, Signum};
use crate::i18n::number_fluent::{SignDisplay, UnitWidth};
use crate::i18n::number_modifiers::{
    AdoptingSignumModifierStore, ConstantMultiFieldModifier, MiddleModifier,
};
use crate::i18n::number_patternstring::{ParsedPatternInfo, PatternSignType};
use crate::i18n::number_rounding::RoundingImpl;
use crate::i18n::plurrule::PluralRules;
use crate::i18n::standardplural::PluralForm;
use crate::i18n::unicode::unum::UNUM_CURRENCY_FIELD;
use std::sync::Arc;

/// A pattern and the field of its literal text.
pub(crate) type Pattern<'a> = (&'a ParsedPatternInfo, Field);

pub(crate) struct PatternModifier {
    pub(crate) sign_display: SignDisplay,
    pub(crate) approximately: bool,
    pub(crate) per_mille_replaces_percent: bool,
    pub(crate) symbols: Arc<DecimalFormatSymbols>,
    pub(crate) currency: CurrencyCode,
    pub(crate) unit_width: UnitWidth,
    /// `Some` if the formatter's own pattern needs plurals.
    pub(crate) rules: Option<Box<PluralRules>>,
}

/// The modifiers of a pattern for each signum and plural form.
pub(crate) struct ImmutablePatternModifier {
    /// Empty unless the pattern needs plurals.
    zero_to_many: Vec<AdoptingSignumModifierStore>,
    other: AdoptingSignumModifierStore,
}

impl ImmutablePatternModifier {
    #[inline]
    pub(crate) fn modifier_for_quantity(
        &self,
        builder: &PatternModifier,
        rounder: &RoundingImpl,
        quantity: &DecimalQuantity,
    ) -> Result<MiddleModifier<'_>, UErrorCode> {
        let store = if self.zero_to_many.is_empty() {
            &self.other
        } else {
            self.store_for_plural(builder, rounder, quantity)?
        };
        Ok(MiddleModifier::Borrowed(store.get(quantity.signum())))
    }

    #[cold]
    fn store_for_plural(
        &self,
        builder: &PatternModifier,
        rounder: &RoundingImpl,
        quantity: &DecimalQuantity,
    ) -> Result<&AdoptingSignumModifierStore, UErrorCode> {
        let plural = builder.plural_form(rounder, quantity)?;
        Ok(self.zero_to_many.get(plural.index()).unwrap_or(&self.other))
    }
}

impl PatternModifier {
    pub(crate) fn create_immutable_for_plural(
        &self,
        pattern: Pattern,
        plural: PluralForm,
    ) -> Result<AdoptingSignumModifierStore, UErrorCode> {
        AdoptingSignumModifierStore::new(|modifier, signum| {
            self.render(modifier, pattern, signum, plural)
        })
    }

    pub(crate) fn create_immutable(
        &self,
        pattern: Pattern,
    ) -> Result<ImmutablePatternModifier, UErrorCode> {
        let create = |plural| self.create_immutable_for_plural(pattern, plural);
        let mut zero_to_many = Vec::new();
        if pattern.0.needs_plurals {
            let forms = PluralForm::ALL.into_iter();
            zero_to_many = try_collect_results(forms.take(PluralForm::Other.index()).map(create))?;
        }
        Ok(ImmutablePatternModifier {
            zero_to_many,
            other: create(PluralForm::Other)?,
        })
    }

    pub(crate) fn create_one_shot(
        &self,
        pattern: Pattern,
        signum: Signum,
        plural: PluralForm,
    ) -> Result<MiddleModifier<'static>, UErrorCode> {
        let mut modifier = try_box(ConstantMultiFieldModifier::new())?;
        self.render(&mut modifier, pattern, signum, plural)?;
        Ok(MiddleModifier::Owned(modifier))
    }

    #[inline]
    pub(crate) fn plural_form(
        &self,
        rounder: &RoundingImpl,
        quantity: &DecimalQuantity,
    ) -> Result<PluralForm, UErrorCode> {
        match &self.rules {
            Some(rules) => rounder.get_plural_safe(rules, quantity),
            None => Ok(PluralForm::Other),
        }
    }

    fn sign_type(&self, signum: Signum) -> PatternSignType {
        use PatternSignType::*;
        let (neg, neg_zero, pos_zero, pos) = match self.sign_display {
            SignDisplay::Auto => (Neg, Neg, Pos, Pos),
            SignDisplay::Always => (Neg, Neg, PosSign, PosSign),
            SignDisplay::Never => (Pos, Pos, Pos, Pos),
            SignDisplay::ExceptZero => (Neg, Pos, Pos, PosSign),
            SignDisplay::Negative => (Neg, Pos, Pos, Pos),
        };
        match signum {
            Signum::Neg => neg,
            Signum::NegZero => neg_zero,
            Signum::PosZero => pos_zero,
            Signum::Pos => pos,
        }
    }

    fn render(
        &self,
        modifier: &mut ConstantMultiFieldModifier,
        (pattern, field): Pattern,
        signum: Signum,
        plural: PluralForm,
    ) -> Result<(), UErrorCode> {
        modifier.overwrite = !pattern.has_body;
        let (sign_type, mut affix) = (self.sign_type(signum), Vec::new());
        for (is_prefix, output) in [(true, &mut modifier.prefix), (false, &mut modifier.suffix)] {
            pattern.write_affix(
                is_prefix,
                sign_type,
                self.approximately,
                self.per_mille_replaces_percent,
                &mut affix,
            );
            self.unescape(&affix, output, field, plural);
            output.outcome()?;
        }
        if pattern.has_currency_sign {
            modifier.enable_currency_spacing(&self.symbols)?;
        }
        Ok(())
    }

    /// `field` is that of literal text. ICU4C: number_affixutils.cpp, AffixUtils::unescape
    fn unescape(
        &self,
        affix: &[u16],
        output: &mut FormattedStringBuilder,
        field: Field,
        plural: PluralForm,
    ) {
        for token in tokens(affix) {
            match token {
                AffixToken::CodePoint(c) => _ = output.insert_code_point(output.len(), c, field),
                AffixToken::Symbol(symbol, field) => {
                    output.add_all(self.symbols.get_const_symbol(symbol), Field::number(field))
                }
                AffixToken::Currency(count) => {
                    let text = match count {
                        1 => self.currency_symbol(),
                        _ => self.rare_currency_text(count, plural),
                    };
                    let field = Field::number(UNUM_CURRENCY_FIELD);
                    output.add_all(&text.unwrap_or_default(), field);
                }
            }
        }
    }

    pub(crate) fn currency_symbol(&self) -> Result<Vec<u16>, UErrorCode> {
        let style = match self.unit_width {
            UnitWidth::Hidden => return Ok(Vec::new()),
            UnitWidth::IsoCode => return try_to_vec(&self.currency),
            UnitWidth::Narrow => UCURR_NARROW_SYMBOL_NAME,
            UnitWidth::Formal => UCURR_FORMAL_SYMBOL_NAME,
            UnitWidth::Short | UnitWidth::FullName => UCURR_SYMBOL_NAME,
        };
        let locale = self.symbols.get_locale().get_name();
        ucurr_get_name(&self.currency, locale, style).and_then(CurrencyName::try_to_vec)
    }

    /// Returns what stands for `count` currency signs.
    #[cold]
    fn rare_currency_text(&self, count: usize, plural: PluralForm) -> Result<Vec<u16>, UErrorCode> {
        let (locale, keyword) = (self.symbols.get_locale().get_name(), plural.keyword());
        match count {
            2 => try_to_vec(&self.currency),
            3 => ucurr_get_plural_name(&self.currency, locale, keyword.to_bytes())?.try_to_vec(),
            _ => try_to_vec(&[0xfffd]),
        }
    }
}
