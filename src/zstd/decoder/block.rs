//! Blocks, and what one leaves for the next.

use crate::array::{At, get_or_allocate, grow};
use crate::bits::BackwardBits;
use crate::destination::Destination;
use crate::dictionary::{Dictionary, Entropy};
use crate::error::{Error, Result};
use crate::format::{
    BLOCK_LEN_MAX, BlockType, CodeKind, Encoding, INITIAL_REPEAT_OFFSETS, LONG_SEQUENCE_COUNT,
};
use crate::frame::BlockHeader;
use crate::huffman::{AMPLE_ROOM, HuffmanTable};
use crate::literals::{LITERALS_PADDING, LiteralsHeader};
use crate::sequences::{PREDEFINED_TABLES, SequenceState, SequenceTables, run_sequences};

/// Where the table is that a block can repeat.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum Source {
    #[default]
    None,
    Predefined,
    Dictionary,
    Own,
}

/// With the padding. They are not worth an allocation.
const FEW_LITERALS: usize = 256;
/// More of them are as long as the padding that they may lack.
const _: () = assert!(FEW_LITERALS >= 2 * LITERALS_PADDING);

/// Asks for memory when a block takes it.
#[derive(Default)]
pub(crate) struct BlockDecoder {
    literals: Vec<u8>,
    /// In this frame, as far as [`AMPLE_ROOM`] speeds them up.
    literal_count: usize,
    huffman: HuffmanTable,
    huffman_source: Source,
    sequence_tables: Option<Box<SequenceTables>>,
    /// By [`CodeKind`].
    sequence_sources: [Source; 3],
    sequence_state: SequenceState,
}

/// Clearing new ones takes long compared to decoding a short frame. A frame reads only the rows that it has set.
#[derive(Default)]
pub struct SpareTables(Option<Box<SequenceTables>>);

/// The number of sequences, and how many bytes it takes.
fn read_sequence_count(section: &[u8]) -> Result<(usize, usize)> {
    match *section {
        [count @ ..0x80, ..] => Ok((count.into(), 1)),
        [high @ 0x80..=0xFE, low, ..] => Ok((usize::from(high - 0x80) << 8 | usize::from(low), 2)),
        [0xFF, low, high, ..] => Ok((
            usize::from(u16::from_le_bytes([low, high])) + LONG_SEQUENCE_COUNT,
            3,
        )),
        _ => Err(Error::SrcSizeWrong),
    }
}

impl BlockDecoder {
    pub(crate) fn swap_tables(&mut self, spare: &mut SpareTables) {
        core::mem::swap(&mut self.sequence_tables, &mut spare.0);
        self.sequence_sources = [Source::None; 3];
    }

    /// All blocks of the frame go with the same `dictionary`.
    pub(crate) fn start_frame(&mut self, dictionary: Option<&Dictionary<'_>>) {
        let entropy = dictionary.and_then(Dictionary::entropy);
        let source = entropy.map_or(Source::None, |_| Source::Dictionary);
        self.literal_count = 0;
        self.huffman_source = source;
        self.sequence_sources = [source; 3];
        self.sequence_state.repeat_offsets =
            entropy.map_or(INITIAL_REPEAT_OFFSETS, |it| it.repeat_offsets);
    }

    /// The last `len` bytes of `src` are all or, if it is raw, some of what follows `header`. Returns how many it wrote.
    #[inline]
    pub(crate) fn decode(
        &mut self,
        header: BlockHeader,
        src: &[u8],
        len: usize,
        dictionary: Option<&Dictionary<'_>>,
        destination: Destination<'_, '_>,
    ) -> Result<usize> {
        let before = src.len().checked_sub(len).ok_or(Error::Internal)?;
        let content = src.get(before..).ok_or(Error::Internal)?;
        match header.block_type() {
            BlockType::Compressed => {
                let padded = src.get(before.saturating_sub(BackwardBits::PADDING)..);
                self.decompress(padded.ok_or(Error::Internal)?, len, dictionary, destination)
            }
            BlockType::Raw => destination.finish(0, content),
            BlockType::Rle => destination.finish_repeated(content, header.size()),
        }
    }

    /// The block is the last `block_len` bytes of `padded`.
    fn decompress(
        &mut self,
        padded: &[u8],
        block_len: usize,
        dictionary: Option<&Dictionary<'_>>,
        mut destination: Destination<'_, '_>,
    ) -> Result<usize> {
        let block = (padded.get(padded.len() - block_len..)).ok_or(Error::Internal)?;
        let entropy = dictionary.and_then(Dictionary::entropy);
        let has_table = self.huffman_source != Source::None;
        let (len_max, room) = (destination.block_len_max(), destination.room());
        let header = LiteralsHeader::read(block, has_table, len_max, room)?;
        let section = block.get(header.section_len..).ok_or(Error::Internal)?;
        let has_only_literals = section == [0];

        let mut few_literals;
        let literals = match header.in_place(block, FEW_LITERALS) {
            Some(literals) => literals,
            None => {
                let start = header.read_tree(block, &mut self.huffman)?;
                if header.has_tree() {
                    self.huffman_source = Source::Own;
                }
                let table = match entropy {
                    Some(entropy) if self.huffman_source == Source::Dictionary => &entropy.huffman,
                    _ => &self.huffman,
                };
                let room_for = |count| {
                    if count > AMPLE_ROOM / 2 {
                        AMPLE_ROOM
                    } else {
                        0
                    }
                };
                let count = header.count_for_ample_room(table);
                if has_only_literals {
                    let out = destination.lend_room(header.count, room_for(count))?;
                    let next_block = out.as_ptr().wrapping_add(header.count);
                    header.decode(block, start, table, out, next_block)?;
                    return destination.finish(header.count, &[]);
                }
                // The buffer is cleared once for all blocks.
                self.literal_count += if len_max == BLOCK_LEN_MAX { count } else { 0 };
                let len = header.count + LITERALS_PADDING;
                let out: &mut [u8] = if len <= FEW_LITERALS {
                    few_literals = [0; FEW_LITERALS];
                    &mut few_literals
                } else {
                    grow(
                        &mut self.literals,
                        0,
                        len.max(room_for(self.literal_count.max(count))),
                    )?;
                    let padding = self.literals.get_mut(header.count..len);
                    padding.ok_or(Error::Internal)?.fill(0);
                    &mut self.literals
                };
                header.decode(block, start, table, out, destination.as_ptr())?;
                out.get(..len).ok_or(Error::Internal)?
            }
        };

        let (count, count_len) = read_sequence_count(section)?;
        let descriptions = section.get(count_len..).ok_or(Error::Internal)?;
        let (mut len, mut used_literals) = (0, 0);
        if count != 0 {
            let (own, sources) = (&mut self.sequence_tables, &mut self.sequence_sources);
            let (tables, stream) = select_tables(descriptions, count, own, sources, entropy)?;
            if room == 0 {
                return Err(Error::DstSizeTooSmall);
            }
            let start = padded.len() - stream.len();
            let state = &mut self.sequence_state;
            let literals = (literals, header.count);
            (len, used_literals) = destination.with_overshoot(|destination| {
                run_sequences(tables, padded, start, count, literals, state, destination)
            })?;
        } else if !descriptions.is_empty() {
            return Err(Error::CorruptionDetected);
        }
        let last_literals = literals.get(used_literals..header.count);
        destination.finish(len, last_literals.ok_or(Error::Internal)?)
    }
}

/// Up to this many sequences are not worth copying tables to have them in one place.
const SCATTERED_TABLES_COUNT_MAX: usize = 10;

/// Returns where the table of each [`CodeKind`] is, and what follows their descriptions in `src`.
#[inline(always)]
fn select_tables<'t, 's>(
    src: &'s [u8],
    count: usize,
    own: &'t mut Option<Box<SequenceTables>>,
    sources: &mut [Source; 3],
    entropy: Option<&'t Entropy>,
) -> Result<([&'t SequenceTables; 3], &'s [u8])> {
    let (&modes, mut src) = src.split_first().ok_or(Error::SrcSizeWrong)?;
    if modes & 3 != 0 {
        return Err(Error::CorruptionDetected);
    }
    // `map()` is not inlined in hardened builds.
    let encoding = |shift| Encoding::from_low_bits(modes >> shift);
    let encodings = [encoding(6), encoding(4), encoding(2)];
    let mut shared = [None; 3];
    for ((source, encoding), shared) in sources.iter_mut().zip(encodings).zip(&mut shared) {
        *source = match encoding {
            Encoding::Basic => Source::Predefined,
            Encoding::Repeat => *source,
            Encoding::Rle | Encoding::Compressed => Source::Own,
        };
        *shared = match source {
            Source::None => return Err(Error::CorruptionDetected),
            Source::Predefined => Some(&PREDEFINED_TABLES),
            Source::Dictionary => entropy.map(|entropy| &*entropy.sequences),
            Source::Own => None,
        };
    }
    let [first, second, third] = *sources;
    if let [Some(a), Some(b), Some(c)] = shared
        && (count <= SCATTERED_TABLES_COUNT_MAX || (first == second && first == third))
    {
        return Ok(([a, b, c], src));
    }

    let own = get_or_allocate(own, || SequenceTables::EMPTY)?;
    for &kind in &CodeKind::ALL {
        let len = match encodings.at(kind as usize) {
            Encoding::Compressed => own.read(kind, src)?,
            Encoding::Rle => {
                own.set_rle(kind, *src.first().ok_or(Error::CorruptionDetected)?)?;
                1
            }
            _ => 0,
        };
        src = src.get(len..).ok_or(Error::Internal)?;
        if let Some(tables) = shared.at(kind as usize) {
            own.copy_from(tables, kind);
        }
    }
    *sources = [Source::Own; 3];
    Ok(([own; 3], src))
}
