use bun_lint_oxlint::ast_util::{get_declaration_of_variable, get_inner_expression, get_member_expr, is_computed, is_method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `Set#size` over `Set#length` when the `Set` is converted to an array.
pub struct PreferSetSize;

const PREFER_SET_SIZE: Message =
    Message::new("", "Use `Set#size` instead of converting a `Set` to an array and using its `length` property.");

impl Rule for PreferSetSize {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-set-size", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSetSize
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Set") || !file.mentions("length") {
            return;
        }
        on.exprs([ExprTag::Dot], |_, member, cx| {
            let ExprKind::Dot { obj, name, chain } = member.kind() else {
                return;
            };
            if !name.name().is("length") || chain == Chain::Start || member.is_jsx_tag_name() || member.is_in_type_query() {
                return;
            }
            let Some(maybe_set) = get_set_node(obj).filter(|it| is_set(get_inner_expression(*it))) else {
                return;
            };
            let (conversion, set) = (obj.span(), maybe_set.outer_span());
            let report = cx.report(name, PREFER_SET_SIZE);
            if cx.file().comments_in(conversion).len() <= cx.file().comments_in(set).len() {
                report.fix(|fixer| [fixer.replace(conversion, fixer.file().slice(set)), fixer.replace(name, "size")]);
            }
        });
    }
}

/// The `set` of `[...set]` and of `Array.from(set)`.
fn get_set_node(expression: Expr<'_>) -> Option<Expr<'_>> {
    match expression.kind() {
        ExprKind::Array(elements) if elements.len() == 1 => match elements.first()?.kind() {
            ExprKind::Spread(argument) => Some(argument),
            _ => None,
        },
        ExprKind::Call(call) if is_array_from_call(call) => call.args().first().filter(|it| it.tag() != ExprTag::Spread),
        _ => None,
    }
}

fn is_array_from_call(call: Call) -> bool {
    !call.is_optional()
        && get_member_expr(call.callee()).is_some_and(|callee| !callee.is_optional() && !is_computed(callee))
        && is_method_call(call, Some(&["Array"]), Some(&["from"]), Some(1), Some(1))
}

fn is_set(maybe_set: Expr) -> bool {
    if maybe_set.tag() == ExprTag::New {
        return is_new_set(maybe_set);
    }
    let Some(Declaration::Var(pat)) = get_declaration_of_variable(maybe_set) else {
        return false;
    };
    let Node::VarDecl(declarator) = pat.parent() else {
        return false;
    };
    declarator.var_kind() == VarKind::Const && declarator.init().is_some_and(|init| !init.is_parenthesized() && is_new_set(init))
}

fn is_new_set(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::New(new) if new.callee().is_ident("Set") && !new.callee().is_parenthesized())
}
