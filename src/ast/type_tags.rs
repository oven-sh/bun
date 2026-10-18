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

const OPENED_BY_EVALUATING_TEXT: [&[u8]; 4] = [b"a call of eval", b"a call of Function", b"eval", b"Function"];

pub fn what_the_flag_against_code_from_strings_would_do(runtime_use: &[u8]) -> Option<&'static str> {
    let lines = || runtime_use.split(|&byte| byte == b'\n');
    if !lines().any(|line| line == b"text-to-code allowed") {
        return None;
    }
    let evaluates_text = |reason: &[u8]| OPENED_BY_EVALUATING_TEXT.iter().any(|why| reason.strip_prefix(*why).is_some_and(|rest| rest.is_empty() || rest.starts_with(b" in ")));
    let mut reasons = lines().filter_map(|line| line.strip_prefix(b"open ")).peekable();
    if reasons.peek().is_none() {
        return Some("with --disallow-code-generation-from-strings, eval and Function throw and what evaluates text can be left out");
    }
    reasons.all(evaluates_text).then_some("only eval and Function open the world: with --disallow-code-generation-from-strings they throw and the world is closed")
}

pub fn open_world(runtime_use: &[u8], why: &[u8]) -> Vec<u8> {
    let Some(facts) = runtime_use.strip_prefix(b"closed").filter(|facts| facts.is_empty() || facts.starts_with(b"\n")) else {
        return runtime_use.to_vec();
    };
    let before_last_line: &[u8] = if facts.ends_with(b"\n") { b"" } else { b"\n" };
    [b"open ", why, facts, before_last_line, b"world open\n"].concat()
}
