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

#[derive(Default)]
struct Left {
    /// How large the files are that are still to come.
    bytes: u64,
    /// How many realms there can be. 0: nobody has said, and there is one.
    most: usize,
    /// How many seconds realms have taken until they had loaded what they need and linted their first file, and how many have.
    starting: (f64, u32),
    /// How many seconds realms have taken after that, and for how many bytes.
    linting: (f64, u64),
}

/// Decides how many realms a run has.
#[derive(Default)]
pub struct Demand(Guarded<Left>);

impl Demand {
    /// [`Engine::expect`]
    pub fn expect(&self, size: u64, most: usize) {
        *self.0.lock() = Left {
            bytes: size,
            most,
            ..Left::default()
        };
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
    }

    /// Whether to start another realm beside the `realms` that there are, all of which are in use: whether it is going to lint for
    /// as long as it takes to start, the others going on meanwhile.
    pub fn is_worth_another(&self, realms: usize) -> bool {
        let left = self.0.lock();
        if realms == 0 || realms >= left.most {
            return realms == 0;
        }
        let cost = match (left.starting, left.linting) {
            ((starting, realms @ 1..), (linting, bytes @ 1..)) if linting > 0.0 => {
                starting / f64::from(realms) * bytes as f64 / linting
            }
            _ => BYTES_IN_THE_COST,
        };
        left.bytes as f64 / realms as f64 > 2.0 * cost
    }
}
