//! A pattern that has taken too long is searched for in two ways at once, until it has been quick for a while.

use core::cell::{Cell, RefCell};

use bun_engine_regexp::{Error, Mode, Notes, Outcome, Raced, Racing, Rivals, RunNative, Search};
use bun_engine_text::Text;

use super::code::{compile_options, mode_for, variant};
use super::machine_code::{MachineCode, enter_racing};
use super::subject::{Identity, Subject};
use crate::heap::Survivors;
use crate::{Cx, JsResult, RegExp, Vm, options};

/// What a race costs more than a usual search then adds up to about what it costs to find out that one is too slow.
const QUICK_SEARCHES_TO_RECOVER: u32 = 1024;

pub(super) struct Contest {
    rivals: Rivals,
    machine_code: Option<MachineCode>,
    /// Is missing from the entries while the contest is on.
    usual_entry: usize,
    quick_searches_left: u32,
}

impl Contest {
    fn size(&self) -> usize {
        self.rivals.size() + self.machine_code.as_ref().map_or(0, MachineCode::size)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Topic {
    regexp: usize,
    variant: usize,
    subject: Identity,
}

struct Kept {
    topic: Topic,
    notes: Box<Notes>,
    /// Since the last collection.
    were_used: bool,
}

/// What the last races have left, the latest first.
#[derive(Default)]
pub(super) struct KeptNotes {
    kept: RefCell<Vec<Kept>>,
    blank: Cell<Option<Box<Notes>>>,
}

const MAX_KEPT: usize = 8;

impl KeptNotes {
    fn take(&self, topic: Option<Topic>) -> Box<Notes> {
        let mut kept = self.kept.borrow_mut();
        match kept.iter().position(|it| Some(it.topic) == topic) {
            Some(index) => kept.remove(index).notes,
            None => self.blank.take().unwrap_or_else(|| Box::new(Notes::new())),
        }
    }

    fn put_back(&self, topic: Option<Topic>, mut notes: Box<Notes>) {
        let Some(topic) = topic.filter(|_| !notes.are_blank()) else {
            notes.clear();
            return self.blank.set(Some(notes));
        };
        let (mut kept, were_used) = (self.kept.borrow_mut(), true);
        let mut left = (options().max_regexp_stack_size / 4).saturating_sub(notes.size());
        kept.truncate(MAX_KEPT - 1);
        kept.retain(|it| {
            left.checked_sub(it.notes.size())
                .map(|it| left = it)
                .is_some()
        });
        let latest = Kept {
            topic,
            notes,
            were_used,
        };
        kept.insert(0, latest);
    }

    pub(super) fn clear(&self) {
        self.kept.take();
        self.blank.take();
    }

    pub(super) fn prune(&self, survivors: &Survivors) {
        let mut kept = self.kept.borrow_mut();
        kept.retain_mut(|it| {
            core::mem::take(&mut it.were_used)
                && survivors.contains_address(it.topic.regexp)
                && survivors.contains_address(it.topic.subject.cell)
        });
        survivors.report_extra_memory(kept.iter().map(|it| it.notes.size()).sum());
    }
}

impl RegExp {
    fn prepare_contest(&self, vm: &Vm, text: Text<'_>, mode: Mode) -> Result<Box<Contest>, Error> {
        let (pattern, options) = (self.parse()?, compile_options(vm, text, mode));
        let mut compiler = vm.regexps().compiler.borrow_mut();
        let rivals = Rivals::new(&mut compiler, pattern.tree(), &options)?;
        drop(compiler);
        let machine_code = MachineCode::is_enabled()
            .then(|| MachineCode::new(vm, rivals.plain().verify()?, None))
            .flatten();
        if let Some(code) = &machine_code {
            code.describe(|| self.to_literal_text().to_string());
        }
        let contest = Box::new(Contest {
            rivals,
            machine_code,
            usual_entry: 0,
            quick_searches_left: 0,
        });
        self.account_for_code(vm, contest.size(), 0);
        Ok(contest)
    }

    /// A program that could not be made when the contest was prepared is made now.
    #[cold]
    fn try_memoizing(&self, vm: &Vm, contest: &mut Contest, text: Text<'_>, mode: Mode) {
        let Ok(pattern) = self.parse() else {
            return;
        };
        let (size, options) = (contest.size(), compile_options(vm, text, mode));
        let mut compiler = vm.regexps().compiler.borrow_mut();
        contest
            .rivals
            .make_memoizing(&mut compiler, pattern.tree(), &options);
        drop(compiler);
        self.account_for_code(vm, contest.size() - size, 0);
    }

    /// `groups` is empty, or has room for all.
    #[cold]
    #[inline(never)]
    pub(super) fn race(
        &self,
        cx: &Cx,
        subject: impl Subject,
        start: u32,
        groups: &mut [u32],
        has_been_too_slow: bool,
    ) -> JsResult<Outcome> {
        let (text, mode) = (subject.text(), mode_for(groups));
        let analysis = self.analyze(cx, text, mode)?;
        let (code, variant) = (&analysis.code, variant(text, mode));
        let mut contest = match code.contests[variant].take() {
            Some(contest) => contest,
            None => match self.prepare_contest(cx, text, mode) {
                Ok(contest) => contest,
                Err(_) => return Ok(self.search_patiently(cx, code, text, start, groups)),
            },
        };
        if contest.rivals.can_be_two() {
            self.try_memoizing(cx, &mut contest, text, mode);
        }
        let search = Search {
            subject: text,
            start,
            has_been_too_slow,
        };
        let can_be_followed = self.uses_last_index() || start != 0;
        let identity = can_be_followed.then(|| Identity::of(cx, subject)).flatten();
        let Raced { outcome, was_quick } = self.hold_race(cx, &contest, identity, search, groups);
        if has_been_too_slow && contest.rivals.are_two() {
            contest.usual_entry = self.replace_entry(text, mode, 0);
            code.contests_on.update(|it| it | 1 << variant);
        }
        contest.quick_searches_left = match was_quick && !has_been_too_slow {
            true => contest.quick_searches_left - 1,
            false => QUICK_SEARCHES_TO_RECOVER,
        };
        if contest.quick_searches_left == 0 {
            self.replace_entry(text, mode, contest.usual_entry);
            code.contests_on.update(|it| it & !(1 << variant));
        }
        code.contests[variant].set(Some(contest));
        Ok(outcome)
    }

    fn hold_race(
        &self,
        cx: &Cx,
        contest: &Contest,
        identity: Option<Identity>,
        search: Search<'_>,
        groups: &mut [u32],
    ) -> Raced {
        let (matcher, kept) = (&cx.regexps().matcher, &cx.regexps().notes);
        let topic = identity.map(|subject| Topic {
            regexp: self.address(),
            variant: variant(search.subject, mode_for(groups)),
            subject,
        });
        let mut run = contest.machine_code.as_ref().map(|code| {
            move |start: u32, groups: &mut [u32], racing: &mut Racing<'_>| {
                // SAFETY: made from the plain program for that variant, with room for the groups.
                unsafe { enter_racing(code.entry(), search.subject, start, groups, racing) }
            }
        });
        let mut notes = kept.take(topic);
        let size = notes.size();
        let raced = matcher.with_context(self.address(), |context| {
            let native = run.as_mut().map(|it| it as RunNative<'_>);
            let raced = context.race(&contest.rivals, native, &mut notes, search, groups);
            context.trim();
            raced
        });
        if topic.is_some() {
            (cx.heap).note_extra_memory_allocated(self, notes.size().saturating_sub(size));
        }
        kept.put_back(topic, notes);
        raced
    }
}
