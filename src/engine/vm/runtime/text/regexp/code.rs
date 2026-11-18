//! A pattern is compiled for each width of subject, with and without captures, when that is first needed. It is
//! interpreted until machine code pays.

use core::cell::{Cell, UnsafeCell};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_regexp::{Context, Error, Form, Mode, Options, Outcome, Pattern, Program, Width};
use bun_engine_text::Text;

use super::captures::Found;
use super::cell::Analysis;
use super::machine_code::{MachineCode, Results, enter};
use super::race::Contest;
use super::subject::Subject;
use crate::heap::Held;
use crate::{CaptureBuffer, Captures, Cx, JsResult, Match, RegExp, Vm, options};

const WORK_BEFORE_TIER_UP: usize = 1000;
const MORE_WORK_PER_OP: usize = 200;
const WORK_PER_SEARCH: u64 = 120;
const LONG_SUBJECT: usize = 1000;
/// With a form.
const SHORT_SEARCHES_BEFORE_TIER_UP: u16 = 1024;

const VARIANT_COUNT: usize = 4;

#[inline(always)]
pub(super) fn variant(subject: Text<'_>, mode: Mode) -> usize {
    usize::from(!subject.is_latin1()) + usize::from(mode == Mode::Captures) * 2
}

/// The addresses of machine code for Latin-1 and for UTF-16, without captures and then with. Zero if there is none.
#[derive(Default)]
#[repr(transparent)]
pub(super) struct Entries([Cell<usize>; VARIANT_COUNT]);

#[derive(Default)]
pub(super) struct Code {
    programs: [Cell<Option<Interpreted>>; VARIANT_COUNT],
    pub(super) contests: [Cell<Option<Box<Contest>>>; VARIANT_COUNT],
    /// A bit for each.
    pub(super) contests_on: Cell<u8>,
    /// For each width.
    short_searches: [Cell<u16>; 2],
    /// Whether machine code for the form has been asked for in vain.
    form_stays: Cell<bool>,
    /// What the `Entries` point into.
    machine_code: Cell<Vec<MachineCode>>,
}

struct Interpreted {
    program: Box<Program>,
    /// `None` if it stays interpreted.
    work_before_tier_up: Option<u32>,
}

/// What all searches of a `Vm` work with.
pub(super) struct Matcher {
    /// The address of the `RegExp`, for a profiler.
    running: AtomicUsize,
    context: UnsafeCell<Context>,
    stops_at_poll: Cell<bool>,
}

impl Default for Matcher {
    fn default() -> Matcher {
        Matcher {
            running: AtomicUsize::new(0),
            context: UnsafeCell::new(Context::new()),
            stops_at_poll: Cell::new(false),
        }
    }
}

impl Matcher {
    pub(super) const OFFSET_OF_RUNNING: usize = core::mem::offset_of!(Matcher, running);
    pub(super) const OFFSET_OF_CONTEXT: usize = core::mem::offset_of!(Matcher, context);

    #[inline(always)]
    pub(super) fn with_context<R>(
        &self,
        running: usize,
        body: impl FnOnce(&mut Context) -> R,
    ) -> R {
        debug_assert!(self.running.load(Ordering::Relaxed) == 0);
        self.running.store(running, Ordering::Relaxed);
        // SAFETY: the callers run only the matcher, whose one way out is the poll below.
        let result = body(unsafe { &mut *self.context.get() });
        self.running.store(0, Ordering::Relaxed);
        result
    }

    pub(super) fn initialize(&self, vm: &Vm) {
        let vm = core::ptr::from_ref(vm);
        let should_stop = move || {
            // SAFETY: owns the context.
            let vm = unsafe { &*vm };
            vm.regexps().matcher.stops_at_poll.get() || vm.is_termination_requested()
        };
        // SAFETY: the same.
        let running = move || unsafe { &*vm }.running_regexp();
        self.with_context(0, |context| {
            context.set_poll(Box::new(should_stop));
            context.set_name_of_pattern(Box::new(running));
            context.set_max_stack_size(options().max_regexp_stack_size);
        });
    }

    pub(super) fn trim(&self) {
        self.with_context(0, Context::trim);
    }

    pub(super) fn running(&self) -> usize {
        self.running.load(Ordering::Relaxed)
    }
}

/// `groups` is empty, or has room for all.
pub(super) fn mode_for(groups: &[u32]) -> Mode {
    match groups {
        [] => Mode::MatchOnly,
        _ => Mode::Captures,
    }
}

pub(super) fn compile_options<'a>(vm: &Vm, subject: Text<'a>, mode: Mode) -> Options<'a> {
    Options {
        width: match subject {
            Text::Latin1(_) => Width::Latin1,
            Text::Utf16(_) => Width::Utf16,
        },
        mode,
        sample: subject,
        stack_limit: vm.hard_stack_limit(),
    }
}

impl RegExp {
    /// The first match from `start` on or, if sticky, at `start`. Nothing is collected unless it throws.
    #[inline(always)]
    pub fn find(&self, cx: &Cx, subject: impl Subject, start: u32) -> JsResult<Option<Match>> {
        let found = match self.entries.0[variant(subject.text(), Mode::MatchOnly)].get() {
            0 => self.search_slow(cx, subject, start, &mut []),
            // SAFETY: the entry for that variant.
            entry => unsafe { self.run_machine_code(cx, entry, subject, start, &mut []) },
        };
        Ok(found?.get())
    }

    /// The same, with the groups.
    #[inline(always)]
    pub fn exec<'a>(
        &self,
        cx: &Cx,
        subject: impl Subject,
        start: u32,
        buffer: &'a mut CaptureBuffer,
    ) -> JsResult<Option<Captures<'a>>> {
        let entry = self.entries.0[variant(subject.text(), Mode::Captures)].get();
        if entry == 0 {
            self.analyze(cx, subject.text(), Mode::Captures)?;
        }
        let offsets = cx.or_out_of_memory(buffer.offsets(self.group_count()))?;
        let groups = &mut offsets[2..];
        let found = match entry {
            0 => self.search_slow(cx, subject, start, groups),
            // SAFETY: the entry for that variant, with room for the groups.
            _ => unsafe { self.run_machine_code(cx, entry, subject, start, groups) },
        };
        let Some(Match { start, end }) = found?.get() else {
            return Ok(None);
        };
        (offsets[0], offsets[1]) = (start, end);
        Ok(Some(Captures::new(offsets)))
    }

    /// # Safety
    /// As for `enter`.
    #[inline(always)]
    unsafe fn run_machine_code(
        &self,
        cx: &Cx,
        entry: usize,
        subject: impl Subject,
        start: u32,
        groups: &mut [u32],
    ) -> JsResult<Found> {
        let matcher = &cx.regexps().matcher;
        // SAFETY: the caller's.
        let results = matcher.with_context(self.address(), |context| unsafe {
            enter(entry, subject.text(), start, groups, context)
        });
        match results.answer() {
            Some(found) => Ok(found),
            None => self.finish_machine_code(cx, results, subject, start, groups),
        }
    }

    #[cold]
    #[inline(never)]
    fn finish_machine_code(
        &self,
        cx: &Cx,
        results: Results,
        subject: impl Subject,
        start: u32,
        groups: &mut [u32],
    ) -> JsResult<Found> {
        self.finish(cx, results.outcome(), subject, start, groups)
    }

    fn finish(
        &self,
        cx: &Cx,
        outcome: Outcome,
        subject: impl Subject,
        start: u32,
        groups: &mut [u32],
    ) -> JsResult<Found> {
        let throw = match outcome {
            Outcome::Match { start, end } => return Ok(Found::new(start, end)),
            Outcome::NoMatch => return Ok(Found::NOTHING),
            Outcome::TooSlow => {
                if let Some(analysis) = self.analysis()
                    && let Some(form) = &analysis.form
                {
                    return Ok(form.find(subject.text(), start as usize).into());
                }
                let outcome = self.race(cx, subject, start, groups, true)?;
                return self.finish(cx, outcome, subject, start, groups);
            }
            Outcome::Interrupted => Cx::throw_termination,
            Outcome::OutOfMemory => Cx::throw_out_of_memory,
            Outcome::TooComplex => |cx: &Cx| cx.throw_range_error("Regular expression too complex"),
        };
        cx.regexps().matcher.trim();
        Err(throw(cx))
    }

    /// `groups` is empty, or has room for all.
    #[inline(never)]
    fn search_slow(
        &self,
        cx: &Cx,
        subject: impl Subject,
        start: u32,
        groups: &mut [u32],
    ) -> JsResult<Found> {
        let analysis = self.analyze(cx, subject.text(), mode_for(groups))?;
        let Some(form) = &analysis.form else {
            return self.interpret(cx, &analysis.code, subject, start, groups);
        };
        self.note_use_of_form(cx, form, &analysis.code, subject.text());
        Ok(form.find(subject.text(), start as usize).into())
    }

    /// The form, unless machine code is better at it.
    #[inline(always)]
    pub(super) fn form_for_all_matches<'a>(
        &self,
        vm: &Vm,
        analysis: &'a Analysis,
        subject: Text<'_>,
    ) -> Option<&'a Form> {
        let form = analysis.form.as_ref()?;
        if form.finds_all_quickly(subject.len()) {
            return Some(form);
        }
        let has_code = || self.entries.0[variant(subject, Mode::MatchOnly)].get() != 0;
        if !has_code() {
            self.note_use_of_form(vm, form, &analysis.code, subject);
        }
        (!has_code()).then_some(form)
    }

    #[inline(always)]
    fn note_use_of_form(&self, vm: &Vm, form: &Form, code: &Code, subject: Text<'_>) {
        if subject.len() <= Form::SHORT {
            let searches = &code.short_searches[variant(subject, Mode::MatchOnly)];
            searches.update(|it| (it + 1) % SHORT_SEARCHES_BEFORE_TIER_UP);
            let is_worth_a_try = !code.form_stays.get() && MachineCode::is_enabled();
            if searches.get() == 0 && is_worth_a_try && form.suits_machine_code() {
                code.form_stays
                    .set(self.tier_up_form(vm, code, subject).is_none());
            }
        }
    }

    /// The code leaves subjects that are longer than the form is quick on to the form.
    #[cold]
    fn tier_up_form(&self, vm: &Vm, code: &Code, subject: Text<'_>) -> Option<()> {
        let mode = Mode::MatchOnly;
        let (pattern, options) = (self.parse().ok()?, compile_options(vm, subject, mode));
        let mut compiler = vm.regexps().compiler.borrow_mut();
        let verified = compiler.compile_and_verify(pattern.tree(), &options)?;
        let machine_code = MachineCode::new(vm, verified, Some(Form::SHORT as u32))?;
        drop(compiler);
        self.install(vm, code, machine_code, subject, mode);
        Some(())
    }

    /// For a search of that kind.
    #[inline(always)]
    pub(super) fn analyze(
        &self,
        cx: &Cx,
        subject: Text<'_>,
        mode: Mode,
    ) -> JsResult<Held<'_, Analysis>> {
        match self.analysis() {
            Some(analysis) => Ok(analysis),
            None => (self.analyze_slow(cx, subject, mode)).map_err(|error| Self::throw(cx, error)),
        }
    }

    #[cold]
    #[inline(never)]
    fn analyze_slow(
        &self,
        vm: &Vm,
        subject: Text<'_>,
        mode: Mode,
    ) -> Result<Held<'_, Analysis>, Error> {
        let mut pattern = self.parse()?;
        let analysis = self.set_analysis(pattern.form()?, &mut pattern)?;
        let mode = match pattern.group_count() {
            0 => Mode::MatchOnly,
            _ => mode,
        };
        match analysis.form {
            Some(_) => vm.regexps().cache.keep(self),
            None => self.compile(vm, &analysis.code, &pattern, subject, mode)?,
        }
        Ok(analysis)
    }

    /// Fills the entry or, failing that, the place of the program.
    #[cold]
    fn compile(
        &self,
        vm: &Vm,
        code: &Code,
        pattern: &Pattern,
        subject: Text<'_>,
        mode: Mode,
    ) -> Result<(), Error> {
        let is_eager = options().use_eager_regexp_jit || subject.len() > LONG_SUBJECT;
        let (options, compiler) = (compile_options(vm, subject, mode), &vm.regexps().compiler);
        let program = compiler.borrow_mut().compile(pattern.tree(), &options)?;
        if MachineCode::is_enabled()
            && is_eager
            && self
                .make_machine_code(vm, code, &program, subject, mode)
                .is_some()
        {
            return Ok(());
        }
        let work = WORK_BEFORE_TIER_UP + MORE_WORK_PER_OP * program.ops().len();
        let interpreted = Interpreted {
            program,
            work_before_tier_up: (MachineCode::is_enabled() && !is_eager).then_some(work as u32),
        };
        self.account_for_code(vm, interpreted.program.size(), 0);
        code.programs[variant(subject, mode)].set(Some(interpreted));
        Ok(())
    }

    pub(super) fn account_for_code(&self, vm: &Vm, added: usize, removed: usize) {
        let old = self.code_size.load(Ordering::Relaxed) as usize;
        if old == 0 {
            vm.regexps().cache.keep(self);
        }
        let new = (old + added).saturating_sub(removed);
        (self.code_size).store(new.try_into().unwrap_or(u32::MAX), Ordering::Relaxed);
        vm.heap.note_extra_memory_allocated(self, added);
    }

    #[inline(never)]
    fn interpret(
        &self,
        cx: &Cx,
        code: &Code,
        subject: impl Subject,
        start: u32,
        groups: &mut [u32],
    ) -> JsResult<Found> {
        let (text, mode) = (subject.text(), mode_for(groups));
        if code.contests_on.get() >> variant(text, mode) & 1 != 0 {
            let outcome = self.race(cx, subject, start, groups, false)?;
            return self.finish(cx, outcome, subject, start, groups);
        }
        let (slot, matcher) = (&code.programs[variant(text, mode)], &cx.regexps().matcher);
        let mut is_long = text.len().saturating_sub(start as usize) > LONG_SUBJECT;
        loop {
            let Some(mut interpreted) = slot.take() else {
                let entry = self.entries.0[variant(text, mode)].get();
                if entry != 0 {
                    // SAFETY: the entry for that variant.
                    return unsafe { self.run_machine_code(cx, entry, subject, start, groups) };
                }
                (self.parse())
                    .and_then(|pattern| self.compile(cx, code, &pattern, text, mode))
                    .map_err(|error| Self::throw(cx, error))?;
                continue;
            };
            if (interpreted.work_before_tier_up).is_some_and(|work| work == 0 || is_long) {
                if (self.tier_up(cx, code, &interpreted.program, text, mode)).is_some() {
                    continue;
                }
                interpreted.work_before_tier_up = None;
            }
            (matcher.stops_at_poll).set(interpreted.work_before_tier_up.is_some());
            let (outcome, work) = matcher.with_context(self.address(), |context| {
                let outcome = interpreted.program.exec(text, start, groups, context);
                (outcome, context.take_work())
            });
            if let Some(left) = &mut interpreted.work_before_tier_up {
                *left = u64::from(*left).saturating_sub(work + WORK_PER_SEARCH) as u32;
            }
            slot.set(Some(interpreted));
            is_long = matcher.stops_at_poll.take()
                && outcome == Outcome::Interrupted
                && !cx.is_termination_requested();
            if !is_long {
                return self.finish(cx, outcome, subject, start, groups);
            }
        }
    }

    /// Once more in the way that has been too slow.
    pub(super) fn search_patiently(
        &self,
        vm: &Vm,
        code: &Code,
        subject: Text<'_>,
        start: u32,
        groups: &mut [u32],
    ) -> Outcome {
        let variant = variant(subject, mode_for(groups));
        let (entry, interpreted) = (self.entries.0[variant].get(), code.programs[variant].take());
        let search = |context: &mut Context| match &interpreted {
            Some(interpreted) => interpreted.program.exec(subject, start, groups, context),
            None if entry == 0 => Outcome::OutOfMemory,
            // SAFETY: the entry for that variant, with room for the groups.
            None => unsafe { enter(entry, subject, start, groups, context) }.outcome(),
        };
        let matcher = &vm.regexps().matcher;
        let outcome = matcher.with_context(self.address(), |context| context.patiently(search));
        code.programs[variant].set(interpreted);
        outcome
    }

    /// The caller drops the program, unless this fails.
    #[cold]
    fn tier_up(
        &self,
        vm: &Vm,
        code: &Code,
        program: &Program,
        subject: Text<'_>,
        mode: Mode,
    ) -> Option<()> {
        self.make_machine_code(vm, code, program, subject, mode)?;
        self.account_for_code(vm, 0, program.size());
        Some(())
    }

    fn make_machine_code(
        &self,
        vm: &Vm,
        code: &Code,
        program: &Program,
        subject: Text<'_>,
        mode: Mode,
    ) -> Option<()> {
        let mut compiler = vm.regexps().compiler.borrow_mut();
        let machine_code = MachineCode::new(vm, compiler.verify(program)?, None)?;
        drop(compiler);
        self.install(vm, code, machine_code, subject, mode);
        Some(())
    }

    fn install(
        &self,
        vm: &Vm,
        code: &Code,
        machine_code: MachineCode,
        subject: Text<'_>,
        mode: Mode,
    ) {
        machine_code.describe(|| self.to_literal_text().to_string());
        self.account_for_code(vm, machine_code.size(), 0);
        let entry = machine_code.entry();
        let mut all = code.machine_code.take();
        all.reserve_exact(1);
        all.push(machine_code);
        code.machine_code.set(all);
        self.replace_entry(subject, mode, entry);
    }

    pub(super) fn replace_entry(&self, subject: Text<'_>, mode: Mode, entry: usize) -> usize {
        if self.group_count() == 0 {
            self.entries.0[variant(subject, Mode::Captures)].set(entry);
        }
        self.entries.0[variant(subject, mode)].replace(entry)
    }

    pub(super) fn delete_code(&self) {
        self.entries.0.iter().for_each(|entry| entry.set(0));
        if let Some(analysis) = self.analysis() {
            analysis.code.programs.iter().for_each(|it| it.set(None));
            analysis.code.contests.iter().for_each(|it| it.set(None));
            analysis.code.contests_on.set(0);
            analysis.code.machine_code.take();
        }
        self.code_size.store(0, Ordering::Relaxed);
    }
}
