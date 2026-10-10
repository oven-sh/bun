use bun_lint_oxlint::ast_util::{plain, static_property_name};
use crate::unicorn::GLOBAL_OBJECT_NAMES;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::collections::hash_map::Entry;

/// Disallows direct use of `document.cookie`.
pub struct NoDocumentCookie;

const NO_DOCUMENT_COOKIE: Message = Message::new("", "Do not use `document.cookie` directly.");

impl Rule for NoDocumentCookie {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-document-cookie", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Assign]);
    /// Whether a variable is `document`.
    type State<'a> = FxHashMap<Symbol<'a>, bool>;

    fn new(_: &Options) -> Self {
        NoDocumentCookie
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("cookie") || !file.mentions("document") {
            return None;
        }
        Some(FxHashMap::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(left) = e.left()
            && static_property_name(left).is_some_and(|it| it.is("cookie"))
            && left.object().is_some_and(|it| is_document_cookie_reference(it, &mut cx.state))
        {
            cx.report(left, NO_DOCUMENT_COOKIE);
        }
    }
}

/// `document`, `window.document`, or a variable that is declared with one of them. `known`: what has been found for the
/// variables on the way, so that `const b = a, c = b ..` is followed once.
fn is_document_cookie_reference<'a>(expr: Expr<'a>, known: &mut FxHashMap<Symbol<'a>, bool>) -> bool {
    let mut on_the_way: SmallVec<[Symbol<'a>; 4]> = SmallVec::new();
    let mut next = plain(expr);
    let is_document = loop {
        let Some(at) = next else {
            break false;
        };
        let Some(name) = at.as_ident() else {
            break static_property_name(at).is_some_and(|it| it.is("document"))
                && at.object().and_then(Expr::as_ident).is_none_or(|it| it.is_any(&GLOBAL_OBJECT_NAMES));
        };
        if name.is("document") {
            break true;
        }
        let Some(variable) = at.symbol() else {
            break false;
        };
        // oxlint does not come back from `var a = b, b = a`: what is on the way is not `document` until it is known.
        match known.entry(variable) {
            Entry::Occupied(entry) => break *entry.get(),
            Entry::Vacant(entry) => {
                entry.insert(false);
                on_the_way.push(variable);
            }
        }
        let Some(Node::VarDecl(var_decl)) = variable.declarations().next().and_then(Declaration::node) else {
            break false;
        };
        next = var_decl.init().and_then(plain);
    };
    known.extend(on_the_way.into_iter().map(|it| (it, is_document)));
    is_document
}
