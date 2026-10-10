//! What the code that formats a file can see besides the node it is formatting.

use super::comments::{Comment, Comments};
use super::source_text::SourceText;
use super::utils::tailwindcss::TailwindContext;
use crate::cursor::CursorRegion;
use crate::ir::element::FormatElement;
use crate::options::{FormatOptions, HtmlRoot, JavaScriptParser};
use bun_lint::ast::{Expr, File};
use bun_lint::span::{Span, Spanned};
use rustc_hash::FxHashMap;
use std::cell::Cell;

pub(crate) struct JsFormatContext<'a> {
    /// `None` for a document that is not written for JavaScript.
    file: Option<&'a File<'a>>,
    /// See [`JsFormatContext::has_tree_of_babel`].
    has_tree_of_babel: bool,
    options: FormatOptions,
    comments: Comments<'a>,
    /// What has been formatted ahead of its turn, by the span of the node: an argument that was
    /// formatted to decide on the layout of the call. A node whose span is here is not formatted
    /// again, which would print its comments twice.
    cached_elements: FxHashMap<Span, FormatElement>,
    /// With `quoteProps: "consistent"`, whether the properties of the enclosing objects are
    /// quoted.
    quote_needed_stack: Vec<bool>,
    /// See `utils/tailwindcss.rs`. The last is the one that counts.
    tailwind_contexts: Vec<TailwindContext>,
    /// See `Formatter::is_quiet`.
    pub(crate) is_quiet: bool,
    pub(crate) cursor: CursorRegion,
    stack_check: bun_core::StackCheck,
    /// Something has not been written because it is nested too deeply.
    pub(crate) ran_out_of_stack: bool,
    /// The last member access with many member accesses around it, and whether it stays on the line
    /// of its object. The one around it has the same answer.
    pub(crate) long_member_chain: Cell<Option<(Expr<'a>, bool)>>,
    /// Whether the `a | b` that is being written is a value and a filter of Vue.
    pub(crate) is_vue_filter_sequence: Cell<bool>,
    /// What parses the code in HTML, in the place of `FormatOptions::parse_javascript`.
    pub(crate) parse_javascript: Option<JavaScriptParser<'a>>,
}

impl<'a> JsFormatContext<'a> {
    pub(crate) fn new(file: &'a File<'a>, options: FormatOptions, comments: &'a [Comment]) -> Self {
        Self {
            file: Some(file),
            has_tree_of_babel: file.is_javascript()
                || options.in_html.has_tree_of_babel
                || !matches!(options.in_html.root, HtmlRoot::None | HtmlRoot::Program),
            ..Self::without_file(file.text(), options, comments)
        }
    }

    /// For a document that is written for `source`, which is in another language. Nothing that
    /// writes it asks for the [file](JsFormatContext::file).
    pub(crate) fn without_file(
        source: &'a [u8],
        options: FormatOptions,
        comments: &'a [Comment],
    ) -> Self {
        Self {
            file: None,
            has_tree_of_babel: false,
            options,
            comments: Comments::new(SourceText::new(source), comments),
            cached_elements: FxHashMap::default(),
            quote_needed_stack: Vec::new(),
            tailwind_contexts: Vec::new(),
            is_quiet: false,
            cursor: CursorRegion::NONE,
            stack_check: bun_core::StackCheck::init(),
            ran_out_of_stack: false,
            long_member_chain: Cell::new(None),
            is_vue_filter_sequence: Cell::new(false),
            parse_javascript: None,
        }
    }

    #[inline]
    pub(crate) fn file(&self) -> &'a File<'a> {
        self.file
            .expect("only what writes JavaScript asks for the file, and there is one then")
    }

    /// Whether Prettier reads the code with a parser that has no `ChainExpression` around an optional chain: Babel, which
    /// reads JavaScript and every expression in HTML, in TypeScript too, or `angular-estree-parser`.
    #[inline]
    pub(crate) fn has_tree_of_babel(&self) -> bool {
        self.has_tree_of_babel
    }

    /// Whether there is stack left to write one more expression, statement or type in what is being
    /// written. If not, that is noted, and the document is of no use.
    #[inline]
    pub(crate) fn has_stack_left(&mut self) -> bool {
        let has_stack_left = self.stack_check.is_safe_to_recurse();
        if !has_stack_left {
            self.ran_out_of_stack = true;
        }
        has_stack_left
    }

    #[inline]
    pub(crate) fn options(&self) -> &FormatOptions {
        &self.options
    }

    #[inline]
    pub(crate) fn comments(&self) -> &Comments<'a> {
        &self.comments
    }

    #[inline]
    pub(crate) fn comments_mut(&mut self) -> &mut Comments<'a> {
        &mut self.comments
    }

    #[inline]
    pub(crate) fn has_cached_elements(&self) -> bool {
        !self.cached_elements.is_empty()
    }

    pub(crate) fn get_cached_element(&self, key: &impl Spanned) -> Option<FormatElement> {
        self.cached_elements.get(&key.span()).copied()
    }

    pub(crate) fn cache_element(&mut self, key: &impl Spanned, formatted: FormatElement) {
        self.cached_elements.insert(key.span(), formatted);
    }

    pub(crate) fn push_quote_needed(&mut self, needed: bool) {
        self.quote_needed_stack.push(needed);
    }

    pub(crate) fn pop_quote_needed(&mut self) {
        self.quote_needed_stack.pop();
    }

    pub(crate) fn is_quote_needed(&self) -> bool {
        self.quote_needed_stack.last().copied().unwrap_or(false)
    }

    pub(crate) fn push_tailwind_context(&mut self, context: TailwindContext) {
        self.tailwind_contexts.push(context);
    }

    pub(crate) fn pop_tailwind_context(&mut self) {
        self.tailwind_contexts.pop();
    }

    #[inline]
    pub(crate) fn tailwind_context(&self) -> Option<TailwindContext> {
        self.tailwind_contexts.last().copied()
    }

    /// Says whether what is written is in a call of a function that does not take classes. Returns what was said before,
    /// if there is a context.
    #[inline]
    pub(crate) fn disable_tailwind_context(&mut self, is_disabled: bool) -> Option<bool> {
        let context = self.tailwind_contexts.last_mut()?;
        Some(std::mem::replace(&mut context.is_disabled, is_disabled))
    }
}
