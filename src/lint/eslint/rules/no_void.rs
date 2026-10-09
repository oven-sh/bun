use bun_lint::prelude::*;

/// Disallow `void` operators.
pub struct NoVoid {
    allows_as_statement: bool,
}

const NO_VOID: Message = Message::new("noVoid", "Expected 'undefined' and instead saw 'void'.");

impl Rule for NoVoid {
    const META: Meta = Meta::eslint("no-void", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoVoid {
            allows_as_statement: options.object(0).bool_or("allowAsStatement", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Unary], |rule, e, cx| {
            if !matches!(e.kind(), ExprKind::Unary { op: UnOp::Void, .. }) {
                return;
            }
            if rule.allows_as_statement
                && matches!(e.parent(), Node::Stmt(parent) if utils::is_expression_statement(parent))
            {
                return;
            }
            let report = cx.report(e, NO_VOID);
            // What oxlint suggests.
            if cx.language().is_oxlint {
                report.fix(|fixer| fixer.replace(e, "undefined"));
            }
        });
    }
}
