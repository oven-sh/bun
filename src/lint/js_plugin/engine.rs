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

/// How much of the time that a realm takes to start it has to save. With 1, 0.5 and 0.25 mermaid-js/mermaid, where a realm takes
/// 6 s and all files 30 s, has 2, 3 and 3 realms (4 are the fastest, 16 as slow as 1, with 8 times the memory), and 26,701 files
/// with plugins that take 1.8 s have 7, 10 and 14 (16 are the fastest).
const SHARE_TO_SAVE: f64 = 0.5;

/// After so many files it is known how long one takes.
const FILES_TO_MEASURE: u32 = 4;

/// How many bytes are linted in the time that a realm takes to start, as long as that is not known: 0.5 to 1.4 MB with the
/// configurations of openlayers, mermaid and vscode.
const BYTES_IN_A_START: f64 = 1e6;

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
        // How many times a realm could start while one lints the files that are left.
        let starts = measured.bytes_left as f64
            / match measured.start {
                Some(start) if measured.files >= FILES_TO_MEASURE => {
                    start.as_secs_f64() * measured.bytes as f64 / measured.time.as_secs_f64()
                }
                _ => BYTES_IN_A_START,
            };
        // Until it has started the others go on. Then they are one more.
        let realms = realms as f64;
        (starts / realms - 1.0) / (realms + 1.0) >= SHARE_TO_SAVE
    }
}
