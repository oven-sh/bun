use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule checks the function parameter of hooks & tests for use of the done argument, suggesting you return a promise
/// instead.
pub struct NoDoneCallback;

const NO_DONE_CALLBACK: Message = Message::new("", "Function parameter(s) use the `done` argument");

impl Rule for NoDoneCallback {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-done-callback", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDoneCallback
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx)));
        }
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, NoDoneCallback>) {
    let Some(call_expr) = possible_jest_node.node.as_call() else {
        return;
    };
    let Some(jest_fn_call) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node) else {
        return;
    };
    let is_jest_each = jest::get_node_name(call_expr.callee()).ends_with(b"each");
    let callback_index = match jest_fn_call.kind {
        // Of `.each` only the one with a template is looked at: its callback gets one object before `done`.
        JestFnKind::General(JestGeneralFnKind::Test | JestGeneralFnKind::Hook) if is_jest_each => {
            if call_expr.callee().tag() != ExprTag::TaggedTemplate {
                return;
            }
            1
        }
        JestFnKind::General(JestGeneralFnKind::Hook) => 0,
        JestFnKind::General(JestGeneralFnKind::Test) => 1,
        _ => return,
    };
    if let Some(arg) = call_expr.args().get(callback_index).filter(|it| !it.is_parenthesized())
        && let Some(func) = arg.as_fn()
        && func.params().len() == 1 + usize::from(is_jest_each)
        && let Some(first_parameter) = func.params().first()
    {
        cx.report(first_parameter, NO_DONE_CALLBACK).help(match func.is_async() {
            true => "Use await instead of callback in async functions",
            false => "Return a Promise instead of relying on callback parameter",
        });
    }
}
