//! What the code that formats a file can see besides the node it is formatting.

use super::comments::{Comments, FileComments};
use super::utils::tailwindcss::TailwindContext;
use crate::cursor::CursorRegion;
use crate::ir::element::FormatElement;
use crate::options::{FormatOptions, HtmlRoot, JavaScriptParser};
use bun_lint::ast::{Expr, File};
use bun_lint::span::{Span, Spanned};
use rustc_hash::FxHashMap;
use std::cell::Cell;

/// Whether Prettier reads the code with a parser that has no `ChainExpression` around an optional chain: Babel, which reads
/// JavaScript and every expression in HTML, in TypeScript too, or `angular-estree-parser`. Prettier's `flow` parser produces ESTree's tree, with the
/// `ChainExpression`.
pub(crate) fn has_tree_of_babel(file: &File<'_>, options: &FormatOptions) -> bool {
    let is_read_by_flow_parser =
        file.is_flow() && !super::print::flow::goes_to_babel(options, file.path());
    (file.is_javascript() && !is_read_by_flow_parser)
        || options.in_html.has_tree_of_babel
        || !matches!(options.in_html.root, HtmlRoot::None | HtmlRoot::Program)
}

pub(crate) struct JsFormatContext<'a> {
    /// `None` for a document that is not written for JavaScript.
    file: Option<&'a File<'a>>,
    /// See [`JsFormatContext::has_tree_of_babel`].
    has_tree_of_babel: bool,
    options: FormatOptions,
    comments: Comments<'a>,
    /// The next node that is written leaves its trailing comments to whoever asked for that:
    /// [`FormatNodeWithoutTrailingComments`](super::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments).
    skip_trailing_comments: bool,
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
    /// The ids of the comments that no printer wrote when the file was formatted the first time. See
    /// [`crate::ir::run::format_with_marks`].
    pub(crate) comments_without_printer: Vec<u32>,
    /// The last member access with many member accesses around it, and whether it stays on the line
    /// of its object. The one around it has the same answer.
    pub(crate) long_member_chain: Cell<Option<(Expr<'a>, bool)>>,
    /// An offset, and where its line starts.
    pub(crate) line_start: Cell<(u32, u32)>,
    /// Whether the `a | b` that is being written is a value and a filter of Vue.
    pub(crate) is_vue_filter_sequence: Cell<bool>,
    /// What parses the code in HTML, in the place of `FormatOptions::parse_javascript`.
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
            has_tree_of_babel: has_tree_of_babel(file, &options),
            comments: Comments::new(Some(file), options.flavor, comments),
            ..Self::without_file(options, comments)
        }
    }

    /// For a document in another language. Nothing that writes it asks for the [file](JsFormatContext::file).
    pub(crate) fn without_file(options: FormatOptions, comments: &'a FileComments) -> Self {
        let tailwind = options.tailwind.as_deref();
        let of_plugin = (tailwind.filter(|it| it.follows_plugin)).map(TailwindContext::of_plugin);
        Self {
            file: None,
            has_tree_of_babel: false,
            comments: Comments::new(None, options.flavor, comments),
            options,
            skip_trailing_comments: false,
            cached_elements: FxHashMap::default(),
            quote_needed_stack: Vec::new(),
            tailwind_contexts: of_plugin.into_iter().collect(),
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
            .expect("only what writes JavaScript asks for the file, and there is one then")
    }

    /// See [`has_tree_of_babel`].
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
    pub(crate) fn set_skip_trailing_comments(&mut self, skip: bool) {
        self.skip_trailing_comments = skip;
    }

    /// Reads the flag and clears it, so that it only applies to one node.
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

    /// Says whether what is written is in a call of a function that does not take classes. Returns what was said before,
    /// if there is a context.
    #[inline]
    pub(crate) fn disable_tailwind_context(&mut self, is_disabled: bool) -> Option<bool> {
        let context = (self.tailwind_contexts.last_mut()).filter(|it| !it.follows_plugin)?;
        Some(std::mem::replace(&mut context.is_disabled, is_disabled))
    }
}
