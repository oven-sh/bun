//! A text as JavaScriptCore reads it: Latin-1 or UTF-16.

use super::wtf8;
use bun_core::strings;
use bun_yarr::{NO_MATCH, Text};
use smallvec::SmallVec;

/// UTF-8 or WTF-8, and its UTF-16 form unless it is ASCII, which is Latin-1 as it is. Made once for all searches in a text.
pub(super) struct Subject<'t> {
    bytes: &'t [u8],
    is_ascii: bool,
    units: SmallVec<[u16; 128]>,
    /// Where each of `units` starts in `bytes`, and the length of `bytes`. Empty if nobody is going to ask.
    offsets: SmallVec<[u32; 128]>,
}

impl<'t> Subject<'t> {
    /// What a string of JavaScriptCore can have.
    const MAX_LEN: usize = i32::MAX as usize;

    /// `with_offsets`: for [`Subject::index_of`] and [`Subject::to_offsets`].
    #[inline]
    pub(super) fn new(bytes: &'t [u8], with_offsets: bool) -> Self {
        let mut subject = Subject {
            bytes,
            is_ascii: true,
            units: SmallVec::new(),
            offsets: SmallVec::new(),
        };
        if let Some(first) = strings::first_non_ascii(bytes)
            && !subject.is_too_long()
        {
            subject.transcode(first as usize, with_offsets);
        }
        subject
    }

    /// `first`: where the first byte is that is not ASCII.
    #[cold]
    fn transcode(&mut self, first: usize, with_offsets: bool) {
        let bytes = self.bytes;
        self.is_ascii = false;
        self.units.reserve(bytes.len());
        let head = bytes.get(..first).unwrap_or_default();
        self.units.extend(head.iter().map(|byte| u16::from(*byte)));
        if with_offsets {
            self.offsets.reserve(bytes.len() + 1);
            self.offsets.extend(0..first as u32);
        }
        let mut at = first;
        while at < bytes.len() {
            let (c, len) = wtf8::code_point_at(bytes, at);
            if with_offsets {
                self.offsets.push(at as u32);
            }
            if c > 0xFFFF {
                self.units.push(wtf8::lead_surrogate(c) as u16);
                self.units.push(wtf8::trail_surrogate(c) as u16);
                if with_offsets {
                    self.offsets.push(at as u32 + 2);
                }
            } else {
                self.units.push(c as u16);
            }
            at += len;
        }
        if with_offsets {
            self.offsets.push(bytes.len() as u32);
        }
    }

    #[inline]
    pub(super) fn bytes(&self) -> &'t [u8] {
        self.bytes
    }

    #[inline]
    pub(super) fn is_too_long(&self) -> bool {
        self.bytes.len() > Self::MAX_LEN
    }

    #[inline]
    pub(super) fn text(&self) -> Text<'_> {
        if self.is_ascii {
            Text::Latin1(self.bytes)
        } else {
            Text::Utf16(&self.units)
        }
    }

    /// Where the code point starts that the byte offset `offset` is in the middle of. `offset` itself if it is not.
    #[inline]
    pub(super) fn code_point_start(&self, offset: usize) -> usize {
        if self.is_ascii {
            return offset;
        }
        wtf8::code_point_start(self.bytes, offset)
    }

    /// The index in [`Subject::text`] of what starts at the byte offset `offset`, or after it.
    #[inline]
    pub(super) fn index_of(&self, offset: usize) -> u32 {
        if self.is_ascii {
            return offset as u32;
        }
        self.offsets
            .partition_point(|start| (*start as usize) < offset) as u32
    }

    /// Whether the index `index` in [`Subject::text`] is between the halves of a surrogate pair.
    #[inline]
    pub(super) fn splits_pair(&self, index: u32) -> bool {
        let Some(before) = (index as usize).checked_sub(1).filter(|_| !self.is_ascii) else {
            return false;
        };
        matches!(
            self.units.get(before..before + 2),
            Some([0xD800..=0xDBFF, 0xDC00..=0xDFFF])
        )
    }

    /// Makes byte offsets of indices in [`Subject::text`].
    #[inline]
    pub(super) fn to_offsets(&self, indices: &mut [u32]) {
        if self.is_ascii {
            return;
        }
        for index in indices {
            *index = self
                .offsets
                .get(*index as usize)
                .copied()
                .unwrap_or(NO_MATCH);
        }
    }
}
