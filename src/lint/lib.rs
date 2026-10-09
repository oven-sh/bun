//! The linter: an API for writing lint rules on the syntax and the types that `bun check` works
//! from, and what runs them.
//!
//! - [`ast`]: the syntax of a file.
//! - [`semantic`]: scopes, symbols, references.
//! - [`tokens`]: tokens and comments.
//! - [`types`][]: types.
//! - [`code_path`]: ESLint's code path analysis.
//! - [`rule`]: what a rule is. Start there.
//! - [`js_plugin`]: rules that are written in JavaScript.
//!
//! The rules are in the crates `bun_lint_eslint`, `bun_lint_typescript`, `bun_lint_plugins`, `bun_lint_unicorn`, `bun_lint_react`
//! and `bun_lint_jest`.

#![forbid(unsafe_code)]

pub mod ast;
pub mod code_path;
pub mod context;
pub(crate) mod estree;
pub mod fix;
pub mod js_plugin;
pub mod json;
pub mod language;
pub mod linter;
pub mod literal;
pub mod modules;
pub mod options;
pub(crate) mod oxlint_messages;
pub mod regex;
pub mod rule;
pub mod runner;
pub mod selector;
pub mod semantic;
pub mod source;
pub mod span;
pub mod tokens;
pub mod types;
pub mod utils;

/// For the harness, which compares the table of `estree` with what typescript-estree and espree produce. Rules have no use for it.
#[doc(hidden)]
pub mod estree_for_tests {
    pub use crate::estree::*;
}

/// What a rule imports.
pub mod prelude {
    pub use crate::ast::*;
    pub use crate::code_path::{CodePath, CurrentSegments, Origin, Segment, Traversal};
    pub use crate::context::{Cx, IntoText, Report};
    pub use crate::fix::{Fix, Fixer};
    pub use crate::language::{Global, LanguageOptions, SourceType};
    pub use crate::literal::Literal;
    pub use crate::options::{Json, Object, Options};
    pub use crate::regex::Regex;
    pub use crate::rule::{Fixable, Kind, Listeners, Message, Meta, NodeTags, Presets, Rule};
    pub use crate::semantic::{
        Declaration, DeclarationKind, Reference, ReferenceFlags, Scope, ScopeKind, Symbol,
    };
    pub use crate::span::{Position, Span, Spanned};
    pub use crate::tokens::{Token, TokenKind, Tokens, skip_trivia, skip_trivia_back};
    pub use crate::utils::{self, ast_utils, eslint_utils, text, ts_utils};
}
