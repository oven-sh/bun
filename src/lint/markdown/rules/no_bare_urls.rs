use crate::prelude::*;

/// Disallow bare URLs
pub struct NoBareUrls;

const BARE_URL: &Message = &Message::new(
    "bareUrl",
    "Unexpected bare URL. Use autolink (<URL>) or link ([text](URL)) instead.",
);

static HTML_TAG_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r"/^<(?<tagName>[^!>][^/\s>]*)/u"));

#[derive(Default)]
pub(crate) struct Seen<'d> {
    link_nodes: Vec<Node<'d>>,
    /// The links after an opening tag that hasn't been closed yet.
    temp_link_nodes: Vec<Node<'d>>,
    last_tag_name: Option<Vec<u8>>,
}

impl Rule for NoBareUrls {
    const META: Meta = meta_for_gfm("no-bare-urls").fixable(Fixable::Code);
    listens!();

    fn new(_: &Options) -> Self {
        NoBareUrls
    }
}

impl Listens for NoBareUrls {
    const LISTENERS: &'static [Listener] = &[
        Listener::new(
            ":matches(heading, paragraph, tableCell) html",
            Kinds::of(&[Kind::Html]),
        )
        .within(Within::NodeWithText),
        Listener::new(
            ":matches(heading, paragraph, tableCell) link",
            Kinds::of(&[Kind::Link]),
        )
        .within(Within::NodeWithText),
        Listener::new("heading:exit", Kinds::of(&[Kind::Heading])),
        Listener::new("paragraph:exit", Kinds::of(&[Kind::Paragraph])),
        Listener::new("tableCell:exit", Kinds::of(&[Kind::TableCell])),
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
                let Some(tag) = HTML_TAG_NAME.exec_at(node.value().unwrap_or_default(), 0) else {
                    return Ok(());
                };
                let name = to_lower_case(tag.bytes(1));
                match (name.strip_prefix(b"/"), &state.last_tag_name) {
                    (None, None) => state.last_tag_name = Some(name.into_owned()),
                    (Some(closed), Some(last)) if closed == &last[..] => {
                        state.temp_link_nodes.clear();
                        state.last_tag_name = None;
                    }
                    _ => {}
                }
            }
            1 => match state.last_tag_name {
                Some(_) => state.temp_link_nodes.push(node),
                None => state.link_nodes.push(node),
            },
            2..=4 => {
                state.link_nodes.append(&mut state.temp_link_nodes);
                state.last_tag_name = None;
            }
            _ => {
                for &link in &state.link_nodes {
                    let (text, url) = (link.text(), link.url());
                    let is_bare = url == text
                        || url.strip_prefix(b"http://") == Some(text)
                        || url.strip_prefix(b"mailto:") == Some(text);
                    if is_bare {
                        cx.report_node(link, BARE_URL, &[])
                            .fix(link.span(), [b"<", text, b">"].concat());
                    }
                }
            }
        }
        Ok(())
    }
}
