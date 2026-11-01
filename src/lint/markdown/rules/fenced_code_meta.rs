use crate::prelude::*;

/// Require or disallow metadata for fenced code blocks
pub struct FencedCodeMeta {
    is_never: bool,
}

const MISSING_METADATA: &Message = &Message::new("missingMetadata", "Missing code block metadata.");
const DISALLOWED_METADATA: &Message = &Message::new(
    "disallowedMetadata",
    "Code block metadata is not allowed.",
);

impl Rule for FencedCodeMeta {
    const META: Meta = meta("fenced-code-meta");
    listens!();

    fn new(options: &Options) -> Self {
        FencedCodeMeta {
            is_never: options.str(0) == Some("never"),
        }
    }
}

impl Listens for FencedCodeMeta {
    const LISTENERS: &'static [Listener] = &[Listener::new("code", Kinds::of(&[Kind::Code]))];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        _: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let start = node.start();
        let at = |length: Index| Loc {
            line: start.line,
            column: start.column + length,
        };
        let from_fence = (cx.document.text())
            .get(node.span().start as usize..)
            .unwrap_or_default();
        let fence_line = || util::lines(from_fence).next().unwrap_or_default();
        let meta = node.meta().filter(|it| !it.is_empty());
        if !self.is_never {
            if let Some(lang) = node.lang().filter(|it| !it.is_empty())
                && meta.is_none()
            {
                let end = at(index_of(fence_line(), lang) + length(lang));
                cx.report((start, end), MISSING_METADATA, &[]);
            }
            return Ok(());
        }
        if let Some(meta) = meta {
            let index = last_index_of(fence_line(), meta);
            let end = at(index + length(strings::trim_js_whitespace_end(meta)));
            cx.report((at(index), end), DISALLOWED_METADATA, &[]);
        }
        Ok(())
    }
}
