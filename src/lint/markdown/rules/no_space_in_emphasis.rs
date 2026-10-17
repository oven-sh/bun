use crate::prelude::*;

/// Disallow spaces around emphasis markers
pub struct NoSpaceInEmphasis {
    check_strikethrough: bool,
}

const SPACE_IN_EMPHASIS: Message = Message::new(
    "spaceInEmphasis",
    "Unexpected space around emphasis marker.",
);

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
        // Replace everything else with spaces.
        let mut masked = Vec::with_capacity(node.text().len());
        let mut from = node.span().start;
        for &span in texts.iter() {
            util::push_blanks(cx.document.slice(Span::before(from, span)), false, &mut masked);
            masked.extend_from_slice(cx.document.slice(span));
            from = span.end;
        }
        // The start and end of every marker, grouped by marker text. The groups are in order of first appearance.
        let mut groups: Vec<(&[u8], Vec<(Index, Index)>)> = Vec::new();
        let mut indices = Indices::new(&masked, node.start_index());
        for (at, len) in self.markers(&masked) {
            let marker = &masked[at..at + len];
            let start = indices.at(at);
            let place = (start, start + len as Index);
            match groups.iter_mut().find(|it| it.0 == marker) {
                Some(group) => group.1.push(place),
                None => groups.push((marker, vec![place])),
            }
        }
        let mut report_whitespace = |check: Index, start: Index, end: Index| -> Result<(), OutOfRange> {
            let span = cx.span(check, check + 1);
            if check >= 0 && matches!(cx.document.slice(span), b" " | b"\t") {
                let locs = cx.locs(start, end)?;
                cx.report(locs, SPACE_IN_EMPHASIS, &[]).fix(span, b"");
            }
            Ok(())
        };
        for (_, group) in &groups {
            for &[opening, closing] in group.as_chunks::<2>().0 {
                report_whitespace(opening.1, opening.0, opening.1 + 2)?;
                report_whitespace(closing.0 - 1, closing.0 - 2, closing.1)?;
            }
        }
        Ok(())
    }
}
