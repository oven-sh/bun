//! The languages, and how one is run inside another.
//!
//! What Prettier does for embedded code: walk the whole tree once more before printing, cut the code out as a new string,
//! normalize a new set of options, parse, print to a doc, strip its last line break, walk that doc to put expressions in
//! the place of placeholders, and keep it in a map until the printer comes by. All of it asynchronous.
//!
//! Here there is no separate pass and no separate result. The printer of the host, when it stands at the node, calls
//! embed() (guest.rs), and the guest writes into the document of the file, between what the host wrote before and what it
//! writes after. If the code does not parse, the document is cut back to where it was and the host prints the node as plain text.

use crate::Quick;

pub(crate) struct Lang {
    /// options.parser: the language that is running.
    pub(crate) lang: i32,
    /// Prettier's `__onHtmlRoot`: HTML as a guest says how many children its root has.
    pub(crate) top_level_count: i32,
}
impl Lang {
    pub(crate) fn new() -> Self {
        Self {
            lang: 0,
            top_level_count: 0,
        }
    }
}

/// One for each of Prettier's parsers that prints differently.
#[allow(non_upper_case_globals)]
pub(crate) mod lang {
    /// also acorn, espree, meriyah, oxc
    pub(crate) const Babel: i32 = 1;
    /// also hermes
    pub(crate) const Flow: i32 = 2;
    /// also babel-ts, oxc-ts
    pub(crate) const TypeScript: i32 = 3;
    pub(crate) const Scss: i32 = 20;
    pub(crate) const GraphQL: i32 = 21;
    /// also remark
    pub(crate) const Markdown: i32 = 22;
    pub(crate) const Html: i32 = 25;
    pub(crate) const Angular: i32 = 27;
    /// babel-flow, and babel for a file with the @flow pragma: Flow as Babel reads it
    pub(crate) const BabelFlow: i32 = 31;
}
impl Quick {
    pub(crate) fn set_top_level_count(&mut self, count: i32) {
        self.lang.top_level_count = count;
    }
}
