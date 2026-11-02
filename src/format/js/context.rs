//! The state that formatting code can access besides the node it's formatting.

use super::comments::{Comments, FileComments};
use super::utils::tailwindcss::TailwindContext;
use crate::cursor::CursorRegion;
use crate::ir::element::FormatElement;
use crate::options::{FormatOptions, HtmlRoot, JavaScriptParser};
use bun_lint::ast::{Expr, File};
use bun_lint::span::{Span, Spanned};
use rustc_hash::FxHashMap;
use std::cell::Cell;

/// True if Prettier parses the code with a parser that has no `ChainExpression` around an optional chain. That's Babel,
/// which parses JavaScript and every expression in HTML (even TypeScript ones), or `angular-estree-parser`. Prettier's
/// `flow` parser produces ESTree's tree, with the `ChainExpression`.
pub(crate) fn has_babel_tree(file: &File<'_>, options: &FormatOptions) -> bool {
    let is_read_by_flow_parser =
        file.is_flow() && !super::print::flow::is_parsed_by_babel_flow(options, file.path());
    (file.is_javascript() && !is_read_by_flow_parser)
        || options.in_html.has_babel_tree
        || !matches!(options.in_html.root, HtmlRoot::None | HtmlRoot::Program)
}

pub(crate) struct JsFormatContext<'a> {
    /// `None` for a document that isn't JavaScript.
    file: Option<&'a File<'a>>,
    /// See [`JsFormatContext::has_babel_tree`].
    has_babel_tree: bool,
    options: FormatOptions,
    comments: Comments<'a>,
    /// The next node written skips its trailing comments, because the caller prints them. See
    /// [`FormatNodeWithoutTrailingComments`](super::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments).
    skip_trailing_comments: bool,
    /// Nodes that were formatted early, keyed by span, such as an argument formatted to decide on the call's layout. A
    /// node whose span is in here isn't formatted again, because that would print its comments twice.
    cached_elements: FxHashMap<Span, FormatElement>,
    /// With `quoteProps: "consistent"`, one entry per enclosing object: true if its properties are quoted.
    quote_needed_stack: Vec<bool>,
    /// See `utils/tailwindcss.rs`. The last one is active.
    tailwind_contexts: Vec<TailwindContext>,
    /// See `Formatter::is_quiet`.
    pub(crate) is_quiet: bool,
    pub(crate) cursor: CursorRegion,
    stack_check: bun_core::StackCheck,
    /// Something wasn't written because it's nested too deeply.
    pub(crate) ran_out_of_stack: bool,
    /// Ids of the comments that weren't printed when the file was formatted the first time. See
    /// [`crate::ir::run::format_with_marks`].
    pub(crate) comments_without_printer: Vec<u32>,
    /// Caches the last member access nested in many member accesses, and whether it stays on its object's line. The
    /// enclosing member access has the same answer.
    pub(crate) long_member_chain: Cell<Option<(Expr<'a>, bool)>>,
    /// Caches an offset and the start of its line.
    pub(crate) line_start: Cell<(u32, u32)>,
    /// True if the `a | b` being written is a Vue value and filter.
    pub(crate) is_vue_filter_sequence: Cell<bool>,
    /// Parses the code in HTML, overriding `FormatOptions::parse_javascript`.
    pub(crate) parse_javascript: Option<JavaScriptParser<'a>>,
}

impl<'a> JsFormatContext<'a> {
    pub(crate) fn new(
        file: &'a File<'a>,
        options: FormatOptions,
        comments: &'a FileComments,
    ) -> Self {
        Self {
            file: Some(file),
            has_babel_tree: has_babel_tree(file, &options),
            comments: Comments::new(Some(file), options.flavor, comments),
            ..Self::without_file(options, comments)
        }
    }

    /// For a document in another language. Nothing that writes it calls [`file`](JsFormatContext::file).
    pub(crate) fn without_file(options: FormatOptions, comments: &'a FileComments) -> Self {
        let tailwind = options.tailwind.as_deref();
        let plugin_context =
            (tailwind.filter(|it| it.follows_plugin)).map(TailwindContext::for_plugin);
        Self {
            file: None,
            has_babel_tree: false,
            comments: Comments::new(None, options.flavor, comments),
            options,
            skip_trailing_comments: false,
            cached_elements: FxHashMap::default(),
            quote_needed_stack: Vec::new(),
            tailwind_contexts: plugin_context.into_iter().collect(),
            is_quiet: false,
            cursor: CursorRegion::NONE,
            stack_check: bun_core::StackCheck::init(),
            ran_out_of_stack: false,
            comments_without_printer: Vec::new(),
            line_start: Cell::new((0, 0)),
            long_member_chain: Cell::new(None),
            is_vue_filter_sequence: Cell::new(false),
            parse_javascript: None,
        }
    }

    #[inline]
    pub(crate) fn file(&self) -> &'a File<'a> {
        self.file
            .expect("only JavaScript printers call `file()`, and they always have a file")
    }

    /// See [`has_babel_tree`].
    #[inline]
    pub(crate) fn has_babel_tree(&self) -> bool {
        self.has_babel_tree
    }

    /// True if there's enough stack left to write one more nested expression, statement or type. If not, this sets
    /// `ran_out_of_stack`, and the document must be discarded.
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
    pub(crate) fn set_skip_trailing_comments(&mut self, skip: bool) {
        self.skip_trailing_comments = skip;
    }

    /// Reads the flag and clears it, so it only applies to one node.
    #[inline]
    pub(crate) fn take_skip_trailing_comments(&mut self) -> bool {
        std::mem::take(&mut self.skip_trailing_comments)
    }

    #[inline]
    pub(crate) fn comments(&self) -> &Comments<'a> {
        &self.comments
    }

    #[inline]
    pub(crate) fn comments_mut(&mut self) -> &mut Comments<'a> {
        &mut self.comments
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

    /// Sets whether the content being written is inside a call to a function that doesn't take classes. Returns the
    /// previous value, if there is a context.
    #[inline]
    pub(crate) fn disable_tailwind_context(&mut self, is_disabled: bool) -> Option<bool> {
        let context = (self.tailwind_contexts.last_mut()).filter(|it| !it.follows_plugin)?;
        Some(std::mem::replace(&mut context.is_disabled, is_disabled))
    }
}
