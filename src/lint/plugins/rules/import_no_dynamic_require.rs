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
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoDynamicRequire { esmodule: options.object(0).bool_or("esmodule", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if self.esmodule {
            on.exprs([ExprTag::ImportCall], |_, e, cx| {
                if let ExprKind::ImportCall { args } = e.kind()
                    && let Some(source) = args.first().filter(|it| !is_static_value(*it))
                {
                    cx.report(source.outer_span(), NO_DYNAMIC_REQUIRE);
                }
            });
        }
        if file.mentions("require") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if let Some(call) = e.as_call()
                    && is_specific_id(call.callee(), "require")
                    && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread && !is_static_value(it))
                {
                    cx.report(call.callee().outer_span(), NO_DYNAMIC_REQUIRE);
                }
            });
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
