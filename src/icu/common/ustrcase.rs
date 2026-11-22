//! Case mapping of strings. An unpaired surrogate is a code point without mappings. ICU4C: ustrcase.cpp

use crate::common::brkiter::Boundaries;
use crate::common::memory::Appendable;
use crate::common::sink::{CheckedArraySink, TextSink};
use crate::common::slice_ext::SliceExt;
use crate::common::ucase::{
    self, CaseLocale, Context, FastMapping, Mapped, Mapping, Props, latin_case,
};
use crate::common::uchar::u_get_gc_mask;
use crate::common::unicode::uchar::U_GC_M_MASK;
use crate::common::utf16;

type Sink<'a> = CheckedArraySink<'a, u16>;

/// Stops at a mapping that is not simple. `text[..index]` is unchanged. Returns the output length and where it stopped.
#[inline(always)]
fn map_fast(
    mapping: &FastMapping,
    text: &[u16],
    mut index: usize,
    buffer: &mut [u16],
) -> (usize, usize) {
    let mut written = 0;
    while let Some(&unit) = text.get(index) {
        let c = u32::from(unit);
        let mapped = match mapping.latin(c) {
            Some(0) => c,
            Some(latin_case::EXC) => return (written, index),
            Some(delta) => c.wrapping_add_signed(delta.into()),
            None if c >= 0x3000 && c < 0xa000 => c, // Most of CJK.
            None if c >= 0x3000 && utf16::is_surrogate(c) => {
                let (0xd800..0xdc00, Some(&trail @ 0xdc00..0xe000)) = (c, text.get(index + 1))
                else {
                    return (written, index);
                };
                let pair = utf16::get_supplementary(c, trail.into());
                let props = Props::of(pair);
                if props.has_exception() {
                    return (written, index);
                }
                let mapped = mapping.by_delta(pair, props);
                if mapped != pair {
                    copy_if_fits(text, written, index, buffer);
                    written = index + 2;
                    if let Some([lead, trail]) = buffer.get_mut(index..written) {
                        (*lead, *trail) = (utf16::lead(mapped), utf16::trail(mapped));
                    }
                }
                index += 1;
                c
            }
            None => match mapping.simple(c, Props::of_single(unit)) {
                Some(mapped) => mapped,
                None => return (written, index),
            },
        };
        if mapped != c {
            copy_if_fits(text, written, index, buffer);
            if let Some(slot) = buffer.get_mut(index) {
                *slot = mapped as u16;
            }
            written = index + 1;
        }
        index += 1;
    }
    (written, index)
}

/// Copies `text[start..limit]` to the same range of `buffer`.
#[inline(always)]
fn copy_if_fits(text: &[u16], start: usize, limit: usize, buffer: &mut [u16]) {
    /// Out of line, so that the calling loop keeps its registers.
    #[cold]
    #[inline(never)]
    fn copy(text: &[u16], start: usize, buffer: &mut [u16]) {
        buffer.copy_at(start, text.slice(start..));
    }
    if start < limit && limit <= buffer.len() {
        if start + 1 == limit {
            buffer.set(start, text.at(start))
        } else {
            copy(text.slice(..limit), start, buffer)
        }
    }
}

#[inline(never)]
fn add_unchanged(text: &[u16], dest: &mut Sink) {
    /// Out of line, so that the single-unit case saves no registers.
    #[inline(never)]
    fn add_all(text: &[u16], dest: &mut Sink) {
        dest.add_all(text)
    }
    match *text {
        [unit] => dest.add(unit),
        _ => add_all(text, dest),
    }
}

#[inline(never)]
fn add_code_point(c: u32, dest: &mut Sink) {
    dest.add_code_point(c)
}

struct Mapper<'a, 'b> {
    mapping: FastMapping,
    /// The current character starts at `at.start`.
    at: Context<'a>,
    dest: &'a mut Sink<'b>,
    /// Start of the unchanged text that has not been written yet.
    unchanged: usize,
}

impl<'b> Mapper<'_, 'b> {
    /// Writes the unchanged text before the current character, which ends at `at.limit`.
    #[inline(always)]
    fn change(&mut self) -> &mut Sink<'b> {
        if self.unchanged < self.at.start {
            add_unchanged(self.at.text.slice(self.unchanged..self.at.start), self.dest);
        }
        self.unchanged = self.at.limit;
        self.dest
    }

    /// Maps the current character, then continues until `map_fast` can take over.
    #[cold]
    #[inline(never)]
    fn map_slow(&mut self) {
        let mut is_first = true;
        while self.at.start < self.at.text.len() {
            let mut limit = self.at.start;
            let c = utf16::next(self.at.text, &mut limit);
            self.at.limit = limit;
            match self.mapping.full(c, &self.at, is_first) {
                None => return,
                Some(Mapped::Unchanged) => {}
                Some(Mapped::CodePoint(c)) => add_code_point(c, self.change()),
                Some(Mapped::String(string)) => self.change().add_exact_iter(string.iter()),
            }
            (self.at.start, is_first) = (limit, false);
        }
    }

    /// Perf: the loop takes up to 1.5 times as long at another offset in a cache line.
    #[inline(never)]
    #[rustc_align(64)]
    fn map(&mut self) {
        let (mapping, mut rest, mut index) = (self.mapping, self.at.text, 0);
        loop {
            let (written, end) = map_fast(&mapping, rest, index, self.dest.unwritten());
            self.dest.advance(written);
            if end >= rest.len() {
                if written < end {
                    self.dest.add_all(rest.slice(written..));
                }
                return;
            }
            (self.unchanged, self.at.start) = (self.unchanged + written, self.unchanged + end);
            self.map_slow();
            (rest, index) = (
                self.at.text.slice(self.unchanged..),
                self.at.start - self.unchanged,
            );
        }
    }
}

/// Returns the length of the result. `dest` has the result if it fits.
#[inline(always)]
pub(crate) fn map(mapping: Mapping, src: &[u16], dest: &mut [u16]) -> usize {
    let mut dest = Sink::new(dest);
    if mapping == Mapping::upper(CaseLocale::Greek) {
        greek_upper::to_upper(src, &mut dest)
    } else {
        Mapper {
            mapping: mapping.to_fast(),
            at: Context {
                text: src,
                ..Context::NONE
            },
            dest: &mut dest,
            unchanged: 0,
        }
        .map()
    }
    dest.length()
}

/// Titlecases the character after each boundary.
pub(crate) fn to_title(
    locale: CaseLocale,
    boundaries: &mut Boundaries<'_>,
    src: &[u16],
) -> Vec<u16> {
    let mut dest = Vec::new();
    let mut start = boundaries.first() as usize;
    while start < src.len() {
        let limit = src.len().min(boundaries.next() as usize); // UBRK_DONE is negative.
        if start < limit {
            let (text, mut rest) = (src.slice(..limit), start);
            let c = utf16::next(text, &mut rest);
            let context = Context {
                text,
                start,
                limit: rest,
            };
            let titled_start = dest.len();
            match ucase::to_full_title_in_context(c, &context, locale) {
                Mapped::Unchanged => rest = start,
                Mapped::CodePoint(c) => dest.add_code_point(c),
                Mapped::String(string) => string.iter().for_each(|unit| dest.add(unit)),
            }
            dest.add_all(text.slice(rest..));
            if locale == CaseLocale::Dutch {
                title_dutch_ij(dest.slice_mut(titled_start..));
            }
        }
        start = limit;
    }
    dest
}

/// A plain I must be followed by a plain j, an I with acute by a j with acute. ICU4C: ustrcase.cpp, maybeTitleDutchIJ
#[cold]
fn title_dutch_ij(titled: &mut [u16]) {
    const ACUTE: u16 = 0x301;
    if let [0x49, j @ 0x6a, rest @ ..]
    | [0x49, ACUTE, j @ 0x6a, ACUTE, rest @ ..]
    | [0xcd, j @ 0x6a, ACUTE, rest @ ..] = titled
        // There must not be another combining mark.
        && u_get_gc_mask(utf16::next(rest, &mut 0)) & U_GC_M_MASK == 0
    {
        *j = 0x4a;
    }
}

/// Compares the full case foldings.
pub(crate) fn equals_ignoring_case(s1: &[u16], s2: &[u16]) -> bool {
    fn folded(s: &[u16]) -> impl Iterator<Item = u32> {
        utf16::code_points(s).flat_map(|c| {
            let (single, string) = match ucase::to_full_folding(c) {
                Mapped::Unchanged => (Some(c), None),
                Mapped::CodePoint(folded) => (Some(folded), None),
                Mapped::String(string) => (None, Some(string.iter().map(u32::from))),
            };
            single.into_iter().chain(string.into_iter().flatten())
        })
    }
    let mut equal = s1.iter().zip(s2).take_while(|(a, b)| a == b).count();
    utf16::set_cp_start(s1, &mut equal);
    utf16::set_cp_start(s2, &mut equal);
    folded(s1.slice(equal..)).eq(folded(s2.slice(equal..)))
}

/// ICU4C: ustrcase.cpp, GreekUpper
mod greek_upper {
    use super::*;

    const UPPER_MASK: u32 = 0x3ff;
    const HAS_VOWEL: u16 = 0x1000;
    const HAS_YPOGEGRAMMENI: u16 = 0x2000;
    const HAS_ACCENT: u16 = 0x4000;
    const HAS_DIALYTIKA: u16 = 0x8000;
    // Not in the letter tables.
    const HAS_COMBINING_DIALYTIKA: u32 = 0x10000;
    const HAS_OTHER_GREEK_DIACRITIC: u32 = 0x20000;

    const HAS_VOWEL_AND_ACCENT: u32 = VA as u32;
    const HAS_EITHER_DIALYTIKA: u32 = HAS_DIALYTIKA as u32 | HAS_COMBINING_DIALYTIKA;
    const HAS_VOWEL_AND_ACCENT_AND_DIALYTIKA: u32 = VAD as u32;

    const AFTER_CASED: u32 = 1;
    const AFTER_VOWEL_WITH_COMBINING_ACCENT: u32 = 2;
    const AFTER_VOWEL_WITH_PRECOMPOSED_ACCENT: u32 = 4;

    const V: u16 = HAS_VOWEL;
    const A: u16 = HAS_ACCENT;
    const D: u16 = HAS_DIALYTIKA;
    const VA: u16 = V | A;
    const VD: u16 = V | D;
    const VAD: u16 = V | A | D;
    const VY: u16 = V | HAS_YPOGEGRAMMENI;
    const VYA: u16 = VY | A;

    #[rustfmt::skip]
    static DATA0370: [u16; 144] = [
        0x370, 0x370, 0x372, 0x372, 0, 0, 0x376, 0x376,
        0, 0, 0x37a, 0x3fd, 0x3fe, 0x3ff, 0, 0x37f,
        0, 0, 0, 0, 0, 0, 0x391 | VA, 0,
        0x395 | VA, 0x397 | VA, 0x399 | VA, 0, 0x39f | VA, 0, 0x3a5 | VA, 0x3a9 | VA,
        0x399 | VAD, 0x391 | V, 0x392, 0x393, 0x394, 0x395 | V, 0x396, 0x397 | V,
        0x398, 0x399 | V, 0x39a, 0x39b, 0x39c, 0x39d, 0x39e, 0x39f | V,
        0x3a0, 0x3a1, 0, 0x3a3, 0x3a4, 0x3a5 | V, 0x3a6, 0x3a7,
        0x3a8, 0x3a9 | V, 0x399 | VD, 0x3a5 | VD, 0x391 | VA, 0x395 | VA, 0x397 | VA, 0x399 | VA,
        0x3a5 | VAD, 0x391 | V, 0x392, 0x393, 0x394, 0x395 | V, 0x396, 0x397 | V,
        0x398, 0x399 | V, 0x39a, 0x39b, 0x39c, 0x39d, 0x39e, 0x39f | V,
        0x3a0, 0x3a1, 0x3a3, 0x3a3, 0x3a4, 0x3a5 | V, 0x3a6, 0x3a7,
        0x3a8, 0x3a9 | V, 0x399 | VD, 0x3a5 | VD, 0x39f | VA, 0x3a5 | VA, 0x3a9 | VA, 0x3cf,
        0x392, 0x398, 0x3d2, 0x3d2 | A, 0x3d2 | D, 0x3a6, 0x3a0, 0x3cf,
        0x3d8, 0x3d8, 0x3da, 0x3da, 0x3dc, 0x3dc, 0x3de, 0x3de,
        0x3e0, 0x3e0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0x39a, 0x3a1, 0x3f9, 0x37f, 0x3f4, 0x395 | V, 0, 0x3f7,
        0x3f7, 0x3f9, 0x3fa, 0x3fa, 0x3fc, 0x3fd, 0x3fe, 0x3ff,
    ];

    #[rustfmt::skip]
    static DATA1F00: [u16; 256] = [
        0x391 | V, 0x391 | V, 0x391 | VA, 0x391 | VA, 0x391 | VA, 0x391 | VA, 0x391 | VA, 0x391 | VA,
        0x391 | V, 0x391 | V, 0x391 | VA, 0x391 | VA, 0x391 | VA, 0x391 | VA, 0x391 | VA, 0x391 | VA,
        0x395 | V, 0x395 | V, 0x395 | VA, 0x395 | VA, 0x395 | VA, 0x395 | VA, 0, 0,
        0x395 | V, 0x395 | V, 0x395 | VA, 0x395 | VA, 0x395 | VA, 0x395 | VA, 0, 0,
        0x397 | V, 0x397 | V, 0x397 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VA,
        0x397 | V, 0x397 | V, 0x397 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VA,
        0x399 | V, 0x399 | V, 0x399 | VA, 0x399 | VA, 0x399 | VA, 0x399 | VA, 0x399 | VA, 0x399 | VA,
        0x399 | V, 0x399 | V, 0x399 | VA, 0x399 | VA, 0x399 | VA, 0x399 | VA, 0x399 | VA, 0x399 | VA,
        0x39f | V, 0x39f | V, 0x39f | VA, 0x39f | VA, 0x39f | VA, 0x39f | VA, 0, 0,
        0x39f | V, 0x39f | V, 0x39f | VA, 0x39f | VA, 0x39f | VA, 0x39f | VA, 0, 0,
        0x3a5 | V, 0x3a5 | V, 0x3a5 | VA, 0x3a5 | VA, 0x3a5 | VA, 0x3a5 | VA, 0x3a5 | VA, 0x3a5 | VA,
        0, 0x3a5 | V, 0, 0x3a5 | VA, 0, 0x3a5 | VA, 0, 0x3a5 | VA,
        0x3a9 | V, 0x3a9 | V, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA,
        0x3a9 | V, 0x3a9 | V, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VA,
        0x391 | VA, 0x391 | VA, 0x395 | VA, 0x395 | VA, 0x397 | VA, 0x397 | VA, 0x399 | VA, 0x399 | VA,
        0x39f | VA, 0x39f | VA, 0x3a5 | VA, 0x3a5 | VA, 0x3a9 | VA, 0x3a9 | VA, 0, 0,
        0x391 | VY, 0x391 | VY, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA,
        0x391 | VY, 0x391 | VY, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA, 0x391 | VYA,
        0x397 | VY, 0x397 | VY, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA,
        0x397 | VY, 0x397 | VY, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA, 0x397 | VYA,
        0x3a9 | VY, 0x3a9 | VY, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA,
        0x3a9 | VY, 0x3a9 | VY, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA, 0x3a9 | VYA,
        0x391 | V, 0x391 | V, 0x391 | VYA, 0x391 | VY, 0x391 | VYA, 0, 0x391 | VA, 0x391 | VYA,
        0x391 | V, 0x391 | V, 0x391 | VA, 0x391 | VA, 0x391 | VY, 0, 0x399 | V, 0,
        0, 0, 0x397 | VYA, 0x397 | VY, 0x397 | VYA, 0, 0x397 | VA, 0x397 | VYA,
        0x395 | VA, 0x395 | VA, 0x397 | VA, 0x397 | VA, 0x397 | VY, 0, 0, 0,
        0x399 | V, 0x399 | V, 0x399 | VAD, 0x399 | VAD, 0, 0, 0x399 | VA, 0x399 | VAD,
        0x399 | V, 0x399 | V, 0x399 | VA, 0x399 | VA, 0, 0, 0, 0,
        0x3a5 | V, 0x3a5 | V, 0x3a5 | VAD, 0x3a5 | VAD, 0x3a1, 0x3a1, 0x3a5 | VA, 0x3a5 | VAD,
        0x3a5 | V, 0x3a5 | V, 0x3a5 | VA, 0x3a5 | VA, 0x3a1, 0, 0, 0,
        0, 0, 0x3a9 | VYA, 0x3a9 | VY, 0x3a9 | VYA, 0, 0x3a9 | VA, 0x3a9 | VYA,
        0x39f | VA, 0x39f | VA, 0x3a9 | VA, 0x3a9 | VA, 0x3a9 | VY, 0, 0, 0,
    ];

    const DATA2126: u16 = 0x3a9 | V;

    #[inline(always)]
    fn get_letter_data(c: u32) -> u32 {
        u32::from(match c {
            0x370..0x400 => DATA0370.at(c as usize - 0x370),
            0x1f00..0x2000 => DATA1F00.at(c as usize - 0x1f00),
            0x2126 => DATA2126,
            _ => 0,
        })
    }

    fn get_diacritic_data(c: u16) -> u32 {
        match c {
            // varia, tonos, perispomeni and its look-alikes
            0x0300 | 0x0301 | 0x0342 | 0x0302 | 0x0303 | 0x0311 => HAS_ACCENT.into(),
            0x0308 => HAS_COMBINING_DIALYTIKA,
            0x0344 => HAS_COMBINING_DIALYTIKA | u32::from(HAS_ACCENT),
            0x0345 => HAS_YPOGEGRAMMENI.into(),
            0x0304 | 0x0306 | 0x0313 | 0x0314 | 0x0343 => HAS_OTHER_GREEK_DIACRITIC,
            _ => 0,
        }
    }

    #[inline(never)]
    pub(super) fn to_upper(src: &[u16], dest: &mut Sink) {
        let mut state = 0;
        let mut i = 0;
        while i < src.len() {
            let mut next_index = i;
            let c = utf16::next(src, &mut next_index);
            let mut next_state = 0;
            let props = Props::of(c);
            if props.is_case_ignorable() {
                next_state |= state & AFTER_CASED;
            } else if props.is_cased() {
                next_state |= AFTER_CASED;
            }
            let mut data = get_letter_data(c);
            if data > 0 {
                // An iota or ypsilon gains a dialytika if the previous vowel lost its tonos and has no dialytika.
                if data & u32::from(HAS_VOWEL) != 0 && matches!(data & UPPER_MASK, 0x399 | 0x3a5) {
                    if state & AFTER_VOWEL_WITH_PRECOMPOSED_ACCENT != 0 {
                        data |= u32::from(HAS_DIALYTIKA);
                    } else if state & AFTER_VOWEL_WITH_COMBINING_ACCENT != 0 {
                        data |= HAS_COMBINING_DIALYTIKA;
                    }
                }
                // Each becomes a trailing capital iota.
                let mut num_ypogegrammeni = usize::from(data & u32::from(HAS_YPOGEGRAMMENI) != 0);
                let has_precomposed_accent = data & u32::from(HAS_ACCENT) != 0;
                while let Some(diacritic_data @ 1..) =
                    src.get(next_index).copied().map(get_diacritic_data)
                {
                    data |= diacritic_data;
                    num_ypogegrammeni +=
                        usize::from(diacritic_data & u32::from(HAS_YPOGEGRAMMENI) != 0);
                    next_index += 1;
                }
                if data & HAS_VOWEL_AND_ACCENT_AND_DIALYTIKA == HAS_VOWEL_AND_ACCENT {
                    next_state |= if has_precomposed_accent {
                        AFTER_VOWEL_WITH_PRECOMPOSED_ACCENT
                    } else {
                        AFTER_VOWEL_WITH_COMBINING_ACCENT
                    };
                }
                let mut upper = (data & UPPER_MASK) as u16;
                let mut has_dialytika = data & HAS_EITHER_DIALYTIKA != 0;
                let mut add_tonos = false;
                if upper == 0x397
                    && data & u32::from(HAS_ACCENT) != 0
                    && num_ypogegrammeni == 0
                    && state & AFTER_CASED == 0
                    && !ucase::starts_with_cased_letter(utf16::code_points(src.slice(next_index..)))
                {
                    // The disjunctive "or" keeps its tonos.
                    if has_precomposed_accent {
                        upper = 0x389;
                    } else {
                        add_tonos = true;
                    }
                } else if data & u32::from(HAS_DIALYTIKA) != 0 && matches!(upper, 0x399 | 0x3a5) {
                    upper = if upper == 0x399 { 0x3aa } else { 0x3ab };
                    has_dialytika = false;
                }

                dest.add(upper);
                if has_dialytika {
                    dest.add(0x308);
                }
                if add_tonos {
                    dest.add(0x301);
                }
                (0..num_ypogegrammeni).for_each(|_| dest.add(0x399));
            } else {
                match ucase::to_full_upper(c) {
                    Mapped::Unchanged => add_unchanged(src.slice(i..next_index), dest),
                    Mapped::CodePoint(c) => add_code_point(c, dest),
                    Mapped::String(string) => dest.add_exact_iter(string.iter()),
                }
            }
            (i, state) = (next_index, next_state);
        }
    }
}
