//! What the two sides say to each other. All numbers are little-endian.

/// What the program is called with.
pub(super) mod call {
    /// JSON: `[where the plugin is, its position among the plugins, the number of its first rule]`, the latter two `null` for
    /// a plugin that is loaded for the first time. The result is JSON: what the plugin consists of.
    pub(crate) const LOAD: u32 = 1;
    /// A file to lint: see `lint` in `worker/main.js`. The result is JSON:
    /// `[reports, the indices of the variables that rules have marked as used]`, or nothing if there are none.
    pub(crate) const LINT: u32 = 2;
    /// JSON: `[id, settings, sources]`: the settings of a file, of which `settings.settings` is to be taken from the objects
    /// `sources` of a configuration file.
    pub(crate) const LOAD_SETTINGS: u32 = 3;
}

/// The first byte of what a call returns.
pub(super) mod result {
    pub(crate) const DONE: u8 = b'0';
    /// For [`LOAD`](super::call::LOAD) text, for [`LINT`](super::call::LINT) JSON: `[rule, message, line]`.
    pub(crate) const FAILED: u8 = b'1';
    /// JSON: the positions of the plugins that have to be loaded before the file can be linted.
    pub(crate) const NEEDS_PLUGINS: u8 = b'2';
    /// The settings of the file have to be loaded before it can be linted: [`LOAD_SETTINGS`](super::call::LOAD_SETTINGS).
    pub(crate) const NEEDS_SETTINGS: u8 = b'6';
}

/// What the program asks for.
pub(super) mod ask {
    /// JSON: see `write_start` in `schema.rs`. A realm asks once.
    pub(crate) const START: u32 = 1;
    /// JSON: `{ settings, languageOptions, globals }` for the file.
    pub(crate) const SETTINGS: u32 = 2;
    /// JSON: `[rule, options, id, location, plugin]` for the rule at a position among those that run on the file.
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
    /// The code paths, their segments and the events. Only after [`AST`]. See `code_path/estree.rs` for the layout.
    pub(crate) const CODE_PATHS: u32 = 11;
    /// Not a question. Given the reports about the file so far: see `reports.rs`.
    pub(crate) const REPORTS: u32 = 12;
    /// The comments that configure ESLint: see `directives.rs`.
    pub(crate) const CONFIG_COMMENTS: u32 = 13;
}

/// Appends `list` to `lists`, its length first, and returns its offset. The empty list is at offset 0, so `lists` has to start
/// with a 0.
pub(crate) fn push_list(lists: &mut Vec<u32>, list: &[u32]) -> u32 {
    if list.is_empty() {
        return 0;
    }
    let at = lists.len() as u32;
    lists.push(list.len() as u32);
    lists.extend_from_slice(list);
    at
}

pub(super) fn words(out: &mut Vec<u8>, words: &[u32]) {
    out.reserve(words.len() * 4);
    for word in words {
        out.extend_from_slice(&word.to_le_bytes());
    }
}
