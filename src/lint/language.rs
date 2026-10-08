//! ESLint's `languageOptions` and `settings`: what the configuration says about the code of a
//! file.

use crate::options::Json;

/// ESLint's `languageOptions.sourceType`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourceType {
    Module,
    Script,
    /// A script whose top level is the body of a function: `return` is allowed there, and what is
    /// declared there is not global.
    CommonJs,
}

/// How a global variable may be used.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Global {
    /// `"readonly"`, `"readable"`, `false`
    Readonly,
    /// `"writable"`, `"writeable"`, `true`
    Writable,
    /// `"off"`: it does not exist.
    Off,
}

#[derive(Clone, Debug)]
pub struct LanguageOptions {
    /// The year: 2015, 2016, .. For ES3 and ES5, 3 and 5.
    pub ecma_version: u32,
    pub source_type: SourceType,
    /// `languageOptions.globals`. Sorted by name. What the ECMAScript version defines is not
    /// listed here.
    pub globals: Vec<(Box<[u8]>, Global)>,
    /// `parserOptions.ecmaFeatures.globalReturn`
    pub global_return: bool,
    /// `parserOptions.ecmaFeatures.impliedStrict`
    pub implied_strict: bool,
    /// `parserOptions.ecmaFeatures.jsx`
    pub jsx: bool,
    /// All of `languageOptions.parserOptions`.
    pub parser_options: Json,
    /// ESLint's `settings`.
    pub settings: Json,
}

impl LanguageOptions {
    pub const LATEST_ECMA_VERSION: u32 = 2026;

    pub fn global(&self, name: &[u8]) -> Option<Global> {
        let at = self.globals.binary_search_by(|it| (*it.0).cmp(name)).ok()?;
        Some(self.globals[at].1)
    }
}

impl Default for LanguageOptions {
    fn default() -> Self {
        LanguageOptions {
            ecma_version: Self::LATEST_ECMA_VERSION,
            source_type: SourceType::Module,
            globals: Vec::new(),
            global_return: false,
            implied_strict: false,
            jsx: false,
            parser_options: Json::Null,
            settings: Json::Null,
        }
    }
}
