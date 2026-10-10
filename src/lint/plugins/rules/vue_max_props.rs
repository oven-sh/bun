use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, static_name};
use crate::oxlint::vue::{
    NamedTypeBudget, exported_object, find_property, first_type_argument, for_each_define_props_type_signature,
    is_vue_file, is_vue_setup, signature_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Enforce a maximum number of props defined for a given Vue component.
pub struct MaxProps {
    max_props: usize,
}

const MAX_PROPS: Message = Message::new("", "This component has too many props ({{cur}}). Maximum allowed is {{limit}}.");

impl Rule for MaxProps {
    const META: Meta = Meta::oxlint(Plugin::Vue, "max-props", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]).stmts(&[StmtTag::ExportDefault]);
    type State<'a> = NamedTypeBudget;

    fn new(options: &Options) -> Self {
        MaxProps { max_props: options.object(0).usize("maxProps").unwrap_or(1) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if !is_vue_setup(file) {
            on = on.stmts(&[StmtTag::ExportDefault]);
        } else if file.mentions("defineProps") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<NamedTypeBudget> {
        if !is_vue_file(file) {
            return None;
        }
        Some(NamedTypeBudget::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) else {
            return;
        };
        let count = match call_expr.args().first() {
            Some(first_arg) => match first_arg.kind() {
                _ if first_arg.is_parenthesized() => return,
                ExprKind::Object(properties) => properties.len(),
                ExprKind::Array(elements) => elements.len(),
                _ => return,
            },
            // `defineProps<A>()`
            None => {
                let mut keys = FxHashSet::default();
                if let Some(first_type_argument) = first_type_argument(call_expr) {
                    for_each_define_props_type_signature(first_type_argument, &cx.state, &mut |signature| {
                        keys.extend(signature_key(signature).and_then(static_name));
                    });
                }
                keys.len()
            }
        };
        self.check(e.span(), count, cx);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let props = exported_object(stmt).and_then(|it| find_property(it, "props")).and_then(Prop::value);
        if let Some(props) = props.map(get_inner_expression)
            && let ExprKind::Object(properties) = props.kind()
        {
            self.check(props.span(), properties.len(), cx);
        }
    }
}

impl MaxProps {
    fn check<'a>(&self, span: Span, cur: usize, cx: &Cx<'a, Self>) {
        if cur > self.max_props {
            cx.report(span, MAX_PROPS).data("cur", cur).data("limit", self.max_props);
        }
    }
}
