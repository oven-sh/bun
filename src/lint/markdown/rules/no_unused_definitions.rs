use crate::prelude::*;

/// Disallow unused definitions
pub struct NoUnusedDefinitions {
    allow_definitions: FxHashSet<Vec<u8>>,
    allow_footnote_definitions: FxHashSet<Vec<u8>>,
    check_footnote_definitions: bool,
}

const UNUSED_DEFINITION: &Message = &Message::new(
    "unusedDefinition",
    "Unexpected unused definition `{{ identifier }}` (label: `{{ label }}`) found.",
);
const UNUSED_FOOTNOTE_DEFINITION: &Message = &Message::new(
    "unusedFootnoteDefinition",
    "Unexpected unused footnote definition `{{ identifier }}` (label: `{{ label }}`) found.",
);

#[derive(Default)]
pub(crate) struct Seen<'d> {
    used_identifiers: FxHashSet<&'d [u8]>,
    used_footnote_identifiers: FxHashSet<&'d [u8]>,
    definitions: Vec<Node<'d>>,
    footnote_definitions: Vec<Node<'d>>,
}

impl Rule for NoUnusedDefinitions {
    const META: Meta = meta("no-unused-definitions").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUnusedDefinitions {
            allow_definitions: util::identifiers(options, "allowDefinitions", &["//"]),
            allow_footnote_definitions: util::identifiers(options, "allowFootnoteDefinitions", &[]),
            check_footnote_definitions: options.bool_or("checkFootnoteDefinitions", true),
        }
    }
}

impl Listens for NoUnusedDefinitions {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("imageReference", Kinds::of(&[Kind::ImageReference])),
        Listener::new("linkReference", Kinds::of(&[Kind::LinkReference])),
        Listener::new("footnoteReference", Kinds::of(&[Kind::FootnoteReference])),
        Listener::new("definition", Kinds::of(&[Kind::Definition])),
        Listener::new("footnoteDefinition", Kinds::of(&[Kind::FootnoteDefinition])),
        Listener::new("root:exit", Kinds::of(&[Kind::Root])),
    ];
    type Seen<'d> = Seen<'d>;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        state: &mut Seen<'d>,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let identifier = node.identifier();
        match listener {
            0 | 1 => {
                state.used_identifiers.insert(identifier);
            }
            2 => {
                state.used_footnote_identifiers.insert(identifier);
            }
            3 => {
                if !self.allow_definitions.contains(identifier) {
                    state.definitions.push(node);
                }
            }
            4 => {
                if self.check_footnote_definitions
                    && !self.allow_footnote_definitions.contains(identifier)
                {
                    state.footnote_definitions.push(node);
                }
            }
            _ => {
                for &definition in &state.definitions {
                    let identifier = definition.identifier();
                    if !state.used_identifiers.contains(identifier) {
                        let label = strings::trim_js_whitespace(definition.label());
                        let data = [("identifier", identifier), ("label", label)];
                        cx.report_node(definition, UNUSED_DEFINITION, &data);
                    }
                }
                for &definition in &state.footnote_definitions {
                    let identifier = definition.identifier();
                    if !state.used_footnote_identifiers.contains(identifier) {
                        let data = [("identifier", identifier), ("label", definition.label())];
                        cx.report_node(definition, UNUSED_FOOTNOTE_DEFINITION, &data);
                    }
                }
            }
        }
        Ok(())
    }
}
