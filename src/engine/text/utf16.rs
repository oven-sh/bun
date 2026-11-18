use bun_alloc::AllocError;
use bun_simdutf_sys::simdutf;

use crate::block::{self, Pairs, Units};
use crate::{CodeUnit, StringRef, Text};

/// Up to here the vector code does not make up for the call.
const SHORT: usize = 32;

#[inline]
fn is_well_formed(units: &[u16]) -> bool {
    if units.len() > SHORT && !cfg!(miri) {
        return simdutf::validate::utf16le(units);
    }
    !block::any(Units(units, u16::is_surrogate)) || has_only_pairs(units)
}

#[inline(always)]
pub(crate) fn has_only_pairs(units: &[u16]) -> bool {
    let (Some(first), Some(last)) = (units.first(), units.last()) else {
        return true;
    };
    let mismatches = Pairs::new(units, &units[1..], |a: u16, b: u16| {
        a.is_lead_surrogate() != b.is_trail_surrogate()
    });
    !first.is_trail_surrogate() && !last.is_lead_surrogate() && !block::any(mismatches)
}

impl Text<'_> {
    /// IsStringWellFormedUnicode of ECMA-262.
    #[inline(always)]
    pub fn is_well_formed(self) -> bool {
        match self {
            Text::Latin1(_) => true,
            Text::Utf16(units) => is_well_formed(units),
        }
    }

    /// Each lone surrogate becomes U+FFFD. `None` if there is none.
    pub fn to_well_formed(self) -> Result<Option<StringRef>, AllocError> {
        match self {
            Text::Utf16(units) if !is_well_formed(units) => {
                StringRef::try_write(units.len(), |cursor| {
                    cursor.lend(|it| simdutf::convert::utf16::to::well_formed_le(units, it));
                })
                .map(Some)
            }
            _ => Ok(None),
        }
    }
}
