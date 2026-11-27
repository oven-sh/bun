use crate::bun::value_of;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{is_global_reference, is_import_symbol};

/// Require a type in `sql.array()`.
pub struct SqlRequireArrayType;

const NO_TYPE: &Message =
    &Message::new("noType", "`sql.array()` without a type isn't cast to `JSON[]` anymore. Pass the element type.");
const USE_JSON: &Message = &Message::new("useJson", "Pass `\"JSON\"`.");

/// `Bun.name`, or `name` imported from `bun`.
fn is_from_bun(e: Expr, name: &str) -> bool {
    match e.as_dot() {
        Some((object, member, _)) => member.name().is(name) && object.is_ident("Bun") && is_global_reference(object),
        None => is_import_symbol(e, "bun", name),
    }
}

fn is_client(e: Expr) -> bool {
    let value = value_of(e);
    is_from_bun(value, "sql")
        || is_from_bun(value, "postgres")
        || value.as_call_or_new().is_some_and(|it| is_from_bun(it.callee(), "SQL"))
}

/// The `tx` of `sql.begin(tx => ..)`.
fn is_transaction(e: Expr) -> bool {
    let Some(Node::Func(callback)) = e.symbol().and_then(|it| it.declarations().next()).and_then(Declaration::node) else {
        return false;
    };
    let call = callback.owner().as_expr().and_then(|it| it.parent().as_expr()).and_then(Expr::as_call);
    (call.and_then(|it| it.callee().as_dot()))
        .is_some_and(|(object, name, _)| name.name().is_any(&["begin", "transaction"]) && is_client(object))
}

impl Rule for SqlRequireArrayType {
    const META: Meta = Meta::plugin(Plugin::Bun, "sql-require-array-type", Kind::Problem).has_suggestions();
    const ON: On = On::new().method_calls(&["array"]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        SqlRequireArrayType
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&["sql", "SQL", "postgres"]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call().filter(|it| it.args().len() == 1)
            && let Some((object, name, _)) = call.callee().as_dot()
            && name.name().is("array")
            && let Some(values) = call.args().first().filter(|it| it.tag() != ExprTag::Spread)
            && (is_client(object) || is_transaction(object))
        {
            cx.report(e, NO_TYPE).suggest(USE_JSON, |fixer| fixer.insert_after(values.outer_span(), ", \"JSON\""));
        }
    }
}
