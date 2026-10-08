//! Prettier's documents (`src/document/builders`) and `printDocToString`.
//!
//! The printer for CSS takes the documents of values apart, puts them together in other ways, and
//! counts on what Prettier's printer does with them: two line breaks in a row are an empty line,
//! `dedent` undoes the last `indent`, a `fill` measures its items the way it does. So this is a tree
//! like Prettier's and a printer that follows Prettier's line by line.

use crate::options::{FormatOptions, IndentStyle, LineEnding};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Line {
    /// `line`
    Space,
    /// `softline`
    Soft,
    /// `hardlineWithoutBreakParent`
    Hard,
    /// `literallineWithoutBreakParent`
    Literal,
}

#[derive(Debug, Clone)]
pub(crate) enum Doc<'a> {
    Text(Cow<'a, [u8]>),
    Array(Vec<Doc<'a>>),
    Indent(Box<Doc<'a>>),
    /// `align(-1, ..)`
    Dedent(Box<Doc<'a>>),
    Group {
        contents: Box<Doc<'a>>,
        should_break: bool,
    },
    /// Alternating content and separators.
    Fill(Vec<Doc<'a>>),
    IfBreak {
        break_contents: Box<Doc<'a>>,
        flat_contents: Box<Doc<'a>>,
    },
    LineSuffix(Box<Doc<'a>>),
    LineSuffixBoundary,
    BreakParent,
    Line(Line),
}

impl<'a> Doc<'a> {
    pub(crate) const EMPTY: Doc<'static> = Doc::Text(Cow::Borrowed(b""));
    pub(crate) const LINE: Doc<'static> = Doc::Line(Line::Space);
    pub(crate) const SOFTLINE: Doc<'static> = Doc::Line(Line::Soft);

    pub(crate) fn is_empty_text(&self) -> bool {
        matches!(self, Doc::Text(text) if text.is_empty())
    }
}

impl<'a> From<&'a str> for Doc<'a> {
    fn from(text: &'a str) -> Self {
        Doc::Text(Cow::Borrowed(text.as_bytes()))
    }
}

impl<'a> From<&'a [u8]> for Doc<'a> {
    fn from(text: &'a [u8]) -> Self {
        Doc::Text(Cow::Borrowed(text))
    }
}

impl<'a> From<Vec<u8>> for Doc<'a> {
    fn from(text: Vec<u8>) -> Self {
        Doc::Text(Cow::Owned(text))
    }
}

impl<'a> From<Cow<'a, [u8]>> for Doc<'a> {
    fn from(text: Cow<'a, [u8]>) -> Self {
        Doc::Text(text)
    }
}

impl<'a> From<Vec<Doc<'a>>> for Doc<'a> {
    fn from(parts: Vec<Doc<'a>>) -> Self {
        Doc::Array(parts)
    }
}

/// `[a, b, ..]`, of anything that is a document or can be made one. `Doc` has to be in scope.
macro_rules! docs {
    ($($part:expr),* $(,)?) => {
        Doc::Array(vec![$(Doc::from($part)),*])
    };
}
pub(crate) use docs;

pub(crate) fn hardline<'a>() -> Doc<'a> {
    Doc::Array(vec![Doc::Line(Line::Hard), Doc::BreakParent])
}

pub(crate) fn indent<'a>(contents: impl Into<Doc<'a>>) -> Doc<'a> {
    Doc::Indent(Box::new(contents.into()))
}

pub(crate) fn dedent<'a>(contents: impl Into<Doc<'a>>) -> Doc<'a> {
    Doc::Dedent(Box::new(contents.into()))
}

pub(crate) fn group<'a>(contents: impl Into<Doc<'a>>) -> Doc<'a> {
    group_with(contents, false)
}

pub(crate) fn group_with<'a>(contents: impl Into<Doc<'a>>, should_break: bool) -> Doc<'a> {
    Doc::Group {
        contents: Box::new(contents.into()),
        should_break,
    }
}

pub(crate) fn fill(parts: Vec<Doc<'_>>) -> Doc<'_> {
    Doc::Fill(parts)
}

pub(crate) fn if_break<'a>(break_contents: impl Into<Doc<'a>>) -> Doc<'a> {
    Doc::IfBreak {
        break_contents: Box::new(break_contents.into()),
        flat_contents: Box::new(Doc::EMPTY),
    }
}

pub(crate) fn line_suffix<'a>(contents: impl Into<Doc<'a>>) -> Doc<'a> {
    Doc::LineSuffix(Box::new(contents.into()))
}

pub(crate) fn join<'a>(separator: &Doc<'a>, docs: Vec<Doc<'a>>) -> Vec<Doc<'a>> {
    let mut parts = Vec::with_capacity(docs.len() * 2);
    for (index, doc) in docs.into_iter().enumerate() {
        if index != 0 {
            parts.push(separator.clone());
        }
        parts.push(doc);
    }
    parts
}

/// Prettier's `removeLines`.
pub(crate) fn remove_lines<'a>(doc: Doc<'a>) -> Doc<'a> {
    let boxed = |doc: Box<Doc<'a>>| Box::new(remove_lines(*doc));
    match doc {
        Doc::Line(Line::Space) => Doc::from(" "),
        Doc::Line(Line::Soft) => Doc::EMPTY,
        Doc::IfBreak { flat_contents, .. } => remove_lines(*flat_contents),
        Doc::Array(parts) => Doc::Array(parts.into_iter().map(remove_lines).collect()),
        Doc::Fill(parts) => Doc::Fill(parts.into_iter().map(remove_lines).collect()),
        Doc::Indent(contents) => Doc::Indent(boxed(contents)),
        Doc::Dedent(contents) => Doc::Dedent(boxed(contents)),
        Doc::LineSuffix(contents) => Doc::LineSuffix(boxed(contents)),
        Doc::Group {
            contents,
            should_break,
        } => Doc::Group {
            contents: boxed(contents),
            should_break,
        },
        doc @ (Doc::Text(_) | Doc::Line(_) | Doc::LineSuffixBoundary | Doc::BreakParent) => doc,
    }
}

/// Prettier's `cleanDoc`: no arrays in arrays, no empty strings, strings that follow each other are
/// one.
pub(crate) fn clean<'a>(doc: Doc<'a>) -> Doc<'a> {
    let wrap = |contents: Box<Doc<'a>>, wrapper: fn(Box<Doc<'a>>) -> Doc<'a>| match clean(*contents) {
        contents if contents.is_empty_text() => Doc::EMPTY,
        contents => wrapper(Box::new(contents)),
    };
    match doc {
        Doc::Fill(parts) => {
            let mut parts: Vec<Doc<'a>> = parts.into_iter().map(clean).collect();
            match parts.len() {
                _ if parts.iter().all(Doc::is_empty_text) => Doc::EMPTY,
                1 => parts.swap_remove(0),
                _ => Doc::Fill(parts),
            }
        }
        Doc::Group {
            contents,
            should_break,
        } => match clean(*contents) {
            contents if contents.is_empty_text() && !should_break => Doc::EMPTY,
            contents @ Doc::Group { should_break: inner, .. } if inner == should_break => contents,
            contents => Doc::Group {
                contents: Box::new(contents),
                should_break,
            },
        },
        Doc::Indent(contents) => wrap(contents, Doc::Indent),
        Doc::Dedent(contents) => wrap(contents, Doc::Dedent),
        Doc::LineSuffix(contents) => wrap(contents, Doc::LineSuffix),
        Doc::IfBreak {
            break_contents,
            flat_contents,
        } => match (clean(*break_contents), clean(*flat_contents)) {
            (break_contents, flat_contents) if break_contents.is_empty_text() && flat_contents.is_empty_text() => Doc::EMPTY,
            (break_contents, flat_contents) => Doc::IfBreak {
                break_contents: Box::new(break_contents),
                flat_contents: Box::new(flat_contents),
            },
        },
        Doc::Array(parts) => {
            let mut cleaned: Vec<Doc<'a>> = Vec::with_capacity(parts.len());
            let mut push = |part: Doc<'a>| match (cleaned.last_mut(), part) {
                (Some(Doc::Text(last)), Doc::Text(text)) => last.to_mut().extend_from_slice(&text),
                (_, part) => cleaned.push(part),
            };
            for part in parts {
                match clean(part) {
                    part if part.is_empty_text() => {}
                    Doc::Array(parts) => parts.into_iter().for_each(&mut push),
                    part => push(part),
                }
            }
            match cleaned.len() {
                0 => Doc::EMPTY,
                1 => cleaned.swap_remove(0),
                _ => Doc::Array(cleaned),
            }
        }
        doc @ (Doc::Text(_) | Doc::Line(_) | Doc::LineSuffixBoundary | Doc::BreakParent) => doc,
    }
}

/// Prettier's `stripTrailingHardlineFromDoc`. `doc` is clean.
pub(crate) fn strip_trailing_hardline(doc: Doc<'_>) -> Doc<'_> {
    fn strip_parts(parts: &mut Vec<Doc<'_>>) {
        while matches!(parts[..], [.., Doc::Line(_), Doc::BreakParent]) {
            parts.truncate(parts.len() - 2);
        }
        if let Some(last) = parts.pop() {
            parts.push(strip_trailing_hardline(last));
        }
    }
    match doc {
        Doc::Indent(contents) => Doc::Indent(Box::new(strip_trailing_hardline(*contents))),
        Doc::LineSuffix(contents) => Doc::LineSuffix(Box::new(strip_trailing_hardline(*contents))),
        Doc::Group {
            contents,
            should_break,
        } => Doc::Group {
            contents: Box::new(strip_trailing_hardline(*contents)),
            should_break,
        },
        Doc::IfBreak {
            break_contents,
            flat_contents,
        } => Doc::IfBreak {
            break_contents: Box::new(strip_trailing_hardline(*break_contents)),
            flat_contents: Box::new(strip_trailing_hardline(*flat_contents)),
        },
        Doc::Fill(mut parts) => {
            strip_parts(&mut parts);
            Doc::Fill(parts)
        }
        Doc::Array(mut parts) => {
            strip_parts(&mut parts);
            Doc::Array(parts)
        }
        Doc::Text(mut text) => {
            let len = text.iter().rposition(|b| !matches!(b, b'\n' | b'\r')).map_or(0, |at| at + 1);
            match &mut text {
                Cow::Borrowed(text) => *text = &text[..len],
                Cow::Owned(text) => text.truncate(len),
            }
            Doc::Text(text)
        }
        doc @ (Doc::Dedent(_) | Doc::Line(_) | Doc::LineSuffixBoundary | Doc::BreakParent) => doc,
    }
}

/// Prettier's `replaceEndOfLine(text, literallineWithoutBreakParent)`.
pub(crate) fn replace_end_of_line_with_literal_lines(text: Cow<'_, [u8]>) -> Doc<'_> {
    if !bun_core::strings::contains_char(&text, b'\n') {
        return Doc::Text(text);
    }
    let lines = bun_core::strings::split(&text, b"\n").map(|line| Doc::from(line.to_vec())).collect();
    Doc::Array(join(&Doc::Line(Line::Literal), lines))
}

/// Prettier's `propagateBreaks`. Returns whether the group around `doc` breaks.
fn propagate_breaks(doc: &mut Doc<'_>) -> bool {
    match doc {
        Doc::BreakParent => true,
        Doc::Group {
            contents,
            should_break,
        } => {
            *should_break = propagate_breaks(contents) || *should_break;
            *should_break
        }
        Doc::Array(parts) | Doc::Fill(parts) => {
            let mut breaks = false;
            for part in parts {
                breaks |= propagate_breaks(part);
            }
            breaks
        }
        Doc::IfBreak {
            break_contents,
            flat_contents,
        } => {
            let breaks = propagate_breaks(break_contents);
            propagate_breaks(flat_contents) || breaks
        }
        Doc::Indent(contents) | Doc::Dedent(contents) | Doc::LineSuffix(contents) => propagate_breaks(contents),
        Doc::Text(_) | Doc::Line(_) | Doc::LineSuffixBoundary => false,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Break,
    Flat,
}

/// What a command prints: a document, or part of one.
#[derive(Copy, Clone)]
enum Content<'d, 'a> {
    Doc(&'d Doc<'a>),
    /// Documents one after the other.
    Array(&'d [Doc<'a>]),
    /// What is left of a `fill`.
    Fill(&'d [Doc<'a>]),
}

#[derive(Copy, Clone)]
struct Command<'d, 'a> {
    /// The number of `indent`s that have not been undone by a `dedent`.
    indent: u32,
    mode: Mode,
    content: Content<'d, 'a>,
}

struct Printer<'o> {
    width: usize,
    use_tabs: bool,
    tab_width: usize,
    new_line: &'static [u8],
    out: &'o mut Vec<u8>,
    /// Where `out` started.
    start: usize,
}

static HARDLINE_WITHOUT_BREAK_PARENT: Doc<'static> = Doc::Line(Line::Hard);

fn string_width(text: &[u8]) -> usize {
    crate::ir::width::string_width(text) as usize
}

/// Prettier's `fits`.
fn fits<'d, 'a>(
    next: Command<'d, 'a>,
    rest_commands: &[Command<'d, 'a>],
    mut remaining_width: isize,
    mut has_line_suffix: bool,
    must_be_flat: bool,
    commands: &mut Vec<Command<'d, 'a>>,
) -> bool {
    let mut rest_index = rest_commands.len();
    let mut has_pending_space = false;
    commands.clear();
    commands.push(next);
    while remaining_width >= 0 {
        let Some(Command { mode, content, indent }) = commands.pop() else {
            if rest_index == 0 {
                return true;
            }
            rest_index -= 1;
            commands.push(rest_commands[rest_index]);
            continue;
        };
        let push = |commands: &mut Vec<Command<'d, 'a>>, mode: Mode, doc: &'d Doc<'a>| {
            commands.push(Command {
                indent,
                mode,
                content: Content::Doc(doc),
            });
        };
        let doc = match content {
            Content::Doc(doc) => doc,
            Content::Array(parts) | Content::Fill(parts) => {
                for part in parts.iter().rev() {
                    push(commands, mode, part);
                }
                continue;
            }
        };
        match doc {
            Doc::Text(text) => {
                if !text.is_empty() {
                    if has_pending_space {
                        remaining_width -= 1;
                        has_pending_space = false;
                    }
                    remaining_width -= string_width(text) as isize;
                }
            }
            Doc::Array(parts) | Doc::Fill(parts) => {
                for part in parts.iter().rev() {
                    push(commands, mode, part);
                }
            }
            Doc::Indent(contents) | Doc::Dedent(contents) => push(commands, mode, contents),
            Doc::Group {
                contents,
                should_break,
            } => {
                if must_be_flat && *should_break {
                    return false;
                }
                push(commands, if *should_break { Mode::Break } else { mode }, contents);
            }
            Doc::IfBreak {
                break_contents,
                flat_contents,
            } => push(commands, mode, if mode == Mode::Break { break_contents } else { flat_contents }),
            Doc::Line(line) => {
                if mode == Mode::Break || matches!(line, Line::Hard | Line::Literal) {
                    return true;
                }
                if *line == Line::Space {
                    has_pending_space = true;
                }
            }
            Doc::LineSuffix(_) => has_line_suffix = true,
            Doc::LineSuffixBoundary => {
                if has_line_suffix {
                    return false;
                }
            }
            Doc::BreakParent => {}
        }
    }
    false
}

impl Printer<'_> {
    fn trim(&mut self) {
        while self.out.len() > self.start && matches!(self.out.last(), Some(b' ' | b'\t')) {
            self.out.pop();
        }
    }

    /// Writes the indentation. Returns its width.
    fn write_indent(&mut self, indent: u32) -> usize {
        let indent = indent as usize;
        match self.use_tabs {
            true => self.out.resize(self.out.len() + indent, b'\t'),
            false => self.out.resize(self.out.len() + indent * self.tab_width, b' '),
        }
        indent * self.tab_width
    }

    fn write_text(&mut self, text: &[u8]) {
        if self.new_line == b"\n" || !bun_core::strings::contains_char(text, b'\n') {
            return self.out.extend_from_slice(text);
        }
        for (index, line) in bun_core::strings::split(text, b"\n").enumerate() {
            if index > 0 {
                self.out.extend_from_slice(self.new_line);
            }
            self.out.extend_from_slice(line);
        }
    }

    /// Prettier's `printDocToString`.
    fn print<'d, 'a>(&mut self, doc: &'d Doc<'a>) {
        let mut position = 0usize;
        let mut commands = vec![Command {
            indent: 0,
            mode: Mode::Break,
            content: Content::Doc(doc),
        }];
        let mut fits_commands = Vec::new();
        let mut should_remeasure = false;
        let mut line_suffix: Vec<Command<'d, 'a>> = Vec::new();

        while let Some(command) = commands.pop() {
            let Command { indent, mode, content } = command;
            let with = |mode: Mode, doc: &'d Doc<'a>| Command {
                indent,
                mode,
                content: Content::Doc(doc),
            };
            match content {
                Content::Array(parts) => commands.extend(parts.iter().rev().map(|part| with(mode, part))),
                Content::Fill(parts) => {
                    self.print_fill(parts, command, position, !line_suffix.is_empty(), &mut commands, &mut fits_commands);
                }
                Content::Doc(doc) => match doc {
                    Doc::Text(text) => {
                        if !text.is_empty() {
                            self.write_text(text);
                            if !commands.is_empty() {
                                position += string_width(text);
                            }
                        }
                    }
                    Doc::Array(parts) => commands.extend(parts.iter().rev().map(|part| with(mode, part))),
                    Doc::Indent(contents) => commands.push(Command {
                        indent: indent + 1,
                        ..with(mode, contents)
                    }),
                    Doc::Dedent(contents) => commands.push(Command {
                        indent: indent.saturating_sub(1),
                        ..with(mode, contents)
                    }),
                    Doc::Group {
                        contents,
                        should_break,
                    } => {
                        if mode == Mode::Flat && !should_remeasure {
                            commands.push(with(if *should_break { Mode::Break } else { Mode::Flat }, contents));
                            continue;
                        }
                        should_remeasure = false;
                        let flat = with(Mode::Flat, contents);
                        let remaining_width = self.width as isize - position as isize;
                        let is_flat = !should_break
                            && fits(flat, &commands, remaining_width, !line_suffix.is_empty(), false, &mut fits_commands);
                        commands.push(if is_flat { flat } else { with(Mode::Break, contents) });
                    }
                    Doc::Fill(parts) => {
                        self.print_fill(parts, command, position, !line_suffix.is_empty(), &mut commands, &mut fits_commands);
                    }
                    Doc::IfBreak {
                        break_contents,
                        flat_contents,
                    } => commands.push(with(mode, if mode == Mode::Break { break_contents } else { flat_contents })),
                    Doc::LineSuffix(contents) => line_suffix.push(with(mode, contents)),
                    Doc::LineSuffixBoundary => {
                        if !line_suffix.is_empty() {
                            commands.push(with(mode, &HARDLINE_WITHOUT_BREAK_PARENT));
                        }
                    }
                    Doc::Line(line) => {
                        let is_hard = matches!(line, Line::Hard | Line::Literal);
                        if mode == Mode::Flat && !is_hard {
                            if *line == Line::Space {
                                self.out.push(b' ');
                                position += 1;
                            }
                        } else {
                            if mode == Mode::Flat {
                                // The groups that follow have been measured without it.
                                should_remeasure = true;
                            }
                            if !line_suffix.is_empty() {
                                commands.push(command);
                                commands.extend(line_suffix.drain(..).rev());
                            } else if *line == Line::Literal {
                                self.out.extend_from_slice(self.new_line);
                                position = 0;
                            } else {
                                self.trim();
                                self.out.extend_from_slice(self.new_line);
                                position = self.write_indent(indent);
                            }
                        }
                    }
                    Doc::BreakParent => {}
                },
            }
            if commands.is_empty() && !line_suffix.is_empty() {
                commands.extend(line_suffix.drain(..).rev());
            }
        }
    }

    fn print_fill<'d, 'a>(
        &self,
        parts: &'d [Doc<'a>],
        command: Command<'d, 'a>,
        position: usize,
        has_line_suffix: bool,
        commands: &mut Vec<Command<'d, 'a>>,
        fits_commands: &mut Vec<Command<'d, 'a>>,
    ) {
        let Command { indent, mode, .. } = command;
        let with = |mode: Mode, content: Content<'d, 'a>| Command { indent, mode, content };
        let remaining_width = self.width as isize - position as isize;
        let [content, rest @ ..] = parts else {
            return;
        };
        let content_flat = with(Mode::Flat, Content::Doc(content));
        let content_break = with(Mode::Break, Content::Doc(content));
        let content_fits = fits(content_flat, &[], remaining_width, has_line_suffix, true, fits_commands);
        let [whitespace, rest @ ..] = rest else {
            commands.push(if content_fits { content_flat } else { content_break });
            return;
        };
        let whitespace_flat = with(Mode::Flat, Content::Doc(whitespace));
        let whitespace_break = with(Mode::Break, Content::Doc(whitespace));
        if rest.is_empty() {
            match content_fits {
                true => commands.extend([whitespace_flat, content_flat]),
                false => commands.extend([whitespace_break, content_break]),
            }
            return;
        }
        let first_and_second = with(Mode::Flat, Content::Array(parts.get(..3).unwrap_or_default()));
        let first_and_second_fit = fits(first_and_second, &[], remaining_width, has_line_suffix, true, fits_commands);
        commands.push(with(mode, Content::Fill(rest)));
        if first_and_second_fit {
            commands.extend([whitespace_flat, content_flat]);
        } else if content_fits {
            commands.extend([whitespace_break, content_flat]);
        } else {
            commands.extend([whitespace_break, content_break]);
        }
    }
}

/// Appends what `doc` prints to `out`. `text`: what is formatted, for `endOfLine: "auto"`.
pub(crate) fn print(mut doc: Doc<'_>, options: &FormatOptions, text: &[u8], out: &mut Vec<u8>) {
    propagate_breaks(&mut doc);
    let start = out.len();
    Printer {
        width: options.line_width.value() as usize,
        use_tabs: matches!(options.indent_style, IndentStyle::Tab),
        tab_width: options.indent_width.value() as usize,
        new_line: match options.line_ending.resolve(text) {
            LineEnding::Crlf => b"\r\n",
            LineEnding::Cr => b"\r",
            _ => b"\n",
        },
        out,
        start,
    }
    .print(&doc);
}
