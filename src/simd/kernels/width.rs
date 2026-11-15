//! Ports of highway_strings.cpp, for `Bun.stringWidth`.
use bun_simd::blocks;

const BEL: u8 = 0x07;
const CAN: u8 = 0x18;
const SUB: u8 = 0x1A;
const ESC: u8 = 0x1B;
const ST: u8 = 0x9C;

// Where a block starts: a bit each.
const AFTER_ESC: u32 = 0;
const IN_CSI: u32 = 1;
const IN_OSC: u32 = 2;
const IN_STRING: u32 = 3;

/// For a C1 byte or what follows ESC: how much to skip, and the state after that.
#[inline(always)]
fn introducer(text: &[u8]) -> (usize, u64) {
    match *text {
        [0x9B, ..] => (1, 1 << IN_CSI),
        [0x9D, ..] => (1, 1 << IN_OSC),
        [b'P' | b'X' | b'^' | b'_' | 0x90 | 0x98 | 0x9E | 0x9F, ..] => (1, 1 << IN_STRING),
        [] | [0xA0..=0xFF, ..] => (0, 0),
        [0x20..=0x2F, next, ..] if next != ESC => (2, 0),
        _ => (1, 0),
    }
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, Mask, U8, U16};

    type Test = Mask<u8, { U8::LEN }>;

    fn is_visible(v: U8) -> Test {
        (v & 0x60).bitcast::<I8>().simd_gt(0).cast() & !(v.simd_eq(0x7F) | v.simd_eq(0xAD))
    }

    #[export]
    pub fn visible_latin1_width(text: &[u8]) -> usize {
        U8::count(text, |v| is_visible(v))
    }

    fn may_start_or_end_escape(v: U8) -> Test {
        (v & 0x70).simd_eq(0x10)
    }

    #[export]
    pub fn visible_latin1_width_exclude_ansi(text: &[u8]) -> usize {
        let tests = |v| [is_visible(v), may_start_or_end_escape(v)];
        let (mut width, mut rest) = (0, text);
        while let Some((block, after)) = rest.split_first_chunk()
            && let [visible, 0] = U8::bitmasks(block, tests)
        {
            (width, rest) = (width + visible.count_ones() as usize, after);
        }
        if rest.len() < 64
            && let [visible, 0] = U8::count_each(rest, tests)
        {
            return width + visible;
        }
        width + width_with_escapes(rest)
    }

    #[inline(never)]
    fn width_with_escapes(mut rest: &[u8]) -> usize {
        let (mut width, mut state) = (0, 0);
        while !rest.is_empty() {
            let mut padding;
            let block = if let Some(block) = rest.first_chunk() {
                block
            } else {
                padding = [0; 64];
                blocks(rest, &mut padding).next().unwrap()
            };
            let tests = |v| [is_visible(v), may_start_or_end_escape(v)];
            let ([mut visible, escapes], mut size) = (U8::bitmasks(block, tests), 64);
            if escapes | state != 0 {
                let [esc, csi, st, osc, aborts, finals, bel, c1] = U8::bitmasks(block, |v| {
                    let aborts = [1, 0, 0, 0, 0, 0, 0, 0, CAN, 0, SUB, ESC, ST, 0, 0, 0];
                    [
                        v.simd_eq(ESC),
                        v.simd_eq(b'['),
                        v.simd_eq(b'\\'),
                        v.simd_eq(b']'),
                        U8::repeat_16(aborts).lookup(v & 0x0F).simd_eq(v),
                        v.in_range(0x40..=0x7E),
                        v.simd_eq(BEL),
                        (v & 0xF0).simd_eq(0x90),
                    ]
                });
                let after_esc = esc << 1 | state >> AFTER_ESC & 1;
                let (mut hidden, was) = (after_esc, state);
                state = esc >> 63 << AFTER_ESC | (after_esc & csi) >> 63 << IN_CSI;
                // ESC ends any sequence, so they do not nest. A carry runs up to the end of each.
                for (kind, starts, ends) in [
                    (IN_CSI, (after_esc & csi) << 1, aborts | finals),
                    (IN_OSC, after_esc & osc, aborts | bel),
                    (IN_STRING, 0, aborts),
                ] {
                    let (sum, carry) = (!ends).overflowing_add(starts | was >> kind & 1);
                    hidden |= sum ^ !ends;
                    state |= u64::from(carry) << kind;
                }
                visible &= !hidden;
                let others = after_esc & !(esc | csi | st | osc) | c1 & !hidden;
                if let Some(other) = others.lowest_one() {
                    visible &= !(u64::MAX << other);
                    (size, state) = introducer(&rest[other as usize..]);
                    size += other as usize;
                }
            }
            width += visible.count_ones() as usize;
            rest = rest.get(size..).unwrap_or_default();
        }
        width
    }

    /// Always a cluster of its own, with a width of 1 up to U+3000 and of 2 above.
    fn has_fixed_width(v: U16) -> Mask<u16, { U16::LEN }> {
        let latin = v.in_range(0xA0..=0x2FF) & !(v.simd_eq(0xA9) | v.in_range(0xAD..=0xAE));
        let greek_or_cyrillic = v.in_range(0x370..=0x482) | v.in_range(0x48A..=0x52F);
        let kana = v.in_range(0x3041..=0x3096) | v.in_range(0x309B..=0x30FF);
        let ideograph = v.in_range(0x3400..=0x4DBF) | v.in_range(0x4E00..=0x9FFF);
        let hangul_or_fullwidth = v.in_range(0xAC00..=0xD7A3) | v.in_range(0xFF01..=0xFF60);
        (v.in_range(0x20..=0x7E) | latin | greek_or_cyrillic)
            | (kana | ideograph | hangul_or_fullwidth)
    }

    /// The number of units at the start that need no look at their neighbours, and their width.
    #[export]
    pub fn visible_utf16_width(text: &[u16]) -> (usize, usize) {
        let up_to_other = |start: usize, others: u64, wide: u64| {
            let len = (start + others.trailing_zeros() as usize).min(text.len());
            (
                len,
                len + (wide & !others & others.wrapping_sub(1)).count_ones() as usize,
            )
        };
        let Some((_, last)) = text.split_last_chunk() else {
            let Some(partial) = U16::load_partial(text) else {
                return (0, 0);
            };
            let others = partial.to_bitmask(!has_fixed_width(partial.lanes));
            return up_to_other(0, others, partial.to_bitmask(partial.lanes.simd_gt(0x3000)));
        };
        let (mut start, mut wide_before, mut v) = (0, 0, U16::load(last));
        let mut seen = U16::LEN - 1 - (text.len() - 1) % U16::LEN;
        let mut is_fixed = has_fixed_width(v);
        for chunk in text[..text.len() - 1].as_chunks().0 {
            let here = U16::load(chunk);
            let is_fixed_here = has_fixed_width(here);
            if !is_fixed_here.all() {
                (v, is_fixed, seen) = (here, is_fixed_here, 0);
                break;
            }
            wide_before += here.simd_gt(0x3000).count();
            start += U16::LEN;
        }
        let [others, wide] = [!is_fixed, v.simd_gt(0x3000)].map(|mask| mask.to_bitmask() >> seen);
        let (len, width) = up_to_other(start, others, wide);
        (len, width + wide_before)
    }

    #[export]
    pub fn count_printable_ascii16(text: &[u16]) -> usize {
        U16::count(text, |v| v.in_range(0x20..=0x7E))
    }
}
