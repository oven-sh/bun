use bun_lint::prelude::*;
use bun_lint::tokens::next_token;

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

/// The code paths around the current node that have a `return`, each with the function or the file
/// it is of.
pub type State<'a> = Vec<(Node<'a>, CodePath<'a>)>;

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
    node.for_each_child(|child| match child {
        Node::Stmt(statement) if statement.tag() == StmtTag::Return => visit(statement),
        Node::Stmt(_) | Node::Case(_) => for_each_return(child, &mut *visit),
        _ => {}
    });
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

/// For [`Listeners::code_path_start`].
pub fn code_path_start<'a>(state: &mut State<'a>, path: CodePath<'a>, node: Node<'a>) {
    let has_returns = match node {
        Node::File(_) => true,
        Node::Func(func) => func.returns().next().is_some(),
        _ => false,
    };
    if has_returns {
        state.push((node, path));
    }
}

/// For [`Listeners::exit`] of `NodeTags::FUNC | NodeTags::FILE`.
///
/// `classify`: whether a `return` statement specifies a value. `None`: it is as if it was not there.
pub fn exit<'a, R: Rule<State<'a> = State<'a>>>(
    node: Node<'a>,
    cx: &mut Cx<'a, R>,
    classify: impl Fn(Stmt<'a>) -> Option<bool>,
) {
    let Some((_, path)) = cx.state.pop_if(|it| it.0 == node) else {
        return;
    };
    let cx = &*cx;

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

    if expected != Some(true) || !path.is_current_reachable() {
        return;
    }
    let Node::Func(func) = node else {
        cx.report_at(0, MISSING_RETURN).data("name", "program");
        return;
    };
    let is_class_constructor = matches!(func.owner(), Node::Member(member) if member.is_constructor());
    if !ast_utils::is_es5_constructor(func) && !is_class_constructor {
        cx.report(location_of(func), MISSING_RETURN)
            .data("name", ast_utils::get_function_name_with_kind(func));
    }
}

impl Rule for ConsistentReturn {
    const META: Meta = Meta::eslint("consistent-return", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        ConsistentReturn {
            treat_undefined_as_unspecified: options.object(0).bool_or("treatUndefinedAsUnspecified", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        // TODO(api): replace by code_path::Func::is_end_reachable, which needs no walk.
        if is_relevant(file) {
            on.code_path_start(|_, path, node, cx| code_path_start(&mut cx.state, path, node));
            on.exit(NodeTags::FUNC | NodeTags::FILE, |rule, node, cx| {
                exit(node, cx, |statement| match statement.kind() {
                    StmtKind::Return(argument) => {
                        Some(has_return_value(argument, rule.treat_undefined_as_unspecified))
                    }
                    _ => None,
                });
            });
        }
        Vec::new()
    }
}
