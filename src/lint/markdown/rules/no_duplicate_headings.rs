use crate::prelude::*;

/// Disallow duplicate headings in the same document
pub struct NoDuplicateHeadings {
    check_siblings_only: bool,
}

const DUPLICATE_HEADING: Message =
    Message::new("duplicateHeading", "Duplicate heading \"{{text}}\" found.");

pub(crate) struct Seen {
    /// The headings of each level so far. Only those of the first unless `checkSiblingsOnly` is on.
    headings_by_level: [FxHashSet<Vec<u8>>; 6],
    last_level: usize,
    /// What is in the heading that is open: the types and the values, and the values that are not HTML.
    children_sequence: Vec<u8>,
    text: Vec<u8>,
}

impl Default for Seen {
    fn default() -> Self {
        Seen {
            headings_by_level: Default::default(),
            last_level: 1,
            children_sequence: Vec::new(),
            text: Vec::new(),
        }
    }
}

impl Rule for NoDuplicateHeadings {
    const META: Meta = meta("no-duplicate-headings");
    listens!();

    fn new(options: &Options) -> Self {
        NoDuplicateHeadings {
            check_siblings_only: options.object(0).bool_or("checkSiblingsOnly", false),
        }
    }
}

impl Listens for NoDuplicateHeadings {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("heading", Kinds::of(&[Kind::Heading])),
        Listener::new("heading *", Kinds::ALL).within(Within::Heading),
        Listener::new("heading:exit", Kinds::of(&[Kind::Heading])),
    ];
    type Seen<'d> = Seen;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        state: &mut Seen,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        match listener {
            0 => {
                state.children_sequence.clear();
                state.text.clear();
                if self.check_siblings_only {
                    let level = (node.depth() as usize).clamp(1, 6);
                    for deeper in level..state.last_level {
                        state.headings_by_level[deeper].clear();
                    }
                    state.last_level = level;
                }
            }
            1 => {
                let sequence = &mut state.children_sequence;
                sequence.push(b'[');
                sequence.extend_from_slice(node.type_name().as_bytes());
                if let Some(value) = node.value().filter(|it| !it.is_empty()) {
                    sequence.push(b',');
                    sequence.extend_from_slice(value);
                    if node.kind() != Kind::Html {
                        state.text.extend_from_slice(value);
                    }
                }
                sequence.push(b']');
            }
            _ => {
                let headings = &mut state.headings_by_level[state.last_level - 1];
                if headings.contains(&state.children_sequence) {
                    cx.report_node(node, DUPLICATE_HEADING, &[("text", &state.text)]);
                } else {
                    headings.insert(state.children_sequence.clone());
                }
            }
        }
        Ok(())
    }
}
