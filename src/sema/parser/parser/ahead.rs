//! Parses a long declaration file on several threads.
//!
//! The text says where a statement is likely to end. From each such place a thread parses statements until it reaches
//! the next one. Then the file is parsed from its start as usual, and where that parser is about to parse a statement
//! at one of the places, in the context that was guessed, it takes the result and goes on behind it. A wrong guess is
//! never taken, so the tree is the one that a single thread builds.

use super::*;
use crate::summarize::with_scratch;
use bun_core::strings;
use bun_highway::ScannerStops;
use bun_sema::util::{has_helpers, with_helpers};
use bun_threading::Guarded;
use std::collections::VecDeque;

#[cfg(test)]
mod tests;

/// Shorter texts are parsed by one thread.
const SHORTEST_TEXT: usize = 128 << 10;

/// Where a stretch starts: the end of the token before its first statement.
#[derive(Copy, Clone)]
struct Place {
    at: u32,
    is_in_namespace: bool,
}

struct ParsedAhead {
    from: u32,
    /// The end of its last token.
    end: u32,
    context: u32,
    nodes: Stretch,
    comments: Vec<Comment>,
    comment_directives: Vec<CommentDirective>,
    ignore_comments: Vec<(u32, u32)>,
    /// `jsdoc::tags_in` its comments.
    tags: u8,
}

/// A field of the parser.
pub(crate) struct Ahead {
    /// From here on a list of declarations calls `take_parsed_ahead` before each statement.
    next: u32,
    /// In the order of the text. Empty in the parser of a stretch, which gives up in a namespace that is open at `next`.
    parsed: VecDeque<ParsedAhead>,
    /// `jsdoc::tags_in` the first `comments_read` comments of the file, and in those that were dropped.
    pub(crate) tags: u8,
    pub(crate) comments_read: usize,
}

impl Default for Ahead {
    fn default() -> Self {
        Ahead {
            next: u32::MAX,
            parsed: VecDeque::new(),
            tags: 0,
            comments_read: 0,
        }
    }
}

impl Ahead {
    /// How much of `text` a thread takes at a time, if several parse it.
    pub(crate) fn share_of(text: &[u8], options: &Options) -> Option<usize> {
        let is_shared = (SHORTEST_TEXT..1 << 30).contains(&text.len())
            && options.may_use_helpers
            && options.is_declaration_file
            && options.dialect == Default::default()
            && options.part.is_none()
            && !(options.is_javascript
                || options.is_jsx
                || options.recovers
                || options.attach_comments
                || options.compiles
                || options.skips_function_blocks
                || options.reads_module_statements_alone)
            && has_helpers();
        is_shared.then(|| (text.len() / 12).clamp(48 << 10, 256 << 10))
    }

    pub(crate) fn parse(
        text: &[u8],
        options: Options,
        atoms: &dyn Intern,
        stops: ScannerStops<'_>,
        share: usize,
    ) -> Ahead {
        let next = |last: &Place| place_from(text, last.at as usize + share);
        let places: Vec<Place> = std::iter::successors(place_from(text, 0), next).collect();
        let parsed: Vec<Guarded<Vec<ParsedAhead>>> =
            places.iter().map(|_| Guarded::new(Vec::new())).collect();
        let parse_share = |index: usize| {
            let until = places.get(index + 1).map_or(text.len() as u32, |it| it.at);
            let mut place = Some(places[index]);
            with_scratch(|scratch| {
                scratch.names.use_interner(atoms, share);
                // A stretch ends early with its namespace, or before one that is longer than the share.
                for _ in 0..8 {
                    let has_much_left = |it: &Place| it.at as usize + share / 16 < until as usize;
                    let Some(from) = place.filter(has_much_left) else {
                        break;
                    };
                    let (stretch, end) =
                        parse_stretch(text, options, atoms, stops, (from, until), scratch);
                    parsed[index].lock().extend(stretch);
                    place = place_from(text, end as usize + 1);
                }
            });
        };
        with_helpers(|in_parallel| in_parallel(places.len(), &parse_share));
        let parsed: VecDeque<ParsedAhead> = (parsed.iter())
            .flat_map(|it| std::mem::take(&mut *it.lock()))
            .collect();
        Ahead {
            next: parsed.front().map_or(u32::MAX, |it| it.from),
            parsed,
            ..Ahead::default()
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.parsed.is_empty()
    }
}

/// The first `}` or `;` that ends a line and comes before what looks like a declaration.
fn place_from(text: &[u8], first: usize) -> Option<Place> {
    let mut from = first;
    loop {
        let line_feed = from + strings::index_of_char_usize(text.get(from..)?, b'\n')?;
        from = line_feed + 1;
        let line = &text[..line_feed];
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.len() < first || !matches!(line.last(), Some(b'}' | b';')) {
            continue;
        }
        let Some(next) = skip_trivia(text, from) else {
            continue;
        };
        if is_declaration(&text[next..]) {
            return Some(Place {
                at: line.len() as u32,
                is_in_namespace: text[next - 1] != b'\n',
            });
        }
    }
}

fn skip_trivia(text: &[u8], mut at: usize) -> Option<usize> {
    loop {
        at += match text.get(at..)? {
            [b' ' | b'\t' | b'\r' | b'\n', ..] => 1,
            [b'/', b'*', rest @ ..] => strings::index_of(rest, b"*/")? + 4,
            [b'/', b'/', rest @ ..] => strings::index_of_char_usize(rest, b'\n')? + 2,
            _ => return Some(at),
        };
    }
}

fn is_declaration(text: &[u8]) -> bool {
    const KEYWORDS: [&[u8]; 9] = [
        b"interface ",
        b"declare ",
        b"export ",
        b"type ",
        b"function ",
        b"class ",
        b"namespace ",
        b"const ",
        b"enum ",
    ];
    let mut names = KEYWORDS.iter().filter_map(|it| text.strip_prefix(*it));
    names.any(|name| name.first().is_some_and(u8::is_ascii_alphabetic))
}

/// Also returns where it ends.
fn parse_stretch(
    text: &[u8],
    options: Options,
    atoms: &dyn Intern,
    stops: ScannerStops<'_>,
    (from, until): (Place, u32),
    scratch: &mut Scratch,
) -> (Option<ParsedAhead>, u32) {
    let mut file = FileBuilder::default();
    Stretch::begin(&mut file);
    let mut stacks = std::mem::take(&mut scratch.stacks);
    stacks.clear();
    let mut declared = std::mem::take(&mut scratch.declared);
    declared.begin(text.len(), declared_names(&options));
    let mut lx = Lexer::new(text, stops, atoms, &mut scratch.names);
    set_up_lexer(&mut lx, &options);
    lx.start_at(from.at);
    let jsdoc = jsdoc::State::new(&options, true, 0);
    let mut parser = Parser::<false, false>::new(lx, file, stacks, declared, options, jsdoc);
    if from.is_in_namespace {
        parser.enter_module_block();
    }
    let context = parser.context;
    let end = parser.stretch(until);
    parser.lx.discard_trivia_from(end);
    let is_plain = parser.context == context
        && parser.lx.flagged.is_empty()
        && parser.lx.private_names.is_empty()
        && !(parser.lx.has_legacy_octal
            || parser.lx.has_escaped_keyword
            || parser.has_top_level_await
            || parser.has_plain_top_level_await
            || parser.names_await_at_top_level
            || parser.has_await_in_statement
            || parser.has_await_in_name
            || parser.has_await_identifier);
    let statements: Vec<StmtId> = parser.s.ids.iter().map(|&id| StmtId(id)).collect();
    (scratch.stacks, scratch.declared) = (parser.s, parser.declared);
    if !is_plain || statements.is_empty() {
        return (None, end);
    }
    let lx = parser.lx;
    let tags = jsdoc::tags_in(text, &lx.comments);
    let parsed = Stretch::new(Box::new(parser.f), statements).map(|nodes| ParsedAhead {
        from: from.at,
        end,
        context,
        nodes,
        comments: match options.drops_comments {
            true => Vec::new(),
            false => lx.comments,
        },
        comment_directives: lx.comment_directives,
        ignore_comments: lx.ignore_comments,
        tags,
    });
    (parsed, end)
}

impl Parser<'_, false, false> {
    /// Parses whole statements up to the first that ends at `until` or later, the end of the list or an error, and leaves
    /// them on the stack. Returns the end of the last one.
    fn stretch(&mut self, until: u32) -> u32 {
        self.ahead.next = until;
        self.next();
        loop {
            let end = self.full_start();
            if end >= until || self.has_failed() || !self.is_in_list(T::CloseBrace) {
                return end;
            }
            let (checkpoint, private_names) = (self.checkpoint(), self.lx.private_names.len());
            let statement = self.statement();
            if self.has_failed() {
                self.rollback(&checkpoint);
                self.lx.private_names.truncate(private_names);
                return end;
            }
            self.push_statement(statement);
        }
    }
}

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    #[inline(always)]
    pub(super) fn may_be_parsed_ahead(&self) -> bool {
        !GENERAL && !COMMENTS && self.full_start() >= self.ahead.next
    }

    /// Call before a statement of the file or of a namespace. Returns the statements from here on that are parsed already,
    /// and moves behind them.
    #[cold]
    #[inline(never)]
    pub(super) fn take_parsed_ahead(&mut self) -> Vec<StmtId> {
        if self.ahead.parsed.is_empty() {
            self.reject(Rejection::Unsupported);
            return Vec::new();
        }
        let (from, parsed) = (self.full_start(), &mut self.ahead.parsed);
        let (mut end, mut stretches) = (from, Vec::new());
        loop {
            while parsed.pop_front_if(|it| it.from < end).is_some() {}
            let fits = self.speculations == 0;
            let Some(mut next) =
                parsed.pop_front_if(|it| fits && (it.from, it.context) == (end, self.context))
            else {
                break;
            };
            if end == from {
                self.lx.discard_trivia_from(from);
                let unread = &self.lx.comments[self.ahead.comments_read..];
                self.ahead.tags |= jsdoc::tags_in(self.lx.src, unread);
            }
            end = next.end;
            self.lx.comments.append(&mut next.comments);
            (self.lx.comment_directives).append(&mut next.comment_directives);
            self.lx.ignore_comments.append(&mut next.ignore_comments);
            self.ahead.tags |= next.tags;
            stretches.push(next.nodes);
        }
        self.ahead.next = parsed.front().map_or(u32::MAX, |it| it.from.max(from + 1));
        if stretches.is_empty() {
            return Vec::new();
        }
        self.ahead.comments_read = self.lx.comments.len();
        #[cfg(test)]
        tests::TAKEN.set(tests::TAKEN.get() + stretches.len());
        let statements =
            with_helpers(|in_parallel| self.f.append_stretches(&stretches, in_parallel));
        self.lx.start_at(end);
        self.next();
        statements
    }
}
