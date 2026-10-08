use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::is_configured_global;

/// Disallow non-null assertions in the left operand of a nullish coalescing operator.
pub struct NoNonNullAssertedNullishCoalescing;

const NO_NON_NULL_ASSERTED_NULLISH_COALESCING: Message = Message::new(
    "noNonNullAssertedNullishCoalescing",
    "The nullish coalescing operator is designed to handle undefined and null - using a non-null assertion is not needed.",
);
const SUGGEST_REMOVING_NON_NULL: Message =
    Message::new("suggestRemovingNonNull", "Remove the non-null assertion.");

/// Whether `variable` is given a value by something that ends before `end`.
fn has_assignment_before(variable: Symbol, end: u32) -> bool {
    variable.declarations().any(|declaration| match (declaration, declaration.node()) {
        (Declaration::Var(_), Some(Node::VarDecl(declarator))) => {
            (declarator.is_definite() || declarator.init().is_some()) && declarator.span().end < end
        }
        _ => false,
    }) || variable
        .references()
        .any(|reference| reference.is_write() && reference.span().end < end)
}

impl Rule for NoNonNullAssertedNullishCoalescing {
    const META: Meta = Meta::typescript("no-non-null-asserted-nullish-coalescing", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNonNullAssertedNullishCoalescing
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::NonNull], |_, e, cx| {
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
                    Some(variable) => has_assignment_before(variable, end),
                    // To ESLint it is a variable without definitions.
                    None if is_configured_global(cx.file(), name.bytes()) => {
                        cx.file().unresolved_references().any(|reference| {
                            reference.is_write()
                                && reference.name() == name
                                && reference.span().end < end
                        })
                    }
                    None => true,
                };
                if !has_assignment {
                    return;
                }
            }
            cx.report(e, NO_NON_NULL_ASSERTED_NULLISH_COALESCING)
                .suggest(SUGGEST_REMOVING_NON_NULL, |fixer| fixer.remove(Span::new(end - 1, end)));
        });
    }
}
