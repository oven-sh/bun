use bun_lint::prelude::*;

/// Disallow use of chained assignment expressions.
pub struct NoMultiAssign {
    ignore_non_declaration: bool,
}

const UNEXPECTED_CHAIN: Message = Message::new("unexpectedChain", "Unexpected chained assignment.");

impl NoMultiAssign {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_chained = match e.parent() {
            Node::VarDecl(declaration) => declaration.init() == Some(e),
            Node::Member(member) => {
                member.init() == Some(e) && !member.flags().contains(Flags::ACCESSOR)
            }
            Node::Expr(parent) if !self.ignore_non_declaration => {
                matches!(parent.kind(), ExprKind::Assign { value, .. } if value == e)
                    // A default value in a destructuring assignment.
                    && !utils::is_assignment_target(parent)
            }
            _ => false,
        };
        if is_chained {
            cx.report(e, UNEXPECTED_CHAIN);
        }
    }
}

impl Rule for NoMultiAssign {
    const META: Meta = Meta::eslint("no-multi-assign", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoMultiAssign {
            ignore_non_declaration: options.object(0).bool_or("ignoreNonDeclaration", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Assign], Self::check);
    }
}
