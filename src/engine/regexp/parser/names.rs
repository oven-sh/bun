use std::collections::BTreeMap;
use std::rc::Rc;

use bun_engine_text::{CodeUnit, Text};
use bun_engine_unicode::{is_identifier_part, is_identifier_start};
use smallvec::SmallVec;

use super::{Cursor, NameId, try_push};
use crate::Error;
use crate::tree::Group;

#[derive(Clone)]
pub(super) enum Name<'a> {
    Source(Text<'a>),
    Unescaped(Rc<[u16]>),
}

impl Name<'_> {
    #[inline]
    pub(super) fn text(&self) -> Text<'_> {
        match self {
            Name::Source(text) => *text,
            Name::Unescaped(units) => Text::Utf16(units),
        }
    }
}

impl PartialEq for Name<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.text() == other.text()
    }
}

impl Eq for Name<'_> {}

impl PartialOrd for Name<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Name<'_> {
    fn cmp(&self, other: &Self) -> core::cmp::Ordering {
        self.text().cmp(&other.text())
    }
}

const NAMES_COMPARED_IN_TURN: usize = 8;

#[derive(Default)]
pub(super) struct Names<'a> {
    /// With the last group so far that has the name.
    entries: SmallVec<[(Name<'a>, Option<Group>); NAMES_COMPARED_IN_TURN]>,
    /// Of those after the first few.
    index: BTreeMap<Name<'a>, NameId>,
}

impl<'a> Names<'a> {
    pub(super) fn find_or_add(&mut self, name: Name<'a>) -> Result<NameId, Error> {
        let mut first = self.entries.iter().take(NAMES_COMPARED_IN_TURN);
        if let Some(id) = first.position(|(known, _)| *known == name) {
            return Ok(id as NameId);
        }
        let new = self.entries.len() as NameId;
        if self.entries.len() >= NAMES_COMPARED_IN_TURN {
            let id = *self.index.entry(name.clone()).or_insert(new);
            if id != new {
                return Ok(id);
            }
        }
        try_push(&mut self.entries, (name, None))?;
        Ok(new)
    }

    pub(super) fn text(&self, id: NameId) -> Text<'_> {
        self.entries[id as usize].0.text()
    }

    pub(super) fn last_group(&mut self, id: NameId) -> &mut Option<Group> {
        &mut self.entries[id as usize].1
    }

    pub(super) fn all_have_groups(&self) -> bool {
        self.entries.iter().all(|(_, group)| group.is_some())
    }
}

impl<'a, C: CodeUnit> Cursor<'a, C> {
    /// From after `<` to after `>`, or nowhere if there is no name.
    #[inline(never)]
    pub(super) fn group_name(&mut self) -> Result<Option<Name<'a>>, Error> {
        let start = self.at;
        let mut unescaped: Option<Vec<u16>> = None;
        while let Some(unit) = self.next_unit() {
            let before = &self.units[start..self.at - 1];
            if unit == u32::from(b'>') && !before.is_empty() {
                return Ok(Some(match unescaped {
                    Some(units) => Name::Unescaped(units.into()),
                    None => Name::Source(C::text(before)),
                }));
            }
            let c = if unit == u32::from(b'\\') {
                unescaped.get_or_insert_with(|| before.iter().map(|unit| unit.to_u16()).collect());
                if !self.eat(b'u') {
                    return Err(Error::InvalidUnicodeEscape);
                }
                self.strict_unicode_escape()?
            } else {
                self.complete_pair(unit)
            };
            let is_valid = match before.is_empty() {
                true => is_identifier_start(c),
                false => is_identifier_part(c),
            };
            let Some(c) = char::from_u32(c).filter(|_| is_valid) else {
                break;
            };
            if let Some(units) = &mut unescaped {
                units.extend_from_slice(c.encode_utf16(&mut [0; 2]));
            }
        }
        self.at = start;
        Ok(None)
    }
}
