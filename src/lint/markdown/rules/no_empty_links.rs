use crate::prelude::*;

/// Disallow empty links
pub struct NoEmptyLinks;

const EMPTY_LINK: &Message = &Message::new("emptyLink", "Unexpected empty link found.");

impl Rule for NoEmptyLinks {
    const META: Meta = meta("no-empty-links").recommended();
    listens!();

    fn new(_: &Options) -> Self {
        NoEmptyLinks
    }
}

impl Listens for NoEmptyLinks {
    const LISTENERS: &'static [Listener] = &[Listener::new("link", Kinds::of(&[Kind::Link]))];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        _: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        if matches!(node.url(), b"" | b"#") {
            cx.report_node(node, EMPTY_LINK, &[]);
        }
        Ok(())
    }
}
