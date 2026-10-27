//! The state machine that turns a brotli stream back into bytes. It can stop wherever the input or the room for output
//! ends, and go on from there in the next call.

use bun_core::AllocError;

use super::bit_reader::{BitReader, bit_mask};
use super::command_lut::COMMAND_LUT;
use super::huffman::{
    HUFFMAN_MAX_CODE_LENGTH, HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH, HUFFMAN_MAX_SIZE_26,
    HUFFMAN_MAX_SIZE_258, HUFFMAN_MAX_SIZE_272, HUFFMAN_TABLE_BITS, HuffmanCode, HuffmanTreeGroup,
    SYMBOL_LIST_BASE, build_code_lengths_huffman_table, build_huffman_table,
    build_simple_huffman_table,
};
use super::{DecoderErrorCode as E, DecoderParameter, DecoderResult};
use crate::common::constants::{
    BLOCK_LENGTH_PREFIX_CODE, CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, DISTANCE_CONTEXT_BITS,
    INITIAL_REPEATED_CODE_LENGTH, LARGE_MAX_DISTANCE_BITS, LARGE_MAX_WBITS, LARGE_MIN_WBITS,
    LITERAL_CONTEXT_BITS, MAX_ALLOWED_DISTANCE, MAX_DISTANCE_BITS, MAX_NDIRECT, MAX_NPOSTFIX,
    NUM_BLOCK_LEN_SYMBOLS, NUM_COMMAND_SYMBOLS, NUM_DISTANCE_SHORT_CODES, NUM_LITERAL_SYMBOLS,
    REPEAT_PREVIOUS_CODE_LENGTH, calculate_distance_code_limit, distance_alphabet_size,
    max_backward_limit, simple_code_symbol_bits,
};
use crate::common::context::{ContextLut, ContextType, context_lut};
use crate::common::dictionary::{self, MAX_DICTIONARY_WORD_LENGTH, MIN_DICTIONARY_WORD_LENGTH};
use crate::common::transform::{MAX_TRANSFORMED_LENGTH, NUM_TRANSFORMS, transform_dictionary_word};
use crate::io::Output;
use crate::util::{Bug, Checked, SliceExt, try_box, try_vec, try_with_capacity, try_zeroed};

/// `Err` is everything that interrupts decoding: an error, or the need for more input or more room for output.
type Step<T = ()> = Result<T, E>;

const HUFFMAN_TABLE_MASK: u64 = bit_mask(HUFFMAN_TABLE_BITS);

/// What the ring buffer has room for past its end: two copies of 16 bytes, or a transformed dictionary word.
const RING_BUFFER_WRITE_AHEAD_SLACK: usize = 542;
const _: () = assert!(RING_BUFFER_WRITE_AHEAD_SLACK >= MAX_TRANSFORMED_LENGTH + 2);

/// The length of a block when there is only one block type. No meta-block is longer.
const BLOCK_SIZE_CAP: u32 = 1 << 24;

/// The largest distance alphabet that is accepted, which takes a large window.
const MAX_DISTANCE_SYMBOLS: usize = calculate_distance_code_limit(
    MAX_ALLOWED_DISTANCE,
    MAX_NPOSTFIX,
    MAX_NDIRECT,
)
.max_alphabet_size as usize;

/// As many as `BrotliDecoderAttachDictionary` takes.
const MAX_COMPOUND_DICTIONARY_CHUNKS: usize = 15;

/// 2. The block categories, as indices.
const LITERAL: usize = 0;
const COMMAND: usize = 1;
const DISTANCE: usize = 2;
const NUM_BLOCK_CATEGORIES: usize = 3;

/// The fixed prefix code that the code lengths of the code length code are written in, indexed by the next 4 bits.
static CODE_LENGTH_PREFIX_LENGTH: [u8; 16] = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4];
static CODE_LENGTH_PREFIX_VALUE: [u8; 16] = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5];

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Uninited,
    LargeWindowBits,
    MetaBlockHeader,
    Uncompressed,
    Metadata,
    BlockTypeCount,
    BlockTypeCode,
    BlockLengthCode,
    FirstBlockLength,
    DistanceParameters,
    ContextModes,
    LiteralContextMap,
    DistanceContextMap,
    TreeGroup,
    CommandBegin,
    CommandInner,
    CommandPostDecodeLiterals,
    CommandPostWrapCopy,
    WriteDuringInsert,
    WriteAfterDictionaryCopy,
    WriteDuringWrapCopy,
    MetaBlockDone,
    Done,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MetaBlockHeaderState {
    None,
    Empty,
    Nibbles,
    Size,
    Uncompressed,
    Reserved,
    Bytes,
    Metadata,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UncompressedState {
    None,
    Write,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TreeGroupState {
    None,
    Loop,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ContextMapState {
    None,
    ReadPrefix,
    Huffman,
    Decode {
        /// How much of the map was filled in.
        context_index: u32,
        /// The symbol of a run of zeros of which the extra bits were not read yet.
        pending_run: Option<u32>,
    },
    Transform,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HuffmanState {
    None,
    SimpleSize,
    SimpleRead,
    SimpleBuild,
    Complex,
    LengthSymbols,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DecodeUint8State {
    None,
    Short,
    Long,
}

/// Bytes that come before the start of the stream, as far as backward references go.
struct CompoundDictionary {
    chunks: Vec<Box<[u8]>>,
    /// Where each chunk starts, and where the last one ends.
    chunk_offsets: [i32; MAX_COMPOUND_DICTIONARY_CHUNKS + 1],
    total_size: i32,
    /// The copy in progress: the chunk and the offset in it to go on from, its length, and how much of it is done.
    copy_chunk: usize,
    copy_offset: i32,
    copy_length: i32,
    copied: i32,
    /// `block_map[address >> block_bits]` is a chunk at or before the one that holds `address`. The first copy fills
    /// them in.
    block_bits: Option<u32>,
    block_map: [u8; 256],
}

impl CompoundDictionary {
    fn try_new() -> Result<Box<Self>, AllocError> {
        try_box(Self {
            chunks: try_with_capacity(MAX_COMPOUND_DICTIONARY_CHUNKS)?,
            chunk_offsets: [0; MAX_COMPOUND_DICTIONARY_CHUNKS + 1],
            total_size: 0,
            copy_chunk: 0,
            copy_offset: 0,
            copy_length: 0,
            copied: 0,
            block_bits: None,
            block_map: [0; 256],
        })
    }

    /// Adds `chunk` to the end, unless that makes too many chunks or too many bytes.
    fn attach(&mut self, chunk: Box<[u8]>) -> bool {
        if self.chunks.len() == MAX_COMPOUND_DICTIONARY_CHUNKS {
            return false;
        }
        let Some(total_size) = i32::try_from(chunk.len())
            .ok()
            .and_then(|size| self.total_size.checked_add(size))
        else {
            return false;
        };
        self.chunks.push(chunk);
        self.total_size = total_size;
        self.chunk_offsets
            .put(self.chunks.len(), total_size)
            .is_ok()
    }

    fn block_bits(&mut self) -> Checked<u32> {
        if let Some(block_bits) = self.block_bits {
            return Ok(block_bits);
        }
        let mut block_bits = 8;
        while ((self.total_size - 1) >> block_bits) != 0 {
            block_bits += 1;
        }
        block_bits -= 8;
        self.block_bits = Some(block_bits);
        let mut cursor = 0i32;
        let mut index = 0usize;
        while cursor < self.total_size {
            while self.chunk_offsets.at(index + 1)? < cursor {
                index += 1;
            }
            self.block_map
                .put((cursor >> block_bits) as usize, index as u8)?;
            // Past `i32::MAX` is past `total_size`.
            let Some(next) = cursor.checked_add(1 << block_bits) else {
                break;
            };
            cursor = next;
        }
        Ok(block_bits)
    }

    /// Starts a copy of `length` bytes from `address`, which is inside.
    fn start_copy(&mut self, address: i32, length: i32) -> Step {
        let block_bits = self.block_bits()?;
        let mut chunk = usize::from(self.block_map.at((address >> block_bits) as usize)?);
        while address >= self.chunk_offsets.at(chunk + 1)? {
            chunk += 1;
        }
        if self.total_size - address < length {
            return Err(E::CompoundDictionary);
        }
        self.copy_chunk = chunk;
        self.copy_offset = address - self.chunk_offsets.at(chunk)?;
        self.copy_length = length;
        self.copied = 0;
        Ok(())
    }

    fn is_copying(&self) -> bool {
        self.copied != self.copy_length
    }

    /// Goes on with the copy in progress, to `pos` and up to the end of the ring buffer. Returns how much was copied.
    fn copy_to(
        &mut self,
        ring_buffer: &mut [u8],
        ring_buffer_size: i32,
        mut pos: i32,
    ) -> Checked<i32> {
        let orig_pos = pos;
        while self.is_copying() {
            let space = ring_buffer_size - pos;
            let chunk_length = self.chunk_offsets.at(self.copy_chunk + 1)?
                - self.chunk_offsets.at(self.copy_chunk)?;
            let rem_chunk_length = chunk_length - self.copy_offset;
            let length = (self.copy_length - self.copied)
                .min(rem_chunk_length)
                .min(space);
            let chunk = self.chunks.get(self.copy_chunk).ok_or(Bug)?;
            let source =
                chunk.sub(self.copy_offset as usize..(self.copy_offset + length) as usize)?;
            ring_buffer.write_at(pos as usize, source)?;
            pos += length;
            self.copy_offset += length;
            self.copied += length;
            if length == rem_chunk_length {
                self.copy_chunk += 1;
                self.copy_offset = 0;
            }
            if pos == ring_buffer_size {
                break;
            }
        }
        Ok(pos - orig_pos)
    }
}

/// What reading the prefix codes and context maps of a meta-block header needs.
struct HeaderReader {
    substate_tree_group: TreeGroupState,
    substate_context_map: ContextMapState,
    substate_huffman: HuffmanState,
    substate_decode_uint8: DecodeUint8State,

    sub_loop_counter: u32,

    repeat_code_len: u32,
    prev_code_len: u32,

    symbol: u32,
    repeat: u32,
    space: u32,

    /// The code that the code lengths are written in.
    table: [HuffmanCode; 1 << HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH],
    /// The symbols of each code length, as chains. See [`SYMBOL_LIST_BASE`].
    symbol_lists: [u16; SYMBOL_LIST_BASE + NUM_COMMAND_SYMBOLS],
    /// Where in `symbol_lists` the chain of each code length ends.
    next_symbol: [u16; HUFFMAN_MAX_CODE_LENGTH + 1],
    code_length_code_lengths: [u8; CODE_LENGTH_CODES],
    code_length_histo: [u16; HUFFMAN_MAX_CODE_LENGTH + 1],

    /// The tree of a group being read, and where in the group's `codes` it goes.
    tree_index: usize,
    next_start: usize,

    max_run_length_prefix: u32,
}

/// 4. What the distance symbols stand for. It depends on `NPOSTFIX` and `NDIRECT`, which are the same for a whole
/// meta-block.
struct DistanceSymbols {
    /// How many extra bits follow each symbol.
    extra_bits: [u8; MAX_DISTANCE_SYMBOLS],
    /// The distance if they are all 0.
    offset: [u32; MAX_DISTANCE_SYMBOLS],
}

impl DistanceSymbols {
    fn set(&mut self, symbol: usize, extra_bits: u32, offset: u32) -> Checked {
        self.extra_bits.put(symbol, extra_bits as u8)?;
        self.offset.put(symbol, offset)
    }
}

pub struct Decoder {
    state: State,
    /// Reused by loops that are never active at the same time.
    loop_counter: i32,

    br: BitReader,

    /// The end of the input of the last call, if it was too short to decode anything from. 64 bits always suffice to
    /// make progress.
    buffer: [u8; 8],
    buffer_length: usize,

    pos: i32,
    max_backward_distance: i32,
    max_distance: i32,
    ring_buffer_size: i32,
    ring_buffer_mask: i32,
    /// The last four distances.
    last_distances: [i32; 4],
    /// Where in `last_distances` the next one goes, modulo 4.
    last_distances_pos: i32,
    error_code: E,
    meta_block_remaining_len: i32,

    /// `ring_buffer_size` + [`RING_BUFFER_WRITE_AHEAD_SLACK`] bytes, or none before the first meta-block with data.
    ring_buffer: Vec<u8>,
    /// Where in `command_trees.codes` the current tree starts.
    command_tree: usize,
    context_lookup: &'static ContextLut,
    /// Where in `context_map` the part for the current block type starts.
    context_map_slice: usize,

    literal_trees: HuffmanTreeGroup,
    command_trees: HuffmanTreeGroup,
    distance_trees: HuffmanTreeGroup,
    /// A table of [`HUFFMAN_MAX_SIZE_258`] entries for each category. Empty until a meta-block has more than one block
    /// type.
    block_type_trees: Vec<HuffmanCode>,
    /// A table of [`HUFFMAN_MAX_SIZE_26`] entries for each category, allocated with `block_type_trees`.
    block_length_trees: Vec<HuffmanCode>,
    /// All contexts of the current literal block type use the same tree, so the context need not be computed.
    trivial_literal_context: bool,
    /// Valid from when a command is decoded until its distance is. A temporary after that.
    distance_context: i32,
    block_length: [u32; NUM_BLOCK_CATEGORIES],
    /// The symbol of a block count of which the extra bits were not read yet.
    pending_block_length_symbol: Option<u32>,
    num_block_types: [u32; NUM_BLOCK_CATEGORIES],
    /// The block type before the current one, and the current one.
    last_block_types: [[u32; 2]; NUM_BLOCK_CATEGORIES],
    distance_postfix_bits: u32,
    num_direct_distance_codes: u32,
    num_distance_trees: u32,
    distance_context_map: Vec<u8>,
    /// Where in `literal_trees.codes` the tree of a trivial literal context starts.
    literal_tree: usize,

    /// How many times the ring buffer was filled.
    ring_buffer_roundtrips: usize,
    /// How much output was handed to the caller in total.
    partial_pos_out: usize,

    copy_length: i32,
    /// The distance of the current command is the last one.
    implicit_distance: bool,
    distance: i32,

    /// Where in `distance_trees.codes` the tree for each distance context of the current block type starts.
    distance_tree_by_context: [usize; 1 << DISTANCE_CONTEXT_BITS],
    /// The one for the distance of the current command.
    distance_tree: usize,

    substate_meta_block_header: MetaBlockHeaderState,
    substate_uncompressed: UncompressedState,

    new_ring_buffer_size: i32,

    is_last_meta_block: bool,
    is_uncompressed: bool,
    is_metadata: bool,
    should_wrap_ring_buffer: bool,
    canny_ring_buffer_allocation: bool,
    large_window: bool,
    window_bits: u32,
    size_nibbles: u8,

    num_literal_trees: u32,
    context_map: Vec<u8>,
    context_modes: Vec<u8>,

    compound_dictionary: Option<Box<CompoundDictionary>>,

    /// One bit for each literal block type.
    trivial_literal_contexts: [u32; 8],

    header: HeaderReader,
    /// The code that a context map is written in.
    context_map_table: [HuffmanCode; HUFFMAN_MAX_SIZE_272],

    distance_symbols: DistanceSymbols,
}

impl Default for Decoder {
    fn default() -> Self {
        Self::new()
    }
}

/// A Huffman table: the part of `codes` from `start` on. Taking that part as a slice is one more bounds check, for
/// every symbol where each one has a table of its own.
#[derive(Clone, Copy)]
struct Tree<'a> {
    codes: &'a [HuffmanCode],
    start: usize,
}

impl<'a> Tree<'a> {
    #[inline(always)]
    fn new(codes: &'a [HuffmanCode], start: usize) -> Self {
        Self { codes, start }
    }

    #[inline(always)]
    fn at(self, index: usize) -> Checked<HuffmanCode> {
        self.codes.at(self.start + index)
    }
}

/// Reads a symbol from `bits`, which holds at least 15 valid bits, and drops the bits it takes.
#[inline(always)]
fn decode_symbol(bits: u64, table: Tree<'_>, br: &mut BitReader) -> Checked<u32> {
    let index = (bits & HUFFMAN_TABLE_MASK) as usize;
    let mut entry = table.at(index)?;
    if u32::from(entry.bits()) > HUFFMAN_TABLE_BITS {
        let nbits = u32::from(entry.bits()) - HUFFMAN_TABLE_BITS;
        br.drop_bits(HUFFMAN_TABLE_BITS);
        let sub_index = ((bits >> HUFFMAN_TABLE_BITS) & bit_mask(nbits)) as usize;
        entry = table.at(index + usize::from(entry.value()) + sub_index)?;
    }
    br.drop_bits(u32::from(entry.bits()));
    Ok(u32::from(entry.value()))
}

/// The part of `table` that the next 8 bits are looked up in. That needs no check, and this one can be moved out of a
/// loop.
#[inline(always)]
fn first_level(table: &[HuffmanCode]) -> Checked<&[HuffmanCode; 1 << HUFFMAN_TABLE_BITS]> {
    table.first_chunk().ok_or(Bug)
}

/// Peeks 16 bits and drops 0 to 15 of them.
#[inline(always)]
fn read_symbol(table: Tree<'_>, br: &mut BitReader, input: &[u8]) -> Checked<u32> {
    let bits = br.get_16_bits_unmasked(input)?;
    decode_symbol(bits, table, br)
}

/// [`decode_symbol`] when fewer than 15 bits are left in the input. `None` if the symbol is longer than that.
fn safe_decode_symbol(table: Tree<'_>, br: &mut BitReader) -> Checked<Option<u32>> {
    let mut available_bits = br.available_bits();
    if available_bits == 0 {
        let entry = table.at(0)?;
        return Ok((entry.bits() == 0).then_some(u32::from(entry.value())));
    }
    let val = br.bits_unmasked();
    let index = (val & HUFFMAN_TABLE_MASK) as usize;
    let entry = table.at(index)?;
    let bits = u32::from(entry.bits());
    if bits <= HUFFMAN_TABLE_BITS {
        if bits <= available_bits {
            br.drop_bits(bits);
            return Ok(Some(u32::from(entry.value())));
        }
        return Ok(None);
    }
    if available_bits <= HUFFMAN_TABLE_BITS {
        return Ok(None);
    }

    let sub_index = ((val & bit_mask(bits)) >> HUFFMAN_TABLE_BITS) as usize;
    available_bits -= HUFFMAN_TABLE_BITS;
    let entry = table.at(index + usize::from(entry.value()) + sub_index)?;
    if available_bits < u32::from(entry.bits()) {
        return Ok(None);
    }

    br.drop_bits(HUFFMAN_TABLE_BITS + u32::from(entry.bits()));
    Ok(Some(u32::from(entry.value())))
}

#[inline(always)]
fn safe_read_symbol(table: Tree<'_>, br: &mut BitReader, input: &[u8]) -> Checked<Option<u32>> {
    if let Some(val) = br.safe_get_bits(input, 15) {
        return decode_symbol(val, table, br).map(Some);
    }
    safe_decode_symbol(table, br)
}

/// [`safe_read_symbol`] or [`read_symbol`]. Only the former can need more input.
#[inline(always)]
fn read_symbol_maybe_safe<const SAFE: bool>(
    table: Tree<'_>,
    br: &mut BitReader,
    input: &[u8],
) -> Step<u32> {
    if SAFE {
        safe_read_symbol(table, br, input)?.ok_or(E::NeedsMoreInput)
    } else {
        Ok(read_symbol(table, br, input)?)
    }
}

/// The first level entry for the next 8 bits, which are not dropped.
#[inline(always)]
fn preload_symbol(table: &[HuffmanCode], br: &mut BitReader, input: &[u8]) -> Checked<HuffmanCode> {
    let index = br.get_8_bits(input)? as usize;
    first_level(table)?.at(index)
}

/// Reads the symbol that `preloaded` is the first level entry of, and preloads the next one.
#[inline(always)]
fn read_preloaded_symbol(
    table: &[HuffmanCode],
    br: &mut BitReader,
    input: &[u8],
    preloaded: &mut HuffmanCode,
) -> Checked<u32> {
    let bits = u32::from(preloaded.bits());
    let result = if bits > HUFFMAN_TABLE_BITS {
        let val = br.get_16_bits_unmasked(input)?;
        let index = (val & HUFFMAN_TABLE_MASK) as usize + usize::from(preloaded.value());
        let mask = bit_mask(bits - HUFFMAN_TABLE_BITS);
        br.drop_bits(HUFFMAN_TABLE_BITS);
        let entry = table.at(index + ((val >> HUFFMAN_TABLE_BITS) & mask) as usize)?;
        br.drop_bits(u32::from(entry.bits()));
        entry.value()
    } else {
        br.drop_bits(bits);
        preloaded.value()
    };
    *preloaded = preload_symbol(table, br, input)?;
    Ok(u32::from(result))
}

/// Reads up to `limit` symbols into `ring_buffer[pos..]`, which has room for them, and stops before the input gets
/// short. Returns how many were read.
#[inline(always)]
fn copy_preloaded_symbols_to_u8(
    table: &[HuffmanCode],
    br: &mut BitReader,
    input: &[u8],
    preloaded: &mut HuffmanCode,
    ring_buffer: &mut [u8],
    pos: usize,
    limit: usize,
) -> Checked<usize> {
    const MAXIMAL_OVERREAD: usize = 4;
    // A symbol takes at most 15 bits, so this many can be read without looking at how much input is left.
    let unchecked = (br.bytes_before_guard() * 8 / 15)
        .saturating_sub(MAXIMAL_OVERREAD)
        .min(limit);
    let (head, tail) = ring_buffer
        .sub_mut(pos..pos + limit)?
        .split_at_mut_checked(unchecked)
        .ok_or(Bug)?;
    for slot in head {
        *slot = read_preloaded_symbol(table, br, input, preloaded)? as u8;
    }
    let mut copies = unchecked;
    for slot in tail {
        if !br.has_fast_input() {
            break;
        }
        *slot = read_preloaded_symbol(table, br, input, preloaded)? as u8;
        copies += 1;
    }
    Ok(copies)
}

impl HeaderReader {
    fn new() -> Self {
        Self {
            substate_tree_group: TreeGroupState::None,
            substate_context_map: ContextMapState::None,
            substate_huffman: HuffmanState::None,
            substate_decode_uint8: DecodeUint8State::None,
            sub_loop_counter: 0,
            repeat_code_len: 0,
            prev_code_len: 0,
            symbol: 0,
            repeat: 0,
            space: 0,
            table: [HuffmanCode::default(); 1 << HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH],
            symbol_lists: [0; SYMBOL_LIST_BASE + NUM_COMMAND_SYMBOLS],
            next_symbol: [0; HUFFMAN_MAX_CODE_LENGTH + 1],
            code_length_code_lengths: [0; CODE_LENGTH_CODES],
            code_length_histo: [0; HUFFMAN_MAX_CODE_LENGTH + 1],
            tree_index: 0,
            next_start: 0,
            max_run_length_prefix: 0,
        }
    }

    /// Reads a number from 0 to 255, which takes 1 to 11 bits. `value` holds an intermediate result between calls.
    fn decode_var_len_uint8(&mut self, br: &mut BitReader, input: &[u8], value: &mut u32) -> Step {
        if self.substate_decode_uint8 == DecodeUint8State::None {
            let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
            if bits == 0 {
                *value = 0;
                return Ok(());
            }
            self.substate_decode_uint8 = DecodeUint8State::Short;
        }
        if self.substate_decode_uint8 == DecodeUint8State::Short {
            let bits = br.safe_read_bits(input, 3).ok_or(E::NeedsMoreInput)?;
            if bits == 0 {
                *value = 1;
                self.substate_decode_uint8 = DecodeUint8State::None;
                return Ok(());
            }
            *value = bits as u32;
            self.substate_decode_uint8 = DecodeUint8State::Long;
        }
        let bits = br.safe_read_bits(input, *value).ok_or(E::NeedsMoreInput)?;
        *value = (1 << *value) + bits as u32;
        self.substate_decode_uint8 = DecodeUint8State::None;
        Ok(())
    }

    /// Reads the `self.symbol + 1` symbols of a simple prefix code, which have to differ.
    fn read_simple_huffman_symbols(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        alphabet_size_max: u32,
        alphabet_size_limit: u32,
    ) -> Step {
        let max_bits = simple_code_symbol_bits(alphabet_size_max);
        let num_symbols = self.symbol as usize;
        let mut i = self.sub_loop_counter as usize;
        while i <= num_symbols {
            let Some(symbol) = br.safe_read_bits(input, max_bits) else {
                self.sub_loop_counter = i as u32;
                return Err(E::NeedsMoreInput);
            };
            if symbol >= u64::from(alphabet_size_limit) {
                return Err(E::FormatSimpleHuffmanAlphabet);
            }
            self.symbol_lists.put(i, symbol as u16)?;
            i += 1;
        }

        let symbols = self.symbol_lists.sub(..=num_symbols)?;
        for (i, symbol) in symbols.iter().enumerate() {
            if symbols.sub(i + 1..)?.contains(symbol) {
                return Err(E::FormatSimpleHuffmanSame);
            }
        }
        Ok(())
    }

    /// Takes note of the code length of the next symbol.
    #[inline(always)]
    fn process_single_code_length(&mut self, code_len: u32) -> Checked {
        self.repeat = 0;
        if code_len != 0 {
            let tail = self.next_symbol.at_mut(code_len as usize)?;
            self.symbol_lists
                .put(usize::from(*tail), self.symbol as u16)?;
            *tail = (SYMBOL_LIST_BASE as u32 + self.symbol) as u16;
            self.prev_code_len = code_len;
            self.space = self.space.wrapping_sub(32768 >> code_len);
            *self.code_length_histo.at_mut(code_len as usize)? += 1;
        }
        self.symbol += 1;
        Ok(())
    }

    /// Takes note of a code length that is repeated: the previous one that was not 0 (`code_len` 16) or 0 (17). One
    /// such code right after another of the same kind makes the run longer.
    #[inline(always)]
    fn process_repeated_code_length(
        &mut self,
        code_len: u32,
        repeat_delta: u32,
        alphabet_size: u32,
    ) -> Checked {
        let (new_len, extra_bits) = if code_len as usize == REPEAT_PREVIOUS_CODE_LENGTH {
            (self.prev_code_len, 2)
        } else {
            (0, 3)
        };
        if self.repeat_code_len != new_len {
            self.repeat = 0;
            self.repeat_code_len = new_len;
        }
        let old_repeat = self.repeat;
        if self.repeat > 0 {
            self.repeat -= 2;
            self.repeat <<= extra_bits;
        }
        self.repeat += repeat_delta + 3;
        let repeat_delta = self.repeat - old_repeat;
        if self.symbol + repeat_delta > alphabet_size {
            self.symbol = alphabet_size;
            self.space = 0xFFFFF;
            return Ok(());
        }
        if self.repeat_code_len != 0 {
            let code_len = self.repeat_code_len as usize;
            let mut next = usize::from(self.next_symbol.at(code_len)?);
            for symbol in self.symbol..self.symbol + repeat_delta {
                self.symbol_lists.put(next, symbol as u16)?;
                next = SYMBOL_LIST_BASE + symbol as usize;
            }
            self.symbol += repeat_delta;
            self.next_symbol.put(code_len, next as u16)?;
            self.space = self
                .space
                .wrapping_sub(repeat_delta << (15 - self.repeat_code_len));
            let histo = self.code_length_histo.at_mut(code_len)?;
            *histo = histo.wrapping_add(repeat_delta as u16);
        } else {
            self.symbol += repeat_delta;
        }
        Ok(())
    }

    /// Reads the code lengths of the symbols for as long as there is plenty of input.
    fn read_symbol_code_lengths(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        alphabet_size: u32,
    ) -> Step {
        if !br.warmup(input) {
            return Err(E::NeedsMoreInput);
        }
        while self.symbol < alphabet_size && self.space > 0 {
            if !br.has_fast_input() {
                return Err(E::NeedsMoreInput);
            }
            br.fill_bit_window_32(input)?;
            let index = br.bits_unmasked() & bit_mask(HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH as u32);
            let entry = self.table.at(index as usize)?;
            br.drop_bits(u32::from(entry.bits()));
            let code_len = u32::from(entry.value());
            if (code_len as usize) < REPEAT_PREVIOUS_CODE_LENGTH {
                self.process_single_code_length(code_len)?;
            } else {
                let extra_bits = if code_len as usize == REPEAT_PREVIOUS_CODE_LENGTH {
                    2
                } else {
                    3
                };
                let repeat_delta = br.take_bits(extra_bits) as u32;
                self.process_repeated_code_length(code_len, repeat_delta, alphabet_size)?;
            }
        }
        Ok(())
    }

    /// Reads the code lengths of the symbols up to the last bit of the input.
    fn safe_read_symbol_code_lengths(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        alphabet_size: u32,
    ) -> Step {
        let mut get_byte = false;
        while self.symbol < alphabet_size && self.space > 0 {
            if get_byte && !br.pull_byte(input) {
                return Err(E::NeedsMoreInput);
            }
            get_byte = false;
            let available_bits = br.available_bits();
            let bits = if available_bits != 0 {
                br.bits_unmasked() as u32
            } else {
                0
            };
            let index = u64::from(bits) & bit_mask(HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH as u32);
            let entry = self.table.at(index as usize)?;
            let entry_bits = u32::from(entry.bits());
            if entry_bits > available_bits {
                get_byte = true;
                continue;
            }
            let code_len = u32::from(entry.value());
            if (code_len as usize) < REPEAT_PREVIOUS_CODE_LENGTH {
                br.drop_bits(entry_bits);
                self.process_single_code_length(code_len)?;
            } else {
                let extra_bits = code_len - 14;
                let repeat_delta = (bits >> entry_bits) & bit_mask(extra_bits) as u32;
                if available_bits < entry_bits + extra_bits {
                    get_byte = true;
                    continue;
                }
                br.drop_bits(entry_bits + extra_bits);
                self.process_repeated_code_length(code_len, repeat_delta, alphabet_size)?;
            }
        }
        Ok(())
    }

    /// Reads the code lengths of the code that the code lengths are written in: up to 18 of them, 2 to 4 bits each.
    fn read_code_length_code_lengths(&mut self, br: &mut BitReader, input: &[u8]) -> Step {
        let mut num_codes = self.repeat;
        let mut space = self.space;
        let mut i = self.sub_loop_counter as usize;
        while i < CODE_LENGTH_CODES {
            let code_len_idx = usize::from(CODE_LENGTH_CODE_ORDER.at(i)?);
            let ix = match br.safe_get_bits(input, 4) {
                Some(ix) => ix as usize,
                None => {
                    let available_bits = br.available_bits();
                    let ix = if available_bits != 0 {
                        (br.bits_unmasked() & 0xF) as usize
                    } else {
                        0
                    };
                    if u32::from(CODE_LENGTH_PREFIX_LENGTH.at(ix)?) > available_bits {
                        self.sub_loop_counter = i as u32;
                        self.repeat = num_codes;
                        self.space = space;
                        return Err(E::NeedsMoreInput);
                    }
                    ix
                }
            };
            let code_len = CODE_LENGTH_PREFIX_VALUE.at(ix)?;
            br.drop_bits(u32::from(CODE_LENGTH_PREFIX_LENGTH.at(ix)?));
            self.code_length_code_lengths.put(code_len_idx, code_len)?;
            if code_len != 0 {
                space = space.wrapping_sub(32 >> code_len);
                num_codes += 1;
                *self.code_length_histo.at_mut(usize::from(code_len))? += 1;
                if space.wrapping_sub(1) >= 32 {
                    // It is 0, or less than that.
                    break;
                }
            }
            i += 1;
        }
        if !(num_codes == 1 || space == 0) {
            return Err(E::FormatClSpace);
        }
        Ok(())
    }

    /// Reads a prefix code (3.4 and 3.5) and builds its lookup table in `table`. Returns the size of the table.
    fn read_huffman_code(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        alphabet_size_max: u32,
        alphabet_size_limit: u32,
        table: &mut [HuffmanCode],
    ) -> Step<u32> {
        loop {
            match self.substate_huffman {
                HuffmanState::None => {
                    self.sub_loop_counter =
                        br.safe_read_bits(input, 2).ok_or(E::NeedsMoreInput)? as u32;
                    // 1 for a simple code. Otherwise how many code lengths to skip: 0, 2 or 3.
                    if self.sub_loop_counter != 1 {
                        self.space = 32;
                        self.repeat = 0;
                        self.code_length_histo
                            .sub_mut(..=HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH)?
                            .fill(0);
                        self.code_length_code_lengths.fill(0);
                        self.substate_huffman = HuffmanState::Complex;
                    } else {
                        self.substate_huffman = HuffmanState::SimpleSize;
                    }
                }

                HuffmanState::SimpleSize => {
                    self.symbol = br.safe_read_bits(input, 2).ok_or(E::NeedsMoreInput)? as u32;
                    self.sub_loop_counter = 0;
                    self.substate_huffman = HuffmanState::SimpleRead;
                }

                HuffmanState::SimpleRead => {
                    self.read_simple_huffman_symbols(
                        br,
                        input,
                        alphabet_size_max,
                        alphabet_size_limit,
                    )?;
                    self.substate_huffman = HuffmanState::SimpleBuild;
                }

                HuffmanState::SimpleBuild => {
                    if self.symbol == 3 {
                        self.symbol += br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)? as u32;
                    }
                    let symbols = self.symbol_lists.array_at_mut(0)?;
                    let table_size = build_simple_huffman_table(table, symbols, self.symbol)?;
                    self.substate_huffman = HuffmanState::None;
                    return Ok(table_size);
                }

                HuffmanState::Complex => {
                    self.read_code_length_code_lengths(br, input)?;
                    build_code_lengths_huffman_table(
                        &mut self.table,
                        &self.code_length_code_lengths,
                        &self.code_length_histo,
                    )?;
                    self.code_length_histo.fill(0);
                    for (i, (tail, head)) in self
                        .next_symbol
                        .iter_mut()
                        .zip(&mut self.symbol_lists)
                        .enumerate()
                    {
                        *tail = i as u16;
                        *head = 0xFFFF;
                    }

                    self.symbol = 0;
                    self.prev_code_len = INITIAL_REPEATED_CODE_LENGTH as u32;
                    self.repeat = 0;
                    self.repeat_code_len = 0;
                    self.space = 32768;
                    self.substate_huffman = HuffmanState::LengthSymbols;
                }

                HuffmanState::LengthSymbols => {
                    let mut result = self.read_symbol_code_lengths(br, input, alphabet_size_limit);
                    if result == Err(E::NeedsMoreInput) {
                        result = self.safe_read_symbol_code_lengths(br, input, alphabet_size_limit);
                    }
                    result?;

                    if self.space != 0 {
                        return Err(E::FormatHuffmanSpace);
                    }
                    let table_size = build_huffman_table(
                        table,
                        &self.symbol_lists,
                        &mut self.code_length_histo,
                    )?;
                    self.substate_huffman = HuffmanState::None;
                    return Ok(table_size);
                }
            }
        }
    }

    /// Reads all the prefix codes of `group`.
    fn read_tree_group(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        group: &mut HuffmanTreeGroup,
    ) -> Step {
        if self.substate_tree_group != TreeGroupState::Loop {
            self.next_start = 0;
            self.tree_index = 0;
            self.substate_tree_group = TreeGroupState::Loop;
        }
        while self.tree_index < group.starts.len() {
            let table_size = self.read_huffman_code(
                br,
                input,
                u32::from(group.alphabet_size_max),
                u32::from(group.alphabet_size_limit),
                group.codes.sub_mut(self.next_start..)?,
            )?;
            group.starts.put(self.tree_index, self.next_start)?;
            self.next_start += table_size as usize;
            self.tree_index += 1;
        }
        self.substate_tree_group = TreeGroupState::None;
        Ok(())
    }

    /// 7.3. Reads a context map of `context_map_size` entries into `context_map`, and into `num_trees` how many trees
    /// it refers to. Both keep intermediate results between calls, and so does `table`.
    fn decode_context_map(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        table: &mut [HuffmanCode; HUFFMAN_MAX_SIZE_272],
        context_map_size: u32,
        num_trees: &mut u32,
        context_map: &mut Vec<u8>,
    ) -> Step {
        loop {
            match self.substate_context_map {
                ContextMapState::None => {
                    self.decode_var_len_uint8(br, input, num_trees)?;
                    *num_trees += 1;
                    *context_map =
                        try_zeroed(context_map_size as usize).map_err(|_| E::AllocContextMap)?;
                    if *num_trees <= 1 {
                        return Ok(());
                    }
                    self.substate_context_map = ContextMapState::ReadPrefix;
                }

                ContextMapState::ReadPrefix => {
                    // The prefix code that follows takes at least 4 bits, so it is safe to peek that far.
                    let bits = br.safe_get_bits(input, 5).ok_or(E::NeedsMoreInput)? as u32;
                    if bits & 1 != 0 {
                        self.max_run_length_prefix = (bits >> 1) + 1;
                        br.drop_bits(5);
                    } else {
                        self.max_run_length_prefix = 0;
                        br.drop_bits(1);
                    }
                    self.substate_context_map = ContextMapState::Huffman;
                }

                ContextMapState::Huffman => {
                    let alphabet_size = *num_trees + self.max_run_length_prefix;
                    self.read_huffman_code(br, input, alphabet_size, alphabet_size, table)?;
                    self.substate_context_map = ContextMapState::Decode {
                        context_index: 0,
                        pending_run: None,
                    };
                }

                ContextMapState::Decode {
                    mut context_index,
                    mut pending_run,
                } => {
                    let max_run_length_prefix = self.max_run_length_prefix;
                    while context_index < context_map_size || pending_run.is_some() {
                        let run = match pending_run.take() {
                            Some(run) => run,
                            None => {
                                let Some(symbol) =
                                    safe_read_symbol(Tree::new(table, 0), br, input)?
                                else {
                                    self.substate_context_map = ContextMapState::Decode {
                                        context_index,
                                        pending_run: None,
                                    };
                                    return Err(E::NeedsMoreInput);
                                };
                                if symbol == 0 || symbol > max_run_length_prefix {
                                    let tree = symbol.saturating_sub(max_run_length_prefix);
                                    context_map.put(context_index as usize, tree as u8)?;
                                    context_index += 1;
                                    continue;
                                }
                                symbol
                            }
                        };
                        let Some(reps) = br.safe_read_bits(input, run) else {
                            self.substate_context_map = ContextMapState::Decode {
                                context_index,
                                pending_run: Some(run),
                            };
                            return Err(E::NeedsMoreInput);
                        };
                        let reps = reps as u32 + (1 << run);
                        if context_index + reps > context_map_size {
                            return Err(E::FormatContextMapRepeat);
                        }
                        context_map
                            .sub_mut(context_index as usize..(context_index + reps) as usize)?
                            .fill(0);
                        context_index += reps;
                    }
                    self.substate_context_map = ContextMapState::Transform;
                }

                ContextMapState::Transform => {
                    let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
                    if bits != 0 {
                        inverse_move_to_front_transform(context_map)?;
                    }
                    self.substate_context_map = ContextMapState::None;
                    return Ok(());
                }
            }
        }
    }
}

/// Reads a block count, which takes 3 to 39 bits.
#[inline(always)]
fn read_block_length(table: Tree<'_>, br: &mut BitReader, input: &[u8]) -> Checked<u32> {
    let code = read_symbol(table, br, input)?;
    let range = BLOCK_LENGTH_PREFIX_CODE.at(code as usize)?;
    Ok(u32::from(range.offset) + br.read_bits(input, u32::from(range.nbits))? as u32)
}

/// [`read_block_length`] up to the last bit of the input. `None` if the input ends before. The symbol is kept in
/// `pending_symbol` if it was consumed by then.
#[inline(always)]
fn safe_read_block_length(
    pending_symbol: &mut Option<u32>,
    table: Tree<'_>,
    br: &mut BitReader,
    input: &[u8],
) -> Checked<Option<u32>> {
    let symbol = match *pending_symbol {
        Some(symbol) => symbol,
        None => match safe_read_symbol(table, br, input)? {
            Some(symbol) => symbol,
            None => return Ok(None),
        },
    };
    let range = BLOCK_LENGTH_PREFIX_CODE.at(symbol as usize)?;
    let Some(bits) = br.safe_read_bits(input, u32::from(range.nbits)) else {
        *pending_symbol = Some(symbol);
        return Ok(None);
    };
    *pending_symbol = None;
    Ok(Some(u32::from(range.offset) + bits as u32))
}

/// 7.3. Replaces each index in `map` by the value at that index of a list, which starts as 0, 1, 2, ..., and moves the
/// value to the front of the list.
fn inverse_move_to_front_transform(map: &mut [u8]) -> Checked {
    let mut mtf = [0u8; 256];
    for (i, value) in mtf.iter_mut().enumerate() {
        *value = i as u8;
    }
    for item in map {
        let index = usize::from(*item);
        let value = mtf.at(index)?;
        *item = value;
        mtf.move_within(0, 1, index)?;
        mtf[0] = value;
    }
    Ok(())
}

/// Where the loop of [`Decoder::process_commands_internal`] goes on.
#[derive(Clone, Copy)]
enum Label {
    CommandBegin,
    CommandInner,
    CommandPostDecodeLiterals,
    CommandPostWrapCopy,
    NextLiteralBlock,
}

/// Whether [`Decoder::step`] has more to do.
enum Flow {
    Continue,
    Finished,
}

impl Decoder {
    pub fn new() -> Self {
        Self {
            state: State::Uninited,
            loop_counter: 0,
            br: BitReader::default(),
            buffer: [0; 8],
            buffer_length: 0,
            pos: 0,
            max_backward_distance: 0,
            max_distance: 0,
            ring_buffer_size: 0,
            ring_buffer_mask: 0,
            last_distances: [16, 15, 11, 4],
            last_distances_pos: 0,
            error_code: E::NoError,
            meta_block_remaining_len: 0,
            ring_buffer: Vec::new(),
            command_tree: 0,
            context_lookup: context_lut(ContextType::Lsb6),
            context_map_slice: 0,
            literal_trees: HuffmanTreeGroup::default(),
            command_trees: HuffmanTreeGroup::default(),
            distance_trees: HuffmanTreeGroup::default(),
            block_type_trees: Vec::new(),
            block_length_trees: Vec::new(),
            trivial_literal_context: false,
            distance_context: 0,
            block_length: [0; NUM_BLOCK_CATEGORIES],
            pending_block_length_symbol: None,
            num_block_types: [0; NUM_BLOCK_CATEGORIES],
            last_block_types: [[0; 2]; NUM_BLOCK_CATEGORIES],
            distance_postfix_bits: 0,
            num_direct_distance_codes: 0,
            num_distance_trees: 0,
            distance_context_map: Vec::new(),
            literal_tree: 0,
            ring_buffer_roundtrips: 0,
            partial_pos_out: 0,
            copy_length: 0,
            implicit_distance: false,
            distance: 0,
            distance_tree_by_context: [0; 1 << DISTANCE_CONTEXT_BITS],
            distance_tree: 0,
            substate_meta_block_header: MetaBlockHeaderState::None,
            substate_uncompressed: UncompressedState::None,
            new_ring_buffer_size: 0,
            is_last_meta_block: false,
            is_uncompressed: false,
            is_metadata: false,
            should_wrap_ring_buffer: false,
            canny_ring_buffer_allocation: true,
            large_window: false,
            window_bits: 0,
            size_nibbles: 0,
            num_literal_trees: 0,
            context_map: Vec::new(),
            context_modes: Vec::new(),
            compound_dictionary: None,
            trivial_literal_contexts: [0; 8],
            header: HeaderReader::new(),
            context_map_table: [HuffmanCode::default(); HUFFMAN_MAX_SIZE_272],
            distance_symbols: DistanceSymbols {
                extra_bits: [0; MAX_DISTANCE_SYMBOLS],
                offset: [0; MAX_DISTANCE_SYMBOLS],
            },
        }
    }

    /// Only before the first byte of input. Whether the parameter was set.
    pub fn set_parameter(&mut self, parameter: DecoderParameter, value: u32) -> bool {
        if self.state != State::Uninited {
            return false;
        }
        match parameter {
            DecoderParameter::DisableRingBufferReallocation => {
                self.canny_ring_buffer_allocation = value == 0
            }
            DecoderParameter::LargeWindow => self.large_window = value != 0,
        }
        true
    }

    /// Makes `data` what backward references find before the start of the stream. Only before the first byte of input,
    /// and up to 15 times: each call adds to the end. Whether `data` was attached.
    pub fn attach_dictionary(&mut self, data: Box<[u8]>) -> bool {
        if self.state != State::Uninited {
            return false;
        }
        if self.compound_dictionary.is_none() {
            self.compound_dictionary = CompoundDictionary::try_new().ok();
        }
        match &mut self.compound_dictionary {
            Some(compound) => compound.attach(data),
            None => false,
        }
    }

    /// The dictionaries that were attached, in that order, for another decoder.
    pub fn into_dictionaries(self) -> Vec<Box<[u8]>> {
        self.compound_dictionary
            .map_or_else(Vec::new, |compound| compound.chunks)
    }

    /// Why the last call of [`Self::decompress_stream`] returned.
    pub fn error_code(&self) -> E {
        self.error_code
    }

    /// Whether there is output that [`Self::decompress_stream`] can write without more input.
    pub fn has_more_output(&self) -> bool {
        if self.error_code.is_error() {
            return false;
        }
        !self.ring_buffer.is_empty() && self.unwritten_bytes(false) != 0
    }

    /// Reads the window size from 1 to 7 bits, or the 8 bits that announce a large window. The accumulator holds at
    /// least 8 bits.
    fn decode_window_bits(&mut self) -> Step {
        let br = &mut self.br;
        let large_window = self.large_window;
        self.large_window = false;
        if br.take_bits(1) == 0 {
            self.window_bits = 16;
            return Ok(());
        }
        let n = br.take_bits(3) as u32;
        if n != 0 {
            self.window_bits = 17 + n;
            return Ok(());
        }
        let n = br.take_bits(3) as u32;
        if n == 1 {
            if large_window {
                if br.take_bits(1) == 1 {
                    return Err(E::FormatWindowBits);
                }
                self.large_window = true;
                return Ok(());
            }
            return Err(E::FormatWindowBits);
        }
        if n != 0 {
            self.window_bits = 8 + n;
            return Ok(());
        }
        self.window_bits = 17;
        Ok(())
    }

    /// 9.2. Reads the length and the flags of a meta-block, which take 2 to 31 bits.
    fn decode_meta_block_length(&mut self, input: &[u8]) -> Step {
        let br = &mut self.br;
        loop {
            match self.substate_meta_block_header {
                MetaBlockHeaderState::None => {
                    let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
                    self.is_last_meta_block = bits != 0;
                    self.meta_block_remaining_len = 0;
                    self.is_uncompressed = false;
                    self.is_metadata = false;
                    self.substate_meta_block_header = if self.is_last_meta_block {
                        MetaBlockHeaderState::Empty
                    } else {
                        MetaBlockHeaderState::Nibbles
                    };
                }

                MetaBlockHeaderState::Empty => {
                    let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
                    if bits != 0 {
                        self.substate_meta_block_header = MetaBlockHeaderState::None;
                        return Ok(());
                    }
                    self.substate_meta_block_header = MetaBlockHeaderState::Nibbles;
                }

                MetaBlockHeaderState::Nibbles => {
                    let bits = br.safe_read_bits(input, 2).ok_or(E::NeedsMoreInput)?;
                    self.size_nibbles = bits as u8 + 4;
                    self.loop_counter = 0;
                    if bits == 3 {
                        self.is_metadata = true;
                        self.substate_meta_block_header = MetaBlockHeaderState::Reserved;
                    } else {
                        self.substate_meta_block_header = MetaBlockHeaderState::Size;
                    }
                }

                MetaBlockHeaderState::Size => {
                    let size_nibbles = i32::from(self.size_nibbles);
                    while self.loop_counter < size_nibbles {
                        let i = self.loop_counter;
                        let bits = br.safe_read_bits(input, 4).ok_or(E::NeedsMoreInput)?;
                        if i + 1 == size_nibbles && size_nibbles > 4 && bits == 0 {
                            return Err(E::FormatExuberantNibble);
                        }
                        self.meta_block_remaining_len |= (bits << (i * 4)) as i32;
                        self.loop_counter += 1;
                    }
                    self.substate_meta_block_header = MetaBlockHeaderState::Uncompressed;
                }

                MetaBlockHeaderState::Uncompressed => {
                    if !self.is_last_meta_block {
                        let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
                        self.is_uncompressed = bits != 0;
                    }
                    self.meta_block_remaining_len += 1;
                    self.substate_meta_block_header = MetaBlockHeaderState::None;
                    return Ok(());
                }

                MetaBlockHeaderState::Reserved => {
                    let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
                    if bits != 0 {
                        return Err(E::FormatReserved);
                    }
                    self.substate_meta_block_header = MetaBlockHeaderState::Bytes;
                }

                MetaBlockHeaderState::Bytes => {
                    let bits = br.safe_read_bits(input, 2).ok_or(E::NeedsMoreInput)?;
                    if bits == 0 {
                        self.substate_meta_block_header = MetaBlockHeaderState::None;
                        return Ok(());
                    }
                    self.size_nibbles = bits as u8;
                    self.substate_meta_block_header = MetaBlockHeaderState::Metadata;
                }

                MetaBlockHeaderState::Metadata => {
                    let size_bytes = i32::from(self.size_nibbles);
                    while self.loop_counter < size_bytes {
                        let i = self.loop_counter;
                        let bits = br.safe_read_bits(input, 8).ok_or(E::NeedsMoreInput)?;
                        if i + 1 == size_bytes && size_bytes > 1 && bits == 0 {
                            return Err(E::FormatExuberantMetaNibble);
                        }
                        self.meta_block_remaining_len |= (bits << (i * 8)) as i32;
                        self.loop_counter += 1;
                    }
                    self.meta_block_remaining_len += 1;
                    self.substate_meta_block_header = MetaBlockHeaderState::None;
                    return Ok(());
                }
            }
        }
    }

    /// 6. Reads a block switch command, which takes 3 to 54 bits.
    #[inline(always)]
    fn decode_block_type_and_length<const SAFE: bool>(
        &mut self,
        input: &[u8],
        category: usize,
    ) -> Step {
        let max_block_type = self.num_block_types.at(category)?;
        let type_tree = Tree::new(&self.block_type_trees, category * HUFFMAN_MAX_SIZE_258);
        let length_tree = Tree::new(&self.block_length_trees, category * HUFFMAN_MAX_SIZE_26);
        let br = &mut self.br;
        if max_block_type <= 1 {
            return Err(E::FormatBlockSwitch);
        }

        let mut block_type;
        if !SAFE {
            block_type = read_symbol(type_tree, br, input)?;
            self.block_length
                .put(category, read_block_length(length_tree, br, input)?)?;
        } else {
            let memento = *br;
            block_type = safe_read_symbol(type_tree, br, input)?.ok_or(E::NeedsMoreInput)?;
            let Some(block_length) = safe_read_block_length(
                &mut self.pending_block_length_symbol,
                length_tree,
                br,
                input,
            )?
            else {
                self.pending_block_length_symbol = None;
                *br = memento;
                return Err(E::NeedsMoreInput);
            };
            self.block_length.put(category, block_length)?;
        }

        let last_types = self.last_block_types.at_mut(category)?;
        if block_type == 1 {
            block_type = last_types[1] + 1;
        } else if block_type == 0 {
            block_type = last_types[0];
        } else {
            block_type -= 2;
        }
        if block_type >= max_block_type {
            block_type -= max_block_type;
        }
        *last_types = [last_types[1], block_type];
        Ok(())
    }

    fn detect_trivial_literal_block_types(&mut self) -> Checked {
        self.trivial_literal_contexts = [0; 8];
        let (contexts, _) = self
            .context_map
            .as_chunks::<{ 1 << LITERAL_CONTEXT_BITS }>();
        for (i, contexts) in contexts
            .iter()
            .take(self.num_block_types[LITERAL] as usize)
            .enumerate()
        {
            let sample = contexts[0];
            if contexts.iter().all(|&tree| tree == sample) {
                *self.trivial_literal_contexts.at_mut(i >> 5)? |= 1 << (i & 31);
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn prepare_literal_decoding(&mut self) -> Checked {
        let block_type = self.last_block_types[LITERAL][1] as usize;
        self.context_map_slice = block_type << LITERAL_CONTEXT_BITS;
        let trivial = self.trivial_literal_contexts.at(block_type >> 5)?;
        self.trivial_literal_context = (trivial >> (block_type & 31)) & 1 != 0;
        let tree = self.context_map.at(self.context_map_slice)?;
        self.literal_tree = self.literal_trees.starts.at(usize::from(tree))?;
        self.context_lookup =
            context_lut(ContextType::from_bits(self.context_modes.at(block_type)?));
        Ok(())
    }

    fn prepare_distance_decoding(&mut self) -> Checked {
        let block_type = self.last_block_types[DISTANCE][1] as usize;
        let trees: &[u8; 1 << DISTANCE_CONTEXT_BITS] = self
            .distance_context_map
            .array_at(block_type << DISTANCE_CONTEXT_BITS)?;
        for (start, &tree) in self.distance_tree_by_context.iter_mut().zip(trees) {
            *start = self.distance_trees.starts.at(usize::from(tree))?;
        }
        Ok(())
    }

    #[inline(never)]
    fn decode_literal_block_switch<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        self.decode_block_type_and_length::<SAFE>(input, LITERAL)?;
        self.prepare_literal_decoding()?;
        Ok(())
    }

    #[inline(never)]
    fn decode_command_block_switch<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        self.decode_block_type_and_length::<SAFE>(input, COMMAND)?;
        self.command_tree = self
            .command_trees
            .starts
            .at(self.last_block_types[COMMAND][1] as usize)?;
        Ok(())
    }

    #[inline(never)]
    fn decode_distance_block_switch<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        self.decode_block_type_and_length::<SAFE>(input, DISTANCE)?;
        self.prepare_distance_decoding()?;
        self.distance_tree = self
            .distance_tree_by_context
            .at(self.distance_context as usize)?;
        Ok(())
    }

    /// How much of the ring buffer was not handed to the caller yet. With `wrap`, what lies past its end is left out.
    fn unwritten_bytes(&self, wrap: bool) -> usize {
        let pos = if wrap && self.pos > self.ring_buffer_size {
            self.ring_buffer_size
        } else {
            self.pos
        } as usize;
        let produced = self
            .ring_buffer_roundtrips
            .wrapping_mul(self.ring_buffer_size as usize)
            .wrapping_add(pos);
        produced.wrapping_sub(self.partial_pos_out)
    }

    /// Hands output to the caller. Asks for more room only if there is more to write and either the ring buffer cannot
    /// grow any further or `force` is set.
    fn write_ring_buffer(&mut self, output: &mut dyn Output, force: bool) -> Step {
        let start = self.partial_pos_out & self.ring_buffer_mask as usize;
        let to_write = self.unwritten_bytes(true);
        if self.meta_block_remaining_len < 0 {
            return Err(E::FormatBlockLength1);
        }
        let num_written = output.write(self.ring_buffer.sub(start..start + to_write)?);
        self.partial_pos_out += num_written;
        let at_full_size = self.ring_buffer_size == 1 << self.window_bits;
        if num_written < to_write {
            if at_full_size || force {
                return Err(E::NeedsMoreOutput);
            }
            return Ok(());
        }
        if at_full_size && self.pos >= self.ring_buffer_size {
            self.pos -= self.ring_buffer_size;
            self.ring_buffer_roundtrips += 1;
            self.should_wrap_ring_buffer = self.pos != 0;
        }
        Ok(())
    }

    /// Moves what was written past the end of the ring buffer to its start.
    fn wrap_ring_buffer(&mut self) -> Checked {
        if self.should_wrap_ring_buffer {
            self.ring_buffer
                .move_within(self.ring_buffer_size as usize, 0, self.pos as usize)?;
            self.should_wrap_ring_buffer = false;
        }
        Ok(())
    }

    /// Makes the ring buffer as large as [`Self::calculate_ring_buffer_size`] found it has to be. Fails with
    /// `out_of_memory` if there is no memory for that.
    fn ensure_ring_buffer(&mut self, out_of_memory: E) -> Step {
        if self.ring_buffer_size == self.new_ring_buffer_size {
            return Ok(());
        }
        let mut ring_buffer =
            try_zeroed::<u8>(self.new_ring_buffer_size as usize + RING_BUFFER_WRITE_AHEAD_SLACK)
                .map_err(|_| out_of_memory)?;
        if !self.ring_buffer.is_empty() {
            ring_buffer.write_at(0, self.ring_buffer.sub(..self.pos as usize)?)?;
        }
        self.ring_buffer = ring_buffer;
        self.ring_buffer_size = self.new_ring_buffer_size;
        self.ring_buffer_mask = self.new_ring_buffer_size - 1;
        Ok(())
    }

    fn skip_metadata_block(&mut self) -> Step {
        let nbytes = (self.br.remaining_bytes() as i32).min(self.meta_block_remaining_len);
        self.br.skip_bytes(nbytes as usize);
        self.meta_block_remaining_len -= nbytes;
        if self.meta_block_remaining_len != 0 {
            return Err(E::NeedsMoreInput);
        }
        Ok(())
    }

    fn copy_uncompressed_block_to_output(&mut self, input: &[u8], output: &mut dyn Output) -> Step {
        self.ensure_ring_buffer(E::AllocRingBuffer1)?;

        loop {
            match self.substate_uncompressed {
                UncompressedState::None => {
                    let mut nbytes =
                        (self.br.remaining_bytes() as i32).min(self.meta_block_remaining_len);
                    if self.pos + nbytes > self.ring_buffer_size {
                        nbytes = self.ring_buffer_size - self.pos;
                    }
                    let dest = self
                        .ring_buffer
                        .sub_mut(self.pos as usize..(self.pos + nbytes) as usize)?;
                    self.br.copy_bytes(input, dest)?;
                    self.pos += nbytes;
                    self.meta_block_remaining_len -= nbytes;
                    if self.pos < 1 << self.window_bits {
                        if self.meta_block_remaining_len == 0 {
                            return Ok(());
                        }
                        return Err(E::NeedsMoreInput);
                    }
                    self.substate_uncompressed = UncompressedState::Write;
                }

                UncompressedState::Write => {
                    self.write_ring_buffer(output, false)?;
                    if self.ring_buffer_size == 1 << self.window_bits {
                        self.max_distance = self.max_backward_distance;
                    }
                    self.substate_uncompressed = UncompressedState::None;
                }
            }
        }
    }

    fn compound_dictionary_size(&self) -> i32 {
        self.compound_dictionary
            .as_ref()
            .map_or(0, |compound| compound.total_size)
    }

    /// Finds the smallest ring buffer that will do, now that the length and the flags of the meta-block are known: a
    /// stream that announces a large window need not have that much data.
    fn calculate_ring_buffer_size(&mut self) {
        let window_size = 1i32 << self.window_bits;
        let mut new_ring_buffer_size = window_size;
        // The context of the first byte is taken from the last two bytes of the ring buffer.
        let mut min_size = if self.ring_buffer_size != 0 {
            self.ring_buffer_size
        } else {
            1024
        };

        if self.ring_buffer_size == window_size {
            return;
        }
        if self.is_metadata {
            return;
        }

        let output_size = if self.ring_buffer.is_empty() {
            0
        } else {
            self.pos
        } + self.meta_block_remaining_len;
        min_size = min_size.max(output_size);

        if self.canny_ring_buffer_allocation {
            while (new_ring_buffer_size >> 1) >= min_size {
                new_ring_buffer_size >>= 1;
            }
        }

        self.new_ring_buffer_size = new_ring_buffer_size;
    }

    /// Reads the context mode of each literal block type.
    fn read_context_modes(&mut self, input: &[u8]) -> Step {
        while self.loop_counter < self.num_block_types[LITERAL] as i32 {
            let bits = self.br.safe_read_bits(input, 2).ok_or(E::NeedsMoreInput)?;
            self.context_modes
                .put(self.loop_counter as usize, bits as u8)?;
            self.loop_counter += 1;
        }
        Ok(())
    }

    /// 4. Turns `code`, one of the 16 distance codes that refer to the last distances, into a distance.
    #[inline(always)]
    fn take_last_distance(&mut self, code: i32) -> Checked {
        let offset = code - 3;
        if code <= 3 {
            // A dictionary reference does not become a last distance, and this makes up for that.
            self.distance_context = 1 >> code;
            self.distance = self
                .last_distances
                .at((self.last_distances_pos.wrapping_sub(offset) & 3) as usize)?;
            self.last_distances_pos = self.last_distances_pos.wrapping_sub(self.distance_context);
        } else {
            let (base, index_delta) = if code < 10 {
                (code - 4, 3)
            } else {
                (code - 10, 2)
            };
            // One of six 4-bit values.
            let delta = ((0x605142 >> (4 * base)) & 0xF) - 3;
            self.distance = self
                .last_distances
                .at((self.last_distances_pos.wrapping_add(index_delta) & 3) as usize)?
                + delta;
            if self.distance <= 0 {
                // Too large to be valid, which is noticed later.
                self.distance = 0x7FFF_FFFF;
            }
        }
        Ok(())
    }

    fn calculate_distance_lut(&mut self) -> Checked {
        let npostfix = self.distance_postfix_bits;
        let ndirect = self.num_direct_distance_codes;
        let alphabet_size_limit = usize::from(self.distance_trees.alphabet_size_limit);
        let postfix = 1u32 << npostfix;
        let mut bits = 1u32;
        let mut half = 0u32;

        let mut i = NUM_DISTANCE_SHORT_CODES as usize;

        for j in 0..ndirect {
            self.distance_symbols.set(i, 0, j + 1)?;
            i += 1;
        }

        while i < alphabet_size_limit {
            let base = ndirect + ((((2 + half) << bits) - 4) << npostfix) + 1;
            for j in 0..postfix {
                self.distance_symbols.set(i, bits, base + j)?;
                i += 1;
            }
            bits += half;
            half ^= 1;
        }
        Ok(())
    }

    /// Reads a distance code and its extra bits, and sets `distance`.
    #[inline(always)]
    fn read_distance<const SAFE: bool>(&mut self, br: &mut BitReader, input: &[u8]) -> Step {
        let distance_tree = Tree::new(&self.distance_trees.codes, self.distance_tree);
        let memento = *br;
        let code = read_symbol_maybe_safe::<SAFE>(distance_tree, br, input)?;
        self.block_length[DISTANCE] = self.block_length[DISTANCE].wrapping_sub(1);
        self.distance_context = 0;
        if code < NUM_DISTANCE_SHORT_CODES {
            self.take_last_distance(code as i32)?;
            return Ok(());
        }
        let nbits = u32::from(self.distance_symbols.extra_bits.at(code as usize)?);
        let offset = u64::from(self.distance_symbols.offset.at(code as usize)?);
        let bits = if !SAFE {
            br.read_bits(input, nbits)?
        } else {
            let Some(bits) = br.safe_read_bits(input, nbits) else {
                self.block_length[DISTANCE] = self.block_length[DISTANCE].wrapping_add(1);
                *br = memento;
                return Err(E::NeedsMoreInput);
            };
            bits
        };
        self.distance = (offset + (bits << self.distance_postfix_bits)) as i32;
        Ok(())
    }

    /// Reads an insert-and-copy length code and its extra bits. Returns the insert length.
    #[inline(always)]
    fn read_command<const SAFE: bool>(&mut self, br: &mut BitReader, input: &[u8]) -> Step<i32> {
        let command_tree = Tree::new(&self.command_trees.codes, self.command_tree);
        let memento = *br;
        let symbol = read_symbol_maybe_safe::<SAFE>(command_tree, br, input)?;
        let command = COMMAND_LUT.at(symbol as usize)?;
        self.implicit_distance = command.implicit_distance();
        self.distance_context = i32::from(command.context);
        self.distance_tree = self
            .distance_tree_by_context
            .at(usize::from(command.context))?;
        let insert_len_extra;
        let copy_length;
        if !SAFE {
            insert_len_extra = if command.insert_len_extra_bits != 0 {
                br.read_bits(input, u32::from(command.insert_len_extra_bits))?
            } else {
                0
            };
            copy_length = br.read_bits(input, u32::from(command.copy_len_extra_bits))?;
        } else {
            let extra = br
                .safe_read_bits(input, u32::from(command.insert_len_extra_bits))
                .and_then(|insert| {
                    Some((
                        insert,
                        br.safe_read_bits(input, u32::from(command.copy_len_extra_bits))?,
                    ))
                });
            let Some(extra) = extra else {
                *br = memento;
                return Err(E::NeedsMoreInput);
            };
            (insert_len_extra, copy_length) = extra;
        }
        self.copy_length = copy_length as i32 + i32::from(command.copy_len_offset);
        self.block_length[COMMAND] = self.block_length[COMMAND].wrapping_sub(1);
        Ok(i32::from(command.insert_len_offset) + insert_len_extra as i32)
    }

    /// Writes what `distance`, which is past the data seen so far, refers to in one of the dictionaries: `length`
    /// bytes of the compound dictionary, as far as there is room, or a word of `length` bytes of the static one,
    /// transformed. Returns the position after it.
    fn copy_from_dictionary(&mut self, ring_buffer: &mut [u8], pos: i32, length: i32) -> Step<i32> {
        if self.distance > MAX_ALLOWED_DISTANCE as i32 {
            return Err(E::FormatDistance);
        }
        let compound_dictionary_size = self.compound_dictionary_size();
        if self.distance - self.max_distance - 1 < compound_dictionary_size {
            let address = compound_dictionary_size - (self.distance - self.max_distance);
            let compound = self.compound_dictionary.as_deref_mut().ok_or(Bug)?;
            compound.start_copy(address, length)?;
            self.last_distances
                .put((self.last_distances_pos & 3) as usize, self.distance)?;
            self.last_distances_pos = self.last_distances_pos.wrapping_add(1);
            self.meta_block_remaining_len -= length;
            return Ok(pos + compound.copy_to(ring_buffer, self.ring_buffer_size, pos)?);
        }
        if length < MIN_DICTIONARY_WORD_LENGTH as i32 || length > MAX_DICTIONARY_WORD_LENGTH as i32
        {
            return Err(E::FormatDictionary);
        }
        let word_length = length as usize;
        let shift = u32::from(dictionary::SIZE_BITS_BY_LENGTH.at(word_length)?);
        let address = self.distance - self.max_distance - 1 - compound_dictionary_size;
        let word_idx = (address & bit_mask(shift) as i32) as usize;
        let transform_idx = (address >> shift) as usize;
        let offset =
            dictionary::OFFSETS_BY_LENGTH.at(word_length)? as usize + word_idx * word_length;
        // See `take_last_distance`.
        self.last_distances_pos = self.last_distances_pos.wrapping_add(self.distance_context);
        if transform_idx >= NUM_TRANSFORMS {
            return Err(E::FormatTransform);
        }
        let word = dictionary::DATA.sub(offset..offset + word_length)?;
        let len = if transform_idx == 0 {
            ring_buffer.write_at(pos as usize, word)?;
            length
        } else {
            let dst = ring_buffer.sub_mut(pos as usize..)?;
            let len = transform_dictionary_word(dst, word, transform_idx)? as i32;
            if len == 0 && self.distance <= 120 {
                return Err(E::FormatTransform);
            }
            len
        };
        self.meta_block_remaining_len -= len;
        Ok(pos + len)
    }

    /// A meta-block can end after the insert or after the copy of a command.
    #[inline(always)]
    fn end_meta_block_if_complete(&mut self) -> bool {
        let complete = self.meta_block_remaining_len <= 0;
        if complete {
            self.state = State::MetaBlockDone;
        }
        complete
    }

    /// 10. Decodes commands until the meta-block ends, the ring buffer is full, or the input runs out. `pos` is the
    /// position in the ring buffer and `remaining` how much is left of the insert or copy in progress.
    #[inline(always)]
    fn process_commands_internal<const SAFE: bool>(
        &mut self,
        input: &[u8],
        br: &mut BitReader,
        ring_buffer: &mut [u8],
        pos: &mut i32,
        remaining: &mut i32,
    ) -> Step {
        // The functions that are not inlined use `self.br`, so that `br` can stay in registers.
        macro_rules! block_switch {
            ($function:ident) => {{
                self.br = *br;
                let result = self.$function::<SAFE>(input);
                *br = self.br;
                result
            }};
        }
        // Writes a literal of the insert in progress. Leaves the loop around it after the last one.
        macro_rules! put_literal {
            ($literal:expr) => {
                ring_buffer.put(*pos as usize, $literal)?;
                self.block_length[LITERAL] -= 1;
                *pos += 1;
                *remaining -= 1;
                if *pos == self.ring_buffer_size {
                    self.state = State::WriteDuringInsert;
                    return Ok(());
                }
                if *remaining == 0 {
                    break;
                }
            };
        }

        if !(SAFE || br.has_fast_input()) {
            return Err(E::NeedsMoreInput);
        }
        if !SAFE {
            br.warmup(input);
        }

        let mut label = match self.state {
            State::CommandBegin => Label::CommandBegin,
            State::CommandInner => Label::CommandInner,
            State::CommandPostDecodeLiterals => Label::CommandPostDecodeLiterals,
            State::CommandPostWrapCopy => Label::CommandPostWrapCopy,
            _ => return Err(E::Unreachable),
        };

        loop {
            match label {
                Label::CommandBegin => {
                    if SAFE {
                        self.state = State::CommandBegin;
                    }
                    if !(SAFE || br.has_fast_input()) {
                        self.state = State::CommandBegin;
                        return Err(E::NeedsMoreInput);
                    }
                    if self.block_length[COMMAND] == 0 {
                        block_switch!(decode_command_block_switch)?;
                        continue;
                    }
                    *remaining = self.read_command::<SAFE>(br, input)?;
                    if *remaining == 0 {
                        label = Label::CommandPostDecodeLiterals;
                        continue;
                    }
                    self.meta_block_remaining_len -= *remaining;
                    label = Label::CommandInner;
                }

                Label::CommandInner => {
                    if SAFE {
                        self.state = State::CommandInner;
                    }
                    if self.trivial_literal_context {
                        let literal_tree = self.literal_trees.codes.sub(self.literal_tree..)?;
                        if !SAFE {
                            let mut preloaded = preload_symbol(literal_tree, br, input)?;
                            // The hottest part of the decoder. For this many literals neither the ring buffer nor the
                            // block can end, so only the input has to be watched.
                            let mut num_steps = *remaining - 1;
                            if num_steps > 0 && num_steps as u32 > self.block_length[LITERAL] {
                                num_steps = self.block_length[LITERAL] as i32;
                            }
                            if self.ring_buffer_size >= *pos
                                && (self.ring_buffer_size - *pos) <= num_steps
                            {
                                num_steps = self.ring_buffer_size - *pos - 1;
                            }
                            let num_steps = copy_preloaded_symbols_to_u8(
                                literal_tree,
                                br,
                                input,
                                &mut preloaded,
                                ring_buffer,
                                *pos as usize,
                                num_steps.max(0) as usize,
                            )? as i32;
                            *pos += num_steps;
                            self.block_length[LITERAL] -= num_steps as u32;
                            *remaining -= num_steps;
                            loop {
                                if !br.has_fast_input() {
                                    self.state = State::CommandInner;
                                    return Err(E::NeedsMoreInput);
                                }
                                if self.block_length[LITERAL] == 0 {
                                    label = Label::NextLiteralBlock;
                                    break;
                                }
                                let literal =
                                    read_preloaded_symbol(literal_tree, br, input, &mut preloaded)?;
                                put_literal!(literal as u8);
                            }
                        } else {
                            loop {
                                if self.block_length[LITERAL] == 0 {
                                    label = Label::NextLiteralBlock;
                                    break;
                                }
                                let literal =
                                    safe_read_symbol(Tree::new(literal_tree, 0), br, input)?
                                        .ok_or(E::NeedsMoreInput)?;
                                put_literal!(literal as u8);
                            }
                        }
                    } else {
                        let mut p1 =
                            ring_buffer.at(((*pos - 1) & self.ring_buffer_mask) as usize)?;
                        let mut p2 =
                            ring_buffer.at(((*pos - 2) & self.ring_buffer_mask) as usize)?;
                        let context_map_slice: &[u8; 1 << LITERAL_CONTEXT_BITS] =
                            self.context_map.array_at(self.context_map_slice)?;
                        loop {
                            if !SAFE && !br.has_fast_input() {
                                self.state = State::CommandInner;
                                return Err(E::NeedsMoreInput);
                            }
                            if self.block_length[LITERAL] == 0 {
                                label = Label::NextLiteralBlock;
                                break;
                            }
                            let context = self.context_lookup.context(p1, p2);
                            let tree_index = context_map_slice.at(usize::from(context))?;
                            let tree = Tree::new(
                                &self.literal_trees.codes,
                                self.literal_trees.starts.at(usize::from(tree_index))?,
                            );
                            p2 = p1;
                            p1 = read_symbol_maybe_safe::<SAFE>(tree, br, input)? as u8;
                            put_literal!(p1);
                        }
                    }
                    if matches!(label, Label::NextLiteralBlock) {
                        continue;
                    }
                    if self.end_meta_block_if_complete() {
                        return Ok(());
                    }
                    label = Label::CommandPostDecodeLiterals;
                }

                Label::CommandPostDecodeLiterals => {
                    if SAFE {
                        self.state = State::CommandPostDecodeLiterals;
                    }
                    if self.implicit_distance {
                        self.distance_context = 1;
                        self.last_distances_pos = self.last_distances_pos.wrapping_sub(1);
                        self.distance = self
                            .last_distances
                            .at((self.last_distances_pos & 3) as usize)?;
                    } else {
                        if self.block_length[DISTANCE] == 0 {
                            block_switch!(decode_distance_block_switch)?;
                        }
                        self.read_distance::<SAFE>(br, input)?;
                    }
                    if self.max_distance != self.max_backward_distance {
                        self.max_distance = (*pos).min(self.max_backward_distance);
                    }
                    *remaining = self.copy_length;
                    // A distance past the data seen so far refers to one of the dictionaries.
                    if self.distance > self.max_distance {
                        *pos = self.copy_from_dictionary(ring_buffer, *pos, *remaining)?;
                        if *pos >= self.ring_buffer_size {
                            self.state = State::WriteAfterDictionaryCopy;
                            return Ok(());
                        }
                    } else {
                        let src_start = (*pos - self.distance) & self.ring_buffer_mask;
                        let dst_end = *pos + *remaining;
                        let src_end = src_start + *remaining;
                        self.last_distances
                            .put((self.last_distances_pos & 3) as usize, self.distance)?;
                        self.last_distances_pos = self.last_distances_pos.wrapping_add(1);
                        self.meta_block_remaining_len -= *remaining;
                        let (src, dst) = (src_start as usize, *pos as usize);
                        // No valid distance reaches the 16 bytes from `pos` on, so they can be written to in any case.
                        let first: [u8; 16] = *ring_buffer.array_at(src)?;
                        *ring_buffer.array_at_mut(dst)? = first;
                        if (src_end > *pos && dst_end > src_start)
                            || dst_end >= self.ring_buffer_size
                            || src_end >= self.ring_buffer_size
                        {
                            // The two overlap, or one of them goes past the end of the ring buffer.
                            label = Label::CommandPostWrapCopy;
                            continue;
                        }
                        *pos += *remaining;
                        if *remaining > 16 {
                            if *remaining > 32 {
                                ring_buffer.move_within(
                                    src + 16,
                                    dst + 16,
                                    (*remaining - 16) as usize,
                                )?;
                            } else {
                                let second: [u8; 16] = *ring_buffer.array_at(src + 16)?;
                                *ring_buffer.array_at_mut(dst + 16)? = second;
                            }
                        }
                    }
                    if self.end_meta_block_if_complete() {
                        return Ok(());
                    }
                    label = Label::CommandBegin;
                }

                Label::CommandPostWrapCopy => {
                    let mut wrap_guard = self.ring_buffer_size - *pos;
                    loop {
                        *remaining -= 1;
                        if *remaining < 0 {
                            break;
                        }
                        let byte = ring_buffer
                            .at(((*pos - self.distance) & self.ring_buffer_mask) as usize)?;
                        ring_buffer.put(*pos as usize, byte)?;
                        *pos += 1;
                        wrap_guard -= 1;
                        if wrap_guard == 0 {
                            self.state = State::WriteDuringWrapCopy;
                            return Ok(());
                        }
                    }
                    if self.end_meta_block_if_complete() {
                        return Ok(());
                    }
                    label = Label::CommandBegin;
                }

                Label::NextLiteralBlock => {
                    block_switch!(decode_literal_block_switch)?;
                    label = Label::CommandInner;
                }
            }
        }
    }

    #[inline(never)]
    fn process_commands<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        // What is not a part of `self` meanwhile can stay in registers.
        let mut pos = self.pos;
        let mut remaining = self.loop_counter;
        let mut br = self.br;
        let mut ring_buffer = core::mem::take(&mut self.ring_buffer);
        let result = self.process_commands_internal::<SAFE>(
            input,
            &mut br,
            &mut ring_buffer,
            &mut pos,
            &mut remaining,
        );
        self.ring_buffer = ring_buffer;
        self.br = br;
        self.pos = pos;
        self.loop_counter = remaining;
        result
    }

    fn begin_meta_block(&mut self) {
        self.block_length = [BLOCK_SIZE_CAP; NUM_BLOCK_CATEGORIES];
        self.num_block_types = [1; NUM_BLOCK_CATEGORIES];
        self.last_block_types = [[1, 0]; NUM_BLOCK_CATEGORIES];
        self.state = State::MetaBlockHeader;
    }

    /// The window size is known.
    fn begin_stream(&mut self) {
        self.max_backward_distance = max_backward_limit(self.window_bits) as i32;
        self.begin_meta_block();
    }

    /// The header of a compressed meta-block was read.
    fn begin_commands(&mut self) -> Step {
        self.prepare_literal_decoding()?;
        self.prepare_distance_decoding()?;
        self.command_tree = self.command_trees.starts.at(0)?;
        self.ensure_ring_buffer(E::AllocRingBuffer2)?;
        self.calculate_distance_lut()?;
        self.state = State::CommandBegin;
        Ok(())
    }

    fn cleanup_after_meta_block(&mut self) {
        self.context_modes = Vec::new();
        self.context_map = Vec::new();
        self.distance_context_map = Vec::new();
        self.literal_trees = HuffmanTreeGroup::default();
        self.command_trees = HuffmanTreeGroup::default();
        self.distance_trees = HuffmanTreeGroup::default();
    }

    /// Consumes bytes from the front of `input` and writes what they decode to into `output`, as far as both allow.
    ///
    /// The input is never consumed past the end of the stream. If more input is needed, all of it was consumed.
    pub fn decompress_stream(
        &mut self,
        input: &mut &[u8],
        output: &mut dyn Output,
    ) -> DecoderResult {
        if self.error_code.is_error() {
            return DecoderResult::Error;
        }
        let all_input = *input;
        let mut next_in = 0usize;
        let code = self.run(all_input, &mut next_in, output);
        *input = all_input.get(next_in..).unwrap_or_default();

        self.error_code = code;
        if self.buffer_length != 0 && self.br.avail_in() == 0 {
            self.buffer_length = 0;
        }
        match code {
            E::Success => DecoderResult::Success,
            E::NeedsMoreInput => DecoderResult::NeedsMoreInput,
            E::NeedsMoreOutput => DecoderResult::NeedsMoreOutput,
            _ => DecoderResult::Error,
        }
    }

    /// `next_in` is how much of `input` was consumed.
    fn run(&mut self, input: &[u8], next_in: &mut usize, output: &mut dyn Output) -> E {
        let mut result: Step<Flow> = Ok(Flow::Continue);
        if self.buffer_length == 0 {
            self.br.set_input(input.len(), 0);
        } else {
            // At least one more byte is needed. They are taken one at a time, in the loop.
            result = Err(E::NeedsMoreInput);
            self.br.set_input(self.buffer_length, 0);
        }
        loop {
            match result {
                Ok(Flow::Continue) => {}
                Ok(Flow::Finished) => return E::Success,
                Err(E::NeedsMoreInput) => {
                    if !self.ring_buffer.is_empty() {
                        if let Err(code) = self.write_ring_buffer(output, true) {
                            if code.is_error() {
                                return code;
                            }
                        }
                    }
                    if self.buffer_length != 0 {
                        if self.br.avail_in() == 0 {
                            // What was being read is complete. As the buffer grew byte by byte, fewer than 8 bits are
                            // left in the accumulator.
                            self.buffer_length = 0;
                            self.br.set_input(input.len(), *next_in);
                        } else if let Some(&byte) = input.get(*next_in) {
                            if self.buffer.put(self.buffer_length, byte).is_err() {
                                return E::Unreachable;
                            }
                            self.buffer_length += 1;
                            self.br.set_input(self.buffer_length, 0);
                            *next_in += 1;
                        } else {
                            return E::NeedsMoreInput;
                        }
                    } else {
                        // Keep the rest of the input for the next call.
                        let Some(tail) = input.get(self.br.next_in()..) else {
                            return E::Unreachable;
                        };
                        if self.buffer.write_at(0, tail).is_err() {
                            return E::Unreachable;
                        }
                        self.buffer_length = tail.len();
                        *next_in = input.len();
                        return E::NeedsMoreInput;
                    }
                }
                Err(code) => {
                    if self.buffer_length != 0 {
                        // The buffered input was consumed, or else more input would have been needed.
                        self.buffer_length = 0;
                    } else {
                        // There were fewer than 8 bits in the accumulator when `input` was switched to, so every whole
                        // byte in it is from `input`.
                        if self.br.unload().is_err() {
                            return E::Unreachable;
                        }
                        *next_in = self.br.next_in();
                    }
                    return code;
                }
            }
            let buffer = self.buffer;
            let source = if self.buffer_length != 0 {
                buffer.get(..self.buffer_length).unwrap_or_default()
            } else {
                input
            };
            result = self.step(source, next_in, output);
        }
    }

    /// Does what the current state calls for. `input` is what the bit reader reads from.
    fn step(&mut self, input: &[u8], next_in: &mut usize, output: &mut dyn Output) -> Step<Flow> {
        match self.state {
            State::Uninited => {
                if !self.br.warmup(input) {
                    return Err(E::NeedsMoreInput);
                }
                self.decode_window_bits()?;
                if self.large_window {
                    self.state = State::LargeWindowBits;
                } else {
                    self.begin_stream();
                }
            }

            State::LargeWindowBits => {
                let bits = self.br.safe_read_bits(input, 6).ok_or(E::NeedsMoreInput)?;
                self.window_bits = bits as u32 & 63;
                if self.window_bits < LARGE_MIN_WBITS || self.window_bits > LARGE_MAX_WBITS {
                    return Err(E::FormatWindowBits);
                }
                self.begin_stream();
            }

            State::MetaBlockHeader => {
                self.decode_meta_block_length(input)?;
                if (self.is_metadata || self.is_uncompressed) && !self.br.jump_to_byte_boundary() {
                    return Err(E::FormatPadding1);
                }
                if self.is_metadata {
                    self.state = State::Metadata;
                    return Ok(Flow::Continue);
                }
                if self.meta_block_remaining_len == 0 {
                    self.state = State::MetaBlockDone;
                    return Ok(Flow::Continue);
                }
                self.calculate_ring_buffer_size();
                if self.is_uncompressed {
                    self.state = State::Uncompressed;
                } else {
                    self.loop_counter = 0;
                    self.state = State::BlockTypeCount;
                }
            }

            State::Uncompressed => {
                self.copy_uncompressed_block_to_output(input, output)?;
                self.state = State::MetaBlockDone;
            }

            State::Metadata => {
                self.skip_metadata_block()?;
                self.state = State::MetaBlockDone;
            }

            State::BlockTypeCount => {
                if self.loop_counter as usize >= NUM_BLOCK_CATEGORIES {
                    self.state = State::DistanceParameters;
                    return Ok(Flow::Continue);
                }
                let num_block_types = self.num_block_types.at_mut(self.loop_counter as usize)?;
                self.header
                    .decode_var_len_uint8(&mut self.br, input, num_block_types)?;
                *num_block_types += 1;
                if *num_block_types < 2 {
                    self.loop_counter += 1;
                    return Ok(Flow::Continue);
                }
                if self.block_type_trees.is_empty() {
                    self.block_length_trees = try_vec(
                        HuffmanCode::default(),
                        NUM_BLOCK_CATEGORIES * HUFFMAN_MAX_SIZE_26,
                    )
                    .map_err(|_| E::AllocBlockTypeTrees)?;
                    self.block_type_trees = try_vec(
                        HuffmanCode::default(),
                        NUM_BLOCK_CATEGORIES * HUFFMAN_MAX_SIZE_258,
                    )
                    .map_err(|_| E::AllocBlockTypeTrees)?;
                }
                self.state = State::BlockTypeCode;
            }

            State::BlockTypeCode => {
                let alphabet_size = self.num_block_types.at(self.loop_counter as usize)? + 2;
                let tree_offset = self.loop_counter as usize * HUFFMAN_MAX_SIZE_258;
                let table = self.block_type_trees.sub_mut(tree_offset..)?;
                self.header.read_huffman_code(
                    &mut self.br,
                    input,
                    alphabet_size,
                    alphabet_size,
                    table,
                )?;
                self.state = State::BlockLengthCode;
            }

            State::BlockLengthCode => {
                let alphabet_size = NUM_BLOCK_LEN_SYMBOLS as u32;
                let tree_offset = self.loop_counter as usize * HUFFMAN_MAX_SIZE_26;
                let table = self.block_length_trees.sub_mut(tree_offset..)?;
                self.header.read_huffman_code(
                    &mut self.br,
                    input,
                    alphabet_size,
                    alphabet_size,
                    table,
                )?;
                self.state = State::FirstBlockLength;
            }

            State::FirstBlockLength => {
                let tree_offset = self.loop_counter as usize * HUFFMAN_MAX_SIZE_26;
                let block_length = safe_read_block_length(
                    &mut self.pending_block_length_symbol,
                    Tree::new(&self.block_length_trees, tree_offset),
                    &mut self.br,
                    input,
                )?
                .ok_or(E::NeedsMoreInput)?;
                self.block_length
                    .put(self.loop_counter as usize, block_length)?;
                self.loop_counter += 1;
                self.state = State::BlockTypeCount;
            }

            State::DistanceParameters => {
                let bits = self.br.safe_read_bits(input, 6).ok_or(E::NeedsMoreInput)? as u32;
                self.distance_postfix_bits = bits & 3;
                self.num_direct_distance_codes = (bits >> 2) << self.distance_postfix_bits;
                self.context_modes = try_zeroed(self.num_block_types[LITERAL] as usize)
                    .map_err(|_| E::AllocContextModes)?;
                self.loop_counter = 0;
                self.state = State::ContextModes;
            }

            State::ContextModes => {
                self.read_context_modes(input)?;
                self.state = State::LiteralContextMap;
            }

            State::LiteralContextMap => {
                self.header.decode_context_map(
                    &mut self.br,
                    input,
                    &mut self.context_map_table,
                    self.num_block_types[LITERAL] << LITERAL_CONTEXT_BITS,
                    &mut self.num_literal_trees,
                    &mut self.context_map,
                )?;
                self.detect_trivial_literal_block_types()?;
                self.state = State::DistanceContextMap;
            }

            State::DistanceContextMap => {
                let npostfix = self.distance_postfix_bits;
                let ndirect = self.num_direct_distance_codes;
                let mut distance_alphabet_size_max =
                    distance_alphabet_size(npostfix, ndirect, MAX_DISTANCE_BITS);
                let mut distance_alphabet_size_limit = distance_alphabet_size_max;
                if self.large_window {
                    let limit =
                        calculate_distance_code_limit(MAX_ALLOWED_DISTANCE, npostfix, ndirect);
                    distance_alphabet_size_max =
                        distance_alphabet_size(npostfix, ndirect, LARGE_MAX_DISTANCE_BITS);
                    distance_alphabet_size_limit = limit.max_alphabet_size;
                }
                self.header.decode_context_map(
                    &mut self.br,
                    input,
                    &mut self.context_map_table,
                    self.num_block_types[DISTANCE] << DISTANCE_CONTEXT_BITS,
                    &mut self.num_distance_trees,
                    &mut self.distance_context_map,
                )?;
                self.literal_trees = huffman_tree_group(
                    NUM_LITERAL_SYMBOLS as u32,
                    NUM_LITERAL_SYMBOLS as u32,
                    self.num_literal_trees,
                )?;
                self.command_trees = huffman_tree_group(
                    NUM_COMMAND_SYMBOLS as u32,
                    NUM_COMMAND_SYMBOLS as u32,
                    self.num_block_types[COMMAND],
                )?;
                self.distance_trees = huffman_tree_group(
                    distance_alphabet_size_max,
                    distance_alphabet_size_limit,
                    self.num_distance_trees,
                )?;
                self.loop_counter = 0;
                self.state = State::TreeGroup;
            }

            State::TreeGroup => {
                let group = match self.loop_counter as usize {
                    LITERAL => &mut self.literal_trees,
                    COMMAND => &mut self.command_trees,
                    DISTANCE => &mut self.distance_trees,
                    _ => return Err(E::Unreachable),
                };
                self.header.read_tree_group(&mut self.br, input, group)?;
                self.loop_counter += 1;
                if self.loop_counter as usize >= NUM_BLOCK_CATEGORIES {
                    self.begin_commands()?;
                }
            }

            State::CommandBegin
            | State::CommandInner
            | State::CommandPostDecodeLiterals
            | State::CommandPostWrapCopy => {
                let mut result = self.process_commands::<false>(input);
                if result == Err(E::NeedsMoreInput) {
                    result = self.process_commands::<true>(input);
                }
                result?;
            }

            State::WriteDuringInsert
            | State::WriteAfterDictionaryCopy
            | State::WriteDuringWrapCopy => {
                self.write_ring_buffer(output, false)?;
                self.wrap_ring_buffer()?;
                if self.ring_buffer_size == 1 << self.window_bits {
                    self.max_distance = self.max_backward_distance;
                }
                match self.state {
                    State::WriteAfterDictionaryCopy => {
                        if let Some(compound) = &mut self.compound_dictionary
                            && compound.is_copying()
                        {
                            self.pos += compound.copy_to(
                                &mut self.ring_buffer,
                                self.ring_buffer_size,
                                self.pos,
                            )?;
                            if self.pos >= self.ring_buffer_size {
                                return Ok(Flow::Continue);
                            }
                        }
                        self.state = if self.meta_block_remaining_len == 0 {
                            State::MetaBlockDone
                        } else {
                            State::CommandBegin
                        };
                    }
                    State::WriteDuringWrapCopy => self.state = State::CommandPostWrapCopy,
                    _ => {
                        self.state = if self.loop_counter != 0 {
                            State::CommandInner
                        } else if self.meta_block_remaining_len == 0 {
                            State::MetaBlockDone
                        } else {
                            State::CommandPostDecodeLiterals
                        };
                    }
                }
            }

            State::MetaBlockDone => {
                if self.meta_block_remaining_len < 0 {
                    return Err(E::FormatBlockLength2);
                }
                self.cleanup_after_meta_block();
                if !self.is_last_meta_block {
                    self.begin_meta_block();
                    return Ok(Flow::Continue);
                }
                if !self.br.jump_to_byte_boundary() {
                    return Err(E::FormatPadding2);
                }
                if self.buffer_length == 0 {
                    self.br.unload()?;
                    *next_in = self.br.next_in();
                }
                self.state = State::Done;
            }

            State::Done => {
                if !self.ring_buffer.is_empty() {
                    self.write_ring_buffer(output, true)?;
                }
                return Ok(Flow::Finished);
            }
        }
        Ok(Flow::Continue)
    }
}

/// Room for `num_trees` lookup tables.
fn huffman_tree_group(
    alphabet_size_max: u32,
    alphabet_size_limit: u32,
    num_trees: u32,
) -> Step<HuffmanTreeGroup> {
    // 376 = 256 for the first level + 4 + 7 + 15 + 31 + 63 for the second. It is a little more than any code needs.
    let max_table_size = alphabet_size_limit as usize + 376;
    Ok(HuffmanTreeGroup {
        starts: try_zeroed(num_trees as usize).map_err(|_| E::AllocTreeGroups)?,
        codes: try_vec(HuffmanCode::default(), num_trees as usize * max_table_size)
            .map_err(|_| E::AllocTreeGroups)?,
        alphabet_size_max: alphabet_size_max as u16,
        alphabet_size_limit: alphabet_size_limit as u16,
    })
}
