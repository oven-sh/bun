//! The decimal format of a locale, which its numbering system determines. ICU4C: numfmt.cpp

use crate::common::cstring::split_once;
use crate::common::locid::Locale;
use crate::common::memory::try_box_result;
use crate::common::uinvchar::invariant_chars;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::decimfmt::DecimalFormat;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::numsys::NumberingSystem;
use crate::i18n::rbnf::RuleBasedNumberFormat;
use std::sync::Arc;

pub(crate) enum NumberFormat {
    Decimal(Box<DecimalFormat>),
    RuleBased(RuleBasedNumberFormat),
}

/// `description` is the name of a rule set, or "locale/group/name".
fn new_rule_based(
    description: &[u16],
    locale: &Locale,
) -> Result<RuleBasedNumberFormat, UErrorCode> {
    let description: Vec<u8> = invariant_chars(description.iter().copied())?;
    let (id, Some(rest)) = split_once(&description, b'/') else {
        return RuleBasedNumberFormat::new(locale, b"NumberingSystemRules", &description);
    };
    let (group, name) = split_once(rest, b'/');
    RuleBasedNumberFormat::new(&Locale::from_name(id), group, name.unwrap_or_default())
}

impl NumberFormat {
    pub(crate) fn create_shared_instance(locale: &Locale) -> Result<Arc<Self>, UErrorCode> {
        static SHARED_INSTANCES: LocaleCache<NumberFormat> = LocaleCache::new();
        let name = locale.get_name();
        // An entry depends on nothing but its key.
        SHARED_INSTANCES.get_or_create(name, || Self::make_instance(&Locale::from_name(name)))
    }

    fn make_instance(locale: &Locale) -> Result<Self, UErrorCode> {
        let system = NumberingSystem::create_instance_for_locale(locale)?;
        // A locale without symbols fails even if the rules belong to another locale.
        let symbols = DecimalFormatSymbols::new_with_numbering_system(locale, &system)?;
        if system.is_algorithmic() {
            new_rule_based(system.get_description(), locale).map(Self::RuleBased)
        } else {
            try_box_result(&mut DecimalFormat::for_locale(symbols)).map(Self::Decimal)
        }
    }
}
