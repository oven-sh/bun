use crate::prelude::*;

/// Require alternative text for images
pub struct RequireAltText;

const ALT_TEXT_REQUIRED: &Message = &Message::new(
    "altTextRequired",
    "Alternative text for image is required.",
);

static ARIA_HIDDEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r#"/\saria-hidden(?:\s*=\s*['"]([^'"]*)['"])?/iu"#));
static ALT: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r#"/\salt(?:\s*=\s*['"]([^'"]*)['"])?/iu"#));

impl Rule for RequireAltText {
    const META: Meta = meta("require-alt-text").recommended();
    listens!();

    fn new(_: &Options) -> Self {
        RequireAltText
    }
}

impl Listens for RequireAltText {
    const LISTENERS: &'static [Listener] = &[
        Listener::new(
            "image, imageReference",
            Kinds::of(&[Kind::Image, Kind::ImageReference]),
        ),
        Listener::new("html", Kinds::of(&[Kind::Html])),
    ];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        if listener == 0 {
            if strings::is_all_js_whitespace(node.alt()) {
                cx.report_node(node, ALT_TEXT_REQUIRED, &[]);
            }
            return Ok(());
        }
        let text = util::strip_html_comments(node.text());
        let mut indices = Indices::new(&text, node.start_index());
        for tag in util::tags(&text, util::TagPattern::Img) {
            let img = &text[tag.start..tag.end];
            let aria_hidden = ARIA_HIDDEN.exec_at(img, 0);
            if aria_hidden.is_some_and(|it| &*to_lower_case(it.bytes(1)) == b"true") {
                continue;
            }
            // `alt=""` marks the image as decorative. An `alt` with only whitespace counts as missing.
            let is_missing = ALT.exec_at(img, 0).is_none_or(|it| {
                !it.bytes(1).is_empty() && strings::is_all_js_whitespace(it.bytes(1))
            });
            if is_missing {
                let start = indices.at(tag.start);
                let locs = cx.locs(start, start + length(img))?;
                cx.report(locs, ALT_TEXT_REQUIRED, &[]);
            }
        }
        Ok(())
    }
}
