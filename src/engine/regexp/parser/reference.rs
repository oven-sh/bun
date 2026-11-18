use bun_engine_text::CodeUnit;

use super::group::Relation;
use super::names::Name;
use super::scan::{GroupTotals, group_totals};
use super::{Cursor, Parser, Sink};
use crate::Error;
use crate::tree::{Group, Groups, MAX_GROUPS};

impl<'a, S: Sink> Parser<'a, S> {
    fn totals<C: CodeUnit>(&mut self, units: &[C]) -> GroupTotals {
        *self.totals.get_or_insert_with(|| group_totals(units))
    }

    /// At the first digit. False, with the cursor where it was, if the digits are an escape of B.1.2.
    #[inline(never)]
    pub(super) fn back_reference<C: CodeUnit>(
        &mut self,
        cursor: &mut Cursor<C>,
    ) -> Result<bool, Error> {
        let start = cursor.at;
        let number = cursor.decimal().and_then(|it| u32::try_from(it).ok());
        let number = number.unwrap_or(u32::MAX);
        let is_known = number <= u32::from(self.group_count);
        if !is_known && !cursor.is_unicode && number > self.totals(cursor.units).count {
            cursor.at = start;
            return Ok(false);
        }
        self.highest_reference = self.highest_reference.max(number);
        let group = Group::try_from(number)
            .ok()
            .filter(|&group| match is_known {
                true => matches!(
                    self.relation(group),
                    Relation::Sibling {
                        is_backward: false,
                        ..
                    }
                ),
                false => self.open_lookbehinds > 0,
            });
        self.sink.back_reference(group)?;
        Ok(true)
    }

    /// At the `k`. False, with the cursor where it was, if it stands for itself.
    #[inline(never)]
    pub(super) fn named_reference<C: CodeUnit>(
        &mut self,
        cursor: &mut Cursor<'a, C>,
    ) -> Result<bool, Error> {
        let start = cursor.at;
        cursor.at += 1;
        if cursor.eat(b'<')
            && (cursor.is_unicode || self.has_named_groups || self.totals(cursor.units).has_names)
            && let Some(name) = cursor.group_name()?
        {
            self.refer_to(name)?;
            return Ok(true);
        }
        cursor.at = start;
        Ok(false)
    }

    fn refer_to(&mut self, name: Name<'a>) -> Result<(), Error> {
        let names = self.names.get_or_insert_default();
        let name = names.find_or_add(name)?;
        let last = *names.last_group(name);
        match last.map(|last| (last, self.relation(last))) {
            Some((
                last,
                Relation::Sibling {
                    first_sibling: first,
                    is_backward: false,
                },
            )) => {
                let end = last + 1;
                self.sink.named_reference(name, Groups { first, end })
            }
            None | Some((_, Relation::Exclusive)) if self.open_lookbehinds > 0 => {
                let (first, end) = (1, MAX_GROUPS + 1);
                self.sink.named_reference(name, Groups { first, end })
            }
            _ => self.sink.back_reference(None),
        }
    }
}
