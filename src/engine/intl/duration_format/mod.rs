//! `Intl.DurationFormat`, and `Temporal.Duration.prototype.toLocaleString`.

mod elements;
mod options;
mod output;

use core::cell::{OnceCell, RefCell};
use core::ops::Range;
use std::io::Write;
use std::rc::Rc;

use bun_engine_temporal::{Duration, Unit};
use bun_engine_text::StringRef;
use bun_icu::formatted_value::{Category, FormattedValue};
use bun_icu::list_format::{self, FormattedList, ListFormatter};
use bun_icu::number_format::{FormattedNumber, NumberFormatter};
use bun_icu::resource_bundle::ResourceBundle;
use bun_icu::{Buffer, CText};
use smallvec::SmallVec;

pub use options::{
    Display, FractionalDigits, Options, Style, UnitOptions, UnitStyle, Units, properties,
};

use crate::error::IcuResult;
use crate::number_format::Skeleton;
use crate::numbering_system::NumericLocale;
use crate::parts::new_string;
use crate::{Cache, LanguageTag, NumberingSystem, PartKind, Parts, Result};
use elements::{Element, Magnitude, elements};
use output::Output;

const NUMBER_FAILURE: &str = "Failed to format a number.";
const LIST_FAILURE: &str = "failed to format list of strings";

/// Once it has formatted three units.
const ESTIMATED_SIZE: usize = 24 * 1024;

/// Where the items of a list are in the text that joins them.
type Items = SmallVec<[Range<usize>; Unit::ALL.len()]>;

/// Those with the same locale and options are one.
#[derive(Clone)]
pub struct DurationFormat(Rc<Shared>);

struct Shared {
    locale: NumericLocale,
    icu_locale: CText,
    units: Units,
    fractional_digits: Option<FractionalDigits>,
    list_formatter: ListFormatter,
    number_formatters: [OnceCell<NumberFormatter>; Unit::ALL.len()],
    number: RefCell<FormattedNumber>,
    time_separator: OnceCell<Buffer<u16>>,
}

pub struct ResolvedOptions<'a> {
    pub locale: &'a LanguageTag,
    pub numbering_system: NumberingSystem,
    pub units: Units,
    pub fractional_digits: Option<FractionalDigits>,
}

fn find_time_separator(locale: &CText, system: NumberingSystem) -> bun_icu::Result<Buffer<u16>> {
    ResourceBundle::open(locale)?
        .by_key(c"NumberElements")?
        .by_key(&CText::new(system.as_bytes())?)?
        .by_key(c"symbols")?
        .string_by_key(c"timeSeparator")
        .map(Buffer::from_slice)
}

impl Shared {
    fn new(locale: &NumericLocale, options: &Options) -> Result<Shared> {
        let failure = "failed to initialize DurationFormat";
        let icu_locale = locale.icu_locale()?;
        let width = match options.units.style() {
            Style::Long => list_format::Width::Wide,
            Style::Short | Style::Digital => list_format::Width::Short,
            Style::Narrow => list_format::Width::Narrow,
        };
        Ok(Shared {
            list_formatter: ListFormatter::open(&icu_locale, list_format::Kind::Units, width)
                .or_type_error(failure)?,
            locale: locale.clone(),
            icu_locale,
            units: options.units,
            fractional_digits: options.fractional_digits,
            number_formatters: Default::default(),
            number: (FormattedNumber::open().or_type_error(failure)?).into(),
            time_separator: OnceCell::new(),
        })
    }

    fn time_separator(&self) -> Result<&[u16]> {
        (self.time_separator)
            .get_or_try_init(|| {
                let found = find_time_separator(&self.icu_locale, self.locale.numbering_system()?);
                Ok(found.unwrap_or_else(|_| Buffer::from_slice(&[b':'.into()])))
            })
            .map(|separator| &**separator)
    }

    fn skeleton(&self, unit: Unit) -> Skeleton {
        let mut skeleton = Skeleton::default();
        if self.units.has_fraction(unit) {
            skeleton.push_stem("rounding-mode-down .");
            match self.fractional_digits {
                Some(digits) => skeleton.append_repeated(b'0', digits.get().into()),
                None => skeleton.append_repeated(b'#', 9),
            }
        }
        let style = self.units.get(unit).style;
        if !style.is_numeric() {
            skeleton.push_stem("measure-unit/duration-");
            skeleton.append(unit.singular().as_bytes());
        }
        skeleton.push_stem(match style {
            UnitStyle::Long => "unit-width-full-name",
            UnitStyle::Short => "unit-width-short",
            UnitStyle::Narrow => "unit-width-narrow",
            UnitStyle::Numeric => "group-off",
            UnitStyle::TwoDigit => "group-off integer-width/*00",
        });
        skeleton
    }

    fn format_number(&self, element: &Element, result: &mut FormattedNumber) -> Result<()> {
        let formatter = (self.number_formatters[element.unit as usize])
            .get_or_try_init(|| {
                NumberFormatter::open(&self.skeleton(element.unit), &self.icu_locale)
            })
            .or_type_error("Failed to initialize NumberFormat")?;
        match element.magnitude {
            Magnitude::Whole(number) if element.shows_minus_sign => {
                formatter.format_double(-number, result)
            }
            Magnitude::Whole(number) => formatter.format_double(number, result),
            Magnitude::Nanoseconds(nanoseconds) => {
                let sign = if element.shows_minus_sign { "-" } else { "" };
                let digits_below = 3 * (Unit::Nanosecond as u8 - element.unit as u8);
                let mut buffer = [0; 48];
                let mut rest = &mut buffer[..];
                let _ = write!(rest, "{sign}{nanoseconds}E-{digits_below}");
                let unused = rest.len();
                formatter.format_decimal(&buffer[..buffer.len() - unused], result)
            }
        }
        .or_type_error(NUMBER_FAILURE)
    }

    fn write_items(&self, duration: &Duration, out: &mut impl Output) -> Result<Items> {
        let mut number = self.number.borrow_mut();
        let mut items = Items::new();
        let mut start = 0;
        for element in &elements(&self.units, duration) {
            if element.is_joined {
                out.push_separator(self.time_separator()?)?;
                items.pop();
            } else {
                start = out.text().len();
            }
            self.format_number(element, &mut number)?;
            out.push_number(element, number.value().or_type_error(NUMBER_FAILURE)?)?;
            items.push(start..out.text().len());
        }
        Ok(items)
    }

    fn format_list(&self, text: &[u16], items: &Items) -> Result<FormattedList> {
        (self.list_formatter)
            .format(items.iter().map(|item| &text[item.clone()]))
            .or_type_error(LIST_FAILURE)
    }
}

impl DurationFormat {
    pub fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        options: &Options,
    ) -> Result<DurationFormat> {
        let locale = NumericLocale::resolve(cache, requested, options.numbering_system.as_ref())?;
        cache.duration_formats.find_or_insert(
            |it| {
                it.0.units == options.units
                    && it.0.fractional_digits == options.fractional_digits
                    && it.0.locale == locale
            },
            || {
                cache.note_allocation(ESTIMATED_SIZE);
                Shared::new(&locale, options).map(|it| DurationFormat(Rc::new(it)))
            },
        )
    }

    pub fn format(&self, duration: &Duration) -> Result<StringRef> {
        let mut text = SmallVec::new();
        let items = self.0.write_items(duration, &mut text)?;
        if items.len() <= 1 {
            return new_string(&text);
        }
        let list = self.0.format_list(&text, &items)?;
        new_string((list.value().and_then(FormattedValue::text)).or_type_error(LIST_FAILURE)?)
    }

    pub fn format_to_parts(&self, duration: &Duration) -> Result<Parts> {
        let mut item_parts = Parts::default();
        let items = self.0.write_items(duration, &mut item_parts)?;
        if items.len() <= 1 {
            return Ok(item_parts);
        }

        let list = self.0.format_list(item_parts.text(), &items)?;
        let list = list.value().or_type_error(LIST_FAILURE)?;
        let text = list.text().or_type_error(LIST_FAILURE)?;
        let mut fields = (list.fields_matching(Category::LIST, list_format::ELEMENT_FIELD))
            .or_type_error(LIST_FAILURE)?;
        let mut parts = Parts::default();
        let mut remaining = item_parts.slices();
        let mut done = 0;
        for item in items {
            if let Some(field) = fields.next().or_type_error(LIST_FAILURE)? {
                let literal = text.get(done..field.range.start);
                parts.push(PartKind::Literal, literal.unwrap_or_default())?;
                done = field.range.end;
            }
            let mut left = item.len();
            while left != 0
                && let Some((part, value)) = remaining.next()
            {
                parts.push(part, value)?;
                left = left.saturating_sub(value.len());
            }
        }
        parts.push(PartKind::Literal, text.get(done..).unwrap_or_default())?;
        Ok(parts)
    }

    pub fn resolved_options(&self) -> Result<ResolvedOptions<'_>> {
        Ok(ResolvedOptions {
            locale: self.0.locale.tag(),
            numbering_system: self.0.locale.numbering_system()?,
            units: self.0.units,
            fractional_digits: self.0.fractional_digits,
        })
    }
}
