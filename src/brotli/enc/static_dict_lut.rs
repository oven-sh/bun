//! A lookup table from the first 4 bytes of a word of the static dictionary, as it is or in upper case, to the word.

use std::sync::OnceLock;

use super::Fallible;
use super::hash::hash_u32;
use crate::common::dictionary::{
    DATA, MAX_DICTIONARY_WORD_LENGTH, MIN_DICTIONARY_WORD_LENGTH, OFFSETS_BY_LENGTH,
    SIZE_BITS_BY_LENGTH,
};
use crate::util::{Bug, Checked, SliceExt, load_u32_le, try_vec, try_with_capacity, try_zeroed};

/// The values of [`DictWord::transform`].
pub(crate) const TRANSFORM_IDENTITY: u8 = 0;
pub(crate) const TRANSFORM_UPPERCASE_FIRST: u8 = 10;
pub(crate) const TRANSFORM_UPPERCASE_ALL: u8 = 11;

#[derive(Clone, Copy, Default)]
pub(crate) struct DictWord {
    /// The highest bit marks the end of a bucket.
    pub(crate) len: u8,
    pub(crate) transform: u8,
    pub(crate) idx: u16,
}

const HASH_BITS: u32 = 15;
const NUM_BUCKETS: usize = 1 << HASH_BITS;
const NUM_ITEMS: usize = 31705;

pub(crate) struct StaticDictionaryLut {
    /// For each [`hash15`], where in `words` its bucket starts, or 0 if it is empty.
    pub(crate) buckets: Box<[u16]>,
    pub(crate) words: Box<[DictWord]>,
}

/// A hash of the 4 bytes at `pos`.
#[inline(always)]
pub(crate) fn hash15(data: &[u8], pos: usize) -> Checked<usize> {
    Ok(hash_u32(load_u32_le(data, pos)?, HASH_BITS))
}

/// The first 4 bytes of `word`, regardless of the case of letters.
fn caseless_prefix(word: &[u8]) -> Checked<u32> {
    Ok(load_u32_le(word, 0)? & !0x2020_2020)
}

/// The words found so far, chained by bucket.
struct Chains {
    slots: Vec<DictWord>,
    /// For each slot, the one added to the same bucket before it.
    prev: Vec<u16>,
    /// For each bucket, the slot added last.
    heads: Vec<u16>,
    counts: Vec<u16>,
}

impl Chains {
    fn add(&mut self, key: usize, len: usize, transform: u8, idx: usize) -> Checked {
        let head = self.heads.at_mut(key)?;
        self.prev.push(*head);
        *head = self.slots.len() as u16;
        self.slots.push(DictWord {
            len: len as u8,
            transform,
            idx: idx as u16,
        });
        *self.counts.at_mut(key)? += 1;
        Ok(())
    }

    /// Whether `same` holds for one of the words of `len` bytes in bucket `key`. Those were added last. Slot 0 counts
    /// as the end of a chain, so it is never looked at.
    fn any(
        &self,
        key: usize,
        len: usize,
        mut same: impl FnMut(DictWord) -> Checked<bool>,
    ) -> Checked<bool> {
        let mut curr = usize::from(self.heads.at(key)?);
        while curr != 0 {
            let slot = self.slots.at(curr)?;
            if usize::from(slot.len) != len {
                break;
            }
            if same(slot)? {
                return Ok(true);
            }
            curr = usize::from(self.prev.at(curr)?);
        }
        Ok(false)
    }
}

fn build() -> Fallible<StaticDictionaryLut> {
    let mut chains = Chains {
        slots: try_with_capacity(NUM_ITEMS)?,
        prev: try_with_capacity(NUM_ITEMS)?,
        heads: try_zeroed(NUM_BUCKETS)?,
        counts: try_zeroed(NUM_BUCKETS)?,
    };
    let mut transformed = [0u8; MAX_DICTIONARY_WORD_LENGTH];

    for l in MIN_DICTIONARY_WORD_LENGTH..=MAX_DICTIONARY_WORD_LENGTH {
        let n = 1usize << SIZE_BITS_BY_LENGTH.at(l)?;
        let dict_words = DATA
            .sub(OFFSETS_BY_LENGTH.at(l)? as usize..)?
            .sub(..l * n)?;
        let word_at = |idx: u16| dict_words.sub(l * usize::from(idx)..)?.sub(..l);
        let transformed = transformed.sub_mut(..l)?;

        for (i, word) in dict_words.chunks_exact(l).enumerate() {
            chains.add(hash15(word, 0)?, l, TRANSFORM_IDENTITY, i)?;
        }

        // A transformed word is left out if it is the same as a word that is there already.
        for (i, word) in dict_words.chunks_exact(l).enumerate() {
            if !word.at(0)?.is_ascii_lowercase() {
                continue;
            }
            transformed.write_at(0, word)?;
            transformed.at_mut(0)?.make_ascii_uppercase();
            let key = hash15(transformed, 0)?;
            let prefix = caseless_prefix(transformed)?;
            let found = chains.any(key, l, |slot| {
                let other = word_at(slot.idx)?;
                Ok(prefix == caseless_prefix(other)? && *transformed == *other)
            })?;
            if !found {
                chains.add(key, l, TRANSFORM_UPPERCASE_FIRST, i)?;
            }
        }

        for (i, word) in dict_words.chunks_exact(l).enumerate() {
            if !word.is_ascii() || !word.iter().skip(1).any(u8::is_ascii_lowercase) {
                continue;
            }
            transformed.write_at(0, word)?;
            transformed.make_ascii_uppercase();
            let key = hash15(transformed, 0)?;
            let prefix = caseless_prefix(transformed)?;
            let found = chains.any(key, l, |slot| {
                let other = word_at(slot.idx)?;
                if prefix != caseless_prefix(other)? {
                    return Ok(false);
                }
                Ok(match slot.transform {
                    TRANSFORM_IDENTITY => *transformed == *other,
                    TRANSFORM_UPPERCASE_FIRST => {
                        i32::from(transformed.at(0)?) == i32::from(other.at(0)?) - 32
                            && *transformed.sub(1..)? == *other.sub(1..)?
                    }
                    _ => transformed
                        .iter()
                        .zip(other)
                        .all(|(a, b)| *a == b.to_ascii_uppercase()),
                })
            })?;
            if !found {
                chains.add(key, l, TRANSFORM_UPPERCASE_ALL, i)?;
            }
        }
    }
    if chains.slots.len() != NUM_ITEMS - 1 {
        return Err(Bug.into());
    }

    // Item 0 is not used, so that no bucket starts at 0.
    let mut buckets = try_zeroed::<u16>(NUM_BUCKETS)?;
    let mut words = try_vec(DictWord::default(), NUM_ITEMS)?;
    let mut pos = 1usize;
    for ((bucket, &head), &count) in buckets.iter_mut().zip(&chains.heads).zip(&chains.counts) {
        if count == 0 {
            continue;
        }
        *bucket = pos as u16;
        let mut curr = usize::from(head);
        // In the order in which they were added.
        for word in words
            .sub_mut(pos..pos + usize::from(count))?
            .iter_mut()
            .rev()
        {
            *word = chains.slots.at(curr)?;
            curr = usize::from(chains.prev.at(curr)?);
        }
        pos += usize::from(count);
        words.at_mut(pos - 1)?.len |= 0x80;
    }
    Ok(StaticDictionaryLut {
        buckets: buckets.into(),
        words: words.into(),
    })
}

/// Built on first use.
pub(crate) fn static_dictionary_lut() -> Fallible<&'static StaticDictionaryLut> {
    static LUT: OnceLock<StaticDictionaryLut> = OnceLock::new();
    LUT.get_or_try_init(build)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::fnv1a;

    /// The checksums are those of the tables that the reference encoder embeds.
    #[test]
    fn same_as_reference_tables() -> Fallible {
        let lut = static_dictionary_lut()?;
        assert_eq!(lut.buckets.len(), 32768);
        assert_eq!(lut.words.len(), 31705);
        assert_eq!(
            fnv1a(lut.buckets.iter().flat_map(|b| b.to_le_bytes())),
            0x91BA_7453_57AA_25B9
        );
        let words = lut.words.iter().flat_map(|w| {
            let [lo, hi] = w.idx.to_le_bytes();
            [w.len, w.transform, lo, hi]
        });
        assert_eq!(fnv1a(words), 0x5036_1663_D08A_3EB3);
        Ok(())
    }
}
