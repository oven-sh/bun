use bun_lint::prelude::*;
use bun_lint::types::{IdMap, IdSet};

/// Require rest parameters instead of `arguments`.
pub struct PreferRestParams;

const PREFER_REST_PARAMS: Message = Message::new(
    "preferRestParams",
    "Use the rest parameters instead of 'arguments'.",
);

/// `arguments.length`, as opposed to `arguments` and `arguments[0]`.
fn is_normal_member_access(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent)
        if parent.as_dot().is_some_and(|(obj, ..)| obj == e))
}

/// Keeps the rule linear for an `arguments` with many references.
pub struct State<'a> {
    /// The name `arguments`.
    name: Name<'a>,
    counted: IdSet<Symbol<'a>>,
    /// For an identifier of a `counted` symbol: how many of the symbol's references are that identifier.
    references: IdMap<Expr<'a>, u32>,
}

impl<'a> State<'a> {
    /// Returns how many of the references to `symbol` are `e`. All calls together take time linear in the number of
    /// references.
    fn count(&mut self, symbol: Symbol<'a>, e: Expr<'a>) -> u32 {
        if self.counted.insert(symbol) {
            for identifier in symbol.references().filter_map(Reference::expr) {
                *self.references.get_or_insert_with(identifier, || 0) += 1;
            }
        }
        self.references.get(e).copied().unwrap_or(0)
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
            counted: IdSet::new(),
            references: IdMap::new(),
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
        // oxlint reports every `arguments` that the file doesn't declare, anywhere in a non-arrow function, including a
        // parameter's default value.
        if cx.language().is_oxlint {
            let is_function = |it: Node| matches!(it, Node::Func(func) if !func.is_arrow() && func.kind() != FnKind::StaticBlock);
            let symbol = e.reference().and_then(Reference::symbol);
            if symbol.is_none_or(Symbol::is_implicit_arguments) && Node::Expr(e).ancestors().any(is_function) {
                cx.report(e, PREFER_REST_PARAMS);
            }
            return;
        }
        let Some(symbol) = e.reference().and_then(Reference::symbol) else {
            return;
        };
        // The top level of a CommonJS file has an `arguments` too, which ESLint ignores.
        if !symbol.is_implicit_arguments() || !matches!(symbol.scope().node(), Node::Func(_)) {
            return;
        }
        // An identifier is several references where one expression assigns it several values.
        for _ in 0..cx.state.count(symbol, e) {
            cx.report(e, PREFER_REST_PARAMS);
        }
    }
}
