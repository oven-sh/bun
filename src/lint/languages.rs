//! Languages other than JavaScript: those of ESLint's own plugins, like `json/jsonc`, `markdown/gfm` and `css/css`.
//!
//! A configuration of ESLint gives a file a `language`. If a [`Language`] here answers for it, the file is parsed and linted
//! here. Otherwise it goes to the `eslint` package: see [`Route`](crate::js_plugin::Route).
//!
//! A language says three things: how a text is parsed, where the comments are that can configure the linter, and where a
//! line ends. Its rules are [`Rule`](crate::rule::Rule)s like all others, with [`Meta::languages`](crate::rule::Meta::languages).
//! The [`File`] that they are given has no JavaScript in it: no statements, no tokens, no scopes. It has the text, with
//! everything that is made of a text (positions, reports, fixes), and [`File::tree`].
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
//!         // Walks `cx.state`, and reports spans.
//!     }
//! }
//! ```
//!
//! ESLint leaves what starts at one place in the order of its walk. [`Report::listened_on`](crate::context::Report::listened_on)
//! and [`Report::on_exit`](crate::context::Report::on_exit) say which node the original listens on.

use crate::ast::File;
use crate::options::Json;
use crate::rule::Plugin;
pub use crate::source::LineBreaks;
use crate::span::Span;
use std::any::Any;
use std::sync::Arc;

pub trait Language: Sync {
    /// The plugin whose `languages` has it. The rules here have to answer for the plugin, or the language does not either.
    fn plugin(&self) -> Plugin;

    /// What `language` can have after the `/`: `json`, `jsonc`, `json5`.
    fn names(&self) -> &'static [&'static str];

    fn line_breaks(&self) -> LineBreaks;

    /// ESLint's `validateLanguageOptions`, once for each configuration. `name`: one of [`Language::names`]. `options`:
    /// `languageOptions`. Returns what [`Language::parse`] is given.
    fn configure(&self, name: &[u8], options: &Json) -> Result<Configured, Refusal>;

    /// `text`: without a byte order mark, which no span counts. `Err`: no rule runs.
    fn parse(&self, text: &[u8], configured: &Configured) -> Result<Parsed, Vec<SyntaxError>>;
}

/// What a language makes of its name and `languageOptions`.
pub type Configured = Arc<dyn Any + Send + Sync>;

/// Why a language does not take `languageOptions`.
pub enum Refusal {
    /// What `validateLanguageOptions` throws: the message. It ends the run.
    Invalid(Vec<u8>),
    /// They ask for what only the package can do. Its files go to `eslint`.
    OnlyThePackage,
}

pub struct Parsed {
    /// [`File::tree`]. It has places in the text, not parts of it.
    pub tree: Box<dyn Any + Send + Sync>,
    /// In the order of the text. Those that do not start with `eslint` are passed over.
    pub comments: Vec<Comment>,
}

#[derive(Copy, Clone, Debug)]
pub struct Comment {
    /// With its delimiters.
    pub span: Span,
    /// Without them.
    pub value: Span,
}

pub struct SyntaxError {
    /// Without `Parsing error: `.
    pub message: Vec<u8>,
    /// From 1, as the parser of the package says it: see [`LineBreaks::position`].
    pub line: u32,
    /// From 1.
    pub column: u32,
}

/// The language of a file, as it is configured.
#[derive(Clone)]
pub struct Dialect {
    pub language: &'static dyn Language,
    pub configured: Configured,
}

impl<'a> File<'a> {
    /// What [`Language::parse`] has returned as the tree, if the file is in the language that has trees of this type.
    pub fn tree<T: 'static>(&self) -> Option<&'a T> {
        self.parsed()?.tree.downcast_ref()
    }
}
