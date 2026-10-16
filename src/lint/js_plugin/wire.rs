//! What the two sides say to each other. All numbers are little-endian.

/// What the program is called with.
pub(super) mod call {
    /// JSON: `[where the plugin is, its position among the plugins, the number of its first rule]`, the latter two `null` for
    /// a plugin that is loaded for the first time. The result is JSON: what the plugin consists of.
    pub(crate) const LOAD: u32 = 1;
    /// A file to lint: see `lint` in `worker/main.js`. The result is JSON: the indices of the variables that rules have marked as
    /// used, or nothing if there are none. The reports come before that, with [`REPORTS`](super::ask::REPORTS).
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
    /// Given JSON, selectors as text: JSON, for each its number, or the message of what ESLint throws.
    pub(crate) const SELECTORS: u32 = 4;
    /// The tokens, the comments, and the values of tokens that espree decodes. See `tokens.rs` for the layout.
    pub(crate) const TOKENS: u32 = 7;
    /// Only the comments, which takes no scan of the file.
    pub(crate) const COMMENTS: u32 = 8;
    /// Only after [`LISTEN`].
    pub(crate) const SCOPES: u32 = 9;
    /// Not a question. Given JSON, `[modules, bytes, milliseconds]`: what has been loaded since the last time, if that is
    /// measured.
    pub(crate) const LOADED: u32 = 10;
    /// The code paths, their segments and the events. Only after [`LISTEN`]. See `code_path/estree.rs` for the layout.
    pub(crate) const CODE_PATHS: u32 = 11;
    /// Not a question. Given the reports about the file so far: see `reports.rs`.
    pub(crate) const REPORTS: u32 = 12;
    /// The comments that configure ESLint: see `directives.rs`.
    pub(crate) const CONFIG_COMMENTS: u32 = 13;
    /// Given words, flags and then a kind and a number for each group of listeners: how many words the calls take and how many
    /// bytes the tree, then the calls, as `calls.rs` describes them, then the tree. The flags are those below. The kinds are
    /// 0 for entering a type, 1 for leaving it, 2 for a selector and 3 for an event of the code path analysis.
    pub(crate) const LISTEN: u32 = 14;
    /// The program doesn't have the tree yet. It comes if there are calls.
    pub(crate) const LACKS_TREE: u32 = 1;
    /// It comes in any case.
    pub(crate) const WANTS_TREE: u32 = 2;
    /// All events of the code path analysis are among the calls, also those that nothing listens for.
    pub(crate) const WANTS_ALL_EVENTS: u32 = 4;
    /// Which properties the nodes of each type have: see `layouts.rs`. A realm asks once.
    pub(crate) const LAYOUTS: u32 = 15;
    /// What the libraries of TypeScript define for the file, in the order in which typescript-eslint defines it. Words: one more than
    /// the highest number of a name, how many variables there are, then for each the number of its name `<< 2`, 1 if it is a type, 2 if it
    /// is a value.
    pub(crate) const LIB_VARIABLES: u32 = 16;
    /// The name with the number that the details are, a word.
    pub(crate) const LIB_NAME: u32 = 17;
    /// The word of [`LIB_VARIABLES`] for the name that the details are. Nothing: the libraries don't define it.
    pub(crate) const LIB_VARIABLE: u32 = 18;
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
