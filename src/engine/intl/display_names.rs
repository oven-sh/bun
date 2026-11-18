//! `Intl.DisplayNames`

use std::rc::Rc;

use bun_engine_text::{StringRef, Text};
use bun_icu::currency::{self, NameStyle};
use bun_icu::date_pattern::{Field, Width};
use bun_icu::display_names::{Dialects, DisplayNames as IcuNames, Length};
use bun_icu::{Buffer, CText};

use crate::error::IcuResult;
use crate::language_tag::subtag::{
    Subtag, Subtags, is_region, is_script, is_singleton, is_value, lowercase_subtags,
};
use crate::locale_resolver::ResolvedLocale;
use crate::number_format::Currency;
use crate::parts::new_string;
use crate::{AvailableLocales, Cache, Error, LanguageTag, Named, Result, calendar};

option_enum! {
    #[derive(Default)]
    pub enum Style: "style must be either \"narrow\", \"short\", or \"long\"" {
        Narrow = "narrow",
        Short = "short",
        #[default]
        Long = "long",
    }
}

option_enum! {
    pub enum Type: "type must be either \"language\", \"region\", \"script\", \"currency\", \"calendar\", or \"dateTimeField\"" {
        Language = "language",
        Region = "region",
        Script = "script",
        Currency = "currency",
        Calendar = "calendar",
        DateTimeField = "dateTimeField",
    }
}

impl Type {
    pub fn required(option: Option<Type>) -> Result<Type> {
        option.ok_or(Error::Type("type must not be undefined"))
    }
}

option_enum! {
    #[derive(Default)]
    pub enum Fallback: "fallback must be either \"code\" or \"none\"" {
        #[default]
        Code = "code",
        None = "none",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum LanguageDisplay: "languageDisplay must be either \"dialect\" or \"standard\"" {
        #[default]
        Dialect = "dialect",
        Standard = "standard",
    }
}

named_enum! {
    enum DateTimeField {
        Era = "era",
        Year = "year",
        Quarter = "quarter",
        Month = "month",
        WeekOfYear = "weekOfYear",
        Weekday = "weekday",
        Day = "day",
        DayPeriod = "dayPeriod",
        Hour = "hour",
        Minute = "minute",
        Second = "second",
        TimeZoneName = "timeZoneName",
    }
}

/// In the order that they are read. `language_display` applies to `Type::Language`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Options {
    pub style: Style,
    pub kind: Type,
    pub fallback: Fallback,
    pub language_display: LanguageDisplay,
}

const ESTIMATED_SIZE: usize = 4 << 10;

/// Those with the same locale and options are one.
#[derive(Clone)]
pub struct DisplayNames(Rc<Shared>);

struct Shared {
    locale: ResolvedLocale,
    options: Options,
    icu_locale: CText,
    source: Source,
}

enum Source {
    Languages(IcuNames),
    Regions(IcuNames),
    Scripts(IcuNames),
    Calendars(IcuNames),
    Currencies,
    DateTimeFields,
}

const FAILED_TO_QUERY: &str = "Failed to query a display name.";

impl DisplayNames {
    pub fn new(cache: &Cache, requested: &[LanguageTag], options: Options) -> Result<DisplayNames> {
        let locale = ResolvedLocale::new(cache, AvailableLocales::general(), requested)?;
        cache.display_names.find_or_insert(
            |it| it.0.options == options && it.0.locale == locale,
            || {
                cache.note_allocation(ESTIMATED_SIZE);
                let icu_locale = locale.icu_locale(&[])?;
                Ok(DisplayNames(Rc::new(Shared {
                    source: Source::open(&icu_locale, options)?,
                    locale: locale.clone(),
                    options,
                    icu_locale,
                })))
            },
        )
    }

    pub fn locale(&self) -> &LanguageTag {
        self.0.locale.tag()
    }

    pub fn options(&self) -> &Options {
        &self.0.options
    }

    pub fn of(&self, cache: &Cache, code: Text<'_>) -> Result<Option<StringRef>> {
        match &self.0.source {
            Source::Languages(names) => {
                let tag =
                    language_id(code)?.ok_or(Error::Range("argument is not a language id"))?;
                self.look_up(tag.as_bytes(), |code| names.of_locale(code))
            }
            Source::Regions(names) => {
                let region = single_subtag(code, is_region)
                    .ok_or(Error::Range("argument is not a region subtag"))?;
                self.look_up(region.to_uppercase().as_bytes(), |code| {
                    names.of_region(code)
                })
            }
            Source::Scripts(names) => {
                let script = single_subtag(code, is_script)
                    .ok_or(Error::Range("argument is not a script subtag"))?;
                self.look_up(script.to_titlecase().as_bytes(), |code| {
                    names.of_script(code)
                })
            }
            Source::Calendars(names) => {
                let calendar = lowercase_subtags(code)?
                    .filter(|it| Subtags::new(it).all(is_value))
                    .ok_or(Error::Range("argument is not a calendar code"))?;
                let name = CText::new(calendar::icu_name(&calendar))
                    .and_then(|code| names.of_calendar(&code))
                    .or_type_error(FAILED_TO_QUERY)?;
                self.name_or_fallback(name.as_deref(), &calendar)
            }
            Source::Currencies => self.of_currency(code),
            Source::DateTimeFields => self.of_date_time_field(cache, code),
        }
    }

    fn of_currency(&self, code: Text<'_>) -> Result<Option<StringRef>> {
        let code = Currency::parse(code)
            .ok_or(Error::Range("argument is not a well-formed currency code"))?
            .code();
        let style = match self.0.options.style {
            Style::Narrow => NameStyle::NarrowSymbol,
            Style::Short => NameStyle::Symbol,
            Style::Long => NameStyle::Long,
        };
        let name = currency::name(code, &self.0.icu_locale, style);
        self.name_or_fallback(name.or_type_error(FAILED_TO_QUERY)?, &code)
    }

    fn of_date_time_field(&self, cache: &Cache, code: Text<'_>) -> Result<Option<StringRef>> {
        let code = DateTimeField::from_name(code)
            .ok_or(Error::Range("argument is not a dateTimeField code"))?;
        let field = match code {
            DateTimeField::Era => Field::Era,
            DateTimeField::Year => Field::Year,
            DateTimeField::Quarter => Field::Quarter,
            DateTimeField::Month => Field::Month,
            DateTimeField::WeekOfYear => Field::WeekOfYear,
            DateTimeField::Weekday => Field::Weekday,
            DateTimeField::Day => Field::Day,
            DateTimeField::DayPeriod => Field::DayPeriod,
            DateTimeField::Hour => Field::Hour,
            DateTimeField::Minute => Field::Minute,
            DateTimeField::Second => Field::Second,
            DateTimeField::TimeZoneName => Field::Zone,
        };
        let width = match self.0.options.style {
            Style::Narrow => Width::Narrow,
            Style::Short => Width::Abbreviated,
            Style::Long => Width::Wide,
        };
        let name = cache.dates.field_name(&self.0.icu_locale, field, width);
        self.name_or_fallback(name.as_deref().ok(), code.as_str().as_bytes())
    }

    fn look_up(
        &self,
        code: &[u8],
        name_of: impl FnOnce(&CText) -> bun_icu::Result<Option<Buffer<u16>>>,
    ) -> Result<Option<StringRef>> {
        let name = CText::new(code).and_then(|code| name_of(&code));
        self.name_or_fallback(name.or_type_error(FAILED_TO_QUERY)?.as_deref(), code)
    }

    fn name_or_fallback(&self, name: Option<&[u16]>, code: &[u8]) -> Result<Option<StringRef>> {
        match (name, self.0.options.fallback) {
            (Some(name), _) => new_string(name).map(Some),
            (None, Fallback::Code) => Ok(Some(StringRef::try_from_units(code)?)),
            (None, Fallback::None) => Ok(None),
        }
    }
}

impl Source {
    fn open(locale: &CText, options: Options) -> Result<Source> {
        let with_names = match options.kind {
            Type::Language => Source::Languages,
            Type::Region => Source::Regions,
            Type::Script => Source::Scripts,
            Type::Calendar => Source::Calendars,
            Type::Currency => return Ok(Source::Currencies),
            Type::DateTimeField => return Ok(Source::DateTimeFields),
        };
        let dialects = match options.language_display {
            LanguageDisplay::Dialect => Dialects::Named,
            LanguageDisplay::Standard => Dialects::Standard,
        };
        let length = match options.style {
            Style::Narrow | Style::Short => Length::Short,
            Style::Long => Length::Full,
        };
        IcuNames::open(locale, dialects, length)
            .map(with_names)
            .or_type_error("failed to initialize DisplayNames")
    }
}

fn language_id(code: Text<'_>) -> Result<Option<LanguageTag>> {
    match lowercase_subtags(code)? {
        Some(subtags) if !Subtags::new(&subtags).any(is_singleton) => {
            LanguageTag::canonicalize(code)
        }
        _ => Ok(None),
    }
}

fn single_subtag(code: Text<'_>, accepts: fn(&[u8]) -> bool) -> Option<Subtag> {
    Subtag::from_text(code).filter(|it| accepts(it.as_bytes()))
}
