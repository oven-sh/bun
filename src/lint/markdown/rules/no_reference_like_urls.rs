use crate::prelude::*;

/// Disallow URLs that match defined reference identifiers
pub struct NoReferenceLikeUrls;

const REFERENCE_LIKE_URL: &Message = &Message::new(
    "referenceLikeUrl",
    "Unexpected resource {{type}} ('{{prefix}}[text](url)') with URL that matches a definition identifier. Use '[text][id]' syntax instead.",
);

static LINK_OR_IMAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::literal(
        r#"/\[(?<label>(?:\\.|[^()\\]|\([\s\S]*\))*?)\]\((?<destination>[ \t]*\r?\n?(?<![ \t])[ \t]*(?:<[^>]*>|[^ \t()]+))(?:[ \t]*\r?\n?(?<![ \t])[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*\r?\n?(?<![ \t])[ \t]*\)$/u"#,
    )
});

/// A cheap check before `LINK_OR_IMAGE` runs. Returns the only `destination` that the regex could capture if that's
/// obvious from the text, `Ok(None)` if it isn't, and `Err` if the regex can't match.
fn plain_destination(text: &[u8]) -> Result<Option<&[u8]>, ()> {
    let open = strings::index_of(text, b"](").ok_or(())?;
    let rest = &text[open + 2..];
    let destination = rest.strip_suffix(b")").ok_or(())?;
    let is_plain = strings::index_of_any(destination, b" \t\r\n()<\"'").is_none();
    Ok(is_plain.then_some(destination))
}

#[derive(Default)]
pub(crate) struct Seen<'d> {
    definition_identifiers: FxHashSet<&'d [u8]>,
    relevant_nodes: Vec<Node<'d>>,
}

impl Rule for NoReferenceLikeUrls {
    const META: Meta = meta("no-reference-like-urls")
        .recommended()
        .fixable(Fixable::Code);
    listens!();

    fn new(_: &Options) -> Self {
        NoReferenceLikeUrls
    }
}

impl Listens for NoReferenceLikeUrls {
    const LISTENERS: &'static [Listener] = &[
        Listener::new("definition", Kinds::of(&[Kind::Definition])),
        Listener::new("image, link", Kinds::of(&[Kind::Image, Kind::Link])),
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
        match listener {
            0 => {
                state.definition_identifiers.insert(node.identifier());
            }
            1 => state.relevant_nodes.push(node),
            _ if state.definition_identifiers.is_empty() => {}
            _ => {
                let is_defined = |destination: &[u8]| {
                    let url = bun_format::markdown::identifier_of(destination);
                    state.definition_identifiers.contains(&url[..])
                };
                for &node in &state.relevant_nodes {
                    match plain_destination(node.text()) {
                        Ok(Some(destination)) if is_defined(destination) => {}
                        Ok(None) => {}
                        _ => continue,
                    }
                    let Some(found) = LINK_OR_IMAGE.exec_at(node.text(), 0) else {
                        continue;
                    };
                    let (label, destination) = (found.bytes(1), found.bytes(2));
                    if !is_defined(destination) {
                        continue;
                    }
                    let prefix: &[u8] = match node.kind() {
                        Kind::Image => b"!",
                        _ => b"",
                    };
                    let data = [("type", node.type_name().as_bytes()), ("prefix", prefix)];
                    let report = cx.report_node(node, REFERENCE_LIKE_URL, &data);
                    if node.title().is_none_or(<[u8]>::is_empty) {
                        let reference = [prefix, b"[", label, b"][", destination, b"]"].concat();
                        report.fix(node.span(), reference);
                    }
                }
            }
        }
        Ok(())
    }
}
