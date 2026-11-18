use core::mem::MaybeUninit;

use bun_alloc::AllocError;

use crate::{CodeUnit, Cursor, StringRef, Text, search};

fn replace_unit<In: CodeUnit, Out: CodeUnit>(
    units: &[In],
    from: u16,
    to: u16,
) -> Result<Option<StringRef>, AllocError> {
    let Some(from) = In::from_u16(from).filter(|&from| search::find_unit(units, from).is_some())
    else {
        return Ok(None);
    };
    let to = Out::from_u16_truncating(to);
    StringRef::try_write(units.len(), |cursor| {
        cursor.push_mapped(units, |unit| {
            if unit == from {
                to
            } else {
                Out::from_u16_truncating(unit.to_u16())
            }
        });
    })
    .map(Some)
}

/// Writes `text` with `replacement` in place of the `length` units from each of `starts`.
#[inline(always)]
fn splice<T: CodeUnit>(
    text: Text<'_>,
    starts: impl Iterator<Item = usize>,
    length: usize,
    replacement: Text<'_>,
    cursor: &mut Cursor<'_, T>,
) {
    let mut kept = 0;
    for start in starts {
        cursor.push_text(text.slice(kept..start));
        cursor.push_text(replacement);
        kept = start + length;
    }
    cursor.push_text(text.slice_from(kept));
}

impl Text<'_> {
    /// `None` if nothing changes.
    #[inline(always)]
    pub fn replace_unit(self, from: u16, to: u16) -> Result<Option<StringRef>, AllocError> {
        match self {
            _ if from == to => Ok(None),
            Text::Latin1(it) if to.is_latin1() => replace_unit::<u8, u8>(it, from, to),
            Text::Latin1(it) => replace_unit::<u8, u16>(it, from, to),
            Text::Utf16(it) => replace_unit::<u16, u16>(it, from, to),
        }
    }

    /// Puts `replacement` as it is in place of each of `self.matches(needle)`. `None` if there are none.
    pub fn replace_all(
        self,
        needle: Text<'_>,
        replacement: Text<'_>,
    ) -> Result<Option<StringRef>, AllocError> {
        const REMEMBERED: usize = 64;
        let Some(start) = self.find(needle, 0) else {
            return Ok(None);
        };
        let mut matches = self.matches_from(needle, start);
        let mut starts = [MaybeUninit::uninit(); REMEMBERED];
        let (first, _) = starts.write_iter(matches.by_ref());
        let count = first.len() + matches.clone().count();
        let length = (count.checked_mul(replacement.len()))
            .and_then(|added| added.checked_add(self.len() - count * needle.len()))
            .ok_or(AllocError)?;
        let starts = first.iter().copied().chain(matches);
        if self.is_latin1() && replacement.is_latin1() {
            StringRef::try_write::<u8>(length, |it| {
                splice(self, starts, needle.len(), replacement, it);
            })
        } else {
            StringRef::try_write::<u16>(length, |it| {
                splice(self, starts, needle.len(), replacement, it);
            })
        }
        .map(Some)
    }
}
