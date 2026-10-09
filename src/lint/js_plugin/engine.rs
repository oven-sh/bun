//! Where the JavaScript runs.

use bun_threading::Guarded;
use std::time::Duration;

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

    /// Says how many files are going to need a realm, how large they are together, and how many realms there can be at most.
    /// Nobody says so if a realm is needed to find out.
    fn expect(&self, _files: usize, _size: u64, _most: usize) {}

    /// How many realms there can be at a time.
    fn most_realms(&self) -> usize {
        usize::MAX
    }
}

/// How much of what a realm costs it has to save: time against memory. With 0.5 openlayers (8 MB) has 4 realms, mermaid (7 MB) 3
/// and vscode (180 MB) 16, and none takes twice the memory of ESLint. With 1 they have 3, 2 and 13, with 0.25 6, 4 and 16.
const SHARE_TO_SAVE: f64 = 0.5;

/// What a realm costs, in what it takes from its start to the end of its first file. It stays slow for a while: its code is not
/// compiled yet, and each plugin fills caches of its own. That alone is 1.2 (vscode, mermaid) to 3.4 (openlayers), and the files
/// by which the rest is judged are those that it is slow with.
const COST_IN_STARTS: f64 = 4.0;

/// After so many files it is known how long one takes, if they have taken as long as a start.
const FILES_TO_MEASURE: u32 = 4;

/// How many bytes are linted in the time that a realm costs, as long as that is not known: 1.0 to 1.5 MB with the
/// configurations of openlayers, vscode and mermaid, whose files take 7, 0.6 and 4 ms per KB.
const BYTES_IN_THE_COST: f64 = 1e6;

#[derive(Default)]
struct Measured {
    /// How large the files are that are still to come. Not how many they are: the largest come first.
    bytes_left: u64,
    /// How many realms there can be. 0: nobody has said, and there is one.
    most: usize,
    /// How long the first realm took from its start to the end of its first file: it has loaded the plugins by then, and
    /// they what they load when they first run.
    start: Option<Duration>,
    /// How many files realms were given after their first, how large they were, and how long they took.
    files: u32,
    bytes: u64,
    time: Duration,
}

/// Decides how many realms a run has, by what it measures. What a realm takes to start differs by 20 times from one
/// configuration to another, and so does what a file takes.
#[derive(Default)]
pub struct Demand(Guarded<Measured>);

impl Demand {
    /// [`Engine::expect`]
    pub fn expect(&self, size: u64, most: usize) {
        let mut measured = self.0.lock();
        (measured.bytes_left, measured.most) = (size, most);
    }

    /// A realm has been used for `time`, for a file of `size` bytes. `since_its_start`: it was its first time, which ends so
    /// long after the realm was started.
    pub fn note(&self, size: usize, time: Duration, since_its_start: Option<Duration>) {
        let mut measured = self.0.lock();
        measured.bytes_left = measured.bytes_left.saturating_sub(size as u64);
        match since_its_start {
            Some(start) => _ = measured.start.get_or_insert(start),
            None => {
                measured.files += 1;
                measured.bytes += size as u64;
                measured.time += time;
            }
        }
    }

    /// Whether to start another realm beside the `realms` that there are, all of which are in use.
    pub fn is_worth_another(&self, realms: usize) -> bool {
        let measured = self.0.lock();
        if realms == 0 || realms >= measured.most {
            return realms == 0;
        }
        // What one realm takes for the files that are left, in what another one costs.
        let left = measured.bytes_left as f64
            / match measured.start {
                Some(start) if measured.files >= FILES_TO_MEASURE && measured.time >= start => {
                    let rate = measured.bytes as f64 / measured.time.as_secs_f64();
                    COST_IN_STARTS * start.as_secs_f64() * rate
                }
                _ => BYTES_IN_THE_COST,
            };
        // Until it is of use the others go on. Then they are one more.
        let realms = realms as f64;
        (left / realms - 1.0) / (realms + 1.0) >= SHARE_TO_SAVE
    }
}
