use bun_lint_oxlint::ast_util::is_specific_id;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid imports that use an expression for the module argument.
pub struct NoDynamicRequire {
    esmodule: bool,
}

const NO_DYNAMIC_REQUIRE: Message = Message::new("", "Expected a literal string or immutable template literal");

impl Rule for NoDynamicRequire {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-dynamic-require", Kind::Suggestion);
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
        match e.tag() {
            ExprTag::ImportCall => {
                if let ExprKind::ImportCall { args } = e.kind()
                    && let Some(source) = args.first().filter(|it| !is_static_value(*it))
                {
                    cx.report(source.outer_span(), NO_DYNAMIC_REQUIRE);
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call()
                    && is_specific_id(call.callee(), "require")
                    && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread && !is_static_value(it))
                {
                    cx.report(call.callee().outer_span(), NO_DYNAMIC_REQUIRE);
                }
            }
            _ => {}
        }
    }
}

fn is_static_value(e: Expr) -> bool {
    !e.is_parenthesized()
        && match e.kind() {
            ExprKind::String(_) => true,
            ExprKind::Template(template) => template.exprs().is_empty(),
            _ => false,
        }
}
