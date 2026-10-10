use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Disallow async functions which have no `await` expression.
pub struct RequireAwait;

const MISSING_AWAIT: Message = Message::new("missingAwait", "{{name}} has no 'await' expression.");
const REMOVE_ASYNC: Message = Message::new("removeAsync", "Remove 'async'.");

#[derive(Default)]
pub struct State<'a> {
    /// The async functions that are neither generators nor empty.
    candidates: Vec<Func<'a>>,
    with_await: FxHashSet<Func<'a>>,
    /// The function that a node is directly in.
    functions: AncestorMemo<'a, Func<'a>>,
}

/// `node` awaits something: so does the function that it is directly in.
fn mark_function_around<'a>(node: Node<'a>, cx: &mut Cx<'a, RequireAwait>) {
    let function = cx.state.functions.find(node, |_, parent| {
        parent.as_func().filter(|func| func.kind() != FnKind::StaticBlock)
    });
    if let Some(func) = function
        && func.is_async()
    {
        cx.state.with_await.insert(func);
    }
}

/// The method that `func` is the value of, which is where its `async` is, or else the function.
fn node_with_async_keyword(func: Func<'_>) -> Node<'_> {
    match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.kind() == PropKind::Method && prop.value() == Some(e) => {
                Node::Prop(prop)
            }
            _ => Node::Expr(e),
        },
        owner => owner,
    }
}

/// Where oxlint points: at the name of the function, or at the key of the property or the method that it is the value
/// of if that is an identifier, and else at the function.
fn oxlint_place<'a>(func: Func<'a>, file: &File<'a>) -> Span {
    if func.is_arrow() {
        return func.estree_span();
    }
    let key = match func.owner() {
        Node::Member(member) => Some(member.key()),
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.value() == Some(e) => Some(prop.key()),
            _ => None,
        },
        _ => None,
    };
    let name = match key {
        Some(key) => key.filter(|it| matches!(it.kind(), KeyKind::Ident(_))).map(|it| it.span(file)),
        None => func.name().map(|it| it.span()),
    };
    name.unwrap_or_else(|| func.estree_span())
}

fn report<'a>(func: Func<'a>, cx: &Cx<'a, RequireAwait>) {
    let mut name = ast_utils::get_function_name_with_kind(func);
    if let Some(first) = name.first_mut() {
        first.make_ascii_uppercase();
    }
    let place = match cx.language().is_oxlint {
        true => oxlint_place(func, cx.file()),
        false => ast_utils::get_function_head_loc(func),
    };
    cx.report(place, MISSING_AWAIT)
        .data("name", name)
        .suggest(REMOVE_ASYNC, |fixer| {
            let file = fixer.file();
            let node = node_with_async_keyword(func);
            let async_token = file.tokens_in(node).find(|token| token.is("async"))?;
            let after = file.tokens_after(async_token).with_comments().next()?;
            let next_token = file.token_after(async_token)?;
            // Without the `async`, what follows could continue the line before.
            let adds_semicolon = (ast_utils::is_opening_paren_token(&next_token)
                && ast_utils::is_start_of_expression_statement(node)
                || matches!(node, Node::Member(_))
                    && ast_utils::can_continue_expression_in_class_body(&next_token))
                && ast_utils::needs_preceding_semicolon(node);
            Some(fixer.replace(
                Span::new(async_token.start(), after.start()),
                if adds_semicolon { ";" } else { "" },
            ))
        });
}

impl Rule for RequireAwait {
    const META: Meta = Meta::eslint("require-await", Kind::Suggestion)
        .has_suggestions()
        .reports_on_exit();
    const ON: On = On::new()
        .funcs()
        .exprs(&[ExprTag::Await])
        .stmts(&[StmtTag::ForOf])
        .var_decls()
        .finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireAwait
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.is_async()
            && !func.is_generator()
            && ast_utils::is_function_with_body(func)
            && !ast_utils::is_empty_function(func)
        {
            cx.state.candidates.push(func);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        mark_function_around(e.into(), cx);
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(statement.kind(), StmtKind::ForOf { is_await: true, .. }) {
            mark_function_around(statement.into(), cx);
        }
    }

    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if declaration.var_kind() == VarKind::AwaitUsing {
            mark_function_around(declaration.into(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for func in std::mem::take(&mut cx.state.candidates) {
            if !cx.state.with_await.contains(&func) {
                report(func, cx);
            }
        }
    }
}
