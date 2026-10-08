//! What the code that formats a file can see besides the node it is formatting.

use super::comments::{Comment, Comments};
use super::source_text::SourceText;
use crate::cursor::CursorRegion;
use crate::ir::element::FormatElement;
use crate::options::FormatOptions;
use bun_lint::ast::File;
use bun_lint::span::{Span, Spanned};
use rustc_hash::FxHashMap;

pub(crate) struct JsFormatContext<'a> {
    /// `None` for a document that is not written for JavaScript.
    file: Option<&'a File<'a>>,
    options: FormatOptions,
    comments: Comments<'a>,
    /// What has been formatted ahead of its turn, by the span of the node: an argument that was
    /// formatted to decide on the layout of the call. A node whose span is here is not formatted
    /// again, which would print its comments twice.
    cached_elements: FxHashMap<Span, FormatElement>,
    /// With `quoteProps: "consistent"`, whether the properties of the enclosing objects are
    /// quoted.
    quote_needed_stack: Vec<bool>,
    /// See `Formatter::is_quiet`.
    pub(crate) is_quiet: bool,
    pub(crate) cursor: CursorRegion,
    stack_check: bun_core::StackCheck,
    /// Something has not been written because it is nested too deeply.
    pub(crate) ran_out_of_stack: bool,
}

impl<'a> JsFormatContext<'a> {
    pub(crate) fn new(file: &'a File<'a>, options: FormatOptions, comments: &'a [Comment]) -> Self {
        Self {
            file: Some(file),
            ..Self::without_file(file.text(), options, comments)
        }
    }

    /// For a document that is written for `source`, which is in another language. Nothing that
    /// writes it asks for the [file](JsFormatContext::file).
    pub(crate) fn without_file(source: &'a [u8], options: FormatOptions, comments: &'a [Comment]) -> Self {
        Self {
            file: None,
            options,
            comments: Comments::new(SourceText::new(source), comments),
            cached_elements: FxHashMap::default(),
            quote_needed_stack: Vec::new(),
            is_quiet: false,
            cursor: CursorRegion::NONE,
            stack_check: bun_core::StackCheck::init(),
            ran_out_of_stack: false,
        }
    }

    #[inline]
    pub(crate) fn file(&self) -> &'a File<'a> {
        self.file.expect("only what writes JavaScript asks for the file, and there is one then")
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
}
