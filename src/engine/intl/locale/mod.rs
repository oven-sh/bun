//! `Intl.Locale`

mod info;
mod options;

use bun_engine_text::{StringImpl, StringRef};
pub use info::{Direction, WeekInfo};
pub use options::Options;

use crate::language_tag::subtag::{Subtags, is_region, is_script, is_variant};
use crate::language_tag::{Key, LanguageId, LocaleId};
use crate::{Cache, Error, LanguageTag, Result};

/// The values of the `fw` key.
const WEEKDAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

#[derive(Clone)]
pub struct Locale(LanguageTag);

impl Locale {
    /// The steps before the options are read.
    pub fn new(cache: &Cache, tag: &StringImpl) -> Result<Locale> {
        let canonical = cache.canonicalize_if_valid(tag)?;
        canonical
            .map(Locale)
            .ok_or(Error::Range("invalid language tag"))
    }

    pub fn with_options(&self, mut options: Options) -> Result<Locale> {
        let mut id = self.parse()?;
        options.apply_to(&mut id);
        id.into_canonical().map(Locale)
    }

    pub fn maximize(&self) -> Result<Locale> {
        self.with_changed_language_id(LanguageId::maximize)
    }

    pub fn minimize(&self) -> Result<Locale> {
        self.with_changed_language_id(LanguageId::minimize)
    }

    fn with_changed_language_id(&self, change: fn(&mut LanguageId)) -> Result<Locale> {
        let mut id = self.parse()?;
        change(&mut id.language_id);
        id.into_canonical().map(Locale)
    }

    fn parse(&self) -> Result<LocaleId<'_>> {
        LocaleId::parse(self.0.as_bytes())?.ok_or(Error::Type("failed to initialize Locale"))
    }

    /// `toString`
    pub fn tag(&self) -> &LanguageTag {
        &self.0
    }

    pub fn base_name(&self) -> StringRef {
        self.0.substring(self.0.base_name())
    }

    pub fn language(&self) -> StringRef {
        self.0.substring(self.0.language())
    }

    pub fn script(&self) -> Option<StringRef> {
        Some(self.0.substring(self.base_subtags().script?))
    }

    pub fn region(&self) -> Option<StringRef> {
        Some(self.0.substring(self.base_subtags().region?))
    }

    pub fn variants(&self) -> Option<StringRef> {
        let variants = self.base_subtags().rest.run(is_variant);
        (!variants.is_empty()).then(|| self.0.substring(variants))
    }

    pub fn calendar(&self) -> Option<StringRef> {
        self.keyword(Key::CALENDAR)
    }

    pub fn case_first(&self) -> Option<StringRef> {
        self.keyword(Key::CASE_FIRST)
    }

    pub fn collation(&self) -> Option<StringRef> {
        self.keyword(Key::COLLATION)
    }

    pub fn first_day_of_week(&self) -> Option<StringRef> {
        self.keyword(Key::FIRST_DAY)
    }

    pub fn hour_cycle(&self) -> Option<StringRef> {
        self.keyword(Key::HOUR_CYCLE)
    }

    pub fn numbering_system(&self) -> Option<StringRef> {
        self.keyword(Key::NUMBERING_SYSTEM)
    }

    pub fn is_numeric(&self) -> bool {
        self.0.keyword(Key::NUMERIC).is_some_and(<[u8]>::is_empty)
    }

    fn keyword(&self, key: Key) -> Option<StringRef> {
        Some(self.0.substring(self.0.keyword(key)?))
    }

    fn base_subtags(&self) -> BaseSubtags<'_> {
        let mut rest = Subtags::new(self.0.as_bytes());
        BaseSubtags {
            language: rest.next().unwrap_or_default(),
            script: rest.next_if(is_script),
            region: rest.next_if(is_region),
            rest,
        }
    }
}

struct BaseSubtags<'a> {
    language: &'a [u8],
    script: Option<&'a [u8]>,
    region: Option<&'a [u8]>,
    rest: Subtags<'a>,
}
