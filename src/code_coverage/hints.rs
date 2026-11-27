use bun_core::strings;
use bun_sema::check::spans::token_end;
use bun_sema::hir::Comment;

use crate::locs::token_after;
use crate::positions::Positions;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Hint {
    Next,
    If,
    Else,
}

/// The comments that leave code out of the report. Each has the meaning that it has for the tool it names.
#[derive(Default)]
pub(crate) struct Hints {
    pub(crate) ignores_file: bool,
    /// By the start of the node.
    nodes: Vec<(u32, Hint)>,
    /// Whole lines, sorted and apart from each other.
    ranges: Vec<(u32, u32)>,
}

pub(crate) fn is_in_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// The word that `text` starts with, and what follows the white space after it.
fn split_word(text: &[u8]) -> (&[u8], &[u8]) {
    let (word, rest) = text.split_at(text.iter().take_while(|&&it| is_in_word(it)).count());
    (word, rest.trim_ascii_start())
}

fn start_of_next_node(text: &[u8], token: u32) -> u32 {
    let end = token_end(text, token as usize, false);
    match text.get(token as usize..end).unwrap_or_default() {
        b"?." => token,
        b"else" | [b'&' | b'|' | b'?' | b':' | b',' | b'=', ..] => token_after(text, end as u32),
        _ => token,
    }
}

impl Hints {
    pub(crate) fn find(comments: &[Comment], text: &[u8], positions: &Positions<'_>) -> Hints {
        let mut hints = Hints::default();
        let mut first_of_ignored_lines = None;
        for comment in comments {
            let inside = text.get(comment.pos as usize + 2..comment.end as usize);
            let inside = strings::trim_left(inside.unwrap_or_default(), b" \t\r\n*!");
            let (tool, rest) = split_word(inside.strip_prefix(b"node:").unwrap_or(inside));
            let is_for_node = inside.starts_with(b"node:");
            let ((true, b"coverage") | (false, b"istanbul" | b"c8" | b"v8")) = (is_for_node, tool)
            else {
                continue;
            };
            let (what, rest) = match split_word(rest) {
                (b"ignore", rest) => split_word(rest),
                (b"disable", rest) if is_for_node => (&b"start"[..], rest),
                (b"enable", rest) if is_for_node => (&b"stop"[..], rest),
                _ => continue,
            };
            let line = positions.line_of(comment.pos);
            let lines = bun_core::fmt::parse_int::<u32>(split_word(rest).0, 10).ok();
            let hint = match what {
                b"next" if tool == b"istanbul" || tool == b"v8" && lines.is_none() => Hint::Next,
                b"if" => Hint::If,
                b"else" => Hint::Else,
                b"next" => {
                    let before =
                        &text[positions.start_of_line(line) as usize..comment.pos as usize];
                    let last = positions.line_of(comment.end) + lines.unwrap_or(1) as usize;
                    match is_for_node {
                        true => hints.ignore_lines(line + 1, last, positions),
                        false if before.iter().any(|&it| is_in_word(it)) => {
                            hints.ignore_lines(line, line, positions)
                        }
                        false => hints.ignore_lines(line, last, positions),
                    }
                    continue;
                }
                b"start" => {
                    first_of_ignored_lines.get_or_insert(line);
                    continue;
                }
                b"stop" | b"end" => {
                    let first = first_of_ignored_lines.take().unwrap_or(line);
                    hints.ignore_lines(first, line, positions);
                    continue;
                }
                b"file" => {
                    hints.ignores_file = true;
                    continue;
                }
                _ => continue,
            };
            (hints.nodes).push((start_of_next_node(text, comment.next_token_start), hint));
        }
        if let Some(first) = first_of_ignored_lines {
            hints.ignore_lines(first, positions.line_count(), positions);
        }
        hints
    }

    fn ignore_lines(&mut self, first: usize, last: usize, positions: &Positions<'_>) {
        let mut start = positions.start_of_line(first);
        let mut end = positions.start_of_line(last + 1);
        while let Some(before) = self.ranges.pop_if(|it| start <= it.1) {
            (start, end) = (start.min(before.0), end.max(before.1));
        }
        self.ranges.push((start, end));
    }

    #[inline]
    pub(crate) fn has(&self, node: u32, hint: Hint) -> bool {
        let first = self.nodes.partition_point(|it| it.0 < node);
        let mut hints = self.nodes[first..].iter().take_while(|it| it.0 == node);
        hints.any(|it| it.1 == hint)
    }

    #[inline]
    pub(crate) fn ignores_line_at(&self, offset: u32) -> bool {
        let after = self.ranges.partition_point(|it| it.0 <= offset);
        after > 0 && offset < self.ranges[after - 1].1
    }
}
