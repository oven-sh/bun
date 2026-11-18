use bun_engine_text::{StringBuilder, StringRef};
use smallvec::SmallVec;

use super::LanguageTag;
use super::alias::replace_aliases;
use super::keyword::Key;
use super::language_id::{LanguageId, Variants};
use super::subtag::{
    Subtag, Subtags, is_language, is_singleton, is_transformed_key, is_unicode_key, is_value,
};
use crate::Result;

type Fields<'a> = SmallVec<[(Key, &'a [u8]); 4]>;

/// `unicode_locale_id` of UTS #35, each list in the order of the canonical syntax.
pub(crate) struct LocaleId<'a> {
    pub(crate) language_id: LanguageId,
    transformed_language: Option<LanguageId>,
    transformed_fields: Fields<'a>,
    attributes: SmallVec<[Subtag; 1]>,
    /// The first for each key. A value can be empty.
    keywords: Fields<'a>,
    /// With their singletons.
    other_extensions: SmallVec<[&'a [u8]; 1]>,
    /// With its singleton, or empty.
    private_use: &'a [u8],
}

impl<'a> LocaleId<'a> {
    /// `None` unless IsStructurallyValidLanguageTag. `text` is a result of `lowercase_subtags` or a canonical tag.
    pub(crate) fn parse(text: &'a [u8]) -> Result<Option<LocaleId<'a>>> {
        let mut subtags = Subtags::new(text);
        let Some(language_id) = LanguageId::parse(&mut subtags)? else {
            return Ok(None);
        };
        let mut id = LocaleId {
            language_id,
            transformed_language: None,
            transformed_fields: Fields::new(),
            attributes: SmallVec::new(),
            keywords: Fields::new(),
            other_extensions: SmallVec::new(),
            private_use: &[],
        };
        let mut singletons = 0u128;
        loop {
            let extension = subtags.rest();
            let singleton = match subtags.next() {
                None => break,
                Some(&[singleton]) if singletons >> singleton & 1 == 0 => singleton,
                Some(_) => return Ok(None),
            };
            singletons |= 1 << singleton;
            let is_valid = match singleton {
                b't' => id.parse_transformed_extension(&mut subtags)?,
                b'u' => id.parse_unicode_extension(&mut subtags)?,
                b'x' => {
                    id.private_use = extension;
                    !subtags.run(|_| true).is_empty()
                }
                _ => {
                    let length = subtags.run(|it| !is_singleton(it)).len();
                    if length != 0 {
                        id.other_extensions.push(&extension[.."a-".len() + length]);
                    }
                    length != 0
                }
            };
            if !is_valid {
                return Ok(None);
            }
        }
        id.other_extensions.sort_unstable();
        Ok(Some(id))
    }

    fn parse_transformed_extension(&mut self, subtags: &mut Subtags<'a>) -> Result<bool> {
        if subtags.clone().next_if(is_language).is_some() {
            self.transformed_language = LanguageId::parse(subtags)?;
            if self.transformed_language.is_none() {
                return Ok(false);
            }
        }
        while let Some(key) = subtags.next_if(is_transformed_key).and_then(Key::new) {
            let value = subtags.run(is_value);
            if value.is_empty() {
                return Ok(false);
            }
            self.transformed_fields.try_reserve(1)?;
            self.transformed_fields.push((key, value));
        }
        // Those with the same key stay in the order of the text.
        (self.transformed_fields).sort_unstable_by_key(|&(key, value)| (key, value.as_ptr()));
        Ok(self.has_transformed_extension())
    }

    fn parse_unicode_extension(&mut self, subtags: &mut Subtags<'a>) -> Result<bool> {
        while let Some(attribute) = subtags.next_if(is_value).and_then(Subtag::new) {
            self.attributes.try_reserve(1)?;
            self.attributes.push(attribute);
        }
        self.attributes.sort_unstable();
        self.attributes.dedup();
        while let Some(key) = subtags.next_if(is_unicode_key).and_then(Key::new) {
            self.add_keyword(key, subtags.run(is_value));
        }
        Ok(self.has_unicode_extension())
    }

    fn has_transformed_extension(&self) -> bool {
        self.transformed_language.is_some() || !self.transformed_fields.is_empty()
    }

    fn has_unicode_extension(&self) -> bool {
        !self.attributes.is_empty() || !self.keywords.is_empty()
    }

    /// Does nothing if the key has a value.
    fn add_keyword(&mut self, key: Key, value: &'a [u8]) {
        if let Err(index) = self.keywords.binary_search_by_key(&key, |it| it.0) {
            self.keywords.insert(index, (key, value));
        }
    }

    pub(crate) fn set_keyword(&mut self, key: Key, value: &'a [u8]) {
        match self.keywords.binary_search_by_key(&key, |it| it.0) {
            Ok(index) => self.keywords[index].1 = value,
            Err(index) => self.keywords.insert(index, (key, value)),
        }
    }

    /// CanonicalizeUnicodeLocaleId
    pub(crate) fn into_canonical(mut self) -> Result<LanguageTag> {
        replace_aliases(&mut self.language_id)?;
        if let Some(language) = &mut self.transformed_language {
            replace_aliases(language)?;
        }
        // UTS #35, Legacy Variants.
        if matches!(self.language_id.variants.as_slice(), [only] if only.as_bytes() == b"posix") {
            self.language_id.variants = Variants::default();
            self.add_keyword(Key::VARIANT, b"posix");
        }
        Ok(LanguageTag::new(self.write()?))
    }

    fn write(&self) -> Result<StringRef> {
        let mut out = StringBuilder::new();
        let push = |out: &mut StringBuilder, subtags: &[u8]| {
            out.push_latin1(b'-');
            out.push_latin1_slice(subtags);
        };
        self.language_id.write(&mut out);

        let before_t = self.other_extensions.partition_point(|it| it[0] < b't');
        let (earlier, later) = self.other_extensions.split_at(before_t);
        earlier.iter().for_each(|it| push(&mut out, it));
        if self.has_transformed_extension() {
            push(&mut out, b"t");
            if let Some(language) = &self.transformed_language {
                out.push_latin1(b'-');
                language.write_lowercase(&mut out);
            }
            for &(key, value) in &self.transformed_fields {
                push(&mut out, key.as_bytes());
                key.with_preferred_value(value, |value| push(&mut out, value));
            }
        }
        if self.has_unicode_extension() {
            push(&mut out, b"u");
            for attribute in &self.attributes {
                push(&mut out, attribute.as_bytes());
            }
            for &(key, value) in &self.keywords {
                push(&mut out, key.as_bytes());
                key.with_preferred_value(value, |value| {
                    if !matches!(value, b"" | b"true") {
                        push(&mut out, value);
                    }
                });
            }
        }
        later.iter().for_each(|it| push(&mut out, it));
        if !self.private_use.is_empty() {
            push(&mut out, self.private_use);
        }
        Ok(out.finish()?)
    }
}
