use crate::prelude::*;

/// Disallow empty definitions
pub struct NoEmptyDefinitions {
    allow_definitions: FxHashSet<Vec<u8>>,
    allow_footnote_definitions: FxHashSet<Vec<u8>>,
    check_footnote_definitions: bool,
}

const EMPTY_DEFINITION: &Message = &Message::new(
    "emptyDefinition",
    "Unexpected empty definition `{{ identifier }}` (label: `{{ label }}`) found.",
);
const EMPTY_FOOTNOTE_DEFINITION: &Message = &Message::new(
    "emptyFootnoteDefinition",
    "Unexpected empty footnote definition `{{ identifier }}` (label: `{{ label }}`) found.",
);

impl Rule for NoEmptyDefinitions {
    const META: Meta = meta("no-empty-definitions").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoEmptyDefinitions {
            allow_definitions: util::identifiers(options, "allowDefinitions", &["//"]),
            allow_footnote_definitions: util::identifiers(options, "allowFootnoteDefinitions", &[]),
            check_footnote_definitions: options.bool_or("checkFootnoteDefinitions", true),
        }
    }
}

impl Listens for NoEmptyDefinitions {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("definition", Kinds::of(&[Kind::Definition])),
        Listener::new("footnoteDefinition", Kinds::of(&[Kind::FootnoteDefinition])),
    ];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let identifier = node.identifier();
        if listener == 0 {
            if matches!(node.url(), b"" | b"#") && !self.allow_definitions.contains(identifier) {
                let label = strings::trim_js_whitespace(node.label());
                let data = [("identifier", identifier), ("label", label)];
                cx.report_node(node, EMPTY_DEFINITION, &data);
            }
            return Ok(());
        }
        let is_comment = |child: Node<'d>| {
            child.kind() == Kind::Html && util::is_only_comments(child.value().unwrap_or_default())
        };
        if self.check_footnote_definitions
            && !self.allow_footnote_definitions.contains(identifier)
            && node.children().all(is_comment)
        {
            let data = [("identifier", identifier), ("label", node.label())];
            cx.report_node(node, EMPTY_FOOTNOTE_DEFINITION, &data);
        }
        Ok(())
    }
}
