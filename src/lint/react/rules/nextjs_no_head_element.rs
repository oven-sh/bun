use crate::nextjs::is_in_app_dir;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the usage of the native `<head>` element inside a Next.js application.
pub struct NoHeadElement;

const NO_HEAD_ELEMENT: Message = Message::new("", "Do not use `<head>` element. Use `<Head />` from `next/head` instead.");

impl Rule for NoHeadElement {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-head-element", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoHeadElement
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("head") || is_in_app_dir(file.path()) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Jsx(jsx) = e.kind()
            && jsx.tag().is_some_and(|it| it.is_ident("head"))
        {
            cx.report(jsx.opening_span(), NO_HEAD_ELEMENT);
        }
    }
}
