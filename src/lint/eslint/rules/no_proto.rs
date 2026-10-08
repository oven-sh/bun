use bun_lint::prelude::*;

/// Disallow the use of the `__proto__` property.
pub struct NoProto;

const UNEXPECTED_PROTO: Message =
    Message::new("unexpectedProto", "The '__proto__' property is deprecated.");

impl Rule for NoProto {
    const META: Meta = Meta::eslint("no-proto", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProto
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Dot, ExprTag::Index], |_, e, cx| {
            let is_proto = match e.kind() {
                ExprKind::Dot { name, .. } => name.name().is("__proto__") && ast_utils::is_member_expression(e),
                ExprKind::Index { index, .. } => match index.kind() {
                    ExprKind::String(value) => value.is("__proto__"),
                    ExprKind::Template(template) => template.as_static().is_some_and(|it| it.is("__proto__")),
                    _ => false,
                },
                _ => false,
            };
            if is_proto {
                cx.report(e, UNEXPECTED_PROTO);
            }
        });
    }
}
