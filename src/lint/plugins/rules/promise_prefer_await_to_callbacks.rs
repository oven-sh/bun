use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prefer `async`/`await` over callback functions for handling asynchronous code.
pub struct PreferAwaitToCallbacks;

const PREFER_AWAIT_TO_CALLBACKS: Message = Message::new("", "Prefer `async`/`await` to the callback pattern");

const ARRAY_METHODS: [&str; 6] = ["map", "every", "forEach", "some", "find", "filter"];

impl Rule for PreferAwaitToCallbacks {
    const META: Meta = Meta::oxlint(Plugin::Promise, "prefer-await-to-callbacks", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]).funcs();
    /// Whether something is in a `yield` or an `await`.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        PreferAwaitToCallbacks
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        let mentions_callback = file.mentions_any(&["callback", "cb"]);
        if mentions_callback || file.mentions_any(&["err", "error"]) {
            on = on.exprs(&[ExprTag::Call]);
        }
        if mentions_callback {
            on = on.funcs();
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let callee = call.callee();
        let callee_name = get_inner_expression(callee).as_ident();
        if callee_name.is_some_and(|name| name.is_any(&["callback", "cb"])) {
            cx.report(e, PREFER_AWAIT_TO_CALLBACKS);
            return;
        }
        let Some(last_arg) = call.args().last().filter(|it| !it.is_parenthesized()) else {
            return;
        };
        let Some(first_param) = last_arg.as_fn().and_then(|it| it.params().first()).filter(|it| !it.is_rest()) else {
            return;
        };
        if !first_param.pat().as_ident().is_some_and(|name| name.is_any(&["err", "error"])) {
            return;
        }
        let member = Some(callee).filter(|it| !it.is_parenthesized());
        let callee_property_name = member.and_then(static_property_name);
        if callee_property_name.is_some_and(|name| name.is_any(&["on", "once", "addEventListener", "removeEventListener"])) {
            return;
        }
        let is_lodash = member.and_then(Expr::object).is_some_and(|object| {
            object.as_ident().is_some_and(|name| name.is_any(&["_", "lodash", "underscore"])) && !object.is_parenthesized()
        });
        let arguments = call.args().len();
        let calls_array_method =
            callee_property_name.is_some_and(|name| name.is_any(&ARRAY_METHODS)) && (arguments == 1 || arguments == 2 && is_lodash);
        let is_array_method = callee_name.is_some_and(|name| name.is_any(&ARRAY_METHODS)) && arguments == 2;
        if calls_array_method || is_array_method {
            return;
        }
        let is_yield_or_await = |_, ancestor: Node<'a>| {
            matches!(ancestor, Node::Expr(it) if matches!(it.tag(), ExprTag::Yield | ExprTag::Await)).then_some(())
        };
        if cx.state.find(Node::Expr(e), is_yield_or_await).is_none() {
            cx.report(last_arg, PREFER_AWAIT_TO_CALLBACKS);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // Not what an interface or a type has.
        let is_function = match func.kind() {
            FnKind::Decl | FnKind::Expr | FnKind::Arrow => true,
            FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                !matches!(func.owner(), Node::Member(member) if member.is_signature())
            }
            _ => false,
        };
        if is_function
            && let Some(param) = func.params().iter().rfind(|it| !it.is_rest())
            && param.pat().as_ident().is_some_and(|name| name.is_any(&["callback", "cb"]))
        {
            cx.report(param, PREFER_AWAIT_TO_CALLBACKS);
        }
    }
}
