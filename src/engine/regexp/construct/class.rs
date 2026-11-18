use core::mem::take;

use bun_engine_unicode::{IgnoreCase, Property};

use super::Builder;
use super::strings::{StringList, StringPool, Strings};
use crate::parser::{ClassEscape, SetOperator, Sink};
use crate::set::{Set, SetBuilder, SharedSet};
use crate::{Error, Flags};

/// The single characters of it.
#[inline]
pub(super) fn set_of_escape(escape: ClassEscape, flags: Flags) -> Result<Set, Error> {
    let folds_case = flags.contains(Flags::IGNORE_CASE) && flags.is_unicode_aware();
    let shared = match escape {
        ClassEscape::Digit => return Ok(Set::DIGIT),
        ClassEscape::NotDigit => return Ok(Set::NOT_DIGIT),
        ClassEscape::Word if folds_case => return Ok(Set::WORD_IGNORING_CASE),
        ClassEscape::Word => return Ok(Set::WORD),
        ClassEscape::NotWord if folds_case => return Ok(Set::WORD_IGNORING_CASE.complement()?),
        ClassEscape::NotWord => return Ok(Set::NOT_WORD),
        ClassEscape::Space => SharedSet::space(),
        ClassEscape::NotSpace => SharedSet::space().complement(),
        ClassEscape::Property(property) if folds_case => {
            SharedSet::of_property(property).closed_over_case()
        }
        ClassEscape::Property(property) => SharedSet::of_property(property),
        ClassEscape::NotProperty(property) => {
            let set = SharedSet::of_property(property);
            match (folds_case, flags.contains(Flags::UNICODE_SETS)) {
                (false, _) => set.complement(),
                (true, false) => set.complement().closed_over_case(),
                (true, true) => set.closed_over_case().complement(),
            }
        }
    };
    Ok(shared.to_set())
}

/// More than a pattern takes that does not go through the same large sets again and again.
const MAX_STEPS: usize = 1 << 25;

#[derive(Default)]
struct Steps(usize);

impl Steps {
    #[inline]
    fn spend(&mut self, steps: usize) -> Result<(), Error> {
        self.0 += steps;
        match self.0 <= MAX_STEPS {
            true => Ok(()),
            false => Err(Error::PatternTooLarge),
        }
    }
}

struct Members {
    characters: Set,
    strings: StringList,
}

/// What a class has besides single characters.
#[derive(Default)]
struct Operands {
    strings: StringList,
    left: Option<(Members, SetOperator)>,
}

/// What only the flag `v` needs.
#[derive(Default)]
struct SetNotation {
    operands: Operands,
    outer: Vec<(SetBuilder, Operands)>,
    pool: StringPool,
}

/// The class that is open, and those around it.
#[derive(Default)]
pub(super) struct Classes {
    characters: SetBuilder,
    set_notation: Option<Box<SetNotation>>,
    steps: Steps,
}

impl Classes {
    #[inline]
    pub(super) fn add_character(&mut self, c: u32) -> Result<(), Error> {
        Ok(self.characters.add(c)?)
    }

    #[inline]
    pub(super) fn add_range(&mut self, first: u32, last: u32) -> Result<(), Error> {
        Ok(self.characters.add_range(first, last)?)
    }

    #[inline]
    pub(super) fn add_escape(&mut self, escape: ClassEscape, flags: Flags) -> Result<(), Error> {
        self.characters.add_set(&set_of_escape(escape, flags)?)?;
        match escape {
            ClassEscape::Property(property) if property.has_strings() => {
                self.add_strings_of(property, flags.contains(Flags::IGNORE_CASE))
            }
            _ => Ok(()),
        }
    }

    fn add_strings_of(&mut self, property: Property, ignores_case: bool) -> Result<(), Error> {
        let SetNotation { operands, pool, .. } = &mut **self.set_notation.get_or_insert_default();
        let mut strings = property.strings();
        while let Some(string) = strings.next() {
            for &c in string {
                pool.push(match ignores_case {
                    true => IgnoreCase::CodePoints.canonicalize(c),
                    false => c,
                })?;
            }
            operands.strings.push(pool.end_string())?;
            self.steps.spend(string.len())?;
        }
        Ok(())
    }

    pub(super) fn extend_string(&mut self, c: u32) -> Result<(), Error> {
        self.set_notation.get_or_insert_default().pool.push(c)
    }

    pub(super) fn close_string(&mut self) -> Result<(), Error> {
        let SetNotation { operands, pool, .. } = &mut **self.set_notation.get_or_insert_default();
        match pool.take_single_character() {
            Some(c) => self.add_character(c),
            None => operands.strings.push(pool.end_string()),
        }
    }

    pub(super) fn open_nested(&mut self) -> Result<(), Error> {
        let SetNotation {
            operands, outer, ..
        } = &mut **self.set_notation.get_or_insert_default();
        outer.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
        outer.push((take(&mut self.characters), take(operands)));
        Ok(())
    }

    pub(super) fn close_nested(
        &mut self,
        negated: bool,
        ignore_case: Option<IgnoreCase>,
    ) -> Result<(), Error> {
        let members = self.members(negated, ignore_case)?;
        let SetNotation {
            operands, outer, ..
        } = &mut **self.set_notation.get_or_insert_default();
        (self.characters, *operands) = outer.pop().unwrap_or_default();
        self.characters.add_set(&members.characters)?;
        self.steps
            .spend(self.characters.take_steps() + members.strings.len())?;
        operands.strings.append(members.strings)
    }

    pub(super) fn set_operator(
        &mut self,
        operator: SetOperator,
        ignore_case: Option<IgnoreCase>,
    ) -> Result<(), Error> {
        let left = self.members(false, ignore_case)?;
        self.set_notation.get_or_insert_default().operands.left = Some((left, operator));
        Ok(())
    }

    #[inline]
    pub(super) fn has_only_characters(&self) -> bool {
        self.set_notation.is_none()
    }

    /// If it has nothing else.
    #[inline]
    pub(super) fn close_characters(
        &mut self,
        negated: bool,
        ignore_case: Option<IgnoreCase>,
    ) -> Result<Set, Error> {
        let set = self.characters.finish(ignore_case)?;
        self.steps.spend(self.characters.take_steps())?;
        Ok(if negated { set.complement()? } else { set })
    }

    pub(super) fn close(
        &mut self,
        negated: bool,
        ignore_case: Option<IgnoreCase>,
    ) -> Result<(Set, Strings), Error> {
        let members = self.members(negated, ignore_case)?;
        let pool = self.set_notation.take().unwrap_or_default().pool;
        Ok((members.characters, Strings::new(pool, members.strings)))
    }

    /// Leaves the class empty. One that is negated has no strings.
    fn members(
        &mut self,
        negated: bool,
        ignore_case: Option<IgnoreCase>,
    ) -> Result<Members, Error> {
        let characters = self.close_characters(false, ignore_case)?;
        let SetNotation { operands, pool, .. } = &mut **self.set_notation.get_or_insert_default();
        let Operands { strings, left } = take(operands);
        let mut members = Members {
            characters,
            strings,
        };
        if let Some((left, operator)) = left {
            members = combine(left, operator, members, pool, &mut self.steps)?;
        }
        if negated {
            self.steps.spend(members.characters.owned_ranges())?;
            members.characters = members.characters.complement()?;
        }
        Ok(members)
    }
}

fn combine(
    left: Members,
    operator: SetOperator,
    right: Members,
    pool: &StringPool,
    steps: &mut Steps,
) -> Result<Members, Error> {
    steps.spend(left.characters.above().len() + right.characters.above().len())?;
    let characters = match operator {
        SetOperator::Intersection => left.characters.intersection(&right.characters)?,
        SetOperator::Subtraction => left.characters.difference(&right.characters)?,
    };
    let mut strings = left.strings;
    let keeps_common = operator == SetOperator::Intersection;
    steps.spend(strings.filter(right.strings, keeps_common, pool))?;
    Ok(Members {
        characters,
        strings,
    })
}

impl Builder<'_> {
    /// As text where that says the same.
    #[inline]
    pub(super) fn add_class(&mut self, set: Set) -> Result<(), Error> {
        if let Some(c) = set.single() {
            return self.character(c);
        }
        if let Some(letter) = set.latin1().only_ascii_letter()
            && set.above().is_empty()
        {
            let equivalence = self.tree.case_equivalence();
            if equivalence == IgnoreCase::CodeUnits || !matches!(letter, b'k' | b's') {
                self.start_text(true)?;
                let canonical = equivalence.canonicalize(letter.into());
                self.text_end = self.tree.push_char(canonical)?;
                return Ok(());
            }
        }
        self.add_set(set)
    }
}
