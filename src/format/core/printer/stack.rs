//! The stacks and the queue of the printer.
//!
//! To find out whether something fits on the line, the printer runs ahead without printing. That
//! must leave its own stacks as they are, so measuring works on a [`StackedStack`]: a view of a
//! stack that pops from a borrowed copy and pushes to a vector of its own.

use super::{Indention, PrintError, PrintResult};
use crate::core::element::{FormatElement, Interned, PrintMode, Tag, TagKind};
use crate::options::IndentStyle;

pub(super) trait Stack<T> {
    fn pop(&mut self) -> Option<T>;
    fn push(&mut self, value: T);
    fn top(&self) -> Option<&T>;
    fn top_mut(&mut self) -> Option<&mut T>;
}

impl<T> Stack<T> for Vec<T> {
    #[inline]
    fn pop(&mut self) -> Option<T> {
        self.pop()
    }

    #[inline]
    fn push(&mut self, value: T) {
        self.push(value);
    }

    #[inline]
    fn top(&self) -> Option<&T> {
        self.last()
    }

    #[inline]
    fn top_mut(&mut self) -> Option<&mut T> {
        self.last_mut()
    }
}

pub(super) struct StackedStack<'p, T> {
    original: &'p [T],
    stack: Vec<T>,
}

impl<'p, T> StackedStack<'p, T> {
    /// `stack` is empty. It is only passed for its capacity.
    pub(super) fn with_vec(original: &'p [T], stack: Vec<T>) -> Self {
        Self { original, stack }
    }

    pub(super) fn into_vec(mut self) -> Vec<T> {
        self.stack.clear();
        self.stack
    }
}

impl<T: Copy> Stack<T> for StackedStack<'_, T> {
    #[inline]
    fn pop(&mut self) -> Option<T> {
        self.stack.pop().or_else(|| {
            let (last, rest) = self.original.split_last()?;
            self.original = rest;
            Some(*last)
        })
    }

    #[inline]
    fn push(&mut self, value: T) {
        self.stack.push(value);
    }

    #[inline]
    fn top(&self) -> Option<&T> {
        self.stack.last().or_else(|| self.original.last())
    }

    #[inline]
    fn top_mut(&mut self) -> Option<&mut T> {
        if self.stack.is_empty() {
            let (last, rest) = self.original.split_last()?;
            self.original = rest;
            self.stack.push(*last);
        }
        self.stack.last_mut()
    }
}

// ───────────────────────────── the call stack ─────────────────────────────

/// What is pushed for every start tag and popped for its end tag.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(super) struct StackFrame {
    /// `None` at the root.
    kind: Option<TagKind>,
    mode: PrintMode,
}

pub(super) struct CallStack<S>(pub(super) S);

pub(super) type PrintCallStack = CallStack<Vec<StackFrame>>;
pub(super) type FitsCallStack<'p> = CallStack<StackedStack<'p, StackFrame>>;

impl PrintCallStack {
    pub(super) fn new(mut frames: Vec<StackFrame>) -> Self {
        frames.clear();
        frames.push(StackFrame {
            kind: None,
            mode: PrintMode::Expanded,
        });
        CallStack(frames)
    }
}

impl<S: Stack<StackFrame>> CallStack<S> {
    /// Fails unless the top is the frame of a start tag of `kind`.
    #[inline]
    pub(super) fn pop(&mut self, kind: TagKind) -> PrintResult<()> {
        match self.0.pop() {
            Some(StackFrame {
                kind: Some(actual), ..
            }) if actual == kind => Ok(()),
            Some(frame) => {
                // The stack is never left empty.
                self.0.push(frame);
                Err(PrintError::InvalidDocument)
            }
            None => Err(PrintError::InvalidDocument),
        }
    }

    /// The mode of the innermost tag.
    #[inline]
    pub(super) fn top(&self) -> PrintMode {
        self.0.top().map_or(PrintMode::Expanded, |frame| frame.mode)
    }

    #[inline]
    pub(super) fn push(&mut self, kind: TagKind, mode: PrintMode) {
        self.0.push(StackFrame {
            kind: Some(kind),
            mode,
        });
    }
}

// ───────────────────────────── indentation ─────────────────────────────

/// The indentation of every enclosing indent and align. A dedent moves the top to `history` and
/// its end moves it back.
pub(super) struct IndentStack<S> {
    pub(super) indentions: S,
    pub(super) history: S,
}

pub(super) type FitsIndentStack<'p> = IndentStack<StackedStack<'p, Indention>>;

impl<S: Stack<Indention>> IndentStack<S> {
    pub(super) fn start_dedent(&mut self) {
        if let Some(indent) = self.indentions.pop() {
            self.history.push(indent);
        }
    }

    pub(super) fn end_dedent(&mut self) {
        if let Some(indent) = self.history.pop() {
            self.indentions.push(indent);
        }
    }

    #[inline]
    pub(super) fn pop(&mut self) {
        self.indentions.pop();
    }

    #[inline]
    pub(super) fn indention(&self) -> Indention {
        self.indentions.top().copied().unwrap_or_default()
    }

    pub(super) fn reset_indent(&mut self) {
        self.indentions.push(Indention::default());
    }

    #[inline]
    pub(super) fn indent(&mut self, indent_style: IndentStyle) {
        let next = self.indention().increment_level(indent_style);
        self.indentions.push(next);
    }

    pub(super) fn align(&mut self, count: u8) {
        let next = self.indention().set_align(count);
        self.indentions.push(next);
    }
}

pub(super) struct PrintIndentStack {
    pub(super) stack: IndentStack<Vec<Indention>>,
    /// The indentation at each pending line suffix.
    pub(super) suffixes: Vec<Indention>,
}

impl PrintIndentStack {
    pub(super) fn push_suffix(&mut self, indention: Indention) {
        self.suffixes.push(indention);
    }

    pub(super) fn flush_suffixes(&mut self) {
        self.stack.indentions.extend(self.suffixes.drain(..).rev());
    }
}

// ───────────────────────────── the queue ─────────────────────────────

/// The elements that are still to be processed: a stack of ranges of the pool, none of which is
/// empty. The next element is the first of the top.
pub(super) struct Queue<S>(pub(super) S);

pub(super) type PrintQueue = Queue<Vec<Interned>>;
pub(super) type FitsQueue<'p> = Queue<StackedStack<'p, Interned>>;

impl PrintQueue {
    pub(super) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl<S: Stack<Interned>> Queue<S> {
    /// The index of the next element, which is removed.
    #[inline]
    pub(super) fn pop(&mut self) -> Option<u32> {
        let top = self.0.top_mut()?;
        let index = top.start;
        if top.len > 1 {
            top.start += 1;
            top.len -= 1;
        } else {
            self.0.pop();
        }
        Some(index)
    }

    /// The next element. Of interned content, its first.
    pub(super) fn top<'d>(&self, pool: &'d [FormatElement]) -> Option<&'d FormatElement> {
        let mut top = pool.get(self.0.top()?.start as usize);
        while let Some(FormatElement::Interned(interned)) = top {
            top = pool.get(interned.range())?.first();
        }
        top
    }

    /// Puts `elements` before everything that is in the queue.
    #[inline]
    pub(super) fn extend_back(&mut self, elements: Interned) {
        if elements.len != 0 {
            self.0.push(elements);
        }
    }

    /// Removes what the last `extend_back` added, of which nothing has been popped.
    pub(super) fn pop_slice(&mut self) -> Option<Interned> {
        self.0.pop()
    }

    /// Removes the elements up to and including the end tag that matches a start tag of `kind`
    /// that has just been popped, and returns those before the end tag. The two tags have to be
    /// in the same range of the pool, as they are if a builder writes them.
    pub(super) fn take_content(
        &mut self,
        kind: TagKind,
        pool: &[FormatElement],
    ) -> PrintResult<Interned> {
        let top = self.0.top_mut().ok_or(PrintError::InvalidDocument)?;
        let mut depth = 1usize;
        for (i, element) in pool.get(top.range()).unwrap_or_default().iter().enumerate() {
            let FormatElement::Tag(tag) = element else {
                continue;
            };
            if tag.kind() != kind {
                continue;
            }
            if tag.is_start() {
                depth += 1;
                continue;
            }
            depth -= 1;
            if depth == 0 {
                let content = Interned {
                    start: top.start,
                    len: i as u32,
                };
                top.start += i as u32 + 1;
                top.len -= i as u32 + 1;
                if top.len == 0 {
                    self.0.pop();
                }
                return Ok(content);
            }
        }
        Err(PrintError::InvalidDocument)
    }

    /// Removes the elements up to and including the end tag that matches a start tag of `kind`
    /// that has just been popped.
    pub(super) fn skip_content(&mut self, kind: TagKind, pool: &[FormatElement]) -> PrintResult<()> {
        let mut depth = 1usize;
        while depth > 0 {
            let index = self.pop().ok_or(PrintError::InvalidDocument)?;
            match pool.get(index as usize) {
                Some(FormatElement::Interned(interned)) => self.extend_back(*interned),
                Some(FormatElement::Tag(tag)) if tag.kind() == kind => match tag.is_start() {
                    true => depth += 1,
                    false => depth -= 1,
                },
                Some(_) => {}
                None => return Err(PrintError::InvalidDocument),
            }
        }
        Ok(())
    }
}

/// Tells when to stop measuring.
pub(super) trait FitsEndPredicate {
    fn is_end(&mut self, element: &FormatElement) -> PrintResult<bool>;
}

/// Measures to the end of the document, or rather to the first line break.
pub(super) struct AllPredicate;

impl FitsEndPredicate for AllPredicate {
    #[inline]
    fn is_end(&mut self, _element: &FormatElement) -> PrintResult<bool> {
        Ok(false)
    }
}

/// Measures from a [`Tag::StartEntry`] to its [`Tag::EndEntry`].
#[derive(Default)]
pub(super) struct SingleEntryPredicate {
    depth: usize,
    is_done: bool,
}

impl SingleEntryPredicate {
    pub(super) fn is_done(&self) -> bool {
        self.is_done
    }
}

impl FitsEndPredicate for SingleEntryPredicate {
    fn is_end(&mut self, element: &FormatElement) -> PrintResult<bool> {
        if self.is_done {
            return Ok(true);
        }
        match element {
            FormatElement::Tag(Tag::StartEntry) => self.depth += 1,
            FormatElement::Tag(Tag::EndEntry) => {
                self.depth = self.depth.checked_sub(1).ok_or(PrintError::InvalidDocument)?;
                self.is_done = self.depth == 0;
            }
            FormatElement::Interned(_) => {}
            _ if self.depth == 0 => return Err(PrintError::InvalidDocument),
            _ => {}
        }
        Ok(self.is_done)
    }
}
