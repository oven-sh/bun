//! What the printer of the JavaScript family does differently from parser to parser, worked out once per run instead of
//! asked at every node.

use crate::Quick;
use crate::lang::lang;

pub(crate) struct Mode {
    /// Only the parsers of plain JavaScript turn the key "1" into 1.
    pub(crate) unquotes_numbers: bool,
    /// The tree has the nodes of TypeScript (TSUnionType ..), or those of Flow (UnionTypeAnnotation ..), where a kind stands for both.
    pub(crate) is_type_script: bool,
    pub(crate) is_flow: bool,
    /// Flow, read by Babel: types in comments count, and the parentheses behind a JSDoc type cast stay.
    pub(crate) is_babel_flow: bool,
    /// The tree has a ChainExpression around an optional chain: the trees of TypeScript's and of Flow's parser. In Babel's, which also
    /// reads the expressions of a host in TypeScript, the links of the chain are nodes of other types instead (OptionalCallExpression ..).
    pub(crate) wraps_chains: bool,
    /// What set_js_mode() was called with last.
    pub(crate) js_mode_language: i32,
    /// The parser takes `a!` for a NonNullExpression: TypeScript, and the expressions of Angular.
    pub(crate) allows_non_null: bool,
    /// A program that is one expression statement is printed in a special way: SINGLE_*, or 0.
    pub(crate) single_statement_mode: i32,
    /// An expression of Vue: `a | b` at the top is a filter.
    pub(crate) has_vue_filters: bool,
}
impl Mode {
    pub(crate) fn new() -> Self {
        Self {
            unquotes_numbers: true,
            is_type_script: false,
            is_flow: false,
            is_babel_flow: false,
            wraps_chains: false,
            js_mode_language: 0,
            allows_non_null: false,
            single_statement_mode: 0,
            has_vue_filters: false,
        }
    }
}

pub(crate) const SINGLE_JSX_IN_MARKDOWN: i32 = 3;

impl Quick {
    pub(crate) fn set_js_mode(&mut self, language: i32) {
        self.mode.js_mode_language = language;
        self.mode.unquotes_numbers = language == lang::Babel;
        self.mode.is_type_script = language == lang::TypeScript;
        self.mode.is_babel_flow = language == lang::BabelFlow;
        self.mode.is_flow = language == lang::Flow || self.mode.is_babel_flow;
        self.mode.allows_non_null = self.mode.is_type_script;
        self.mode.has_vue_filters = self.host.has_vue_filters;
        self.mode.wraps_chains = self.mode.is_type_script || language == lang::Flow;
        if self.host.wrap != crate::js::WRAP_NONE {
            // no parser for programs
            self.mode.unquotes_numbers = false;
            self.mode.wraps_chains = false;
        }
        self.mode.single_statement_mode = if self.options.is_in_markdown {
            SINGLE_JSX_IN_MARKDOWN
        } else {
            0
        };
    }
}
