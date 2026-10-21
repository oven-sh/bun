use crate::prelude::*;

/// Require languages for fenced code blocks
pub struct FencedCodeLanguage {
    required: FxHashSet<Vec<u8>>,
}

const MISSING_LANGUAGE: Message = Message::new("missingLanguage", "Missing code block language.");
const DISALLOWED_LANGUAGE: Message = Message::new(
    "disallowedLanguage",
    "Code block language \"{{lang}}\" is not allowed.",
);

impl Rule for FencedCodeLanguage {
    const META: Meta = meta("fenced-code-language").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        let required = options.object(0).strings("required");
        FencedCodeLanguage {
            required: required.iter().map(|it| it.as_bytes().to_vec()).collect(),
        }
    }
}

impl Listens for FencedCodeLanguage {
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
        let end_after = |length: Index| Loc {
            line: start.line,
            column: start.column + length,
        };
        let Some(lang) = node.lang().filter(|it| !it.is_empty()) else {
            let is_fence_char = |byte: &&u8| matches!(byte, b'`' | b'~');
            // Indented code has no fence, so this is 0.
            let fence = node.text().iter().take_while(is_fence_char).count();
            if fence > 0 {
                cx.report((start, end_after(fence as Index)), MISSING_LANGUAGE, &[]);
            }
            return Ok(());
        };
        if !self.required.is_empty() && !self.required.contains(lang) {
            let end = end_after(index_of(node.text(), lang) + length(lang));
            cx.report((start, end), DISALLOWED_LANGUAGE, &[("lang", lang)]);
        }
        Ok(())
    }
}
