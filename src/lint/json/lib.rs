//! The `json/json`, `json/jsonc` and `json/json5` languages and the rules of `@eslint/json` 2.1.1. Each rule is a port
//! of the upstream rule with the same name, and has the same options, messages and report locations.
//! - https://github.com/eslint/json (Copyright Nicholas C. Zakas, Apache License 2.0)
//!
//! The tokens come from Bun's JSON5 parser ([`bun_parsers::json5::SourceTokens`]), which reads all three languages, and
//! `parse.rs` builds the tree from them. A file is rejected if its language's spec rejects it. The error messages are
//! Bun's own.

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]

mod parse;
mod tree;

use bun_lint::languages::{Configured, Language, LineBreaks, Parsed, Rejection, SyntaxError};
use bun_lint::options::Json as Value;
use bun_lint::rule::Plugin;
pub use tree::{Document, Member, Node, NodeKind, Tree};

bun_lint::rules! {
    no_duplicate_keys::NoDuplicateKeys,
    no_empty_keys::NoEmptyKeys,
    no_unnormalized_keys::NoUnnormalizedKeys,
    no_unsafe_values::NoUnsafeValues,
    sort_keys::SortKeys,
    top_level_interop::TopLevelInterop,
}

/// Every rule's `meta.languages`.
pub(crate) const LANGUAGES: &[&str] = &["json/json", "json/jsonc", "json/json5"];

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Mode {
    Json,
    Jsonc,
    Json5,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Options {
    pub(crate) mode: Mode,
    pub(crate) allows_trailing_commas: bool,
}

pub struct Json;

impl Language for Json {
    fn plugin(&self) -> Plugin {
        Plugin::Json
    }

    fn names(&self) -> &'static [&'static str] {
        &["json", "jsonc", "json5"]
    }

    fn line_breaks(&self) -> LineBreaks {
        LineBreaks::Newlines
    }

    fn configure(&self, name: &[u8], options: &Value) -> Result<Configured, Rejection> {
        let mode = match name {
            b"jsonc" => Mode::Jsonc,
            b"json5" => Mode::Json5,
            _ => Mode::Json,
        };
        let invalid = |message: &str| Err(Rejection::Invalid(message.into()));
        let allows_trailing_commas = match options.get(b"allowTrailingCommas") {
            None => false,
            Some(Value::Bool(_)) if mode != Mode::Jsonc => {
                return invalid("allowTrailingCommas option is only available in JSONC.");
            }
            Some(Value::Bool(allows)) => *allows,
            Some(_) => return invalid("allowTrailingCommas must be a boolean if provided."),
        };
        Ok(std::sync::Arc::new(Options {
            mode,
            allows_trailing_commas: allows_trailing_commas || mode == Mode::Json5,
        }))
    }

    fn parse(&self, text: &[u8], configured: &Configured) -> Result<Parsed, Vec<SyntaxError>> {
        let options = configured.downcast_ref::<Options>();
        let options = options.copied().unwrap_or(Options {
            mode: Mode::Json,
            allows_trailing_commas: false,
        });
        let (tree, comments) = parse::parse(text, options).map_err(|it| vec![it])?;
        Ok(Parsed {
            tree: Box::new(tree),
            comments,
            joined: Vec::new(),
        })
    }
}
