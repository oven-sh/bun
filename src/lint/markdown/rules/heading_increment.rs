use crate::prelude::*;

/// Enforce heading levels increment by one
pub struct HeadingIncrement {
    title: util::PatternOption,
}

const SKIPPED_HEADING: &Message = &Message::new(
    "skippedHeading",
    "Heading level skipped from {{fromLevel}} to {{toLevel}}.",
);

impl Rule for HeadingIncrement {
    const META: Meta = meta("heading-increment").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        HeadingIncrement {
            title: util::front_matter_title(&Self::META, options.object(0)),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        Self::new(options).title.map(|_| ())
    }
}

impl Listens for HeadingIncrement {
    // Upstream has separate `yaml`, `toml` and `json` listeners that all do the same thing.
    const LISTENERS: &'static [Listener] = &[
        Listener::new("yaml", Kinds::of(&[Kind::FrontMatter])),
        Listener::new("heading", Kinds::of(&[Kind::Heading])),
    ];
    /// `lastHeadingDepth`
    type Seen<'d> = u32;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        last_depth: &mut u32,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        if listener == 0 {
            if let Ok(title) = &self.title
                && util::front_matter_has_title(node.value().unwrap_or_default(), title.as_ref())
            {
                *last_depth = 1;
            }
            return Ok(());
        }
        let depth = node.depth();
        if *last_depth > 0 && depth > *last_depth + 1 {
            let (from, to) = (last_depth.to_string(), depth.to_string());
            let data = [("fromLevel", from.as_bytes()), ("toLevel", to.as_bytes())];
            cx.report_node(node, SKIPPED_HEADING, &data);
        }
        *last_depth = depth;
        Ok(())
    }
}
