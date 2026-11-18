//! Finds out whether a search does more work than the part of the subject that it has seen is worth.
//!
//! Work is counted in what takes machine code about a cycle.

use crate::context::Outcome;

/// The work between two polls.
pub const FUEL: u32 = 1 << 16;

/// What a search may do before it has got anywhere, and what is added for the time it takes to compile its program.
const HEAD_START: u64 = 4 * FUEL as u64;
const HEAD_START_PER_WORK: u64 = 256;
const MAX_CREDIT: u64 = 1 << 27;

/// What either side of a race may do without getting anywhere.
pub(crate) const BUDGET: u64 = 1 << 32;

/// Positions count from the end of the subject.
pub(crate) struct Report {
    /// Since the last report.
    pub(crate) work: u64,
    /// To be taken off this work or that to come.
    pub(crate) saved_work: u64,
    pub(crate) position: i64,
    /// Where the present attempt has started, if that is known.
    pub(crate) attempt: Option<i64>,
    pub(crate) work_per_unit: u32,
}

/// For the searches that go through a subject one after the other with the same pattern.
#[derive(Clone, Copy)]
struct Account {
    pattern: usize,
    /// The address of its end.
    subject: usize,
    farthest: i64,
    latest_start: i64,
    credit: u64,
}

const ACCOUNTS: usize = 8;

#[repr(C)]
pub(crate) struct Meter {
    /// Not zero once the present search has.
    pub(crate) has_polled: u32,
    /// What the plain side of a race has been given last.
    pub(crate) fuel: u32,
    pub(crate) interpreted: u64,
    /// The work that can still be done although it is too slow.
    pub(crate) patience: Option<u64>,
    /// That of the present search comes first.
    accounts: Vec<Account>,
    /// Where the present search can start again.
    attempt: Option<i64>,
    work_on_attempt: u64,
    pub(crate) should_stop: Option<Box<dyn FnMut() -> bool>>,
    pub(crate) name_pattern: Option<Box<dyn Fn() -> usize>>,
}

impl Meter {
    pub(crate) const fn new() -> Meter {
        Meter {
            has_polled: 0,
            fuel: FUEL,
            interpreted: 0,
            patience: None,
            accounts: Vec::new(),
            attempt: None,
            work_on_attempt: 0,
            should_stop: None,
            name_pattern: None,
        }
    }

    pub(crate) fn should_stop(&mut self) -> bool {
        self.should_stop.as_mut().is_some_and(|ask| ask())
    }

    fn start(&mut self, report: &Report, subject: usize, head_start: u64) {
        let pattern = self.name_pattern.as_ref().map_or(0, |ask| ask());
        let start = report.attempt.unwrap_or(report.position);
        let new = Account {
            pattern,
            subject,
            farthest: start,
            latest_start: start,
            credit: head_start,
        };
        let known = self.accounts.iter().position(|it| it.pattern == pattern);
        if known.is_none() && self.accounts.len() < ACCOUNTS {
            self.accounts.push(new);
        }
        let index = known.unwrap_or(self.accounts.len() - 1);
        self.accounts[..=index].rotate_right(1);
        let account = &mut self.accounts[0];
        if known.is_none() || subject != account.subject || start <= account.latest_start {
            *account = new;
        }
        (self.attempt, self.work_on_attempt) = (None, 0);
    }

    /// Whether the search is slow.
    pub(crate) fn charge(&mut self, report: &Report, subject: usize, head_start: u64) -> bool {
        if core::mem::replace(&mut self.has_polled, 1) == 0 || self.accounts.is_empty() {
            self.start(report, subject, head_start);
        }
        if report.attempt.is_some() && report.attempt != self.attempt {
            (self.attempt, self.work_on_attempt) = (report.attempt, 0);
        }
        self.work_on_attempt += report.work;
        let account = &mut self.accounts[0];
        let farthest = account.farthest.max(report.position);
        let latest_start = account.latest_start.max(report.attempt.unwrap_or(i64::MIN));
        let gained = (farthest - account.farthest) + (latest_start - account.latest_start);
        (account.farthest, account.latest_start) = (farthest, latest_start);
        let earned = (gained as u64).saturating_mul(report.work_per_unit.into());
        let credit = account.credit.saturating_add(earned).min(MAX_CREDIT);
        account.credit = credit.saturating_sub(report.work);
        credit < report.work
    }

    /// More fuel, or how the search ends.
    #[cold]
    pub(crate) fn poll(&mut self, report: &Report, subject: usize) -> Result<u32, Outcome> {
        if self.should_stop() {
            return Err(Outcome::Interrupted);
        }
        let head_start = HEAD_START + u64::from(report.work_per_unit) * HEAD_START_PER_WORK;
        if self.charge(report, subject, head_start) {
            let patience = self.patience.as_mut().ok_or(Outcome::TooSlow)?;
            *patience = (patience.checked_sub(report.work)).ok_or(Outcome::TooComplex)?;
        }
        Ok(FUEL)
    }

    /// The last attempt that the present search has been seen at.
    pub(crate) fn attempt(&self, length: usize) -> Option<u32> {
        self.attempt.map(|it| (length as i64 + it) as u32)
    }

    /// The search that has been too slow starts again from its last attempt, and has to catch up with itself.
    pub(crate) fn go_on(&mut self) {
        if let Some(account) = self.accounts.first_mut() {
            account.credit = self.work_on_attempt;
        }
    }
}
