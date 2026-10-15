//! What the whole-program analysis of `bun build --compile --aot` found, as the bundler passes it on.

pub struct EarlyEngine {
    thread: Option<std::thread::JoinHandle<usize>>,
    strings: Option<std::sync::mpsc::Sender<Vec<u8>>>,
    discard: fn(usize),
}

impl EarlyEngine {
    pub fn new(thread: std::thread::JoinHandle<usize>, strings: Option<std::sync::mpsc::Sender<Vec<u8>>>, discard: fn(usize)) -> EarlyEngine {
        EarlyEngine { thread: Some(thread), strings, discard }
    }

    pub fn replace_strings(&mut self, pairs: &[u8]) {
        if let Some(strings) = self.strings.take() {
            let _ = strings.send(pairs.to_vec());
        }
    }

    pub fn finish(mut self) -> Option<usize> {
        self.strings = None;
        self.thread.take()?.join().ok()
    }
}

impl Drop for EarlyEngine {
    fn drop(&mut self) {
        self.strings = None;
        if let Some(prepared) = self.thread.take().and_then(|thread| thread.join().ok()) {
            (self.discard)(prepared);
        }
    }
}

pub struct ProgramFacts {
    pub engine: Option<EarlyEngine>,
    /// The program, compiled from its types as far as the code generator of the engine: it runs in the place of the entry point.
    pub typed: Option<Box<[u8]>>,
    /// The paths of the entry points that `typed` has an entry function for, in the order of those.
    pub entry_points: Box<[Box<[u8]>]>,
    pub tokens: Option<Box<[u8]>>,
}
