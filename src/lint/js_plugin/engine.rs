//! The realms that run the JavaScript.

use bun_threading::Guarded;

/// Answers the program's requests during a call. It gets the request kind (one of [`wire::ask`](super::wire::ask)) and
/// the details, and appends the answer.
pub type Serve<'s> = dyn FnMut(u32, &[u8], &mut Vec<u8>) + 's;

/// A JavaScript realm that runs the [`PROGRAM`](super::PROGRAM). It belongs to one thread.
pub trait Vm {
    /// Calls the program with a message: its kind (one of [`wire::call`](super::wire::call)) and its content. Returns
    /// the program's result, or what it resolves to if it's a promise. After an `Err` the realm can't be used anymore.
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>>;
}

/// The work that [`Engine::work_off`] hands to the threads that have a realm. Each call handles one file, so a thread
/// can serve [`Engine::with_vm`] calls from other threads in between.
pub trait Work: Sync {
    /// True if a [`HEAVY`] file hasn't been taken yet.
    fn has_heavy(&self) -> bool;

    /// Lints one of the [`HEAVY`] files. Only the thread with the first realm calls it. Returns `false` once none are
    /// left.
    fn heavy(&self) -> bool;

    /// Lints one of the other files. `realm` is the number of the calling thread's realm. Returns `false` once none are
    /// left.
    fn light(&self, realm: usize) -> bool;

    /// True if one of the other files that needs a realm hasn't been taken yet.
    fn needs_realms(&self) -> bool;

    /// Does all the remaining work on the calling thread.
    fn finish_here(&self) {
        while self.heavy() {}
        while self.light(0) {}
    }
}

/// Owns the realms.
pub trait Engine: Sync {
    /// True if the calling thread has a realm.
    fn thread_has_realm(&self) -> bool;

    /// Calls `then` on the calling thread with a realm that nothing else uses in the meantime. `then` can request a
    /// realm itself without blocking. `size` is the size of the file the realm is for, or 0 if it isn't for a file.
    /// `Err` means there's no realm and `then` wasn't called.
    fn with_vm_here(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>>;

    /// Like [`Engine::with_vm_here`], but on whichever thread has a realm. The calling thread waits if that's a
    /// different thread.
    fn with_vm(
        &self,
        size: usize,
        then: &mut (dyn FnMut(&mut dyn Vm) + Send),
    ) -> Result<(), Vec<u8>>;

    /// Makes every thread with a realm process `work` until nothing is left, starting as many such threads as the files
    /// justify. Calls `meanwhile` on the calling thread and returns when both are done. `Err` means no such thread
    /// could be started, so only `meanwhile` ran.
    fn work_off(&self, work: &dyn Work, meanwhile: &mut dyn FnMut()) -> Result<(), Vec<u8>>;

    /// How many threads are busy with [`Engine::work_off`].
    fn busy(&self) -> usize;

    /// Announces how many files will need a realm, their total size, and the maximum number of realms. It isn't called
    /// if finding that out takes a realm.
    fn expect(&self, _files: usize, _size: u64, _most: usize) {}

    /// Announces that further files, `size` bytes in total, might need a realm. Whether each one does is only known
    /// when it's linted. Call it after [`Engine::expect`].
    fn may_need_realm(&self, _size: u64) {}

    /// One of the [`Engine::may_need_realm`] files, of `size` bytes, is about to request a realm. With `--fix` that can
    /// happen several times.
    fn needs_realm(&self, _size: u64) {}

    /// One of the [`Engine::may_need_realm`] files, of `size` bytes, is done. `needed_realm` tells whether it needed a
    /// realm. Called once per file.
    fn report_realm_need(&self, _size: u64, _needed_realm: bool) {}

    /// For `--timing`: the peak memory of all realms together, in bytes, and how many realms were freed because that
    /// was too much.
    fn sizes(&self) -> (usize, usize) {
        (0, 0)
    }
}

/// A file of at least this size is heavy. Its tree, tokens and lines take about 150 bytes in a realm per byte of
/// source, and a realm never shrinks. So all heavy files go to one realm, one at a time. 0.24 % of the files in 391
/// repositories are heavy.
pub const HEAVY: usize = 256 << 10;

/// The fraction of its own cost that another realm has to save. This trades time against memory and work. With 0.5,
/// openlayers (8 MB) and mermaid (7 MB) get 3 realms and vscode (180 MB) gets 16. With 1 they get 3, 2 and 13, and with
/// 0.25 they get 4, 4 and 16.
const MIN_SAVED_FRACTION: f64 = 0.5;

/// How many bytes a realm lints in the time it takes to start another one, which has to load the plugins and is slow
/// until its code is compiled. Measured with eight projects' configs, it ranges from under 0.1 to 6 MB, and from 0.4 to
/// 2 MB for five of them.
///
/// It's a constant instead of a measurement of the run, so the same files get the same number of realms every time.
/// Timing the run works worse: it would be based on the first files, which are the slow ones, so another realm looks
/// cheap. The same 300 files got anywhere from 1 to 16 realms that way. The amount of code a realm has loaded doesn't
/// predict its cost either: it ranges from 0.06 to 2.7 seconds per MB of source.
const REALM_COST_IN_BYTES: f64 = 1e6;

#[derive(Default)]
struct Remaining {
    /// The total size of the files still to come.
    bytes: u64,
    /// The total size of the files announced up front.
    announced: u64,
    /// The total size of the files that might need a realm and aren't done yet.
    possible: u64,
    /// The total size of such files that did need a realm, and of those that didn't.
    settled: (u64, u64),
    /// The maximum number of realms. 0 means it wasn't announced, and there's one realm.
    most: usize,
}

/// Decides how many realms a run has.
#[derive(Default)]
pub struct Demand(Guarded<Remaining>);

impl Demand {
    /// [`Engine::expect`]
    pub fn expect(&self, size: u64, most: usize) {
        *self.0.lock() = Remaining {
            bytes: size,
            announced: size,
            most,
            ..Remaining::default()
        };
    }

    /// [`Engine::may_need_realm`]
    pub fn may_need_realm(&self, size: u64) {
        self.0.lock().possible = size;
    }

    /// [`Engine::needs_realm`]
    pub fn needs_realm(&self, size: u64) {
        self.0.lock().bytes += size;
    }

    /// [`Engine::report_realm_need`]
    pub fn report_realm_need(&self, size: u64, needed_realm: bool) {
        let mut left = self.0.lock();
        left.possible = left.possible.saturating_sub(size);
        match needed_realm {
            true => left.settled.0 += size,
            false => left.settled.1 += size,
        }
    }

    /// The estimated total size of the files still to come.
    pub fn left(&self) -> u64 {
        self.0.lock().expected() as u64
    }

    /// A file of `size` bytes is done.
    pub fn note(&self, size: usize) {
        let mut left = self.0.lock();
        left.bytes = left.bytes.saturating_sub(size as u64);
    }

    /// True if it's worth starting another realm in addition to the existing `realms`, all of which are in use.
    /// Compares how much sooner the run would end with what the realm costs. It's based on all the files of the run,
    /// not on the remaining ones, because how many remain when a thread happens to ask depends on timing.
    ///
    /// `busy_with_heavy` is how many of the `realms` are busy with [`HEAVY`] files, which aren't counted among these
    /// files.
    pub fn is_worth_another(&self, realms: usize, busy_with_heavy: usize) -> bool {
        let left = self.0.lock();
        if realms == 0 || realms >= left.most {
            return realms == 0;
        }
        let realms = realms.saturating_sub(busy_with_heavy);
        if realms == 0 {
            return true;
        }
        // The existing realms keep working until the new one is ready. After that there's one more.
        let (all, realms) = (left.all() / REALM_COST_IN_BYTES, realms as f64);
        (all / realms - 1.0) / (realms + 1.0) >= MIN_SAVED_FRACTION
    }
}

impl Remaining {
    /// Estimates how much of `possible` will need a realm, using the fraction of the finished files that did. The first
    /// such file is weak evidence, so the estimate starts as if `REALM_COST_IN_BYTES` bytes had already finished
    /// without needing one.
    fn expected_from_possible(&self) -> f64 {
        let (needed, not_needed) = (self.settled.0 as f64, self.settled.1 as f64);
        self.possible as f64 * needed / (needed + not_needed + REALM_COST_IN_BYTES)
    }

    /// The estimated total size of the files still to come.
    fn expected(&self) -> f64 {
        self.bytes as f64 + self.expected_from_possible()
    }

    /// The estimated total size of all the files in the run.
    fn all(&self) -> f64 {
        (self.announced + self.settled.0) as f64 + self.expected_from_possible()
    }
}
