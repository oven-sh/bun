use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};

/// Require rest parameters instead of `arguments`.
pub struct PreferRestParams;

const PREFER_REST_PARAMS: Message = Message::new(
    "preferRestParams",
    "Use the rest parameters instead of 'arguments'.",
);

/// `arguments.length`, as opposed to `arguments` and `arguments[0]`.
fn is_normal_member_access(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent)
        if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == e))
}

/// For the `arguments` that are referred to many times.
#[derive(Default)]
pub struct State<'a> {
    counted: FxHashSet<Symbol<'a>>,
    /// How many of the references to what is `counted` an identifier is.
    references: FxHashMap<Expr<'a>, u32>,
}

impl<'a> State<'a> {
    /// How many of the references to `symbol` are `e`. In total it takes time in proportion to the
    /// number of references.
    fn count(&mut self, symbol: Symbol<'a>, e: Expr<'a>) -> u32 {
        if symbol.references().len() <= 8 {
            return symbol.references().filter(|it| it.expr() == Some(e)).count() as u32;
        }
        if self.counted.insert(symbol) {
            for identifier in symbol.references().filter_map(Reference::expr) {
                *self.references.entry(identifier).or_default() += 1;
            }
        }
        self.references.get(&e).copied().unwrap_or(0)
    }
}

impl Rule for PreferRestParams {
    const META: Meta = Meta::eslint("prefer-rest-params", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        PreferRestParams
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if !file.mentions("arguments") {
            return State::default();
        }
        on.exprs([ExprTag::Ident], |_, e, cx| {
            if !e.is_ident("arguments") || is_normal_member_access(e) {
                return;
            }
            let Some(symbol) = e.reference().and_then(Reference::symbol) else {
                return;
            };
            // The top level of a CommonJS file has an `arguments` too, which ESLint does not look at.
            if !symbol.is_implicit_arguments() || !matches!(symbol.scope().node(), Node::Func(_)) {
                return;
            }
            // It is several references where it is given several values at once.
            for _ in 0..cx.state.count(symbol, e) {
                cx.report(e, PREFER_REST_PARAMS);
            }
        });
        State::default()
    }
}
