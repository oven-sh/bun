use crate::jsx::has_jsx_prop;
use bun_lint_oxlint::text::file_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent usage of styled-jsx in `pages/_document.js`.
pub struct NoStyledJsxInDocument;

const NO_STYLED_JSX_IN_DOCUMENT: Message = Message::new("", "`styled-jsx` should not be used in `pages/_document.js`");

impl Rule for NoStyledJsxInDocument {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-styled-jsx-in-document", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoStyledJsxInDocument
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file_name(file.path()).starts_with(b"_document.").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Jsx(jsx) = e.kind()
            && jsx.tag().is_some_and(|it| it.is_ident("style"))
            && has_jsx_prop(jsx, "jsx").is_some()
        {
            cx.report(jsx.opening_span(), NO_STYLED_JSX_IN_DOCUMENT);
        }
    }
}
