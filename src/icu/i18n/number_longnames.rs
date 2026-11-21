//! The names of units and currencies around a number: "{0} meters". ICU4C: number_longnames.cpp

use crate::common::bytes::U16s;
use crate::common::charstr::SmallChars;
use crate::common::locid::Locale;
use crate::common::memory::{Appendable, TryClone};
use crate::common::resource::ResourceValue;
use crate::common::simpleformatter::{ARG0, SimpleFormatter};
use crate::common::slice_ext::SliceExt;
use crate::common::uchar::u_is_java_space_char;
use crate::common::ucurr::ucurr_get_plural_name;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::Subtag;
use crate::common::unistr::UString;
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::Field;
use crate::i18n::measunit::{CurrencyCode, MeasureUnit, UnitKey};
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::UnitWidth;
use crate::i18n::number_modifiers::{OuterModifier, PluralModifiers, SimpleModifier};
use crate::i18n::number_rounding::RoundingImpl;
use crate::i18n::plurrule::PluralRules;
use crate::i18n::standardplural::{COUNT, PluralForm};
use crate::i18n::unicode::unum::{UNUM_CURRENCY_FIELD, UNUM_MEASURE_UNIT_FIELD};

type Text = U16s<'static>;

#[derive(Default)]
struct UnitData {
    by_plural: [Option<Text>; COUNT],
    /// "{0} per meter"
    per: Option<Text>,
}

impl UnitData {
    /// Keeps the strings that are already there.
    fn load(&mut self, bundle: &UResourceBundle, path: &[u8]) -> Result<(), UErrorCode> {
        let mut sink = |key: &[u8], value: &ResourceValue| {
            let text = match key {
                b"case" | b"dnam" | b"gender" => return Ok(()),
                b"per" => Some(&mut self.per),
                _ => PluralForm::from_keyword(key)
                    .and_then(|form| self.by_plural.get_mut(form.index())),
            };
            let text = text.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
            if text.is_none() {
                *text = Some(value.get_string()?);
            }
            Ok(())
        };
        ures_get_all_children_with_fallback(bundle, path, &mut sink)
    }

    fn pattern(&self, form: PluralForm) -> Result<Vec<u16>, UErrorCode> {
        let text = |form: PluralForm| self.by_plural.at(form.index());
        let text = text(form).or_else(|| text(PluralForm::Other));
        text.ok_or(U_INTERNAL_PROGRAM_ERROR)?.try_to_vec()
    }
}

fn compile(pattern: &[u16], min: usize, max: usize) -> Result<SimpleFormatter, UErrorCode> {
    SimpleFormatter::with_pattern_min_max_arguments(pattern, min, max)
}

fn concat_key(parts: &[&[u8]]) -> SmallChars {
    let mut key = SmallChars::new();
    parts.iter().for_each(|part| key.add_all(part));
    key
}

fn trim_space_chars(text: &[u16]) -> &[u16] {
    let is_space = |&unit: &u16| u_is_java_space_char(unit.into());
    let (_, text) = text.split_while(is_space);
    text.slice(..text.len() - text.iter().rev().take_while(|unit| is_space(unit)).count())
}

fn to_modifiers(
    field: Field,
    mut pattern: impl FnMut(PluralForm) -> Result<Vec<u16>, UErrorCode>,
) -> Result<PluralModifiers, UErrorCode> {
    let mut modifiers = PluralForm::ALL.map(|_| SimpleModifier::new(SimpleFormatter::new(), field));
    for (form, modifier) in PluralForm::ALL.into_iter().zip(&mut modifiers) {
        *modifier = SimpleModifier::new(compile(&pattern(form)?, 0, 1)?, field);
    }
    Ok(modifiers)
}

type Case = Subtag<16>;

/// Returns the grammatical cases of numerator and denominator. Each is empty if the language has no rule for it.
fn load_per_cases(locale: &Locale) -> Result<[Case; 2], UErrorCode> {
    let features = ures_open_direct(None, b"grammaticalFeatures")?;
    let derivations = (features.get_by_key(b"grammaticalData")?).get_by_key(b"derivations")?;
    let rules = (derivations.get_by_key(locale.get_language()))
        .or_else(|_| derivations.get_by_key(b"root"))?;
    let Ok(rule) = rules.get_by_key_with_fallback(b"component/case/per") else {
        return Ok(Default::default());
    };
    let case = |index| -> Result<Case, UErrorCode> {
        let case = ures_get_string_by_index(&rule, index)?;
        let case = case.filter(|case| !case.eq_bytes(b"compound"));
        Ok(Case::new(invariant_prefix(case.unwrap_or_default().iter())))
    };
    Ok([case(0)?, case(1)?])
}

struct Units {
    bundle: UResourceBundle,
    table: &'static [u8],
}

impl Units {
    fn load(&self, unit: UnitKey, case: &[u8]) -> Result<UnitData, UErrorCode> {
        let (key, mut data) = (concat_key(&[self.table, unit]), UnitData::default());
        if !case.is_empty() {
            _ = data.load(&self.bundle, &concat_key(&[&key, b"/case/", case]));
        }
        data.load(&self.bundle, &key).map(|()| data)
    }

    /// Builds "{0} per second" from "{0} per {1}" and "{0} second".
    fn build_per_pattern(&self, denominator: &UnitData) -> Result<Vec<u16>, UErrorCode> {
        let path = concat_key(&[self.table, b"compound/per"]);
        let per = self.bundle.get_string_by_key_with_fallback(&path)?;
        let per = compile(&per.units().try_to_vec()?, 2, 2)?;
        let one = compile(&denominator.pattern(PluralForm::One)?, 0, 1)?;
        Ok(per.format_to_vec(&[&ARG0, trim_space_chars(&one.format_to_vec(&[&[]]))]))
    }
}

fn unit_modifiers(
    locale: &Locale,
    numerator: UnitKey,
    denominator: Option<UnitKey>,
    width: UnitWidth,
) -> Result<PluralModifiers, UErrorCode> {
    const FIELD: Field = Field::number(UNUM_MEASURE_UNIT_FIELD);
    let units = Units {
        bundle: ures_open(Some(U_ICUDATA_UNIT), locale.get_name())?,
        table: match width {
            UnitWidth::Narrow => b"unitsNarrow/",
            UnitWidth::Short => b"unitsShort/",
            _ => b"units/",
        },
    };
    let Some(denominator) = denominator else {
        let data = units.load(numerator, b"")?;
        return to_modifiers(FIELD, |form| data.pattern(form));
    };
    let mut cases = Default::default();
    if width == UnitWidth::FullName {
        cases = load_per_cases(locale)?;
    }
    let [numerator_case, denominator_case] = cases;
    let numerator = units.load(numerator, &numerator_case)?;
    let denominator = units.load(denominator, &denominator_case)?;
    let per = match denominator.per {
        Some(per) => per.try_to_vec()?,
        None => units.build_per_pattern(&denominator)?,
    };
    let per = compile(&per, 1, 1)?;
    to_modifiers(FIELD, |form| {
        Ok(per.format_to_vec(&[&numerator.pattern(form)?]))
    })
}

fn currency_modifiers(
    locale: &Locale,
    currency: CurrencyCode,
    rules: &PluralRules,
) -> Result<PluralModifiers, UErrorCode> {
    let mut data = UnitData::default();
    let bundle = ures_open(Some(U_ICUDATA_CURR), locale.get_name())?;
    data.load(&bundle, b"CurrencyUnitPatterns")?;
    let with_name = |form: PluralForm| {
        let name = ucurr_get_plural_name(&currency, locale.get_name(), form.keyword().to_bytes())?;
        let mut pattern = data.pattern(form)?;
        pattern.find_and_replace(&from_latin1(b"{1}"), &name.try_to_vec()?);
        Ok(pattern)
    };
    let other = with_name(PluralForm::Other)?;
    to_modifiers(Field::number(UNUM_CURRENCY_FIELD), |form| {
        if rules.forms().any(|of_locale| of_locale == form) {
            with_name(form)
        } else {
            other.try_clone()
        }
    })
}

pub(crate) struct LongNameHandler {
    modifiers: PluralModifiers,
    rules: PluralRules,
}

impl LongNameHandler {
    pub(crate) fn new(
        locale: &Locale,
        unit: MeasureUnit,
        width: UnitWidth,
    ) -> Result<Self, UErrorCode> {
        let rules = PluralRules::cardinal(locale)?;
        let modifiers = match unit {
            MeasureUnit::None => Err(U_INTERNAL_PROGRAM_ERROR),
            MeasureUnit::Currency(currency) => currency_modifiers(locale, currency, &rules),
            MeasureUnit::Named(unit) => unit_modifiers(locale, unit, None, width),
            MeasureUnit::Per(unit, per) => unit_modifiers(locale, unit, Some(per), width),
        }?;
        Ok(Self { modifiers, rules })
    }

    /// Selects by the plural form of a rounded copy of `quantity`.
    pub(crate) fn modifier_for(
        &self,
        quantity: &DecimalQuantity,
        rounder: &RoundingImpl,
    ) -> Result<OuterModifier<'_>, UErrorCode> {
        let mut rounded = quantity.try_clone()?;
        rounder.apply(&mut rounded)?;
        Ok(OuterModifier {
            by_plural: &self.modifiers,
            plural: self.rules.select(&rounded),
        })
    }
}
