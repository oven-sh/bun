//! Looking for text in what is rendered.

use bun_core::strings;
use smallvec::SmallVec;

use crate::document::Document;
use crate::editing::{Point, Range};
use crate::name::name;
use crate::selector::Pseudo;
use crate::tree::{DOCUMENT, NodeId, State};
use crate::types::Display;
use crate::values::text;

unsafe extern "C" {
    safe fn Bun__DesktopHost__characterProperty(character: u32, property: u32) -> i32;
    safe fn Bun__DesktopHost__decompose(character: u32) -> u64;
    fn Bun__DesktopHost__findBreaks(
        kind: u8,
        text: *const u8,
        length: usize,
        offsets: *mut u32,
    ) -> usize;
}

const RENDERED: u32 = 1;
const VISIBLE: u32 = 1 << 1;
const INERT: u32 = 1 << 4;
const CONTENTS: u32 = 1 << 6;
const BLOCK: u32 = 1 << 11;
const HIDDEN_CONTENT: u32 = 1 << 14;
const BOUNDARY: char = '\n';

fn is_mark(character: char) -> bool {
    const GENERAL_CATEGORY: u32 = 0x1005;
    matches!(
        Bun__DesktopHost__characterProperty(character.into(), GENERAL_CATEGORY),
        6..=8
    )
}

/// Without case and accents.
fn push_folded(out: &mut String, character: char) {
    if character.is_ascii() {
        return out.push(character.to_ascii_lowercase());
    }
    match Bun__DesktopHost__decompose(character.into()) {
        0 if is_mark(character) => {}
        0 => out.extend(character.to_lowercase()),
        parts => [parts as u32, (parts >> 32) as u32]
            .into_iter()
            .filter(|it| *it != 0)
            .filter_map(char::from_u32)
            .for_each(|it| push_folded(out, it)),
    }
}

fn push_comparable(out: &mut String, character: char, folds: bool) {
    match character.is_whitespace() || character == '\u{feff}' {
        true if out.ends_with([' ', BOUNDARY]) => {}
        true => out.push(' '),
        false if folds => push_folded(out, character),
        false => out.push(character),
    }
}

fn comparable(term: &str, folds: bool) -> String {
    let mut out = String::with_capacity(term.len());
    term.chars()
        .for_each(|it| push_comparable(&mut out, it, folds));
    out
}

/// A part of the text that has the bytes of the node one after the other, or else stands for one character.
struct Run {
    at: u32,
    from: Point,
    character_len: Option<u8>,
}

/// The text of a document as it is compared.
#[derive(Default)]
struct Haystack {
    text: String,
    runs: Vec<Run>,
}

impl Haystack {
    fn push_data(&mut self, node: NodeId, data: &str, folds: bool) {
        let mut continues = false;
        for (offset, character) in data.char_indices() {
            let at = self.text.len();
            push_comparable(&mut self.text, character, folds);
            let (added, len) = (self.text.len() - at, character.len_utf8());
            let is_bytewise = len == 1 && added == 1;
            if added > 0 && !(is_bytewise && continues) {
                self.runs.push(Run {
                    at: at as u32,
                    from: Point {
                        node,
                        offset: offset as u32,
                    },
                    character_len: (!is_bytewise).then_some(len as u8),
                });
            }
            continues = is_bytewise;
        }
    }

    /// What no text node has stands for the end of the text before it.
    fn push_gap(&mut self, push: impl FnOnce(&mut String)) {
        let at = self.text.len();
        let before = at.checked_sub(1).and_then(|it| self.origin(it));
        push(&mut self.text);
        if let Some((from, len)) = before.filter(|_| self.text.len() > at) {
            self.runs.push(Run {
                at: at as u32,
                from: Point {
                    offset: from.offset + len,
                    ..from
                },
                character_len: Some(0),
            });
        }
    }

    /// Where the character with the byte at `at` starts, and its length.
    fn origin(&self, at: usize) -> Option<(Point, u32)> {
        let run = &self.runs[self
            .runs
            .partition_point(|it| it.at as usize <= at)
            .checked_sub(1)?];
        Some(match run.character_len {
            Some(len) => (run.from, len.into()),
            None => (
                Point {
                    offset: run.from.offset + at as u32 - run.at,
                    ..run.from
                },
                1,
            ),
        })
    }

    fn range(&self, [start, end]: [usize; 2]) -> Option<Range> {
        let (last, len) = self.origin(end.checked_sub(1)?)?;
        Some([
            self.origin(start)?.0,
            Point {
                offset: last.offset + len,
                ..last
            },
        ])
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Purpose {
    Finding { matches_case: bool },
    TextFragment,
}

enum Step {
    Enter { node: NodeId, can_be_revealed: bool },
    EndBlock,
}

struct Directive {
    prefix: Option<String>,
    start: String,
    end: Option<String>,
    suffix: Option<String>,
}

impl Directive {
    /// <https://wicg.github.io/scroll-to-text-fragment/#parse-a-text-directive>
    fn parse(source: &[u8]) -> Option<Directive> {
        let all: SmallVec<[&[u8]; 4]> = strings::split(source, b",").collect();
        let mut parts = &all[..];
        let prefix = parts
            .first()?
            .strip_suffix(b"-")
            .inspect(|_| parts = &parts[1..]);
        let suffix = parts
            .last()?
            .strip_prefix(b"-")
            .inspect(|_| parts = &parts[..parts.len() - 1]);
        let (start, end) = match parts {
            [start] => (*start, None),
            [start, end] => (*start, Some(*end)),
            _ => return None,
        };
        let decode = |term: &[u8]| {
            let (mut out, decoded) = (
                String::new(),
                bun_url::PercentEncoding::decode_lenient_alloc(term),
            );
            for chunk in decoded.utf8_chunks() {
                out.push_str(chunk.valid());
                out.extend((!chunk.invalid().is_empty()).then_some(char::REPLACEMENT_CHARACTER));
            }
            comparable(&out, true)
        };
        let is_valid = [prefix, Some(start), end, suffix]
            .into_iter()
            .flatten()
            .all(|it| !it.is_empty() && !strings::contains_char(it, b'-'));
        is_valid.then(|| Directive {
            prefix: prefix.map(decode),
            start: decode(start),
            end: end.map(decode),
            suffix: suffix.map(decode),
        })
    }
}

struct Words<'a> {
    text: &'a [u8],
    boundaries: Vec<u32>,
}

impl<'a> Words<'a> {
    fn new(text: &'a str) -> Words<'a> {
        const WORDS: u8 = 7;
        let mut boundaries = vec![0; text.len()];
        // SAFETY: there is room for one per byte.
        let count = unsafe {
            Bun__DesktopHost__findBreaks(WORDS, text.as_ptr(), text.len(), boundaries.as_mut_ptr())
        };
        boundaries.truncate(count);
        Words {
            text: text.as_bytes(),
            boundaries,
        }
    }

    fn is_boundary(&self, at: usize) -> bool {
        at == 0 || self.boundaries.binary_search(&(at as u32)).is_ok()
    }

    fn find(&self, term: &str, mut from: usize, ends_word: bool) -> Option<usize> {
        loop {
            let at = from + strings::index_of(self.text.get(from..)?, term.as_bytes())?;
            if self.is_boundary(at) && (!ends_word || self.is_boundary(at + term.len())) {
                return Some(at);
            }
            from = at + 1;
        }
    }

    fn has_at(&self, at: usize, term: &str, ends_word: bool) -> bool {
        self.text[at..].starts_with(term.as_bytes())
            && (!ends_word || self.is_boundary(at + term.len()))
    }

    fn skip_spaces(&self, at: usize) -> usize {
        at + self.text[at..]
            .iter()
            .take_while(|it| it.is_ascii_whitespace())
            .count()
    }

    /// <https://wicg.github.io/scroll-to-text-fragment/#find-a-range-from-a-text-directive>
    fn find_directive(
        &self,
        Directive {
            prefix,
            start,
            end,
            suffix,
        }: &Directive,
    ) -> Option<[usize; 2]> {
        let (ends_word, mut from) = (end.is_some() || suffix.is_none(), 0);
        while from < self.text.len() {
            let first = match prefix {
                Some(prefix) => {
                    let before = self.find(prefix, from, false)?;
                    from = before + 1;
                    self.skip_spaces(before + prefix.len())
                }
                None => {
                    from = self.find(start, from, ends_word)? + 1;
                    from - 1
                }
            };
            if !self.has_at(first, start, ends_word) {
                continue;
            }
            let mut last = first + start.len();
            loop {
                if let Some(end) = end {
                    last = self.find(end, last, suffix.is_none())? + end.len();
                }
                if suffix
                    .as_ref()
                    .is_none_or(|it| self.has_at(self.skip_spaces(last), it, true))
                {
                    return Some([first, last]);
                }
                if end.as_ref().is_none_or(String::is_empty) {
                    break;
                }
            }
        }
        None
    }
}

impl Document {
    fn top_modal(&self) -> Option<NodeId> {
        let last_with = |state| {
            self.top_layer.iter().rfind(|it| {
                self.tree
                    .element(**it)
                    .is_some_and(|it| it.state.contains(state))
            })
        };
        last_with(State::MODAL)
            .or_else(|| last_with(State::FULLSCREEN))
            .copied()
    }

    fn bits_once_revealed(&mut self, node: NodeId) -> u32 {
        if self.tree[node].text().is_some() {
            return RENDERED | VISIBLE;
        }
        self.update_style_of(node);
        match self.tree.style(node).map(|it| it.display()) {
            None | Some(Display::None) => 0,
            Some(display) if display.is_inline_level() || display == Display::Contents => {
                RENDERED | VISIBLE
            }
            Some(_) => RENDERED | VISIBLE | BLOCK,
        }
    }

    fn haystack(&mut self, purpose: Purpose) -> Haystack {
        let (is_finding, folds) = (
            purpose != Purpose::TextFragment,
            purpose != Purpose::Finding { matches_case: true },
        );
        let root = self.top_modal().filter(|_| is_finding).unwrap_or(DOCUMENT);
        let (mut found, mut steps) = (
            Haystack::default(),
            vec![Step::Enter {
                node: root,
                can_be_revealed: false,
            }],
        );
        while let Some(step) = steps.pop() {
            let Step::Enter {
                node,
                mut can_be_revealed,
            } = step
            else {
                found.push_gap(|it| it.push(BOUNDARY));
                continue;
            };
            let bits = match self.updated_style_bits(
                node,
                RENDERED | VISIBLE | INERT | CONTENTS | BLOCK | HIDDEN_CONTENT,
            ) {
                _ if node == DOCUMENT => CONTENTS,
                bits if bits & HIDDEN_CONTENT != 0 && can_be_revealed => {
                    self.bits_once_revealed(node)
                }
                bits => bits,
            };
            if let Some(data) = self.tree[node].text() {
                if bits & (RENDERED | VISIBLE) == RENDERED | VISIBLE
                    && !(is_finding && bits & INERT != 0)
                {
                    found.push_data(node, text(data), folds);
                }
                continue;
            }
            let (tag, pseudo) = (
                self.tree.html_tag(node),
                self.tree.element(node).map_or(Pseudo::None, |it| it.pseudo),
            );
            let is_opaque = match purpose {
                Purpose::Finding { .. } => pseudo == Pseudo::Part(name!("placeholder")),
                Purpose::TextFragment => [
                    name!("audio"),
                    name!("iframe"),
                    name!("img"),
                    name!("meter"),
                    name!("object"),
                    name!("progress"),
                    name!("script"),
                    name!("select"),
                    name!("style"),
                    name!("textarea"),
                    name!("input"),
                    name!("video"),
                ]
                .contains(&tag),
            };
            if bits & (RENDERED | CONTENTS) == 0 || is_opaque {
                continue;
            }
            if bits & BLOCK != 0 {
                found.push_gap(|it| it.push(BOUNDARY));
                steps.push(Step::EndBlock);
            } else if tag == name!("br") {
                found.push_gap(|it| push_comparable(it, ' ', folds));
            }
            let hidden = self
                .tree
                .element(node)
                .and_then(|it| it.attribute(name!("hidden")));
            can_be_revealed |= !is_finding
                && (pseudo == Pseudo::Part(name!("details-content"))
                    || hidden.is_some_and(|it| it.eq_ignore_ascii_case("until-found")));
            let first = steps.len();
            steps.extend(self.tree.flat_children(node).map(|node| Step::Enter {
                node,
                can_be_revealed,
            }));
            steps[first..].reverse();
        }
        found
    }

    /// A match does not go from one block to another.
    pub(crate) fn find_text(&mut self, wanted: &str, matches_case: bool) -> Vec<Range> {
        let (wanted, mut found, mut from) = (comparable(wanted, !matches_case), Vec::new(), 0);
        if wanted.is_empty() {
            return found;
        }
        let haystack = self.haystack(Purpose::Finding { matches_case });
        while let Some(at) = strings::index_of(&haystack.text.as_bytes()[from..], wanted.as_bytes())
        {
            found.extend(haystack.range([from + at, from + at + wanted.len()]));
            from += at + wanted.len();
        }
        found
    }

    /// <https://wicg.github.io/scroll-to-text-fragment/#process-a-fragment-directive>
    pub(crate) fn find_text_directives(&mut self, directives: &[u8]) -> Vec<Range> {
        let parsed: Vec<_> = strings::split(directives, b"&")
            .filter_map(|it| Directive::parse(it.strip_prefix(b"text=")?))
            .collect();
        if parsed.is_empty() {
            return Vec::new();
        }
        let haystack = self.haystack(Purpose::TextFragment);
        let words = Words::new(&haystack.text);
        parsed
            .iter()
            .filter_map(|it| haystack.range(words.find_directive(it)?))
            .collect()
    }
}
