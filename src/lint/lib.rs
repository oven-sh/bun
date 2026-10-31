//! The linter: an API for writing lint rules on top of the syntax tree and types that `bun check` uses, plus the code
//! that runs them.
//!
//! - [`ast`]: a file's syntax tree.
//! - [`semantic`]: scopes, symbols, references.
//! - [`tokens`]: tokens and comments.
//! - [`types`][]: types.
//! - [`code_path`]: ESLint's code path analysis.
//! - [`rule`]: how a rule is defined. Start there.
//! - [`js_plugin`]: rules written in JavaScript.
//! - [`languages`]: languages other than JavaScript.
//!
//! The rules are in the crates `bun_lint_eslint`, `bun_lint_typescript`, `bun_lint_plugins`, `bun_lint_unicorn`,
//! `bun_lint_react`, `bun_lint_jest`, `bun_lint_json` and `bun_lint_markdown`.

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]
// For code that only builds error text, like the message for a file that doesn't parse or for a rejected option.
// `#[optimize(size)]` roughly halves that code, and its speed doesn't matter. Nothing that runs for a file without
// errors uses it.
#![feature(optimize_attribute)]

pub mod ast;
pub mod code_path;
pub mod context;
pub mod docs;
pub(crate) mod estree;
pub mod fix;
pub mod formats;
pub mod glob;
pub mod ignore;
pub mod js_plugin;
pub mod json;
pub mod language;
pub mod languages;
pub mod linter;
pub mod literal;
pub mod modules;
pub mod options;
pub mod oxlint_help;
pub(crate) mod oxlint_messages;
pub(crate) mod oxlint_order;
pub mod paths;
pub mod regex;
pub mod rule;
pub mod rule_set;
pub mod runner;
pub mod selector;
pub mod semantic;
pub mod source;
pub mod span;
pub mod tokens;
pub mod types;
pub mod utils;

/// The imports a rule needs.
pub mod prelude {
    pub use crate::ast::*;
    pub use crate::code_path::{CodePath, CurrentSegments, Segment, Traversal};
    pub use crate::context::{Cx, Details, IntoText, Report};
    pub use crate::fix::{Fix, Fixer};
    pub use crate::language::{Global, LanguageOptions, SourceType};
    pub use crate::literal::Literal;
    pub use crate::no_state;
    pub use crate::options::{Json, Object, Options};
    pub use crate::regex::Regex;
    pub use crate::rule::{Fixable, Kind, Message, Meta, NodeTags, On, Presets, Rule};
    pub use crate::semantic::{
        Declaration, DeclarationKind, Reference, ReferenceFlags, Scope, ScopeKind, Symbol,
        Variable, VariableKind,
    };
    pub use crate::span::{Position, Span, Spanned};
    pub use crate::tokens::{Token, TokenKind, Tokens, skip_trivia, skip_trivia_back};
    pub use crate::utils::{self, ast_utils, eslint_utils, text, ts_utils};
}
