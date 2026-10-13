use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow async functions which have no `await` expression.
pub struct RequireAwait;

pub const MISSING_AWAIT: Message =
    Message::new("missingAwait", "{{name}} has no 'await' expression.");
pub const REMOVE_ASYNC: Message = Message::new("removeAsync", "Remove 'async'.");

pub struct State<'a> {
    /// The async functions that can be reported, in the order of [`File::funcs`].
    pub candidates: Vec<Func<'a>>,
    /// For each of them, whether something is awaited directly in it.
    pub has_await: Vec<bool>,
    /// The function that a node is directly in.
    functions: AncestorMemo<'a, Func<'a>>,
}

impl<'a> State<'a> {
    /// `None`: the file has no async function with something in it.
    pub fn new(file: &'a File<'a>, with_generators: bool) -> Option<State<'a>> {
        let is_candidate = |func: &Func| {
            func.is_async()
                && (with_generators || !func.is_generator())
                && ast_utils::is_function_with_body(*func)
                && !ast_utils::is_empty_function(*func)
        };
        let candidates: Vec<Func<'a>> = file.funcs().filter(is_candidate).collect();
        (!candidates.is_empty()).then(|| State {
            has_await: vec![false; candidates.len()],
            candidates,
            functions: AncestorMemo::default(),
        })
    }
}

/// `node` awaits something: so does the function that it is directly in.
#[inline(never)]
pub fn mark_function_around<'a, R: Rule<State<'a> = State<'a>>>(
    node: Node<'a>,
    cx: &mut Cx<'a, R>,
) {
    let function = cx.state.functions.find(node, |_, parent| {
        parent
            .as_func()
            .filter(|func| func.kind() != FnKind::StaticBlock)
    });
    if let Some(func) = function
        && let Ok(at) = cx
            .state
            .candidates
            .binary_search_by_key(&func.id().idx(), |it| it.id().idx())
        && let Some(has_await) = cx.state.has_await.get_mut(at)
    {
        *has_await = true;
    }
}

/// The method that `func` is the value of, which is where its `async` is, or else the function.
pub fn node_with_async_keyword(func: Func<'_>) -> Node<'_> {
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
        // `static async constructor() {}`
        Node::Member(member) if member.key().is_none() => {
            return member
                .constructor_keyword()
                .map_or_else(|| func.estree_span(), |it| it.span());
        }
        Node::Member(member) => Some(member.key()),
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.value() == Some(e) && !prop.is_jsx_attribute() => {
                Some(prop.key())
            }
            _ => None,
        },
        _ => None,
    };
    let name = match key {
        Some(key) => key
            .filter(|it| matches!(it.kind(), KeyKind::Ident(_)))
            .map(|it| it.span(file)),
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
        .called_with(func)
        .data("name", name)
        .suggest_change_of_behavior(REMOVE_ASYNC, &[], |fixer| {
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
        .exprs(&[ExprTag::Await])
        .stmts(&[StmtTag::ForOf])
        .var_decls()
        .finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireAwait
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        State::new(file, false)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint's rule does not look into types, where oxc reads `{ [await (a)]: T }` as an `await`.
        let is_key_in_type = cx.language().is_oxlint
            && matches!(e.parent(), Node::Member(member) if !matches!(member.parent(), Node::Class(_)));
        if !is_key_in_type {
            mark_function_around(e.into(), cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if statement.as_for_of().is_some_and(|(.., is_await)| is_await) {
            mark_function_around(statement.into(), cx);
        }
    }

    #[inline]
    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if declaration.var_kind() == VarKind::AwaitUsing {
            mark_function_around(declaration.into(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let has_await = std::mem::take(&mut cx.state.has_await);
        for (func, has_await) in std::mem::take(&mut cx.state.candidates)
            .into_iter()
            .zip(has_await)
        {
            if !has_await {
                report(func, cx);
            }
        }
    }
}
