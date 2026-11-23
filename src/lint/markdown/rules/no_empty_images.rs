use crate::prelude::*;

/// Disallow empty images
pub struct NoEmptyImages;

const EMPTY_IMAGE: &Message = &Message::new("emptyImage", "Unexpected empty image found.");

impl Rule for NoEmptyImages {
    const META: Meta = meta("no-empty-images").recommended();
    listens!();

    fn new(_: &Options) -> Self {
        NoEmptyImages
    }
}

impl Listens for NoEmptyImages {
    const LISTENERS: &'static [Listener] = &[Listener::new("image", Kinds::of(&[Kind::Image]))];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        _: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        if matches!(node.url(), b"" | b"#") {
            cx.report_node(node, EMPTY_IMAGE, &[]);
        }
        Ok(())
    }
}
