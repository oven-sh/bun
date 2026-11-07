use crate::{Document, NodeKind};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require the JSON top-level value to be an array or object
pub struct TopLevelInterop;

const TOP_LEVEL: &Message = &Message::new(
    "topLevel",
    "Top level item should be array or object, got '{{type}}'.",
);

impl Rule for TopLevelInterop {
    const META: Meta =
        Meta::plugin(Plugin::Json, "top-level-interop", Kind::Problem).languages(crate::LANGUAGES);
    const ON: On = On::new().finish();
    type State<'a> = Document<'a>;

    fn new(_: &Options) -> Self {
        TopLevelInterop
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
        Document::of(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let kind = match cx.state.body().map(|it| it.kind()) {
            None | Some(NodeKind::Object | NodeKind::Array) => return,
            Some(NodeKind::String) => "String",
            Some(NodeKind::Number) => "Number",
            Some(NodeKind::Boolean) => "Boolean",
            Some(NodeKind::Null) => "Null",
            Some(NodeKind::Identifier) => "Identifier",
            Some(NodeKind::NaN) => "NaN",
            Some(NodeKind::Infinity) => "Infinity",
        };
        let document = Span::new(0, cx.state.text().len() as u32);
        // ESLint enters the document before its body, which can have the same span.
        cx.report(document, TOP_LEVEL)
            .data("type", kind)
            .listened_on(Span::new(0, u32::MAX));
    }
}
