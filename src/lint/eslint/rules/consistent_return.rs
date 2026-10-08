use bun_lint::prelude::*;
use bun_lint::tokens::next_token;
use smallvec::SmallVec;

/// Require `return` statements to either always or never specify values.
pub struct ConsistentReturn {
    treat_undefined_as_unspecified: bool,
}

const MISSING_RETURN: Message = Message::new(
    "missingReturn",
    "Expected to return a value at the end of {{name}}.",
);
const MISSING_RETURN_VALUE: Message = Message::new("missingReturnValue", "{{name}} expected a return value.");
const UNEXPECTED_RETURN_VALUE: Message =
    Message::new("unexpectedReturnValue", "{{name}} expected no return value.");

/// Whether there can be anything to report in `file`.
pub fn is_relevant(file: &File<'_>) -> bool {
    file.has_stmts([StmtTag::Return])
}

/// Whether `return argument;` specifies a value.
pub fn has_return_value(argument: Option<Expr<'_>>, treat_undefined_as_unspecified: bool) -> bool {
    argument.is_some_and(|argument| {
        !treat_undefined_as_unspecified
            || !ast_utils::is_specific_id(argument, "undefined")
                && !matches!(argument.kind(), ExprKind::Unary { op: UnOp::Void, .. })
    })
}

/// Calls `visit` with the `return` statements of a function or of the file, not with those in
/// nested functions, in source order.
fn for_each_return<'a>(node: Node<'a>, visit: &mut dyn FnMut(Stmt<'a>)) {
    if let Node::Func(func) = node {
        return func.returns().for_each(visit);
    }
    // What is still to visit, the first last.
    let mut pending = SmallVec::<[Node<'a>; 16]>::new();
    pending.push(node);
    while let Some(node) = pending.pop() {
        if let Node::Stmt(statement) = node
            && statement.tag() == StmtTag::Return
        {
            visit(statement);
            continue;
        }
        let first = pending.len();
        node.for_each_child(|child| {
            if matches!(child, Node::Stmt(_) | Node::Case(_)) {
                pending.push(child);
            }
        });
        if let Some(children) = pending.get_mut(first..) {
            children.reverse();
        }
    }
}

/// Where a function that does not end with a `return` is reported.
fn location_of(func: Func<'_>) -> Span {
    let file = func.file();
    let key = match (func.owner(), func.kind()) {
        (_, FnKind::Arrow) => func.arrow_span(),
        (Node::Member(member), _) => match member.key() {
            Some(key) => Some(key.inner_span(file)),
            None => member.constructor_keyword().map(Ident::span),
        },
        (Node::Expr(e), FnKind::Method) => match e.parent() {
            Node::Prop(property) => property.key().map(|key| key.inner_span(file)),
            _ => None,
        },
        _ => func.name().map(Ident::span),
    };
    key.unwrap_or_else(|| next_token(file.text(), func.estree_span().start))
}

/// Checks a function or the file.
///
/// `classify`: whether a `return` statement specifies a value. `None`: it is as if it was not there.
pub fn check<'a, R: Rule>(node: Node<'a>, cx: &Cx<'a, R>, classify: impl Fn(Stmt<'a>) -> Option<bool>) {
    // Whether the first `return` specifies a value.
    let mut expected = None;
    for_each_return(node, &mut |statement: Stmt<'a>| {
        let Some(has_return_value) = classify(statement) else {
            return;
        };
        if *expected.get_or_insert(has_return_value) == has_return_value {
            return;
        }
        let name = match node {
            Node::Func(func) => text::upper_case_first(&ast_utils::get_function_name_with_kind(func)).into_owned(),
            _ => b"Program".to_vec(),
        };
        let message = if has_return_value { UNEXPECTED_RETURN_VALUE } else { MISSING_RETURN_VALUE };
        cx.report(statement, message).data("name", name);
    });

    if expected != Some(true) {
        return;
    }
    let Node::Func(func) = node else {
        if cx.file().is_end_reachable() {
            cx.report_at(0, MISSING_RETURN).data("name", "program");
        }
        return;
    };
    if !func.is_end_reachable() {
        return;
    }
    let is_class_constructor = matches!(func.owner(), Node::Member(member) if member.is_constructor());
    if !ast_utils::is_es5_constructor(func) && !is_class_constructor {
        cx.report(location_of(func), MISSING_RETURN)
            .data("name", ast_utils::get_function_name_with_kind(func));
    }
}

impl ConsistentReturn {
    fn check<'a>(&self, node: Node<'a>, cx: &Cx<'a, Self>) {
        check(node, cx, |statement| match statement.kind() {
            StmtKind::Return(argument) => Some(has_return_value(argument, self.treat_undefined_as_unspecified)),
            _ => None,
        });
    }
}

impl Rule for ConsistentReturn {
    const META: Meta = Meta::eslint("consistent-return", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentReturn {
            treat_undefined_as_unspecified: options.object(0).bool_or("treatUndefinedAsUnspecified", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if is_relevant(file) {
            on.funcs(|rule, func, cx| rule.check(func.into(), cx));
            on.finish(|rule, cx| rule.check(cx.file().into(), cx));
        }
    }
}
