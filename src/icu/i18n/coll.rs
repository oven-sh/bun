//! Opens a collator for a locale ID and lists the available locales. ICU4C: coll.cpp

use crate::common::locid::Locale;
use crate::common::memory::try_collect_results;
use crate::common::propname::uscript_get_code;
use crate::common::resource::ResourceTable;
use crate::common::umutex::OnceBox;
use crate::common::uresimp::U_ICUDATA_COLL;
use crate::common::uresimp::ures_open_direct;
use crate::common::utypes::*;
use crate::i18n::rulebasedcollator::RuleBasedCollator;
use crate::i18n::ucol_res;
use crate::i18n::unicode::ucol::*;
use bun_core::strings;

pub(crate) fn open(locale_id: &[u8]) -> Result<RuleBasedCollator, UErrorCode> {
    let locale = Locale::from_name(locale_id);
    if locale.is_bogus() {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let mut coll = RuleBasedCollator::new(ucol_res::load_tailoring(&locale)?);
    if ucol_res::has_keywords(&locale) {
        set_attributes_from_keywords(&locale, &mut coll)?;
    }
    Ok(coll)
}

const ATTRIBUTES: [(&[u8], UColAttribute); 7] = [
    (b"colStrength", UCOL_STRENGTH),
    (b"colBackwards", UCOL_FRENCH_COLLATION),
    (b"colCaseLevel", UCOL_CASE_LEVEL),
    (b"colCaseFirst", UCOL_CASE_FIRST),
    (b"colAlternate", UCOL_ALTERNATE_HANDLING),
    (b"colNormalization", UCOL_NORMALIZATION_MODE),
    (b"colNumeric", UCOL_NUMERIC_COLLATION),
];

const ATTRIBUTE_VALUES: [(&[u8], UColAttributeValue); 11] = [
    (b"primary", UCOL_PRIMARY),
    (b"secondary", UCOL_SECONDARY),
    (b"tertiary", UCOL_TERTIARY),
    (b"quaternary", UCOL_QUATERNARY),
    (b"identical", UCOL_IDENTICAL),
    (b"no", UCOL_OFF),
    (b"yes", UCOL_ON),
    (b"shifted", UCOL_SHIFTED),
    (b"non-ignorable", UCOL_NON_IGNORABLE),
    (b"lower", UCOL_LOWER_FIRST),
    (b"upper", UCOL_UPPER_FIRST),
];

/// The names of the reorder codes starting at `UCOL_REORDER_CODE_FIRST`.
const REORDER_CODES: [&[u8]; 5] = [b"space", b"punct", b"symbol", b"currency", b"digit"];

fn reorder_code(name: &[u8]) -> Result<i32, UErrorCode> {
    let index = REORDER_CODES
        .iter()
        .position(|code| name.eq_ignore_ascii_case(code))
        .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
    Ok(UCOL_REORDER_CODE_FIRST + index as i32)
}

const MAX_VALUE_LENGTH: usize = 1023;

fn set_attributes_from_keywords(
    locale: &Locale,
    coll: &mut RuleBasedCollator,
) -> Result<(), UErrorCode> {
    let value_of = |keyword: &[u8]| {
        locale
            .get_keyword_value(keyword)
            .ok()
            .filter(|value| value.len() <= MAX_VALUE_LENGTH)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)
    };
    for keyword in [&b"colHiraganaQuaternary"[..], b"variableTop"] {
        if !value_of(keyword)?.is_empty() {
            return Err(U_UNSUPPORTED_ERROR);
        }
    }
    for (keyword, attribute) in ATTRIBUTES {
        let name = value_of(keyword)?;
        if !name.is_empty() {
            let known = ATTRIBUTE_VALUES
                .iter()
                .find(|(known, _)| name.eq_ignore_ascii_case(known));
            coll.set_attribute(attribute, known.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?.1)?;
        }
    }
    let names = value_of(b"colReorder")?;
    if !names.is_empty() {
        let code = |name: &[u8]| match name.len() {
            4 => uscript_get_code(name).ok_or(U_ILLEGAL_ARGUMENT_ERROR),
            _ => reorder_code(name),
        };
        coll.set_reorder_codes(&try_collect_results(
            strings::split(&names, b"-").map(code),
        )?)?;
    }
    let name = value_of(b"kv")?;
    if !name.is_empty() {
        coll.set_max_variable(reorder_code(&name)?)?;
    }
    Ok(())
}

/// The keys are the locale IDs.
pub(crate) fn available_locales() -> Option<&'static ResourceTable> {
    static INSTALLED: OnceBox<Result<ResourceTable, UErrorCode>> = OnceBox::new();
    let load = || {
        let index = ures_open_direct(Some(U_ICUDATA_COLL), b"res_index")?;
        let installed = index.get_by_key(b"InstalledLocales")?;
        installed.get_value().get_table()
    };
    INSTALLED.get_or_init_caching_err(load).ok()
}
