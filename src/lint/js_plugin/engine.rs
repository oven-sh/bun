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

    /// Besides, files of `size` bytes together may need a realm or not: it shows when each is linted. To be said after
    /// [`Engine::expect`].
    fn may_come(&self, _size: u64) {}

    /// One of these, of `size` bytes, is going to ask for a realm. With `--fix` it can do so several times.
    fn comes(&self, _size: u64) {}

    /// One of these, of `size` bytes, is done: it `has_come`, or not. Once for each.
    fn has_shown(&self, _size: u64, _has_come: bool) {}

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

/// How much of what a realm costs it has to save: time against memory and work. With 0.5 openlayers (8 MB) and mermaid (7 MB)
/// have 3 realms and vscode (180 MB) 16. With 1 they have 3, 2 and 13, with 0.25 4, 4 and 16.
const SHARE_TO_SAVE: f64 = 0.5;

/// How many bytes a realm lints in the time that another one costs: it has to load the plugins, and it is slow until its code
/// is compiled. From under 0.1 to 6 MB with the configurations of eight projects, five of them from 0.4 to 2.
///
/// A number, and no measure of the run itself, so that the same files have the same realms every time. A clock says less: the
/// first files, by which it would judge, are the slow ones, so that another realm looks cheap: the same 300 files had from 1 to
/// 16 realms. Nor does what a realm has loaded say what it costs: from 0.06 to 2.7 seconds for a MB of source.
const BYTES_IN_THE_COST: f64 = 1e6;

#[derive(Default)]
struct Left {
    /// How large the files are that are still to come.
    bytes: u64,
    /// How large those were of which it was known at first.
    at_first: u64,
    /// How large those are that may come, and of which it has not shown.
    possible: u64,
    /// How large those are that have come, and those that have not.
    shown: (u64, u64),
    /// How many realms there can be. 0: nobody has said, and there is one.
    most: usize,
}

/// Decides how many realms a run has.
#[derive(Default)]
pub struct Demand(Guarded<Left>);

impl Demand {
    /// [`Engine::expect`]
    pub fn expect(&self, size: u64, most: usize) {
        *self.0.lock() = Left {
            bytes: size,
            at_first: size,
            most,
            ..Left::default()
        };
    }

    /// [`Engine::may_come`]
    pub fn may_come(&self, size: u64) {
        self.0.lock().possible = size;
    }

    /// [`Engine::comes`]
    pub fn comes(&self, size: u64) {
        self.0.lock().bytes += size;
    }

    /// [`Engine::has_shown`]
    pub fn has_shown(&self, size: u64, has_come: bool) {
        let mut left = self.0.lock();
        left.possible = left.possible.saturating_sub(size);
        match has_come {
            true => left.shown.0 += size,
            false => left.shown.1 += size,
        }
    }

    /// How large the files are that are still to come, as far as can be told.
    pub fn left(&self) -> u64 {
        self.0.lock().expected() as u64
    }

    /// A file of `size` bytes is done.
    pub fn note(&self, size: usize) {
        let mut left = self.0.lock();
        left.bytes = left.bytes.saturating_sub(size as u64);
    }

    /// Whether to start another realm beside the `realms` that there are, all of which are in use: by how much sooner a run with
    /// these files ends with it, against what it costs. By all the files of the run, not by those that are left: how many are
    /// left when a thread happens to ask is up to the clock.
    pub fn is_worth_another(&self, realms: usize) -> bool {
        let left = self.0.lock();
        if realms == 0 || realms >= left.most {
            return realms == 0;
        }
        // Until it is of use the others go on. Then they are one more.
        let (all, realms) = (left.all() / BYTES_IN_THE_COST, realms as f64);
        (all / realms - 1.0) / (realms + 1.0) >= SHARE_TO_SAVE
    }
}

impl Left {
    /// Of those that may come, as large a part as has come of those of which it has shown. The first that comes says little: as
    /// if what a realm costs had shown before, and not come.
    fn still_to_show(&self) -> f64 {
        let (come, not) = (self.shown.0 as f64, self.shown.1 as f64);
        self.possible as f64 * come / (come + not + BYTES_IN_THE_COST)
    }

    /// How large the files are that are still to come, as far as can be told.
    fn expected(&self) -> f64 {
        self.bytes as f64 + self.still_to_show()
    }

    /// How large the files of the whole run are, as far as can be told.
    fn all(&self) -> f64 {
        (self.at_first + self.shown.0) as f64 + self.still_to_show()
    }
}
