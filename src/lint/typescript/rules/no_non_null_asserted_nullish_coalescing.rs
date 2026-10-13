use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::is_configured_global;
use rustc_hash::FxHashMap;

/// Disallow non-null assertions in the left operand of a nullish coalescing operator.
pub struct NoNonNullAssertedNullishCoalescing;

const NO_NON_NULL_ASSERTED_NULLISH_COALESCING: Message = Message::new(
    "noNonNullAssertedNullishCoalescing",
    "The nullish coalescing operator is designed to handle undefined and null - using a non-null assertion is not needed.",
);
const SUGGEST_REMOVING_NON_NULL: Message =
    Message::new("suggestRemovingNonNull", "Remove the non-null assertion.");

/// Where the first of what gives a variable a value ends.
#[derive(Default)]
pub struct State<'a> {
    of_variables: FxHashMap<Symbol<'a>, Option<u32>>,
    /// By the name, for the names that nothing in the file declares. `None` until it is asked for.
    of_globals: Option<FxHashMap<Name<'a>, u32>>,
}

/// Whether `variable` is given a value by something that ends before `end`.
fn has_assignment_before<'a>(variable: Symbol<'a>, end: u32, state: &mut State<'a>) -> bool {
    let first = state.of_variables.entry(variable).or_insert_with(|| {
        let declarators = variable.declarations().filter_map(|declaration| match (declaration, declaration.node()) {
            (Declaration::Var(_), Some(Node::VarDecl(declarator))) => {
                (declarator.is_definite() || declarator.init().is_some()).then(|| declarator.span().end)
            }
            _ => None,
        });
        let writes = variable.references().filter(|it| it.is_write()).map(|it| it.span().end);
        declarators.chain(writes).min()
    });
    first.is_some_and(|it| it < end)
}

impl Rule for NoNonNullAssertedNullishCoalescing {
    const META: Meta = Meta::typescript("no-non-null-asserted-nullish-coalescing", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT);
    const ON: On = On::new().exprs(&[ExprTag::NonNull]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoNonNullAssertedNullishCoalescing
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::NonNull(operand) = e.kind() else {
            return;
        };
        let Node::Expr(parent) = e.parent() else {
            return;
        };
        let is_left_of_nullish = matches!(
            parent.kind(),
            ExprKind::Binary { op: BinOp::Nullish, left, .. } if left == e
        );
        // `a?.b! ?? c`: the left operand is the `ChainExpression`.
        if !is_left_of_nullish || e.is_in_optional_chain() {
            return;
        }
        let end = e.span().end;
        if let ExprKind::Ident(name) = operand.kind() {
            let has_assignment = match operand.symbol() {
                Some(variable) => has_assignment_before(variable, end, &mut cx.state),
                // To ESLint it is a variable without definitions.
                None if is_configured_global(cx.file(), name.bytes()) => {
                    let file = cx.file();
                    let first_writes = cx.state.of_globals.get_or_insert_with(|| {
                        let mut first_writes: FxHashMap<Name<'a>, u32> = FxHashMap::default();
                        for reference in file.unresolved_references().filter(|it| it.is_write()) {
                            let first = first_writes.entry(reference.name()).or_insert(u32::MAX);
                            *first = reference.span().end.min(*first);
                        }
                        first_writes
                    });
                    first_writes.get(&name).is_some_and(|it| *it < end)
                }
                None => true,
            };
            if !has_assignment {
                return;
            }
        }
        cx.report(e, NO_NON_NULL_ASSERTED_NULLISH_COALESCING)
            .suggest(SUGGEST_REMOVING_NON_NULL, |fixer| fixer.remove(Span::new(end - 1, end)));
    }
}
