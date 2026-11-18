use core::cell::OnceCell;
use core::ffi::CStr;
use std::sync::OnceLock;

use bun_engine_text::StringRef;
use bun_icu::CText;
use bun_icu::numbering_system::NumberingSystem as IcuSystem;

use crate::error::IcuResult;
use crate::language_tag::Key;
use crate::language_tag::subtag::Subtag;
use crate::locale_resolver::{LocaleResolver, ResolvedLocale};
use crate::{AvailableLocales, Cache, KeywordValue, LanguageTag, Result};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct NumberingSystem(Subtag);

impl NumberingSystem {
    /// AvailableCanonicalNumberingSystems: those that are a set of digits.
    pub(crate) fn all() -> Result<&'static [NumberingSystem]> {
        static ALL: OnceLock<bun_icu::Result<Box<[NumberingSystem]>>> = OnceLock::new();
        let all = ALL.get_or_init(|| {
            let mut names = IcuSystem::names()?;
            let mut all = Vec::new();
            while let Some(name) = names.next()? {
                if !IcuSystem::by_name(&CText::new(name)?)?.is_algorithmic() {
                    all.extend(Subtag::new(name).map(NumberingSystem));
                }
            }
            all.sort_unstable();
            Ok(all.into())
        });
        (all.as_deref().map_err(|&error| error))
            .or_type_error("failed to enumerate available numbering systems")
    }

    fn supported(name: &[u8]) -> Option<NumberingSystem> {
        let system = NumberingSystem(Subtag::new(name)?);
        let all = NumberingSystem::all().ok()?;
        all.binary_search(&system).is_ok().then_some(system)
    }

    /// The step of ResolveLocale for `nu`. `None` stands for the default of the locale.
    pub(crate) fn resolve(
        resolver: &mut LocaleResolver,
        option: Option<&KeywordValue>,
    ) -> Option<NumberingSystem> {
        resolver.keyword(
            Key::NUMBERING_SYSTEM,
            option.map(KeywordValue::as_bytes),
            NumberingSystem::supported,
        )
    }

    pub(crate) fn default_for(locale: &CStr) -> Result<NumberingSystem> {
        IcuSystem::for_locale(locale)
            .and_then(|it| Subtag::new(it.name()).ok_or(bun_icu::Error::UNSUPPORTED))
            .map(NumberingSystem)
            .or_type_error("invalid locale")
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    pub fn to_string_ref(self) -> StringRef {
        StringRef::from_latin1(self.as_bytes())
    }
}

/// The locale of a constructor whose only relevant extension key is `nu`.
#[derive(Clone)]
pub(crate) struct NumericLocale {
    locale: ResolvedLocale,
    numbering_system: Option<NumberingSystem>,
    default: OnceCell<NumberingSystem>,
}

impl PartialEq for NumericLocale {
    fn eq(&self, other: &NumericLocale) -> bool {
        self.numbering_system == other.numbering_system && self.locale == other.locale
    }
}

impl NumericLocale {
    pub(crate) fn resolve(
        cache: &Cache,
        requested: &[LanguageTag],
        option: Option<&KeywordValue>,
    ) -> Result<NumericLocale> {
        let available = AvailableLocales::general();
        let mut resolver = LocaleResolver::new(cache, available, requested);
        let numbering_system = NumberingSystem::resolve(&mut resolver, option);
        Ok(NumericLocale {
            locale: resolver.finish()?,
            numbering_system,
            default: OnceCell::new(),
        })
    }

    pub(crate) fn tag(&self) -> &LanguageTag {
        self.locale.tag()
    }

    pub(crate) fn icu_locale(&self) -> Result<CText> {
        let keyword =
            (self.numbering_system.as_ref()).map(|it| (Key::NUMBERING_SYSTEM, it.as_bytes()));
        self.locale.icu_locale(keyword.as_slice())
    }

    pub(crate) fn numbering_system(&self) -> Result<NumberingSystem> {
        match self.numbering_system {
            Some(system) => Ok(system),
            None => (self.default)
                .get_or_try_init(|| NumberingSystem::default_for(&self.locale.icu_locale(&[])?))
                .copied(),
        }
    }
}
