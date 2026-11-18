//! `Intl.RelativeTimeFormat`

use core::cell::RefCell;
use std::rc::Rc;

use bun_engine_text::{StringRef, Text};
use bun_icu::formatted_value::{Category, FormattedValue};
use bun_icu::relative_time_format::{
    self as icu, FormattedRelativeTime, NUMERIC_FIELD, RelativeTimeFormatter,
};

use crate::error::IcuResult;
use crate::number_format::ESTIMATED_FORMATTER_SIZE;
use crate::number_format::parts::{FieldContext, collect_fields, push_flattened};
use crate::numbering_system::NumericLocale;
use crate::parts::new_string;
use crate::{
    Cache, Error, KeywordValue, LanguageTag, Named, NumberingSystem, Part, Parts, Result, Style,
    TimeUnit,
};

option_enum! {
    #[derive(Default)]
    pub enum Numeric: "numeric must be either \"always\" or \"auto\"" {
        #[default]
        Always = "always",
        Auto = "auto",
    }
}

pub struct RelativeTimeFormat {
    formatter: Formatter,
    numeric: Numeric,
}

/// One for all that have the same locale and style.
#[derive(Clone)]
pub(crate) struct Formatter(Rc<Shared>);

struct Shared {
    locale: NumericLocale,
    style: Style,
    formatter: RelativeTimeFormatter,
    result: RefCell<FormattedRelativeTime>,
}

const FAILED_TO_FORMAT: &str = "failed to format relative time";

impl RelativeTimeFormat {
    pub fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        numbering_system: Option<&KeywordValue>,
        style: Style,
        numeric: Numeric,
    ) -> Result<RelativeTimeFormat> {
        let locale = NumericLocale::resolve(cache, requested, numbering_system)?;
        let formatter = cache.relative_time_formatters.find_or_insert(
            |it| it.0.style == style && it.0.locale == locale,
            || {
                cache.note_allocation(ESTIMATED_FORMATTER_SIZE);
                let failure = "failed to initialize RelativeTimeFormat";
                let icu_style = match style {
                    Style::Long => icu::Style::Long,
                    Style::Short => icu::Style::Short,
                    Style::Narrow => icu::Style::Narrow,
                };
                let formatter = RelativeTimeFormatter::open(&locale.icu_locale()?, icu_style);
                Ok(Formatter(Rc::new(Shared {
                    locale: locale.clone(),
                    style,
                    formatter: formatter.or_type_error(failure)?,
                    result: RefCell::new(FormattedRelativeTime::open().or_type_error(failure)?),
                })))
            },
        )?;
        Ok(RelativeTimeFormat { formatter, numeric })
    }

    pub fn locale(&self) -> &LanguageTag {
        self.formatter.0.locale.tag()
    }

    pub fn style(&self) -> Style {
        self.formatter.0.style
    }

    pub fn numeric(&self) -> Numeric {
        self.numeric
    }

    pub fn numbering_system(&self) -> Result<NumberingSystem> {
        self.formatter.0.locale.numbering_system()
    }

    pub fn format(&self, value: f64, unit: Text<'_>) -> Result<StringRef> {
        self.with_formatted(value, unit, |formatted, _| {
            new_string(formatted.text().or_type_error(FAILED_TO_FORMAT)?)
        })
    }

    pub fn format_to_parts(&self, value: f64, unit: Text<'_>) -> Result<Parts> {
        self.with_formatted(value, unit, |formatted, unit| {
            let text = formatted.text().or_type_error(FAILED_TO_FORMAT)?;
            let mut fields = collect_fields(formatted, FAILED_TO_FORMAT)?;
            fields.retain(|it| it.category == Category::NUMBER || it.field == NUMERIC_FIELD);
            let mut parts = Parts::default();
            push_flattened(&mut parts, text, fields, |field, _| Part {
                kind: FieldContext::default().kind_of(field),
                unit: field.map(|_| unit),
                source: None,
            })?;
            Ok(parts)
        })
    }

    fn with_formatted<T>(
        &self,
        value: f64,
        unit: Text<'_>,
        read: impl FnOnce(FormattedValue<'_>, TimeUnit) -> Result<T>,
    ) -> Result<T> {
        if !value.is_finite() {
            return Err(Error::Range("number argument must be finite"));
        }
        let (unit, icu_unit) = singular_unit(unit)
            .ok_or(Error::Range("unit argument is not a recognized unit type"))?;
        let formatter = &self.formatter.0.formatter;
        let mut result = self.formatter.0.result.borrow_mut();
        let outcome = if self.numeric == Numeric::Auto && value.trunc() == value {
            formatter.format(value, icu_unit, &mut result)
        } else {
            formatter.format_numeric(value, icu_unit, &mut result)
        };
        let formatted = outcome.and_then(|()| result.value());
        read(formatted.or_type_error(FAILED_TO_FORMAT)?, unit)
    }
}

/// SingularRelativeTimeUnit
fn singular_unit(name: Text<'_>) -> Option<(TimeUnit, icu::Unit)> {
    let plural_ending = usize::from(name.ends_with(Text::from_ascii("s")));
    let unit = TimeUnit::from_name(name.slice(0..name.len() - plural_ending))?;
    let icu_unit = match unit {
        TimeUnit::Year => icu::Unit::Year,
        TimeUnit::Quarter => icu::Unit::Quarter,
        TimeUnit::Month => icu::Unit::Month,
        TimeUnit::Week => icu::Unit::Week,
        TimeUnit::Day => icu::Unit::Day,
        TimeUnit::Hour => icu::Unit::Hour,
        TimeUnit::Minute => icu::Unit::Minute,
        TimeUnit::Second => icu::Unit::Second,
        TimeUnit::Millisecond | TimeUnit::Microsecond | TimeUnit::Nanosecond => return None,
    };
    Some((unit, icu_unit))
}
