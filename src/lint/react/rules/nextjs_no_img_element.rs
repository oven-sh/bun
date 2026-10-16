use crate::jsx::{get_jsx_attribute_name, get_prop_value};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent the usage of the `<img>` element due to slower LCP and higher bandwidth.
pub struct NoImgElement;

const NO_IMG_ELEMENT: Message = Message::new("", "Using `<img>` could result in slower LCP and higher bandwidth.");

impl Rule for NoImgElement {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-img-element", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImgElement
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("img").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(name) = jsx.tag().filter(|it| it.is_ident("img")) else {
            return;
        };
        let is_child_of_picture = e.jsx_container_span().is_none()
            && matches!(e.parent().as_expr().map(Expr::kind),
                Some(ExprKind::Jsx(parent)) if parent.tag().is_some_and(|it| it.is_ident("picture")));
        if !is_child_of_picture {
            let report = cx.report(name, NO_IMG_ELEMENT).first_label("Use `<Image />` from `next/image` instead.");
            report.labels_with(|labels| {
                let src = jsx.attrs().iter().find_map(|it| {
                    let literal = get_prop_value(it)?.as_string_literal()?;
                    (get_jsx_attribute_name(it)? == b"src").then_some(literal.span)
                });
                if let Some(src) = src {
                    labels.push(src, "Use a static image import instead.");
                }
            });
        }
    }
}
