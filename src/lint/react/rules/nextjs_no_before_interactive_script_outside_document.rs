use crate::jsx::{as_jsx_element, get_string_literal_prop_value, has_jsx_prop};
use crate::nextjs::{get_next_script_import_local_name, is_document_page, is_in_app_dir};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cell::OnceCell;

/// Prevent the usage of `next/script`'s `beforeInteractive` strategy outside of `pages/_document.js`.
pub struct NoBeforeInteractiveScriptOutsideDocument;

const NO_BEFORE_INTERACTIVE_SCRIPT_OUTSIDE_DOCUMENT: Message =
    Message::new("", "next/script's `beforeInteractive` strategy should not be used outside of `pages/_document.js`");

impl Rule for NoBeforeInteractiveScriptOutsideDocument {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-before-interactive-script-outside-document", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    /// `get_next_script_import_local_name`
    type State<'a> = OnceCell<Option<Name<'a>>>;

    fn new(_: &Options) -> Self {
        NoBeforeInteractiveScriptOutsideDocument
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("beforeInteractive")
            || !file.mentions("next/script")
            || is_in_app_dir(file.path())
            || is_document_page(file.path())
        {
            return None;
        }
        Some(OnceCell::new())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx) = as_jsx_element(e) else {
            return;
        };
        let (Some(tag_name), Some(strategy)) = (jsx.tag().and_then(Expr::as_ident), has_jsx_prop(jsx, "strategy")) else {
            return;
        };
        if get_string_literal_prop_value(strategy).is_some_and(|it| it == b"beforeInteractive")
            && *cx.state.get_or_init(|| get_next_script_import_local_name(cx.file())) == Some(tag_name)
        {
            cx.report(strategy, NO_BEFORE_INTERACTIVE_SCRIPT_OUTSIDE_DOCUMENT);
        }
    }
}
