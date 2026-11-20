//! For `Bun.stringWidth`.
use bun_simd::Isa;
use core::array::from_fn;

pub use simd::{
    count_printable_ascii16, visible_latin1_width, visible_latin1_width_exclude_ansi,
    visible_utf16_width,
};

const BEL: u8 = 0x07;
const CAN: u8 = 0x18;
const SUB: u8 = 0x1A;
const ESC: u8 = 0x1B;
const ST: u8 = 0x9C;

const IN_TEXT: u64 = 0;
const AFTER_ESC: u64 = 1;
const IN_CSI: u64 = 2;
const AFTER_INTERMEDIATE: u64 = 4;
const IN_OSC: u64 = 8;
const IN_STRING: u64 = 16;
/// `IN_TEXT`, after a byte that counts.
const VISIBLE: u64 = 128;

const fn state_after(state: u64, byte: u8) -> u64 {
    match (state, byte) {
        (_, ESC) => AFTER_ESC,
        (AFTER_INTERMEDIATE, _) | (_, CAN | SUB | ST) => IN_TEXT,
        (IN_CSI, 0x40..=0x7E) | (IN_OSC, BEL) => IN_TEXT,
        (IN_CSI | IN_OSC | IN_STRING, _) => state,
        (AFTER_ESC, b'[') | (_, 0x9B) => IN_CSI,
        (AFTER_ESC, b']') | (_, 0x9D) => IN_OSC,
        (AFTER_ESC, b'P' | b'X' | b'^' | b'_') | (_, 0x90 | 0x98 | 0x9E | 0x9F) => IN_STRING,
        (AFTER_ESC, 0x20..=0x2F) => AFTER_INTERMEDIATE,
        (AFTER_ESC, ..0x7F) | (_, ..0x20 | 0x7F..0xA0 | 0xAD) => IN_TEXT,
        _ => VISIBLE,
    }
}

/// The width, and the state at the end.
#[inline(always)]
fn byte_by_byte(text: &[u8], state: u64) -> (usize, u64) {
    /// Each state has its byte in a row, which tells where the next state has its byte.
    static ROWS: [u64; 256] = {
        let (mut rows, mut i) = ([0; 256], 0);
        while i < 256 * 8 {
            let next = state_after(1 << (i % 8) >> 1, (i / 8) as u8);
            rows[i / 8] |= (8 * next.bit_width() as u64) << (8 * (i % 8));
            i += 1;
        }
        rows
    };
    let (mut width, mut shift) = (0, u64::from(8 * state.bit_width()));
    for &byte in text {
        shift = ROWS[usize::from(byte)].wrapping_shr(shift as u32);
        width += (shift >> 6 & 1) as usize;
    }
    (width, 1 << (shift / 8 % 8) >> 1)
}

// Ascending ranges of units that are a cluster of their own, 1 wide up to U+3000 and 2 above.
const STARTS: [u16; 2 * PAIRS] = [
    0x20, 0xA0, 0xAA, 0xAF, 0x370, 0x48A, 0x3041, 0x309B, 0x3400, 0x4E00, 0xAC00, 0xFF01,
];
const ENDS: [u16; 2 * PAIRS] = [
    0x7E, 0xA8, 0xAC, 0x2FF, 0x482, 0x52F, 0x3096, 0x30FF, 0x4DBF, 0x9FFF, 0xD7A3, 0xFF60,
];
const PAIRS: usize = 6;

/// In the order of `i16`, the first range comes first, and what is below it last.
const fn signed(unit: u16) -> i16 {
    unit.wrapping_sub(STARTS[0]) as i16 ^ i16::MIN
}

/// For each pair of ranges, the three bounds after its start: the low bytes, then the high ones.
const BOUNDS: [[u8; 16]; 3] = from_fn(const |nth| {
    from_fn(const |i| {
        let at = 2 * (i % 8 % PAIRS);
        assert!(PAIRS <= 8 && ENDS[at] < STARTS[at + 1] && (at == 0 || ENDS[at - 1] < STARTS[at]));
        signed([ENDS[at] + 1, STARTS[at + 1], ENDS[at + 1] + 1][nth]).to_le_bytes()[i / 8]
    })
});

/// The bits from each of `starts` up to the next of `ends`, and whether that is in a later block.
#[inline(always)]
fn runs(starts: u64, ends: u64) -> (u64, u64) {
    let (sum, carry) = (!ends).overflowing_add(starts);
    (sum ^ !ends, carry.into())
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{I8, I16, Mask, U8, U16, x128};

    type Test = Mask<u8, { U8::LEN }>;

    fn is_visible(v: U8) -> Test {
        let is_no_control = (v.saturating_add(1) & 0x7F).bitcast::<I8>().simd_gt(0x20);
        is_no_control.cast() & v.simd_ne(0xAD)
    }

    /// Most text has none, and it takes little to find out.
    fn is_not_printable_ascii(v: U8) -> Test {
        !v.in_range(0x20..=0x7E)
    }

    #[export]
    pub fn visible_latin1_width(text: &[u8]) -> usize {
        match text.len() <= U8::LEN.max(63) {
            true => U8::count(text, |v| is_visible(v)),
            false => width_of_long(text),
        }
    }

    #[inline(never)]
    fn width_of_long(text: &[u8]) -> usize {
        match U8::position(text, |v| is_not_printable_ascii(v)) {
            None => text.len(),
            Some(at) => at + U8::count(&text[at..], |v| is_visible(v)),
        }
    }

    /// The width, or 63 for the bytes that need a closer look.
    fn weight(v: U8) -> U8 {
        let by_row = [0, 0, 1, 1, 1, 1, 1, 1, 0, 63, 1, 1, 1, 1, 1, 1];
        let exceptions = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ESC, 0, 0xAD, 0, 0x7F];
        let is_exception = U8::repeat(exceptions).lookup(v & 0x0F).simd_eq(v);
        U8::repeat(by_row).lookup(v >> 4) | is_exception.to_vector() & 63
    }

    /// Below that, `byte_by_byte` is faster than a block.
    const SHORT: usize = if U8::LEN > 16 { 16 } else { 32 };

    #[export]
    pub fn visible_latin1_width_exclude_ansi(text: &[u8]) -> usize {
        if text.len() < 63 {
            // Text that starts with ESC or a C1 byte has sequences.
            if text.first().is_none_or(|first| first & 0x70 != 0x10)
                && let width @ ..63 = U8::sum_of_bytes::<_, 63>(text, |v| weight(v))
            {
                return width;
            }
            return match text.len() {
                ..SHORT => byte_by_byte(text, IN_TEXT).0,
                _ => width_with_escapes(0, text),
            };
        }
        let Some(last) = text.last_chunk() else {
            return width_with_escapes(0, text);
        };
        // At least one byte is left for the last block.
        let before = &text[..text.len() - 1];
        let invisible = |v| [is_not_printable_ascii(v), !is_visible(v)];
        let mut width = U8::skip::<_, true>(before, 0, invisible);
        let mut rest = &before[width..];
        while let Some((block, after)) = rest.split_first_chunk()
            && let [visible, 0] = visible_and_suspects(block)
        {
            (width, rest) = (width + visible.count_ones() as usize, after);
        }
        if rest.len() < 64
            && let [visible, 0] = visible_and_suspects(last)
        {
            return width + (visible >> (63 - rest.len())).count_ones() as usize;
        }
        width_with_escapes(width, &text[before.len() - rest.len()..])
    }

    /// The second are not visible. All that start a sequence are among them.
    fn visible_and_suspects(block: &[u8; 64]) -> [u64; 2] {
        U8::bitmasks(block, |v| {
            [is_visible(v), v.in_range(0x90..=0x9F) | v.simd_eq(ESC)]
        })
    }

    #[inline(never)]
    fn width_with_escapes(mut width: usize, text: &[u8]) -> usize {
        let (mut rest, mut state) = (Some(text), IN_TEXT);
        while let Some(text) = rest {
            let block;
            (block, rest) = match text.split_first_chunk() {
                Some((block, rest)) => (*block, Some(rest)),
                None if text.len() < SHORT => return width + byte_by_byte(text, state).0,
                None => (U8::pad_block(text), None),
            };
            let [visible, suspects] = visible_and_suspects(&block);
            if suspects | state != 0 {
                let was = state;
                if let Some(hidden) = escapes_in(&block, !visible, suspects, &mut state) {
                    width += (visible & !hidden).count_ones() as usize;
                } else {
                    let (more, is) = byte_by_byte(&text[..text.len().min(64)], was);
                    (width, state) = (width + more, is);
                }
                continue;
            }
            width += visible.count_ones() as usize;
            // A loop of its own has the registers for itself.
            while let Some((block, after)) = rest.and_then(<[_]>::split_first_chunk)
                && let [visible, 0] = visible_and_suspects(block)
            {
                (width, rest) = (width + visible.count_ones() as usize, Some(after));
            }
        }
        width
    }

    /// ESC ends any sequence. `None` if one holds a C1 byte that starts another kind.
    #[inline(always)]
    fn escapes_in(block: &[u8; 64], invisible: u64, suspects: u64, state: &mut u64) -> Option<u64> {
        let [csi, csi_ends] = U8::bitmasks(block, |v| {
            let aborts = [1, 0, 0, 0, 0, 0, 0, 0, CAN, 0, SUB, ESC, ST, 0, 0, 0];
            let aborts = U8::repeat(aborts).lookup(v & 0x0F).simd_eq(v);
            [
                (v & 0x3F).simd_eq(b'[' & 0x3F),
                aborts | v.in_range(0x40..=0x7E),
            ]
        });
        let (was, esc) = (*state, csi & suspects & csi_ends);
        let after_esc = esc << 1 | was & AFTER_ESC;
        let letters = after_esc & csi_ends & !invisible;
        let csi_ends = csi_ends & !letters;
        let (mut hidden, carry) = runs(letters & csi | (was / IN_CSI) & 1, csi_ends);
        *state = ((esc >> 63) * AFTER_ESC) | (carry * IN_CSI);
        if after_esc & !hidden | suspects & !esc | (was / AFTER_INTERMEDIATE) == 0 {
            return Some(hidden);
        }

        let [osc, string, intermediates, bel, not_ascii] = U8::bitmasks(block, |v| {
            let string = [0x10, 0, 0, 0, 0, 0, 0, 0, 0x18, 0, 0, 0, 0, 0, 0x1E, 0x1F];
            [
                (v & 0x3F).simd_eq(b']' & 0x3F),
                U8::repeat(string).lookup(v & 0x0F).simd_eq(v & 0x3F),
                (v & 0xF0).simd_eq(0x20),
                v.simd_eq(BEL),
                v.bitcast::<I8>().simd_lt(0).cast(),
            ]
        });
        let (aborts, intermediates) = (csi_ends & invisible, intermediates & after_esc);
        hidden |= after_esc & !not_ascii | intermediates << 1 | (was / AFTER_INTERMEDIATE) & 1;
        *state |= (intermediates >> 63) * AFTER_INTERMEDIATE;
        let kinds = [
            (IN_CSI, csi, csi_ends),
            (IN_OSC, osc, aborts | bel),
            (IN_STRING, string, aborts),
        ];
        for &(kind, starts, ends) in &kinds[1..] {
            let (run, carry) = runs(letters & starts | (was / kind) & 1, ends);
            (hidden, *state) = (hidden | run, *state | (carry * kind));
        }
        // A C1 byte in a sequence of its own kind only leaves a hole where nothing is visible.
        let (c1, mut nested) = ((csi | osc | string) & suspects & not_ascii & !hidden, 0);
        for (kind, starts, ends) in kinds {
            if c1 & starts != 0 {
                let (run, carry) = runs(c1 & starts, ends);
                (hidden, *state) = (hidden | run, *state | (carry * kind));
                nested |= run & c1 & !starts;
            }
        }
        (nested == 0).then_some(hidden)
    }

    fn has_fixed_width(v: U16) -> Mask<u16, { U16::LEN }> {
        // It takes longer to turn masks into vectors, for the lookups.
        if isa::Isa::HAS_MASK_REGISTERS {
            let is_in = |i: usize| v.in_range(STARTS[i]..=ENDS[i]);
            return (1..2 * PAIRS).fold(is_in(0), |any, i| any | is_in(i));
        }
        let (v, mut pair) = (v.bitcast::<I16>() + signed(0), U8::repeat([0, 8]));
        for i in 1..PAIRS {
            pair -= v.simd_ge(signed(STARTS[2 * i])).to_vector().bitcast::<U8>();
        }
        // In a range, one or three of them are above.
        let is_below = |i: usize| v.simd_lt(U8::repeat(BOUNDS[i]).lookup(pair).bitcast::<I16>());
        (is_below(0) ^ is_below(1) ^ is_below(2)).cast()
    }

    /// The same for one unit, with a lane for each range.
    fn is_fixed(unit: u16) -> bool {
        let is_in = |i: usize| {
            let [starts, ends] = [&STARTS[i..], &ENDS[i..]].map(x128::U16::from_slice);
            (x128::U16::splat(unit) - starts).simd_le(ends - starts)
        };
        (is_in(0) | is_in(4)).any()
    }

    /// The number of units at the start that need no look at their neighbours, and their width.
    #[export]
    pub fn visible_utf16_width(text: &[u16]) -> (usize, usize) {
        if text.len() < 8 {
            let (mut len, mut width) = (0, 0);
            #[rustc_unroll(never)]
            while let Some(&unit) = text.get(len)
                && ((STARTS[0]..=ENDS[0]).contains(&unit) || is_fixed(unit))
            {
                (len, width) = (len + 1, width + 1 + usize::from(unit > 0x3000));
            }
            return (len, width);
        }
        if text[0] > 0x7E {
            return fixed_width(text);
        }
        // Most runs are ASCII, and end with the text, an escape, a symbol or an emoji.
        let ascii = U16::position(text, |v| !v.in_range(0x20..=0x7E)).unwrap_or(text.len());
        if !text.get(ascii).is_some_and(|&unit| is_fixed(unit)) {
            return (ascii, ascii);
        }
        // From the start, nothing waits for `ascii`.
        if ascii < U16::LEN {
            return fixed_width(text);
        }
        let (len, width) = fixed_width(&text[ascii..]);
        (ascii + len, ascii + width)
    }

    #[inline(never)]
    fn fixed_width(text: &[u16]) -> (usize, usize) {
        let (mut rest, mut wide) = (text, 0);
        loop {
            let v = match rest.first_chunk() {
                Some(chunk) => U16::load(chunk),
                // The padding ends the loop.
                None => match U16::load_padded(rest) {
                    Some(padded) => padded.lanes,
                    None => return (text.len(), text.len() + wide),
                },
            };
            let is_wide = v.simd_gt(0x3000);
            if let Some(lane) = (!has_fixed_width(v)).first_set() {
                let len = text.len() - rest.len() + lane;
                return (len, len + wide + is_wide.count_before(lane));
            }
            (rest, wide) = (&rest[U16::LEN..], wide + is_wide.count());
        }
    }

    #[export]
    pub fn count_printable_ascii16(text: &[u16]) -> usize {
        U16::count(text, |v| v.in_range(0x20..=0x7E))
    }
}
