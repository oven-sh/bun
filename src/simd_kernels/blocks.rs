//! Kernels that work on blocks of 64 bytes.

use bun_simd::prelude::*;

/// The offsets of the bytes after each `\n`. `out` has room for them.
#[kernel]
pub(crate) fn line_starts(text: &[u8], out: &mut Output<'_, u32>) {
    let out = &mut out.limit(out.room());
    let mut block = |v: u8x64<S>, next: u32| {
        for lane in v.simd_eq(b'\n').iter() {
            out.push_one(next.wrapping_add(lane as u32));
        }
    };
    let (chunks, rest) = u8x64::over(text).exact();
    let mut next = 1u32;
    for v in chunks {
        block(v, next);
        next = next.wrapping_add(64);
    }
    block(u8x64::load_or_default(rest), next);
}

/// The lowest two classes are blanks, and the others are in names.
const NAME_OR_BLANK: ByteClasses = ByteClasses::EMPTY.with(0x03, ByteSet::of(b"\t ")).with(
    0x7c,
    ByteSet::new(&[
        b'$'..=b'$',
        b'0'..=b'9',
        b'A'..=b'Z',
        b'_'..=b'_',
        b'a'..=b'z',
    ]),
);
const MARKS: ByteSet = ByteSet::new(&[
    b'"'..=b'"',
    b'$'..=b'$',
    b'\''..=b'\'',
    b'\\'..=b'\\',
    b'`'..=b'`',
]);
const ODD: ByteClasses = ByteClasses::new(&[0..=8, 11..=12, 14..=0x1f, b'\\'..=b'\\', 0x7f..=0xff]);

#[simd]
fn stops(v: u8x64<S>) -> ([u8; 8], [u8; 8], [u8; 8]) {
    let name_or_blank = NAME_OR_BLANK.classes(v);
    let name = name_or_blank.cast_signed().simd_gt(3).to_bitmask();
    let neither = name_or_blank.simd_eq(0).to_bitmask();
    let string = (MARKS.contains(v) | v.cast_signed().simd_lt(0x20)).to_bitmask();
    (
        (!name).to_le_bytes(),
        (name | neither).to_le_bytes(),
        string.to_le_bytes(),
    )
}

/// Three bitmaps of the bytes that end an identifier, blanks and a string. Each has a word for every 64 bytes. The
/// bits past the end of the text are set.
#[kernel]
pub(crate) fn scanner_run_stops(text: &[u8], planes: [&mut [[u8; 8]]; 3]) {
    let (blocks, rest) = text.as_chunks::<64>();
    let [names, blanks, strings] = planes;
    let whole = blocks.len();
    if !rest.is_empty() {
        (names[whole], blanks[whole], strings[whole]) = stops(u8x64::load_or_default(rest));
    }
    let (names, blanks, strings) = (
        &mut names[..whole],
        &mut blanks[..whole],
        &mut strings[..whole],
    );
    for i in 0..whole {
        (names[i], blanks[i], strings[i]) = stops(u8x64::from(blocks[i]));
    }
}

/// A bit for every byte: whether it is `byte`. `out` has a word for every 64 bytes.
#[kernel]
pub(crate) fn byte_bits(text: &[u8], byte: u8, out: &mut [u64]) {
    over(text).bitmask_into(out, |v| v.simd_eq(byte))
}

/// A bit for every 64 bytes: whether one is neither printable nor a blank, or is a backslash.
#[kernel]
pub(crate) fn odd_blocks(text: &[u8], out: &mut [u64]) {
    let is_odd = |v: u8x64<S>| (ODD.classes(v) != 0) as u64;
    let out = &mut out[..text.len().div_ceil(4096)];
    for (group, marks) in text.chunks(4096).zip(out) {
        let (chunks, rest) = u8x64::over(group).exact();
        *marks = chunks
            .enumerate()
            .fold(0, |marks, (i, v)| marks | is_odd(v) << i);
        if !rest.is_empty() {
            *marks |= is_odd(u8x64::load_or(rest, b' ')) << (group.len() / 64);
        }
    }
}
