//! Splits a block where tables of their own make the parts smaller.

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::{Error, Output, Result};

use crate::block::{BlockWriter, Content};
use crate::bytes::highest_bit;
use crate::entropy::fse::SYMBOLS;
use crate::entropy::histogram;
use crate::parameters::{Strategy, Tuning};
use crate::sequences::{Mark, OffsetValue, Repeats, Sequence, Sequences, count_codes};

const PIECES_MAX: usize = 15;
const BIT: u32 = 256;

/// How many to consider for a block of `len` bytes. The margin of `worst_case_len()` has room for their headers.
pub(crate) fn pieces(len: usize, strategy: Strategy) -> usize {
    let (len_log, max) = match strategy {
        Strategy::Ultra2 => (12, PIECES_MAX),
        Strategy::Ultra | Strategy::Optimal | Strategy::TreeLazy2 => (13, 8),
        _ => (14, 4),
    };
    match len >> len_log {
        ..2 => 0,
        pieces => pieces.min(max),
    }
}

/// From a table, as vector multiplications lower the clock of Cascade Lake.
#[inline(always)]
fn times_log(count: u32) -> u32 {
    const LEN_LOG: u32 = 9;
    #[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
    static TABLE: [u32; 1 << LEN_LOG] = {
        let (mut table, mut count) = ([0; _], 1u64);
        while count < 1 << LEN_LOG {
            let (mut log, mut rest, mut digits) =
                (count.ilog2() as u64, count << 30 >> count.ilog2(), 0);
            while digits < 20 {
                rest = (rest * rest) >> 30;
                (log, rest, digits) = (2 * log + (rest >> 31), rest >> (rest >> 31), digits + 1);
            }
            table[count as usize] = ((count * log * BIT as u64) >> digits) as u32;
            count += 1;
        }
        table
    };
    TABLE.get(count as usize).copied().unwrap_or_else(|| {
        let shift = highest_bit(count) + 2 - LEN_LOG;
        let [low, high] = [0, 1].map(|it| *TABLE.at((count >> shift) as usize + it));
        (low << shift) + (high - low) * (count % (1 << shift)) + shift * count * BIT
    })
}

/// For what `after` has more of the symbols `used`, and how many kinds of them there are.
fn entropy(before: &[u32; 256], after: &[u32; 256], used: &[u8]) -> (u32, u32) {
    let (mut total, mut saved, mut kinds) = (0, 0, 0);
    for &symbol in used {
        let count = after.at(symbol.into()) - before.at(symbol.into());
        total += count;
        saved += times_log(count);
        kinds += u32::from(count != 0);
    }
    (times_log(total).saturating_sub(saved), kinds)
}

/// `used` are the literals and the symbols of each kind of code. One in `rate` literals is in the histograms.
fn estimate(start: &Mark, end: &Mark, [bytes, used @ ..]: [&[u8]; 4], rate: u32) -> u32 {
    let literals = (end.literals - start.literals) * BIT;
    let (sampled, kinds) = entropy(&start.histogram, &end.histogram, bytes);
    // Samples look more uneven than what they are from.
    let compressed = rate * sampled + kinds * (rate - 1) * (BIT * 3 / 4);
    let described = compressed.max(literals) + (3 * kinds + 250) * BIT;
    let codes = used.map(|it| entropy(&start.codes, &end.codes, it));
    let codes = codes.map(|(entropy, kinds)| entropy + 6 * kinds * BIT);
    described.min(8 * literals) + codes.iter().sum::<u32>() + 100 * BIT
}

/// Lists the symbols that occur.
fn used<'a>(counts: &[u32; 256], room: &'a mut [u8; 256]) -> &'a [u8] {
    let symbols = (0..=u8::MAX).filter(|&it| *counts.at(it.into()) != 0);
    let count = room
        .iter_mut()
        .zip(symbols)
        .map(|(to, it)| *to = it)
        .count();
    room.split_at(count).0
}

/// Moves the best marks to the front, and returns them.
fn choose<'a>(marks: &'a mut [Mark], literals: &[u8], rate: usize) -> &'a [Mark] {
    const SAMPLES: usize = 4;
    let (mut histogram, mut counted) = ([0; _], 0);
    for mark in &mut *marks {
        let piece = literals
            .get(counted..mark.literals as usize)
            .unwrap_or_default();
        for part in piece.chunks(piece.len() / SAMPLES + 1) {
            histogram::add(&mut histogram, part.split_at(part.len().div_ceil(rate)).0);
        }
        (mark.histogram, counted) = (histogram, mark.literals as usize);
    }
    let Some(last) = marks.last() else {
        return marks;
    };
    let (mut bytes, mut codes) = ([0; _], [0; _]);
    let mut codes = used(&last.codes, &mut codes).chunk_by(|a, b| a ^ b < SYMBOLS as u8);
    let [a, b, c] = core::array::from_fn(|_| codes.next().unwrap_or_default());
    let used = [used(&last.histogram, &mut bytes), a, b, c];
    let mut best = [(0, 0); PIECES_MAX + 1];
    for (to, end) in marks.iter().enumerate().skip(1) {
        let ways = (marks.iter().zip(best).take(to).enumerate())
            .map(|(from, (start, it))| (it.0 + estimate(start, end, used, rate as u32), from));
        *best.at_mut(to) = ways.min().unwrap_or_default();
    }
    let (mut first, mut at) = (marks.len() - 1, marks.len() - 1);
    while at != 0 {
        (first, at) = (first - 1, best.at(at).1);
        marks.swap(first, at);
    }
    marks.get(first..).unwrap_or_default()
}

/// Leaves out what does not matter for the recent offsets at the end.
fn decisive(sequences: &[Sequence]) -> &[Sequence] {
    let are_new = |it: &[Sequence; 3]| it.iter().all(|it| it.offset().offset().is_some());
    let start = sequences.array_windows().rposition(are_new);
    sequences.get(start.unwrap_or(0)..).unwrap_or_default()
}

/// A part that ends up uncompressed does not change the recent offsets of a decoder the way the search counted on.
fn replace_lost_repeats(sequences: &mut [Sequence], decoder: &mut Repeats, search: &mut Repeats) {
    for sequence in sequences {
        let (found, has_literals) = (sequence.offset(), sequence.literal_len() != 0);
        let offset = search.resolve(found, has_literals);
        if decoder.resolve(found, has_literals) != offset {
            sequence.set_offset(OffsetValue::new(offset));
        }
        *decoder = decoder.after(sequence.offset(), has_literals);
        *search = search.after(found, has_literals);
    }
}

#[inline(never)]
pub(crate) fn write(
    writer: &mut BlockWriter,
    bytes: &[u8],
    all: &mut Sequences,
    tuning: &Tuning,
    is_last: bool,
    out: &mut Output<'_>,
) -> Result<()> {
    let (list, literals, marks) = all.split_mut();
    let rate = 1 + usize::from(tuning.strategy.is_hurried()) * (literals.len() >> 14);
    let mut search_repeats = writer.repeats;
    for [start, end] in choose(marks, literals, rate).array_windows() {
        let range = |of: fn(&Mark) -> u32| of(start) as usize..of(end) as usize;
        let sequences = (list.get_mut(range(|it| it.sequences))).ok_or(Error::Internal)?;
        let mut repeats = writer.repeats;
        let counts = if repeats == search_repeats && start.borrowed == 0 {
            let after = |it: Repeats, by: &Sequence| it.after(by.offset(), by.literal_len() != 0);
            repeats = decisive(sequences).iter().fold(repeats, after);
            search_repeats = repeats;
            core::array::from_fn(|it| end.codes.at(it) - start.codes.at(it))
        } else {
            if let Some(first) = sequences.first_mut() {
                first.drop_literals(start.borrowed);
            }
            replace_lost_repeats(sequences, &mut repeats, &mut search_repeats);
            count_codes(sequences)
        };
        let content = Content {
            bytes: bytes.get(range(|it| it.bytes)).ok_or(Error::Internal)?,
            sequences,
            literals: literals
                .get(range(|it| it.literals))
                .ok_or(Error::Internal)?,
            counts: &counts,
            repeats,
        };
        let is_last = is_last && end.bytes as usize == bytes.len();
        writer.write(&content, tuning, is_last, out)?;
    }
    Ok(())
}

#[test]
fn products_are_close() {
    for count in (1..1 << 17).step_by(7) {
        let exact = f64::from(count) * f64::from(count).log2() * f64::from(BIT);
        let error = (f64::from(times_log(count)) - exact).abs();
        assert!(error <= 1.0 + f64::from(count) / 64.0);
    }
}

#[test]
fn parts_end_within_literals_and_make_up_for_lost_repeats() -> Result<()> {
    use bun_zstd_decoder::{XxHash64, decompress};

    use crate::parameters::{Purpose, Request};

    let (mut all, mut bytes) = (Sequences::new(), Vec::new());
    all.clear_for(1 << 17, 3)?;
    let mut add = |runs: &[(u32, u8)], offset| {
        let masks = (runs.iter()).flat_map(|&(len, mask)| (0..len).map(move |_| mask));
        for mask in masks {
            bytes.push(XxHash64::hash(&bytes.len().to_le_bytes()) as u8 & mask);
        }
        bytes.extend_from_within(bytes.len() - 1000..bytes.len() - 995);
        all.push(runs.iter().map(|it| it.0).sum(), offset, 5);
    };
    add(&[(8193, 3), (4000, 255)], OffsetValue::new(1000));
    add(&[(4188, 255), (1000, 3)], OffsetValue(1));
    (0..899).for_each(|_| add(&[(3, 3)], OffsetValue(1)));
    let end = bytes.len() as u32;
    bytes.extend((end..4 << 13).map(|_| 7));
    all.finish(&bytes, end, 4)?;

    let tuning = Request::new(19).tuning(None, Purpose::Frame { dictionary_len: 0 });
    let (mut frame, mut back) = (Vec::with_capacity(1 << 16), Vec::with_capacity(1 << 16));
    frame.extend([0x28, 0xB5, 0x2F, 0xFD, 0, 0x38]);
    let mut out = Output::spare_capacity(&mut frame, usize::MAX);
    write(
        &mut BlockWriter::new(),
        &bytes,
        &mut all,
        &tuning,
        true,
        &mut out,
    )?;
    drop(out);
    decompress(
        &frame,
        &mut Output::spare_capacity(&mut back, usize::MAX),
        None,
    )?;
    assert_eq!(back, bytes);
    let changed = all.list.iter().map(|it| (it.literal_len(), it.offset().0));
    assert!(changed.take(3).eq([(4000, 1003), (1000, 1003), (3, 1)]));
    Ok(())
}
