use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Limit the depth of nested calls.
pub struct MaxNestedCalls {
    max: u32,
}

const MAX_NESTED_CALLS: Message = Message::new("", "Call is nested too deeply. Maximum allowed is {{max}}.");

#[derive(Default)]
pub struct State<'a> {
    /// The call that something is in an argument of. `None`: a function, a class or JSX comes first.
    enclosing_calls: AncestorMemo<'a, Option<Expr<'a>>>,
}

impl Rule for MaxNestedCalls {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "max-nested-calls", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        MaxNestedCalls { max: options.object(0).number("max").map_or(3, |it| it as u32) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.exprs([ExprTag::Call, ExprTag::New], |rule, e, cx| {
            // No further than it takes to know.
            let (mut depth, mut at) = (1, e);
            while depth <= rule.max
                && let Some(Some(call)) = cx.state.enclosing_calls.find(Node::Expr(at), enclosing_call)
            {
                depth += 1;
                at = call;
            }
            if depth > rule.max {
                cx.report(e, MAX_NESTED_CALLS).data("max", rule.max.to_string());
            }
        });
        State::default()
    }
}

fn enclosing_call<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Option<Expr<'a>>> {
    match parent {
        // Calls inside a new scope are counted independently.
        Node::Func(_) | Node::Class(_) => Some(None),
        Node::Expr(e) => match e.tag() {
            ExprTag::Jsx => Some(None),
            ExprTag::Call | ExprTag::New if e.callee().map(Node::Expr) != Some(child) => Some(Some(e)),
            _ => None,
        },
        _ => None,
    }
}
