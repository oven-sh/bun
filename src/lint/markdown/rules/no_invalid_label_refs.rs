use crate::prelude::*;

/// Disallow invalid label references
pub struct NoInvalidLabelRefs;

const INVALID_LABEL_REF: &Message = &Message::new(
    "invalidLabelRef",
    "Label reference '{{label}}' is invalid due to white space between [ and ].",
);

static LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/\]\[([^\]]+)\]/u"));
static LABEL_BEFORE: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/!?\[([^\]]+)\]/u"));

impl Rule for NoInvalidLabelRefs {
    const META: Meta = meta("no-invalid-label-refs").recommended();
    listens!();

    fn new(_: &Options) -> Self {
        NoInvalidLabelRefs
    }
}

impl Listens for NoInvalidLabelRefs {
    const LISTENERS: &'static [Listener] = &[Listener::new("text", Kinds::of(&[Kind::Text]))];
    type Seen<'d> = ();

    fn on<'d>(
        &self,
        _: usize,
        node: Node<'d>,
        (): &mut (),
        cx: &mut Context<'d>,
    ) -> Result<(), OutOfRange> {
        let text = node.text();
        if !strings::contains(text, b"][") {
            return Ok(());
        }
        for found in LABEL.find_iter(text) {
            if !util::ILLEGAL_SHORTHAND_TAIL.test(found.as_bytes()) {
                continue;
            }
            let start = node.span().start as usize + found.start();
            let end = start + found.as_bytes().len();
            let document = cx.document.text();
            let Some(open) = strings::last_index_of_char(&document[..start], b'[') else {
                continue;
            };
            let label = LABEL_BEFORE.exec_at(&document[open..end], 0);
            let label = label.map_or(&b""[..], |it| it.bytes(1));
            let locs = (
                cx.document.loc(start as u32 + 1),
                cx.document.loc(end as u32),
            );
            let label = strings::trim_js_whitespace(label);
            cx.report(locs, INVALID_LABEL_REF, &[("label", label)]);
        }
        Ok(())
    }
}
