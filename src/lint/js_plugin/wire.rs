//! The protocol between the two sides. All numbers are little-endian.

/// The kinds of calls into the program.
pub(super) mod call {
    /// JSON: `[the plugin's location, its index among the plugins, the number of its first rule]`. The last two are
    /// `null` for a plugin that's loaded for the first time. The result is JSON that describes the plugin's contents.
    pub(crate) const LOAD: u32 = 1;
    /// A file to lint. See `lint` in `worker/main.js`. The result is a JSON list of the indices of the variables that
    /// rules marked as used, or empty if there are none. The reports arrive before that, through
    /// [`REPORTS`](super::ask::REPORTS).
    pub(crate) const LINT: u32 = 2;
    /// JSON: `[id, settings, sources]`. These are a file's settings, where `settings.settings` has to be taken from the
    /// objects `sources` of a config file.
    pub(crate) const LOAD_SETTINGS: u32 = 3;
}

/// The first byte of a call's result.
pub(super) mod result {
    pub(crate) const DONE: u8 = b'0';
    /// Followed by text for [`LOAD`](super::call::LOAD), and by the JSON `[rule, message, line]` for
    /// [`LINT`](super::call::LINT).
    pub(crate) const FAILED: u8 = b'1';
    /// JSON: the indices of the plugins that have to be loaded before the file can be linted.
    pub(crate) const NEEDS_PLUGINS: u8 = b'2';
    /// The file's settings have to be loaded before it can be linted. See
    /// [`LOAD_SETTINGS`](super::call::LOAD_SETTINGS).
    pub(crate) const NEEDS_SETTINGS: u8 = b'6';
}

/// The program's requests.
pub(super) mod ask {
    /// JSON: see `write_start` in `schema.rs`. A realm requests it once.
    pub(crate) const START: u32 = 1;
    /// JSON: `{ settings, languageOptions, globals }` for the file.
    pub(crate) const SETTINGS: u32 = 2;
    /// JSON: `[rule, options, id, location, plugin]` for the rule at a given index among the rules that run on the
    /// file.
    pub(crate) const CONFIGURED: u32 = 3;
    /// Takes a JSON list of selector strings. Returns JSON with each selector's number, or the message of the error
    /// that ESLint throws.
    pub(crate) const SELECTORS: u32 = 4;
    /// The tokens, the comments, and the values of tokens that espree decodes. See `tokens.rs` for the layout.
    pub(crate) const TOKENS: u32 = 7;
    /// Only the comments, which doesn't require scanning the file.
    pub(crate) const COMMENTS: u32 = 8;
    /// Only valid after [`LISTEN`].
    pub(crate) const SCOPES: u32 = 9;
    /// A notification, not a request. Takes the JSON `[modules, bytes, milliseconds]`: what was loaded since the last
    /// notification, if that's being measured.
    pub(crate) const LOADED: u32 = 10;
    /// The code paths, their segments and the events. Only valid after [`LISTEN`]. See `code_path/estree.rs` for the
    /// layout.
    pub(crate) const CODE_PATHS: u32 = 11;
    /// A notification, not a request. Takes the file's reports so far. See `reports.rs`.
    pub(crate) const REPORTS: u32 = 12;
    /// The comments that configure ESLint. See `directives.rs`.
    pub(crate) const CONFIG_COMMENTS: u32 = 13;
    /// Takes words: the flags below, then a kind and a number for each group of listeners. Returns the size of the
    /// calls in words and of the tree in bytes, then the calls as `calls.rs` describes them, then the tree. The kinds
    /// are 0 for entering a type, 1 for leaving it, 2 for a selector and 3 for a code path analysis event.
    pub(crate) const LISTEN: u32 = 14;
    /// The program doesn't have the tree yet. Send it if there are calls.
    pub(crate) const LACKS_TREE: u32 = 1;
    /// Send the tree in any case.
    pub(crate) const WANTS_TREE: u32 = 2;
    /// Include every code path analysis event in the calls, even those without a listener.
    pub(crate) const WANTS_ALL_EVENTS: u32 = 4;
    /// The properties that each node type has. See `layouts.rs`. A realm requests it once.
    pub(crate) const LAYOUTS: u32 = 15;
    /// The variables that TypeScript's libraries define for the file, in typescript-eslint's order. Words: one more
    /// than the highest name number, the variable count, then for each variable its name number `<< 2`, plus 1 if it's
    /// a type and 2 if it's a value.
    pub(crate) const LIB_VARIABLES: u32 = 16;
    /// The name whose number is given in the details, as one word.
    pub(crate) const LIB_NAME: u32 = 17;
    /// The [`LIB_VARIABLES`] word for the name given in the details. Empty if the libraries don't define it.
    pub(crate) const LIB_VARIABLE: u32 = 18;
}

/// Appends `list` to `lists`, prefixed with its length, and returns its offset. The empty list is at offset 0, so
/// `lists` has to start with a 0.
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
