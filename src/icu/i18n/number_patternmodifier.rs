//! The affixes of a number pattern with the symbols of the locale. ICU4C: number_patternmodifier.cpp

use crate::common::memory::try_box;
use crate::common::ucurr::{CurrencyName, ucurr_get_name};
use crate::common::unicode::ucurr::*;
use crate::common::utf16::code_points;
use crate::common::utypes::UErrorCode;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder};
use crate::i18n::measunit::CurrencyCode;
use crate::i18n::number_decimalquantity::Signum;
use crate::i18n::number_fluent::{SignDisplay, UnitWidth};
use crate::i18n::number_modifiers::{
    AdoptingSignumModifierStore, ConstantMultiFieldModifier, MiddleModifier,
};
use crate::i18n::number_patternstring::{ParsedPatternInfo, PatternSignType};
use crate::i18n::unicode::unum::*;
use std::borrow::Cow;
use std::sync::Arc;

/// A pattern and the field of its literal text.
pub(crate) type Pattern<'a> = (&'a ParsedPatternInfo, Field);

pub(crate) struct PatternModifier {
    pub(crate) sign_display: SignDisplay,
    pub(crate) approximately: bool,
    pub(crate) symbols: Arc<DecimalFormatSymbols>,
    pub(crate) currency: Option<(CurrencyCode, UnitWidth)>,
}

impl PatternModifier {
    pub(crate) fn create_immutable(
        &self,
        pattern: Pattern,
    ) -> Result<AdoptingSignumModifierStore, UErrorCode> {
        AdoptingSignumModifierStore::new(|modifier, signum| self.render(modifier, pattern, signum))
    }

    pub(crate) fn create_one_shot(
        &self,
        pattern: Pattern,
        signum: Signum,
    ) -> Result<MiddleModifier<'static>, UErrorCode> {
        let mut modifier = try_box(ConstantMultiFieldModifier::new())?;
        self.render(&mut modifier, pattern, signum)?;
        Ok(MiddleModifier::Owned(modifier))
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
    ) -> Result<(), UErrorCode> {
        modifier.overwrite = !pattern.has_body;
        let (sign_type, mut affix) = (self.sign_type(signum), Vec::new());
        for (is_prefix, output) in [(true, &mut modifier.prefix), (false, &mut modifier.suffix)] {
            pattern.write_affix(is_prefix, sign_type, self.approximately, &mut affix);
            self.unescape(&affix, output, field);
            output.outcome()?;
        }
        modifier.enable_currency_spacing(&self.symbols)
    }

    /// `field` is that of literal text. ICU4C: number_affixutils.cpp, AffixUtils::unescape
    fn unescape(&self, affix: &[u16], output: &mut FormattedStringBuilder, field: Field) {
        const QUOTE: u32 = 0x27;
        let (mut rest, mut is_quoted) = (code_points(affix), false);
        while let Some(mut c) = rest.next() {
            if c == QUOTE {
                let Some(next) = rest.next() else { break };
                is_quoted ^= next != QUOTE;
                c = next;
            }
            let (symbol, symbol_field) = match char::from_u32(c).filter(|_| !is_quoted) {
                Some('-') => (Symbol::MinusSign, UNUM_SIGN_FIELD),
                Some('+') => (Symbol::PlusSign, UNUM_SIGN_FIELD),
                Some('~') => (Symbol::ApproximatelySign, UNUM_APPROXIMATELY_SIGN_FIELD),
                Some('%') => (Symbol::PercentSign, UNUM_PERCENT_FIELD),
                Some('¤') => {
                    output.add_all(&self.currency_symbol(), Field::number(UNUM_CURRENCY_FIELD));
                    continue;
                }
                _ => {
                    output.insert_code_point(output.len(), c, field);
                    continue;
                }
            };
            let symbol = self.symbols.get_const_symbol(symbol);
            output.add_all(symbol, Field::number(symbol_field));
        }
    }

    fn currency_symbol(&self) -> Cow<'_, [u16]> {
        let (currency, style) = match &self.currency {
            None | Some((_, UnitWidth::Hidden)) => return Cow::Borrowed(&[]),
            Some((currency, UnitWidth::IsoCode)) => return Cow::Borrowed(currency),
            Some((currency, UnitWidth::Narrow)) => (currency, UCURR_NARROW_SYMBOL_NAME),
            Some((currency, UnitWidth::Formal)) => (currency, UCURR_FORMAL_SYMBOL_NAME),
            Some((currency, _)) => (currency, UCURR_SYMBOL_NAME),
        };
        let locale = self.symbols.get_locale().get_name();
        let name = ucurr_get_name(currency, locale, style);
        Cow::Owned(name.and_then(CurrencyName::try_to_vec).unwrap_or_default())
    }
}
