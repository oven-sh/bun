//! The decimal format of a locale, which its numbering system determines. ICU4C: numfmt.cpp

use crate::common::locid::Locale;
use crate::common::memory::{TryClone, try_box_result, try_shared};
use crate::common::slice_ext::SliceExt;
use crate::common::udata::searches_files;
use crate::common::uinvchar::invariant_chars;
use crate::common::unistr::eq_str;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::decimfmt::DecimalFormat;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::number_patternstring::load_pattern;
use crate::i18n::numsys::NumberingSystem;
use crate::i18n::rbnf::RuleBasedNumberFormat;
use std::sync::Arc;

pub(crate) enum NumberFormat {
    Decimal(Box<DecimalFormat>),
    RuleBased(RuleBasedNumberFormat),
}

static SHARED_INSTANCES: LocaleCache<NumberFormat> = LocaleCache::new();

/// `description` is the name of a rule set, or "locale/group/name".
fn new_rule_based(
    description: &[u16],
    locale: &Locale,
) -> Result<RuleBasedNumberFormat, UErrorCode> {
    const NUMBERING_SYSTEM_RULES: &[u8] = b"NumberingSystemRules";
    let is_slash = |&unit: &u16| unit == u16::from(b'/');
    let first = description.iter().position(is_slash);
    let slashes = first.zip(description.iter().rposition(is_slash));
    let Some((first, last)) = slashes.filter(|(first, last)| last > first) else {
        return RuleBasedNumberFormat::new(locale, NUMBERING_SYSTEM_RULES, description);
    };
    let id: Vec<u8> = invariant_chars(description.slice(..first).iter().copied())?;
    let group = if eq_str(description.slice(first + 1..last), "SpelloutRules") {
        b"SpelloutRules"
    } else {
        NUMBERING_SYSTEM_RULES
    };
    let name = description.slice(last + 1..);
    RuleBasedNumberFormat::new(&Locale::create_from_name(&id), group, name)
}

impl NumberFormat {
    pub(crate) fn create_shared_instance(locale: &Locale) -> Result<Arc<Self>, UErrorCode> {
        let name = locale.get_name();
        // An entry depends on nothing but its key.
        let make = || Self::make_instance(&Locale::from_name(name), true);
        SHARED_INSTANCES.get_or_create(name, make)
    }

    /// Fails without loading any rules if the numbering system of `locale` is algorithmic.
    #[cold]
    pub(crate) fn create_decimal_instance(locale: &Locale) -> Result<DecimalFormat, UErrorCode> {
        let name = locale.get_name();
        let shared = SHARED_INSTANCES.get(name).unwrap_or_else(|| {
            match Self::make_instance(&Locale::from_name(name), false) {
                Err(U_INVALID_STATE_ERROR) => Err(U_INVALID_STATE_ERROR),
                made => SHARED_INSTANCES.get_or_create(name, || made),
            }
        })?;
        match &*shared {
            Self::Decimal(format) => format.try_clone(),
            Self::RuleBased(_) => Err(U_INVALID_STATE_ERROR),
        }
    }

    fn make_instance(locale: &Locale, allows_rules: bool) -> Result<Self, UErrorCode> {
        let system = NumberingSystem::create_instance_for_locale(locale)?;
        if system.is_algorithmic() && !allows_rules {
            return Err(U_INVALID_STATE_ERROR);
        }
        // A locale without symbols fails even if the rules belong to another locale.
        let symbols = DecimalFormatSymbols::new_with_numbering_system(locale, &system)?;
        if system.is_algorithmic() {
            return new_rule_based(system.get_description(), locale).map(Self::RuleBased);
        }
        let mut format = if searches_files()? {
            let pattern = load_pattern(locale, &system.name, b"decimalFormat")?;
            DecimalFormat::with_pattern(pattern, &try_shared(symbols)?)
        } else {
            DecimalFormat::for_linked_locale(symbols)
        };
        try_box_result(&mut format).map(Self::Decimal)
    }

    /// Returns a copy for one user, in which `change` has replaced a decimal format. The linked data need no copy.
    pub(crate) fn for_one_user(
        shared: &Arc<Self>,
        change: fn(&DecimalFormat) -> Result<DecimalFormat, UErrorCode>,
    ) -> Result<Arc<Self>, UErrorCode> {
        if !searches_files()? {
            return Ok(Arc::clone(shared));
        }
        try_shared(match &**shared {
            Self::Decimal(format) => Self::Decimal(try_box_result(&mut change(format))?),
            Self::RuleBased(format) => Self::RuleBased(format.try_clone()?),
        })
    }

    pub(crate) fn for_relative_times(shared: &Arc<Self>) -> Result<Arc<Self>, UErrorCode> {
        Self::for_one_user(shared, DecimalFormat::for_relative_times)
    }
}
