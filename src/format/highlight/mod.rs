//! Syntax highlighting: `Bun.highlight`.
//!
//! ```text
//! code ─ <language>/highlight.rs ─→ Spans ─ finish ─→ [Span] ─ html.rs, ansi.rs ─→ text
//! ```
//!
//! Each language has a `highlight.rs` next to the parser that the formatter uses, and reads the same tokens and the
//! same tree. See "Highlighting" in `CLAUDE.md`.

mod ansi;
mod html;
mod spans;
mod theme;
mod token;

pub use ansi::write_ansi;
pub use html::{write_css, write_html};
pub use spans::{Span, Spans};
pub use theme::{Color, Font, PartialStyle, Style, Theme};
pub use token::Token;

use crate::text::BOM;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Language {
    JavaScript,
    Jsx,
    TypeScript,
    Tsx,
    /// Also JSON5 and JSON with comments.
    Json,
    Css,
    Scss,
    Less,
    Html,
    Vue,
    Svelte,
    Angular,
    Handlebars,
    Markdown,
    Mdx,
    Yaml,
    Toml,
    GraphQl,
}

impl Language {
    /// The language with this name, which is also what a code block in Markdown says, or that files with this
    /// extension are in. Case doesn't matter.
    pub fn from_name(name: &[u8]) -> Option<Language> {
        let mut buffer = [0; 16];
        let lower = buffer.get_mut(..name.len())?;
        lower.copy_from_slice(name);
        lower.make_ascii_lowercase();
        Some(match &*lower {
            b"javascript" | b"js" | b"mjs" | b"cjs" | b"node" => Language::JavaScript,
            b"jsx" | b"javascriptreact" => Language::Jsx,
            b"typescript" | b"ts" | b"mts" | b"cts" => Language::TypeScript,
            b"tsx" | b"typescriptreact" => Language::Tsx,
            b"json" | b"jsonc" | b"json5" | b"jsonl" | b"webmanifest" => Language::Json,
            b"css" | b"postcss" | b"pcss" => Language::Css,
            b"scss" => Language::Scss,
            b"less" => Language::Less,
            b"html" | b"htm" | b"xhtml" => Language::Html,
            b"vue" => Language::Vue,
            b"svelte" => Language::Svelte,
            b"angular" | b"angular-html" => Language::Angular,
            b"handlebars" | b"hbs" | b"glimmer" => Language::Handlebars,
            b"markdown" | b"md" => Language::Markdown,
            b"mdx" => Language::Mdx,
            b"yaml" | b"yml" => Language::Yaml,
            b"toml" => Language::Toml,
            b"graphql" | b"gql" | b"graphqls" => Language::GraphQl,
            _ => return None,
        })
    }
}

/// What is allocated to highlight one text, and used again for the next.
#[derive(Default)]
pub struct Scratch {
    spans: Spans,
}

/// The tokens of `code`, sorted, none overlapping another. What is between them is plain text.
///
/// It never fails. Code with syntax errors gets what the parser could make of it.
pub fn highlight<'s>(code: &[u8], language: Language, scratch: &'s mut Scratch) -> &'s [Span] {
    let spans = &mut scratch.spans;
    let Ok(len) = u32::try_from(code.len()) else {
        spans.reset(0);
        return spans.finish();
    };
    spans.reset(len);
    match code.strip_prefix(BOM) {
        Some(rest) => spans.embed(language, rest, BOM.len() as u32),
        None => spans.embed(language, code, 0),
    }
    spans.finish()
}

impl Spans {
    /// Highlights `code`, which is in `language` and starts at `at` in the code that is being highlighted.
    ///
    /// `code` can be a copy in which something is blanked out, as long as every byte stays where it is.
    pub(crate) fn embed(&mut self, language: Language, code: &[u8], at: u32) {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return;
        }
        let outer = (self.base, self.limit);
        self.base = outer.0.saturating_add(at);
        self.limit = (self.base.saturating_add(code.len().min(u32::MAX as usize) as u32)).min(outer.1);
        match language {
            Language::JavaScript | Language::Jsx | Language::TypeScript | Language::Tsx | Language::Json => {
                crate::js::highlight::highlight(code, language, self);
            }
            Language::Css | Language::Scss | Language::Less => {
                crate::css::highlight::highlight(code, language, self);
            }
            Language::Html | Language::Vue | Language::Angular => {
                crate::html::highlight::highlight(code, language, self);
            }
            Language::Svelte => crate::svelte::highlight::highlight(code, self),
            Language::Handlebars => crate::handlebars::highlight::highlight(code, self),
            Language::Markdown | Language::Mdx => {
                crate::markdown::highlight::highlight(code, language, self);
            }
            Language::Yaml => crate::yaml::highlight::highlight(code, self),
            Language::Toml => crate::toml::highlight::highlight(code, self),
            Language::GraphQl => crate::graphql::highlight::highlight(code, self),
        }
        (self.base, self.limit) = outer;
    }

    /// [`Spans::embed`] for one TypeScript expression, like the value of `v-if` in Vue. As a program, `{ a: b }` would
    /// be a block.
    pub(crate) fn embed_expression(&mut self, code: &[u8], at: u32) {
        let outer = (self.base, self.limit);
        self.base = outer.0.saturating_add(at);
        self.limit = (self.base.saturating_add(code.len().min(u32::MAX as usize) as u32)).min(outer.1);
        crate::js::highlight::highlight_expression(code, self);
        (self.base, self.limit) = outer;
    }
}
