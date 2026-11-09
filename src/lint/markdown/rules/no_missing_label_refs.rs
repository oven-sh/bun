use crate::prelude::*;

/// Disallow missing label references
pub struct NoMissingLabelRefs {
    allow_labels: FxHashSet<Vec<u8>>,
}

const NOT_FOUND: &Message = &Message::new("notFound", "Label reference '{{label}}' not found.");

static LABEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(
        r"/(?<=(?<!\\)(?:\\{2})*)\[(?<left>(?:\\.|[^[\]\\])*)\](?:\[(?<right>(?:\\.|[^\]\\])*)\])?/dgu",
    )
});

#[derive(Default)]
pub(crate) struct Seen<'d> {
    /// `allMissingReferences`. A label is set to `None` once a definition for it is found.
    missing: Vec<(Option<&'d [u8]>, (Loc, Loc))>,
    /// For each label, the indices in `missing` of the references that have it.
    by_label: FxHashMap<&'d [u8], Vec<u32>>,
}

impl Rule for NoMissingLabelRefs {
    const META: Meta = meta("no-missing-label-refs").recommended();
    listens!();

    fn new(options: &Options) -> Self {
        let labels = options.object(0).strings("allowLabels");
        NoMissingLabelRefs {
            allow_labels: labels.iter().map(|it| it.as_bytes().to_vec()).collect(),
        }
    }
}

impl Listens for NoMissingLabelRefs {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("root:exit", Kinds::of(&[Kind::Root])),
        Listener::new("text", Kinds::of(&[Kind::Text])),
        Listener::new("definition", Kinds::of(&[Kind::Definition])),
    ];
    type Seen<'d> = Seen<'d>;

    fn on<'d>(
        &self,
        listener: usize,
        node: Node<'d>,
        state: &mut Seen<'d>,
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        match listener {
            0 => {
                for &(label, locs) in &state.missing {
                    if let Some(label) = label {
                        cx.report(locs, NOT_FOUND, &[("label", label)]);
                    }
                }
            }
            1 => {
                let text = node.text();
                if !strings::contains_char(text, b'[') {
                    return Ok(());
                }
                for found in LABEL.exec_iter(text) {
                    if util::ILLEGAL_SHORTHAND_TAIL.test(found.as_bytes()) {
                        continue;
                    }
                    let not_empty = |group: usize| found.get(group).filter(|it| !it.is_empty());
                    let Some(label) = not_empty(2).or_else(|| not_empty(1)) else {
                        continue;
                    };
                    let start = node.span().start;
                    let locs = (
                        cx.document.loc(start + label.start() as u32),
                        cx.document.loc(start + label.end() as u32),
                    );
                    let label = strings::trim_js_whitespace(label.as_bytes());
                    if !self.allow_labels.contains(label) {
                        let index = state.missing.len() as u32;
                        state.by_label.entry(label).or_default().push(index);
                        state.missing.push((Some(label), locs));
                    }
                }
            }
            _ => {
                for index in state.by_label.remove(node.identifier()).unwrap_or_default() {
                    if let Some(missing) = state.missing.get_mut(index as usize) {
                        missing.0 = None;
                    }
                }
            }
        }
        Ok(())
    }
}
