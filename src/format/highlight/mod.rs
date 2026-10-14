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
use bun_core::output::{ColorDepth, Source};

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
            b"javascript" | b"js" | b"mjs" | b"cjs" => Language::JavaScript,
            b"jsx" => Language::Jsx,
            b"typescript" | b"ts" | b"mts" | b"cts" => Language::TypeScript,
            b"tsx" => Language::Tsx,
            b"json" | b"jsonc" | b"json5" => Language::Json,
            b"css" => Language::Css,
            b"scss" => Language::Scss,
            b"less" => Language::Less,
            b"html" | b"htm" => Language::Html,
            b"vue" => Language::Vue,
            b"svelte" => Language::Svelte,
            b"angular" => Language::Angular,
            b"handlebars" | b"hbs" => Language::Handlebars,
            b"markdown" | b"md" => Language::Markdown,
            b"mdx" => Language::Mdx,
            b"yaml" | b"yml" => Language::Yaml,
            b"toml" => Language::Toml,
            b"graphql" | b"gql" => Language::GraphQl,
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

/// `bun_md::AnsiTheme::highlight`: highlights the code blocks of a Markdown document that is printed to a terminal.
pub fn for_markdown(is_light: bool) -> impl Fn(&[u8], &[u8], &mut Vec<u8>) -> bool {
    move |code, language, out| {
        let Some(language) = Language::from_name(language) else {
            return false;
        };
        // The caller has decided that there are colors.
        let depth = match Source::color_depth() {
            ColorDepth::None => ColorDepth::C16,
            depth => depth,
        };
        let mut scratch = Scratch::default();
        let spans = highlight(code, language, &mut scratch);
        write_ansi(code, spans, Theme::built_in(is_light, depth), depth, out);
        true
    }
}

impl Spans {
    /// Highlights `code`, which is in `language` and starts at `at` in the code that is being highlighted.
    ///
    /// `code` can be a copy in which something is blanked out, as long as every byte stays where it is.
    pub(crate) fn embed(&mut self, language: Language, code: &[u8], at: u32) {
        self.within(language, code, at, |spans| match language {
            Language::JavaScript
            | Language::Jsx
            | Language::TypeScript
            | Language::Tsx
            | Language::Json => crate::js::highlight::highlight(code, language, spans),
            Language::Css | Language::Scss | Language::Less => {
                crate::css::highlight::highlight(code, language, spans);
            }
            Language::Html | Language::Vue | Language::Angular => {
                crate::html::highlight::highlight(code, language, spans);
            }
            Language::Svelte => crate::svelte::highlight::highlight(code, spans),
            Language::Handlebars => crate::handlebars::highlight::highlight(code, spans),
            Language::Markdown | Language::Mdx => {
                crate::markdown::highlight::highlight(code, language, spans);
            }
            Language::Yaml => crate::yaml::highlight::highlight(code, spans),
            Language::Toml => crate::toml::highlight::highlight(code, spans),
            Language::GraphQl => crate::graphql::highlight::highlight(code, spans),
        });
    }

    /// [`Spans::embed`] for one TypeScript expression, like the value of `v-if` in Vue. As a program, `{ a: b }` would
    /// be a block.
    pub(crate) fn embed_expression(&mut self, code: &[u8], at: u32) {
        self.within(Language::TypeScript, code, at, |spans| {
            crate::js::highlight::highlight_expression(code, spans);
        });
    }

    /// [`Spans::embed`] for the value of a `style` attribute.
    pub(crate) fn embed_declarations(&mut self, code: &[u8], at: u32) {
        self.within(Language::Css, code, at, |spans| {
            crate::css::highlight::highlight_declarations(code, spans);
        });
    }

    /// The tokens of `code`, which is made of pieces of the code that is being highlighted. Their offsets are relative to
    /// `code`. `is_unclosed`: the last piece runs to the end of the code that is being highlighted.
    pub(crate) fn tokens_of(&self, language: Language, code: &[u8], is_unclosed: bool) -> Vec<Span> {
        let mut apart = Spans::default();
        apart.reset(code.len().min(u32::MAX as usize) as u32);
        if is_unclosed {
            apart.ending_at_limit = self.ending_at_limit;
        }
        apart.embed(language, code, 0);
        apart.finish().to_vec()
    }

    /// Runs `highlight`, whose offsets are relative to `code`, which is in `language` and starts at `at`.
    fn within(
        &mut self,
        language: Language,
        code: &[u8],
        at: u32,
        highlight: impl FnOnce(&mut Spans),
    ) {
        let outer = (self.base, self.limit, self.ending_at_limit);
        let len = code.len().min(u32::MAX as usize) as u32;
        let base = outer.0.saturating_add(at);
        let limit = base.saturating_add(len).min(outer.1);
        // What isn't closed runs to the end of the code around it: `<script>` without `</script>`, a template without its
        // second backtick. If it could hold its own language again, `` <script>html` `` over and over would be read once for
        // each repetition. So there it stays plain.
        let around = if limit == outer.1 { outer.2 } else { 0 };
        let bit = 1 << language as u32;
        if around & bit != 0 || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return;
        }
        (self.base, self.limit, self.ending_at_limit) = (base, limit, around | bit);
        highlight(self);
        (self.base, self.limit, self.ending_at_limit) = outer;
    }
}
