use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_import_from_module, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents the usage of `React.cloneElement`, which is considered an anti-pattern in React.
pub struct NoCloneElement;

const NO_CLONE_ELEMENT: Message = Message::new("", "`React.cloneElement` should not be used.");

impl Rule for NoCloneElement {
    const META: Meta = Meta::oxlint(Plugin::React, "no-clone-element", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCloneElement
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("cloneElement") || !file.has_stmts([StmtTag::Import]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(callee) = e.callee() else {
                return;
            };
            // `import { cloneElement } from 'react'; cloneElement(..)`
            let ident = get_inner_expression(callee);
            if ident.is_ident("cloneElement") && is_import_from_module(ident, "react") {
                cx.report(ident, NO_CLONE_ELEMENT);
                return;
            }
            // `import React from 'react'; React.cloneElement(..)`
            if let Some(member) = get_member_expr(callee)
                && static_property_name(member).is_some_and(|name| name.is("cloneElement"))
                && member.object().is_some_and(|it| !it.is_parenthesized() && is_import_from_module(it, "react"))
            {
                cx.report(callee.outer_span(), NO_CLONE_ELEMENT);
            }
        });
    }
}
