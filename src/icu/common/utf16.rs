//! The `U16_*` macros with a `start` of 0. A read outside the slice yields 0. ICU4C: unicode/utf16.h

/// Widens each byte to a code unit, for string constants.
#[expect(clippy::indexing_slicing, reason = "`i` is below `N`")]
pub(crate) const fn from_latin1<const N: usize>(text: &[u8; N]) -> [u16; N] {
    let (mut units, mut i) = ([0; N], 0);
    while i < N {
        units[i] = text[i] as u16;
        i += 1;
    }
    units
}

#[inline(always)]
pub(crate) fn is_lead(c: u32) -> bool {
    c & 0xffff_fc00 == 0xd800
}

#[inline(always)]
pub(crate) fn is_trail(c: u32) -> bool {
    c & 0xffff_fc00 == 0xdc00
}

#[inline(always)]
pub(crate) fn is_surrogate(c: u32) -> bool {
    c & 0xffff_f800 == 0xd800
}

/// Requires that `c` is a surrogate.
#[inline(always)]
pub(crate) fn is_surrogate_lead(c: u32) -> bool {
    c & 0x400 == 0
}

#[inline(always)]
pub(crate) fn get_supplementary(lead: u32, trail: u32) -> u32 {
    (lead << 10)
        .wrapping_add(trail)
        .wrapping_sub((0xd800 << 10) + 0xdc00 - 0x10000)
}

#[inline(always)]
pub(crate) fn lead(c: u32) -> u16 {
    ((c >> 10) + 0xd7c0) as u16
}

#[inline(always)]
pub(crate) fn trail(c: u32) -> u16 {
    ((c & 0x3ff) | 0xdc00) as u16
}

#[inline(always)]
pub(crate) fn length(c: u32) -> usize {
    if c <= 0xffff { 1 } else { 2 }
}

#[inline(always)]
pub(crate) fn next(s: &[u16], i: &mut usize) -> u32 {
    let mut c = u32::from(s.get(*i).copied().unwrap_or(0));
    *i += 1;
    if is_lead(c)
        && let Some(&c2) = s.get(*i)
        && is_trail(u32::from(c2))
    {
        *i += 1;
        c = get_supplementary(c, u32::from(c2));
    }
    c
}

#[inline(always)]
pub(crate) fn prev(s: &[u16], i: &mut usize) -> u32 {
    *i = i.saturating_sub(1);
    let mut c = u32::from(s.get(*i).copied().unwrap_or(0));
    if is_trail(c)
        && let Some(&c2) = s.get(i.wrapping_sub(1))
        && is_lead(u32::from(c2))
    {
        *i -= 1;
        c = get_supplementary(u32::from(c2), c);
    }
    c
}

/// Returns the code point that contains the unit at `i`.
#[inline]
pub(crate) fn get(s: &[u16], i: usize) -> u32 {
    let c = u32::from(s.get(i).copied().unwrap_or(0));
    if is_surrogate(c) {
        if is_surrogate_lead(c) {
            if let Some(&c2) = s.get(i + 1)
                && is_trail(u32::from(c2))
            {
                return get_supplementary(c, u32::from(c2));
            }
        } else if let Some(&c2) = s.get(i.wrapping_sub(1))
            && is_lead(u32::from(c2))
        {
            return get_supplementary(u32::from(c2), c);
        }
    }
    c
}

#[inline]
pub(crate) fn fwd_1(s: &[u16], i: &mut usize) {
    next(s, i);
}

/// Moves forward by `n` code points, or to the end.
pub(crate) fn fwd_n(s: &[u16], i: &mut usize, mut n: usize) {
    while n > 0 && *i < s.len() {
        fwd_1(s, i);
        n -= 1;
    }
}

#[inline]
pub(crate) fn back_1(s: &[u16], i: &mut usize) {
    prev(s, i);
}

/// Returns whether `i` is the index of the second unit of a surrogate pair.
#[inline]
pub(crate) fn splits_pair(s: &[u16], i: usize) -> bool {
    matches!(s.get(i.wrapping_sub(1)..), Some(&[lead, trail, ..]) if is_trail(trail.into()) && is_lead(lead.into()))
}

#[inline]
pub(crate) fn set_cp_start(s: &[u16], i: &mut usize) {
    *i -= usize::from(splits_pair(s, *i));
}

/// Returns a double-ended iterator over the code points of `s`. An unpaired surrogate counts as a code point.
pub(crate) fn code_points(s: &[u16]) -> CodePoints<'_> {
    CodePoints(s)
}

#[derive(Clone)]
pub(crate) struct CodePoints<'a>(&'a [u16]);

impl Iterator for CodePoints<'_> {
    type Item = u32;

    #[inline]
    fn next(&mut self) -> Option<u32> {
        let (&first, rest) = self.0.split_first()?;
        if let (true, Some((&second, rest))) = (is_lead(u32::from(first)), rest.split_first())
            && is_trail(u32::from(second))
        {
            self.0 = rest;
            return Some(get_supplementary(u32::from(first), u32::from(second)));
        }
        self.0 = rest;
        Some(u32::from(first))
    }
}

impl DoubleEndedIterator for CodePoints<'_> {
    #[inline]
    fn next_back(&mut self) -> Option<u32> {
        let (&last, rest) = self.0.split_last()?;
        if let (true, Some((&before, rest))) = (is_trail(u32::from(last)), rest.split_last())
            && is_lead(u32::from(before))
        {
            self.0 = rest;
            return Some(get_supplementary(u32::from(before), u32::from(last)));
        }
        self.0 = rest;
        Some(u32::from(last))
    }
}
