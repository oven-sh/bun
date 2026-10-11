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
pub struct State<'a> {
    /// `arguments`
    name: Name<'a>,
    counted: FxHashSet<Symbol<'a>>,
    /// How many of the references to what is `counted` an identifier is.
    references: FxHashMap<Expr<'a>, u32>,
}

impl<'a> State<'a> {
    /// How many of the references to `symbol` are `e`. In total it takes time in proportion to the
    /// number of references.
    fn count(&mut self, symbol: Symbol<'a>, e: Expr<'a>) -> u32 {
        if self.counted.insert(symbol) {
            for identifier in symbol.references().filter_map(Reference::expr) {
                *self.references.entry(identifier).or_default() += 1;
            }
        }
        self.references.get(&e).copied().unwrap_or(0)
    }
}

impl Rule for PreferRestParams {
    const META: Meta = Meta::eslint("prefer-rest-params", Kind::Suggestion).reports_on_exit();
    const ON: On = On::new().exprs(&[ExprTag::Ident]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        PreferRestParams
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !file.mentions("arguments") {
            return None;
        }
        Some(State {
            name: file.name_of("arguments"),
            counted: FxHashSet::default(),
            references: FxHashMap::default(),
        })
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if e.as_ident() == Some(cx.state.name) {
            Self::check(e, cx);
        }
    }
}

impl PreferRestParams {
    #[inline(never)]
    fn check<'a>(e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if is_normal_member_access(e) {
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
    }
}
