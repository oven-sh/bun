//! What the code that formats a file can see besides the node it is formatting.

use super::comments::{Comment, Comments};
use super::source_text::SourceText;
use crate::core::element::FormatElement;
use crate::options::FormatOptions;
use bun_lint::ast::File;
use bun_lint::span::{Span, Spanned};
use rustc_hash::FxHashMap;

pub(crate) struct JsFormatContext<'a> {
    file: &'a File<'a>,
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
}

impl<'a> JsFormatContext<'a> {
    pub(crate) fn new(file: &'a File<'a>, options: FormatOptions, comments: &'a [Comment]) -> Self {
        Self {
            file,
            options,
            comments: Comments::new(SourceText::new(file.text()), comments),
            cached_elements: FxHashMap::default(),
            quote_needed_stack: Vec::new(),
            is_quiet: false,
        }
    }

    #[inline]
    pub(crate) fn file(&self) -> &'a File<'a> {
        self.file
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
