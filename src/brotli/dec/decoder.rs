//! The state machine that turns a brotli stream back into bytes. It can stop wherever the input or the room for output
//! ends, and go on from there in the next call.

use super::bit_reader::{BitReader, bit_mask};
use super::huffman::{
    HUFFMAN_MAX_CODE_LENGTH, HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH, HUFFMAN_MAX_SIZE_26,
    HUFFMAN_MAX_SIZE_258, HUFFMAN_MAX_SIZE_272, HuffmanCode, HuffmanTreeGroup, SYMBOL_LIST_BASE,
    build_code_lengths_huffman_table, build_huffman_table, build_simple_huffman_table,
};
use super::prefix::CMD_LUT;
use super::{DecoderErrorCode as E, DecoderParameter, DecoderResult};
use crate::common::constants::{
    BLOCK_LENGTH_PREFIX_CODE, CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, DISTANCE_CONTEXT_BITS,
    INITIAL_REPEATED_CODE_LENGTH, LARGE_MAX_DISTANCE_BITS, LARGE_MAX_WBITS, LARGE_MIN_WBITS,
    LITERAL_CONTEXT_BITS, MAX_ALLOWED_DISTANCE, MAX_DISTANCE_BITS, NUM_BLOCK_LEN_SYMBOLS,
    NUM_COMMAND_SYMBOLS, NUM_DISTANCE_SHORT_CODES, NUM_LITERAL_SYMBOLS,
    REPEAT_PREVIOUS_CODE_LENGTH, calculate_distance_code_limit, distance_alphabet_size,
    max_backward_limit,
};
use crate::common::context::{ContextLut, ContextType, context_lut};
use crate::common::dictionary::{self, MAX_DICTIONARY_WORD_LENGTH, MIN_DICTIONARY_WORD_LENGTH};
use crate::common::transform::{NUM_TRANSFORMS, transform_dictionary_word};
use crate::io::Output;
use crate::util::{Bug, Checked, SliceExt, try_box, try_vec, try_with_capacity, try_zeroed};

/// `Err` is everything that interrupts decoding: an error, or the need for more input or more room for output.
type Step<T = ()> = Result<T, E>;

const HUFFMAN_TABLE_BITS: u32 = 8;
const HUFFMAN_TABLE_MASK: u64 = 0xFF;

/// What the ring buffer has room for past its end: two copies of 16 bytes, or a transformed dictionary word.
const RING_BUFFER_WRITE_AHEAD_SLACK: usize = 542;

/// The length of a block when there is only one block type. No meta-block is longer.
const BLOCK_SIZE_CAP: u32 = 1 << 24;

/// More distance symbols than any alphabet that is accepted has.
const MAX_DISTANCE_SYMBOLS: usize = 544;

const MAX_COMPOUND_DICTIONARY_CHUNKS: usize = 15;

/// The fixed prefix code that the code lengths of the code length code are written in, indexed by the next 4 bits.
static CODE_LENGTH_PREFIX_LENGTH: [u8; 16] = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4];
static CODE_LENGTH_PREFIX_VALUE: [u8; 16] = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Uninited,
    LargeWindowBits,
    Initialize,
    MetaBlockBegin,
    MetaBlockHeader,
    MetablockHeader2,
    ContextModes,
    CommandBegin,
    CommandInner,
    CommandPostDecodeLiterals,
    CommandPostWrapCopy,
    Uncompressed,
    Metadata,
    CommandInnerWrite,
    MetaBlockDone,
    CommandPostWrite1,
    CommandPostWrite2,
    BeforeCompressedMetaBlockHeader,
    HuffmanCode0,
    HuffmanCode1,
    HuffmanCode2,
    HuffmanCode3,
    ContextMap1,
    ContextMap2,
    TreeGroup,
    BeforeCompressedMetaBlockBody,
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
        /// The symbol of a run of zeros of which the extra bits were not read yet, or 0xFFFF.
        code: u32,
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReadBlockLengthState {
    None,
    Suffix,
}

/// Bytes that come before the start of the stream, as far as backward references go.
struct CompoundDictionary {
    chunks: Vec<Box<[u8]>>,
    /// Where each chunk starts, and where the last one ends.
    chunk_offsets: [i32; MAX_COMPOUND_DICTIONARY_CHUNKS + 1],
    total_size: i32,
    /// The copy in progress: the chunk and the offset in it to go on from, its length, and how much of it is done.
    br_index: usize,
    br_offset: i32,
    br_length: i32,
    br_copied: i32,
    /// `block_map[address >> block_bits]` is a chunk at or before the one that holds `address`. -1 until it is filled.
    block_bits: i32,
    block_map: [u8; 256],
}

impl CompoundDictionary {
    /// Goes on with the copy in progress, to `pos` and up to the end of the ring buffer. Returns how much was copied.
    fn copy_to(
        &mut self,
        ringbuffer: &mut [u8],
        ringbuffer_size: i32,
        mut pos: i32,
    ) -> Checked<i32> {
        let orig_pos = pos;
        while self.br_length != self.br_copied {
            let space = ringbuffer_size - pos;
            let chunk_length =
                self.chunk_offsets.at(self.br_index + 1)? - self.chunk_offsets.at(self.br_index)?;
            let rem_chunk_length = chunk_length - self.br_offset;
            let length = (self.br_length - self.br_copied)
                .min(rem_chunk_length)
                .min(space);
            let chunk = self.chunks.get(self.br_index).ok_or(Bug)?;
            let source = chunk.sub(self.br_offset as usize..(self.br_offset + length) as usize)?;
            ringbuffer.write_at(pos as usize, source)?;
            pos += length;
            self.br_offset += length;
            self.br_copied += length;
            if length == rem_chunk_length {
                self.br_index += 1;
                self.br_offset = 0;
            }
            if pos == ringbuffer_size {
                break;
            }
        }
        Ok(pos - orig_pos)
    }
}

/// What reading the prefix codes and context maps of a meta-block header needs.
struct HeaderArena {
    substate_tree_group: TreeGroupState,
    substate_context_map: ContextMapState,
    substate_huffman: HuffmanState,

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
    htree_index: usize,
    next: usize,

    max_run_length_prefix: u32,
}

#[derive(Clone, Copy, Default)]
struct DistanceSymbol {
    /// How many extra bits follow the symbol.
    extra_bits: u8,
    /// The distance if they are all 0.
    offset: u32,
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
    ringbuffer_size: i32,
    ringbuffer_mask: i32,
    dist_rb_idx: i32,
    /// The last four distances.
    dist_rb: [i32; 4],
    error_code: E,
    meta_block_remaining_len: i32,

    /// `ringbuffer_size` + [`RING_BUFFER_WRITE_AHEAD_SLACK`] bytes, or none before the first meta-block with data.
    ringbuffer: Vec<u8>,
    /// Where in `insert_copy_hgroup.codes` the current tree starts.
    htree_command: usize,
    context_lookup: &'static ContextLut,
    /// Where in `context_map` the part for the current block type starts.
    context_map_slice: usize,

    literal_hgroup: HuffmanTreeGroup,
    insert_copy_hgroup: HuffmanTreeGroup,
    distance_hgroup: HuffmanTreeGroup,
    /// Three tables of [`HUFFMAN_MAX_SIZE_258`] entries. Empty until a meta-block has more than one block type.
    block_type_trees: Vec<HuffmanCode>,
    /// Three tables of [`HUFFMAN_MAX_SIZE_26`] entries, allocated with `block_type_trees`.
    block_len_trees: Vec<HuffmanCode>,
    /// All contexts of the current literal block type use the same tree, so the context need not be computed.
    trivial_literal_context: bool,
    /// Valid from when a command is decoded until its distance is. A temporary after that.
    distance_context: i32,
    block_length: [u32; 3],
    block_length_index: u32,
    num_block_types: [u32; 3],
    /// The last two block types of each category.
    block_type_rb: [u32; 6],
    distance_postfix_bits: u32,
    num_direct_distance_codes: u32,
    num_dist_htrees: u32,
    dist_context_map: Vec<u8>,
    /// Where in `literal_hgroup.codes` the tree of a trivial literal context starts.
    literal_htree: usize,

    /// How many times the ring buffer was filled.
    rb_roundtrips: usize,
    /// How much output was handed to the caller in total.
    partial_pos_out: usize,

    copy_length: i32,
    distance_code: i32,

    /// Where in `distance_hgroup.codes` the tree for each distance context of the current block type starts.
    dist_htrees: [u32; 1 << DISTANCE_CONTEXT_BITS],
    /// The one for the distance of the current command.
    dist_htree: u32,

    substate_meta_block_header: MetaBlockHeaderState,
    substate_uncompressed: UncompressedState,
    substate_decode_uint8: DecodeUint8State,
    substate_read_block_length: ReadBlockLengthState,

    new_ringbuffer_size: i32,

    is_last_meta_block: bool,
    is_uncompressed: bool,
    is_metadata: bool,
    should_wrap_ringbuffer: bool,
    canny_ringbuffer_allocation: bool,
    large_window: bool,
    window_bits: u32,
    size_nibbles: u8,

    num_literal_htrees: u32,
    context_map: Vec<u8>,
    context_modes: Vec<u8>,

    compound_dictionary: Option<Box<CompoundDictionary>>,

    /// One bit for each literal block type.
    trivial_literal_contexts: [u32; 8],

    header: HeaderArena,
    context_map_table: [HuffmanCode; HUFFMAN_MAX_SIZE_272],

    dist_symbols: [DistanceSymbol; MAX_DISTANCE_SYMBOLS],
}

impl Default for Decoder {
    fn default() -> Self {
        Self::new()
    }
}

/// A Huffman table: the part of `codes` from `start` on.
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
#[inline(never)]
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

/// Reads up to `limit` symbols into `ringbuffer[pos..]`, which has room for them, and stops before the input gets
/// short. Returns how many were read.
#[inline(always)]
fn copy_preloaded_symbols_to_u8(
    table: &[HuffmanCode],
    br: &mut BitReader,
    input: &[u8],
    preloaded: &mut HuffmanCode,
    ringbuffer: &mut [u8],
    pos: usize,
    limit: usize,
) -> Checked<usize> {
    const MAXIMAL_OVERREAD: usize = 4;
    // A symbol takes at most 15 bits, so this many can be read without looking at how much input is left.
    let unchecked = (br.bytes_before_guard() * 8 / 15)
        .saturating_sub(MAXIMAL_OVERREAD)
        .min(limit);
    let (head, tail) = ringbuffer
        .sub_mut(pos..pos + limit)?
        .split_at_mut_checked(unchecked)
        .ok_or(Bug)?;
    for slot in head {
        *slot = read_preloaded_symbol(table, br, input, preloaded)? as u8;
    }
    let mut copies = unchecked;
    for slot in tail {
        if !br.check_input_amount() {
            break;
        }
        *slot = read_preloaded_symbol(table, br, input, preloaded)? as u8;
        copies += 1;
    }
    Ok(copies)
}

/// The number of bits it takes to write `x`.
#[inline(always)]
fn log2_floor(x: u32) -> u32 {
    32 - x.leading_zeros()
}

/// Reads a number from 0 to 255, which takes 1 to 11 bits. `value` holds an intermediate result between calls.
#[inline(never)]
fn decode_var_len_uint8(
    substate: &mut DecodeUint8State,
    br: &mut BitReader,
    input: &[u8],
    value: &mut u32,
) -> Step {
    if *substate == DecodeUint8State::None {
        let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
        if bits == 0 {
            *value = 0;
            return Ok(());
        }
        *substate = DecodeUint8State::Short;
    }
    if *substate == DecodeUint8State::Short {
        let bits = br.safe_read_bits(input, 3).ok_or(E::NeedsMoreInput)?;
        if bits == 0 {
            *value = 1;
            *substate = DecodeUint8State::None;
            return Ok(());
        }
        *value = bits as u32;
        *substate = DecodeUint8State::Long;
    }
    let bits = br.safe_read_bits(input, *value).ok_or(E::NeedsMoreInput)?;
    *value = (1 << *value) + bits as u32;
    *substate = DecodeUint8State::None;
    Ok(())
}

impl HeaderArena {
    fn new() -> Self {
        Self {
            substate_tree_group: TreeGroupState::None,
            substate_context_map: ContextMapState::None,
            substate_huffman: HuffmanState::None,
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
            htree_index: 0,
            next: 0,
            max_run_length_prefix: 0,
        }
    }

    /// Reads the `self.symbol + 1` symbols of a simple prefix code, which have to differ.
    fn read_simple_huffman_symbols(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        alphabet_size_max: u32,
        alphabet_size_limit: u32,
    ) -> Step {
        let max_bits = log2_floor(alphabet_size_max - 1);
        let num_symbols = self.symbol as usize;
        let mut i = self.sub_loop_counter as usize;
        while i <= num_symbols {
            let Some(v) = br.safe_read_bits(input, max_bits) else {
                self.sub_loop_counter = i as u32;
                self.substate_huffman = HuffmanState::SimpleRead;
                return Err(E::NeedsMoreInput);
            };
            if v >= u64::from(alphabet_size_limit) {
                return Err(E::FormatSimpleHuffmanAlphabet);
            }
            self.symbol_lists.put(i, v as u16)?;
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
            if !br.check_input_amount() {
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
                        self.substate_huffman = HuffmanState::Complex;
                        return Err(E::NeedsMoreInput);
                    }
                    ix
                }
            };
            let v = CODE_LENGTH_PREFIX_VALUE.at(ix)?;
            br.drop_bits(u32::from(CODE_LENGTH_PREFIX_LENGTH.at(ix)?));
            self.code_length_code_lengths.put(code_len_idx, v)?;
            if v != 0 {
                space = space.wrapping_sub(32 >> v);
                num_codes += 1;
                *self.code_length_histo.at_mut(usize::from(v))? += 1;
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
                    let table_size = build_simple_huffman_table(
                        table,
                        HUFFMAN_TABLE_BITS as usize,
                        symbols,
                        self.symbol,
                    )?;
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
                        HUFFMAN_TABLE_BITS as usize,
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
    fn huffman_tree_group_decode(
        &mut self,
        br: &mut BitReader,
        input: &[u8],
        group: &mut HuffmanTreeGroup,
    ) -> Step {
        if self.substate_tree_group != TreeGroupState::Loop {
            self.next = 0;
            self.htree_index = 0;
            self.substate_tree_group = TreeGroupState::Loop;
        }
        while self.htree_index < group.htrees.len() {
            let table_size = self.read_huffman_code(
                br,
                input,
                u32::from(group.alphabet_size_max),
                u32::from(group.alphabet_size_limit),
                group.codes.sub_mut(self.next..)?,
            )?;
            group.htrees.put(self.htree_index, self.next as u32)?;
            self.next += table_size as usize;
            self.htree_index += 1;
        }
        self.substate_tree_group = TreeGroupState::None;
        Ok(())
    }
}

/// Reads a block count, which takes 3 to 39 bits.
#[inline(always)]
fn read_block_length(table: Tree<'_>, br: &mut BitReader, input: &[u8]) -> Checked<u32> {
    let code = read_symbol(table, br, input)?;
    let range = BLOCK_LENGTH_PREFIX_CODE.at(code as usize)?;
    Ok(u32::from(range.offset) + br.read_bits(input, u32::from(range.nbits))? as u32)
}

/// [`read_block_length`] up to the last bit of the input. `None` if the input ends before. If `substate` is then
/// `Suffix`, the symbol was consumed and is kept in `block_length_index`.
#[inline(always)]
fn safe_read_block_length(
    substate: &mut ReadBlockLengthState,
    block_length_index: &mut u32,
    table: Tree<'_>,
    br: &mut BitReader,
    input: &[u8],
) -> Checked<Option<u32>> {
    let index = if *substate == ReadBlockLengthState::None {
        match safe_read_symbol(table, br, input)? {
            Some(index) => index,
            None => return Ok(None),
        }
    } else {
        *block_length_index
    };
    let range = BLOCK_LENGTH_PREFIX_CODE.at(index as usize)?;
    let Some(bits) = br.safe_read_bits(input, u32::from(range.nbits)) else {
        *block_length_index = index;
        *substate = ReadBlockLengthState::Suffix;
        return Ok(None);
    };
    *substate = ReadBlockLengthState::None;
    Ok(Some(u32::from(range.offset) + bits as u32))
}

/// 7.3. Replaces each index in `v` by the value at that index of a list, which starts as 0, 1, 2, ..., and moves the
/// value to the front of the list.
#[inline(never)]
fn inverse_move_to_front_transform(v: &mut [u8]) -> Checked {
    let mut mtf = [0u8; 256];
    for (i, value) in mtf.iter_mut().enumerate() {
        *value = i as u8;
    }
    for item in v {
        let index = usize::from(*item);
        let value = mtf.at(index)?;
        *item = value;
        mtf.move_within(0, 1, index)?;
        mtf[0] = value;
    }
    Ok(())
}

impl CompoundDictionary {
    fn ensure_initialized(&mut self) -> Checked {
        if self.block_bits != -1 {
            return Ok(());
        }
        let mut block_bits = 8;
        while ((self.total_size - 1) >> block_bits) != 0 {
            block_bits += 1;
        }
        block_bits -= 8;
        self.block_bits = block_bits;
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
        Ok(())
    }
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
            ringbuffer_size: 0,
            ringbuffer_mask: 0,
            dist_rb_idx: 0,
            dist_rb: [16, 15, 11, 4],
            error_code: E::NoError,
            meta_block_remaining_len: 0,
            ringbuffer: Vec::new(),
            htree_command: 0,
            context_lookup: context_lut(ContextType::Lsb6),
            context_map_slice: 0,
            literal_hgroup: HuffmanTreeGroup::default(),
            insert_copy_hgroup: HuffmanTreeGroup::default(),
            distance_hgroup: HuffmanTreeGroup::default(),
            block_type_trees: Vec::new(),
            block_len_trees: Vec::new(),
            trivial_literal_context: false,
            distance_context: 0,
            block_length: [0; 3],
            block_length_index: 0,
            num_block_types: [0; 3],
            block_type_rb: [0; 6],
            distance_postfix_bits: 0,
            num_direct_distance_codes: 0,
            num_dist_htrees: 0,
            dist_context_map: Vec::new(),
            literal_htree: 0,
            rb_roundtrips: 0,
            partial_pos_out: 0,
            copy_length: 0,
            distance_code: 0,
            dist_htrees: [0; 1 << DISTANCE_CONTEXT_BITS],
            dist_htree: 0,
            substate_meta_block_header: MetaBlockHeaderState::None,
            substate_uncompressed: UncompressedState::None,
            substate_decode_uint8: DecodeUint8State::None,
            substate_read_block_length: ReadBlockLengthState::None,
            new_ringbuffer_size: 0,
            is_last_meta_block: false,
            is_uncompressed: false,
            is_metadata: false,
            should_wrap_ringbuffer: false,
            canny_ringbuffer_allocation: true,
            large_window: false,
            window_bits: 0,
            size_nibbles: 0,
            num_literal_htrees: 0,
            context_map: Vec::new(),
            context_modes: Vec::new(),
            compound_dictionary: None,
            trivial_literal_contexts: [0; 8],
            header: HeaderArena::new(),
            context_map_table: [HuffmanCode::default(); HUFFMAN_MAX_SIZE_272],
            dist_symbols: [DistanceSymbol::default(); MAX_DISTANCE_SYMBOLS],
        }
    }

    /// Only before the first byte of input. Whether the parameter was set.
    pub fn set_parameter(&mut self, parameter: DecoderParameter, value: u32) -> bool {
        if self.state != State::Uninited {
            return false;
        }
        match parameter {
            DecoderParameter::DisableRingBufferReallocation => {
                self.canny_ringbuffer_allocation = value == 0
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
            let Ok(chunks) = try_with_capacity(MAX_COMPOUND_DICTIONARY_CHUNKS) else {
                return false;
            };
            self.compound_dictionary = try_box(CompoundDictionary {
                chunks,
                chunk_offsets: [0; MAX_COMPOUND_DICTIONARY_CHUNKS + 1],
                total_size: 0,
                br_index: 0,
                br_offset: 0,
                br_length: 0,
                br_copied: 0,
                block_bits: -1,
                block_map: [0; 256],
            })
            .ok();
        }
        let Some(addon) = &mut self.compound_dictionary else {
            return false;
        };
        if addon.chunks.len() == MAX_COMPOUND_DICTIONARY_CHUNKS {
            return false;
        }
        let Some(total_size) = i32::try_from(data.len())
            .ok()
            .and_then(|size| addon.total_size.checked_add(size))
        else {
            return false;
        };
        addon.chunks.push(data);
        addon.total_size = total_size;
        addon
            .chunk_offsets
            .put(addon.chunks.len(), total_size)
            .is_ok()
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
        !self.ringbuffer.is_empty() && self.unwritten_bytes(false) != 0
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
    #[inline(never)]
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

    /// 7.3. Reads a context map of `context_map_size` entries into `context_map`, and into `num_htrees` how many trees
    /// it refers to. Both keep intermediate results between calls.
    fn decode_context_map(
        &mut self,
        input: &[u8],
        context_map_size: u32,
        num_htrees: &mut u32,
        context_map: &mut Vec<u8>,
    ) -> Step {
        let br = &mut self.br;
        let h = &mut self.header;
        loop {
            match h.substate_context_map {
                ContextMapState::None => {
                    decode_var_len_uint8(&mut self.substate_decode_uint8, br, input, num_htrees)?;
                    *num_htrees += 1;
                    *context_map =
                        try_zeroed(context_map_size as usize).map_err(|_| E::AllocContextMap)?;
                    if *num_htrees <= 1 {
                        return Ok(());
                    }
                    h.substate_context_map = ContextMapState::ReadPrefix;
                }

                ContextMapState::ReadPrefix => {
                    // The prefix code that follows takes at least 4 bits, so it is safe to peek that far.
                    let bits = br.safe_get_bits(input, 5).ok_or(E::NeedsMoreInput)? as u32;
                    if bits & 1 != 0 {
                        h.max_run_length_prefix = (bits >> 1) + 1;
                        br.drop_bits(5);
                    } else {
                        h.max_run_length_prefix = 0;
                        br.drop_bits(1);
                    }
                    h.substate_context_map = ContextMapState::Huffman;
                }

                ContextMapState::Huffman => {
                    let alphabet_size = *num_htrees + h.max_run_length_prefix;
                    h.read_huffman_code(
                        br,
                        input,
                        alphabet_size,
                        alphabet_size,
                        &mut self.context_map_table,
                    )?;
                    h.substate_context_map = ContextMapState::Decode {
                        context_index: 0,
                        code: 0xFFFF,
                    };
                }

                ContextMapState::Decode {
                    mut context_index,
                    mut code,
                } => {
                    let max_run_length_prefix = h.max_run_length_prefix;
                    let mut skip_preamble = code != 0xFFFF;
                    while context_index < context_map_size || skip_preamble {
                        if !skip_preamble {
                            let Some(symbol) =
                                safe_read_symbol(Tree::new(&self.context_map_table, 0), br, input)?
                            else {
                                h.substate_context_map = ContextMapState::Decode {
                                    context_index,
                                    code: 0xFFFF,
                                };
                                return Err(E::NeedsMoreInput);
                            };
                            code = symbol;

                            if code == 0 {
                                context_map.put(context_index as usize, 0)?;
                                context_index += 1;
                                continue;
                            }
                            if code > max_run_length_prefix {
                                context_map.put(
                                    context_index as usize,
                                    (code - max_run_length_prefix) as u8,
                                )?;
                                context_index += 1;
                                continue;
                            }
                        } else {
                            skip_preamble = false;
                        }
                        let Some(reps) = br.safe_read_bits(input, code) else {
                            h.substate_context_map = ContextMapState::Decode {
                                context_index,
                                code,
                            };
                            return Err(E::NeedsMoreInput);
                        };
                        let reps = reps as u32 + (1 << code);
                        if context_index + reps > context_map_size {
                            return Err(E::FormatContextMapRepeat);
                        }
                        context_map
                            .sub_mut(context_index as usize..(context_index + reps) as usize)?
                            .fill(0);
                        context_index += reps;
                    }
                    h.substate_context_map = ContextMapState::Transform;
                }

                ContextMapState::Transform => {
                    let bits = br.safe_read_bits(input, 1).ok_or(E::NeedsMoreInput)?;
                    if bits != 0 {
                        inverse_move_to_front_transform(context_map)?;
                    }
                    h.substate_context_map = ContextMapState::None;
                    return Ok(());
                }
            }
        }
    }

    /// 6. Reads a block switch command, which takes 3 to 54 bits, for literals (0), commands (1) or distances (2).
    #[inline(always)]
    fn decode_block_type_and_length<const SAFE: bool>(
        &mut self,
        input: &[u8],
        tree_type: usize,
    ) -> Step {
        let max_block_type = self.num_block_types.at(tree_type)?;
        let type_tree = Tree::new(&self.block_type_trees, tree_type * HUFFMAN_MAX_SIZE_258);
        let len_tree = Tree::new(&self.block_len_trees, tree_type * HUFFMAN_MAX_SIZE_26);
        let br = &mut self.br;
        if max_block_type <= 1 {
            return Err(E::FormatBlockSwitch);
        }

        let mut block_type;
        if !SAFE {
            block_type = read_symbol(type_tree, br, input)?;
            self.block_length
                .put(tree_type, read_block_length(len_tree, br, input)?)?;
        } else {
            let memento = br.save_state();
            block_type = safe_read_symbol(type_tree, br, input)?.ok_or(E::NeedsMoreInput)?;
            let Some(block_length) = safe_read_block_length(
                &mut self.substate_read_block_length,
                &mut self.block_length_index,
                len_tree,
                br,
                input,
            )?
            else {
                self.substate_read_block_length = ReadBlockLengthState::None;
                br.restore_state(memento);
                return Err(E::NeedsMoreInput);
            };
            self.block_length.put(tree_type, block_length)?;
        }

        let ringbuffer: &mut [u32; 2] = self.block_type_rb.array_at_mut(tree_type * 2)?;
        if block_type == 1 {
            block_type = ringbuffer[1] + 1;
        } else if block_type == 0 {
            block_type = ringbuffer[0];
        } else {
            block_type -= 2;
        }
        if block_type >= max_block_type {
            block_type -= max_block_type;
        }
        ringbuffer[0] = ringbuffer[1];
        ringbuffer[1] = block_type;
        Ok(())
    }

    fn detect_trivial_literal_block_types(&mut self) -> Checked {
        self.trivial_literal_contexts = [0; 8];
        let (contexts, _) = self
            .context_map
            .as_chunks::<{ 1 << LITERAL_CONTEXT_BITS }>();
        for (i, contexts) in contexts
            .iter()
            .take(self.num_block_types[0] as usize)
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
        let block_type = self.block_type_rb[1] as usize;
        self.context_map_slice = block_type << LITERAL_CONTEXT_BITS;
        let trivial = self.trivial_literal_contexts.at(block_type >> 5)?;
        self.trivial_literal_context = (trivial >> (block_type & 31)) & 1 != 0;
        let tree = self.context_map.at(self.context_map_slice)?;
        self.literal_htree = self.literal_hgroup.htrees.at(usize::from(tree))? as usize;
        self.context_lookup =
            context_lut(ContextType::from_bits(self.context_modes.at(block_type)?));
        Ok(())
    }

    fn prepare_distance_decoding(&mut self) -> Checked {
        let block_type = self.block_type_rb[5] as usize;
        let trees: &[u8; 1 << DISTANCE_CONTEXT_BITS] = self
            .dist_context_map
            .array_at(block_type << DISTANCE_CONTEXT_BITS)?;
        for (start, &tree) in self.dist_htrees.iter_mut().zip(trees) {
            *start = self.distance_hgroup.htrees.at(usize::from(tree))?;
        }
        Ok(())
    }

    #[inline(never)]
    fn decode_literal_block_switch<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        self.decode_block_type_and_length::<SAFE>(input, 0)?;
        self.prepare_literal_decoding()?;
        Ok(())
    }

    #[inline(never)]
    fn decode_command_block_switch<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        self.decode_block_type_and_length::<SAFE>(input, 1)?;
        self.htree_command = self
            .insert_copy_hgroup
            .htrees
            .at(self.block_type_rb[3] as usize)? as usize;
        Ok(())
    }

    #[inline(never)]
    fn decode_distance_block_switch<const SAFE: bool>(&mut self, input: &[u8]) -> Step {
        self.decode_block_type_and_length::<SAFE>(input, 2)?;
        self.prepare_distance_decoding()?;
        self.dist_htree = self.dist_htrees.at(self.distance_context as usize)?;
        Ok(())
    }

    /// How much of the ring buffer was not handed to the caller yet. With `wrap`, what lies past its end is left out.
    fn unwritten_bytes(&self, wrap: bool) -> usize {
        let pos = if wrap && self.pos > self.ringbuffer_size {
            self.ringbuffer_size
        } else {
            self.pos
        } as usize;
        let partial_pos_rb = self
            .rb_roundtrips
            .wrapping_mul(self.ringbuffer_size as usize)
            .wrapping_add(pos);
        partial_pos_rb.wrapping_sub(self.partial_pos_out)
    }

    /// Hands output to the caller. Asks for more room only if there is more to write and either the ring buffer cannot
    /// grow any further or `force` is set.
    #[inline(never)]
    fn write_ring_buffer(&mut self, output: &mut dyn Output, force: bool) -> Step {
        let start = self.partial_pos_out & self.ringbuffer_mask as usize;
        let to_write = self.unwritten_bytes(true);
        if self.meta_block_remaining_len < 0 {
            return Err(E::FormatBlockLength1);
        }
        let num_written = output.write(self.ringbuffer.sub(start..start + to_write)?);
        self.partial_pos_out += num_written;
        let at_full_size = self.ringbuffer_size == 1 << self.window_bits;
        if num_written < to_write {
            if at_full_size || force {
                return Err(E::NeedsMoreOutput);
            }
            return Ok(());
        }
        if at_full_size && self.pos >= self.ringbuffer_size {
            self.pos -= self.ringbuffer_size;
            self.rb_roundtrips += 1;
            self.should_wrap_ringbuffer = self.pos != 0;
        }
        Ok(())
    }

    /// Moves what was written past the end of the ring buffer to its start.
    #[inline(never)]
    fn wrap_ring_buffer(&mut self) -> Checked {
        if self.should_wrap_ringbuffer {
            self.ringbuffer
                .move_within(self.ringbuffer_size as usize, 0, self.pos as usize)?;
            self.should_wrap_ringbuffer = false;
        }
        Ok(())
    }

    /// Makes the ring buffer as large as [`Self::calculate_ring_buffer_size`] found it has to be. `false` if there is
    /// no memory for that.
    #[inline(never)]
    fn ensure_ring_buffer(&mut self) -> Checked<bool> {
        if self.ringbuffer_size == self.new_ringbuffer_size {
            return Ok(true);
        }
        let Ok(mut ringbuffer) =
            try_zeroed::<u8>(self.new_ringbuffer_size as usize + RING_BUFFER_WRITE_AHEAD_SLACK)
        else {
            return Ok(false);
        };
        if !self.ringbuffer.is_empty() {
            ringbuffer.write_at(0, self.ringbuffer.sub(..self.pos as usize)?)?;
        }
        self.ringbuffer = ringbuffer;
        self.ringbuffer_size = self.new_ringbuffer_size;
        self.ringbuffer_mask = self.new_ringbuffer_size - 1;
        Ok(true)
    }

    #[inline(never)]
    fn skip_metadata_block(&mut self) -> Step {
        let br = &mut self.br;
        if self.meta_block_remaining_len == 0 {
            return Ok(());
        }

        // The bytes in the accumulator.
        if br.available_bits() >= 8 {
            let nbytes = ((br.available_bits() >> 3) as i32).min(self.meta_block_remaining_len);
            for _ in 0..nbytes {
                br.drop_bits(8);
            }
            self.meta_block_remaining_len -= nbytes;
            if self.meta_block_remaining_len == 0 {
                return Ok(());
            }
        }

        // The bytes in the input.
        let nbytes = (br.remaining_bytes() as i32).min(self.meta_block_remaining_len);
        if nbytes > 0 {
            br.jump_to_byte_boundary();
            br.drop_bytes(nbytes as usize);
            self.meta_block_remaining_len -= nbytes;
            if self.meta_block_remaining_len == 0 {
                return Ok(());
            }
        }

        Err(E::NeedsMoreInput)
    }

    #[inline(never)]
    fn copy_uncompressed_block_to_output(&mut self, input: &[u8], output: &mut dyn Output) -> Step {
        if !self.ensure_ring_buffer()? {
            return Err(E::AllocRingBuffer1);
        }

        loop {
            match self.substate_uncompressed {
                UncompressedState::None => {
                    let mut nbytes =
                        (self.br.remaining_bytes() as i32).min(self.meta_block_remaining_len);
                    if self.pos + nbytes > self.ringbuffer_size {
                        nbytes = self.ringbuffer_size - self.pos;
                    }
                    let dest = self
                        .ringbuffer
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
                    if self.ringbuffer_size == 1 << self.window_bits {
                        self.max_distance = self.max_backward_distance;
                    }
                    self.substate_uncompressed = UncompressedState::None;
                }
            }
        }
    }

    /// Starts a copy of `length` bytes from `address` of the compound dictionary. `false` if it ends before that.
    fn initialize_compound_dictionary_copy(&mut self, address: i32, length: i32) -> Checked<bool> {
        let addon = self.compound_dictionary.as_deref_mut().ok_or(Bug)?;
        addon.ensure_initialized()?;
        let mut index = usize::from(addon.block_map.at((address >> addon.block_bits) as usize)?);
        while address >= addon.chunk_offsets.at(index + 1)? {
            index += 1;
        }
        if addon.total_size - address < length {
            return Ok(false);
        }
        self.dist_rb
            .put((self.dist_rb_idx & 3) as usize, self.distance_code)?;
        self.dist_rb_idx = self.dist_rb_idx.wrapping_add(1);
        self.meta_block_remaining_len -= length;
        addon.br_index = index;
        addon.br_offset = address - addon.chunk_offsets.at(index)?;
        addon.br_length = length;
        addon.br_copied = 0;
        Ok(true)
    }

    fn compound_dictionary_size(&self) -> i32 {
        self.compound_dictionary
            .as_ref()
            .map_or(0, |addon| addon.total_size)
    }

    /// Finds the smallest ring buffer that will do, now that the length and the flags of the meta-block are known: a
    /// stream that announces a large window need not have that much data.
    #[inline(never)]
    fn calculate_ring_buffer_size(&mut self) {
        let window_size = 1i32 << self.window_bits;
        let mut new_ringbuffer_size = window_size;
        // The context of the first byte is taken from the last two bytes of the ring buffer.
        let mut min_size = if self.ringbuffer_size != 0 {
            self.ringbuffer_size
        } else {
            1024
        };

        if self.ringbuffer_size == window_size {
            return;
        }
        if self.is_metadata {
            return;
        }

        let output_size = if self.ringbuffer.is_empty() {
            0
        } else {
            self.pos
        } + self.meta_block_remaining_len;
        min_size = min_size.max(output_size);

        if self.canny_ringbuffer_allocation {
            while (new_ringbuffer_size >> 1) >= min_size {
                new_ringbuffer_size >>= 1;
            }
        }

        self.new_ringbuffer_size = new_ringbuffer_size;
    }

    /// Reads the context mode of each literal block type.
    fn read_context_modes(&mut self, input: &[u8]) -> Step {
        while self.loop_counter < self.num_block_types[0] as i32 {
            let bits = self.br.safe_read_bits(input, 2).ok_or(E::NeedsMoreInput)?;
            self.context_modes
                .put(self.loop_counter as usize, bits as u8)?;
            self.loop_counter += 1;
        }
        Ok(())
    }

    /// 4. Turns one of the 16 distance codes that refer to the last distances into a distance.
    #[inline(always)]
    fn take_distance_from_ring_buffer(&mut self) -> Checked {
        let offset = self.distance_code - 3;
        if self.distance_code <= 3 {
            // A dictionary reference does not go into the ring buffer, and this makes up for that.
            self.distance_context = 1 >> self.distance_code;
            self.distance_code = self
                .dist_rb
                .at((self.dist_rb_idx.wrapping_sub(offset) & 3) as usize)?;
            self.dist_rb_idx = self.dist_rb_idx.wrapping_sub(self.distance_context);
        } else {
            let (base, index_delta) = if self.distance_code < 10 {
                (self.distance_code - 4, 3)
            } else {
                (self.distance_code - 10, 2)
            };
            // One of six 4-bit values.
            let delta = ((0x605142 >> (4 * base)) & 0xF) - 3;
            self.distance_code = self
                .dist_rb
                .at((self.dist_rb_idx.wrapping_add(index_delta) & 3) as usize)?
                + delta;
            if self.distance_code <= 0 {
                // Too large to be valid, which is noticed later.
                self.distance_code = 0x7FFF_FFFF;
            }
        }
        Ok(())
    }

    /// 4. For each distance symbol, the number of extra bits and the first distance. They depend on `NPOSTFIX` and
    /// `NDIRECT`, which are the same for a whole meta-block.
    fn calculate_distance_lut(&mut self) -> Checked {
        let npostfix = self.distance_postfix_bits;
        let ndirect = self.num_direct_distance_codes;
        let alphabet_size_limit = usize::from(self.distance_hgroup.alphabet_size_limit);
        let postfix = 1u32 << npostfix;
        let mut bits = 1u32;
        let mut half = 0u32;

        let mut i = NUM_DISTANCE_SHORT_CODES as usize;

        for j in 0..ndirect {
            self.dist_symbols.put(
                i,
                DistanceSymbol {
                    extra_bits: 0,
                    offset: j + 1,
                },
            )?;
            i += 1;
        }

        while i < alphabet_size_limit {
            let base = ndirect + ((((2 + half) << bits) - 4) << npostfix) + 1;
            for j in 0..postfix {
                self.dist_symbols.put(
                    i,
                    DistanceSymbol {
                        extra_bits: bits as u8,
                        offset: base + j,
                    },
                )?;
                i += 1;
            }
            bits += half;
            half ^= 1;
        }
        Ok(())
    }

    /// Reads a distance code and its extra bits into `distance_code`.
    #[inline(always)]
    fn read_distance<const SAFE: bool>(&mut self, br: &mut BitReader, input: &[u8]) -> Step {
        let distance_tree = Tree::new(&self.distance_hgroup.codes, self.dist_htree as usize);
        let memento = br.save_state();
        let code = read_symbol_maybe_safe::<SAFE>(distance_tree, br, input)?;
        self.block_length[2] = self.block_length[2].wrapping_sub(1);
        self.distance_context = 0;
        if code & !0xF == 0 {
            self.distance_code = code as i32;
            self.take_distance_from_ring_buffer()?;
            return Ok(());
        }
        let symbol = self.dist_symbols.at(code as usize)?;
        let nbits = u32::from(symbol.extra_bits);
        let bits = if !SAFE {
            br.read_bits(input, nbits)?
        } else {
            let Some(bits) = br.safe_read_bits(input, nbits) else {
                self.block_length[2] = self.block_length[2].wrapping_add(1);
                br.restore_state(memento);
                return Err(E::NeedsMoreInput);
            };
            bits
        };
        let offset = u64::from(symbol.offset);
        self.distance_code = (offset + (bits << self.distance_postfix_bits)) as i32;
        Ok(())
    }

    /// Reads an insert-and-copy length code and its extra bits. Returns the insert length.
    #[inline(always)]
    fn read_command<const SAFE: bool>(&mut self, br: &mut BitReader, input: &[u8]) -> Step<i32> {
        let htree_command = Tree::new(&self.insert_copy_hgroup.codes, self.htree_command);
        let memento = br.save_state();
        let cmd_code = read_symbol_maybe_safe::<SAFE>(htree_command, br, input)?;
        let v = CMD_LUT.at(cmd_code as usize)?;
        self.distance_code = i32::from(v.distance_code);
        self.distance_context = i32::from(v.context);
        self.dist_htree = self.dist_htrees.at(usize::from(v.context))?;
        let insert_len_extra;
        let copy_length;
        if !SAFE {
            insert_len_extra = if v.insert_len_extra_bits != 0 {
                br.read_bits(input, u32::from(v.insert_len_extra_bits))?
            } else {
                0
            };
            copy_length = br.read_bits(input, u32::from(v.copy_len_extra_bits))?;
        } else {
            let extra = br
                .safe_read_bits(input, u32::from(v.insert_len_extra_bits))
                .and_then(|insert| {
                    Some((
                        insert,
                        br.safe_read_bits(input, u32::from(v.copy_len_extra_bits))?,
                    ))
                });
            let Some(extra) = extra else {
                br.restore_state(memento);
                return Err(E::NeedsMoreInput);
            };
            (insert_len_extra, copy_length) = extra;
        }
        self.copy_length = copy_length as i32 + i32::from(v.copy_len_offset);
        self.block_length[1] = self.block_length[1].wrapping_sub(1);
        Ok(i32::from(v.insert_len_offset) + insert_len_extra as i32)
    }

    /// Writes what `distance_code`, which is past the data seen so far, refers to in one of the dictionaries: `length`
    /// bytes of the compound dictionary, as far as there is room, or a word of `length` bytes of the static one,
    /// transformed. Returns the position after it.
    #[inline(never)]
    fn copy_from_dictionary(&mut self, ringbuffer: &mut [u8], pos: i32, length: i32) -> Step<i32> {
        let s = self;
        if s.distance_code > MAX_ALLOWED_DISTANCE as i32 {
            return Err(E::FormatDistance);
        }
        let compound_dictionary_size = s.compound_dictionary_size();
        if s.distance_code - s.max_distance - 1 < compound_dictionary_size {
            let address = compound_dictionary_size - (s.distance_code - s.max_distance);
            if !s.initialize_compound_dictionary_copy(address, length)? {
                return Err(E::CompoundDictionary);
            }
            let addon = s.compound_dictionary.as_deref_mut().ok_or(Bug)?;
            return Ok(pos + addon.copy_to(ringbuffer, s.ringbuffer_size, pos)?);
        }
        if length < MIN_DICTIONARY_WORD_LENGTH as i32 || length > MAX_DICTIONARY_WORD_LENGTH as i32
        {
            return Err(E::FormatDictionary);
        }
        let word_length = length as usize;
        let shift = u32::from(dictionary::SIZE_BITS_BY_LENGTH.at(word_length)?);
        let address = s.distance_code - s.max_distance - 1 - compound_dictionary_size;
        let word_idx = (address & bit_mask(shift) as i32) as usize;
        let transform_idx = (address >> shift) as usize;
        let offset =
            dictionary::OFFSETS_BY_LENGTH.at(word_length)? as usize + word_idx * word_length;
        // See `take_distance_from_ring_buffer`.
        s.dist_rb_idx = s.dist_rb_idx.wrapping_add(s.distance_context);
        if transform_idx >= NUM_TRANSFORMS {
            return Err(E::FormatTransform);
        }
        let word = dictionary::DATA.sub(offset..offset + word_length)?;
        let len = if transform_idx == 0 {
            ringbuffer.write_at(pos as usize, word)?;
            length
        } else {
            let dst = ringbuffer.sub_mut(pos as usize..)?;
            let len = transform_dictionary_word(dst, word, transform_idx)? as i32;
            if len == 0 && s.distance_code <= 120 {
                return Err(E::FormatTransform);
            }
            len
        };
        s.meta_block_remaining_len -= len;
        Ok(pos + len)
    }

    /// 10. Decodes commands until the meta-block ends, the ring buffer is full, or the input runs out. `pos` is the
    /// position in the ring buffer and `i` how much is left of the insert or copy in progress.
    #[inline(always)]
    fn process_commands_internal<const SAFE: bool>(
        &mut self,
        input: &[u8],
        br: &mut BitReader,
        ringbuffer: &mut [u8],
        pos: &mut i32,
        i: &mut i32,
    ) -> Step {
        let s = self;
        // The functions that are not inlined use `s.br`, so that `br` can stay in registers.
        macro_rules! block_switch {
            ($function:ident) => {{
                s.br = *br;
                let result = s.$function::<SAFE>(input);
                *br = s.br;
                result
            }};
        }

        if !(SAFE || br.check_input_amount()) {
            return Err(E::NeedsMoreInput);
        }
        if !SAFE {
            br.warmup(input);
        }

        let mut label = match s.state {
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
                        s.state = State::CommandBegin;
                    }
                    if !(SAFE || br.check_input_amount()) {
                        s.state = State::CommandBegin;
                        return Err(E::NeedsMoreInput);
                    }
                    if s.block_length[1] == 0 {
                        block_switch!(decode_command_block_switch)?;
                        continue;
                    }
                    *i = s.read_command::<SAFE>(br, input)?;
                    if *i == 0 {
                        label = Label::CommandPostDecodeLiterals;
                        continue;
                    }
                    s.meta_block_remaining_len -= *i;
                    label = Label::CommandInner;
                }

                Label::CommandInner => {
                    if SAFE {
                        s.state = State::CommandInner;
                    }
                    if s.trivial_literal_context {
                        let literal_htree = s.literal_hgroup.codes.sub(s.literal_htree..)?;
                        if !SAFE {
                            let mut preloaded = preload_symbol(literal_htree, br, input)?;
                            // The hottest part of the decoder. For this many literals neither the ring buffer nor the
                            // block can end, so only the input has to be watched.
                            let mut num_steps = *i - 1;
                            if num_steps > 0 && num_steps as u32 > s.block_length[0] {
                                num_steps = s.block_length[0] as i32;
                            }
                            if s.ringbuffer_size >= *pos && (s.ringbuffer_size - *pos) <= num_steps
                            {
                                num_steps = s.ringbuffer_size - *pos - 1;
                            }
                            let num_steps = copy_preloaded_symbols_to_u8(
                                literal_htree,
                                br,
                                input,
                                &mut preloaded,
                                ringbuffer,
                                *pos as usize,
                                num_steps.max(0) as usize,
                            )? as i32;
                            *pos += num_steps;
                            s.block_length[0] -= num_steps as u32;
                            *i -= num_steps;
                            loop {
                                if !br.check_input_amount() {
                                    s.state = State::CommandInner;
                                    return Err(E::NeedsMoreInput);
                                }
                                if s.block_length[0] == 0 {
                                    label = Label::NextLiteralBlock;
                                    break;
                                }
                                let literal = read_preloaded_symbol(
                                    literal_htree,
                                    br,
                                    input,
                                    &mut preloaded,
                                )?;
                                ringbuffer.put(*pos as usize, literal as u8)?;
                                s.block_length[0] -= 1;
                                *pos += 1;
                                if *pos == s.ringbuffer_size {
                                    s.state = State::CommandInnerWrite;
                                    *i -= 1;
                                    return Ok(());
                                }
                                *i -= 1;
                                if *i == 0 {
                                    break;
                                }
                            }
                        } else {
                            loop {
                                if s.block_length[0] == 0 {
                                    label = Label::NextLiteralBlock;
                                    break;
                                }
                                let literal =
                                    safe_read_symbol(Tree::new(literal_htree, 0), br, input)?
                                        .ok_or(E::NeedsMoreInput)?;
                                ringbuffer.put(*pos as usize, literal as u8)?;
                                s.block_length[0] -= 1;
                                *pos += 1;
                                if *pos == s.ringbuffer_size {
                                    s.state = State::CommandInnerWrite;
                                    *i -= 1;
                                    return Ok(());
                                }
                                *i -= 1;
                                if *i == 0 {
                                    break;
                                }
                            }
                        }
                    } else {
                        let mut p1 = ringbuffer.at(((*pos - 1) & s.ringbuffer_mask) as usize)?;
                        let mut p2 = ringbuffer.at(((*pos - 2) & s.ringbuffer_mask) as usize)?;
                        let context_map_slice: &[u8; 1 << LITERAL_CONTEXT_BITS] =
                            s.context_map.array_at(s.context_map_slice)?;
                        loop {
                            if !SAFE && !br.check_input_amount() {
                                s.state = State::CommandInner;
                                return Err(E::NeedsMoreInput);
                            }
                            if s.block_length[0] == 0 {
                                label = Label::NextLiteralBlock;
                                break;
                            }
                            let context = s.context_lookup.context(p1, p2);
                            let tree = context_map_slice.at(usize::from(context))?;
                            let hc = Tree::new(
                                &s.literal_hgroup.codes,
                                s.literal_hgroup.htrees.at(usize::from(tree))? as usize,
                            );
                            p2 = p1;
                            p1 = read_symbol_maybe_safe::<SAFE>(hc, br, input)? as u8;
                            ringbuffer.put(*pos as usize, p1)?;
                            s.block_length[0] -= 1;
                            *pos += 1;
                            if *pos == s.ringbuffer_size {
                                s.state = State::CommandInnerWrite;
                                *i -= 1;
                                return Ok(());
                            }
                            *i -= 1;
                            if *i == 0 {
                                break;
                            }
                        }
                    }
                    if matches!(label, Label::NextLiteralBlock) {
                        continue;
                    }
                    if s.meta_block_remaining_len <= 0 {
                        s.state = State::MetaBlockDone;
                        return Ok(());
                    }
                    label = Label::CommandPostDecodeLiterals;
                }

                Label::CommandPostDecodeLiterals => {
                    if SAFE {
                        s.state = State::CommandPostDecodeLiterals;
                    }
                    if s.distance_code >= 0 {
                        // The command implies the last distance.
                        s.distance_context = if s.distance_code != 0 { 0 } else { 1 };
                        s.dist_rb_idx = s.dist_rb_idx.wrapping_sub(1);
                        s.distance_code = s.dist_rb.at((s.dist_rb_idx & 3) as usize)?;
                    } else {
                        if s.block_length[2] == 0 {
                            block_switch!(decode_distance_block_switch)?;
                        }
                        s.read_distance::<SAFE>(br, input)?;
                    }
                    if s.max_distance != s.max_backward_distance {
                        s.max_distance = (*pos).min(s.max_backward_distance);
                    }
                    *i = s.copy_length;
                    // A distance past the data seen so far refers to one of the dictionaries.
                    if s.distance_code > s.max_distance {
                        *pos = s.copy_from_dictionary(ringbuffer, *pos, *i)?;
                        if *pos >= s.ringbuffer_size {
                            s.state = State::CommandPostWrite1;
                            return Ok(());
                        }
                    } else {
                        let src_start = (*pos - s.distance_code) & s.ringbuffer_mask;
                        let dst_end = *pos + *i;
                        let src_end = src_start + *i;
                        s.dist_rb
                            .put((s.dist_rb_idx & 3) as usize, s.distance_code)?;
                        s.dist_rb_idx = s.dist_rb_idx.wrapping_add(1);
                        s.meta_block_remaining_len -= *i;
                        let (src, dst) = (src_start as usize, *pos as usize);
                        // No valid distance reaches the 16 bytes from `pos` on, so they can be written to in any case.
                        let first: [u8; 16] = *ringbuffer.array_at(src)?;
                        *ringbuffer.array_at_mut(dst)? = first;
                        if (src_end > *pos && dst_end > src_start)
                            || dst_end >= s.ringbuffer_size
                            || src_end >= s.ringbuffer_size
                        {
                            // The two overlap, or one of them goes past the end of the ring buffer.
                            label = Label::CommandPostWrapCopy;
                            continue;
                        }
                        *pos += *i;
                        if *i > 16 {
                            if *i > 32 {
                                ringbuffer.move_within(src + 16, dst + 16, (*i - 16) as usize)?;
                            } else {
                                let second: [u8; 16] = *ringbuffer.array_at(src + 16)?;
                                *ringbuffer.array_at_mut(dst + 16)? = second;
                            }
                        }
                    }
                    if s.meta_block_remaining_len <= 0 {
                        s.state = State::MetaBlockDone;
                        return Ok(());
                    }
                    label = Label::CommandBegin;
                }

                Label::CommandPostWrapCopy => {
                    let mut wrap_guard = s.ringbuffer_size - *pos;
                    loop {
                        *i -= 1;
                        if *i < 0 {
                            break;
                        }
                        let byte = ringbuffer
                            .at(((*pos - s.distance_code) & s.ringbuffer_mask) as usize)?;
                        ringbuffer.put(*pos as usize, byte)?;
                        *pos += 1;
                        wrap_guard -= 1;
                        if wrap_guard == 0 {
                            s.state = State::CommandPostWrite2;
                            return Ok(());
                        }
                    }
                    if s.meta_block_remaining_len <= 0 {
                        s.state = State::MetaBlockDone;
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
        let mut i = self.loop_counter;
        let mut br = self.br;
        let mut ringbuffer = core::mem::take(&mut self.ringbuffer);
        let result = self.process_commands_internal::<SAFE>(
            input,
            &mut br,
            &mut ringbuffer,
            &mut pos,
            &mut i,
        );
        self.ringbuffer = ringbuffer;
        self.br = br;
        self.pos = pos;
        self.loop_counter = i;
        result
    }

    fn meta_block_begin(&mut self) {
        self.meta_block_remaining_len = 0;
        self.block_length = [BLOCK_SIZE_CAP; 3];
        self.num_block_types = [1; 3];
        self.block_type_rb = [1, 0, 1, 0, 1, 0];
        self.context_map_slice = 0;
        self.literal_htree = 0;
    }

    fn cleanup_after_meta_block(&mut self) {
        self.context_modes = Vec::new();
        self.context_map = Vec::new();
        self.dist_context_map = Vec::new();
        self.literal_hgroup = HuffmanTreeGroup::default();
        self.insert_copy_hgroup = HuffmanTreeGroup::default();
        self.distance_hgroup = HuffmanTreeGroup::default();
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
                    if !self.ringbuffer.is_empty() {
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
        let s = self;
        match s.state {
            State::Uninited => {
                if !s.br.warmup(input) {
                    return Err(E::NeedsMoreInput);
                }
                s.decode_window_bits()?;
                s.state = if s.large_window {
                    State::LargeWindowBits
                } else {
                    State::Initialize
                };
            }

            State::LargeWindowBits => {
                let bits = s.br.safe_read_bits(input, 6).ok_or(E::NeedsMoreInput)?;
                s.window_bits = bits as u32 & 63;
                if s.window_bits < LARGE_MIN_WBITS || s.window_bits > LARGE_MAX_WBITS {
                    return Err(E::FormatWindowBits);
                }
                s.state = State::Initialize;
            }

            State::Initialize => {
                s.max_backward_distance = max_backward_limit(s.window_bits) as i32;
                s.state = State::MetaBlockBegin;
            }

            State::MetaBlockBegin => {
                s.meta_block_begin();
                s.state = State::MetaBlockHeader;
            }

            State::MetaBlockHeader => {
                s.decode_meta_block_length(input)?;
                if (s.is_metadata || s.is_uncompressed) && !s.br.jump_to_byte_boundary() {
                    return Err(E::FormatPadding1);
                }
                if s.is_metadata {
                    s.state = State::Metadata;
                    return Ok(Flow::Continue);
                }
                if s.meta_block_remaining_len == 0 {
                    s.state = State::MetaBlockDone;
                    return Ok(Flow::Continue);
                }
                s.calculate_ring_buffer_size();
                s.state = if s.is_uncompressed {
                    State::Uncompressed
                } else {
                    State::BeforeCompressedMetaBlockHeader
                };
            }

            State::BeforeCompressedMetaBlockHeader => {
                s.loop_counter = 0;
                s.header.sub_loop_counter = 0;
                s.header.substate_huffman = HuffmanState::None;
                s.header.substate_tree_group = TreeGroupState::None;
                s.header.substate_context_map = ContextMapState::None;
                s.state = State::HuffmanCode0;
            }

            State::HuffmanCode0 => {
                if s.loop_counter >= 3 {
                    s.state = State::MetablockHeader2;
                    return Ok(Flow::Continue);
                }
                let num_block_types = s.num_block_types.at_mut(s.loop_counter as usize)?;
                decode_var_len_uint8(
                    &mut s.substate_decode_uint8,
                    &mut s.br,
                    input,
                    num_block_types,
                )?;
                *num_block_types += 1;
                if *num_block_types < 2 {
                    s.loop_counter += 1;
                    return Ok(Flow::Continue);
                }
                if s.block_type_trees.is_empty() {
                    s.block_len_trees = try_vec(HuffmanCode::default(), 3 * HUFFMAN_MAX_SIZE_26)
                        .map_err(|_| E::AllocBlockTypeTrees)?;
                    s.block_type_trees = try_vec(HuffmanCode::default(), 3 * HUFFMAN_MAX_SIZE_258)
                        .map_err(|_| E::AllocBlockTypeTrees)?;
                }
                s.state = State::HuffmanCode1;
            }

            State::HuffmanCode1 => {
                let alphabet_size = s.num_block_types.at(s.loop_counter as usize)? + 2;
                let tree_offset = s.loop_counter as usize * HUFFMAN_MAX_SIZE_258;
                let table = s.block_type_trees.sub_mut(tree_offset..)?;
                s.header.read_huffman_code(
                    &mut s.br,
                    input,
                    alphabet_size,
                    alphabet_size,
                    table,
                )?;
                s.state = State::HuffmanCode2;
            }

            State::HuffmanCode2 => {
                let alphabet_size = NUM_BLOCK_LEN_SYMBOLS as u32;
                let tree_offset = s.loop_counter as usize * HUFFMAN_MAX_SIZE_26;
                let table = s.block_len_trees.sub_mut(tree_offset..)?;
                s.header.read_huffman_code(
                    &mut s.br,
                    input,
                    alphabet_size,
                    alphabet_size,
                    table,
                )?;
                s.state = State::HuffmanCode3;
            }

            State::HuffmanCode3 => {
                let tree_offset = s.loop_counter as usize * HUFFMAN_MAX_SIZE_26;
                let block_length = safe_read_block_length(
                    &mut s.substate_read_block_length,
                    &mut s.block_length_index,
                    Tree::new(&s.block_len_trees, tree_offset),
                    &mut s.br,
                    input,
                )?
                .ok_or(E::NeedsMoreInput)?;
                s.block_length.put(s.loop_counter as usize, block_length)?;
                s.loop_counter += 1;
                s.state = State::HuffmanCode0;
            }

            State::Uncompressed => {
                s.copy_uncompressed_block_to_output(input, output)?;
                s.state = State::MetaBlockDone;
            }

            State::Metadata => {
                s.skip_metadata_block()?;
                s.state = State::MetaBlockDone;
            }

            State::MetablockHeader2 => {
                let bits = s.br.safe_read_bits(input, 6).ok_or(E::NeedsMoreInput)? as u32;
                s.distance_postfix_bits = bits & 3;
                s.num_direct_distance_codes = (bits >> 2) << s.distance_postfix_bits;
                s.context_modes =
                    try_zeroed(s.num_block_types[0] as usize).map_err(|_| E::AllocContextModes)?;
                s.loop_counter = 0;
                s.state = State::ContextModes;
            }

            State::ContextModes => {
                s.read_context_modes(input)?;
                s.state = State::ContextMap1;
            }

            State::ContextMap1 => {
                let mut num_htrees = s.num_literal_htrees;
                let mut context_map = core::mem::take(&mut s.context_map);
                let size = s.num_block_types[0] << LITERAL_CONTEXT_BITS;
                let result = s.decode_context_map(input, size, &mut num_htrees, &mut context_map);
                s.num_literal_htrees = num_htrees;
                s.context_map = context_map;
                result?;
                s.detect_trivial_literal_block_types()?;
                s.state = State::ContextMap2;
            }

            State::ContextMap2 => {
                let npostfix = s.distance_postfix_bits;
                let ndirect = s.num_direct_distance_codes;
                let mut distance_alphabet_size_max =
                    distance_alphabet_size(npostfix, ndirect, MAX_DISTANCE_BITS);
                let mut distance_alphabet_size_limit = distance_alphabet_size_max;
                if s.large_window {
                    let limit =
                        calculate_distance_code_limit(MAX_ALLOWED_DISTANCE, npostfix, ndirect);
                    distance_alphabet_size_max =
                        distance_alphabet_size(npostfix, ndirect, LARGE_MAX_DISTANCE_BITS);
                    distance_alphabet_size_limit = limit.max_alphabet_size;
                }
                let mut num_htrees = s.num_dist_htrees;
                let mut context_map = core::mem::take(&mut s.dist_context_map);
                let size = s.num_block_types[2] << DISTANCE_CONTEXT_BITS;
                let result = s.decode_context_map(input, size, &mut num_htrees, &mut context_map);
                s.num_dist_htrees = num_htrees;
                s.dist_context_map = context_map;
                result?;
                s.literal_hgroup = huffman_tree_group(
                    NUM_LITERAL_SYMBOLS as u32,
                    NUM_LITERAL_SYMBOLS as u32,
                    s.num_literal_htrees,
                )?;
                s.insert_copy_hgroup = huffman_tree_group(
                    NUM_COMMAND_SYMBOLS as u32,
                    NUM_COMMAND_SYMBOLS as u32,
                    s.num_block_types[1],
                )?;
                s.distance_hgroup = huffman_tree_group(
                    distance_alphabet_size_max,
                    distance_alphabet_size_limit,
                    s.num_dist_htrees,
                )?;
                s.loop_counter = 0;
                s.state = State::TreeGroup;
            }

            State::TreeGroup => {
                let hgroup = match s.loop_counter {
                    0 => &mut s.literal_hgroup,
                    1 => &mut s.insert_copy_hgroup,
                    2 => &mut s.distance_hgroup,
                    _ => return Err(E::Unreachable),
                };
                s.header
                    .huffman_tree_group_decode(&mut s.br, input, hgroup)?;
                s.loop_counter += 1;
                if s.loop_counter >= 3 {
                    s.state = State::BeforeCompressedMetaBlockBody;
                }
            }

            State::BeforeCompressedMetaBlockBody => {
                s.prepare_literal_decoding()?;
                s.prepare_distance_decoding()?;
                s.htree_command = s.insert_copy_hgroup.htrees.at(0)? as usize;
                if !s.ensure_ring_buffer()? {
                    return Err(E::AllocRingBuffer2);
                }
                s.calculate_distance_lut()?;
                s.state = State::CommandBegin;
            }

            State::CommandBegin
            | State::CommandInner
            | State::CommandPostDecodeLiterals
            | State::CommandPostWrapCopy => {
                let mut result = s.process_commands::<false>(input);
                if result == Err(E::NeedsMoreInput) {
                    result = s.process_commands::<true>(input);
                }
                result?;
            }

            State::CommandInnerWrite | State::CommandPostWrite1 | State::CommandPostWrite2 => {
                s.write_ring_buffer(output, false)?;
                s.wrap_ring_buffer()?;
                if s.ringbuffer_size == 1 << s.window_bits {
                    s.max_distance = s.max_backward_distance;
                }
                match s.state {
                    State::CommandPostWrite1 => {
                        if let Some(addon) = &mut s.compound_dictionary
                            && addon.br_length != addon.br_copied
                        {
                            s.pos += addon.copy_to(&mut s.ringbuffer, s.ringbuffer_size, s.pos)?;
                            if s.pos >= s.ringbuffer_size {
                                return Ok(Flow::Continue);
                            }
                        }
                        s.state = if s.meta_block_remaining_len == 0 {
                            State::MetaBlockDone
                        } else {
                            State::CommandBegin
                        };
                    }
                    State::CommandPostWrite2 => s.state = State::CommandPostWrapCopy,
                    _ => {
                        s.state = if s.loop_counter != 0 {
                            State::CommandInner
                        } else if s.meta_block_remaining_len == 0 {
                            State::MetaBlockDone
                        } else {
                            State::CommandPostDecodeLiterals
                        };
                    }
                }
            }

            State::MetaBlockDone => {
                if s.meta_block_remaining_len < 0 {
                    return Err(E::FormatBlockLength2);
                }
                s.cleanup_after_meta_block();
                if !s.is_last_meta_block {
                    s.state = State::MetaBlockBegin;
                    return Ok(Flow::Continue);
                }
                if !s.br.jump_to_byte_boundary() {
                    return Err(E::FormatPadding2);
                }
                if s.buffer_length == 0 {
                    s.br.unload()?;
                    *next_in = s.br.next_in();
                }
                s.state = State::Done;
            }

            State::Done => {
                if !s.ringbuffer.is_empty() {
                    s.write_ring_buffer(output, true)?;
                }
                return Ok(Flow::Finished);
            }
        }
        Ok(Flow::Continue)
    }
}

/// Room for `ntrees` lookup tables.
fn huffman_tree_group(
    alphabet_size_max: u32,
    alphabet_size_limit: u32,
    ntrees: u32,
) -> Step<HuffmanTreeGroup> {
    // 376 = 256 for the first level + 4 + 7 + 15 + 31 + 63 for the second. It is a little more than any code needs.
    let max_table_size = alphabet_size_limit as usize + 376;
    Ok(HuffmanTreeGroup {
        htrees: try_zeroed(ntrees as usize).map_err(|_| E::AllocTreeGroups)?,
        codes: try_vec(HuffmanCode::default(), ntrees as usize * max_table_size)
            .map_err(|_| E::AllocTreeGroups)?,
        alphabet_size_max: alphabet_size_max as u16,
        alphabet_size_limit: alphabet_size_limit as u16,
    })
}
