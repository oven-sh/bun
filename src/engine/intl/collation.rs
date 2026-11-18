//! The values of the `co` key.

use bun_icu::Enumeration;
use smallvec::SmallVec;

use crate::language_tag::subtag::Subtag;
use crate::locale_resolver::ResolvedLocale;

fn bcp47_name(icu_name: &[u8]) -> &[u8] {
    match icu_name {
        b"dictionary" => b"dict",
        b"gb2312han" => b"gb2312",
        b"phonebook" => b"phonebk",
        b"traditional" => b"trad",
        same => same,
    }
}

pub(crate) fn icu_name(bcp47_name: &[u8]) -> &[u8] {
    match bcp47_name {
        b"dict" => b"dictionary",
        b"gb2312" => b"gb2312han",
        b"phonebk" => b"phonebook",
        b"trad" => b"traditional",
        same => same,
    }
}

/// In ascending order, without the two that ECMA-402 does not let a script name.
pub(crate) fn collect(mut icu_names: Enumeration) -> bun_icu::Result<SmallVec<[Subtag; 8]>> {
    let mut collations = SmallVec::new();
    while let Some(name) = icu_names.next()? {
        if !matches!(name, b"standard" | b"search") {
            collations.extend(Subtag::new(bcp47_name(name)));
        }
    }
    collations.sort_unstable();
    Ok(collations)
}

pub(crate) fn supported(locale: &ResolvedLocale, name: &[u8]) -> Option<Subtag> {
    let (locale, name) = (locale.icu_locale(&[]).ok()?, Subtag::new(name)?);
    let collations = bun_icu::collator::types_for_locale(&locale).and_then(collect);
    collations.ok()?.contains(&name).then_some(name)
}
