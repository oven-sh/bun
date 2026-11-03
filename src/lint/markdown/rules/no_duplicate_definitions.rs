use crate::prelude::*;

/// Disallow duplicate definitions
pub struct NoDuplicateDefinitions {
    allow_definitions: FxHashSet<Vec<u8>>,
    allow_footnote_definitions: FxHashSet<Vec<u8>>,
    check_footnote_definitions: bool,
}

const DUPLICATE_DEFINITION: &Message = &Message::new(
    "duplicateDefinition",
    "Unexpected duplicate definition `{{ identifier }}` (label: `{{ label }}`) found. First defined at line {{ firstLine }} (label: `{{ firstLabel }}`).",
);
const DUPLICATE_FOOTNOTE_DEFINITION: &Message = &Message::new(
    "duplicateFootnoteDefinition",
    "Unexpected duplicate footnote definition `{{ identifier }}` (label: `{{ label }}`) found. First defined at line {{ firstLine }} (label: `{{ firstLabel }}`).",
);

/// The first definition with each identifier.
#[derive(Default)]
pub(crate) struct Seen<'d> {
    definitions: FxHashMap<&'d [u8], Node<'d>>,
    footnote_definitions: FxHashMap<&'d [u8], Node<'d>>,
}

impl Rule for NoDuplicateDefinitions {
    const META: Meta = meta("no-duplicate-definitions").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicateDefinitions {
            allow_definitions: util::identifiers(options, "allowDefinitions", &["//"]),
            allow_footnote_definitions: util::identifiers(options, "allowFootnoteDefinitions", &[]),
            check_footnote_definitions: options.bool_or("checkFootnoteDefinitions", true),
        }
    }
}

impl Listens for NoDuplicateDefinitions {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("definition", Kinds::of(&[Kind::Definition])),
        Listener::new("footnoteDefinition", Kinds::of(&[Kind::FootnoteDefinition])),
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
        let is_footnote = listener == 1;
        let (allowed, seen, message) = match is_footnote {
            false => (
                &self.allow_definitions,
                &mut state.definitions,
                DUPLICATE_DEFINITION,
            ),
            true if !self.check_footnote_definitions => return Ok(()),
            true => (
                &self.allow_footnote_definitions,
                &mut state.footnote_definitions,
                DUPLICATE_FOOTNOTE_DEFINITION,
            ),
        };
        if allowed.contains(identifier) {
            return Ok(());
        }
        let first = *seen.entry(identifier).or_insert(node);
        if first == node {
            return Ok(());
        }
        let label_of = |node: Node<'d>| match is_footnote {
            true => node.label(),
            false => strings::trim_js_whitespace(node.label()),
        };
        let first_line = first.start().line.to_string();
        let data = [
            ("identifier", identifier),
            ("label", label_of(node)),
            ("firstLine", first_line.as_bytes()),
            ("firstLabel", label_of(first)),
        ];
        cx.report_node(node, message, &data);
        Ok(())
    }
}
