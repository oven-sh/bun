//! Surrogate pairs of UTF-16.

use crate::set::CharRange;

pub(crate) const LEADS: CharRange = CharRange::new(0xd800, 0xdbff);
pub(crate) const TRAILS: CharRange = CharRange::new(0xdc00, 0xdfff);
pub(crate) const SURROGATES: CharRange = CharRange::new(0xd800, 0xdfff);
pub(crate) const ASTRAL: CharRange = CharRange::new(0x1_0000, 0x10_ffff);

#[inline(always)]
pub(crate) fn is_surrogate(unit: u16) -> bool {
    unit & 0xf800 == 0xd800
}

#[inline(always)]
pub(crate) fn join(lead: u16, trail: u16) -> Option<u32> {
    (lead & 0xfc00 == 0xd800 && trail & 0xfc00 == 0xdc00)
        .then(|| 0x1_0000 + (u32::from(lead & 0x3ff) << 10 | u32::from(trail & 0x3ff)))
}

#[inline]
pub(crate) fn lead_of(astral: u32) -> u16 {
    0xd7c0 + (astral >> 10) as u16
}

#[inline]
pub(crate) fn trail_of(astral: u32) -> u16 {
    0xdc00 | (astral & 0x3ff) as u16
}
