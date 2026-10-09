use bun_lint_oxlint::ast_util::is_specific_id;
use crate::oxlint::vue::is_vue_setup;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent declaration style for `defineProps` in Vue.
pub struct DefinePropsDeclaration {
    is_runtime: bool,
}

const USE_RUNTIME_DECLARATION: Message = Message::new("", "Use runtime declaration instead of type-based declaration");
const USE_TYPE_BASED_DECLARATION: Message = Message::new("", "Use type-based declaration instead of runtime declaration");

impl Rule for DefinePropsDeclaration {
    const META: Meta = Meta::oxlint(Plugin::Vue, "define-props-declaration", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        DefinePropsDeclaration { is_runtime: options.str(0) == Some("runtime") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !is_vue_setup(file) || file.is_javascript() || !file.mentions("defineProps") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(call_expr) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) else {
                return;
            };
            if rule.is_runtime && call_expr.type_args().angle_brackets_span().is_some() {
                cx.report(e, USE_RUNTIME_DECLARATION);
            } else if !rule.is_runtime && !call_expr.args().is_empty() {
                cx.report(e, USE_TYPE_BASED_DECLARATION);
            }
        });
    }
}
