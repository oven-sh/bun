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
    pub typed: Option<Box<[u8]>>,
    pub entry_points: Box<[Box<[u8]>]>,
    pub builtin_modules_of_entry_points: Vec<Vec<Box<[u8]>>>,
    pub tokens: Option<Box<[u8]>>,
    pub runtime_use: Option<Box<[u8]>>,
}
