//! What goes through the pipe: messages, each a header of two numbers, the length of what follows
//! and what it is, and then that many bytes. All numbers are little-endian.

/// What a message to a worker is.
#[derive(Copy, Clone)]
#[repr(u32)]
pub(super) enum ToWorker {
    /// The program, as text.
    Program = 1,
    /// JSON: see `start` in `worker/main.js`.
    Start = 2,
    /// JSON: a plugin to load.
    Load = 3,
    /// JSON: `[id, settings]` of a [`FileSettings`](super::FileSettings).
    Settings = 4,
    /// JSON: `[id, rule, options]` of a [`Configured`](super::Configured).
    Configure = 5,
    /// A file to lint.
    Lint = 6,
    /// The answers to what [`FromWorker`] asks for.
    Ast = 7,
    Matches = 8,
    /// JSON: what the selectors that the worker has just sent are like. It precedes the answer.
    Selectors = 9,
    Tokens = 10,
    Comments = 11,
    Scopes = 12,
}

/// What a message from a worker is.
pub(super) mod from_worker {
    /// JSON: what a plugin consists of.
    pub(crate) const LOADED: u32 = 1;
    /// Text: why what was asked for cannot be done.
    pub(crate) const FAILED: u32 = 2;
    /// JSON: the reports. Nothing if there are none.
    pub(crate) const DONE: u32 = 3;
    /// JSON: `[new selectors, the indices of the selectors to match]`.
    pub(crate) const NEEDS_AST: u32 = 4;
    pub(crate) const NEEDS_MATCHES: u32 = 5;
    /// The tokens and the comments.
    pub(crate) const NEEDS_TOKENS: u32 = 6;
    pub(crate) const NEEDS_COMMENTS: u32 = 7;
    /// It has the tree.
    pub(crate) const NEEDS_SCOPES: u32 = 8;
}

/// Appends a message, whose content `write` appends.
pub(super) fn message(out: &mut Vec<u8>, kind: ToWorker, write: impl FnOnce(&mut Vec<u8>)) {
    let header = out.len();
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(kind as u32).to_le_bytes());
    write(out);
    let len = (out.len() - header - 8) as u32;
    out[header..header + 4].copy_from_slice(&len.to_le_bytes());
}

pub(super) fn words(out: &mut Vec<u8>, words: &[u32]) {
    out.reserve(words.len() * 4);
    for word in words {
        out.extend_from_slice(&word.to_le_bytes());
    }
}
