//! Blocks, and what one leaves for the next.

use bun_highway::unzstd::{HuffmanTable, Tape};

use crate::array::resize;
use crate::destination::Destination;
use crate::dictionary::{Dictionary, Entropy};
use crate::error::{Error, Result};
use crate::format::{BlockType, CodeKind, Encoding, INITIAL_REPEAT_OFFSETS, LONG_SEQUENCE_COUNT};
use crate::frame::BlockHeader;
use crate::huffman;
use crate::literals::{LITERALS_PADDING, LiteralsHeader};
use crate::sequences::{
    SequenceTables, predefined_tables, read_rle_table, read_table, run_sequences,
};

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
    memory: SpareTables,
    huffman_source: Source,
    /// By [`CodeKind`].
    sequence_sources: [Source; 3],
    repeat_offsets: [u32; 3],
}

/// Asking for memory takes long compared to decoding a short frame. Up to 61 KB.
#[derive(Default)]
pub struct SpareTables {
    literals: Vec<u8>,
    huffman: Option<Box<HuffmanTable>>,
    sequences: Option<Box<SequenceTables>>,
}

fn get_or_allocate<T>(slot: &mut Option<T>, allocate: fn() -> Option<T>) -> Result<&mut T> {
    Ok(match slot {
        Some(item) => item,
        None => slot.insert(allocate().ok_or(Error::MemoryAllocation)?),
    })
}

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
        core::mem::swap(&mut self.memory, spare);
        if spare.literals.capacity() > 32 << 10 {
            spare.literals = Vec::new();
        }
        self.huffman_source = Source::None;
        self.sequence_sources = [Source::None; 3];
    }

    /// All blocks of the frame go with the same `dictionary`.
    pub(crate) fn start_frame(&mut self, dictionary: Option<&Dictionary<'_>>) {
        let entropy = dictionary.and_then(Dictionary::entropy);
        let source = entropy.map_or(Source::None, |_| Source::Dictionary);
        self.huffman_source = source;
        self.sequence_sources = [source; 3];
        self.repeat_offsets = entropy.map_or(INITIAL_REPEAT_OFFSETS, |it| it.repeat_offsets);
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
            BlockType::Compressed => self.decompress(src, len, dictionary, destination),
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
                let (content, count) = (header.content(block)?, header.count);
                let mut start = padded.len() - block_len + header.section_len - content.len();
                if header.encoding == Encoding::Compressed {
                    let own = get_or_allocate(&mut self.memory.huffman, HuffmanTable::allocate)?;
                    start += huffman::read_table(own, content)?;
                    own.add_pairs(count, content.len());
                    self.huffman_source = Source::Own;
                }
                let table = match self.huffman_source {
                    Source::Dictionary => entropy.map(|it| &it.huffman),
                    _ => self.memory.huffman.as_ref(),
                };
                let streams = padded.get(..padded.len() - section.len());
                let decode = |out, lead| {
                    let (streams, table) = streams.zip(table).ok_or(Error::Internal)?;
                    header.decode((streams, start), table, out, lead)
                };
                let (len, next) = (count + LITERALS_PADDING, destination.as_ptr().addr());
                if has_only_literals {
                    return match header.encoding {
                        Encoding::Basic => destination.finish(0, content),
                        Encoding::Rle => destination.finish_repeated(content, count),
                        Encoding::Compressed | Encoding::Repeat => {
                            let position = destination.position();
                            decode((destination.tape(count, 0)?.1, position), 0)?;
                            destination.finish(count, &[])
                        }
                    };
                } else if len <= FEW_LITERALS {
                    few_literals = [0; FEW_LITERALS];
                    let out = few_literals.get_mut(..count).ok_or(Error::Internal)?;
                    match header.encoding {
                        Encoding::Basic => out.copy_from_slice(content),
                        Encoding::Rle => out.fill(*content.first().ok_or(Error::Internal)?),
                        _ => decode((Tape::slice(out), 0), 0)?,
                    }
                    few_literals.get(..len).ok_or(Error::Internal)?
                } else {
                    let out = &mut self.memory.literals;
                    out.clear();
                    out.try_reserve_exact(len)?;
                    let lead = next.wrapping_sub(out.as_ptr().addr());
                    match header.encoding {
                        Encoding::Rle => {
                            resize(out, count, *content.first().ok_or(Error::Internal)?)
                        }
                        _ => decode((Tape::vec(out, 0), 0), lead)?,
                    }
                    out.extend_from_slice(&[0; LITERALS_PADDING]);
                    out
                }
            }
        };

        let (count, count_len) = read_sequence_count(section)?;
        let descriptions = section.get(count_len..).ok_or(Error::Internal)?;
        let (mut len, mut used_literals) = (0, 0);
        if count != 0 {
            let (own, sources) = (&mut self.memory.sequences, &mut self.sequence_sources);
            let (tables, stream) = select_tables(descriptions, own, sources, entropy)?;
            if room == 0 {
                return Err(Error::DstSizeTooSmall);
            }
            let start = padded.len() - stream.len();
            let state = &mut self.repeat_offsets;
            let literals = (literals, header.count);
            (len, used_literals) = run_sequences(
                tables,
                (padded, start),
                count,
                literals,
                state,
                &mut destination,
            )?;
        } else if !descriptions.is_empty() {
            return Err(Error::CorruptionDetected);
        }
        let last_literals = literals.get(used_literals..header.count);
        destination.finish(len, last_literals.ok_or(Error::Internal)?)
    }
}

/// Returns where the table of each [`CodeKind`] is, and what follows their descriptions in `src`.
#[inline(always)]
fn select_tables<'t, 's>(
    src: &'s [u8],
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
    for (source, encoding) in sources.iter_mut().zip(&encodings) {
        *source = match encoding {
            Encoding::Basic => Source::Predefined,
            Encoding::Repeat if *source == Source::None => return Err(Error::CorruptionDetected),
            Encoding::Repeat => *source,
            Encoding::Rle | Encoding::Compressed => Source::Own,
        };
    }
    for (&kind, encoding) in CodeKind::ALL.iter().zip(&encodings) {
        let read = match encoding {
            Encoding::Compressed => read_table,
            Encoding::Rle => read_rle_table,
            _ => continue,
        };
        let len = read(get_or_allocate(own, SequenceTables::allocate)?, kind, src)?;
        src = src.get(len..).ok_or(Error::Internal)?;
    }
    let predefined = predefined_tables();
    let tables = |source| match source {
        Source::Own => own.as_deref().ok_or(Error::Internal),
        Source::Dictionary => entropy.map(|it| &*it.sequences).ok_or(Error::Internal),
        _ => Ok(predefined),
    };
    let [first, second, third] = *sources;
    Ok(([tables(first)?, tables(second)?, tables(third)?], src))
}
