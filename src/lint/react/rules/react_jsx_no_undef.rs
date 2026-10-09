use bun_lint_oxlint::ast_util::is_enabled_global;
use crate::react::is_jsx;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow undeclared variables in JSX.
pub struct JsxNoUndef;

const JSX_NO_UNDEF: Message = Message::new("", "'{{ident_name}}' is not defined.");

impl Rule for JsxNoUndef {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-undef", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        JsxNoUndef
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_jsx(file) {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            if let Some(ident) = jsx.tag().and_then(get_resolvable_ident)
                && let Some(name) = ident.as_ident()
                && ident.symbol().is_none()
                && !is_enabled_global(cx.file(), name.bytes())
            {
                cx.report(ident, JSX_NO_UNDEF).data("ident_name", name);
            }
        });
    }
}

/// The variable that the name of an element refers to: the `A` of `<A>` and the `a` of `<a.b.c>`. `<a>` is the name of
/// an element of HTML.
fn get_resolvable_ident(name: Expr<'_>) -> Option<Expr<'_>> {
    match name.kind() {
        ExprKind::Ident(ident) => {
            ident.bytes().first().is_some_and(|first| !first.is_ascii_lowercase()).then_some(name)
        }
        ExprKind::Dot { .. } => {
            let mut at = name;
            while let Some(object) = at.object() {
                at = object;
            }
            (at.tag() == ExprTag::Ident).then_some(at)
        }
        _ => None,
    }
}

