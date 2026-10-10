use bun_lint_oxlint::ast_util::static_name;
use crate::react::is_create_element_call;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks that children are not passed using a prop.
pub struct NoChildrenProp;

const NO_CHILDREN_PROP: Message = Message::new("", "Avoid passing children using a prop.");

impl Rule for NoChildrenProp {
    const META: Meta = Meta::oxlint(Plugin::React, "no-children-prop", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoChildrenProp
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("children") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                let ExprKind::Jsx(jsx) = e.kind() else {
                    return;
                };
                for key in jsx.attrs().iter().filter_map(Prop::key).filter(|key| key.is("children")) {
                    cx.report(key.span(cx.file()), NO_CHILDREN_PROP);
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call()
                    && is_create_element_call(call)
                    && let Some(ExprKind::Object(properties)) =
                        call.args().get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
                    && let Some(key) = properties
                        .iter()
                        .filter_map(Prop::key)
                        .find(|key| static_name(*key).is_some_and(|it| it.is("children")))
                {
                    cx.report(key.inner_span(cx.file()), NO_CHILDREN_PROP);
                }
            }
            _ => {}
        }
    }
}
