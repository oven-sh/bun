use crate::prelude::*;

/// Disallow spaces around emphasis markers
pub struct NoSpaceInEmphasis {
    check_strikethrough: bool,
}

const SPACE_IN_EMPHASIS: Message = Message::new(
    "spaceInEmphasis",
    "Unexpected space around emphasis marker.",
);

/// Placeholder byte in the masked text for a child node that isn't text: code, a link, HTML.
const NOT_TEXT: u8 = 1;

/// A marker's byte range in the masked text, and its start and end indices in the file.
#[derive(Copy, Clone)]
struct Marker {
    start: usize,
    end: usize,
    index_range: (Index, Index),
}

fn is_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}

/// True if the marker isn't attached to a word on this side. `outward` iterates over the text, moving away from the
/// marker. Punctuation before the next whitespace is skipped. `/` and `\` count as word characters: `src/*`, `*/`.
fn is_free(mut outward: impl Iterator<Item = u8>) -> bool {
    let is_in_word =
        |byte: u8| byte.is_ascii_alphanumeric() || byte >= 0x80 || matches!(byte, b'/' | b'\\');
    !outward
        .find(|&byte| is_whitespace(byte) || is_in_word(byte))
        .is_some_and(is_in_word)
}

/// True if two identical markers would be emphasis if not for whitespace just inside them: `** a**`, `_a _`, `__ a __`.
///
/// Upstream pairs a paragraph's first marker with its second, its third with its fourth, and so on, no matter what
/// surrounds them. So it reports `*.ts, *.tsx` and `char *a, *b`, and its fix joins the words.
fn is_broken_pair(text: &[u8], opening: Marker, closing: Marker) -> bool {
    let (Some(&first), Some(&last)) = (
        text.get(opening.end),
        closing.start.checked_sub(1).and_then(|at| text.get(at)),
    ) else {
        return false;
    };
    let (before, after) = (
        text.get(..opening.start).unwrap_or_default(),
        text.get(closing.end..).unwrap_or_default(),
    );
    // A single `*` or `~` with whitespace inside on both ends isn't emphasis: `(* a comment in OCaml *)`.
    let is_single = opening.end - opening.start == 1 && text.get(opening.start) != Some(&b'_');
    match (is_whitespace(first), is_whitespace(last)) {
        (false, false) => return false,
        (true, true) if is_single => return false,
        _ => {}
    }
    // Skip `*.ts`, `*/` and `/*`.
    !matches!(first, b'.' | b'/')
        && last != b'/'
        && is_free(before.iter().rev().copied())
        && is_free(after.iter().copied())
}

impl NoSpaceInEmphasis {
    /// The start and length of each match of `/(?<=(?<!\\)(?:\\{2})*)(?:\*\*\*|\*\*|\*|___|__|_|~~|~)/gu` in `text`.
    /// Tildes only match if `checkStrikethrough` is on.
    fn markers(&self, text: &[u8]) -> impl Iterator<Item = (usize, usize)> {
        let bytes: &[u8] = match self.check_strikethrough {
            true => b"*_~",
            false => b"*_",
        };
        let mut from = 0;
        std::iter::from_fn(move || {
            loop {
                let at = from + strings::index_of_any(text.get(from..)?, bytes)?;
                let is_backslash = |byte: &&u8| **byte == b'\\';
                if text[..at].iter().rev().take_while(is_backslash).count() % 2 == 1 {
                    from = at + 1;
                    continue;
                }
                let longest = if text[at] == b'~' { 2 } else { 3 };
                let is_same = |byte: &&u8| **byte == text[at];
                let len = text[at..].iter().take(longest).take_while(is_same).count();
                from = at + len;
                return Some((at, len));
            }
        })
    }
}

impl Rule for NoSpaceInEmphasis {
    const META: Meta = meta("no-space-in-emphasis")
        .recommended()
        .fixable(Fixable::Whitespace);
    listens!();

    fn new(options: &Options) -> Self {
        NoSpaceInEmphasis {
            check_strikethrough: options.object(0).bool_or("checkStrikethrough", false),
        }
    }
}

impl Listens for NoSpaceInEmphasis {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("heading, paragraph, tableCell", Kinds::WITH_TEXT),
        Listener::new(
            ":matches(heading, paragraph, tableCell) > text",
            Kinds::of(&[Kind::Text]),
        )
        .within(Within::ChildOfNodeWithText),
        Listener::new(
            ":matches(heading, paragraph, tableCell):exit",
            Kinds::WITH_TEXT,
        ),
    ];
    /// The `text` nodes that are direct children of the current node.
    type Seen<'d> = Vec<Span>;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        texts: &mut Vec<Span>,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        match listener {
            0 => {
                texts.clear();
                return Ok(());
            }
            1 => {
                texts.push(node.span());
                return Ok(());
            }
            _ => {}
        }
        let has_marker = |span: &Span| self.markers(cx.document.slice(*span)).next().is_some();
        if !texts.iter().any(has_marker) {
            return Ok(());
        }
        // The text nodes are copied as is. Everything between them becomes one byte per UTF-16 code unit.
        let mut masked = Vec::with_capacity(node.text().len());
        let mut from = node.span().start;
        for &span in texts.iter() {
            let first = masked.len();
            let between = cx.document.slice(Span::before(from, span));
            util::push_as_spaces(between, false, &mut masked);
            if !between.iter().all(|&byte| is_whitespace(byte)) {
                masked[first..].fill(NOT_TEXT);
            }
            masked.extend_from_slice(cx.document.slice(span));
            from = span.end;
        }
        let mut report_whitespace =
            |check: Index, start: Index, end: Index| -> Result<(), OutOfRange> {
                let span = cx.span(check, check + 1);
                if check >= 0 && matches!(cx.document.slice(span), b" " | b"\t") {
                    let locs = cx.locs(start, end)?;
                    cx.report(locs, SPACE_IN_EMPHASIS, &[]).fix(span, b"");
                }
                Ok(())
            };
        // The last unpaired marker for each marker string.
        let mut open: Vec<(&[u8], Option<Marker>)> = Vec::new();
        let mut indices = Indices::new(&masked, node.start_index());
        for (start, len) in self.markers(&masked) {
            let end = start + len;
            let index = indices.at(start);
            let marker = Marker {
                start,
                end,
                index_range: (index, index + len as Index),
            };
            // A `*` or `~` with whitespace on both sides is plain text: `2 * 3`, `~ 5`. Upstream's fix turns `2 * 3 *
            // 4` into `2 *3* 4`.
            let is_whitespace_at = |at: Option<usize>| {
                at.and_then(|at| masked.get(at))
                    .copied()
                    .is_some_and(is_whitespace)
            };
            if matches!(&masked[start..end], b"*" | b"~")
                && is_whitespace_at(start.checked_sub(1))
                && is_whitespace_at(Some(end))
            {
                continue;
            }
            let at = match open.iter().position(|it| it.0 == &masked[start..end]) {
                Some(at) => at,
                None => {
                    open.push((&masked[start..end], None));
                    open.len() - 1
                }
            };
            match open[at].1.take() {
                Some(opening) if is_broken_pair(&masked, opening, marker) => {
                    let (opening, closing) = (opening.index_range, marker.index_range);
                    report_whitespace(opening.1, opening.0, opening.1 + 2)?;
                    report_whitespace(closing.0 - 1, closing.0 - 2, closing.1)?;
                }
                _ => open[at].1 = Some(marker),
            }
        }
        Ok(())
    }
}
