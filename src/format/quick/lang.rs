//! The languages, and how one is run inside another.
//!
//! What Prettier does for embedded code: walk the whole tree once more before printing, cut the code out as a new string,
//! normalize a new set of options, parse, print to a doc, strip its last line break, walk that doc to put expressions in
//! the place of placeholders, and keep it in a map until the printer comes by. All of it asynchronous.
//!
//! Here there is no separate pass and no separate result. The printer of the host, when it stands at the node, calls
//! embed(), and the guest's printer appends to the same stream, between what the host wrote before and what it writes after.
//! If the code does not parse, the stream is cut back to where it was and the host prints the node as plain text.

use crate::{Quick, R, why};

pub(crate) struct Lang {
    /// options.parser: the language that is running.
    pub(crate) lang: i32,
    /// 0 for the file itself. A language prints the line break at the end of its output only at depth 0.
    pub(crate) depth: i32,
    pub(crate) guest_column: i32,
    pub(crate) next_guest_column: i32,
    /// Prettier's `__onHtmlRoot`: HTML as a guest says how many children its root has.
    pub(crate) top_level_count: i32,
}
impl Lang {
    pub(crate) fn new() -> Self {
        Self {
            lang: 0,
            depth: 0,
            guest_column: 0,
            next_guest_column: -1,
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
/// The column at which the lines of the running guest start, if its host knows that for sure: the guest starts a line there, the indentation is blanks (or
/// nothing), every line of the guest is indented from there, and a line break follows the guest. -1 if the host does not know, which is the rule. 0 for the
/// file itself. A language that writes texts with line breaks in them can do so where this is 0.
/// GUEST_BETWEEN_LINES: the column is not known, but the guest stands between two lines of a group, which break if anything in the guest does.
pub(crate) const GUEST_BETWEEN_LINES: i32 = -2;
impl Quick {
    /// A host, right before embed(): holds for that guest only.
    pub(crate) fn set_guest_column(&mut self, column: i32) {
        self.lang.next_guest_column = column;
    }

    #[expect(dead_code, reason = "for code in other languages")]
    pub(crate) fn set_top_level_count(&mut self, count: i32) {
        self.lang.top_level_count = count;
    }
}

impl Quick {
    /// Appends the document of T[start, end), read as `language`, without a line break at its end.
    /// Returns false, and leaves the document as it was, if that text has a syntax error or the language is not there.
    ///
    /// No other language writes into this document so far: the file is left to the long way.
    pub(crate) fn embed(&mut self, _language: i32, _start: i32, _end: i32) -> R<bool> {
        if self.has_no_guests() {
            return Ok(false);
        }
        Err(self.stop(why::GUEST))
    }

    pub(crate) fn is_registered(&self, _language: i32) -> bool {
        !self.has_no_guests()
    }

    /// For tools: code in other languages is printed as if nobody knew these languages.
    #[inline(always)]
    fn has_no_guests(&self) -> bool {
        #[cfg(feature = "stages")]
        return self.no_guests;
        #[cfg(not(feature = "stages"))]
        false
    }
}
