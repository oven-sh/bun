//! What the two sides say to each other. All numbers are little-endian.

/// What the program is called with.
pub(super) mod call {
    /// JSON: `[where the plugin is, its position among the plugins, the number of its first rule]`, the latter two `null` for
    /// a plugin that is loaded for the first time. The result is JSON: what the plugin consists of.
    pub(crate) const LOAD: u32 = 1;
    /// A file to lint: see `lint` in `worker/main.js`. The result is JSON:
    /// `[reports, the indices of the variables that rules have marked as used]`, or nothing if there are none.
    pub(crate) const LINT: u32 = 2;
}

/// The first byte of what a call returns.
pub(super) mod result {
    pub(crate) const DONE: u8 = b'0';
    /// For [`LOAD`](super::call::LOAD) text, for [`LINT`](super::call::LINT) JSON: `[rule, message, line]`.
    pub(crate) const FAILED: u8 = b'1';
    /// JSON: the positions of the plugins that have to be loaded before the file can be linted.
    pub(crate) const NEEDS_PLUGINS: u8 = b'2';
}

/// What the program asks for.
pub(super) mod ask {
    /// JSON: see `write_start` in `schema.rs`. A realm asks once.
    pub(crate) const START: u32 = 1;
    /// JSON: `{ settings, languageOptions, globals }` for the file.
    pub(crate) const SETTINGS: u32 = 2;
    /// JSON: `[rule, options]` for the rule at a position among those that run on the file.
    pub(crate) const CONFIGURED: u32 = 3;
    /// Given JSON, selectors as text: JSON, for each `[number, attributeCount, identifierCount]`, or the message of what
    /// ESLint throws.
    pub(crate) const SELECTORS: u32 = 4;
    /// Given JSON, the numbers of selectors: the tree, and what matches each.
    pub(crate) const AST: u32 = 5;
    /// The same without the tree.
    pub(crate) const MATCHES: u32 = 6;
    /// The tokens and the comments.
    pub(crate) const TOKENS: u32 = 7;
    pub(crate) const COMMENTS: u32 = 8;
    /// Only after [`AST`].
    pub(crate) const SCOPES: u32 = 9;
    /// Not a question. Given JSON, `[modules, bytes, milliseconds]`: what has been loaded since the last time, if that is
    /// measured.
    pub(crate) const LOADED: u32 = 10;
}

pub(super) fn words(out: &mut Vec<u8>, words: &[u32]) {
    out.reserve(words.len() * 4);
    for word in words {
        out.extend_from_slice(&word.to_le_bytes());
    }
}
