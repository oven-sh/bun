//! `Intl.Collator`

mod root_order;

use core::cell::OnceCell;
use core::cmp::Ordering;
use std::rc::Rc;

use bun_engine_text::{StringImpl, StringRef, Text};
use bun_icu::collator::{Attribute, Collator as IcuCollator, Value};
use root_order::RootOrder;

use crate::error::IcuResult;
use crate::language_tag::Key;
use crate::language_tag::subtag::Subtag;
use crate::locale_resolver::{LocaleResolver, ResolvedLocale};
use crate::utf16::Utf16Buffer;
use crate::{AvailableLocales, Cache, Error, KeywordValue, LanguageTag, Named, Result, collation};

option_enum! {
    #[derive(Default)]
    pub enum Usage: "usage must be either \"sort\" or \"search\"" {
        #[default]
        Sort = "sort",
        Search = "search",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum CaseFirst: "caseFirst must be either \"upper\", \"lower\", or \"false\"" {
        Upper = "upper",
        Lower = "lower",
        #[default]
        False = "false",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum Sensitivity: "sensitivity must be either \"base\", \"accent\", \"case\", or \"variant\"" {
        Base = "base",
        Accent = "accent",
        Case = "case",
        #[default]
        Variant = "variant",
    }
}

/// In the order that they are read.
#[derive(Default)]
pub struct Options {
    pub usage: Usage,
    pub collation: Option<KeywordValue>,
    pub numeric: Option<bool>,
    pub case_first: Option<CaseFirst>,
    pub sensitivity: Sensitivity,
    pub ignore_punctuation: Option<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Settings {
    usage: Usage,
    collation: Option<Subtag>,
    is_numeric: bool,
    case_first: CaseFirst,
    sensitivity: Sensitivity,
    ignore_punctuation: Option<bool>,
}

const ESTIMATED_SIZE: usize = 1 << 10;

/// Those with the same locale and options are one.
#[derive(Clone)]
pub struct Collator(Rc<Shared>);

struct Shared {
    locale: ResolvedLocale,
    settings: Settings,
    ignores_punctuation: bool,
    root_order: Option<RootOrder>,
    collator: OnceCell<IcuCollator>,
}

impl Collator {
    pub fn new(cache: &Cache, requested: &[LanguageTag], options: &Options) -> Result<Collator> {
        let (locale, settings) = resolve(cache, requested, options)?;
        cache.collators.find_or_insert(
            |it| it.0.settings == settings && it.0.locale == locale,
            || {
                cache.note_allocation(ESTIMATED_SIZE);
                Ok(Collator(Rc::new(Shared::new(locale.clone(), settings)?)))
            },
        )
    }

    /// `localeCompare` with no options and no list of locales.
    #[inline]
    pub fn compare_by_default(
        cache: &Cache,
        locale: Option<&StringImpl>,
        a: Text<'_>,
        b: Text<'_>,
    ) -> Result<Ordering> {
        cache.default_collators.with(
            cache,
            locale,
            |requested| Collator::new(cache, requested, &Options::default()),
            |collator| collator.compare(a, b),
        )
    }

    pub fn locale(&self) -> &LanguageTag {
        self.0.locale.tag()
    }

    pub fn usage(&self) -> Usage {
        self.0.settings.usage
    }

    pub fn sensitivity(&self) -> Sensitivity {
        self.0.settings.sensitivity
    }

    pub fn ignores_punctuation(&self) -> bool {
        self.0.ignores_punctuation
    }

    pub fn collation(&self) -> StringRef {
        match self.0.settings.collation {
            Some(collation) => StringRef::from_latin1(collation.as_bytes()),
            None => StringRef::from_literal("default"),
        }
    }

    pub fn is_numeric(&self) -> bool {
        self.0.settings.is_numeric
    }

    pub fn case_first(&self) -> CaseFirst {
        self.0.settings.case_first
    }

    /// CompareStrings
    #[inline(always)]
    pub fn compare(&self, a: Text<'_>, b: Text<'_>) -> Result<Ordering> {
        if let (Text::Latin1([x, ..]), Text::Latin1([y, ..])) = (a, b)
            && let Some(order) = self.0.root_order.and_then(|it| it.decide(*x, *y))
        {
            return Ok(order);
        }
        self.0.compare(a, b)
    }
}

fn resolve(
    cache: &Cache,
    requested: &[LanguageTag],
    options: &Options,
) -> Result<(ResolvedLocale, Settings)> {
    let mut resolver = LocaleResolver::new(cache, AvailableLocales::collator(), requested);
    let collation = match options.usage {
        Usage::Sort => {
            let option = options.collation.as_ref().map(KeywordValue::as_bytes);
            resolver.keyword_by_locale(Key::COLLATION, option, collation::supported)
        }
        Usage::Search => None,
    };
    let option = options.case_first.map(|it| it.as_str().as_bytes());
    let case_first = resolver.keyword(Key::CASE_FIRST, option, |value| {
        CaseFirst::from_name(Text::Latin1(value))
    });
    let option = (options.numeric).map(|it| if it { &b"true"[..] } else { b"false" });
    let is_numeric = resolver.keyword(Key::NUMERIC, option, |value| match value {
        b"true" => Some(true),
        b"false" => Some(false),
        _ => None,
    });
    let settings = Settings {
        usage: options.usage,
        collation,
        is_numeric: is_numeric.unwrap_or_default(),
        case_first: case_first.unwrap_or_default(),
        sensitivity: options.sensitivity,
        ignore_punctuation: options.ignore_punctuation,
    };
    Ok((resolver.finish()?, settings))
}

impl Shared {
    fn new(locale: ResolvedLocale, settings: Settings) -> Result<Shared> {
        let collator = OnceCell::new();
        let is_standard = settings.usage == Usage::Sort && settings.collation.is_none();
        // English has no rules of its own, so most programs never load the data.
        let (is_root, ignores_punctuation) = if is_standard && locale.tag().language() == b"en" {
            (true, settings.ignore_punctuation.unwrap_or_default())
        } else {
            let collator = collator.get_or_try_init(|| settings.open(&locale))?;
            let has = |attribute, value| collator.has(attribute, value) == Ok(true);
            (
                !collator.is_tailored() && has(Attribute::BackwardSecondary, Value::Off),
                has(Attribute::AlternateHandling, Value::Shifted),
            )
        };
        Ok(Shared {
            root_order: (is_root && !ignores_punctuation).then(|| settings.root_order()),
            locale,
            settings,
            ignores_punctuation,
            collator,
        })
    }

    #[inline(never)]
    fn compare(&self, a: Text<'_>, b: Text<'_>) -> Result<Ordering> {
        match self.root_order.and_then(|order| order.compare(a, b)) {
            Some(order) => Ok(order),
            None => self.compare_with_icu(a, b),
        }
    }

    #[inline(never)]
    fn compare_with_icu(&self, a: Text<'_>, b: Text<'_>) -> Result<Ordering> {
        let collator = (self.collator).get_or_try_init(|| self.settings.open(&self.locale))?;
        let order = match (a, b) {
            (Text::Latin1(a), Text::Latin1(b)) if a.is_ascii() && b.is_ascii() => {
                collator.compare_utf8(a, b)
            }
            _ => collator.compare(Utf16Buffer::new().widen(a)?, Utf16Buffer::new().widen(b)?),
        };
        order.or_error(Error::Plain("Failed to compare strings."))
    }
}

impl Settings {
    fn root_order(self) -> RootOrder {
        RootOrder {
            compares_accents: matches!(
                self.sensitivity,
                Sensitivity::Accent | Sensitivity::Variant
            ),
            lower_to_upper: match (self.sensitivity, self.case_first) {
                (Sensitivity::Base | Sensitivity::Accent, _) => Ordering::Equal,
                (_, CaseFirst::Upper) => Ordering::Greater,
                (_, CaseFirst::Lower | CaseFirst::False) => Ordering::Less,
            },
            is_numeric: self.is_numeric,
        }
    }

    fn open(self, locale: &ResolvedLocale) -> Result<IcuCollator> {
        let collation = match self.usage {
            Usage::Sort => self.collation.as_ref().map(Subtag::as_bytes),
            Usage::Search => Some(&b"search"[..]),
        };
        let keyword = collation.map(|it| (Key::COLLATION, it));
        IcuCollator::open(&locale.icu_locale(keyword.as_slice())?)
            .and_then(|collator| self.configure(collator))
            .or_type_error("failed to initialize Collator")
    }

    fn configure(self, mut collator: IcuCollator) -> bun_icu::Result<IcuCollator> {
        let switch = |is_on| if is_on { Value::On } else { Value::Off };
        let strength = match self.sensitivity {
            Sensitivity::Base | Sensitivity::Case => Value::Primary,
            Sensitivity::Accent => Value::Secondary,
            Sensitivity::Variant => Value::Tertiary,
        };
        let case_first = match self.case_first {
            CaseFirst::Upper => Value::UpperFirst,
            CaseFirst::Lower => Value::LowerFirst,
            CaseFirst::False => Value::Off,
        };
        let has_case_level = self.sensitivity == Sensitivity::Case;
        collator.set(Attribute::Strength, strength)?;
        collator.set(Attribute::CaseLevel, switch(has_case_level))?;
        collator.set(Attribute::CaseFirst, case_first)?;
        collator.set(Attribute::Numeric, switch(self.is_numeric))?;
        match self.ignore_punctuation {
            Some(true) => collator.set(Attribute::AlternateHandling, Value::Shifted)?,
            Some(false) => collator.set(Attribute::AlternateHandling, Value::NonIgnorable)?,
            None => {}
        }
        // Canonically equivalent strings are equal.
        collator.set(Attribute::Normalization, Value::On)?;
        Ok(collator)
    }
}
