//! Relative times: "in 3 days", "3 days ago", "yesterday", "now". ICU4C: reldatefmt.cpp, quantityformatter.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::memory::{
    Appendable, try_collect, try_extend, try_filled, try_push, try_to_vec,
};
use crate::common::resource::{ResourceSink, ResourceTable, ResourceValue};
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::slice_ext::SliceExt;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::formatted_string_builder::{Field, GENERAL_NUMERIC_FIELD};
use crate::i18n::formattedval_impl::FormattedValueStringBuilderImpl;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::UFormattedNumberData;
use crate::i18n::number_modifiers::{Modifier, SimpleModifier};
use crate::i18n::numfmt::NumberFormat;
use crate::i18n::plurrule::PluralRules;
use crate::i18n::standardplural::{PluralForm, SELECTABLE_COUNT};
use crate::i18n::unicode::uformattedvalue::UFIELD_CATEGORY_RELATIVE_DATETIME;
use std::sync::Arc;

const UDAT_REL_LITERAL_FIELD: i32 = 0;
const UDAT_REL_NUMERIC_FIELD: i32 = 1;
const LITERAL_FIELD: Field = Field::new(UFIELD_CATEGORY_RELATIVE_DATETIME, UDAT_REL_LITERAL_FIELD);
const NUMERIC_FIELD: Field = Field::new(UFIELD_CATEGORY_RELATIVE_DATETIME, UDAT_REL_NUMERIC_FIELD);

/// The width of the unit: "in 3 months", "in 3 mo.", "in 3mo".
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Style {
    Long,
    Short,
    Narrow,
}

const STYLES: usize = 3;
const SUFFIXES: [(&[u8], Style); 2] = [(b"-narrow", Style::Narrow), (b"-short", Style::Short)];
/// Resource keys, indexed by `URelativeDateTimeUnit`.
const UNITS: [&[u8]; 8] = [
    b"year", b"quarter", b"month", b"week", b"day", b"hour", b"minute", b"second",
];
type URelativeDateTimeUnit = i32;
const OFFSETS: [&[u8]; 5] = [b"-2", b"-1", b"0", b"1", b"2"];
const TENSES: [&[u8]; 2] = [b"past", b"future"];

fn index_of(key: &[u8], keys: &[&[u8]]) -> Option<usize> {
    keys.iter().position(|&known| known == key)
}

fn name_index(style: Style, unit: usize, offset: usize) -> usize {
    (style as usize * UNITS.len() + unit) * OFFSETS.len() + offset
}

fn numeric_index(style: Style, unit: usize, tense: usize, form: PluralForm) -> usize {
    ((style as usize * UNITS.len() + unit) * TENSES.len() + tense) * SELECTABLE_COUNT + form.index()
}

const NO_PATTERN: u16 = u16::MAX;

/// The `fields` table of a locale's bundle, merged with the tables of the parent bundles.
struct UnitData {
    /// The concatenated strings of `<unit><style>/relative/<offset>`, such as "yesterday".
    names: Vec<u16>,
    /// Start and limit in `names`, indexed by `name_index`.
    name_ranges: Vec<[usize; 2]>,
    /// The patterns of `<unit><style>/relativeTime/<tense>/<plural form>`, such as "in {0} days".
    numeric: Vec<SimpleModifier>,
    /// Index into `numeric` or `NO_PATTERN`, indexed by `numeric_index`.
    numeric_indexes: Vec<u16>,
    /// An alias for one unit applies to all units of its style.
    fallbacks: [Option<Style>; STYLES],
}

impl UnitData {
    fn load(bundle: &UResourceBundle) -> Result<Self, UErrorCode> {
        let mut data = Self {
            names: Vec::new(),
            name_ranges: try_filled([0; 2], STYLES * UNITS.len() * OFFSETS.len())?,
            numeric: Vec::new(),
            numeric_indexes: try_filled(
                NO_PATTERN,
                STYLES * UNITS.len() * TENSES.len() * SELECTABLE_COUNT,
            )?,
            fallbacks: [None; STYLES],
        };
        ures_get_all_items_with_fallback(bundle, b"fields", &mut data)?;
        // Shrink to fit.
        Ok(Self {
            names: try_to_vec(&data.names)?,
            numeric: try_collect(data.numeric)?,
            ..data
        })
    }

    /// Yields `style` and its chain of fallbacks.
    fn styles(&self, style: Style) -> impl Iterator<Item = Style> {
        std::iter::successors(Some(style), |&style| self.fallbacks.at(style as usize)).take(STYLES)
    }

    /// Returns an empty string if the name is missing.
    fn name_at(&self, index: usize) -> &[u16] {
        let [start, limit] = self.name_ranges.at(index);
        self.names.slice(start..limit)
    }

    fn name(&self, style: Style, unit: usize, offset: usize) -> Option<&[u16]> {
        self.styles(style)
            .map(|style| self.name_at(name_index(style, unit, offset)))
            .find(|name| !name.is_empty())
    }

    /// Searches all styles for `form`, then all styles for "other".
    fn numeric_pattern(
        &self,
        style: Style,
        unit: usize,
        tense: usize,
        form: PluralForm,
    ) -> Option<&SimpleModifier> {
        let in_style = |style, form| {
            self.numeric.get(usize::from(
                self.numeric_indexes
                    .at(numeric_index(style, unit, tense, form)),
            ))
        };
        [form, PluralForm::Other]
            .into_iter()
            .find_map(|form| self.styles(style).find_map(|style| in_style(style, form)))
    }

    fn add_fallback(&mut self, style: Style, path: U16s) -> Result<(), UErrorCode> {
        let ends_with = |suffix: &[u8]| {
            path.slice(path.len().saturating_sub(suffix.len())..)
                .eq_bytes(suffix)
        };
        let target = SUFFIXES.into_iter().find(|(suffix, _)| ends_with(suffix));
        let target = target.map_or(Style::Long, |found| found.1);
        let known = self.fallbacks.at(style as usize);
        if style == target || known.is_some_and(|known| known != target) {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        self.fallbacks.set(style as usize, Some(target));
        Ok(())
    }

    fn add_names(&mut self, style: Style, unit: usize, table: &ResourceTable) {
        for (key, value) in table.iter() {
            if let Some(offset) = index_of(key, &OFFSETS)
                && (key == b"0" || UNITS.at(unit) != b"second")
                && self.name_at(name_index(style, unit, offset)).is_empty()
                && let Ok(name) = value.get_data_string()
            {
                let start = self.names.len();
                self.names.add_each(name.units().iter());
                self.name_ranges
                    .set(name_index(style, unit, offset), [start, self.names.len()]);
            }
        }
    }

    fn add_numeric(
        &mut self,
        style: Style,
        unit: usize,
        tenses: &ResourceTable,
    ) -> Result<(), UErrorCode> {
        let mut units = Vec::new();
        for (key, forms) in tenses.iter() {
            let Some(tense) = index_of(key, &TENSES) else {
                continue;
            };
            for (key, value) in forms.get_table()?.iter() {
                if let Some(index) = PluralForm::from_keyword(key)
                    .filter(|form| form.index() < SELECTABLE_COUNT)
                    .map(|form| numeric_index(style, unit, tense, form))
                    && self.numeric_indexes.at(index) == NO_PATTERN
                    && let Ok(pattern) = value.get_data_string()
                {
                    units.clear();
                    try_extend(&mut units, pattern.units().iter())?;
                    let pattern = SimpleFormatter::with_pattern_min_max_arguments(&units, 0, 1)?;
                    self.numeric_indexes.set(index, self.numeric.len() as u16);
                    try_push(
                        &mut self.numeric,
                        SimpleModifier::new(pattern, LITERAL_FIELD),
                    )?;
                }
            }
        }
        Ok(())
    }
}

impl ResourceSink for UnitData {
    /// Keeps existing entries.
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        for (key, value) in value.get_table()?.iter() {
            let split = SUFFIXES
                .into_iter()
                .find_map(|(suffix, style)| Some((key.strip_suffix(suffix)?, style)));
            let (name, style) = split.unwrap_or((key, Style::Long));
            if let Ok(path) = value.get_alias_string() {
                self.add_fallback(style, path)?;
            } else if let Some(unit) = index_of(name, &UNITS) {
                for (key, value) in value.get_table()?.iter() {
                    match (key, value.get_table()) {
                        (b"relative", Ok(table)) => self.add_names(style, unit, &table),
                        (b"relativeTime", Ok(table)) => self.add_numeric(style, unit, &table)?,
                        _ => {}
                    }
                }
            }
        }
        Ok(())
    }
}

struct CacheData {
    units: UnitData,
    plural_rules: PluralRules,
}

impl CacheData {
    fn load(locale: &Locale) -> Result<Self, UErrorCode> {
        let bundle = ures_open(None, locale.get_name())?;
        Ok(Self {
            units: UnitData::load(&bundle)?,
            plural_rules: PluralRules::cardinal(locale)?,
        })
    }
}

/// `Always` gives "in 1 day", `Auto` gives "tomorrow".
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Numeric {
    Always,
    Auto,
}

pub(crate) struct RelativeDateTimeFormatter {
    cache: Arc<CacheData>,
    number_format: Arc<NumberFormat>,
    style: Style,
}

impl RelativeDateTimeFormatter {
    pub(crate) fn new(
        locale: &Locale,
        number_format: Arc<NumberFormat>,
        style: Style,
    ) -> Result<Self, UErrorCode> {
        static CACHE: LocaleCache<CacheData> = LocaleCache::new();
        let cache = CACHE.get_or_create(locale.get_name(), || CacheData::load(locale))?;
        Ok(Self {
            cache,
            number_format,
            style,
        })
    }

    pub(crate) fn format_to_value(
        &self,
        offset: f64,
        unit: URelativeDateTimeUnit,
        numeric: Numeric,
    ) -> Result<FormattedValueStringBuilderImpl, UErrorCode> {
        let mut output = UFormattedNumberData {
            base: FormattedValueStringBuilderImpl::new(NUMERIC_FIELD),
            quantity: DecimalQuantity::new(),
        };
        let outcome = self.format(offset, unit, numeric, &mut output);
        output.base.finish(outcome).map(|()| output.base)
    }

    /// `output` must be empty.
    pub(crate) fn format(
        &self,
        offset: f64,
        unit: URelativeDateTimeUnit,
        numeric: Numeric,
        output: &mut UFormattedNumberData,
    ) -> Result<(), UErrorCode> {
        let units = &self.cache.units;
        let unit = usize::try_from(unit)
            .ok()
            .filter(|&unit| unit < UNITS.len());
        let unit = unit.ok_or(U_UNSUPPORTED_ERROR)?;
        if numeric == Numeric::Auto
            && let Some(name) =
                offset_index(offset).and_then(|index| units.name(self.style, unit, index))
        {
            let text = output.base.get_string_ref();
            text.add_all(name, LITERAL_FIELD);
            return text.outcome();
        }
        let form = self.format_and_select(offset.abs(), output)?;
        // -0.0 is in the past.
        let tense = usize::from(offset.is_sign_positive());
        let pattern = units
            .numeric_pattern(self.style, unit, tense, form)
            .ok_or(U_INVALID_FORMAT_ERROR)?;
        let text = output.base.get_string_ref();
        pattern.apply(text, 0, text.len());
        text.outcome()
    }

    /// Selects by the digits that a decimal format shows, and by the unrounded number if rules format it.
    fn format_and_select(
        &self,
        number: f64,
        output: &mut UFormattedNumberData,
    ) -> Result<PluralForm, UErrorCode> {
        let plural_rules = &self.cache.plural_rules;
        match &*self.number_format {
            NumberFormat::Decimal(format) => {
                output.quantity.set_to_double(number);
                format.formatter.format(output)?;
                Ok(plural_rules.select(&output.quantity))
            }
            NumberFormat::RuleBased(format) => {
                let mut formatted = Vec::new();
                format.format_double(number, &mut formatted)?;
                let text = output.base.get_string_ref();
                text.add_all(&formatted, GENERAL_NUMERIC_FIELD);
                Ok(plural_rules.select_double(number))
            }
        }
    }
}

/// Returns the index in `OFFSETS` if `offset`, rounded to hundredths, is an integer from -2 to 2.
fn offset_index(offset: f64) -> Option<usize> {
    let hundredths = (offset * 100.0 + 0.5_f64.copysign(offset)).trunc();
    (-2..=2).position(|whole| f64::from(whole * 100) == hundredths)
}
