use bun_lint_oxlint::ast_util::{get_declaration_of_variable, get_inner_expression, get_member_expr, is_method_call};
use bun_lint_oxlint::regex_flags::is_regexp_callee;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows using reference values as `Array#fill()` values.
pub struct NoArrayFillWithReferenceType;

const NO_REFERENCE_FILL_VALUE: Message = Message::new("", "Do not use a reference value as the fill value.");

fn is_reference_expression(fill_value: Expr) -> bool {
    match get_inner_expression(fill_value).kind() {
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Class(_) => true,
        ExprKind::New(new) => !is_regexp_callee(get_inner_expression(new.callee())),
        _ => false,
    }
}

/// What the `const` that `fill_value` refers to is initialized with.
fn get_const_variable_initializer(fill_value: Expr<'_>) -> Option<Expr<'_>> {
    let Declaration::Var(pat) = get_declaration_of_variable(get_inner_expression(fill_value))? else {
        return None;
    };
    let Node::VarDecl(declarator) = pat.parent() else {
        return None;
    };
    declarator.init().filter(|_| declarator.var_kind() == VarKind::Const)
}

impl Rule for NoArrayFillWithReferenceType {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-fill-with-reference-type", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayFillWithReferenceType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("fill") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| !it.is_optional()) else {
                return;
            };
            if !is_method_call(call, None, Some(&["fill"]), Some(1), None)
                || get_member_expr(call.callee()).is_none_or(Expr::is_optional)
            {
                return;
            }
            let Some(fill_value) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
                return;
            };
            if is_reference_expression(fill_value)
                || get_const_variable_initializer(fill_value).is_some_and(is_reference_expression)
            {
                cx.report(fill_value.outer_span(), NO_REFERENCE_FILL_VALUE);
            }
        });
    }
}
