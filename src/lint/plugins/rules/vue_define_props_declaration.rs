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
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        DefinePropsDeclaration { is_runtime: options.str(0) == Some("runtime") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_setup(file) || file.is_javascript() || !file.mentions("defineProps") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) else {
            return;
        };
        if self.is_runtime && call_expr.type_args().angle_brackets_span().is_some() {
            cx.report(e, USE_RUNTIME_DECLARATION);
        } else if !self.is_runtime && !call_expr.args().is_empty() {
            cx.report(e, USE_TYPE_BASED_DECLARATION);
        }
    }
}
