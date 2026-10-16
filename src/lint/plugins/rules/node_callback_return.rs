use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Require `return` statements after callbacks.
pub struct CallbackReturn {
    callbacks: Vec<Box<str>>,
    /// The calls whose callee can be written as one of them.
    on: On,
}

const CALLBACK_RETURN: Message = Message::new("", "Expected return with your callback function.");

/// What `find_closest_block_parent` finds.
#[derive(Copy, Clone)]
enum ClosestBlock<'a> {
    /// A `return`, or an arrow function that something is a parameter or the whole body of.
    ReturnOrArrow,
    Block(Stmt<'a>),
    FunctionBody(Func<'a>),
}

#[derive(Default)]
pub struct State<'a> {
    closest_block: AncestorMemo<'a, ClosestBlock<'a>>,
    in_function: AncestorMemo<'a, ()>,
}

impl Rule for CallbackReturn {
    const META: Meta = Meta::oxlint(Plugin::Node, "callback-return", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let callbacks: Vec<Box<str>> = match options.get(0).and_then(Json::as_array) {
            Some(names) => names.iter().filter_map(|it| std::str::from_utf8(it.as_str()?).ok()).map(Box::from).collect(),
            None => ["callback", "cb", "next"].map(Box::from).to_vec(),
        };
        let is_word = |it: &[u8]| !it.is_empty() && it.iter().all(|it| it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$'));
        let mut on = On::new();
        for callback in &callbacks {
            let callback = callback.as_bytes();
            on = match strings::rsplit_once_char(callback, b'.') {
                None if is_word(callback) => on.function_call(callback),
                Some((_, name)) if is_word(name) => on.method_call(name),
                _ => Self::ON,
            };
        }
        CallbackReturn { callbacks, on }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        self.on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        self.callbacks.iter().any(|it| file.mentions(first_name(it))).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(callee) = e.callee() else {
            return;
        };
        if !matches!(callee.tag(), ExprTag::Ident | ExprTag::Dot | ExprTag::Index) {
            return;
        }
        let text = callee.text();
        if !self.callbacks.iter().any(|it| it.as_bytes() == text) || !contains_only_identifiers(callee) {
            return;
        }
        let (block_body, is_body_of_function) = match cx.state.closest_block.find(Node::Expr(e), find_closest_block_parent) {
            None | Some(ClosestBlock::ReturnOrArrow) => return,
            Some(ClosestBlock::Block(block)) => (block.as_block(), false),
            Some(ClosestBlock::FunctionBody(func)) => (func.body_statements(), true),
        };
        let mut from_the_end = block_body.into_iter().flatten().rev();
        if let Some(last_item) = from_the_end.next() {
            if is_body_of_function && is_callback_expression(e, last_item)
                || last_item.tag() == StmtTag::Return && from_the_end.next().is_some_and(|it| is_callback_expression(e, it))
            {
                return;
            }
        }
        let is_function = |it: Node| matches!(it, Node::Func(func) if func.kind() != FnKind::StaticBlock);
        let in_function = &mut cx.state.in_function;
        if is_body_of_function || in_function.find(Node::Expr(e), |_, parent| is_function(parent).then_some(())).is_some() {
            cx.report(e, CALLBACK_RETURN);
        }
    }
}

/// The `a` of `a.b` and of `a .b`.
fn first_name(callback: &str) -> &str {
    let end = strings::index_of_any(callback.as_bytes(), b".[ \t\r\n/");
    callback.get(..end.unwrap_or(callback.len())).unwrap_or(callback)
}

/// `Expression::as_member_expression`
fn is_member_expression(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index) && !e.is_parenthesized() && !e.is_chain_root()
}

fn contains_only_identifiers(expr: Expr) -> bool {
    let is_identifier = |e: Expr| e.tag() == ExprTag::Ident && !e.is_parenthesized();
    let mut at = expr;
    loop {
        if is_identifier(at) {
            return true;
        }
        let Some(object) = at.object().filter(|_| is_member_expression(at)) else {
            return false;
        };
        if is_identifier(object) {
            return true;
        }
        match object.object().filter(|_| is_member_expression(object)) {
            Some(next) => at = next,
            None => return false,
        }
    }
}

fn find_closest_block_parent<'a>(child: Node<'a>, parent: Node<'a>) -> Option<ClosestBlock<'a>> {
    match parent {
        Node::Stmt(stmt) => match stmt.kind() {
            StmtKind::Block(_) => Some(ClosestBlock::Block(stmt)),
            StmtKind::Return(_) => Some(ClosestBlock::ReturnOrArrow),
            _ => None,
        },
        Node::Func(func) if func.kind() == FnKind::StaticBlock => None,
        Node::Func(func) if matches!(child, Node::Stmt(_)) => Some(ClosestBlock::FunctionBody(func)),
        Node::Func(func) if func.is_arrow() => Some(ClosestBlock::ReturnOrArrow),
        _ => None,
    }
}

/// `statement` is `call;`, `a + call;` or `a && call;`.
fn is_callback_expression<'a>(call: Expr<'a>, statement: Stmt<'a>) -> bool {
    let Some(e) = statement.as_expr() else {
        return false;
    };
    e == call || matches!(e.kind(), ExprKind::Binary { op, right, .. } if op != BinOp::Comma && right == call)
}
