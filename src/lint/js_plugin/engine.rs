//! Where the JavaScript runs.

use bun_threading::Guarded;

/// Answers what the program asks for while it is called: given what that is, one of [`wire::ask`](super::wire::ask), and
/// the details, appends the answer.
pub type Serve<'s> = dyn FnMut(u32, &[u8], &mut Vec<u8>) + 's;

/// A JavaScript realm in which the [`PROGRAM`](super::PROGRAM) runs.
pub trait Vm {
    /// Calls the program with a message: what it is, one of [`wire::call`](super::wire::call), and its content. Returns what
    /// the program returns, if that is a promise what it resolves to. `Err`: the realm is of no more use.
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>>;
}

/// Has the realms.
pub trait Engine: Sync {
    /// Calls `then` with a realm, which nothing else uses meanwhile. `then` can ask for one itself, and is not kept waiting.
    /// `size`: that of the file which the realm is for, 0 if it is for none. `Err`: there is none, and `then` was not called.
    fn with_vm(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>>;

    /// Calls `then`. Whatever asks for a realm meanwhile, on this thread, has the same one: that for [`HEAVY`] files. `Err`: as of
    /// [`Engine::with_vm`].
    fn keep_vm(&self, then: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        self.with_vm(0, &mut |_| then())
    }

    /// Says how many files are going to need a realm, how large they are together, and how many realms there can be at most.
    /// Nobody says so if a realm is needed to find out.
    fn expect(&self, _files: usize, _size: u64, _most: usize) {}

    /// What a realm cost in the last run like this one. Before [`Engine::expect`].
    fn remember(&self, _cost: Cost) {}

    /// What a realm has cost in this run, which is over. `None`: too little of it was seen.
    fn cost(&self) -> Option<Cost> {
        None
    }

    /// For `--timing`: the most that all realms together have taken, in bytes, and how many were freed because that was too much.
    fn sizes(&self) -> (usize, usize) {
        (0, 0)
    }

    /// How many realms there can be at a time.
    fn most_realms(&self) -> usize {
        usize::MAX
    }
}

/// A file of this size is heavy: its tree, tokens and lines take about 150 bytes in a realm for each of its own, and a realm keeps
/// what it has grown to. So all heavy files go to one realm, one at a time. 0.24 % of the files of 391 repositories are.
pub const HEAVY: usize = 256 << 10;

/// How many bytes a realm lints in the time that another one takes to start, until the run has measured both: 1.0, 1.2 and 1.5 MB
/// with the configurations of openlayers, vscode and mermaid.
const BYTES_IN_THE_COST: f64 = 1e6;

/// What a realm cost in a run. The first run in a project guesses, the next ones know: what a plugin builds for itself in its
/// first seconds, or in a thread of its own, shows when all realms have long been started.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Cost {
    /// How large the files of the run were together.
    pub size: u64,
    /// How many bytes a realm lints in the time that another one takes until it lints as fast.
    pub start: u64,
    /// How many bytes of memory a realm had at the most.
    pub memory: u64,
}

#[derive(Default)]
struct Left {
    /// How large the files are that are still to come.
    bytes: u64,
    /// How large they were at first.
    all: u64,
    /// How many realms there can be. 0: nobody has said, and there is one.
    most: usize,
    /// How many seconds realms have taken until they had loaded what they need and linted their first file, and how many have.
    starting: (f64, u32),
    /// How many seconds realms have taken after that, and for how many bytes.
    linting: (f64, u64),
    /// The same for the last quarter of the bytes, when the realms are as fast as they get.
    at_last: (f64, u64),
    /// [`Cost::start`] of the last run.
    known: Option<u64>,
}

/// Decides how many realms a run has.
#[derive(Default)]
pub struct Demand(Guarded<Left>);

impl Demand {
    /// [`Engine::expect`]
    pub fn expect(&self, size: u64, most: usize) {
        let mut left = self.0.lock();
        *left = Left {
            bytes: size,
            all: size,
            most,
            known: left.known,
            ..Left::default()
        };
    }

    /// [`Engine::remember`]
    pub fn remember(&self, start: u64) {
        self.0.lock().known = Some(start);
    }

    /// [`Cost::size`] and [`Cost::start`] of this run: of the seconds that all realms have taken, those that are more than the
    /// bytes take at the speed of the end, for each realm, in bytes at that speed.
    pub fn cost(&self) -> Option<(u64, u64)> {
        let left = self.0.lock();
        let ((seconds, bytes @ 1..), (starting, realms @ 1..)) = (left.at_last, left.starting)
        else {
            return None;
        };
        let at_that_speed = (starting + left.linting.0) * bytes as f64 / seconds;
        let done = (left.all - left.bytes) as f64;
        let start = (at_that_speed - done).max(0.0) / f64::from(realms);
        start.is_finite().then_some((left.all, start as u64))
    }

    /// How large the files are that are still to come.
    pub fn left(&self) -> u64 {
        self.0.lock().bytes
    }

    /// A file of `size` bytes is done, after `seconds` in a realm. `is_first`: it is the first of that realm.
    pub fn note(&self, size: usize, seconds: f64, is_first: bool) {
        let mut left = self.0.lock();
        left.bytes = left.bytes.saturating_sub(size as u64);
        match is_first {
            true => left.starting = (left.starting.0 + seconds, left.starting.1 + 1),
            false => left.linting = (left.linting.0 + seconds, left.linting.1 + size as u64),
        }
        if !is_first && left.bytes < left.all / 4 {
            left.at_last = (left.at_last.0 + seconds, left.at_last.1 + size as u64);
        }
    }

    /// Whether to start another realm beside the `realms` that there are, all of which are in use: whether it is going to lint for
    /// as long as it takes to start, the others going on meanwhile.
    pub fn is_worth_another(&self, realms: usize) -> bool {
        let left = self.0.lock();
        if realms == 0 || realms >= left.most {
            return realms == 0;
        }
        let cost = match (left.known, left.starting, left.linting) {
            (Some(known), ..) => known as f64,
            (None, (starting, realms @ 1..), (linting, bytes @ 1..)) if linting > 0.0 => {
                starting / f64::from(realms) * bytes as f64 / linting
            }
            _ => BYTES_IN_THE_COST,
        };
        left.bytes as f64 / realms as f64 > 2.0 * cost
    }
}
