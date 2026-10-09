use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{is_global_reference, is_import_from_module, is_import_symbol};

/// Disallow drawing random values inside the predicate of a property of fast-check.
///
/// See `fc.property()`, `fc.asyncProperty()` and `fc.sample()` in the documentation of fast-check.
pub struct NoUnseededRandomInPropertyTest;

const SAMPLE: Message = Message::new(
    "sample",
    "What `sample()` draws here does not come from the seed of the run: a failure cannot be replayed or shrunk. Make it a parameter of the property.",
);
const RANDOM: Message = Message::new(
    "random",
    "`Math.random()` does not come from the seed of the run: a failure cannot be replayed or shrunk. Make the value a parameter of the property.",
);

const FAST_CHECK: &str = "fast-check";

/// Whether `callee` is one of the functions `names` of fast-check: `fc.sample`, or `sample` where that is imported.
fn is_of_fast_check(callee: Expr, names: &[&str]) -> bool {
    match callee.kind() {
        ExprKind::Dot { obj, name, .. } => name.name().is_any(names) && is_import_from_module(obj, FAST_CHECK),
        ExprKind::Ident(_) => names.iter().any(|it| is_import_symbol(callee, FAST_CHECK, it)),
        _ => false,
    }
}

/// Whether `func` is what `fc.property()` or `fc.asyncProperty()` gets last.
fn is_predicate(func: Func) -> bool {
    let Node::Expr(e) = func.owner() else {
        return false;
    };
    e.parent().as_expr().and_then(Expr::as_call).is_some_and(|call| {
        call.args().last() == Some(e) && is_of_fast_check(call.callee(), &["property", "asyncProperty"])
    })
}

impl Rule for NoUnseededRandomInPropertyTest {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-unseeded-random-in-property-test", Kind::Problem);
    /// What is known to be in a predicate.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        NoUnseededRandomInPropertyTest
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.mentions(FAST_CHECK) {
            return AncestorMemo::default();
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(callee) = e.callee() else {
                return;
            };
            let message = match callee.kind() {
                ExprKind::Dot { obj, name, .. } if name.name().is("random") && obj.is_ident("Math") => {
                    is_global_reference(obj).then_some(RANDOM)
                }
                _ => is_of_fast_check(callee, &["sample"]).then_some(SAMPLE),
            };
            let in_predicate = |_, parent| matches!(parent, Node::Func(func) if is_predicate(func)).then_some(());
            if let Some(message) = message
                && cx.state.find(Node::Expr(e), in_predicate).is_some()
            {
                cx.report(e, message);
            }
        });
        AncestorMemo::default()
    }
}
