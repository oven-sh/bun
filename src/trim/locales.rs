use crate::error::TrimRequestError;
use crate::model::{IcuLanguage, LocaleGroup, UsedLocales, WantedLocaleGroups};

/// Gives the tag under which `Intl` looks for the data of a language tag, which is what `Intl.getCanonicalLocales`
/// gives: `he` for `iw`. `None` for a text that is no language tag.
pub type CanonicalLocaleTag = fn(&[u8]) -> Option<Box<[u8]>>;

pub(crate) fn resolve_wanted_groups(
    used: &UsedLocales,
    requested: Option<&[Box<[u8]>]>,
    languages: &[IcuLanguage],
    canonical_tag: CanonicalLocaleTag,
) -> Result<WantedLocaleGroups, TrimRequestError> {
    if languages.is_empty() {
        return Ok(WantedLocaleGroups::All);
    }

    let mut groups = Vec::new();
    match (requested, used) {
        (Some(tags), _) => {
            for tag in tags {
                let group = find_requested_group(languages, tag, canonical_tag)
                    .ok_or_else(|| TrimRequestError::UnknownLocale(tag.clone()))?;
                groups.push(group);
            }
        }
        (None, UsedLocales::Unknown(_)) => return Ok(WantedLocaleGroups::All),
        (None, UsedLocales::Listed(tags)) => {
            for tag in tags {
                let Some(group) = find_tag_group(languages, &tag.0) else {
                    return Ok(WantedLocaleGroups::All);
                };
                groups.push(group);
            }
        }
    }

    groups.sort_unstable();
    groups.dedup();
    Ok(WantedLocaleGroups::Listed(groups))
}

/// The program asks `Intl` for the tag as it is written, and `Intl` opens the data of the canonical tag. A text that is
/// no language tag (`de_DE.UTF-8`) still starts with a language.
fn find_requested_group(
    languages: &[IcuLanguage],
    tag: &[u8],
    canonical_tag: CanonicalLocaleTag,
) -> Option<LocaleGroup> {
    let canonical = canonical_tag(tag).or_else(|| canonical_tag(language_subtag(tag)?))?;
    find_tag_group(languages, &canonical)
}

fn find_tag_group(languages: &[IcuLanguage], tag: &[u8]) -> Option<LocaleGroup> {
    find_group(languages, language_of(tag)?)
}

fn language_subtag(tag: &[u8]) -> Option<&[u8]> {
    let language = bun_core::strings::split_any(tag, b"-_").next()?;
    let is_language =
        matches!(language.len(), 2 | 3) && language.iter().all(u8::is_ascii_alphabetic);
    is_language.then_some(language)
}

fn language_of(tag: &[u8]) -> Option<[u8; 4]> {
    let language = language_subtag(tag)?;
    let mut name = [0; 4];
    name[..language.len()].copy_from_slice(language);
    name.make_ascii_lowercase();
    Some(name)
}

fn find_group(languages: &[IcuLanguage], name: [u8; 4]) -> Option<LocaleGroup> {
    let position = languages
        .binary_search_by_key(&name, |language| language.name)
        .ok()?;
    Some(languages[position].group)
}

impl WantedLocaleGroups {
    pub(crate) fn contains(&self, group: LocaleGroup) -> bool {
        match self {
            WantedLocaleGroups::All => true,
            WantedLocaleGroups::Listed(groups) => groups.binary_search(&group).is_ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LocaleTag;

    const UNKNOWN: UsedLocales = UsedLocales::Unknown(None);
    const ALL: Result<WantedLocaleGroups, TrimRequestError> = Ok(WantedLocaleGroups::All);

    fn languages() -> Vec<IcuLanguage> {
        [
            (*b"de\0\0", 0),
            (*b"en\0\0", 1),
            (*b"fil\0", 2),
            (*b"nb\0\0", 3),
            (*b"no\0\0", 3),
            (*b"zh\0\0", 4),
        ]
        .map(|(name, group)| IcuLanguage {
            name,
            group: LocaleGroup(group),
        })
        .to_vec()
    }

    fn listed(tags: &[&str]) -> UsedLocales {
        let tags = tags.iter().map(|tag| LocaleTag(Box::from(tag.as_bytes())));
        UsedLocales::Listed(tags.collect())
    }

    // `tl` stands for `fil` and `aam` for `aas`. A text with `_` or `.` is no language tag.
    fn canonical_tag(tag: &[u8]) -> Option<Box<[u8]>> {
        if bun_core::strings::index_of_any(tag, b"_.").is_some() {
            return None;
        }
        Some(match tag {
            b"tl" => Box::from(&b"fil"[..]),
            b"tl-PH" => Box::from(&b"fil-PH"[..]),
            b"aam" => Box::from(&b"aas"[..]),
            _ => Box::from(tag),
        })
    }

    fn resolve(
        used: &UsedLocales,
        requested: Option<&[&str]>,
    ) -> Result<WantedLocaleGroups, TrimRequestError> {
        let requested: Option<Vec<Box<[u8]>>> =
            requested.map(|tags| tags.iter().map(|tag| Box::from(tag.as_bytes())).collect());
        resolve_wanted_groups(used, requested.as_deref(), &languages(), canonical_tag)
    }

    fn wanted(groups: &[u16]) -> Result<WantedLocaleGroups, TrimRequestError> {
        let groups = groups.iter().copied().map(LocaleGroup);
        Ok(WantedLocaleGroups::Listed(groups.collect()))
    }

    #[test]
    fn table_without_languages_wants_every_group() {
        let requested: [Box<[u8]>; 1] = [Box::from(&b"xx"[..])];
        for used in [UNKNOWN, listed(&["de"])] {
            assert_eq!(resolve_wanted_groups(&used, None, &[], canonical_tag), ALL);
            assert_eq!(
                resolve_wanted_groups(&used, Some(&requested[..]), &[], canonical_tag),
                ALL
            );
        }
    }

    #[test]
    fn requested_tag_without_data_is_rejected() {
        for tag in ["xx", "x", "abcd-DE", ""] {
            let error = Err(TrimRequestError::UnknownLocale(Box::from(tag.as_bytes())));
            assert_eq!(resolve(&UNKNOWN, Some(&[tag])), error, "{tag}");
            assert_eq!(
                resolve(&listed(&["de"]), Some(&["de", tag])),
                error,
                "{tag}"
            );
        }
    }

    #[test]
    fn requested_alias_wants_group_of_what_it_stands_for() {
        assert_eq!(resolve(&UNKNOWN, Some(&["tl"])), wanted(&[2]));
        assert_eq!(
            resolve(&listed(&["de"]), Some(&["tl-PH", "en"])),
            wanted(&[1, 2])
        );
    }

    #[test]
    fn requested_alias_without_data_is_rejected_as_written() {
        let error = Err(TrimRequestError::UnknownLocale(Box::from(&b"aam"[..])));
        assert_eq!(resolve(&UNKNOWN, Some(&["aam"])), error);
    }

    #[test]
    fn requested_text_that_is_no_tag_is_read_by_its_language() {
        let texts = ["tl_PH.UTF-8", "de_DE", "zh_Hant_TW.UTF-8"];
        assert_eq!(resolve(&UNKNOWN, Some(&texts)), wanted(&[0, 2, 4]));
        let error = Err(TrimRequestError::UnknownLocale(Box::from(&b"xx_YY"[..])));
        assert_eq!(resolve(&UNKNOWN, Some(&["xx_YY"])), error);
    }

    #[test]
    fn used_tag_is_looked_up_as_engine_gave_it() {
        assert_eq!(resolve(&listed(&["fil", "de"]), None), wanted(&[0, 2]));
        assert_eq!(resolve(&listed(&["tl", "de"]), None), ALL);
    }

    #[test]
    fn unknown_use_without_request_wants_every_group() {
        assert_eq!(resolve(&UNKNOWN, None), ALL);
    }

    #[test]
    fn unknown_use_with_request_wants_requested_groups() {
        assert_eq!(resolve(&UNKNOWN, Some(&["en-US", "de"])), wanted(&[0, 1]));
        assert_eq!(resolve(&UNKNOWN, Some(&[])), wanted(&[]));
    }

    #[test]
    fn listed_use_wants_used_groups() {
        assert_eq!(
            resolve(&listed(&["zh-Hant-TW", "de-AT"]), None),
            wanted(&[0, 4])
        );
        assert_eq!(resolve(&listed(&[]), None), wanted(&[]));
    }

    #[test]
    fn request_replaces_listed_use() {
        assert_eq!(resolve(&listed(&["fil"]), Some(&["en"])), wanted(&[1]));
        assert_eq!(resolve(&listed(&["xx", "de"]), Some(&["en"])), wanted(&[1]));
        assert_eq!(resolve(&listed(&["de"]), Some(&[])), wanted(&[]));
    }

    #[test]
    fn used_tag_without_data_wants_every_group_without_request() {
        assert_eq!(resolve(&listed(&["de", "xx"]), None), ALL);
        assert_eq!(resolve(&listed(&["x-private", "de"]), None), ALL);
    }

    #[test]
    fn wanted_groups_are_sorted_and_unique() {
        let tags = ["zh", "no", "de", "nb"];
        assert_eq!(resolve(&listed(&tags), None), wanted(&[0, 3, 4]));
        assert_eq!(resolve(&UNKNOWN, Some(&tags)), wanted(&[0, 3, 4]));
    }

    #[test]
    fn language_of_reads_first_subtag() {
        assert_eq!(language_of(b"zh-Hant-TW"), Some(*b"zh\0\0"));
        assert_eq!(language_of(b"zh_TW"), Some(*b"zh\0\0"));
        assert_eq!(language_of(b"fil"), Some(*b"fil\0"));
        assert_eq!(language_of(b"DE-at"), Some(*b"de\0\0"));
    }

    #[test]
    fn language_of_rejects_other_lengths_and_bytes() {
        for tag in [
            &b"x"[..],
            b"abcd",
            b"",
            b"-de",
            b"x-de",
            b"d3",
            b"d\xc3\xa9",
        ] {
            assert_eq!(language_of(tag), None, "{tag:?}");
        }
    }

    #[test]
    fn find_group_searches_by_name() {
        let languages = languages();
        assert_eq!(find_group(&languages, *b"de\0\0"), Some(LocaleGroup(0)));
        assert_eq!(find_group(&languages, *b"no\0\0"), Some(LocaleGroup(3)));
        assert_eq!(find_group(&languages, *b"zh\0\0"), Some(LocaleGroup(4)));
        assert_eq!(find_group(&languages, *b"fi\0\0"), None);
        assert_eq!(find_group(&[], *b"de\0\0"), None);
    }

    #[test]
    fn contains_follows_wanted_groups() {
        assert!(WantedLocaleGroups::All.contains(LocaleGroup(7)));
        let groups = WantedLocaleGroups::Listed(vec![LocaleGroup(1), LocaleGroup(3)]);
        assert!(groups.contains(LocaleGroup(1)));
        assert!(groups.contains(LocaleGroup(3)));
        assert!(!groups.contains(LocaleGroup(2)));
        assert!(!WantedLocaleGroups::Listed(Vec::new()).contains(LocaleGroup(0)));
    }
}
