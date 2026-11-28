//! The structural index of XML.

use bun_simd::prelude::*;

// A byte has some of the bits of one class. Their order lets a comparison take the place of a mask and a test.
/// Indexed between `<` and the next `>`: `\t`, `\n`, `"`, `'`, `=`.
pub const TAG: u8 = 0x07;
/// Indexed everywhere: `&`, `\r`, and the control characters that XML forbids.
pub const ALWAYS: u8 = 0x38;
/// `<` and `>`
pub const ANGLE: u8 = 0x40;

const CLASSES: ByteClasses = ByteClasses::EMPTY
    .with(TAG, ByteSet::of(b"\t\n\"'="))
    .with(ALWAYS, ByteSet::new(&[0..=8, 11..=0x1f, b'&'..=b'&']))
    .with(ANGLE, ByteSet::of(b"<>"));

/// The class of each byte, for scalar code.
pub const BYTE_CLASS: [u8; 256] = {
    let (mut table, mut i) = ([0; 256], 0);
    while i < 256 {
        let class = CLASSES.classes_of(i as u8);
        let expected = match i as u8 {
            b'\t' | b'\n' | b'"' | b'\'' | b'=' => TAG,
            b'&' | ..0x20 => ALWAYS,
            b'<' | b'>' => ANGLE,
            _ => 0,
        };
        assert!(class & !expected == 0 && (class == 0) == (expected == 0));
        table[i] = class;
        i += 1;
    }
    table
};

/// `in_tag` tells whether the block before ended between `<` and `>`. An addition carries from each `<` to the next `>`.
#[simd]
fn markup(v: u8x64<S>, in_tag: &mut bool) -> u64 {
    let class = CLASSES.classes(v).cast_signed();
    let (lt, run) = (v.simd_eq(b'<').to_bitmask(), !v.simd_eq(b'>').to_bitmask());
    // If the first byte is a `<`, it carries either way, and its own bit comes from its class.
    let (sum, carry) = run.overflowing_add(lt | u64::from(*in_tag));
    *in_tag = carry;
    class.simd_gt(TAG as i8).to_bitmask() | class.simd_ne(0).to_bitmask() & (sum ^ run)
}

/// What a chunk leaves to the next.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct State {
    pub in_tag: bool,
    /// UTF-16: the last unit was a lead surrogate. The caller settles one that ends the input.
    pub lead: bool,
    /// Bytes: where the last 64 were 0xEF, and 0xBF if that matters.
    pub ef: u64,
    pub bf: u64,
}

/// Appends `base` plus the position of the markup, and of the last byte of each U+FFFE and U+FFFF, to `out`.
/// All chunks but the last have a multiple of 64 bytes.
#[kernel]
#[inline(never)]
pub fn index_chunk(chunk: &[u8], base: u32, out: &mut Vec<u32>, state: &mut State) {
    let (mut now, mut at) = (*state, base);
    let out = &mut Output::append(out, chunk.len() + 64);
    for (v, valid) in u8x64::over(chunk).padded() {
        let mut found = markup(v, &mut now.in_tag);
        let ef = v.simd_eq(0xef).to_bitmask();
        let two_after_ef = ef << 2 | now.ef >> 62;
        now.ef = ef;
        if ef | two_after_ef != 0 {
            let bf = v.simd_eq(0xbf).to_bitmask();
            found |= (v | 1).simd_eq(0xbf).to_bitmask() & (bf << 1 | now.bf >> 63) & two_after_ef;
            now.bf = bf;
        }
        set_bit_positions(found & valid, at, out);
        at = at.wrapping_add(64);
    }
    *state = now;
}

/// [`index_chunk`] for UTF-16. It also finds the surrogates that are not half of a pair.
#[kernel]
#[inline(never)]
pub fn index16_chunk(chunk: &[u16], base: u32, out: &mut Vec<u32>, state: &mut State) {
    let (mut now, mut at) = (*state, base);
    let out = &mut Output::append(out, chunk.len() + 64);
    for block in chunk.chunks(64) {
        let (a, b, valid) = if block.len() == 64 {
            (u16x32::load(block), u16x32::load_last(block), !0)
        } else {
            let (a, b) = block.split_at(block.len().min(32));
            (
                u16x32::load_or_default(a),
                u16x32::load_or_default(b),
                !(!0 << block.len()),
            )
        };
        let mut found = markup(a.saturating_narrow(b), &mut now.in_tag);
        if now.lead || a.simd_max(b).simd_ge(0xd800).any() {
            let [low, high] = a.bitcast::<u8>().deinterleave(b.bitcast());
            let lead = (high & 0xfc).simd_eq(0xd8).to_bitmask();
            let trail = (high & 0xfc).simd_eq(0xdc).to_bitmask();
            // A lead that ends the block waits for the next.
            if now.lead && trail & 1 == 0 {
                out.push_one(at.wrapping_sub(1));
            }
            found |= trail & !(lead << 1 | now.lead as u64) | lead & !(trail >> 1) & !(1 << 63);
            found |= (high & (low | 1)).simd_eq(0xff).to_bitmask();
            now.lead = lead >> 63 != 0;
        }
        set_bit_positions(found & valid, at, out);
        at = at.wrapping_add(64);
    }
    *state = now;
}
