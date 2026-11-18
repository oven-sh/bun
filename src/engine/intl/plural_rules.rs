//! `Intl.PluralRules`

use core::cell::{Cell, OnceCell};
use std::rc::Rc;

use bun_engine_number::exact_int32;
use bun_engine_text::Text;
use bun_icu::number_format::{Collapse, IdentityFallback, NumberRangeFormatter};
use bun_icu::plural_rules::{Kind, PluralRules as IcuRules};

use crate::error::IcuResult;
use crate::locale_resolver::ResolvedLocale;
use crate::number_format::{
    CompactDisplay, DigitOptions, DigitRange, ESTIMATED_FORMATTER_SIZE,
    ESTIMATED_RANGE_FORMATTER_SIZE, MathematicalValue, Notation, RequestedDigits, ReusingFormatter,
    RoundingType, Skeleton, check_range,
};
use crate::{AvailableLocales, Cache, Error, LanguageTag, Named, Result};

option_enum! {
    #[derive(Default)]
    pub enum Type: "type must be \"cardinal\" or \"ordinal\"" {
        #[default]
        Cardinal = "cardinal",
        Ordinal = "ordinal",
    }
}

named_enum! {
    pub enum Category {
        Zero = "zero",
        One = "one",
        Two = "two",
        Few = "few",
        Many = "many",
        Other = "other",
    }
}

/// In the order that they are read.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Options {
    pub kind: Type,
    pub notation: Notation,
    pub compact_display: CompactDisplay,
    pub digits: DigitOptions,
}

/// The rest of SetNumberFormatDigitOptions, which calls `to_number` in its order.
pub fn resolve_digits<V, E: From<Error>>(
    requested: RequestedDigits<V>,
    notation: Notation,
    to_number: impl FnMut(V) -> core::result::Result<f64, E>,
) -> core::result::Result<DigitOptions, E> {
    let default_fraction = DigitRange {
        minimum: 0,
        maximum: 3,
    };
    requested.resolve(default_fraction, notation, to_number)
}

/// Those with the same locale and options are one.
#[derive(Clone)]
pub struct PluralRules(Rc<Shared>);

struct Shared {
    locale: ResolvedLocale,
    options: Options,
    rules: IcuRules,
    small_integers: [Cell<Option<Category>>; 128],
    formatter: OnceCell<ReusingFormatter>,
    range_formatter: OnceCell<NumberRangeFormatter>,
}

const FAILED_TO_INITIALIZE: &str = "failed to initialize PluralRules";
const FAILED_TO_SELECT: &str = "failed to select plural value";

impl PluralRules {
    pub fn new(cache: &Cache, requested: &[LanguageTag], options: Options) -> Result<PluralRules> {
        let locale = ResolvedLocale::new(cache, AvailableLocales::general(), requested)?;
        cache.plural_rules.find_or_insert(
            |it| it.0.options == options && it.0.locale == locale,
            || {
                cache.note_allocation(ESTIMATED_FORMATTER_SIZE);
                let kind = match options.kind {
                    Type::Cardinal => Kind::Cardinal,
                    Type::Ordinal => Kind::Ordinal,
                };
                let rules = IcuRules::open(&locale.icu_locale(&[])?, kind)
                    .or_type_error(FAILED_TO_INITIALIZE)?;
                Ok(PluralRules(Rc::new(Shared {
                    locale: locale.clone(),
                    options,
                    rules,
                    small_integers: [const { Cell::new(None) }; _],
                    formatter: OnceCell::new(),
                    range_formatter: OnceCell::new(),
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

    /// `pluralCategories`
    pub fn categories(&self) -> Result<impl Iterator<Item = Category> + use<>> {
        let mut names = self.0.rules.categories().or_type_error(FAILED_TO_SELECT)?;
        let mut is_used = [false; Category::ALL.len()];
        while let Some(name) = names.next().or_type_error(FAILED_TO_SELECT)? {
            if let Some(category) = Category::from_name(Text::Latin1(name)) {
                is_used[category as usize] = true;
            }
        }
        Ok((Category::ALL.iter().copied()).filter(move |&it| is_used[it as usize]))
    }

    pub fn select(&self, value: &MathematicalValue) -> Result<Category> {
        if value.is_nan() || value.is_infinite() {
            return Ok(Category::Other);
        }
        if let Some(integer) = value.as_number().and_then(exact_int32)
            && self.shows_integers_as_they_are()
        {
            return self.select_integer(integer);
        }
        let formatter = self.0.formatter.get_or_try_init(|| {
            let locale = self.0.locale.icu_locale(&[])?;
            ReusingFormatter::open(&self.skeleton(), &locale, &self.0.options.digits)
                .or_type_error(FAILED_TO_INITIALIZE)
        })?;
        formatter.format(value, FAILED_TO_SELECT, |number| {
            category(self.0.rules.select(number))
        })
    }

    pub fn select_range(
        &self,
        cache: &Cache,
        start: &MathematicalValue,
        end: &MathematicalValue,
    ) -> Result<Category> {
        check_range(start, end)?;
        let formatter = self.0.range_formatter.get_or_try_init(|| {
            cache.note_allocation(ESTIMATED_RANGE_FORMATTER_SIZE);
            NumberRangeFormatter::open(
                &self.skeleton(),
                &self.0.locale.icu_locale(&[])?,
                Collapse::None,
                IdentityFallback::Range,
            )
            .or_type_error(FAILED_TO_INITIALIZE)
        })?;
        let range = start
            .format_range_to(end, formatter, (&self.0.options.digits).into())
            .or_type_error("failed to select range of plural value")?;
        category(self.0.rules.select_range(&range))
    }

    fn select_integer(&self, integer: i32) -> Result<Category> {
        let known = self.0.small_integers.get(integer.unsigned_abs() as usize);
        if let Some(category) = known.and_then(Cell::get) {
            return Ok(category);
        }
        let category = category(self.0.rules.select_integer(integer))?;
        if let Some(known) = known {
            known.set(Some(category));
        }
        Ok(category)
    }

    fn shows_integers_as_they_are(&self) -> bool {
        let options = &self.0.options;
        options.notation == Notation::Standard
            && options.digits.rounding_increment.get() == 1
            && matches!(
                options.digits.rounding_type,
                RoundingType::FractionDigits(DigitRange { minimum: 0, .. })
            )
    }

    fn skeleton(&self) -> Skeleton {
        let options = &self.0.options;
        let mut skeleton = Skeleton::default();
        skeleton.push_digit_options(&options.digits);
        skeleton.push_notation(options.notation, options.compact_display);
        skeleton
    }
}

fn category(name: bun_icu::Result<bun_icu::Buffer<u16>>) -> Result<Category> {
    let name = name.or_type_error(FAILED_TO_SELECT)?;
    Ok(Category::from_name(Text::Utf16(&name)).unwrap_or(Category::Other))
}
