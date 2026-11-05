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
    /// What setJsMode() was called with last.
    pub(crate) js_mode_language: i32,
    /// The parser takes `a!` for a NonNullExpression: TypeScript, and the expressions of Angular.
    pub(crate) allows_non_null: bool,
}
impl Mode {
    pub(crate) fn new() -> Self {
        Self {
            unquotes_numbers: true,
            is_type_script: false,
            is_flow: false,
            is_babel_flow: false,
            js_mode_language: 0,
            allows_non_null: false,
        }
    }
}

impl Quick {
    pub(crate) fn set_js_mode(&mut self, language: i32) {
        self.mode.js_mode_language = language;
        self.mode.unquotes_numbers = language == lang::Babel;
        self.mode.is_type_script = language == lang::TypeScript;
        self.mode.is_babel_flow = language == lang::BabelFlow;
        self.mode.is_flow = language == lang::Flow || self.mode.is_babel_flow;
        self.mode.allows_non_null = self.mode.is_type_script;
    }
}
