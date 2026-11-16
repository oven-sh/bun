use crate::prelude::*;

/// Disallow headings without a space after the hash characters
pub struct NoMissingAtxHeadingSpace {
    check_closed_headings: bool,
}

const MISSING_SPACE: &Message = &Message::new(
    "missingSpace",
    "Missing space {{position}} hash(es) on ATX style heading.",
);

/// The start and end of `hashes` in each match of `/(?:^|(?<=[\r\n]))(?<hashes>#{1,6})(?:[^# \t]|$)/gu` in `text`.
fn leading_hashes(text: &[u8]) -> impl Iterator<Item = (usize, usize)> {
    let mut from = 0;
    std::iter::from_fn(move || {
        loop {
            let start = from + strings::index_of_char_usize(text.get(from..)?, b'#')?;
            let hashes = text[start..].iter().take_while(|&&byte| byte == b'#');
            let end = start + hashes.count();
            from = end;
            if (start == 0 || matches!(text[start - 1], b'\r' | b'\n'))
                && end - start <= 6
                && !matches!(text.get(end), Some(b' ' | b'\t'))
            {
                return Some((start, end));
            }
        }
    })
}

static TRAILING_HASHES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(r"/(?<![ \t])(?<spaces>[ \t]*)(?<=(?<!\\)(?:\\{2})*)(?<hashes>#+)[ \t]*$/u")
});

impl Rule for NoMissingAtxHeadingSpace {
    const META: Meta = meta("no-missing-atx-heading-space")
        .recommended()
        .fixable(Fixable::Whitespace);
    listens!();

    fn new(options: &Options) -> Self {
        NoMissingAtxHeadingSpace {
            check_closed_headings: options.object(0).bool_or("checkClosedHeadings", false),
        }
    }
}

impl Listens for NoMissingAtxHeadingSpace {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("heading", Kinds::of(&[Kind::Heading])),
        Listener::new("paragraph", Kinds::of(&[Kind::Paragraph])),
    ];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let text = node.text();
        if !strings::contains_char(text, b'#') {
            return Ok(());
        }
        let offset_of = |at: usize| node.span().start + at as u32;
        if listener == 0 {
            if !self.check_closed_headings {
                return Ok(());
            }
            let Some(found) = TRAILING_HASHES.exec_at(text, 0) else {
                return Ok(());
            };
            if !found.bytes(1).is_empty() {
                return Ok(());
            }
            let start = cx.document.index_of(offset_of(found.start()));
            let locs = cx.locs(start - 1, start + length(found.bytes(2)))?;
            cx.report(locs, MISSING_SPACE, &[("position", b"before")])
                .fix(Span::empty(offset_of(found.start())), b" ");
            return Ok(());
        }
        for (start, end) in leading_hashes(text) {
            let end = offset_of(end);
            let start = cx.document.index_of(offset_of(start));
            let locs = cx.locs(start, cx.document.index_of(end) + 1)?;
            cx.report(locs, MISSING_SPACE, &[("position", b"after")])
                .fix(Span::empty(end), b" ");
        }
        Ok(())
    }
}
