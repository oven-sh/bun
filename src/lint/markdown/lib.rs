//! The `markdown/commonmark` and `markdown/gfm` languages and the rules of `@eslint/markdown` 8.0.3. Each rule is a
//! port of the upstream rule with the same name, and has the same options, messages and report locations.
//! - https://github.com/eslint/markdown (Copyright OpenJS Foundation and other contributors, MIT License)
//!
//! The plugin parses with micromark. Bun parses with its own parser, `bun_md`, and `bun_format::markdown` builds the
//! tree from its output. It's the same tree that `bun fmt` prints. See `document.rs`. Where micromark deviates from the
//! CommonMark and GFM specs, the tree follows the specs.

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]

mod document;
pub mod for_tests;
mod listen;
mod slugger;
mod util;

pub use document::Document;
use document::Mdast;

use bun_lint::languages::{Configured, LineBreaks, Parsed, Rejection, SyntaxError};
use bun_lint::options::Json;
use bun_lint::rule::{Kind, Meta, Plugin};

pub(crate) mod prelude {
    pub(crate) use crate::document::{
        Document, Index, Indices, Loc, Node, OutOfRange, index_of, last_index_of, length,
    };
    pub(crate) use crate::listen::{Context, Kinds, Listener, Listens, Within};
    pub(crate) use crate::{listens, meta, meta_for_gfm, util};
    pub(crate) use bun_core::strings;
    pub(crate) use bun_format::markdown::ast::Kind;
    pub(crate) use bun_lint::ast::File;
    pub(crate) use bun_lint::context::Cx;
    pub(crate) use bun_lint::options::Options;
    pub(crate) use bun_lint::regex::Regex;
    pub(crate) use bun_lint::rule::{Fixable, Message, Meta, On, Rule};
    pub(crate) use bun_lint::span::Span;
    pub(crate) use bun_lint::utils::text::to_lower_case;
    pub(crate) use rustc_hash::{FxHashMap, FxHashSet};
    pub(crate) use std::borrow::Cow;
    pub(crate) use std::sync::LazyLock;
}

bun_lint::rules! {
    fenced_code_language::FencedCodeLanguage,
    fenced_code_meta::FencedCodeMeta,
    heading_increment::HeadingIncrement,
    no_bare_urls::NoBareUrls,
    no_duplicate_definitions::NoDuplicateDefinitions,
    no_duplicate_headings::NoDuplicateHeadings,
    no_empty_definitions::NoEmptyDefinitions,
    no_empty_images::NoEmptyImages,
    no_empty_links::NoEmptyLinks,
    no_html::NoHtml,
    no_invalid_label_refs::NoInvalidLabelRefs,
    no_missing_atx_heading_space::NoMissingAtxHeadingSpace,
    no_missing_label_refs::NoMissingLabelRefs,
    no_missing_link_fragments::NoMissingLinkFragments,
    no_multiple_h1::NoMultipleH1,
    no_reference_like_urls::NoReferenceLikeUrls,
    no_reversed_media_syntax::NoReversedMediaSyntax,
    no_space_in_emphasis::NoSpaceInEmphasis,
    no_unused_definitions::NoUnusedDefinitions,
    require_alt_text::RequireAltText,
    table_column_count::TableColumnCount,
}

/// The `meta` of the rule `name`. Every rule has the type `problem`. Upstream's `meta` has no `languages`.
pub(crate) const fn meta(name: &'static str) -> Meta {
    Meta::plugin(Plugin::Markdown, name, Kind::Problem)
        .languages(&["markdown/commonmark", "markdown/gfm"])
        .on_in_any_language()
}

/// Like [`meta`], for a rule about GFM-only syntax. The docs show the first language in the list.
pub(crate) const fn meta_for_gfm(name: &'static str) -> Meta {
    meta(name).languages(&["markdown/gfm", "markdown/commonmark"])
}

/// `languageOptions.frontmatter`
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub(crate) enum FrontMatter {
    /// `false`
    #[default]
    None,
    Yaml,
    Toml,
    Json,
}

/// One of the plugin's languages, with its options.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub(crate) struct Dialect {
    /// True for `markdown/gfm`, false for `markdown/commonmark`.
    pub(crate) is_gfm: bool,
    pub(crate) front_matter: FrontMatter,
    pub(crate) math: bool,
}

/// `` `${value}` ``
fn push_as_js_string(value: &Json, out: &mut Vec<u8>) {
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Bool(it) => out.extend_from_slice(if *it { b"true" } else { b"false" }),
        Json::Number(it) => out.extend_from_slice(&bun_lint::utils::text::number_to_string(*it)),
        Json::String(it) => out.extend_from_slice(it),
        Json::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                if !matches!(item, Json::Null) {
                    push_as_js_string(item, out);
                }
            }
        }
        Json::Object(_) => out.extend_from_slice(b"[object Object]"),
    }
}

impl Dialect {
    /// `name` is the part of `language` after the `/`. `Err` has the message that `validateLanguageOptions` throws.
    pub(crate) fn new(name: &[u8], options: &Json) -> Result<Dialect, Vec<u8>> {
        let mut dialect = Dialect {
            is_gfm: name == b"gfm",
            ..Dialect::default()
        };
        let invalid = |value: &Json, rest: &str| {
            let mut message = b"Invalid language option value `".to_vec();
            push_as_js_string(value, &mut message);
            message.extend_from_slice(rest.as_bytes());
            message
        };
        if let Some(value) = options.get(b"frontmatter") {
            dialect.front_matter = match (value.as_bool(), value.as_str()) {
                (Some(false), _) => FrontMatter::None,
                (_, Some(b"yaml")) => FrontMatter::Yaml,
                (_, Some(b"toml")) => FrontMatter::Toml,
                (_, Some(b"json")) => FrontMatter::Json,
                _ => {
                    return Err(invalid(
                        value,
                        "` for frontmatter. Expected one of `false`, `\"yaml\"`, `\"toml\"`, or `\"json\"`.",
                    ));
                }
            };
        }
        if let Some(value) = options.get(b"math") {
            dialect.math = value
                .as_bool()
                .ok_or_else(|| invalid(value, "` for math. Expected a boolean."))?;
        }
        Ok(dialect)
    }
}

pub struct Markdown;

impl bun_lint::languages::Language for Markdown {
    fn plugin(&self) -> Plugin {
        Plugin::Markdown
    }

    fn names(&self) -> &'static [&'static str] {
        &["commonmark", "gfm"]
    }

    fn line_breaks(&self) -> LineBreaks {
        LineBreaks::Newlines
    }

    fn configure(&self, name: &[u8], options: &Json) -> Result<Configured, Rejection> {
        match Dialect::new(name, options) {
            Ok(dialect) => Ok(std::sync::Arc::new(dialect)),
            Err(message) => Err(Rejection::Invalid(message)),
        }
    }

    fn parse(&self, text: &[u8], configured: &Configured) -> Result<Parsed, Vec<SyntaxError>> {
        let dialect = configured.downcast_ref::<Dialect>().copied();
        // Any text is valid Markdown, so the parser's size and depth limits are the only way to fail.
        let Some(mdast) = Mdast::parse(text, dialect.unwrap_or_default()) else {
            return Err(vec![SyntaxError {
                message: b"The file is too large or nested too deeply.".to_vec(),
                line: 1,
                column: 1,
            }]);
        };
        let (comments, joined) = Document::new(&mdast, text).comments();
        Ok(Parsed {
            tree: Box::new(mdast),
            comments,
            joined,
        })
    }
}
