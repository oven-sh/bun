use bun_engine_text::StringBuilder;
use bun_icu::{Buffer, CText};
use smallvec::SmallVec;

use super::subtag::{Subtag, Subtags, is_language, is_region, is_script, is_variant};
use crate::Result;

/// In ascending order, each once.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub(crate) struct Variants(SmallVec<[Subtag; 2]>);

impl Variants {
    /// Takes as many as there are. `None` if one repeats.
    pub(crate) fn parse(subtags: &mut Subtags<'_>) -> Result<Option<Variants>> {
        let mut variants = SmallVec::<[Subtag; 2]>::new();
        while let Some(variant) = subtags.next_if(is_variant).and_then(Subtag::new) {
            variants.try_reserve(1)?;
            variants.push(variant);
        }
        variants.sort_unstable();
        let repeats = !variants.is_sorted_by(|a, b| a < b);
        Ok((!repeats).then_some(Variants(variants)))
    }

    pub(crate) fn as_slice(&self) -> &[Subtag] {
        &self.0
    }

    pub(crate) fn contains(&self, variant: Subtag) -> bool {
        self.0.binary_search(&variant).is_ok()
    }

    pub(crate) fn remove(&mut self, variant: Subtag) {
        if let Ok(index) = self.0.binary_search(&variant) {
            self.0.remove(index);
        }
    }

    pub(crate) fn insert(&mut self, variant: Subtag) -> Result<()> {
        if let Err(index) = self.0.binary_search(&variant) {
            self.0.try_reserve(1)?;
            self.0.insert(index, variant);
        }
        Ok(())
    }
}

/// `unicode_language_id` of UTS #35, each subtag in the case of the canonical syntax.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct LanguageId {
    pub(crate) language: Subtag,
    pub(crate) script: Option<Subtag>,
    pub(crate) region: Option<Subtag>,
    pub(crate) variants: Variants,
}

impl LanguageId {
    /// Takes the longest prefix that matches. The language and the variants are in lower case.
    pub(crate) fn parse(subtags: &mut Subtags<'_>) -> Result<Option<LanguageId>> {
        let Some(language) = subtags.next_if(is_language).and_then(Subtag::new) else {
            return Ok(None);
        };
        let script = subtags.next_if(is_script).and_then(Subtag::new);
        let region = subtags.next_if(is_region).and_then(Subtag::new);
        Ok(Variants::parse(subtags)?.map(|variants| LanguageId {
            language,
            script: script.map(Subtag::to_titlecase),
            region: region.map(Subtag::to_uppercase),
            variants,
        }))
    }

    pub(crate) fn parse_all(text: &[u8]) -> Result<Option<LanguageId>> {
        let mut subtags = Subtags::new(text);
        Ok(LanguageId::parse(&mut subtags)?.filter(|_| subtags.rest().is_empty()))
    }

    fn subtags(&self) -> impl Iterator<Item = Subtag> {
        ([Some(self.language), self.script, self.region].into_iter())
            .flatten()
            .chain(self.variants.as_slice().iter().copied())
    }

    pub(crate) fn write(&self, out: &mut StringBuilder) {
        self.write_mapped(out, |subtag| subtag);
    }

    pub(crate) fn write_lowercase(&self, out: &mut StringBuilder) {
        self.write_mapped(out, Subtag::to_lowercase);
    }

    fn write_mapped(&self, out: &mut StringBuilder, map: impl Fn(Subtag) -> Subtag) {
        for (index, subtag) in self.subtags().enumerate() {
            if index != 0 {
                out.push_latin1(b'-');
            }
            out.push_latin1_slice(map(subtag).as_bytes());
        }
    }

    /// Add Likely Subtags of UTS #35. Does nothing if the data has no match.
    pub(crate) fn maximize(&mut self) {
        self.change_likely_subtags(bun_icu::locale::add_likely_subtags);
    }

    /// Remove Likely Subtags of UTS #35.
    pub(crate) fn minimize(&mut self) {
        self.change_likely_subtags(bun_icu::locale::minimize_subtags);
    }

    fn change_likely_subtags(
        &mut self,
        change: fn(&core::ffi::CStr) -> bun_icu::Result<Buffer<u8>>,
    ) {
        let subtags = [Some(self.language), self.script, self.region];
        let Ok(changed) = join(subtags.into_iter().flatten()).and_then(|id| change(&id)) else {
            return;
        };
        // ICU writes nothing for `und`.
        let has_language = changed.first().is_some_and(|&first| first != b'_');
        let implied: &[u8] = if has_language { b"" } else { b"und" };
        if let Ok(Some(changed)) = LanguageId::parse_all(&[implied, &changed].concat()) {
            (self.language, self.script, self.region) =
                (changed.language, changed.script, changed.region);
        }
    }
}

/// With the separator of ICU.
pub(crate) fn join(subtags: impl IntoIterator<Item = Subtag>) -> bun_icu::Result<CText> {
    let mut joined = Buffer::new();
    for subtag in subtags {
        if !joined.is_empty() {
            joined.push(b'_');
        }
        joined.extend_from_slice(subtag.as_bytes());
    }
    CText::from_buffer(joined)
}
