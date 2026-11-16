//! Ports of highway_strings.cpp, for `Bun.stringWidth`.

const BEL: u8 = 0x07;
const CAN: u8 = 0x18;
const SUB: u8 = 0x1A;
const ESC: u8 = 0x1B;
const ST: u8 = 0x9C;

// Where a block starts: a bit each.
const AFTER_ESC: u32 = 0;
const IN_CSI: u32 = 1;
const AFTER_INTERMEDIATE: u32 = 2;
const IN_OSC: u32 = 3;
const IN_STRING: u32 = 4;

// Ranges of units that are a cluster of their own, with a width of 1 up to U+3000 and of 2 above.
const STARTS: [u16; 12] = [
    0x20, 0xA0, 0xAA, 0xAF, 0x370, 0x48A, 0x3041, 0x309B, 0x3400, 0x4E00, 0xAC00, 0xFF01,
];
const ENDS: [u16; 12] = [
    0x7E, 0xA8, 0xAC, 0x2FF, 0x482, 0x52F, 0x3096, 0x30FF, 0x4DBF, 0x9FFF, 0xD7A3, 0xFF60,
];

/// The bits from each of `starts` up to the next of `ends`, and whether that is in a later block.
#[inline(always)]
fn runs(starts: u64, ends: u64) -> (u64, u64) {
    let (sum, carry) = (!ends).overflowing_add(starts);
    (sum ^ !ends, carry.into())
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, Mask, U8, U16, x128};

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

    #[export]
    pub fn visible_latin1_width_exclude_ansi(text: &[u8]) -> usize {
        if text.len() < 64 {
            return match U8::sum_of_bytes::<_, 63>(text, |v| weight(v)) {
                width @ ..63 => width,
                _ => width_with_escapes(0, text),
            };
        }
        match U8::position_refined(text, |v| [is_not_printable_ascii(v), !is_visible(v)]) {
            None => text.len(),
            Some(at) => width_with_escapes(at, &text[at..]),
        }
    }

    /// The bytes that are not visible, and some of them, among which all that start a sequence.
    fn invisible_and_suspects(block: &[u8; 64]) -> [u64; 2] {
        U8::bitmasks(block, |v| {
            let del_or_c1 = v.in_range(0x7F..=0x9F);
            let invisible = del_or_c1 | v.in_range(0..=0x1F) | v.simd_eq(0xAD);
            [invisible, del_or_c1 | v.simd_eq(ESC)]
        })
    }

    #[inline(never)]
    fn width_with_escapes(mut width: usize, text: &[u8]) -> usize {
        let (mut rest, mut state) = (Some(text), 0);
        while let Some(text) = rest {
            let block;
            (block, rest) = match text.split_first_chunk() {
                Some((block, rest)) => (*block, Some(rest)),
                None => (U8::pad_block(text), None),
            };
            let [invisible, suspects] = invisible_and_suspects(&block);
            if suspects | state != 0 {
                let hidden = invisible | escapes_in(&block, invisible, suspects, &mut state);
                width += 64 - hidden.count_ones() as usize;
                continue;
            }
            width += 64 - invisible.count_ones() as usize;
            // A loop of its own has the registers for itself.
            while let Some((block, after)) = rest.and_then(<[_]>::split_first_chunk)
                && let [invisible, 0] = invisible_and_suspects(block)
            {
                (width, rest) = (width + 64 - invisible.count_ones() as usize, Some(after));
            }
        }
        width
    }

    /// ESC ends any sequence. A C1 byte stands for ESC and the letter with the same low six bits.
    #[inline(always)]
    fn escapes_in(block: &[u8; 64], invisible: u64, suspects: u64, state: &mut u64) -> u64 {
        let [csi, csi_ends] = U8::bitmasks(block, |v| {
            let aborts = [1, 0, 0, 0, 0, 0, 0, 0, CAN, 0, SUB, ESC, ST, 0, 0, 0];
            let aborts = U8::repeat(aborts).lookup(v & 0x0F).simd_eq(v);
            [
                (v & 0x3F).simd_eq(b'[' & 0x3F),
                aborts | v.in_range(0x40..=0x7E),
            ]
        });
        let (was, esc) = (*state, csi & suspects & csi_ends);
        let after_esc = esc << 1 | was >> AFTER_ESC & 1;
        let letters = after_esc & csi_ends & !invisible;
        let csi_ends = csi_ends & !letters;
        let (mut hidden, carry) = runs(letters & csi | was >> IN_CSI & 1, csi_ends);
        *state = esc >> 63 << AFTER_ESC | carry << IN_CSI;
        if after_esc & !hidden | suspects & !esc | was >> AFTER_INTERMEDIATE == 0 {
            return hidden;
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
        hidden |= after_esc & !not_ascii | intermediates << 1 | was >> AFTER_INTERMEDIATE & 1;
        *state |= intermediates >> 63 << AFTER_INTERMEDIATE;
        for (kind, starts, ends) in [(IN_OSC, osc, aborts | bel), (IN_STRING, string, aborts)] {
            let (run, carry) = runs(letters & starts | was >> kind & 1, ends);
            (hidden, *state) = (hidden | run, *state | carry << kind);
        }
        let mut c1 = (csi | osc | string) & suspects & not_ascii & !hidden;
        while c1 != 0 {
            let start = c1.isolate_lowest_one();
            let (kind, ends) = match (start & csi, start & osc) {
                (0, 0) => (IN_STRING, aborts),
                (0, _) => (IN_OSC, aborts | bel),
                _ => (IN_CSI, csi_ends),
            };
            let (run, carry) = runs(start, ends);
            (hidden, *state, c1) = (hidden | run, *state | carry << kind, c1 & !run);
        }
        hidden
    }

    fn has_fixed_width(v: U16) -> Mask<u16, { U16::LEN }> {
        let is_in = |i: usize| v.in_range(STARTS[i]..=ENDS[i]);
        let either = |i: usize| is_in(i) | is_in(i + 1);
        (either(0) | either(2) | either(4)) | (either(6) | either(8) | either(10))
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
        if text.len() < 4 {
            let (mut len, mut width) = (0, 0);
            #[rustc_unroll(never)]
            while let Some(&unit) = text.get(len)
                && is_fixed(unit)
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
