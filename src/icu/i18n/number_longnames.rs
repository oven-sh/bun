//! The names of units and currencies around a number: "{0} meters". ICU4C: number_longnames.cpp

use crate::common::bytes::U16s;
use crate::common::charstr::{SmallChars, decimal};
use crate::common::cstring::{split_once, until_nul};
use crate::common::locid::Locale;
use crate::common::memory::{
    Appendable, try_collect, try_collect_results, try_concat, try_filled, try_to_vec,
};
use crate::common::resource::ResourceValue;
use crate::common::simpleformatter::{ARG0, SimpleFormatter};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::ucase::{CaseLocale, Mapping};
use crate::common::uchar::u_is_java_space_char;
use crate::common::ucurr::ucurr_get_plural_name;
use crate::common::udata::{U_ICUDATA_ALIAS, searches_files};
use crate::common::uinvchar::invariant_chars;
use crate::common::unistr::{UStr, UString};
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::ustrcase;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::{Field, UNDEFINED_FIELD};
use crate::i18n::listformatter::ListFormatter;
use crate::i18n::measunit::{CurrencyCode, MeasureUnit, UnitKey, find_by_sub_type};
use crate::i18n::measunit_extra::{
    MeasureUnitImpl, SingleUnitImpl, UMEASURE_PREFIX_ONE, umeas_get_prefix_base,
    umeas_get_prefix_power,
};
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::{
    LocalizedNumberFormatter, MacroProps, UFormattedNumberData, UnitWidth,
};
use crate::i18n::number_modifiers::{OuterModifier, PluralModifiers, SimpleModifier};
use crate::i18n::number_rounding::RoundingImpl;
use crate::i18n::plurrule::PluralRules;
use crate::i18n::standardplural::{COUNT, PluralForm};
use crate::i18n::unicode::unum::{UNUM_CURRENCY_FIELD, UNUM_MEASURE_UNIT_FIELD};
use crate::i18n::units_complexconverter::ComplexUnitsConverter;

type Text = U16s<'static>;
/// A pattern for each plural form, then the pattern "{0} per meter".
type UnitData = [Option<Text>; COUNT + 1];
const PER: usize = COUNT;
const OTHER: usize = PluralForm::Other.index();
/// Indexed by plural form.
type Patterns = [Option<Vec<u16>>; COUNT];

const UNIT_FIELD: Field = Field::number(UNUM_MEASURE_UNIT_FIELD);

const GENDERS: [&[u8]; 7] = [
    b"animate",
    b"common",
    b"feminine",
    b"inanimate",
    b"masculine",
    b"neuter",
    b"personal",
];

fn get_index(key: &[u8]) -> Result<usize, UErrorCode> {
    match key {
        b"per" => Ok(PER),
        _ => PluralForm::from_keyword(key)
            .map(PluralForm::index)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR),
    }
}

/// Returns the text at `index`, falling back to "other".
fn get_with_plural<T>(texts: &[Option<T>], index: usize) -> Result<&T, UErrorCode> {
    let text = |index| texts.soft_get(index)?.as_ref();
    text(index)
        .or_else(|| text(OTHER))
        .ok_or(U_INTERNAL_PROGRAM_ERROR)
}

fn compile(pattern: &[u16], min: usize, max: usize) -> Result<SimpleFormatter, UErrorCode> {
    SimpleFormatter::with_pattern_min_max_arguments(pattern, min, max)
}

fn format(formatter: &SimpleFormatter, values: &[&[u16]]) -> Result<Vec<u16>, UErrorCode> {
    formatter
        .format_unless_too_long(values)
        .ok_or(U_INPUT_TOO_LONG_ERROR)
}

fn concat_key(parts: &[&[u8]]) -> SmallChars {
    let mut key = SmallChars::new();
    parts.iter().for_each(|part| key.add_all(part));
    key
}

fn is_space(unit: u16) -> bool {
    u_is_java_space_char(unit.into())
}

fn trim_space_chars(text: &[u16]) -> &[u16] {
    let (_, text) = text.split_while(|&unit| is_space(unit));
    let trailing = text.iter().rev().take_while(|&&unit| is_space(unit));
    text.slice(..text.len() - trailing.count())
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Placeholder {
    #[default]
    Empty,
    None,
    Beginning,
    Middle,
    End,
}

/// Splits a pattern into core unit, placeholder position and joiner: "{0} foo" gives "foo", `Beginning` and a space.
fn extract_core_pattern(pattern: &[u16]) -> (&[u16], Placeholder, Option<u16>) {
    if let Some(rest) = pattern.strip_prefix(&ARG0) {
        match rest.split_first() {
            Some((joiner, core_unit)) if is_space(*joiner) => {
                (core_unit, Placeholder::Beginning, Some(*joiner))
            }
            _ => (rest, Placeholder::Beginning, None),
        }
    } else if let Some(rest) = pattern.strip_suffix(&ARG0) {
        match rest.split_last() {
            Some((joiner, core_unit)) if is_space(*joiner) => {
                (core_unit, Placeholder::End, Some(*joiner))
            }
            _ => (rest, Placeholder::End, None),
        }
    } else if pattern.index_of(&ARG0).is_some() {
        (pattern, Placeholder::Middle, None)
    } else {
        (pattern, Placeholder::None, None)
    }
}

/// Maps "year-person" to "year", whose data it uses.
fn without_person(subtype: &[u8]) -> &[u8] {
    subtype
        .strip_suffix(b"-person")
        .filter(|rest| !rest.is_empty())
        .unwrap_or(subtype)
}

/// Returns the key under which the names of `unit` are, which an alias can change.
#[cold]
fn resolve_key(unit: &[u8]) -> Result<SmallChars, UErrorCode> {
    let (type_, subtype) = split_once(unit, b'/');
    let subtype = subtype.soft_unwrap();
    let alias_key = concat_key(&[b"alias/unit/", subtype, b"/replacement"]);
    let aliases = ures_open(Some(U_ICUDATA_ALIAS), b"metadata")?;
    let replacement = match aliases.get_by_key_with_fallback(&alias_key) {
        Ok(found) => Some(invariant_chars::<SmallChars>(found.get_string()?.iter())?),
        Err(_) => None,
    };
    let subtype = without_person(replacement.as_deref().map_or(subtype, until_nul));
    Ok(concat_key(&[type_, b"/", subtype]))
}

/// Fails if `value` is not a string, but stores an empty string for callers that ignore the error.
fn store_text(slot: &mut Option<Text>, value: &ResourceValue) -> Result<(), UErrorCode> {
    let text = value.get_string();
    *slot = Some(text.unwrap_or_default());
    text.map(drop)
}

/// Keeps the strings that are already there. ICU4C: number_longnames.cpp, PluralTableSink
fn load_plural_table(
    bundle: &UResourceBundle,
    path: &[u8],
    out: &mut UnitData,
) -> Result<(), UErrorCode> {
    let mut sink = |key: &[u8], value: &ResourceValue| {
        if matches!(key, b"case" | b"dnam" | b"gender") {
            return Ok(());
        }
        match out.soft_get_mut(get_index(key)?) {
            Some(slot @ None) => store_text(slot, value),
            _ => Ok(()),
        }
    };
    ures_get_all_children_with_fallback(bundle, path, &mut sink)
}

/// Returns `wanted`, `fallback` and "_", or only "_" if `wanted` is empty.
fn fallback_keys<'a>(wanted: &'a [u8], fallback: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
    [wanted, fallback, b"_"]
        .into_iter()
        .skip(if wanted.is_empty() { 2 } else { 0 })
}

/// Loads a table nested by plural form, gender and case. ICU4C: number_longnames.cpp, InflectedPluralSink
fn load_inflected_table(
    bundle: &UResourceBundle,
    path: &[u8],
    gender: &[u8],
    case: &[u8],
    out: &mut UnitData,
) -> Result<(), UErrorCode> {
    let mut sink = |key: &[u8], value: &ResourceValue| {
        let Some(slot @ None) = out.soft_get_mut(get_index(key)?) else {
            return Ok(());
        };
        let genders = value.get_table()?;
        for cases in fallback_keys(gender, b"neuter").filter_map(|gender| genders.get(gender)) {
            let cases = cases.get_table()?;
            if let Some(found) = fallback_keys(case, b"nominative").find_map(|case| cases.get(case))
            {
                return store_text(slot, &found);
            }
        }
        Ok(())
    };
    ures_get_all_children_with_fallback(bundle, path, &mut sink)
}

/// The rules that derive the plural form and the case of the parts from the compound unit.
type Components = Result<UResourceBundle, UErrorCode>;

fn load_components(locale: &Locale) -> Components {
    let mut derivations = ures_open_direct(None, b"grammaticalFeatures")?;
    derivations.descend(b"grammaticalData")?;
    derivations.descend(b"derivations")?;
    let mut rules = match derivations.get_by_key(locale.get_language()) {
        Err(U_MISSING_RESOURCE_ERROR) => derivations.get_by_key(b"root"),
        of_language => of_language,
    }?;
    rules.descend(b"component").map(|()| rules)
}

/// The plural form or case for each of two parts. `None` means the value of the compound unit.
struct DerivedComponents([Option<SmallChars>; 2]);

impl DerivedComponents {
    /// Both values are empty if the data are missing.
    #[cfg_attr(mordant, allow(defaulted_failure))]
    fn new(components: &Components, feature: &[u8], structure: &[u8]) -> Self {
        let values = Self::load(components, feature, structure).unwrap_or_default();
        Self(values.map(|value| {
            let value = value.map_or(Text::EMPTY, DataString::units);
            (!value.eq_bytes(b"compound"))
                .then(|| invariant_chars(value.iter()).unwrap_or_default())
        }))
    }

    fn load(
        components: &Components,
        feature: &[u8],
        structure: &[u8],
    ) -> Result<[Option<DataString>; 2], UErrorCode> {
        let mut rule = (components.as_ref().map_err(|&code| code)?).get_by_key(feature)?;
        rule.descend(structure)?;
        Ok([
            ures_get_data_string_by_index(&rule, 0)?,
            ures_get_data_string_by_index(&rule, 1)?,
        ])
    }

    fn values<'a>(&'a self, compound_value: &'a [u8]) -> [&'a [u8]; 2] {
        (self.0.each_ref()).map(|value| value.as_deref().map_or(compound_value, until_nul))
    }
}

/// The names of a numerator or a denominator.
enum Names {
    BuiltIn(UnitData),
    Composed(Patterns),
    /// There is no unit on this side.
    Empty,
}

impl Names {
    fn has_own_pattern(&self, form: PluralForm) -> bool {
        match self {
            Self::BuiltIn(data) => data.at(form.index()).is_some(),
            Self::Composed(patterns) => matches!(patterns.get(form.index()), Some(Some(_))),
            Self::Empty => false,
        }
    }

    fn pattern(&self, form: PluralForm) -> Result<Vec<u16>, UErrorCode> {
        match self {
            Self::BuiltIn(data) => get_with_plural(data, form.index())?.try_to_vec(),
            Self::Composed(patterns) => try_to_vec(get_with_plural(patterns, form.index())?),
            Self::Empty => Ok(Vec::new()),
        }
    }

    fn per(&self) -> Option<Text> {
        match self {
            Self::BuiltIn(data) => data.at(PER),
            Self::Composed(_) => None,
            Self::Empty => Some(Text::EMPTY),
        }
    }
}

/// `complete` makes the final pattern of each pattern in `names`.
fn to_modifiers(
    field: Field,
    names: &Names,
    complete: impl Fn(Vec<u16>) -> Result<Vec<u16>, UErrorCode>,
) -> Result<PluralModifiers, UErrorCode> {
    let mut modifiers = PluralModifiers::default();
    for (form, modifier) in PluralForm::ALL.into_iter().zip(&mut modifiers) {
        if form == PluralForm::Other || names.has_own_pattern(form) {
            let pattern = complete(names.pattern(form)?)?;
            *modifier = Some(SimpleModifier::new(compile(&pattern, 0, 1)?, field));
        }
    }
    Ok(modifiers)
}

struct Units<'a> {
    locale: &'a Locale,
    width: UnitWidth,
    bundle: UResourceBundle,
    table: &'static [u8],
}

impl<'a> Units<'a> {
    fn new(locale: &'a Locale, width: UnitWidth) -> Result<Self, UErrorCode> {
        Ok(Self {
            locale,
            width,
            bundle: ures_open(Some(U_ICUDATA_UNIT), locale.get_name())?,
            table: match width {
                UnitWidth::Narrow => b"unitsNarrow/",
                UnitWidth::Short => b"unitsShort/",
                _ => b"units/",
            },
        })
    }

    /// What was read before an error counts, unless the width is short.
    fn tolerate(&self, loaded: Result<(), UErrorCode>) -> Result<(), UErrorCode> {
        if self.width == UnitWidth::Short {
            loaded
        } else {
            Ok(())
        }
    }

    // ICU4C: number_longnames.cpp, getMeasureData
    fn load(&self, unit: &[u8], case: &[u8]) -> Result<UnitData, UErrorCode> {
        let resolved;
        let (mut data, mut unit) = (UnitData::default(), unit);
        if searches_files()? {
            resolved = resolve_key(unit)?;
            unit = &resolved;
        }
        let key = concat_key(&[self.table, unit]);
        if self.width == UnitWidth::FullName && !case.is_empty() {
            let key = concat_key(&[&key, b"/case/", case]);
            _ = load_plural_table(&self.bundle, &key, &mut data);
        }
        self.tolerate(load_plural_table(&self.bundle, &key, &mut data))?;
        Ok(data)
    }

    /// Returns the pattern for a key such as "per", "times" or "10p3".
    fn get_compound_value(&self, key: &[u8]) -> Result<Vec<u16>, UErrorCode> {
        let in_table = |table| {
            let path = concat_key(&[table, b"compound/", key]);
            self.bundle.get_string_by_key_with_fallback(&path)
        };
        let value = in_table(self.table).or_else(|_| in_table(b"unitsShort/"))?;
        value.units().try_to_vec()
    }

    /// Returns one of `GENDERS`, or else an empty text.
    fn get_gender(&self, unit: UnitKey) -> &'static [u8] {
        let key = concat_key(&[b"units/", without_person(unit), b"/gender"]);
        let gender = (self.bundle.get_string_by_key_with_fallback(&key))
            .and_then(|gender| invariant_chars::<SmallChars>(gender.units().iter()))
            .unwrap_or_default();
        let known = (GENDERS.into_iter()).find(|&known| known == until_nul(&gender));
        known.unwrap_or_default()
    }

    /// Returns patterns such as "{0} squared". ICU4C: number_longnames.cpp, getInflectedMeasureData
    fn get_power_data(
        &self,
        power: i32,
        gender: &[u8],
        case: &[u8],
    ) -> Result<UnitData, UErrorCode> {
        let key = concat_key(&[self.table, b"compound/power", &decimal(power.into())]);
        let mut data = UnitData::default();
        let loaded = load_inflected_table(&self.bundle, &key, gender, case, &mut data);
        self.tolerate(loaded).map(|()| data)
    }

    /// Returns a pattern such as "kilo{0}".
    fn get_prefix_pattern(&self, unit: &SingleUnitImpl) -> Result<Vec<u16>, UErrorCode> {
        let base = decimal(umeas_get_prefix_base(unit.unit_prefix).into());
        let power = decimal(umeas_get_prefix_power(unit.unit_prefix).into());
        self.get_compound_value(&concat_key(&[&base, b"p", &power]))
    }

    /// Combines "kilo{0}" and "Meter" into "kilometer".
    fn combine_lowercasing(
        &self,
        pattern: &[u16],
        core_unit: &[u16],
    ) -> Result<Vec<u16>, UErrorCode> {
        let formatter = compile(pattern, 1, 1)?;
        if self.width != UnitWidth::FullName {
            return format(&formatter, &[core_unit]);
        }
        let mapping = Mapping::lower(CaseLocale::of(self.locale.get_base_name()));
        let mut lower = try_filled(0, ustrcase::map(mapping, core_unit, &mut []))?;
        ustrcase::map(mapping, core_unit, &mut lower);
        format(&formatter, &[&lower])
    }

    /// `product` has no negative power. ICU4C: number_longnames.cpp, LongNameHandler::processPatternTimes
    #[cold]
    fn process_pattern_times(
        &self,
        product: &mut MeasureUnitImpl,
        case: &[u8],
        components: &Components,
    ) -> Result<Names, UErrorCode> {
        product.serialize()?;
        if product.identifier.is_empty() {
            return Ok(Names::Empty);
        }
        if let Some(built_in) = find_by_sub_type(&product.identifier) {
            return self.load(built_in, case).map(Names::BuiltIn);
        }

        let times = compile(&self.get_compound_value(b"times")?, 2, 2)?;
        let mut patterns = Patterns::default();
        patterns.set(OTHER, Some(Vec::new()));
        let mut placeholders = [Placeholder::Empty; COUNT];
        let mut joiner = None;

        let times_plurals = DerivedComponents::new(components, b"plural", b"times");
        let times_cases = DerivedComponents::new(components, b"case", b"times");
        let power_cases = DerivedComponents::new(components, b"case", b"power");
        let (mut rest_plural, mut rest_case) = (&b""[..], case);

        let mut parts = product.single_units.iter().peekable();
        while let Some(part) = parts.next() {
            let ([plural0, plural1], [case0, case1]) = (
                times_plurals.values(rest_plural),
                times_cases.values(rest_case),
            );
            let (plural_category, mut case) = if parts.peek().is_some() {
                (plural0, case0)
            } else {
                (plural1, case1)
            };
            (rest_plural, rest_case) = (plural1, case1);

            let simple_unit =
                find_by_sub_type(part.get_simple_unit_id()).ok_or(U_UNSUPPORTED_ERROR)?;
            let (power, has_prefix) =
                (part.dimensionality, part.unit_prefix != UMEASURE_PREFIX_ONE);

            let (gender, mut power_data) = (self.get_gender(simple_unit), UnitData::default());
            if power != 1 {
                power_data = self.get_power_data(power, gender, case)?;
                [case, _] = power_cases.values(case);
            }
            let prefix_pattern = if has_prefix {
                self.get_prefix_pattern(part)?
            } else {
                Vec::new()
            };
            let data = self.load(simple_unit, case)?;

            for form in 0..COUNT {
                if matches!(patterns.soft_get(form), Some(None)) && data.at(form).is_none() {
                    continue;
                }
                let plural = if plural_category.is_empty() {
                    form
                } else {
                    get_index(plural_category)?
                };
                let pattern = get_with_plural(&data, plural)?.try_to_vec()?;
                let (core_unit, placeholder, part_joiner) = extract_core_pattern(&pattern);
                if placeholder == Placeholder::Middle {
                    return Err(U_UNSUPPORTED_ERROR);
                }
                if placeholders.at(form) == Placeholder::Empty {
                    placeholders.set(form, placeholder);
                    joiner = part_joiner;
                }

                let mut core_unit = try_to_vec(core_unit)?;
                if has_prefix {
                    core_unit = self.combine_lowercasing(&prefix_pattern, &core_unit)?;
                }
                if power != 1 {
                    let power_pattern = get_with_plural(&power_data, plural)?.try_to_vec()?;
                    core_unit = self.combine_lowercasing(&power_pattern, &core_unit)?;
                }

                let previous = get_with_plural(&patterns, form)
                    .map(Vec::as_slice)
                    .ok()
                    .soft_unwrap();
                let result = if previous.is_empty() {
                    core_unit
                } else {
                    format(&times, &[previous, &core_unit])?
                };
                patterns.set(form, Some(result));
            }
        }

        if product.constant_denominator != 0 {
            let digits = decimal(product.constant_denominator as i64);
            let constant = try_collect(digits.iter().copied().map(u16::from))?;
            // Only the first plural form gets the constant.
            if let Some(first) = patterns.iter_mut().flatten().next().soft_some() {
                *first = if first.is_empty() {
                    constant
                } else {
                    format(&times, &[&constant, first])?
                };
            }
        }

        for (pattern, placeholder) in patterns.iter_mut().zip(placeholders) {
            match (pattern, placeholder) {
                (Some(core), Placeholder::Beginning) => {
                    *core = try_concat(&[&ARG0, joiner.as_slice(), core])?
                }
                (Some(core), Placeholder::End) => core.add_each(joiner.into_iter().chain(ARG0)),
                _ => {}
            }
        }
        Ok(Names::Composed(patterns))
    }

    /// Builds "{0} per second" from "{0} per {1}" and "{0} second".
    fn build_per_pattern(&self, denominator: &Names) -> Result<Vec<u16>, UErrorCode> {
        let per = compile(&self.get_compound_value(b"per")?, 2, 2)?;
        let one = compile(&denominator.pattern(PluralForm::One)?, 0, 1)?;
        Ok(per.format_to_vec(&[&ARG0, trim_space_chars(&one.format_to_vec(&[&[]]))]))
    }

    // ICU4C: number_longnames.cpp, LongNameHandler::multiSimpleFormatsToModifiers
    fn quotient(
        &self,
        numerator: &Names,
        denominator: &Names,
    ) -> Result<PluralModifiers, UErrorCode> {
        let per = match denominator.per() {
            Some(per) => per.try_to_vec()?,
            None => self.build_per_pattern(denominator)?,
        };
        if per.is_empty() {
            return to_modifiers(UNIT_FIELD, numerator, Ok);
        }
        let formatter = compile(&per, 1, 1)?;
        to_modifiers(UNIT_FIELD, numerator, |lead| match &*lead {
            [] => try_to_vec(&per),
            lead => Ok(formatter.format_to_vec(&[lead])),
        })
    }

    fn for_named_unit(&self, unit: UnitKey) -> Result<PluralModifiers, UErrorCode> {
        to_modifiers(UNIT_FIELD, &Names::BuiltIn(self.load(unit, b"")?), Ok)
    }

    fn for_named_units(
        &self,
        numerator: UnitKey,
        denominator: UnitKey,
    ) -> Result<PluralModifiers, UErrorCode> {
        let cases = (self.width == UnitWidth::FullName)
            .then(|| DerivedComponents::new(&load_components(self.locale), b"case", b"per"));
        let [case0, case1] = cases.as_ref().map(|it| it.values(b"")).unwrap_or_default();
        let numerator = Names::BuiltIn(self.load(numerator, case0)?);
        self.quotient(&numerator, &Names::BuiltIn(self.load(denominator, case1)?))
    }

    // ICU4C: number_longnames.cpp, LongNameHandler::forArbitraryUnit
    #[cold]
    fn for_arbitrary_unit(
        locale: &'a Locale,
        width: UnitWidth,
        unit: &MeasureUnitImpl,
    ) -> Result<PluralModifiers, UErrorCode> {
        let (mut numerator, mut denominator) =
            (MeasureUnitImpl::default(), MeasureUnitImpl::default());
        denominator.constant_denominator = unit.constant_denominator;
        for mut part in unit.single_units.iter().copied() {
            let side = if part.dimensionality > 0 {
                &mut numerator
            } else {
                &mut denominator
            };
            part.dimensionality = part.dimensionality.wrapping_abs();
            side.append_single_unit(&part);
        }
        let components = load_components(locale);
        let cases = DerivedComponents::new(&components, b"case", b"per");
        let ([case0, case1], this) = (cases.values(b""), Self::new(locale, width)?);
        let numerator = this.process_pattern_times(&mut numerator, case0, &components)?;
        let denominator = this.process_pattern_times(&mut denominator, case1, &components)?;
        this.quotient(&numerator, &denominator)
    }
}

// ICU4C: number_longnames.cpp, getCurrencyLongNameData
fn currency_modifiers(
    locale: &Locale,
    currency: CurrencyCode,
    rules: &PluralRules,
) -> Result<PluralModifiers, UErrorCode> {
    let mut data = UnitData::default();
    let bundle = ures_open(Some(U_ICUDATA_CURR), locale.get_name())?;
    load_plural_table(&bundle, b"CurrencyUnitPatterns", &mut data)?;
    // The name of the currency may differ by form.
    for form in rules.forms() {
        let text = data.at(form.index()).or_else(|| data.at(OTHER));
        data.set(form.index(), text);
    }
    let mut patterns = Patterns::default();
    for (form, text) in PluralForm::ALL.into_iter().zip(data) {
        if let Some(text) = text {
            let keyword = form.keyword().to_bytes();
            let name = ucurr_get_plural_name(&currency, locale.get_name(), keyword)?;
            let mut pattern = text.try_to_vec()?;
            pattern.find_and_replace(&from_latin1(b"{1}"), &name.try_to_vec()?);
            patterns.set(form.index(), Some(pattern));
        }
    }
    let names = Names::Composed(patterns);
    to_modifiers(Field::number(UNUM_CURRENCY_FIELD), &names, Ok)
}

pub(crate) struct LongNameHandler {
    modifiers: PluralModifiers,
    rules: PluralRules,
}

impl LongNameHandler {
    pub(crate) fn new(
        locale: &Locale,
        unit: &MeasureUnit,
        width: UnitWidth,
    ) -> Result<Self, UErrorCode> {
        let rules = PluralRules::cardinal(locale)?;
        let units = || Units::new(locale, width);
        let modifiers = match *unit {
            MeasureUnit::None => Err(U_INTERNAL_PROGRAM_ERROR),
            MeasureUnit::Currency(currency) => currency_modifiers(locale, currency, &rules),
            MeasureUnit::Named(unit) => units()?.for_named_unit(unit),
            MeasureUnit::Per(unit, per) => units()?.for_named_units(unit, per),
            MeasureUnit::Parsed(ref unit) => Units::for_arbitrary_unit(locale, width, unit),
        }?;
        Ok(Self { modifiers, rules })
    }

    pub(crate) fn modifier_for(
        &self,
        quantity: &DecimalQuantity,
        rounder: &RoundingImpl,
    ) -> Result<OuterModifier<'_>, UErrorCode> {
        Ok(OuterModifier {
            by_plural: &self.modifiers,
            plural: rounder.get_plural_safe(&self.rules, quantity)?,
        })
    }
}

/// Builds patterns such as "3 ft, {0} in".
pub(crate) struct MixedUnitLongNameHandler {
    converter: ComplexUnitsConverter,
    rules: PluralRules,
    names: Vec<Names>,
    integer_formatter: LocalizedNumberFormatter,
    list_formatter: ListFormatter,
}

impl MixedUnitLongNameHandler {
    #[cold]
    pub(crate) fn new(
        locale: &Locale,
        unit: &MeasureUnitImpl,
        width: UnitWidth,
    ) -> Result<Self, UErrorCode> {
        let units = Units::new(locale, width)?;
        let names = unit.single_units.iter().map(|part| {
            let mut identifier = Vec::new();
            part.append_neutral_identifier(&mut identifier)?;
            // The key of a unit that is not built in has two empty parts.
            let key = find_by_sub_type(&identifier).unwrap_or(b"/");
            units.load(key, b"").map(Names::BuiltIn)
        });
        let style: &[u8] = match width {
            UnitWidth::Narrow => b"unit-narrow",
            UnitWidth::FullName => b"unit",
            _ => b"unit-short",
        };
        Ok(Self {
            converter: ComplexUnitsConverter::new(&unit.single_units)?,
            rules: PluralRules::cardinal(locale)?,
            names: try_collect_results(names)?,
            integer_formatter: LocalizedNumberFormatter::new(MacroProps::new(locale.clone())),
            list_formatter: ListFormatter::create_instance(locale, style)?,
        })
    }

    /// Replaces `quantity` with the smallest part and returns the others.
    pub(crate) fn convert(
        &self,
        quantity: &mut DecimalQuantity,
        rounder: &RoundingImpl,
    ) -> Result<MixedValue<'_>, UErrorCode> {
        Ok(MixedValue {
            handler: self,
            measures: self.converter.convert(quantity, rounder)?,
            modifier: None,
        })
    }
}

pub(crate) struct MixedValue<'a> {
    handler: &'a MixedUnitLongNameHandler,
    measures: Vec<i64>,
    /// `Some` after `select_names`.
    pub(crate) modifier: Option<SimpleModifier>,
}

impl MixedValue<'_> {
    // ICU4C: number_longnames.cpp, MixedUnitLongNameHandler::getMixedUnitModifier
    #[cold]
    pub(crate) fn select_names(
        &mut self,
        quantity: &mut DecimalQuantity,
        rounder: &RoundingImpl,
    ) -> Result<(), UErrorCode> {
        let handler = self.handler;
        let parts = self.measures.iter().zip(&handler.names).enumerate();
        let items = try_collect_results(parts.map(|(i, (&measure, names))| {
            // Only the first number has a sign.
            if i == handler.converter.index_of_smallest() {
                if i > 0 && quantity.is_negative() {
                    quantity.negate();
                }
                let form = rounder.get_plural_safe(&handler.rules, quantity)?;
                return Ok(compile(&names.pattern(form)?, 0, 1)?.format_to_vec(&[&ARG0]));
            }
            let measure = if i > 0 {
                measure.wrapping_abs()
            } else {
                measure
            };
            let mut number = UFormattedNumberData::new();
            number.quantity = DecimalQuantity::from_long(measure);
            let pattern = names.pattern(handler.rules.select(&number.quantity))?;
            handler.integer_formatter.format(&mut number)?;
            Ok(compile(&pattern, 0, 1)?.format_to_vec(&[number.text()]))
        }))?;
        let items = try_collect(items.iter().map(Vec::as_slice))?;
        let pattern = compile(handler.list_formatter.format(&items)?.text(), 0, 1)?;
        self.modifier = Some(SimpleModifier::new(pattern, UNDEFINED_FIELD));
        Ok(())
    }
}
