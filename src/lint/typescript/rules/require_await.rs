use bun_lint::prelude::*;
use bun_lint::types::tsutils::{get_well_known_symbol_property_of_type, is_thenable_type};
use bun_lint::types::{Locate, Type};
use bun_lint::utils::eslint_utils::get_function_name_with_kind;
use bun_lint::utils::oxlint::tsgolint_function_head_loc;
use bun_lint::utils::ts_utils::{
    get_function_head_loc, is_start_of_expression_statement, needs_preceding_semicolon,
    upper_case_first,
};
use bun_lint_eslint::rules::require_await::{
    MISSING_AWAIT, REMOVE_ASYNC, State, mark_function_around, mark_function_with,
    node_with_async_keyword,
};

/// Disallow async functions which do not return promises and have no `await` expression.
pub struct RequireAwait;

fn is_thenable<'a>(node: impl Locate<'a>, ty: Type<'a>) -> bool {
    ty.is_unresolved() || is_thenable_type(node, ty)
}

fn is_thenable_expression(node: Expr) -> bool {
    is_thenable(node, node.ty())
}

fn is_thenable_return(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Return(Some(argument)) if is_thenable_expression(argument))
}

/// Whether `func` returns something thenable.
fn returns_thenable(func: Func, is_oxlint: bool) -> bool {
    if func.is_arrow() {
        // typescript-eslint looks at every child of the arrow function that is neither a block nor an
        // `await`, which the parameters are too. tsgolint looks at the body only.
        let has_thenable_parameter = !is_oxlint
            && func.params().iter().any(|param| {
                match param.default().is_none() && !param.is_rest() {
                    true => is_thenable(param.pat(), param.pat().ty()),
                    false => is_thenable(param, param.type_at_location()),
                }
            });
        if has_thenable_parameter {
            return true;
        }
        if let FnBody::Expr(body) = func.body()
            && is_thenable_expression(body)
        {
            return true;
        }
    }
    func.returns().any(is_thenable_return)
}

fn has_async_iterator(ty: Type) -> bool {
    if ty.is_union_or_intersection() {
        return ty.types().iter().any(has_async_iterator);
    }
    ty.is_unresolved() || get_well_known_symbol_property_of_type(ty, "asyncIterator").is_some()
}

/// Whether the generator `func` delegates to an async generator or yields something thenable.
fn is_async_yield(func: Func, is_oxlint: bool) -> bool {
    func.yields().any(|node| {
        let Some((Some(argument), star)) = node.as_yield() else {
            return false;
        };
        match argument.kind() {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => false,
            // typescript-eslint skips a `Literal`, tsgolint an `ast.IsLiteralExpression`.
            ExprKind::True | ExprKind::False | ExprKind::Null if !is_oxlint => false,
            ExprKind::Template(template) if is_oxlint && template.exprs().is_empty() => false,
            _ if star => has_async_iterator(argument.ty()),
            _ => is_thenable_expression(argument),
        }
    })
}

/// tsgolint's `currentScope` at `node`: the function, method, accessor or constructor that it is in. A computed key and
/// a decorator are in their method, and a static block is in the function around its class.
fn current_scope<'a>(_: Node<'a>, parent: Node<'a>) -> Option<Func<'a>> {
    let func = match parent {
        Node::Func(func) => func,
        Node::Member(member) if !member.is_signature() => member.func()?,
        Node::Prop(prop) => prop.func()?,
        _ => return None,
    };
    matches!(
        func.kind(),
        FnKind::Decl
            | FnKind::Expr
            | FnKind::Arrow
            | FnKind::Method
            | FnKind::Getter
            | FnKind::Setter
            | FnKind::Constructor
    )
    .then_some(func)
}

/// `node` awaits something: tsgolint's `markAsHasAwait`, and typescript-eslint's.
fn mark_as_has_await<'a>(node: Node<'a>, cx: &mut Cx<'a, RequireAwait>) {
    match cx.language().is_oxlint {
        true => mark_function_with(node, cx, current_scope),
        false => mark_function_around(node, cx),
    }
}

/// Whether `func` still awaits where tsgolint has another scope: in the key or a decorator of a method in it.
fn awaits_in_key_or_decorator(func: Func) -> bool {
    let span = func.span();
    func.file()
        .exprs_of_kind(ExprTag::Await)
        .any(|it| span.contains(it.span()) && Node::from(it).enclosing_function() == Some(func))
}

/// Whether `e` is the start of an expression statement in a list of statements, where a `;` before it is a statement
/// of its own: not of one that is the body of an `if`, a loop or a `with`.
fn starts_statement_in_list(e: Expr) -> bool {
    let start = e.span().start;
    Node::from(e)
        .ancestors()
        .take_while(|it| !matches!(it, Node::File(_)) && it.span().start == start)
        .find_map(|it| it.as_stmt().filter(|statement| statement.tag() == StmtTag::Expr))
        .is_some_and(|statement| {
            !matches!(
                statement.parent(),
                Node::Stmt(parent)
                    if parent.is_loop() || matches!(parent.kind(), StmtKind::If { .. } | StmtKind::With { .. })
            )
        })
}

/// tsgolint's `needsPrecedingSemicolon` for what starts at `start`: by the last character before it that is no white
/// space, which can be the end of a comment. `None`: that is a `}`, where it depends on what the `}` ends.
fn tsgolint_semicolon_by_last_character(text: &[u8], start: u32) -> Option<bool> {
    let before = text
        .get(..start as usize)
        .unwrap_or_default()
        .trim_ascii_end();
    let Some(&last) = before.last() else {
        return Some(false);
    };
    if matches!(last, b';' | b':' | b'{' | b',' | b'(' | b'[')
        || before.ends_with(b"=>")
        || before.ends_with(b"++")
        || before.ends_with(b"--")
    {
        return Some(false);
    }
    (last != b'}').then_some(true)
}

/// tsgolint's `needsPrecedingSemicolon` for a member of a class.
fn tsgolint_needs_preceding_semicolon(member: Member) -> bool {
    let by_last_character =
        tsgolint_semicolon_by_last_character(member.file().text(), member.span().start);
    if let Some(needs_semicolon) = by_last_character {
        return needs_semicolon;
    }
    // The `}` of the method, the accessor or the constructor before it.
    let Node::Class(class) = member.parent() else {
        return true;
    };
    let previous = class.members().iter().take_while(|it| *it != member).last();
    !previous.is_some_and(|it| {
        matches!(
            it.kind(),
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
        )
    })
}

/// Whether `name` is one name. tsgolint's `isTypeReferenceNamed` also takes one after `globalThis.`.
fn is_global_name(name: EntityName, is_oxlint: bool) -> bool {
    match name.len() {
        1 => true,
        2 => is_oxlint && name.first().is_some_and(|it| it.name().is("globalThis")),
        _ => false,
    }
}

fn remove_async<'a>(fixer: Fixer<'a>, func: Func<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let is_oxlint = file.language().is_oxlint;
    // tsgolint removes the `async` of a function that goes on awaiting, which is a syntax error.
    if is_oxlint && awaits_in_key_or_decorator(func) {
        return None;
    }
    let node = node_with_async_keyword(func);
    let async_token = file.tokens_in(node).find(|token| token.value() == b"async")?;
    let after = file.tokens_after(async_token).with_comments().next()?;
    let next_token = file.token_after(async_token)?;
    // Without the `async`, what follows could continue the line before.
    let add_semi_colon = match node {
        // tsgolint goes by the character before the member. It also writes the `;` after a modifier, where it declares
        // a property, and none before the `*` of a generator, which then multiplies the property before it.
        Node::Member(member) if is_oxlint => {
            async_token.start() == member.span().start
                && ast_utils::can_continue_expression_in_class_body(&next_token)
                && (ast_utils::needs_preceding_semicolon(node)
                    || next_token.is_punctuator("[") && tsgolint_needs_preceding_semicolon(member))
        }
        // tsgolint goes by the last character before an arrow function too, also where the function is the body of an
        // `if`, a loop or a `with`, which its `;` then is. It writes none before `<`, where the type parameters are
        // then read as type arguments of the line before.
        Node::Expr(e) if is_oxlint => {
            starts_statement_in_list(e)
                && if next_token.is_punctuator("(") {
                    tsgolint_semicolon_by_last_character(file.text(), async_token.start())
                        .unwrap_or(true)
                } else {
                    next_token.is_punctuator("<") && needs_preceding_semicolon(node)
                }
        }
        _ => {
            (next_token.is_punctuator("[") || next_token.is_punctuator("("))
                && (matches!(node, Node::Member(_)) || is_start_of_expression_statement(node))
                && needs_preceding_semicolon(node)
        }
    };
    let mut changes = vec![fixer.replace(
        Span::new(async_token.start(), after.start()),
        if add_semi_colon { ";" } else { "" },
    )];

    // `Promise<T>` becomes `T`, and `AsyncGenerator<T>` becomes `Generator<T>`.
    if let Some(return_type) = func.return_type()
        && let TypeKind::Ref { name, args } = return_type.kind()
        && is_global_name(name, is_oxlint)
    {
        let type_name = name.span();
        if func.is_generator() {
            if name.last().is_some_and(|it| it.name().is("AsyncGenerator")) {
                changes.push(fixer.replace(type_name, "Generator"));
            }
        } else if name.last().is_some_and(|it| it.name().is("Promise"))
            && let Some(angles) = args.angle_brackets_span()
        {
            changes.push(fixer.remove(Span::new(angles.end - 1, angles.end)));
            changes.push(fixer.remove(Span::new(type_name.start, angles.start + 1)));
        }
    }
    Some(changes)
}

impl Rule for RequireAwait {
    const META: Meta = Meta::typescript("require-await", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("require-await")
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
        State::new(file, true)
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        mark_as_has_await(node.into(), cx);
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if node.as_for_of().is_some_and(|(.., is_await)| is_await) {
            mark_as_has_await(node.into(), cx);
        }
    }

    #[inline]
    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if node.var_kind() == VarKind::AwaitUsing {
            mark_as_has_await(node.into(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        if is_oxlint {
            // tsgolint has no scope for a static block: a `return` in one is in the function around the class.
            for block in cx.file().funcs() {
                if block.kind() == FnKind::StaticBlock && block.returns().any(is_thenable_return) {
                    mark_as_has_await(block.into(), cx);
                }
            }
        }
        let has_await = std::mem::take(&mut cx.state.has_await);
        for (func, has_await) in std::mem::take(&mut cx.state.candidates).into_iter().zip(has_await) {
            // `ast.GetFunctionFlags` has no `async` for a constructor.
            if is_oxlint && func.kind() == FnKind::Constructor {
                continue;
            }
            if has_await
                || returns_thenable(func, is_oxlint)
                || func.is_generator() && is_async_yield(func, is_oxlint)
            {
                continue;
            }
            let name = get_function_name_with_kind(func, false);
            let place = match cx.language().is_oxlint {
                true => tsgolint_function_head_loc(func),
                false => get_function_head_loc(func),
            };
            cx.report(place, MISSING_AWAIT)
                .data("name", upper_case_first(&name).into_owned())
                .suggest_change_of_behavior(REMOVE_ASYNC, &[], |fixer| remove_async(fixer, func));
        }
    }
}
