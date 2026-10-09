use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, parent_node};
use crate::oxlint::vue::{EnclosingDeclarators, enclosing_variable_declarator, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces a consistent style for handling Vue 3 Composition API props, allowing you to choose between requiring
/// destructuring or prohibiting it.
pub struct DefinePropsDestructuring(Destructure);

#[derive(Copy, Clone, PartialEq, Eq)]
enum Destructure {
    OnlyWhenAssigned,
    Always,
    Never,
}

const PREFER_DESTRUCTURING: Message = Message::new("", "Prefer destructuring from `defineProps` directly.");
const AVOID_DESTRUCTURING: Message = Message::new("", "Avoid destructuring from `defineProps`.");
const AVOID_WITH_DEFAULTS: Message = Message::new("", "Avoid using `withDefaults` with destructuring.");

impl Rule for DefinePropsDestructuring {
    const META: Meta = Meta::oxlint(Plugin::Vue, "define-props-destructuring", Kind::Suggestion);
    type State<'a> = EnclosingDeclarators<'a>;

    fn new(options: &Options) -> Self {
        DefinePropsDestructuring(match options.object(0).str("destructure") {
            Some("always") => Destructure::Always,
            Some("never") => Destructure::Never,
            _ => Destructure::OnlyWhenAssigned,
        })
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_vue_setup(file) || !file.mentions("defineProps") {
            return EnclosingDeclarators::default();
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(call_expr) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) else {
                return;
            };
            if call_expr.args().is_empty() && call_expr.type_args().angle_brackets_span().is_none() {
                return;
            }
            let parent_variable_declarator = enclosing_variable_declarator(e, &mut cx.state);
            let has_destructuring = parent_variable_declarator.is_some_and(|it| it.pat().tag() == PatTag::Object);
            // `withDefaults(defineProps(..), ..)`
            let parent_call = parent_node(e).and_then(Node::as_expr).and_then(Expr::as_call);
            let with_defaults = parent_call.map(|it| get_inner_expression(it.callee()));
            if rule.0 == Destructure::Never {
                if has_destructuring {
                    cx.report(e, AVOID_DESTRUCTURING);
                }
            } else if !has_destructuring && (rule.0 == Destructure::Always || parent_variable_declarator.is_some()) {
                cx.report(e, PREFER_DESTRUCTURING);
            } else if let Some(with_defaults) = with_defaults.filter(|it| it.is_ident("withDefaults")) {
                cx.report(with_defaults, AVOID_WITH_DEFAULTS);
            }
        });
        EnclosingDeclarators::default()
    }
}
