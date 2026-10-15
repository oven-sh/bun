use bun_lint_oxlint::ast_util::is_specific_id;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid `require()` calls with expressions.
pub struct NoDynamicRequire {
    esmodule: bool,
}

const REQUIRE: Message = Message::new("", "Calls to require() should use string literals");
const IMPORT: Message = Message::new("", "Calls to import() should use string literals");
const OXLINT: Message = Message::new("", "Expected a literal string or immutable template literal");

impl Rule for NoDynamicRequire {
    const META: Meta = Meta::plugin(Plugin::Import, "no-dynamic-require", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::ImportCall, ExprTag::Call]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoDynamicRequire { esmodule: options.object(0).bool_or("esmodule", false) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.esmodule {
            on = on.exprs(&[ExprTag::ImportCall]);
        }
        if file.mentions("require") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        match e.tag() {
            ExprTag::ImportCall => {
                if let ExprKind::ImportCall { args } = e.kind()
                    && let Some(source) = args.first().filter(|it| !is_static_value(*it, is_oxlint))
                {
                    // oxlint points at the argument.
                    match is_oxlint {
                        true => cx.report(source.outer_span(), OXLINT),
                        false => cx.report(e, IMPORT),
                    };
                }
            }
            ExprTag::Call => {
                let Some(call) = e.as_call() else { return };
                // oxlint looks through TypeScript's wrappers.
                let is_require = match is_oxlint {
                    true => is_specific_id(call.callee(), "require"),
                    false => call.callee().is_ident("require"),
                };
                if is_require && call.args().first().is_some_and(|it| !is_static_value(it, is_oxlint)) {
                    // oxlint points at `require`.
                    match is_oxlint {
                        true => cx.report(call.callee().outer_span(), OXLINT),
                        false => cx.report(e, REQUIRE),
                    };
                }
            }
            _ => {}
        }
    }
}

/// upstream's `isStaticValue`. oxlint takes no literal but a string, none in parentheses, and says nothing of `...a`.
fn is_static_value(e: Expr, is_oxlint: bool) -> bool {
    match e.kind() {
        _ if is_oxlint && e.is_parenthesized() => false,
        ExprKind::Spread(_) => is_oxlint,
        ExprKind::String(_) => true,
        ExprKind::Template(template) => template.exprs().is_empty(),
        _ => !is_oxlint && ast_utils::is_literal(e),
    }
}
