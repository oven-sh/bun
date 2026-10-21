use crate::prelude::*;

/// Disallow reversed link and image syntax
pub struct NoReversedMediaSyntax;

const REVERSED_SYNTAX: Message = Message::new(
    "reversedSyntax",
    "Unexpected reversed syntax found. Use [label](URL) syntax instead.",
);

static REVERSED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(
        r"/(?<=(?<!\\)(?:\\{2})*)\((?<label>(?:\\.|[^()\\]|\([\s\S]*\))*)\)\[(?<url>(?:\\.|[^\]\\\r\n])*)\](?!\()/gu",
    )
});

impl Rule for NoReversedMediaSyntax {
    const META: Meta = meta("no-reversed-media-syntax")
        .recommended()
        .fixable(Fixable::Code);
    listens!();

    fn new(_: &Options) -> Self {
        NoReversedMediaSyntax
    }
}

impl Listens for NoReversedMediaSyntax {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("heading, paragraph, tableCell", Kinds::WITH_TEXT),
        Listener::new(
            ":matches(heading, paragraph, tableCell) :matches(html, image, imageReference, inlineCode, linkReference, inlineMath)",
            Kinds::of(&[
                Kind::Html,
                Kind::Image,
                Kind::ImageReference,
                Kind::InlineCode,
                Kind::LinkReference,
                Kind::InlineMath,
            ]),
        )
        .within(Within::NodeWithText),
        Listener::new(
            ":matches(heading, paragraph, tableCell):exit",
            Kinds::WITH_TEXT,
        ),
    ];
    /// The spans to mask in the current node, in source order.
    type Seen<'d> = Vec<Span>;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        masked: &mut Vec<Span>,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        match listener {
            0 => masked.clear(),
            1 => masked.push(node.span()),
            _ => {
                // A match needs a `)[` with a `]` after it.
                let Some(middle) = strings::index_of(node.text(), b")[") else {
                    return Ok(());
                };
                if !strings::contains_char(&node.text()[middle..], b']') {
                    return Ok(());
                }
                let mut text = Vec::with_capacity(node.text().len());
                let mut from = node.span().start;
                for &span in masked.iter() {
                    // A span nested in an earlier one is already masked.
                    if span.start >= from {
                        text.extend_from_slice(cx.document.slice(Span::before(from, span)));
                        util::push_as_spaces(cx.document.slice(span), false, &mut text);
                        from = span.end;
                    }
                }
                text.extend_from_slice(cx.document.slice(Span::new(from, node.span().end)));
                let mut indices = Indices::new(&text, node.start_index());
                for found in REVERSED.exec_iter(&text) {
                    let start = indices.at(found.start());
                    let end = start + length(found.as_bytes());
                    let label_start = start + 1;
                    let label_end = label_start + length(found.bytes(1));
                    let url_start = label_end + 2;
                    let url_end = url_start + length(found.bytes(2));
                    let fixed = [
                        b"[",
                        cx.document.slice(cx.span(label_start, label_end)),
                        b"](",
                        cx.document.slice(cx.span(url_start, url_end)),
                        b")",
                    ]
                    .concat();
                    let (locs, span) = (cx.locs(start, end)?, cx.span(start, end));
                    cx.report(locs, REVERSED_SYNTAX, &[]).fix(span, fixed);
                }
            }
        }
        Ok(())
    }
}
