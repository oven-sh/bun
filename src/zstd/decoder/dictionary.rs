//! Dictionaries, in the format for them or raw.

use std::borrow::Cow;

use crate::array::allocate;
use crate::error::{Error, Result};
use crate::format::{BLOCK_LEN_MAX, CodeKind, DICTIONARY_MAGIC};
use crate::huffman::HuffmanTable;
use crate::sequences::SequenceTables;

/// The largest that a sequence can spell out. The last values stand for repeated offsets in the decoder.
const OFFSET_MAX: u32 = u32::MAX - 3;

/// What frames can refer to besides their own content.
pub struct Dictionary<'a> {
    bytes: Cow<'a, [u8]>,
    id: u32,
    entropy: Option<Entropy>,
}

/// What the first block of a frame can repeat.
pub(crate) struct Entropy {
    pub(crate) huffman: HuffmanTable,
    pub(crate) sequences: Box<SequenceTables>,
    pub(crate) repeat_offsets: [u32; 3],
}

impl<'a> Dictionary<'a> {
    /// In the dictionary format if `bytes` start with its magic number, and [`raw`](Self::raw) otherwise.
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        Self::raw(bytes).with_entropy()
    }

    /// Nothing but content.
    pub fn raw(bytes: &'a [u8]) -> Self {
        Self {
            bytes: Cow::Borrowed(bytes),
            id: 0,
            entropy: None,
        }
    }

    /// [`new`](Self::new) for a copy of `bytes`.
    pub(crate) fn copied(bytes: &[u8]) -> Result<Dictionary<'static>> {
        let mut copy = Vec::new();
        copy.try_reserve_exact(bytes.len())?;
        copy.extend_from_slice(bytes);
        let dictionary = Dictionary {
            bytes: Cow::Owned(copy),
            ..Dictionary::raw(&[])
        };
        dictionary.with_entropy()
    }

    fn with_entropy(mut self) -> Result<Self> {
        let Some((&[m0, m1, m2, m3, i0, i1, i2, i3], rest)) = self.history().split_first_chunk()
        else {
            return Ok(self);
        };
        if u32::from_le_bytes([m0, m1, m2, m3]) != DICTIONARY_MAGIC {
            return Ok(self);
        }
        let mut entropy = Entropy {
            huffman: HuffmanTable::default(),
            sequences: allocate(|| SequenceTables::EMPTY)?,
            repeat_offsets: [0; _],
        };
        entropy.read(rest).map_err(|error| match error {
            Error::CorruptionDetected => Error::DictionaryCorrupted,
            other => other,
        })?;
        self.id = u32::from_le_bytes([i0, i1, i2, i3]);
        self.entropy = Some(entropy);
        Ok(self)
    }

    /// 0 if it has none.
    pub(crate) fn id(&self) -> u32 {
        self.id
    }

    /// What is in front of a frame's content. All of it: `zstd --patch-from` takes a trained dictionary for raw content.
    pub(crate) fn history(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn entropy(&self) -> Option<&Entropy> {
        self.entropy.as_ref()
    }
}

impl Entropy {
    fn read(&mut self, src: &[u8]) -> Result<()> {
        let len = self.huffman.read(src, BLOCK_LEN_MAX)?;
        let mut src = src.get(len..).ok_or(Error::Internal)?;
        for kind in [
            CodeKind::Offset,
            CodeKind::MatchLength,
            CodeKind::LiteralLength,
        ] {
            let len = self.sequences.read(kind, src)?;
            src = src.get(len..).ok_or(Error::Internal)?;
        }
        let (offsets, content) = src
            .split_first_chunk::<12>()
            .ok_or(Error::CorruptionDetected)?;
        for (to, from) in self.repeat_offsets.iter_mut().zip(offsets.as_chunks().0) {
            *to = u32::from_le_bytes(*from);
            if !(1..=OFFSET_MAX).contains(to) || *to as usize > content.len() {
                return Err(Error::CorruptionDetected);
            }
        }
        Ok(())
    }
}
