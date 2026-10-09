use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow the use of an object literal as a default value for a parameter.
pub struct NoObjectAsDefaultParameter;

const IDENTIFIER: Message = Message::new("", "Do not use an object literal as default for parameter `{{param}}`.");
const NON_IDENTIFIER: Message = Message::new("", "Do not use an object literal as default");

impl Rule for NoObjectAsDefaultParameter {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-object-as-default-parameter", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoObjectAsDefaultParameter
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.params(|_, param, cx| {
            let Some(object) = param.default().map(get_inner_expression) else {
                return;
            };
            if !matches!(object.kind(), ExprKind::Object(properties) if !properties.is_empty()) {
                return;
            }
            match param.pat().as_ident() {
                Some(name) => cx.report(object, IDENTIFIER).data("param", name),
                None => cx.report(object, NON_IDENTIFIER),
            };
        });
    }
}
