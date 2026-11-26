//! Writes the blocks for a part of the input whose sequences are known.

use bun_zstd_decoder::format::{BLOCK_HEADER_LEN, BlockType, CodeKind};
use bun_zstd_decoder::{Error, Output, Result};

use crate::bytes::is_one_byte_repeated;
use crate::entropy::{Changes, Entropy, Reuse};
use crate::parameters::Tuning;
use crate::sequences::{CodeCounts, Repeats, Sequence};
use crate::worst_case_len;

pub(crate) fn header(kind: BlockType, len: usize, is_last: bool) -> [u8; BLOCK_HEADER_LEN] {
    let value = u32::from(is_last) | (kind as u32) << 1 | (len as u32) << 3;
    let [low, middle, high, _] = value.to_le_bytes();
    [low, middle, high]
}

pub(crate) fn append(out: &mut Output<'_>, bytes: &[u8]) -> Result<()> {
    if out.append(bytes) < bytes.len() {
        return Err(Error::DstSizeTooSmall);
    }
    Ok(())
}

pub(crate) fn write_raw(bytes: &[u8], is_last: bool, out: &mut Output<'_>) -> Result<()> {
    append(out, &header(BlockType::Raw, bytes.len(), is_last))?;
    append(out, bytes)
}

pub(crate) fn write_repeated(bytes: &[u8], is_last: bool, out: &mut Output<'_>) -> Result<()> {
    append(out, &header(BlockType::Rle, bytes.len(), is_last))?;
    append(out, bytes.get(..1).ok_or(Error::Internal)?)
}

/// Up to `len` bytes, split into a header and the rest.
pub(crate) fn room_for_block<'a>(
    out: &'a mut Output<'_>,
    len: usize,
) -> Result<(&'a mut [u8; BLOCK_HEADER_LEN], &'a mut [u8])> {
    let written = out.written();
    let room = out.lend(len).get_mut(written..).unwrap_or_default();
    room.split_first_chunk_mut().ok_or(Error::DstSizeTooSmall)
}

/// Input, and what it is made of.
#[derive(Clone, Copy)]
pub(crate) struct Content<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) sequences: &'a [Sequence],
    pub(crate) literals: &'a [u8],
    pub(crate) counts: &'a CodeCounts,
    /// The recent offsets that a decoder has after the sequences.
    pub(crate) repeats: Repeats,
}

impl Content<'_> {
    /// An attempt at compressing it that takes more is not worth it.
    fn len_max(&self) -> usize {
        let for_parts = self.literals.len() + 12 * self.sequences.len() + 512;
        for_parts.min(worst_case_len(self.bytes.len()))
    }
}

/// What blocks take over from one another.
pub(crate) struct BlockWriter {
    pub(crate) entropy: Entropy,
    pub(crate) repeats: Repeats,
    /// Up to 1.4.3, zstd's command fails on a frame that starts with a block of one byte.
    pub(crate) is_at_start: bool,
}

impl BlockWriter {
    pub(crate) const fn new() -> Self {
        Self {
            entropy: Entropy::EMPTY,
            repeats: Repeats::INITIAL,
            is_at_start: true,
        }
    }

    pub(crate) fn accept(&mut self, changes: Changes, repeats: Repeats) {
        self.entropy.accept(changes);
        self.repeats = repeats;
    }

    /// The table of a dictionary has codes for the offsets of the first block. They can be larger in later ones.
    pub(crate) fn distrust_offset_table(&mut self) {
        let reuse = self.entropy.codes.reuse_mut(CodeKind::Offset);
        if *reuse == Reuse::Always {
            *reuse = Reuse::IfComplete;
        }
    }

    fn can_repeat_byte(&self, bytes: &[u8]) -> bool {
        !self.is_at_start && is_one_byte_repeated(bytes)
    }

    pub(crate) fn write_uncompressed(
        &self,
        bytes: &[u8],
        is_last: bool,
        out: &mut Output<'_>,
    ) -> Result<()> {
        if self.can_repeat_byte(bytes) {
            write_repeated(bytes, is_last, out)
        } else {
            write_raw(bytes, is_last, out)
        }
    }

    /// As one block.
    pub(crate) fn write(
        &mut self,
        content: &Content<'_>,
        tuning: &Tuning,
        is_last: bool,
        out: &mut Output<'_>,
    ) -> Result<()> {
        const REPEATED_LEN_MAX: usize = 25;
        let (start, rest) = room_for_block(out, content.len_max())?;
        match self.entropy.compress(content, tuning, rest)? {
            Some((..REPEATED_LEN_MAX, _)) if self.can_repeat_byte(content.bytes) => {
                write_repeated(content.bytes, is_last, out)?;
            }
            Some((len, changes)) => {
                *start = header(BlockType::Compressed, len, is_last);
                out.commit(BLOCK_HEADER_LEN + len);
                self.accept(changes, content.repeats);
            }
            None => self.write_uncompressed(content.bytes, is_last, out)?,
        }
        self.distrust_offset_table();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use bun_zstd_decoder::XxHash64;

    use super::*;
    use crate::parameters::{Purpose, Request};
    use crate::sequences::{OffsetValue, Sequences};

    /// For literal lengths, offsets and match lengths that take no search, and so no history.
    fn summary(
        list: &[[u32; 3]],
        last_literals: u32,
        mask: u8,
        strategy: i32,
    ) -> Result<(usize, u32)> {
        let end = list
            .iter()
            .map(|[literals, _, matched]| literals + matched)
            .sum();
        let positions = 0..u64::from(end + last_literals);
        let bytes: Vec<_> = positions.map(|it| ((it * it) >> 5) as u8 & mask).collect();
        let mut sequences = Sequences::new();
        sequences.clear_for(bytes.len(), 3)?;
        for &[literal_len, offset, match_len] in list {
            sequences.push(literal_len, OffsetValue::new(offset), match_len);
        }
        sequences.finish(&bytes, end)?;

        let mut request = Request::new(3);
        request.set(107, strategy)?;
        let content = Content {
            bytes: &bytes,
            sequences: &sequences.list,
            literals: sequences.literals(),
            counts: &sequences.counts,
            repeats: Repeats::INITIAL,
        };
        let tuning = request.tuning(None, Purpose::Frame { dictionary_len: 0 });
        let mut block = Vec::with_capacity(bytes.len());
        let mut out = Output::spare_capacity(&mut block, usize::MAX);
        BlockWriter::new().write(&content, &tuning, true, &mut out)?;
        drop(out);
        Ok((block.len(), XxHash64::hash(&block) as u32))
    }

    /// The lengths and hashes are of what `ZSTD_compressSequences()` writes.
    #[test]
    fn extremes_are_written_like_zstd_does() -> Result<()> {
        let far = (0..12).map(|it| [9 + it, (1 << (28 + it % 4)) + it, 50 + it % 3]);
        let far: Vec<_> = far.collect();
        assert_eq!(summary(&far, 20, 7, 1)?, (154, 0x3D1D_6181));
        assert_eq!(summary(&far, 20, 7, 5)?, (153, 0xD2AF_6E00));

        assert_eq!(summary(&[[9, 1 << 30, 50]], 9, 7, 1)?, (31, 0xD43B_B9AF));

        // Up to the last offset code of the predefined table, and one more
        for (code, strategy, expected) in [
            (28, 1, (73, 0x7C1A_00C5)),
            (28, 5, (73, 0x7C1A_00C5)),
            (29, 1, (77, 0x96F1_D3CC)),
            (29, 5, (77, 0x96F1_D3CC)),
        ] {
            let list = (0..6).map(|it| [9 + it, (1 << (code - it % 2)) + it, 50 + it % 3]);
            assert_eq!(
                summary(&list.collect::<Vec<_>>(), 20, 7, strategy)?,
                expected
            );
        }

        // No code much more frequent than the others
        let match_lens: Vec<_> = (3..35).chain([35, 37, 39, 41, 43, 47, 51, 59]).collect();
        for (count, expected) in [
            (319, (1159, 0xB7D5_D702)),
            (320, (1163, 0x9F85_EB9F)),
            (400, (1452, 0x44AB_6653)),
        ] {
            let pairs = (0..count).zip(match_lens.iter().cycle());
            let list = pairs.map(|(it, &len)| [it % 3, (16 << (it % 19)) + it % 5, len]);
            assert_eq!(summary(&list.collect::<Vec<_>>(), 9, 7, 1)?, expected);
        }

        // With 55, 56, 57 and 62 extra bits
        let long = |offset| [32770, offset, 65541];
        let short = [3, 100, 5];
        for (list, expected) in [
            ([long((1 << 25) - 4), short], (12197, 0x601F_0DAD)),
            ([long((1 << 25) + 5), short], (12198, 0x49BB_6725)),
            ([long((1 << 26) + 5), short], (12198, 0xA5F2_2A52)),
            ([short, long(0xFFFF_FFF0)], (12204, 0x98FA_5F67)),
        ] {
            assert_eq!(summary(&list, 0, 7, 1)?, expected);
        }

        for (count, expected) in [
            (0x7EFF, (26383, 0x401B_CB5C)),
            (0x7F00, (26385, 0xC1FD_8368)),
            (0x7F01, (26387, 0x44C5_331D)),
        ] {
            let list: Vec<_> = (0..count).map(|it| [it % 2, 20 + it % 9, 3]).collect();
            assert_eq!(summary(&list, 9, 7, 5)?, expected);
        }

        assert_eq!(summary(&[[4095, 50, 30]], 0, 0, 1)?, (13, 0x2B60_FD1C));
        assert_eq!(summary(&[[4096, 50, 30]], 0, 0, 1)?, (14, 0xC6D2_4620));
        Ok(())
    }
}
