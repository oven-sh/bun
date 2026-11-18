use core::ffi::CStr;
use std::sync::OnceLock;

use bun_icu::Buffer;

use crate::LanguageTag;
use crate::language_tag::subtag::{Subtags, is_region, is_script, is_variant};

/// A tag as a number. No locale that has data needs more bytes.
fn pack(tag: &[u8]) -> Option<u128> {
    let mut padded = [0; size_of::<u128>()];
    padded.get_mut(..tag.len())?.copy_from_slice(tag);
    Some(u128::from_be_bytes(padded))
}

fn pack_subtags<'a>(subtags: impl Iterator<Item = &'a [u8]>) -> Option<u128> {
    let mut tag = Buffer::new();
    for subtag in subtags.filter(|it| !it.is_empty()) {
        if !tag.is_empty() {
            tag.push(b'-');
        }
        let start = tag.len();
        tag.extend_from_slice(subtag);
        if start != 0 && is_variant(subtag) {
            tag[start..].make_ascii_lowercase();
        }
    }
    pack(&tag)
}

/// The [[AvailableLocales]] of a constructor.
pub struct AvailableLocales {
    load: fn() -> Box<[u128]>,
    sorted: OnceLock<Box<[u128]>>,
}

impl AvailableLocales {
    pub fn collator() -> &'static AvailableLocales {
        static LOCALES: AvailableLocales = AvailableLocales {
            load: || AvailableLocales::sort(bun_icu::collator::available_locales()),
            sorted: OnceLock::new(),
        };
        &LOCALES
    }

    /// Of the other constructors.
    pub fn general() -> &'static AvailableLocales {
        static LOCALES: AvailableLocales = AvailableLocales {
            load: || AvailableLocales::sort(bun_icu::locale::available()),
            sorted: OnceLock::new(),
        };
        &LOCALES
    }

    fn sort(ids: impl Iterator<Item = &'static CStr>) -> Box<[u128]> {
        let mut tags = Vec::with_capacity(ids.size_hint().1.unwrap_or(0));
        // As a tag this variant is an extension, and no available locale has one.
        for id in ids.filter(|id| !id.to_bytes().ends_with(b"_POSIX")) {
            let subtags = Subtags::new(id.to_bytes());
            tags.extend(pack_subtags(subtags.clone()));
            // An available locale with a script and a region is also available without the script.
            let mut rest = subtags;
            if let (Some(language), Some(_), Some(region), None) = (
                rest.next(),
                rest.next_if(is_script),
                rest.next_if(is_region),
                rest.next(),
            ) {
                tags.extend(pack_subtags([language, region].into_iter()));
            }
        }
        tags.sort_unstable();
        tags.dedup();
        tags.into()
    }

    fn contains(&self, tag: &[u8]) -> bool {
        let sorted = self.sorted.get_or_init(self.load);
        pack(tag).is_some_and(|tag| sorted.binary_search(&tag).is_ok())
    }

    /// The longest prefix of `tag` that is available.
    pub(crate) fn lookup<'a>(&self, tag: &'a LanguageTag) -> Option<&'a [u8]> {
        let base_name = tag.base_name();
        // What every build of ICU has.
        if matches!(base_name, b"en" | b"en-US") {
            return Some(base_name);
        }
        let mut subtags = Subtags::new(base_name);
        let mut length = 0;
        let mut found = None;
        while let Some(subtag) = subtags.next().filter(|_| length < size_of::<u128>()) {
            length += usize::from(length != 0) + subtag.len();
            if self.contains(&base_name[..length]) {
                found = Some(&base_name[..length]);
            }
        }
        found
    }

    /// FilterLocales
    pub fn filter<'a>(
        &'a self,
        requested: &'a [LanguageTag],
    ) -> impl Iterator<Item = &'a LanguageTag> {
        requested.iter().filter(|tag| self.lookup(tag).is_some())
    }
}
