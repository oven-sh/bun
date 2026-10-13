use bun_lint::prelude::*;

/// Disallow the use of the `__proto__` property.
pub struct NoProto;

const UNEXPECTED_PROTO: Message =
    Message::new("unexpectedProto", "The '__proto__' property is deprecated.");

impl Rule for NoProto {
    const META: Meta = Meta::eslint("no-proto", Kind::Suggestion);
    const ON: On = On::new().members_named(&["__proto__"]).exprs(&[ExprTag::Index]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProto
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("__proto__").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_proto = match (e.member_name(), e.index()) {
            (Some(name), _) => name.name().is("__proto__") && ast_utils::is_member_expression(e),
            (None, Some(index)) => match index.kind() {
                ExprKind::String(value) => value.is("__proto__"),
                ExprKind::Template(template) => template.as_static().is_some_and(|it| it.is("__proto__")),
                _ => false,
            },
            (None, None) => false,
        };
        if is_proto {
            cx.report(e, UNEXPECTED_PROTO);
        }
    }
}
