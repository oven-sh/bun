//! Decompresses a whole stream at once.

use crate::bit_reader::{BITS_IN_REFILL, Bits, Input, LOOKAHEAD};
use crate::decode_tables::{
    DynamicTables, END, EXCEPTIONAL, LITERAL, LITLEN_BITS, OFFSET_BITS, STATIC_TABLES, SUBTABLE,
    Tables, check_end, value,
};
use crate::format::{DYNAMIC, MAX_CODEWORD_LEN, MAX_MATCH_LEN, STATIC, STORED};
use crate::output::{MAX_STEP, Output, Sink};
use crate::{Error, Result, chunk_at, gzip, wrapped};
use bun_highway::with_bmi2;
use core::cell::Cell;
use core::hint::{Locality, cold_path, prefetch_write};

const CHUNK: usize = 16;
const MAX_COPY_STEP: usize = 4 * CHUNK;
/// What copying a match may write: a step can start at its last byte.
const MATCH_ROOM: usize = MAX_MATCH_LEN + MAX_COPY_STEP;
/// What a turn of the fast loop may write.
const FAST_ROOM: usize = 1 + MATCH_ROOM;
/// What a turn of the fast loop may consume before it refills: a literal, a length and an offset.
const FAST_BITS: u32 = LITLEN_BITS + (MAX_CODEWORD_LEN + 5) + (OFFSET_BITS + 13);
const _: () = assert!(FAST_BITS <= BITS_IN_REFILL && FAST_BITS + LITLEN_BITS <= u64::BITS);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decompressed {
    /// What follows the end of the stream is left alone.
    pub read: usize,
    pub written: usize,
}

/// A raw DEFLATE stream.
pub fn inflate(input: &[u8], output: Output<'_>) -> Result<Decompressed> {
    with_sink(input, output, |sink| decode_blocks(input, sink, false))
}

/// A raw stream that may also end where the length of a stored block would start, like a WebSocket message (RFC 7692 7.2.1).
pub fn inflate_message(input: &[u8], output: Output<'_>) -> Result<Decompressed> {
    with_sink(input, output, |sink| decode_blocks(input, sink, true))
}

/// The first member of a gzip file.
pub fn gunzip(input: &[u8], output: Output<'_>) -> Result<Decompressed> {
    with_sink(input, output, |sink| {
        let before_trailer = input.len().saturating_sub(gzip::TRAILER_LEN);
        let stream = gzip::skip_header(input.split_at(before_trailer).0)?;
        let Decompressed { read, written } = decode_blocks(stream, sink, false)?;
        let end = before_trailer - stream.len() + read;
        let data = sink.bytes().get(..written).unwrap_or_default();
        match chunk_at(input, end) == Some(&gzip::trailer(data)) {
            true => Ok(Decompressed {
                read: end + gzip::TRAILER_LEN,
                written,
            }),
            false => Err(Error::BadData),
        }
    })
}

#[inline(always)]
fn with_sink(
    input: &[u8],
    output: Output<'_>,
    decode: impl FnOnce(&mut Sink<'_>) -> Result<Decompressed>,
) -> Result<Decompressed> {
    let mut sink = Sink::new(output, input.len().saturating_mul(4).saturating_add(512));
    let result = decode(&mut sink);
    sink.finish(result.map_or(0, |result| result.written));
    result
}

with_bmi2! {
    fn decode_blocks(input: &[u8], sink: &mut Sink<'_>, is_message: bool) -> Result<Decompressed> {
        let input = Input::new(input);
        let (mut bits, mut written) = (Bits::default(), 0);
        let mut dynamic = None;
        loop {
            bits.refill(&input)?;
            let is_final = bits.buffer & 1 != 0;
            match (bits.buffer >> 1) as u32 % 4 {
                STORED => {
                    bits.consume(3);
                    let read = bits.byte_position();
                    let rest = input.bytes_from(read)?;
                    if is_message && rest.is_empty() {
                        return Ok(Decompressed { read, written });
                    }
                    let len = copy_stored(rest, sink, written)?;
                    written += len;
                    bits = Bits::at(read + 4 + len);
                }
                STATIC => {
                    bits.consume(3);
                    // These tend to be too short for a call.
                    let inlined = #[inline(always)]
                    |tables: &_, input: &_, bits: &mut _, output: &mut _, position: &mut _| {
                        decode_fast(tables, input, bits, output, position)
                    };
                    decode_block(&STATIC_TABLES, inlined, &input, &mut bits, sink, &mut written)?;
                }
                DYNAMIC => {
                    let tables = dynamic.get_or_insert_with(DynamicTables::new);
                    bits = tables.read_header(bits, &input)?;
                    decode_block(tables, decode_dynamic, &input, &mut bits, sink, &mut written)?;
                }
                _ => return Err(Error::BadData),
            }
            if is_final {
                let read = bits.byte_position();
                input.bytes_from(read)?;
                return Ok(Decompressed { read, written });
            }
        }
    }
}

#[inline(always)]
fn copy_stored(input: &[u8], sink: &mut Sink<'_>, written: usize) -> Result<usize> {
    let Some((&[len0, len1, check0, check1], input)) = input.split_first_chunk() else {
        return Err(Error::BadData);
    };
    if [len0, len1] != [!check0, !check1] {
        return Err(Error::BadData);
    }
    let len = usize::from(u16::from_le_bytes([len0, len1]));
    match input.get(..len).ok_or(Error::BadData)? {
        [] => {}
        bytes => sink.write(written, bytes)?,
    }
    Ok(len)
}

#[inline(always)]
fn decode_block<const N: usize>(
    tables: &Tables<N>,
    fast_loop: impl Fn(&Tables<N>, &[u8], &mut Bits, &mut [u8], &mut usize) -> Result<bool>,
    input: &Input<'_>,
    bits: &mut Bits,
    sink: &mut Sink<'_>,
    written: &mut usize,
) -> Result<()> {
    loop {
        let is_at_capacity = sink.is_at_capacity();
        let output = sink.bytes();
        while output.len() - *written >= FAST_ROOM {
            bits.refill(input)?;
            let (window, window_start) = input.window(bits.next);
            bits.next -= window_start;
            // Copies, because what a call borrows does not stay in registers.
            let (mut new_bits, mut position) = (*bits, *written);
            let has_ended = fast_loop(tables, window, &mut new_bits, output, &mut position);
            (*bits, *written) = (new_bits, position);
            bits.next += window_start;
            if has_ended? {
                return Ok(());
            }
        }
        let needed_len = match is_at_capacity {
            true => match decode_carefully(tables, input, bits, output, written)? {
                Some(len) => len,
                None => return Ok(()),
            },
            false => output.len(),
        };
        sink.extend(needed_len)?;
    }
}

with_bmi2! {
    /// In a function of its own, the loop has all registers to itself.
    fn decode_dynamic(
        tables: &DynamicTables,
        input: &[u8],
        state: &mut Bits,
        output: &mut [u8],
        written: &mut usize,
    ) -> Result<bool> {
        let (mut bits, mut position) = (*state, *written);
        let has_ended = decode_fast(tables, input, &mut bits, output, &mut position);
        (*state, *written) = (bits, position);
        has_ended
    }
}

/// Returns how long `output` has to be to go on, unless the block ended.
#[inline(always)]
fn decode_carefully<const N: usize>(
    tables: &Tables<N>,
    input: &Input<'_>,
    bits: &mut Bits,
    output: &mut [u8],
    position: &mut usize,
) -> Result<Option<usize>> {
    loop {
        bits.refill(input)?;
        let resume_at = *bits;
        let mut entry = tables.litlen_entry(bits.buffer);
        let mut buffer = bits.consume(entry);
        if entry & SUBTABLE != 0 {
            entry = tables.subtable_entry(entry, bits.buffer);
            buffer = bits.consume(entry);
        }
        if entry & LITERAL != 0 {
            let Some(to) = output.get_mut(*position) else {
                *bits = resume_at;
                return Ok(Some(*position + 1));
            };
            *to = (entry >> 16) as u8;
            *position += 1;
            continue;
        }
        if entry & END != 0 {
            return check_end(entry).map(|()| None);
        }
        let end = *position + value(entry, buffer);
        if end > output.len() {
            *bits = resume_at;
            return Ok(Some(end));
        }
        let mut entry = tables.offset_entry(bits.buffer);
        if entry & END != 0 {
            return Err(Error::BadData);
        }
        if entry & SUBTABLE != 0 {
            bits.consume(OFFSET_BITS);
            entry = tables.subtable_entry(entry, bits.buffer);
        }
        let offset = value(entry, bits.consume(entry));
        let from = position.checked_sub(offset).ok_or(Error::BadData)?;
        let cells = Cell::from_mut(&mut *output).as_slice_of_cells();
        let after = |start| cells.get(start..end).unwrap_or_default();
        for (to, from) in after(*position).iter().zip(after(from)) {
            to.set(from.get());
        }
        *position = end;
    }
}

/// Returns whether the block ended. If not, `input` or `output` is near its end. `bits` is refilled, before and after.
#[inline(always)]
fn decode_fast<const N: usize>(
    tables: &Tables<N>,
    input: &[u8],
    bits: &mut Bits,
    output: &mut [u8],
    position: &mut usize,
) -> Result<bool> {
    #[inline(always)]
    fn word_at(ahead: &[u8; LOOKAHEAD], at: usize) -> [u8; 8] {
        chunk_at(ahead, at).copied().unwrap_or_default()
    }

    // Never true, but it spares an overflow check in the loop.
    if output.len() < FAST_ROOM {
        return Ok(false);
    }
    // Cells, because a match may overlap what it copies.
    let output = Cell::from_mut(output).as_slice_of_cells();
    let mut entry = tables.litlen_entry(bits.buffer);
    let mut rest = input.get(bits.next..).unwrap_or_default().iter();
    let mut ended = Ok(false);
    while let Some(ahead) = rest.as_slice().first_chunk()
        && let Some(room) = chunk_at::<_, FAST_ROOM>(output, *position)
    {
        // Looks up both ways to go on ahead of the branch, to hide it in a misprediction. The store keeps the loads from sinking.
        let mut buffer = bits.consume(entry);
        let after_literal_entry = tables.litlen_entry(bits.buffer);
        let mut offset_entry = tables.offset_entry(bits.buffer);
        let after_match =
            |buffer: u64, offset_entry: u32| tables.litlen_entry(buffer.wrapping_shr(offset_entry));
        room[0].set((entry >> 16) as u8);
        let [to @ .., _] = room;
        let mut to = to;
        if entry & LITERAL != 0 {
            let [_, after_literal @ ..] = room;
            to = after_literal;
            entry = after_literal_entry;
            buffer = bits.consume(entry);
            let after_literal_entry = tables.litlen_entry(bits.buffer);
            offset_entry = tables.offset_entry(bits.buffer);
            room[1].set((entry >> 16) as u8);
            *position += 1;
            if entry & LITERAL != 0 {
                entry = after_literal_entry;
                *position += 1;
                _ = rest.advance_by(bits.refill_with(word_at(ahead, 0)));
                continue;
            }
        }
        let mut after_match_entry = after_match(bits.buffer, offset_entry);
        // Also keeps that load where it is.
        prefetch_next_step(to, 0);

        if entry & EXCEPTIONAL != 0 {
            cold_path();
            if entry & END != 0 {
                ended = check_end(entry).map(|()| true);
                break;
            }
            entry = tables.subtable_entry(entry, bits.buffer);
            buffer = bits.consume(entry);
            if entry & LITERAL != 0 {
                to[0].set((entry >> 16) as u8);
                entry = tables.litlen_entry(bits.buffer);
                *position += 1;
                _ = rest.advance_by(bits.refill_with(word_at(ahead, 0)));
                continue;
            }
            if entry & END != 0 {
                ended = check_end(entry).map(|()| true);
                break;
            }
            offset_entry = tables.offset_entry(bits.buffer);
            after_match_entry = after_match(bits.buffer, offset_entry);
        }

        let (start, len) = (*position, value(entry, buffer));
        *position += len;
        entry = offset_entry;
        let offset;
        if entry & EXCEPTIONAL != 0 {
            cold_path();
            if entry & END != 0 {
                ended = Err(Error::BadData);
                break;
            }
            let skip = bits.refill_with(word_at(ahead, 0));
            bits.consume(OFFSET_BITS);
            entry = tables.subtable_entry(entry, bits.buffer);
            offset = value(entry, bits.consume(entry));
            _ = rest.advance_by(skip + bits.refill_with(word_at(ahead, skip)));
            entry = tables.litlen_entry(bits.buffer);
        } else {
            offset = value(entry, bits.consume(entry));
            _ = rest.advance_by(bits.refill_with(word_at(ahead, 0)));
            entry = after_match_entry;
        }
        // One comparison: what is before the start of `output` wraps around.
        let from = chunk_at::<_, FAST_ROOM>(output, start.wrapping_sub(offset));
        let Some([from @ .., _]) = from else {
            cold_path();
            ended = Err(Error::BadData);
            break;
        };
        if offset < len {
            if offset == 1 {
                // Multiplied, the compiler does not see that it could call `memset`.
                fill(to, u64::from(from[0].get()) * (u64::MAX / 0xFF), len);
                continue;
            }
            copy_overlapping(from, to, offset, len);
            // Again, so that it is not live across the call.
            entry = tables.litlen_entry(bits.buffer);
            continue;
        }
        copy_match(from, to, len);
    }
    bits.next = input.len() - rest.len();
    ended
}

type MatchRoom = [Cell<u8>; MATCH_ROOM];

#[inline(always)]
fn load<const N: usize>(cells: &MatchRoom, at: usize) -> [u8; N] {
    chunk_at(cells, at).map_or([0; N], |chunk: &[_; N]| chunk.each_ref().map(Cell::get))
}

#[inline(always)]
fn store<const N: usize>(cells: &[Cell<u8>], at: usize, bytes: [u8; N]) {
    if let Some(chunk) = chunk_at::<_, N>(cells, at) {
        chunk.iter().zip(bytes).for_each(|(to, byte)| to.set(byte));
    }
}

/// So that [`Sink::extend`] does not wait for memory.
#[inline(always)]
fn prefetch_next_step(cells: &MatchRoom, at: usize) {
    prefetch_write(cells[0].as_ptr().wrapping_add(at + MAX_STEP), Locality::L1);
}

#[inline(always)]
fn copy_match(from: &MatchRoom, to: &MatchRoom, len: usize) {
    const AT_ONCE: usize = 3 * CHUNK;
    store(to, 0, load::<AT_ONCE>(from, 0));
    if len > AT_ONCE {
        let (mut done, len) = (AT_ONCE, len.min(MAX_MATCH_LEN));
        while done < len {
            prefetch_next_step(to, done);
            store(to, done, load::<{ 2 * CHUNK }>(from, done));
            done += 2 * CHUNK;
        }
    }
}

/// The longer a step, the easier it is to predict how many there are.
#[inline(always)]
fn in_steps(
    to: &MatchRoom,
    len: usize,
    step_len: usize,
    mut write: impl FnMut(&[Cell<u8>; MAX_COPY_STEP]),
) {
    let mut done = 0;
    while done < len.min(MAX_MATCH_LEN)
        && let Some(step) = chunk_at(to, done)
    {
        write(step);
        done += step_len;
    }
}

#[inline(always)]
fn fill(to: &MatchRoom, word: u64, len: usize) {
    in_steps(to, len, MAX_COPY_STEP, |step| {
        (0..MAX_COPY_STEP / 8).for_each(|index| store(step, 8 * index, word.to_le_bytes()));
    });
}

/// A load has to wait for the stores that it overlaps, so this does not go on reading what it just wrote.
#[cold]
#[inline(never)]
fn copy_overlapping(from: &MatchRoom, to: &MatchRoom, offset: usize, len: usize) {
    /// For each offset less 1, the factor that repeats the low `offset` bytes of a word.
    static REPEATERS: [u64; 8] = table!(|index| {
        let offset = index + 1;
        ((u128::MAX / ((1 << (8 * offset)) - 1)) >> (8 * (16 % offset))) as u64
    });
    static PERIODS: [u8; 8] = table!(|index| (8 - 8 % (index + 1)) as u8);

    /// `ends` are the first and the last `N` bytes of a period, which cover it.
    #[inline(always)]
    fn repeat<const N: usize>(to: &MatchRoom, ends: [[u8; N]; 2], period: usize, len: usize) {
        let periods = MAX_COPY_STEP / (2 * N);
        in_steps(to, len, periods * period, |step| {
            for index in 0..periods {
                store(step, index * period, ends[0]);
                store(step, (index + 1) * period - N, ends[1]);
            }
        });
    }
    #[inline(always)]
    fn ends<const N: usize>(from: &MatchRoom, offset: usize) -> [[u8; N]; 2] {
        [load(from, 0), load(from, offset - N)]
    }

    match offset {
        ..=8 => {
            let unit =
                u64::from_le_bytes(load(from, 0)) & u64::MAX.wrapping_shr(64 - 8 * offset as u32);
            let word = unit.wrapping_mul(*wrapped(&REPEATERS, offset + 7));
            match usize::from(*wrapped(&PERIODS, offset + 7)) {
                period @ ..8 => in_steps(to, len, 5 * period, |step| {
                    (0..5).for_each(|index| store(step, index * period, word.to_le_bytes()));
                }),
                _ => fill(to, word, len),
            }
        }
        9..=16 => repeat::<8>(to, ends(from, offset), offset, len),
        17..=32 => repeat::<16>(to, ends(from, offset), offset, len),
        33..=64 => repeat::<32>(to, ends(from, offset), offset, len),
        _ => {
            let mut at = 0;
            in_steps(to, len, 32, |step| {
                store(step, 0, load::<32>(from, at));
                at = (at + 32).min((at + 32).wrapping_sub(offset));
            });
        }
    }
}
