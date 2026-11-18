//! What `RegExp.lastMatch`, `RegExp.$1` and their kin are made from when a script asks.

use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_macros::Trace;

use super::match_all::AtomCount;
use crate::{
    CaptureBuffer, Cx, Field, Gc, GlobalObject, JsResult, JsString, Match, RegExp, StringView,
};

const NUMBERED_GROUPS: usize = 9;

#[derive(Trace)]
#[repr(C)]
pub struct RegExpGlobalState {
    regexp: Field<Option<Gc<RegExp>>>,
    subject: Field<Option<Gc<JsString>>>,
    found: Cell<Match>,
    /// Which of `groups` and `input` go with this match.
    known: Cell<u8>,
    is_multiline: Cell<bool>,
    /// The first nine and the last. Empty if there is no such group, or it has taken no part.
    groups: Cell<[Match; NUMBERED_GROUPS + 1]>,
    /// What a script has assigned.
    input: Field<Option<Gc<JsString>>>,
    pub(super) atom_count: AtomCount,
}

const GROUPS: u8 = 1;
const INPUT: u8 = 2;

impl Default for RegExpGlobalState {
    fn default() -> RegExpGlobalState {
        RegExpGlobalState {
            regexp: Field::new(None),
            subject: Field::new(None),
            found: Cell::default(),
            known: Cell::new(0),
            is_multiline: Cell::new(false),
            groups: Cell::default(),
            input: Field::new(None),
            atom_count: AtomCount::default(),
        }
    }
}

impl RegExpGlobalState {
    /// A match is recorded by storing all four, followed by the write barrier of the global object.
    pub const OFFSET_OF_REGEXP: usize = offset_of!(RegExpGlobalState, regexp);
    /// The string as it was passed, rope or not.
    pub const OFFSET_OF_SUBJECT: usize = offset_of!(RegExpGlobalState, subject);
    /// The start and the end, 32 bits each, inside the subject.
    pub const OFFSET_OF_FOUND: usize = offset_of!(RegExpGlobalState, found);
    /// A byte that a new match sets to zero.
    pub const OFFSET_OF_KNOWN: usize = offset_of!(RegExpGlobalState, known);
}

impl GlobalObject {
    /// `found` is what a search from its start finds.
    #[inline(always)]
    pub(super) fn record_match(&self, regexp: &RegExp, subject: Gc<JsString>, found: Match) {
        let state = self.regexp_state();
        // SAFETY: the barrier follows.
        unsafe {
            state.regexp.set_without_barrier(Some(regexp.into()));
            state.subject.set_without_barrier(Some(subject));
        }
        state.found.set(found);
        state.known.set(0);
        self.write_barrier_for_cell();
    }

    #[cfg(debug_assertions)]
    pub(crate) fn last_match_as_words(&self) -> [u64; 4] {
        let state = self.regexp_state();
        [
            state.regexp.get().map_or(0, Gc::address) as u64,
            state.subject.get().map_or(0, Gc::address) as u64,
            state.found.get().start.into(),
            state.found.get().end.into(),
        ]
    }

    pub fn is_regexp_multiline(&self) -> &Cell<bool> {
        &self.regexp_state().is_multiline
    }

    pub fn set_regexp_input(&self, input: Gc<JsString>) {
        let state = self.regexp_state();
        // SAFETY: a part of the cell.
        unsafe { state.input.set(self, Some(input)) };
        state.known.update(|known| known | INPUT);
    }
}

impl Cx {
    fn last_subject(&self) -> Gc<JsString> {
        let subject = self.global().regexp_state().subject.get();
        subject.unwrap_or_else(|| self.small_strings.empty())
    }

    pub fn regexp_input(&self) -> Gc<JsString> {
        let global = self.global();
        let state = global.regexp_state();
        let assigned = state.input.get().filter(|_| state.known.get() & INPUT != 0);
        assigned.unwrap_or_else(|| self.last_subject())
    }

    pub fn regexp_last_match(&self) -> JsResult<Gc<JsString>> {
        let found = self.global().regexp_state().found.get();
        self.last_subject().substring(self, found.start, found.end)
    }

    pub fn regexp_left_context(&self) -> JsResult<Gc<JsString>> {
        let found = self.global().regexp_state().found.get();
        self.last_subject().substring(self, 0, found.start)
    }

    pub fn regexp_right_context(&self) -> JsResult<Gc<JsString>> {
        let (found, subject) = (
            self.global().regexp_state().found.get(),
            self.last_subject(),
        );
        subject.substring(self, found.end, subject.len())
    }

    /// `number` is from 1 to 9.
    pub fn regexp_last_group(&self, number: usize) -> JsResult<Gc<JsString>> {
        self.recorded_group(number - 1)
    }

    pub fn regexp_last_paren(&self) -> JsResult<Gc<JsString>> {
        self.recorded_group(NUMBERED_GROUPS)
    }

    fn recorded_group(&self, index: usize) -> JsResult<Gc<JsString>> {
        let (global, subject) = (self.global(), self.last_subject().view(self)?);
        let state = global.regexp_state();
        if state.known.get() & GROUPS == 0 {
            state.groups.set(self.match_again(state, &subject)?);
            state.known.update(|known| known | GROUPS);
        }
        Ok(subject.substring(self, state.groups.get()[index].range()))
    }

    fn match_again(
        &self,
        state: &RegExpGlobalState,
        subject: &StringView,
    ) -> JsResult<[Match; NUMBERED_GROUPS + 1]> {
        let mut buffer = CaptureBuffer::default();
        let regexp = state.regexp.get().filter(|it| it.group_count() != 0);
        let captures = match regexp {
            Some(regexp) => regexp.exec(self, subject, state.found.get().start, &mut buffer)?,
            None => None,
        };
        Ok(core::array::from_fn(|index| {
            let group = captures.and_then(|captures| match index {
                NUMBERED_GROUPS => captures.get(captures.count() - 1),
                _ => captures.get(index + 1),
            });
            group.unwrap_or_default()
        }))
    }
}
