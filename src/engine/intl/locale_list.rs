use core::ops::Deref;

use bun_engine_text::StringImpl;
use hashbrown::HashTable;
use smallvec::SmallVec;

use crate::{LanguageTag, Result};

/// The result of CanonicalizeLocaleList.
#[derive(Default)]
pub struct LocaleList {
    tags: SmallVec<[LanguageTag; 2]>,
    /// Indices into `tags`, from `LINEAR_SEARCH_LIMIT` on.
    later: HashTable<usize>,
}

fn hash(tag: &LanguageTag) -> u64 {
    // The table takes the low bits and the top seven.
    u64::from(StringImpl::hash(tag.string())).wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

impl LocaleList {
    const LINEAR_SEARCH_LIMIT: usize = 8;

    /// Does nothing if the list has the tag.
    pub fn push(&mut self, tag: LanguageTag) -> Result<()> {
        let tags = &self.tags;
        if tags
            .iter()
            .take(Self::LINEAR_SEARCH_LIMIT)
            .any(|it| *it == tag)
        {
            return Ok(());
        }
        if tags.len() >= Self::LINEAR_SEARCH_LIMIT {
            let tag_hash = hash(&tag);
            if (self.later.find(tag_hash, |&index| tags[index] == tag)).is_some() {
                return Ok(());
            }
            self.later.try_reserve(1, |&index| hash(&tags[index]))?;
            self.tags.try_reserve(1)?;
            let tags = &self.tags;
            (self.later).insert_unique(tag_hash, tags.len(), |&index| hash(&tags[index]));
        }
        self.tags.push(tag);
        Ok(())
    }
}

impl Deref for LocaleList {
    type Target = [LanguageTag];

    fn deref(&self) -> &[LanguageTag] {
        &self.tags
    }
}
