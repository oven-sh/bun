//! What rules see of a program that a file in another language is lowered to: a Svelte component, as
//! svelte-eslint-parser presents it.
//!
//! The program has every byte of the component once and in order, as code or in markup block comments, plus the code
//! the lowering synthesizes around it: glue. Each line of the program is the same line of the component. The binder,
//! the scopes and the references see all of it. Rules see less:
//! - A node that starts in glue is hidden, and its children take its place: the helper call around a markup expression,
//!   an `{#each}`'s callback, a `{#snippet}`'s function. Their parent is the nearest node that isn't hidden, or the
//!   file for a markup expression.
//! - A node that svelte-eslint-parser has as a node of its own kind isn't a node of its kind here: `$: x = 1` isn't a
//!   labeled statement. It's still the parent of its contents.
//! - Glue isn't a token, and glue comments aren't comments. The markup is tokens, as svelte-eslint-parser creates them.
//! - References are repaired the way svelte-eslint-parser repairs them: see [`Adjustment`].

use crate::span::Span;
use crate::tokens::{RawToken, TokenKind};

/// The source of a part of the program.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Piece {
    /// The file's bytes from `from` on.
    Original,
    /// Synthesized, at the file position `from`.
    Glue,
    /// A synthesized copy of the file's bytes from `from` on, with a space for each line break byte.
    Copy,
    /// Synthesized in place of as many file bytes from `from` on, which rules read instead: the `/` of a `*/` in a line
    /// comment that glue wraps in a block comment.
    StandIn,
}

/// A part of the program that's all one [`Piece`].
#[derive(Copy, Clone, Debug)]
pub struct Segment {
    /// Its start in the program.
    pub at: u32,
    pub len: u32,
    pub piece: Piece,
    pub from: u32,
}

impl Segment {
    #[inline]
    pub fn end(&self) -> u32 {
        self.at + self.len
    }

    /// The file position of the program byte at `offset`, which is in this segment.
    #[inline]
    pub fn place_of(&self, offset: u32) -> u32 {
        match self.piece {
            Piece::Glue => self.from,
            Piece::Original | Piece::Copy | Piece::StandIn => self.from + (offset - self.at),
        }
    }
}

/// A reference repair that svelte-eslint-parser makes once the scopes are analyzed (`analyze-scope.ts`).
#[derive(Copy, Clone, Debug)]
pub enum Adjustment {
    /// The variable whose first declaration starts at `at` is also read or written there, with no source text: an
    /// exported prop, a `$bindable()` prop, a snippet passed to a component. The reference isn't a value reference.
    Add { at: u32, read: bool, write: bool },
    /// The reference at `at` writes as well as reads, even though nothing assigns there: the name `bind:` binds.
    ReadWrite { at: u32 },
    /// The reference at `at` resolves, but its variable doesn't list it: what `$: x = ..` assigns.
    Hide { at: u32 },
    /// The name at `at` declares nothing: a snippet passed to a component and named nowhere else
    /// (`removeIdentifierVariable`).
    Undeclare { at: u32 },
}

/// See the [module](self).
pub struct View {
    segments: Vec<Segment>,
    /// The file.
    original: Box<[u8]>,
    /// The starts of glue where a node is visible: the `const ` of `{@const x = 1}`, whose declaration
    /// svelte-eslint-parser has. Sorted.
    shown: Vec<u32>,
    /// The starts of nodes svelte-eslint-parser has as another kind: a reactive statement's `$:`. Sorted.
    retyped: Vec<u32>,
    /// Everything from here on is hidden: what the lowering appends.
    trailer: u32,
    /// The markup tokens. Sorted.
    tokens: Vec<RawToken>,
    /// Line comments that end a script, which glue wraps in a block comment.
    line_comments: Vec<Span>,
    adjustments: Vec<Adjustment>,
    /// The positions of the [`Adjustment::Undeclare`] names. Sorted.
    undeclared: Vec<u32>,
    /// True if a segment is a [`Piece::StandIn`].
    has_stand_ins: bool,
}

impl View {
    /// For the program that `segments` build from the file `original`.
    pub fn new(original: &[u8], segments: Vec<Segment>) -> View {
        View {
            trailer: segments.last().map_or(0, Segment::end),
            has_stand_ins: segments.iter().any(|it| it.piece == Piece::StandIn),
            segments,
            original: original.into(),
            shown: Vec::new(),
            retyped: Vec::new(),
            tokens: Vec::new(),
            line_comments: Vec::new(),
            adjustments: Vec::new(),
            undeclared: Vec::new(),
        }
    }

    /// Makes a node that starts in the glue at `at` visible.
    pub fn show_at(&mut self, at: u32) {
        insert_sorted(&mut self.shown, at);
    }

    /// Marks a node that starts at `at` as another kind for svelte-eslint-parser: no listener is called with it and
    /// lists leave it out, but it's still the parent of its contents.
    pub fn retype_at(&mut self, at: u32) {
        insert_sorted(&mut self.retyped, at);
    }

    /// Hides everything from `at` on.
    pub fn hide_from(&mut self, at: u32) {
        self.trailer = self.trailer.min(at);
    }

    /// Adds a markup token at `span`.
    pub fn add_token(&mut self, span: Span, kind: TokenKind) {
        let token = RawToken {
            start: span.start,
            end: span.end,
            kind,
        };
        let at = self.tokens.partition_point(|it| it.start < span.start);
        self.tokens.insert(at, token);
    }

    /// Records that the line comment at `span` ends a script, and glue wraps it.
    pub fn add_line_comment(&mut self, span: Span) {
        self.line_comments.push(span);
    }

    pub fn adjust(&mut self, adjustment: Adjustment) {
        if let Adjustment::Undeclare { at } = adjustment {
            insert_sorted(&mut self.undeclared, at);
        }
        self.adjustments.push(adjustment);
    }

    pub fn adjustments(&self) -> &[Adjustment] {
        &self.adjustments
    }

    /// True if the name at `at` declares nothing: [`Adjustment::Undeclare`].
    pub(crate) fn undeclares(&self, at: u32) -> bool {
        self.undeclared.binary_search(&at).is_ok()
    }

    fn segment_at(&self, offset: u32) -> Option<&Segment> {
        let index = self.segments.partition_point(|it| it.end() <= offset);
        self.segments.get(index)
    }

    fn piece_at(&self, offset: u32) -> Option<Piece> {
        self.segment_at(offset).map(|it| it.piece)
    }

    /// True if a node that starts at `start` is hidden from rules, and its children take its place.
    pub fn hides(&self, start: u32) -> bool {
        start >= self.trailer
            || (self.piece_at(start) == Some(Piece::Glue)
                && self.shown.binary_search(&start).is_err())
    }

    /// True if no listener is called with a node that starts at `start` and lists leave it out, because it's hidden or
    /// another kind.
    pub(crate) fn leaves_out(&self, start: u32) -> bool {
        self.hides(start) || self.is_retyped(start)
    }

    /// True if a node that starts at `start` is another kind for svelte-eslint-parser: [`View::retype_at`].
    pub(crate) fn is_retyped(&self, start: u32) -> bool {
        self.retyped.binary_search(&start).is_ok()
    }

    /// What rules read at `span` if it contains a [`Piece::StandIn`]: the file's bytes. `None` means the program's
    /// text, because there's no stand-in, or glue.
    pub(crate) fn text_of(&self, span: Span) -> Option<&[u8]> {
        if !self.has_stand_ins || span.is_empty() {
            return None;
        }
        let first = self.segments.partition_point(|it| it.end() <= span.start);
        let segments = self
            .segments
            .get(first..)?
            .iter()
            .take_while(|it| it.at < span.end);
        let mut has_stand_in = false;
        for segment in segments {
            match segment.piece {
                Piece::Original => {}
                Piece::StandIn => has_stand_in = true,
                Piece::Glue | Piece::Copy => return None,
            }
        }
        let start = self.segment_at(span.start)?.place_of(span.start);
        let end = start.checked_add(span.len())?;
        self.original
            .get(start as usize..end as usize)
            .filter(|_| has_stand_in)
    }

    /// The program position of the file byte at `offset`: [`in_program`].
    pub fn in_program(&self, offset: u32) -> u32 {
        in_program(&self.segments, offset)
    }

    /// Where the program has the pieces of the file's code at `span`: the ones written in place, and the copies, each
    /// the part of `span` that one segment holds, in program order.
    pub(crate) fn pieces_in_program(&self, span: Span) -> [Vec<Span>; 2] {
        [Piece::Original, Piece::Copy].map(|piece| {
            (self.segments.iter())
                .filter(|it| it.piece == piece)
                .filter_map(|it| {
                    let start = span.start.max(it.from);
                    let end = span.end.min(it.from + it.len);
                    let at = |offset: u32| it.at + (offset - it.from);
                    (start < end).then(|| Span::new(at(start), at(end)))
                })
                .collect()
        })
    }

    /// True if the program byte at `offset` is a copy of the file's code.
    pub(crate) fn is_copy(&self, offset: u32) -> bool {
        self.piece_at(offset) == Some(Piece::Copy)
    }

    /// The file position of the program byte at `offset`. A copy maps to its source, and glue to its file position.
    pub fn in_file(&self, offset: u32) -> u32 {
        self.segment_at(offset)
            .map_or(self.original.len() as u32, |it| it.place_of(offset))
    }

    /// True if the byte at `offset` is glue.
    pub(crate) fn is_glue(&self, offset: u32) -> bool {
        self.piece_at(offset) == Some(Piece::Glue)
    }

    /// The tokens of `scanned` that rules see: the code's source tokens, and the markup's.
    pub(crate) fn tokens(&self, scanned: Vec<RawToken>) -> Vec<RawToken> {
        let written = scanned.into_iter().filter(|it| {
            it.start < self.trailer && self.piece_at(it.start) == Some(Piece::Original)
        });
        merge(written, &self.tokens)
    }

    /// The tokens of `scanned` that are in copies of the file's code.
    pub(crate) fn copies(&self, scanned: &[RawToken]) -> Vec<RawToken> {
        let copied = scanned
            .iter()
            .filter(|it| it.start < self.trailer && self.is_copy(it.start));
        copied.copied().collect()
    }

    /// The comments of `scanned` that rules see: none that glue opens, plus the line comments that end scripts.
    pub(crate) fn comments(&self, scanned: Vec<RawToken>) -> Vec<RawToken> {
        let written = scanned.into_iter().filter(|it| {
            it.start < self.trailer && self.piece_at(it.start) == Some(Piece::Original)
        });
        let ending = (self.line_comments.iter()).map(|it| RawToken {
            start: it.start,
            end: it.end,
            kind: TokenKind::Line,
        });
        merge(written, &ending.collect::<Vec<_>>())
    }
}

/// The position of the file byte at `offset` in the program that `segments` build from it: in the source segment that
/// contains it, or else the first segment that ends after it, or the end of the program if none does. A program can
/// have the source text in a different order than the file: the type-checked one has the scripts first.
pub fn in_program(segments: &[Segment], offset: u32) -> u32 {
    let mut written = segments.iter().filter(|it| it.piece == Piece::Original);
    let has = |it: &&Segment| it.from <= offset && offset < it.from + it.len;
    match written.clone().find(has) {
        Some(segment) => segment.at + (offset - segment.from),
        None => match written.find(|it| offset < it.from + it.len) {
            Some(segment) => segment.at + offset.saturating_sub(segment.from),
            None => segments.last().map_or(0, Segment::end),
        },
    }
}

fn insert_sorted(list: &mut Vec<u32>, at: u32) {
    if let Err(index) = list.binary_search(&at) {
        list.insert(index, at);
    }
}

/// Merges `a` and `b`, which are each sorted, into one sorted list.
fn merge(a: impl Iterator<Item = RawToken>, b: &[RawToken]) -> Vec<RawToken> {
    let mut out: Vec<RawToken> = Vec::with_capacity(b.len());
    let mut rest = b.iter().copied().peekable();
    for token in a {
        while let Some(before) = rest.next_if(|it| it.start < token.start) {
            out.push(before);
        }
        out.push(token);
    }
    out.extend(rest);
    out
}
