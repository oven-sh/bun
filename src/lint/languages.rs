//! Languages other than JavaScript, such as `json/jsonc`, `markdown/gfm` and `css/css` from ESLint's own plugins.
//!
//! An ESLint config can set a file's `language`. If a [`Language`] implements it, Bun parses and lints the file itself.
//! Otherwise the file is handed to the `eslint` package: see [`Route`](crate::js_plugin::Route).
//!
//! A language defines three things: how to parse the text, which comments can configure the linter, and what counts as
//! a line break. Its rules are ordinary [`Rule`](crate::rule::Rule)s that set
//! [`Meta::languages`](crate::rule::Meta::languages). The [`File`] they get has no JavaScript in it: no statements,
//! tokens or scopes. It has the text, everything that only needs the text (positions, reports, fixes), and
//! [`File::tree`].
//!
//! ```ignore
//! impl Rule for NoEmptyKeys {
//!     const META: Meta = Meta::plugin(Plugin::Json, "no-empty-keys", Kind::Problem).languages(&["json/json"]);
//!     const ON: On = On::new().finish();
//!     type State<'a> = &'a Tree;
//!
//!     fn start<'a>(&self, file: &'a File<'a>) -> Option<&'a Tree> {
//!         file.tree()
//!     }
//!
//!     fn finish(&self, cx: &mut Cx<'_, Self>) {
//!         // Walk `cx.state` and report spans.
//!     }
//! }
//! ```
//!
//! ESLint keeps reports that start at the same position in traversal order.
//! [`Report::listened_on`](crate::context::Report::listened_on) and
//! [`Report::on_exit`](crate::context::Report::on_exit) record which node the upstream rule listens on.

use crate::ast::File;
use crate::options::Json;
use crate::rule::Plugin;
pub use crate::source::LineBreaks;
use crate::span::Span;
use std::any::Any;
use std::sync::Arc;

pub trait Language: Sync {
    /// The plugin that exports this language in its `languages`. The language is only used for a config where Bun's
    /// built-in rules replace that plugin.
    fn plugin(&self) -> Plugin;

    /// The names that can follow the `/` in `language`: `json`, `jsonc`, `json5`.
    fn names(&self) -> &'static [&'static str];

    fn line_breaks(&self) -> LineBreaks;

    /// ESLint's `validateLanguageOptions`, called once per config. `name` is one of [`Language::names`] and `options`
    /// is `languageOptions`. The result is passed to [`Language::parse`].
    fn configure(&self, name: &[u8], options: &Json) -> Result<Configured, Rejection>;

    /// `text` has no byte order mark, and spans are offsets into it. If this returns `Err`, no rule runs.
    fn parse(&self, text: &[u8], configured: &Configured) -> Result<Parsed, Vec<SyntaxError>>;
}

/// A language's name and `languageOptions` after [`Language::configure`] has parsed them.
pub type Configured = Arc<dyn Any + Send + Sync>;

/// Why a language rejected its `languageOptions`.
pub enum Rejection {
    /// The message of the error that `validateLanguageOptions` throws. It ends the run.
    Invalid(Vec<u8>),
    /// The options need something that only the package supports, so these files are handed to `eslint`.
    NeedsPackage,
}

pub struct Parsed {
    /// Returned by [`File::tree`]. It stores offsets into the text, not slices of it.
    pub tree: Box<dyn Any + Send + Sync>,
    /// In source order. Comments that don't start with `eslint` are ignored.
    pub comments: Vec<Comment>,
    /// The comments whose text isn't one piece of the source.
    pub joined: Vec<JoinedComment>,
}

#[derive(Copy, Clone, Debug)]
pub struct Comment {
    /// Includes the delimiters.
    pub span: Span,
    /// Excludes the delimiters.
    pub value: Span,
}

/// The text of a comment that isn't contiguous in the source. In Markdown, every further line of a comment in a block
/// quote starts with `> `, which isn't part of the comment.
pub struct JoinedComment {
    /// [`Comment::value`]
    value: Span,
    /// The parts of `value` that don't belong to the comment, in source order.
    gaps: Vec<Span>,
    /// `value` without `gaps`.
    text: Vec<u8>,
}

impl JoinedComment {
    /// `text` is the file's text.
    pub fn new(text: &[u8], value: Span, gaps: Vec<Span>) -> JoinedComment {
        let mut joined = Vec::with_capacity(value.len() as usize);
        let mut from = value.start;
        for &gap in &gaps {
            joined.extend_from_slice(
                text.get(Span::before(from, gap).range())
                    .unwrap_or_default(),
            );
            from = gap.end;
        }
        joined.extend_from_slice(
            text.get(Span::new(from, value.end).range())
                .unwrap_or_default(),
        );
        JoinedComment {
            value,
            gaps,
            text: joined,
        }
    }

    pub(crate) fn value(&self) -> Span {
        self.value
    }

    pub fn gaps(&self) -> &[Span] {
        &self.gaps
    }

    pub fn text(&self) -> &[u8] {
        &self.text
    }

    /// Converts `offset`, a source offset that isn't in a gap, to an index into [`JoinedComment::text`].
    pub(crate) fn index_of(&self, offset: u32) -> usize {
        let before = self.gaps.iter().take_while(|gap| gap.end <= offset);
        let skipped: u32 = before.map(|gap| gap.len()).sum();
        offset.saturating_sub(self.value.start + skipped) as usize
    }

    /// Maps `part`, a range of [`JoinedComment::text`], back to the source. An endpoint that falls on a gap maps to the
    /// gap's end.
    pub fn span_of(&self, part: std::ops::Range<usize>) -> Span {
        let offset_of = |index: usize| {
            let start = self.value.start + index as u32;
            self.gaps
                .iter()
                .fold(start, |offset, gap| match gap.start <= offset {
                    true => offset + gap.len(),
                    false => offset,
                })
        };
        Span::new(offset_of(part.start), offset_of(part.end))
    }
}

pub struct SyntaxError {
    /// Doesn't include the `Parsing error: ` prefix.
    pub message: Vec<u8>,
    /// 1-based, counted the way the package's parser counts lines: see [`LineBreaks::position`].
    pub line: u32,
    /// 1-based.
    pub column: u32,
}

/// A file's language, with its parsed options.
#[derive(Clone)]
pub struct Dialect {
    pub language: &'static dyn Language,
    pub configured: Configured,
}

impl<'a> File<'a> {
    /// The tree that [`Language::parse`] returned, or `None` if the file's language doesn't use `T` as its tree type.
    pub fn tree<T: 'static>(&self) -> Option<&'a T> {
        self.parsed()?.tree.downcast_ref()
    }
}
