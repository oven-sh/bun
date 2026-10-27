//! The streaming encoder.

use super::backward_references::create_backward_references;
use super::backward_references_hq::{
    create_hq_zopfli_backward_references, create_zopfli_backward_references,
};
use super::bit_cost::bits_entropy;
use super::bit_stream::{
    store_meta_block, store_meta_block_fast, store_meta_block_trivial,
    store_uncompressed_meta_block,
};
use super::bit_writer::BitWriter;
use super::command::Command;
use super::compound_dictionary::{CompoundDictionary, PreparedDictionary};
use super::compress_fragment::{OnePassArena, compress_fragment_fast};
use super::compress_fragment_two_pass::{
    COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE, TwoPassArena, compress_fragment_two_pass,
};
use super::fast_log::{fast_log2, log2_floor_nonzero};
use super::hash::Hasher;
use super::meta_block::{
    MAX_STATIC_CONTEXTS, MetaBlockSplit, build_meta_block, build_meta_block_greedy,
    init_distance_params, optimize_histograms,
};
use super::params::{
    DistanceParams, EncoderMode, EncoderParams, FAST_ONE_PASS_COMPRESSION_QUALITY,
    FAST_TWO_PASS_COMPRESSION_QUALITY, HQ_ZOPFLIFICATION_QUALITY, HasherParams,
    MAX_NUM_DELAYED_SYMBOLS, MAX_QUALITY_FOR_STATIC_ENTROPY_CODES, MIN_QUALITY_FOR_BLOCK_SPLIT,
    MIN_QUALITY_FOR_CONTEXT_MODELING, MIN_QUALITY_FOR_HQ_BLOCK_SPLITTING,
    MIN_QUALITY_FOR_HQ_CONTEXT_MODELING, MIN_QUALITY_FOR_NONZERO_DISTANCE_PARAMS,
    MIN_QUALITY_FOR_OPTIMIZE_HISTOGRAMS, ZOPFLIFICATION_QUALITY, max_hash_table_size,
};
use super::ring_buffer::RingBuffer;
use super::utf8_util::{MIN_UTF8_RATIO, is_mostly_utf8};
use super::{
    DEFAULT_QUALITY, DEFAULT_WINDOW, EncoderOperation, EncoderParameter, Fallible, MAX_WINDOW_BITS,
};
use crate::common::constants::{
    MAX_DISTANCE, MAX_DISTANCE_BITS, MAX_NDIRECT, MAX_NPOSTFIX, NUM_DISTANCE_SHORT_CODES,
    WINDOW_GAP, distance_alphabet_size, max_backward_limit,
};
use crate::common::context::{ContextType, context_lut};
use crate::io::{Output, SpareCapacity};
use crate::util::{Bug, Checked, SliceExt, try_zeroed};
use bun_core::AllocError;

#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamState {
    Processing,
    /// After the next block, pad to a whole byte and go back to `Processing`.
    FlushRequested,
    /// The last meta-block was produced. No more input is accepted.
    Finished,
    /// Flushing what is pending, then writing the header of a metadata block.
    MetadataHead,
    /// Writing the body of a metadata block.
    MetadataBody,
}

/// The "flint" is a tiny uncompressed block at the start of a stream that continues another one
/// ([`EncoderParameter::StreamOffset`]), so that the context of the first literals does not depend on the bytes before.
/// A positive value is how many bytes it still needs.
const FLINT_NEEDS_2_BYTES: i8 = 2;
const FLINT_WAITING_FOR_PROCESSING: i8 = 0;
const FLINT_WAITING_FOR_FLUSHING: i8 = -1;
const FLINT_DONE: i8 = -2;

/// Where the output that was not handed over yet starts.
#[derive(Clone, Copy)]
enum NextOut {
    None,
    Storage(usize),
    TinyBuf(usize),
}

/// `BrotliEncoderState`.
pub struct Encoder {
    params: EncoderParams,

    /// How many bytes were copied to the ring buffer.
    input_pos: u64,
    ringbuffer: RingBuffer,
    /// Of the meta-block in progress.
    commands: Vec<Command>,
    num_literals: usize,
    /// How many bytes at the end of what was processed are not covered by a command yet.
    last_insert_len: usize,
    /// The input up to here is in a finished meta-block.
    last_flush_pos: u64,
    /// The input up to here was searched for matches.
    last_processed_pos: u64,
    dist_cache: [i32; NUM_DISTANCE_SHORT_CODES as usize],
    /// The first four as they were at the start of the meta-block, for when it ends up uncompressed.
    saved_dist_cache: [i32; 4],
    /// The `last_bytes_bits` bits of output that do not fill a byte yet. Before the first block, the stream header.
    last_bytes: u16,
    last_bytes_bits: u8,
    flint: i8,
    /// The last two bytes before `last_flush_pos`.
    prev_byte: u8,
    prev_byte2: u8,
    /// The meta-block that was written last.
    storage: Vec<u8>,

    hasher: Hasher,

    /// The hash table of qualities 0 and 1.
    table: Vec<i32>,
    one_pass_arena: Option<Box<OnePassArena>>,
    two_pass_arena: Option<Box<TwoPassArena>>,
    /// Scratch space of quality 1.
    command_buf: Vec<u32>,
    literal_buf: Vec<u8>,

    next_out: NextOut,
    available_out: usize,
    /// For padding bits, and for the header and the body of metadata blocks.
    tiny_buf: [u8; 16],
    /// `u32::MAX` outside of a metadata block.
    remaining_metadata_bytes: u32,
    stream_state: StreamState,

    is_last_block_emitted: bool,
    is_initialized: bool,
    /// Memory ran out, or there is a bug. The state is not consistent and every call fails.
    is_broken: bool,
}

/// Wraps a position to 32 bits so that it still tells whether the ring buffer was filled once: the first 3 GiB map to
/// themselves, later ones to the 2 GiB from 1 GiB on.
fn wrap_position(position: u64) -> u32 {
    let mut result = position as u32;
    let gb = position >> 30;
    if gb > 2 {
        result = (result & ((1 << 30) - 1)) | ((((gb - 1) & 1) as u32 + 1) << 30);
    }
    result
}

/// Makes `storage` at least `size` long. What it held is lost.
fn get_storage(storage: &mut Vec<u8>, size: usize) -> Result<&mut [u8], AllocError> {
    if storage.len() < size {
        *storage = Vec::new();
        *storage = try_zeroed(size)?;
    }
    Ok(storage)
}

fn hash_table_size(max_table_size: usize, input_size: usize) -> usize {
    let mut htsize = 256;
    while htsize < max_table_size && htsize < input_size {
        htsize <<= 1;
    }
    htsize
}

/// A cleared table. It is smaller for a short input, which does not need many entries, since clearing takes time.
fn get_hash_table(table: &mut Vec<i32>, quality: i32, input_size: usize) -> Fallible<&mut [i32]> {
    let max_table_size = max_hash_table_size(quality);
    let mut htsize = hash_table_size(max_table_size, input_size);
    // Quality 0 only supports odd shifts.
    if quality == FAST_ONE_PASS_COMPRESSION_QUALITY && htsize & 0xAAAAA == 0 {
        htsize <<= 1;
    }
    if htsize > table.len() {
        *table = Vec::new();
        *table = try_zeroed(htsize)?;
        return Ok(table);
    }
    let table = table.sub_mut(..htsize)?;
    table.fill(0);
    Ok(table)
}

/// 9.1. Format of the stream header. Returns the bits and how many they are.
fn encode_window_bits(lgwin: i32, large_window: bool) -> (u16, u8) {
    if large_window {
        ((((lgwin & 0x3F) << 8) | 0x11) as u16, 14)
    } else if lgwin == 16 {
        (0, 1)
    } else if lgwin == 17 {
        (1, 7)
    } else if lgwin > 17 {
        ((((lgwin - 17) << 1) | 0x01) as u16, 4)
    } else {
        ((((lgwin - 8) << 4) | 0x01) as u16, 7)
    }
}

/// The command and distance prefix codes of the first block at quality 0.
fn init_command_prefix_codes(s: &mut OnePassArena) -> Checked {
    #[rustfmt::skip]
    const DEFAULT_COMMAND_DEPTHS: [u8; 124] = [
        0, 4, 4, 5, 6, 6, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8,
        0, 0, 0, 4, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7,
        7, 7, 10, 10, 10, 10, 10, 10, 0, 4, 4, 5, 5, 5, 6, 6,
        7, 8, 8, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
        5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4,
        4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 7, 7, 7, 8, 10,
        12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
    ];
    #[rustfmt::skip]
    const DEFAULT_COMMAND_BITS: [u16; 124] = [
        0,   0,   8,   9,   3,  35,   7,   71,
        39, 103,  23,  47, 175, 111, 239,   31,
        0,   0,   0,   4,  12,   2,  10,    6,
        13,  29,  11,  43,  27,  59,  87,   55,
        15,  79, 319, 831, 191, 703, 447,  959,
        0,  14,   1,  25,   5,  21,  19,   51,
        119, 159,  95, 223, 479, 991,  63,  575,
        127, 639, 383, 895, 255, 767, 511, 1023,
        14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        27, 59, 7, 39, 23, 55, 30, 1, 17, 9, 25, 5, 0, 8, 4, 12,
        2, 10, 6, 21, 13, 29, 3, 19, 11, 15, 47, 31, 95, 63, 127, 255,
        767, 2815, 1791, 3839, 511, 2559, 1535, 3583, 1023, 3071, 2047, 4095,
    ];
    #[rustfmt::skip]
    const DEFAULT_COMMAND_CODE: [u8; 57] = [
        0xff, 0x77, 0xd5, 0xbf, 0xe7, 0xde, 0xea, 0x9e, 0x51, 0x5d, 0xde, 0xc6,
        0x70, 0x57, 0xbc, 0x58, 0x58, 0x58, 0xd8, 0xd8, 0x58, 0xd5, 0xcb, 0x8c,
        0xea, 0xe0, 0xc3, 0x87, 0x1f, 0x83, 0xc1, 0x60, 0x1c, 0x67, 0xb2, 0xaa,
        0x06, 0x83, 0xc1, 0x60, 0x30, 0x18, 0xcc, 0xa1, 0xce, 0x88, 0x54, 0x94,
        0x46, 0xe1, 0xb0, 0xd0, 0x4e, 0xb2, 0xf7, 0x04, 0x00,
    ];
    const DEFAULT_COMMAND_CODE_NUM_BITS: usize = 448;
    s.cmd_depth.fill(0);
    s.cmd_depth.write_at(0, &DEFAULT_COMMAND_DEPTHS)?;
    s.cmd_bits.fill(0);
    s.cmd_bits.write_at(0, &DEFAULT_COMMAND_BITS)?;
    s.cmd_code.write_at(0, &DEFAULT_COMMAND_CODE)?;
    s.cmd_code_numbits = DEFAULT_COMMAND_CODE_NUM_BITS;
    Ok(())
}

/// The Shannon entropy of all the symbols counted in `population` together, in bits.
fn estimate_entropy(population: &[u32]) -> f64 {
    let mut total = 0usize;
    let mut result = 0.0f64;
    for &p in population {
        total += p as usize;
        result += f64::from(p) * fast_log2(p as usize);
    }
    total as f64 * fast_log2(total) - result
}

type StaticContextMap = &'static [u32; 64];

/// Picks a context map by how well the two highest bits of a byte predict those of the next one. `bigram_histo` counts
/// the pairs.
///
/// This takes the Shannon entropy and not [`bits_entropy`], which assumes that the symbols get a prefix code of their own,
/// while these are coded together with the other 6 bits of the byte.
fn choose_context_map(quality: i32, bigram_histo: &[u32; 9]) -> (usize, Option<StaticContextMap>) {
    #[rustfmt::skip]
    static STATIC_CONTEXT_MAP_CONTINUATION: [u32; 64] = [
        1, 1, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    #[rustfmt::skip]
    static STATIC_CONTEXT_MAP_SIMPLE_UTF8: [u32; 64] = [
        0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];

    let [b0, b1, b2, b3, b4, b5, b6, b7, b8] = *bigram_histo;
    let monogram_histo = [b0 + b3 + b6, b1 + b4 + b7, b2 + b5 + b8];
    let two_prefix_histo = [[b0 + b6, b1 + b7, b2 + b8], [b3, b4, b5]];

    let mut entropy1 = estimate_entropy(&monogram_histo);
    let mut entropy2 =
        estimate_entropy(&two_prefix_histo[0]) + estimate_entropy(&two_prefix_histo[1]);
    let mut entropy3 = 0.0;
    for histo in [[b0, b1, b2], [b3, b4, b5], [b6, b7, b8]] {
        entropy3 += estimate_entropy(&histo);
    }

    let total = monogram_histo[0] + monogram_histo[1] + monogram_histo[2];
    debug_assert!(total != 0);
    let inv_total = 1.0 / f64::from(total);
    entropy1 *= inv_total;
    entropy2 *= inv_total;
    entropy3 *= inv_total;

    if quality < MIN_QUALITY_FOR_HQ_CONTEXT_MODELING {
        // 3 contexts are a bit slower.
        entropy3 = entropy1 * 10.0;
    }
    // Below 0.2 bits saved for a symbol, faster decoding is worth more.
    if entropy1 - entropy2 < 0.2 && entropy1 - entropy3 < 0.2 {
        (1, None)
    } else if entropy2 - entropy3 < 0.02 {
        (2, Some(&STATIC_CONTEXT_MAP_SIMPLE_UTF8))
    } else {
        (3, Some(&STATIC_CONTEXT_MAP_CONTINUATION))
    }
}

/// Whether a context map with 13 contexts pays off, judged by the entropy of the 5 highest bits of the literals.
fn should_use_complex_static_context_map(
    input: &[u8],
    mut start_pos: usize,
    length: usize,
    mask: usize,
    size_hint: usize,
) -> Checked<Option<StaticContextMap>> {
    #[rustfmt::skip]
    static STATIC_CONTEXT_MAP_COMPLEX_UTF8: [u32; 64] = [
        11, 11, 12, 12, // 0 special
        0, 0, 0, 0, // 4 lf
        1, 1, 9, 9, // 8 space
        2, 2, 2, 2, // !, first after space/lf and after something else.
        1, 1, 1, 1, // "
        8, 3, 3, 3, // %
        1, 1, 1, 1, // ({[
        2, 2, 2, 2, // }])
        8, 4, 4, 4, // :;
        8, 7, 4, 4, // .
        8, 0, 0, 0, // >
        3, 3, 3, 3, // [0..9]
        5, 5, 10, 5, // [A-Z]
        5, 5, 10, 5,
        6, 6, 6, 6, // [a-z]
        6, 6, 6, 6,
    ];
    // Only for long data.
    if size_hint < (1 << 20) {
        return Ok(None);
    }
    let end_pos = start_pos + length;
    let mut combined_histo = [0u32; 32];
    let mut context_histo = [[0u32; 32]; MAX_STATIC_CONTEXTS];
    let mut total = 0u32;
    let utf8_lut = context_lut(ContextType::Utf8);
    // Only 64 bytes in every 4 KiB are looked at.
    while start_pos + 64 <= end_pos {
        let stride_end_pos = start_pos + 64;
        let mut prev2 = input.at(start_pos & mask)?;
        let mut prev1 = input.at((start_pos + 1) & mask)?;
        for pos in start_pos + 2..stride_end_pos {
            let literal = input.at(pos & mask)?;
            let context =
                STATIC_CONTEXT_MAP_COMPLEX_UTF8.at(usize::from(utf8_lut.context(prev1, prev2)))?;
            total += 1;
            *combined_histo.at_mut(usize::from(literal >> 3))? += 1;
            *context_histo
                .at_mut(context as usize)?
                .at_mut(usize::from(literal >> 3))? += 1;
            prev2 = prev1;
            prev1 = literal;
        }
        start_pos += 4096;
    }
    let mut entropy1 = estimate_entropy(&combined_histo);
    let mut entropy2 = 0.0;
    for histo in &context_histo {
        entropy2 += estimate_entropy(histo);
    }
    let inv_total = 1.0 / f64::from(total);
    entropy1 *= inv_total;
    entropy2 *= inv_total;
    // Not for data that compresses badly, at over 60% of the maximal entropy with the contexts, nor to save less than
    // 0.2 bits for a symbol.
    if entropy2 > 3.0 || entropy1 - entropy2 < 0.2 {
        Ok(None)
    } else {
        Ok(Some(&STATIC_CONTEXT_MAP_COMPLEX_UTF8))
    }
}

/// How many literal contexts a meta-block gets at qualities 5 to 9, and what maps the 64 context IDs to them.
fn decide_over_literal_context_modeling(
    input: &[u8],
    mut start_pos: usize,
    length: usize,
    mask: usize,
    quality: i32,
    size_hint: usize,
) -> Checked<(usize, Option<StaticContextMap>)> {
    if quality < MIN_QUALITY_FOR_CONTEXT_MODELING || length < 64 {
        return Ok((1, None));
    }
    if let Some(map) =
        should_use_complex_static_context_map(input, start_pos, length, mask, size_hint)?
    {
        return Ok((MAX_STATIC_CONTEXTS, Some(map)));
    }
    // Count pairs of UTF-8 byte kinds, in 64 bytes of every 4 KiB.
    const LUT: [usize; 4] = [0, 0, 1, 2];
    let end_pos = start_pos + length;
    let mut bigram_prefix_histo = [0u32; 9];
    while start_pos + 64 <= end_pos {
        let stride_end_pos = start_pos + 64;
        let mut prev = LUT.at(usize::from(input.at(start_pos & mask)? >> 6))? * 3;
        for pos in start_pos + 1..stride_end_pos {
            let kind = LUT.at(usize::from(input.at(pos & mask)? >> 6))?;
            *bigram_prefix_histo.at_mut(prev + kind)? += 1;
            prev = kind * 3;
        }
        start_pos += 4096;
    }
    Ok(choose_context_map(quality, &bigram_prefix_histo))
}

/// `false` for data with hardly any match and nearly 8 bits of entropy in a byte.
fn should_compress(
    data: &[u8],
    mask: usize,
    last_flush_pos: u64,
    bytes: usize,
    num_literals: usize,
    num_commands: usize,
) -> Checked<bool> {
    if bytes <= 2 {
        return Ok(false);
    }
    if num_commands < (bytes >> 8) + 2 && num_literals as f64 > 0.99 * bytes as f64 {
        const SAMPLE_RATE: u32 = 13;
        const INV_SAMPLE_RATE: f64 = 1.0 / 13.0;
        const MIN_ENTROPY: f64 = 7.92;
        let mut literal_histo = [0u32; 256];
        let bit_cost_threshold = bytes as f64 * MIN_ENTROPY * INV_SAMPLE_RATE;
        let t = bytes.div_ceil(SAMPLE_RATE as usize);
        let mut pos = last_flush_pos as u32;
        for _ in 0..t {
            *literal_histo.at_mut(usize::from(data.at(pos as usize & mask)?))? += 1;
            pos = pos.wrapping_add(SAMPLE_RATE);
        }
        if bits_entropy(&literal_histo) > bit_cost_threshold {
            return Ok(false);
        }
    }
    Ok(true)
}

/// The literal context mode of a meta-block. Only the highest qualities consider anything but UTF-8.
fn choose_context_mode(
    params: &EncoderParams,
    data: &[u8],
    pos: usize,
    mask: usize,
    length: usize,
) -> Checked<ContextType> {
    if params.quality >= MIN_QUALITY_FOR_HQ_BLOCK_SPLITTING
        && !is_mostly_utf8(data, pos, mask, length, MIN_UTF8_RATIO)?
    {
        return Ok(ContextType::Signed);
    }
    Ok(ContextType::Utf8)
}

/// Writes the `bytes` bytes from `last_flush_pos` on as a meta-block, after the up to 14 bits already in `bw`.
fn write_meta_block_internal(
    data: &[u8],
    mask: usize,
    last_flush_pos: u64,
    bytes: usize,
    is_last: bool,
    literal_context_mode: ContextType,
    params: &EncoderParams,
    prev_byte: u8,
    prev_byte2: u8,
    num_literals: usize,
    commands: &mut [Command],
    saved_dist_cache: &[i32; 4],
    dist_cache: &mut [i32; NUM_DISTANCE_SHORT_CODES as usize],
    bw: &mut BitWriter<'_>,
) -> Fallible {
    let wrapped_last_flush_pos = wrap_position(last_flush_pos) as usize;

    if bytes == 0 {
        // ISLAST and ISLASTEMPTY.
        bw.write_bits(2, 3)?;
        bw.jump_to_byte_boundary()?;
        return Ok(());
    }

    if !should_compress(
        data,
        mask,
        last_flush_pos,
        bytes,
        num_literals,
        commands.len(),
    )? {
        // What the search for matches did to the distance cache does not apply.
        dist_cache.write_at(0, saved_dist_cache)?;
        store_uncompressed_meta_block(is_last, data, wrapped_last_flush_pos, mask, bytes, bw)?;
        return Ok(());
    }

    debug_assert!(bw.pos() <= 14);
    let last_bytes: [u8; 2] = *bw.storage().array_at(0)?;
    let last_bytes_bits = bw.pos();
    if params.quality <= MAX_QUALITY_FOR_STATIC_ENTROPY_CODES {
        store_meta_block_fast(
            data,
            wrapped_last_flush_pos,
            bytes,
            mask,
            is_last,
            &params.dist,
            commands,
            bw,
        )?;
    } else if params.quality < MIN_QUALITY_FOR_BLOCK_SPLIT {
        store_meta_block_trivial(
            data,
            wrapped_last_flush_pos,
            bytes,
            mask,
            is_last,
            &params.dist,
            commands,
            bw,
        )?;
    } else {
        let mut mb = MetaBlockSplit::default();
        let mut block_dist = params.dist;
        if params.quality < MIN_QUALITY_FOR_HQ_BLOCK_SPLITTING {
            let (num_literal_contexts, literal_context_map) =
                if params.disable_literal_context_modeling {
                    (1, None)
                } else {
                    decide_over_literal_context_modeling(
                        data,
                        wrapped_last_flush_pos,
                        bytes,
                        mask,
                        params.quality,
                        params.size_hint,
                    )?
                };
            build_meta_block_greedy(
                data,
                wrapped_last_flush_pos,
                mask,
                prev_byte,
                prev_byte2,
                context_lut(literal_context_mode),
                num_literal_contexts,
                literal_context_map,
                commands,
                &mut mb,
            )?;
        } else {
            build_meta_block(
                data,
                wrapped_last_flush_pos,
                mask,
                params,
                &mut block_dist,
                prev_byte,
                prev_byte2,
                commands,
                literal_context_mode,
                &mut mb,
            )?;
        }
        if params.quality >= MIN_QUALITY_FOR_OPTIMIZE_HISTOGRAMS {
            // With a large window fewer distance symbols are in use than the alphabet has.
            optimize_histograms(block_dist.alphabet_size_limit, &mut mb)?;
        }
        store_meta_block(
            data,
            wrapped_last_flush_pos,
            bytes,
            mask,
            prev_byte,
            prev_byte2,
            is_last,
            &block_dist,
            literal_context_mode,
            commands,
            &mb,
            bw,
        )?;
    }
    if bytes + 4 < (bw.pos() >> 3) {
        // That was larger than the input. Start over.
        dist_cache.write_at(0, saved_dist_cache)?;
        bw.storage().write_at(0, &last_bytes)?;
        bw.rewind(last_bytes_bits)?;
        store_uncompressed_meta_block(is_last, data, wrapped_last_flush_pos, mask, bytes, bw)?;
    }
    Ok(())
}

fn choose_distance_params(params: &mut EncoderParams) {
    let mut distance_postfix_bits = 0;
    let mut num_direct_distance_codes = 0;

    if params.quality >= MIN_QUALITY_FOR_NONZERO_DISTANCE_PARAMS {
        if params.mode == EncoderMode::Font {
            distance_postfix_bits = 1;
            num_direct_distance_codes = 12;
        } else {
            distance_postfix_bits = params.dist.distance_postfix_bits;
            num_direct_distance_codes = params.dist.num_direct_distance_codes;
        }
        if distance_postfix_bits > MAX_NPOSTFIX
            || num_direct_distance_codes > MAX_NDIRECT
            || ((num_direct_distance_codes >> distance_postfix_bits) & 0x0F)
                << distance_postfix_bits
                != num_direct_distance_codes
        {
            distance_postfix_bits = 0;
            num_direct_distance_codes = 0;
        }
    }

    init_distance_params(
        &mut params.dist,
        distance_postfix_bits,
        num_direct_distance_codes,
        params.large_window,
    );
}

/// If the new input continues the copy of the last command, makes that copy longer. `bytes` is how much new input
/// there is, from `wrapped_last_processed_pos` on.
fn extend_last_command(
    last_command: &mut Command,
    data: &[u8],
    mask: u32,
    params: &EncoderParams,
    last_processed_pos: u64,
    last_distance: i32,
    bytes: &mut u32,
    wrapped_last_processed_pos: &mut u32,
) -> Checked {
    let max_backward_distance = (1u64 << params.lgwin) - WINDOW_GAP as u64;
    let last_copy_len = u64::from(last_command.copy_len());
    let last_processed_pos = last_processed_pos.wrapping_sub(last_copy_len);
    let max_distance = last_processed_pos.min(max_backward_distance);
    let cmd_dist = i64::from(last_distance) as u64;
    let distance_code = last_command.restore_distance_code(&params.dist);
    let dict = &params.dictionary;
    let compound_dictionary_size = dict.total_size as u64;
    if distance_code >= NUM_DISTANCE_SHORT_CODES
        && u64::from(distance_code - (NUM_DISTANCE_SHORT_CODES - 1)) != cmd_dist
    {
        return Ok(());
    }
    let at = |pos: u64| data.at((pos & u64::from(mask)) as usize);
    let bytes_before = *bytes;
    if cmd_dist <= max_distance {
        while *bytes != 0
            && at(u64::from(*wrapped_last_processed_pos))?
                == at(u64::from(*wrapped_last_processed_pos).wrapping_sub(cmd_dist))?
        {
            *bytes -= 1;
            *wrapped_last_processed_pos = wrapped_last_processed_pos.wrapping_add(1);
        }
    } else if cmd_dist - max_distance - 1 < compound_dictionary_size
        && last_copy_len < cmd_dist - max_distance
    {
        let address =
            (compound_dictionary_size - (cmd_dist - max_distance) + last_copy_len) as usize;
        let mut br_index = 0;
        while address >= dict.chunk_offsets.at(br_index + 1)? {
            br_index += 1;
        }
        let mut br_offset = address - dict.chunk_offsets.at(br_index)?;
        let mut chunk: &[u8] = &dict.chunks.get(br_index).ok_or(Bug)?.source;
        'extend: while *bytes != 0
            && at(u64::from(*wrapped_last_processed_pos))? == chunk.at(br_offset)?
        {
            *bytes -= 1;
            *wrapped_last_processed_pos = wrapped_last_processed_pos.wrapping_add(1);
            br_offset += 1;
            // A dictionary may be empty.
            while br_offset == chunk.len() {
                br_index += 1;
                br_offset = 0;
                match dict.chunks.get(br_index) {
                    Some(next) => chunk = &next.source,
                    None => break 'extend,
                }
            }
        }
    }
    last_command.lengthen_copy(bytes_before - *bytes);
    Ok(())
}

impl Default for Encoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Encoder {
    pub fn new() -> Self {
        let alphabet_size_max = distance_alphabet_size(0, 0, MAX_DISTANCE_BITS);
        let mut dist_cache = [0; NUM_DISTANCE_SHORT_CODES as usize];
        let saved_dist_cache = [4, 11, 15, 16];
        for (to, from) in dist_cache.iter_mut().zip(saved_dist_cache) {
            *to = from;
        }
        Self {
            params: EncoderParams {
                mode: EncoderMode::Generic,
                quality: DEFAULT_QUALITY,
                lgwin: DEFAULT_WINDOW,
                lgblock: 0,
                stream_offset: 0,
                size_hint: 0,
                disable_literal_context_modeling: false,
                large_window: false,
                hasher: HasherParams::default(),
                dist: DistanceParams {
                    distance_postfix_bits: 0,
                    num_direct_distance_codes: 0,
                    alphabet_size_max,
                    alphabet_size_limit: alphabet_size_max,
                    max_distance: MAX_DISTANCE,
                },
                dictionary: CompoundDictionary::default(),
            },
            input_pos: 0,
            ringbuffer: RingBuffer::default(),
            commands: Vec::new(),
            num_literals: 0,
            last_insert_len: 0,
            last_flush_pos: 0,
            last_processed_pos: 0,
            dist_cache,
            saved_dist_cache,
            last_bytes: 0,
            last_bytes_bits: 0,
            flint: FLINT_DONE,
            prev_byte: 0,
            prev_byte2: 0,
            storage: Vec::new(),
            hasher: Hasher::new(),
            table: Vec::new(),
            one_pass_arena: None,
            two_pass_arena: None,
            command_buf: Vec::new(),
            literal_buf: Vec::new(),
            next_out: NextOut::None,
            available_out: 0,
            tiny_buf: [0; 16],
            remaining_metadata_bytes: u32::MAX,
            stream_state: StreamState::Processing,
            is_last_block_emitted: false,
            is_initialized: false,
            is_broken: false,
        }
    }

    /// `BrotliEncoderSetParameter`. `false` if the value is not valid, or after the first [`Self::compress_stream`].
    /// Most values are not checked here but brought into range later.
    pub fn set_parameter(&mut self, parameter: EncoderParameter, value: u32) -> bool {
        if self.is_initialized || self.is_broken {
            return false;
        }
        let params = &mut self.params;
        match parameter {
            // Any other value has the effect of `Generic`.
            EncoderParameter::Mode => {
                params.mode = match value {
                    1 => EncoderMode::Text,
                    2 => EncoderMode::Font,
                    _ => EncoderMode::Generic,
                };
            }
            EncoderParameter::Quality => params.quality = value as i32,
            EncoderParameter::Lgwin => params.lgwin = value as i32,
            EncoderParameter::Lgblock => params.lgblock = value as i32,
            EncoderParameter::DisableLiteralContextModeling => {
                if value > 1 {
                    return false;
                }
                params.disable_literal_context_modeling = value != 0;
            }
            EncoderParameter::SizeHint => params.size_hint = value as usize,
            EncoderParameter::LargeWindow => params.large_window = value != 0,
            EncoderParameter::Npostfix => params.dist.distance_postfix_bits = value,
            EncoderParameter::Ndirect => params.dist.num_direct_distance_codes = value,
            EncoderParameter::StreamOffset => {
                if value > (1 << 30) {
                    return false;
                }
                params.stream_offset = value as usize;
            }
        }
        true
    }

    /// `BrotliEncoderAttachPreparedDictionary`. The decoder has to be given the same bytes. `false` if there are 15
    /// dictionaries already, or no memory.
    pub fn attach_prepared_dictionary(&mut self, dictionary: PreparedDictionary) -> bool {
        !self.is_broken && self.params.dictionary.attach(dictionary)
    }

    /// `BrotliEncoderIsFinished`.
    pub fn is_finished(&self) -> bool {
        self.stream_state == StreamState::Finished && !self.has_more_output()
    }

    /// `BrotliEncoderHasMoreOutput`.
    pub fn has_more_output(&self) -> bool {
        self.available_out != 0
    }

    fn input_block_size(&self) -> usize {
        1 << self.params.lgblock
    }

    fn unprocessed_input_size(&self) -> u64 {
        self.input_pos - self.last_processed_pos
    }

    fn remaining_input_block_size(&self) -> usize {
        let delta = self.unprocessed_input_size();
        let block_size = self.input_block_size();
        if delta >= block_size as u64 {
            return 0;
        }
        block_size - delta as usize
    }

    fn ensure_initialized(&mut self) -> Fallible {
        if self.is_initialized {
            return Ok(());
        }

        self.last_bytes_bits = 0;
        self.last_bytes = 0;
        self.flint = FLINT_DONE;
        self.remaining_metadata_bytes = u32::MAX;

        self.params.sanitize();
        self.params.lgblock = self.params.compute_lg_block();
        choose_distance_params(&mut self.params);

        if self.params.stream_offset != 0 {
            self.flint = FLINT_NEEDS_2_BYTES;
            // No distance derived from these is valid: -16 ± 3 is below 0.
            self.saved_dist_cache = [-16; 4];
            self.dist_cache.write_at(0, &self.saved_dist_cache)?;
        }

        self.ringbuffer.setup(&self.params);

        let mut lgwin = self.params.lgwin;
        if self.params.quality == FAST_ONE_PASS_COMPRESSION_QUALITY
            || self.params.quality == FAST_TWO_PASS_COMPRESSION_QUALITY
        {
            lgwin = lgwin.max(18);
        }
        if self.params.stream_offset == 0 {
            (self.last_bytes, self.last_bytes_bits) =
                encode_window_bits(lgwin, self.params.large_window);
        } else {
            // A larger value has the same effect.
            self.params.stream_offset = self
                .params
                .stream_offset
                .min(max_backward_limit(lgwin as u32));
        }

        if self.params.quality == FAST_ONE_PASS_COMPRESSION_QUALITY {
            let mut arena = OnePassArena::new()?;
            init_command_prefix_codes(&mut arena)?;
            self.one_pass_arena = Some(arena);
        } else if self.params.quality == FAST_TWO_PASS_COMPRESSION_QUALITY {
            self.two_pass_arena = Some(TwoPassArena::new()?);
        }

        self.is_initialized = true;
        Ok(())
    }

    /// Takes input without processing it. Between two calls of [`Self::encode_data`] this can take up to
    /// [`Self::input_block_size`] bytes.
    fn copy_input_to_ring_buffer(&mut self, input: &[u8]) -> Fallible {
        self.ringbuffer.write(input)?;
        self.input_pos += input.len() as u64;
        self.ringbuffer.clear_after_end()?;
        Ok(())
    }

    /// Marks all the input as processed. `true` if the wrapped position went back.
    fn update_last_processed_pos(&mut self) -> bool {
        let wrapped_last_processed_pos = wrap_position(self.last_processed_pos);
        let wrapped_input_pos = wrap_position(self.input_pos);
        self.last_processed_pos = self.input_pos;
        wrapped_input_pos < wrapped_last_processed_pos
    }

    /// Processes the input taken since the last call. That may complete a meta-block, which is then what
    /// `next_out` and `available_out` describe; it always does if `is_last` or `force_flush`. Otherwise
    /// `available_out` is 0. Up to 7 bits of the output are held back in `last_bytes` unless `is_last`.
    ///
    /// `false` after the last block, or if there is more input than a block.
    fn encode_data(&mut self, is_last: bool, force_flush: bool) -> Fallible<bool> {
        let delta = self.unprocessed_input_size();
        let mut bytes = delta as u32;
        let mut wrapped_last_processed_pos = wrap_position(self.last_processed_pos);
        let mask = self.ringbuffer.mask;

        if delta == 0 {
            if !self.ringbuffer.is_allocated() {
                // There was no input at all.
                if is_last {
                    debug_assert!(self.last_bytes_bits <= 14);
                    self.last_bytes |= (3u32 << self.last_bytes_bits) as u16;
                    self.last_bytes_bits += 2;
                    self.tiny_buf.write_at(0, &self.last_bytes.to_le_bytes())?;
                    self.next_out = NextOut::TinyBuf(0);
                    self.available_out = (usize::from(self.last_bytes_bits) + 7) >> 3;
                } else {
                    self.available_out = 0;
                }
                return Ok(true);
            }
            if !is_last && !force_flush {
                self.available_out = 0;
                return Ok(true);
            }
        }

        if self.is_last_block_emitted {
            return Ok(false);
        }
        if is_last {
            self.is_last_block_emitted = true;
        }
        if delta > self.input_block_size() as u64 {
            return Ok(false);
        }

        // There is at most one command for every 2 bytes. A bit more room than that saves a reallocation if the next
        // block is merged with this one.
        let newsize = self.commands.len() + bytes as usize / 2 + 1;
        if newsize > self.commands.capacity() {
            let newsize = newsize + bytes as usize / 4 + 16;
            self.commands
                .try_reserve_exact(newsize - self.commands.len())
                .map_err(|_| AllocError)?;
        }

        let data = self.ringbuffer.buffer();

        self.hasher.init_or_stitch_to_previous_block(
            data,
            mask as usize,
            &mut self.params,
            wrapped_last_processed_pos as usize,
            bytes as usize,
            is_last,
        )?;

        let literal_context_mode = choose_context_mode(
            &self.params,
            data,
            wrap_position(self.last_flush_pos) as usize,
            mask as usize,
            (self.input_pos - self.last_flush_pos) as usize,
        )?;
        let literal_context_lut = context_lut(literal_context_mode);

        if self.last_insert_len == 0
            && let Some(last_command) = self.commands.last_mut()
        {
            extend_last_command(
                last_command,
                data,
                mask,
                &self.params,
                self.last_processed_pos,
                self.dist_cache[0],
                &mut bytes,
                &mut wrapped_last_processed_pos,
            )?;
        }

        if self.params.quality == ZOPFLIFICATION_QUALITY {
            create_zopfli_backward_references(
                bytes as usize,
                wrapped_last_processed_pos as usize,
                data,
                mask as usize,
                literal_context_lut,
                &self.params,
                &mut self.hasher,
                &mut self.dist_cache,
                &mut self.last_insert_len,
                &mut self.commands,
                &mut self.num_literals,
            )?;
        } else if self.params.quality == HQ_ZOPFLIFICATION_QUALITY {
            create_hq_zopfli_backward_references(
                bytes as usize,
                wrapped_last_processed_pos as usize,
                data,
                mask as usize,
                literal_context_lut,
                &self.params,
                &mut self.hasher,
                &mut self.dist_cache,
                &mut self.last_insert_len,
                &mut self.commands,
                &mut self.num_literals,
            )?;
        } else {
            create_backward_references(
                bytes as usize,
                wrapped_last_processed_pos as usize,
                data,
                mask as usize,
                literal_context_lut,
                &self.params,
                &mut self.hasher,
                &mut self.dist_cache,
                &mut self.last_insert_len,
                &mut self.commands,
                &mut self.num_literals,
            )?;
        }

        {
            let max_length = self.params.max_meta_block_size();
            let max_literals = max_length / 8;
            let max_commands = max_length / 8;
            let processed_bytes = (self.input_pos - self.last_flush_pos) as usize;
            // Flush now if another block of the largest size would not fit in the meta-block.
            let next_input_fits_meta_block =
                processed_bytes + self.input_block_size() <= max_length;
            // Without block splitting there is nothing to gain from a long meta-block.
            let should_flush = self.params.quality < MIN_QUALITY_FOR_BLOCK_SPLIT
                && self.num_literals + self.commands.len() >= MAX_NUM_DELAYED_SYMBOLS;
            if !is_last
                && !force_flush
                && !should_flush
                && next_input_fits_meta_block
                && self.num_literals < max_literals
                && self.commands.len() < max_commands
            {
                // Merge with the next input block.
                if self.update_last_processed_pos() {
                    self.hasher.reset();
                }
                self.available_out = 0;
                return Ok(true);
            }
        }

        if self.last_insert_len > 0 {
            self.commands
                .push(Command::new_insert(self.last_insert_len));
            self.num_literals += self.last_insert_len;
            self.last_insert_len = 0;
        }

        if !is_last && self.input_pos == self.last_flush_pos {
            self.available_out = 0;
            return Ok(true);
        }
        debug_assert!(self.input_pos - self.last_flush_pos <= 1 << 24);

        let meta_block_size = (self.input_pos - self.last_flush_pos) as usize;
        let storage = get_storage(&mut self.storage, 2 * meta_block_size + 503)?;
        storage.write_at(0, &self.last_bytes.to_le_bytes())?;
        let mut bw = BitWriter::new(storage, usize::from(self.last_bytes_bits))?;
        write_meta_block_internal(
            self.ringbuffer.buffer(),
            mask as usize,
            self.last_flush_pos,
            meta_block_size,
            is_last,
            literal_context_mode,
            &self.params,
            self.prev_byte,
            self.prev_byte2,
            self.num_literals,
            &mut self.commands,
            &self.saved_dist_cache,
            &mut self.dist_cache,
            &mut bw,
        )?;
        let storage_ix = bw.pos();
        self.last_bytes = u16::from(self.storage.at(storage_ix >> 3)?);
        self.last_bytes_bits = (storage_ix & 7) as u8;
        self.last_flush_pos = self.input_pos;
        if self.update_last_processed_pos() {
            self.hasher.reset();
        }
        let data = self.ringbuffer.buffer();
        if self.last_flush_pos > 0 {
            self.prev_byte =
                data.at(((self.last_flush_pos as u32).wrapping_sub(1) & mask) as usize)?;
        }
        if self.last_flush_pos > 1 {
            self.prev_byte2 =
                data.at(((self.last_flush_pos as u32).wrapping_sub(2) & mask) as usize)?;
        }
        self.commands.clear();
        self.num_literals = 0;
        self.saved_dist_cache = *self.dist_cache.array_at(0)?;
        self.next_out = NextOut::Storage(0);
        self.available_out = storage_ix >> 3;
        Ok(true)
    }

    /// Writes the pending bits and the header of a metadata block of `block_size` bytes, at most `1 << 24`, to
    /// `tiny_buf`. Returns how many bytes that is.
    fn write_metadata_header(&mut self, block_size: usize) -> Checked<usize> {
        self.tiny_buf.write_at(0, &self.last_bytes.to_le_bytes())?;
        let mut bw = BitWriter::new(&mut self.tiny_buf, usize::from(self.last_bytes_bits))?;
        self.last_bytes = 0;
        self.last_bytes_bits = 0;

        // ISLAST, MNIBBLES, reserved.
        bw.write_bits(1, 0)?;
        bw.write_bits(2, 3)?;
        bw.write_bits(1, 0)?;
        if block_size == 0 {
            bw.write_bits(2, 0)?;
        } else {
            let nbits = if block_size == 1 {
                1
            } else {
                log2_floor_nonzero(block_size - 1) as usize + 1
            };
            let nbytes = nbits.div_ceil(8);
            bw.write_bits(2, nbytes as u64)?;
            bw.write_bits(8 * nbytes, block_size as u64 - 1)?;
        }
        Ok((bw.pos() + 7) >> 3)
    }

    /// Completes the last byte of the output with an empty metadata block.
    fn inject_byte_padding_block(&mut self) -> Checked {
        let mut seal = u32::from(self.last_bytes);
        let mut seal_bits = usize::from(self.last_bytes_bits);
        self.last_bytes = 0;
        self.last_bytes_bits = 0;
        // ISLAST = 0, MNIBBLES = 11, reserved = 0, MSKIPBYTES = 00.
        seal |= 0x6 << seal_bits;
        seal_bits += 6;
        // It goes after the output that is pending, if any.
        let (buffer, start): (&mut [u8], usize) = match self.next_out {
            NextOut::Storage(start) => (&mut self.storage, start),
            NextOut::TinyBuf(start) => (&mut self.tiny_buf, start),
            NextOut::None => {
                self.next_out = NextOut::TinyBuf(0);
                (&mut self.tiny_buf, 0)
            }
        };
        let seal_bytes = (seal_bits + 7) >> 3;
        buffer.write_at(
            start + self.available_out,
            seal.to_le_bytes().sub(..seal_bytes)?,
        )?;
        self.available_out += seal_bytes;
        Ok(())
    }

    /// Adds the padding that a flush asks for, or else hands over output. `false` if there was nothing to do.
    fn inject_flush_or_push_output(&mut self, output: &mut dyn Output) -> Checked<bool> {
        if self.stream_state == StreamState::FlushRequested && self.last_bytes_bits != 0 {
            self.inject_byte_padding_block()?;
            return Ok(true);
        }

        let copy_output_size = self.available_out.min(output.available());
        if copy_output_size != 0 {
            let (buffer, start): (&[u8], &mut usize) = match &mut self.next_out {
                NextOut::Storage(start) => (&self.storage, start),
                NextOut::TinyBuf(start) => (&self.tiny_buf, start),
                NextOut::None => return Err(Bug),
            };
            output.write(buffer.sub(*start..*start + copy_output_size)?);
            *start += copy_output_size;
            self.available_out -= copy_output_size;
            return Ok(true);
        }

        Ok(false)
    }

    fn check_flush_complete(&mut self) {
        if self.stream_state == StreamState::FlushRequested && self.available_out == 0 {
            self.stream_state = StreamState::Processing;
            self.next_out = NextOut::None;
        }
    }

    /// [`Self::compress_stream`] for qualities 0 and 1, which compress the input where it is, each call on its own.
    fn compress_stream_fast(
        &mut self,
        op: EncoderOperation,
        input: &mut &[u8],
        output: &mut dyn Output,
    ) -> Fallible<bool> {
        let block_size_limit = 1usize << self.params.lgwin;
        if self.params.quality == FAST_TWO_PASS_COMPRESSION_QUALITY {
            let buf_size = COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE
                .min(input.len())
                .min(block_size_limit);
            if self.command_buf.len() < buf_size {
                let command_buf = try_zeroed(buf_size)?;
                self.literal_buf = try_zeroed(buf_size)?;
                self.command_buf = command_buf;
            }
        }

        loop {
            if self.inject_flush_or_push_output(output)? {
                continue;
            }

            // Compress a block only when all the output was handed over, the stream is not finished, no flush is
            // pending, and there is input or something else to do.
            if self.available_out != 0
                || self.stream_state != StreamState::Processing
                || (input.is_empty() && op == EncoderOperation::Process)
            {
                break;
            }
            let block_size = block_size_limit.min(input.len());
            let is_last = input.len() == block_size && op == EncoderOperation::Finish;
            let force_flush = input.len() == block_size && op == EncoderOperation::Flush;
            let max_out_size = 2 * block_size + 503;

            if force_flush && block_size == 0 {
                self.stream_state = StreamState::FlushRequested;
                continue;
            }
            let storage = get_storage(&mut self.storage, max_out_size)?;
            storage.write_at(0, &self.last_bytes.to_le_bytes())?;
            let mut bw = BitWriter::new(storage, usize::from(self.last_bytes_bits))?;
            let table = get_hash_table(&mut self.table, self.params.quality, block_size)?;
            let (block, rest) = input.split_at_checked(block_size).ok_or(Bug)?;

            if let Some(arena) = &mut self.one_pass_arena {
                compress_fragment_fast(arena, block, is_last, table, &mut bw)?;
            } else if let Some(arena) = &mut self.two_pass_arena {
                compress_fragment_two_pass(
                    arena,
                    block,
                    is_last,
                    &mut self.command_buf,
                    &mut self.literal_buf,
                    table,
                    &mut bw,
                )?;
            } else {
                return Err(Bug.into());
            }
            *input = rest;
            let storage_ix = bw.pos();
            self.next_out = NextOut::Storage(0);
            self.available_out = storage_ix >> 3;
            self.last_bytes = u16::from(self.storage.at(storage_ix >> 3)?);
            self.last_bytes_bits = (storage_ix & 7) as u8;

            if force_flush {
                self.stream_state = StreamState::FlushRequested;
            }
            if is_last {
                self.stream_state = StreamState::Finished;
            }
        }
        self.check_flush_complete();
        Ok(true)
    }

    fn process_metadata(&mut self, input: &mut &[u8], output: &mut dyn Output) -> Fallible<bool> {
        if input.len() > (1 << 24) {
            return Ok(false);
        }
        if self.stream_state == StreamState::Processing {
            self.remaining_metadata_bytes = input.len() as u32;
            self.stream_state = StreamState::MetadataHead;
        }
        if self.stream_state != StreamState::MetadataHead
            && self.stream_state != StreamState::MetadataBody
        {
            return Ok(false);
        }

        loop {
            if self.inject_flush_or_push_output(output)? {
                continue;
            }
            if self.available_out != 0 {
                break;
            }

            if self.input_pos != self.last_flush_pos {
                let (is_last, force_flush) = (false, true);
                if !self.encode_data(is_last, force_flush)? {
                    return Ok(false);
                }
                continue;
            }

            if self.stream_state == StreamState::MetadataHead {
                self.next_out = NextOut::TinyBuf(0);
                self.available_out =
                    self.write_metadata_header(self.remaining_metadata_bytes as usize)?;
                self.stream_state = StreamState::MetadataBody;
                continue;
            }
            // Only leave this state when there is neither input nor output left.
            if self.remaining_metadata_bytes == 0 {
                self.remaining_metadata_bytes = u32::MAX;
                self.stream_state = StreamState::Processing;
                break;
            }
            let available = output.available();
            let copy = if available != 0 {
                (self.remaining_metadata_bytes as usize).min(available)
            } else {
                // So that there is progress even without room for output.
                (self.remaining_metadata_bytes as usize).min(self.tiny_buf.len())
            };
            let (body, rest) = input.split_at_checked(copy).ok_or(Bug)?;
            if available != 0 {
                output.write(body);
            } else {
                self.next_out = NextOut::TinyBuf(0);
                self.tiny_buf.write_at(0, body)?;
                self.available_out = copy;
            }
            *input = rest;
            self.remaining_metadata_bytes -= copy as u32;
        }

        Ok(true)
    }

    /// Without [`EncoderParameter::SizeHint`], what is known of the input by the time of the first block has to do.
    fn update_size_hint(&mut self, available_in: usize) {
        if self.params.size_hint == 0 {
            let delta = self.unprocessed_input_size();
            let tail = available_in as u64;
            let limit = 1u64 << 30;
            let total = if delta >= limit || tail >= limit {
                limit
            } else {
                (delta + tail).min(limit)
            };
            self.params.size_hint = total as usize;
        }
    }

    /// `BrotliEncoderCompressStream`. Takes bytes off the front of `input` and appends to `output`. All the input was
    /// taken and `op` was carried out once `input` is empty and [`Self::has_more_output`] is `false`; until then, call
    /// again with the same `op` and the rest of the input.
    ///
    /// `false` for a call that is out of order, like input after [`EncoderOperation::Finish`], or if memory ran out.
    pub fn compress_stream(
        &mut self,
        op: EncoderOperation,
        input: &mut &[u8],
        output: &mut dyn Output,
    ) -> bool {
        if self.is_broken {
            return false;
        }
        match self.compress_stream_internal(op, input, output) {
            Ok(result) => result,
            Err(_) => {
                self.is_broken = true;
                false
            }
        }
    }

    fn compress_stream_internal(
        &mut self,
        op: EncoderOperation,
        input: &mut &[u8],
        output: &mut dyn Output,
    ) -> Fallible<bool> {
        self.ensure_initialized()?;

        // A metadata block that was started has to be completed.
        if self.remaining_metadata_bytes != u32::MAX
            && (input.len() != self.remaining_metadata_bytes as usize
                || op != EncoderOperation::EmitMetadata)
        {
            return Ok(false);
        }

        if op == EncoderOperation::EmitMetadata {
            // The first meta-block with data may be written here.
            self.update_size_hint(0);
            return self.process_metadata(input, output);
        }

        if self.stream_state == StreamState::MetadataHead
            || self.stream_state == StreamState::MetadataBody
        {
            return Ok(false);
        }

        if self.stream_state != StreamState::Processing && !input.is_empty() {
            return Ok(false);
        }
        if self.params.quality == FAST_ONE_PASS_COMPRESSION_QUALITY
            || self.params.quality == FAST_TWO_PASS_COMPRESSION_QUALITY
        {
            return self.compress_stream_fast(op, input, output);
        }
        loop {
            let mut remaining_block_size = self.remaining_input_block_size();
            if self.flint >= 0 && remaining_block_size > self.flint as usize {
                remaining_block_size = self.flint as usize;
            }

            if remaining_block_size != 0 && !input.is_empty() {
                let copy_input_size = remaining_block_size.min(input.len());
                let (block, rest) = input.split_at_checked(copy_input_size).ok_or(Bug)?;
                self.copy_input_to_ring_buffer(block)?;
                *input = rest;
                if self.flint > 0 {
                    self.flint -= copy_input_size as i8;
                }
                continue;
            }

            if self.inject_flush_or_push_output(output)? {
                if self.flint == FLINT_WAITING_FOR_FLUSHING {
                    self.check_flush_complete();
                    if self.stream_state == StreamState::Processing {
                        self.flint = FLINT_DONE;
                    }
                }
                continue;
            }

            // Compress only when all the output was handed over, the stream is not finished and no flush is pending.
            if self.available_out == 0
                && self.stream_state == StreamState::Processing
                && (remaining_block_size == 0 || op != EncoderOperation::Process)
            {
                let is_last = input.is_empty() && op == EncoderOperation::Finish;
                let mut force_flush = input.is_empty() && op == EncoderOperation::Flush;
                // The flint gets a block of its own.
                if !is_last && self.flint == FLINT_WAITING_FOR_PROCESSING {
                    self.flint = FLINT_WAITING_FOR_FLUSHING;
                    force_flush = true;
                }
                self.update_size_hint(input.len());
                if !self.encode_data(is_last, force_flush)? {
                    return Ok(false);
                }
                if force_flush {
                    self.stream_state = StreamState::FlushRequested;
                }
                if is_last {
                    self.stream_state = StreamState::Finished;
                }
                continue;
            }
            break;
        }
        self.check_flush_complete();
        Ok(true)
    }
}

/// `BrotliEncoderMaxCompressedSize`: an upper bound for what [`compress`] writes, or 0 if that overflows.
pub fn max_compressed_size(input_size: usize) -> usize {
    // [window bits / empty metadata] + N * [uncompressed] + [last empty]
    let num_large_blocks = input_size >> 14;
    let overhead = 2 + (4 * num_large_blocks) + 3 + 1;
    if input_size == 0 {
        return 2;
    }
    input_size.checked_add(overhead).unwrap_or(0)
}

/// Writes `input`, which is not empty, as a stream of uncompressed meta-blocks with the smallest window. That takes at most
/// [`max_compressed_size`].
fn make_uncompressed_stream(input: &[u8], output: &mut dyn Output) {
    // Window bits = 10, ISLAST = 0. Then an empty metadata block as padding.
    output.write(&[0x21, 0x03]);
    for chunk in input.chunks(1 << 24) {
        let chunk_size = chunk.len() as u32;
        let nibbles: u32 = if chunk_size > (1 << 20) {
            2
        } else if chunk_size > (1 << 16) {
            1
        } else {
            0
        };
        let bits = (nibbles << 1) | ((chunk_size - 1) << 3) | (1 << (19 + 4 * nibbles));
        let [b0, b1, b2, b3] = bits.to_le_bytes();
        output.write(&[b0, b1, b2]);
        if nibbles == 2 {
            output.write(&[b3]);
        }
        output.write(chunk);
    }
    output.write(&[3]);
}

/// Whether all of `input` was compressed to `output`.
fn compress_all(
    quality: i32,
    lgwin: i32,
    mode: EncoderMode,
    mut input: &[u8],
    output: &mut dyn Output,
) -> bool {
    let mut s = Encoder::new();
    s.set_parameter(EncoderParameter::Quality, quality as u32);
    s.set_parameter(EncoderParameter::Lgwin, lgwin as u32);
    s.set_parameter(EncoderParameter::Mode, mode as u32);
    s.set_parameter(EncoderParameter::SizeHint, input.len() as u32);
    if lgwin > MAX_WINDOW_BITS {
        s.set_parameter(EncoderParameter::LargeWindow, 1);
    }
    s.compress_stream(EncoderOperation::Finish, &mut input, output) && s.is_finished()
}

/// `BrotliEncoderCompress`. Returns how much of `output` was written, or `None` if it is too small, which it is not
/// with [`max_compressed_size`] bytes.
pub fn compress(
    quality: i32,
    lgwin: i32,
    mode: EncoderMode,
    input: &[u8],
    output: &mut [u8],
) -> Option<usize> {
    let out_size = output.len();
    if input.is_empty() {
        *output.first_mut()? = 6;
        return Some(1);
    }
    if out_size == 0 {
        return None;
    }
    let max_out_size = max_compressed_size(input.len());
    let mut rest = &mut *output;
    if compress_all(quality, lgwin, mode, input, &mut rest) {
        let encoded_size = out_size - rest.len();
        if max_out_size == 0 || encoded_size <= max_out_size {
            return Some(encoded_size);
        }
    }
    if max_out_size == 0 || out_size < max_out_size {
        return None;
    }
    let mut rest = &mut *output;
    make_uncompressed_stream(input, &mut rest);
    Some(out_size - rest.len())
}

/// [`compress`] into the spare capacity of `output`, which is not reallocated. Returns how much was appended.
pub fn compress_append(
    quality: i32,
    lgwin: i32,
    mode: EncoderMode,
    input: &[u8],
    output: &mut Vec<u8>,
) -> Option<usize> {
    let start = output.len();
    let out_size = output.capacity() - start;
    if out_size == 0 {
        return None;
    }
    if input.is_empty() {
        output.push(6);
        return Some(1);
    }
    let max_out_size = max_compressed_size(input.len());
    if compress_all(
        quality,
        lgwin,
        mode,
        input,
        &mut SpareCapacity::new(output, usize::MAX),
    ) {
        let encoded_size = output.len() - start;
        if max_out_size == 0 || encoded_size <= max_out_size {
            return Some(encoded_size);
        }
    }
    output.truncate(start);
    if max_out_size == 0 || out_size < max_out_size {
        return None;
    }
    make_uncompressed_stream(input, &mut SpareCapacity::new(output, usize::MAX));
    Some(output.len() - start)
}
