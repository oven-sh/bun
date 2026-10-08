use bun_lint::prelude::*;

/// Require braces around arrow function bodies.
pub struct ArrowBodyStyle {
    mode: Mode,
    require_return_for_object_literal: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    AsNeeded,
    Never,
}

const UNEXPECTED_OTHER_BLOCK: Message = Message::new(
    "unexpectedOtherBlock",
    "Unexpected block statement surrounding arrow body.",
);
const UNEXPECTED_EMPTY_BLOCK: Message = Message::new(
    "unexpectedEmptyBlock",
    "Unexpected block statement surrounding arrow body; put a value of `undefined` immediately after the `=>`.",
);
const UNEXPECTED_OBJECT_BLOCK: Message = Message::new(
    "unexpectedObjectBlock",
    "Unexpected block statement surrounding arrow body; parenthesize the returned value and move it immediately after the `=>`.",
);
const UNEXPECTED_SINGLE_BLOCK: Message = Message::new(
    "unexpectedSingleBlock",
    "Unexpected block statement surrounding arrow body; move the returned value immediately after the `=>`.",
);
const EXPECTED_BLOCK: Message = Message::new(
    "expectedBlock",
    "Expected block statement surrounding arrow body.",
);

const RETURN_LEN: u32 = "return".len() as u32;

/// ESLint's `hasASIProblem`: removing a `;` or a `}` before `token` changes the meaning.
fn has_asi_problem(token: Option<Token<'_>>) -> bool {
    token.is_some_and(|it| {
        it.kind() == TokenKind::Punctuator
            && matches!(it.text().first(), Some(b'(' | b'[' | b'/' | b'`' | b'+' | b'-'))
    })
}

/// ESLint's `isInsideForLoopInitializer`.
fn is_inside_for_loop_initializer(e: Expr<'_>) -> bool {
    let mut inner = Node::Expr(e);
    for ancestor in inner.ancestors() {
        if let Node::Stmt(statement) = ancestor
            && let StmtKind::For {
                init: Some(init), ..
            } = statement.kind()
        {
            let init = match init.kind() {
                StmtKind::Expr(head) => Node::Expr(head),
                _ => Node::Stmt(init),
            };
            if init == inner {
                return true;
            }
        }
        inner = ancestor;
    }
    false
}

/// Whether there is an `in` operator anywhere in `node`.
fn has_in_operator(node: Node<'_>) -> bool {
    if let Node::Expr(e) = node
        && matches!(e.kind(), ExprKind::Binary { op: BinOp::In, .. })
    {
        return true;
    }
    let mut found = false;
    node.for_each_child(|child| found = found || has_in_operator(child));
    found
}

/// Makes an expression of the body `{ return argument; }`, which is at `body`.
fn remove_block<'a>(
    fixer: Fixer<'a>,
    arrow: Expr<'a>,
    body: Span,
    statement: Stmt<'a>,
    argument: Expr<'a>,
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    if has_asi_problem(file.token_after(body)) {
        return None;
    }
    let opening_brace = Span::new(body.start, body.start + 1);
    let closing_brace = Span::new(body.end - 1, body.end);
    let whole = statement.span();
    let keyword = Span::new(whole.start, whole.start + RETURN_LEN);
    let first_value = Span::empty(skip_trivia(file.text(), keyword.end));
    let last_value = Span::empty(whole.end);
    let comments_exist = file.comments_exist_between(opening_brace, first_value)
        || file.comments_exist_between(last_value, closing_brace);

    // Without comments, the space around the value goes too.
    let mut fixes = if comments_exist {
        vec![
            fixer.remove(opening_brace),
            fixer.remove(closing_brace),
            fixer.remove(keyword),
        ]
    } else {
        vec![
            fixer.remove(Span::new(opening_brace.start, first_value.start)),
            fixer.remove(Span::new(last_value.end, closing_brace.end)),
        ]
    };

    let starts_with_brace = file.text().get(first_value.start as usize) == Some(&b'{');
    let is_sequence = matches!(
        argument.kind(),
        ExprKind::Binary {
            op: BinOp::Comma,
            ..
        }
    );
    if (starts_with_brace
        || is_sequence
        || (is_inside_for_loop_initializer(arrow) && has_in_operator(Node::Expr(arrow))))
        && !argument.is_parenthesized()
    {
        fixes.push(fixer.insert_before(first_value, "("));
        fixes.push(fixer.insert_after(last_value, ")"));
    }

    if let Some(semicolon) = statement.semicolon() {
        fixes.push(fixer.remove(semicolon));
    }
    Some(fixes)
}

/// Makes the block `{return body}` of the body of `arrow`, which is `func`.
fn add_block<'a>(fixer: Fixer<'a>, arrow: Expr<'a>, func: Func<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let text = file.text();
    let first = skip_trivia(text, func.arrow_span()?.end);
    let second = skip_trivia(text, first + 1);
    let end = Span::empty(arrow.span().end);

    let is_paren_and_brace =
        text.get(first as usize) == Some(&b'(') && text.get(second as usize) == Some(&b'{');
    let parenthesised_object_literal = is_paren_and_brace
        .then(|| utils::get_node_by_range_index(file, second))
        .and_then(Node::as_expr)
        .filter(|it| it.tag() == ExprTag::Object && !utils::is_assignment_target(*it));

    let Some(object) = parenthesised_object_literal else {
        return Some(vec![
            fixer.insert_before(Span::empty(first), "{return "),
            fixer.insert_after(end, "}"),
        ]);
    };

    // The parentheses were forced by the syntax. They need not end the body: `() => ({}).foo()`
    let parens = std::iter::once(Node::Expr(object))
        .chain(Node::Expr(object).ancestors())
        .find_map(|it| it.as_expr()?.parens().next())?;
    let opening_paren = Span::new(first, first + 1);
    let opening_brace = Span::new(second, second + 1);
    let mut fixes = if ast_utils::is_token_on_same_line(file, opening_paren, opening_brace) {
        vec![fixer.replace(opening_paren, "{return ")]
    } else {
        // A line break after `return` would end the statement.
        vec![
            fixer.replace(opening_paren, "{"),
            fixer.insert_before(opening_brace, "return "),
        ]
    };
    fixes.push(fixer.remove(Span::new(parens.end - 1, parens.end)));
    fixes.push(fixer.insert_after(end, "}"));
    Some(fixes)
}

impl ArrowBodyStyle {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(func) = e.as_fn().filter(|it| it.is_arrow()) else {
            return;
        };
        match func.body() {
            FnBody::Block(statements) => self.check_block(e, func, statements, cx),
            FnBody::Expr(body) => {
                if self.mode == Mode::Always
                    || (self.mode == Mode::AsNeeded
                        && self.require_return_for_object_literal
                        && body.tag() == ExprTag::Object)
                {
                    cx.report(body, EXPECTED_BLOCK).fix(|fixer| add_block(fixer, e, func));
                }
            }
            FnBody::None => {}
        }
    }

    fn check_block<'a>(
        &self,
        e: Expr<'a>,
        func: Func<'a>,
        statements: List<'a, Stmt<'a>>,
        cx: &Cx<'a, Self>,
    ) {
        let count = statements.len();
        if self.mode == Mode::Always || (count != 1 && self.mode != Mode::Never) {
            return;
        }
        // The only statement, if it is a `return`, and what it returns.
        let returned = match statements.first().map(|it| (it, it.kind())) {
            Some((statement, StmtKind::Return(argument))) if count == 1 => Some((statement, argument)),
            _ => None,
        };
        if self.mode == Mode::AsNeeded {
            let Some((_, argument)) = returned else {
                return;
            };
            if self.require_return_for_object_literal
                && argument.is_some_and(|it| it.tag() == ExprTag::Object)
            {
                return;
            }
        }
        let Some(body) = func.body_span() else {
            return;
        };
        let text = cx.text();
        let message = match returned {
            None if count == 0 => UNEXPECTED_EMPTY_BLOCK,
            None => UNEXPECTED_OTHER_BLOCK,
            Some((statement, Some(_)))
                if text.get(skip_trivia(text, statement.span().start + RETURN_LEN) as usize)
                    == Some(&b'{') =>
            {
                UNEXPECTED_OBJECT_BLOCK
            }
            Some(_) => UNEXPECTED_SINGLE_BLOCK,
        };
        cx.report(body, message).fix(|fixer| match returned {
            Some((statement, Some(argument))) => remove_block(fixer, e, body, statement, argument),
            _ => None,
        });
    }
}

impl Rule for ArrowBodyStyle {
    const META: Meta = Meta::eslint("arrow-body-style", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ArrowBodyStyle {
            mode: match options.str(0) {
                Some("always") => Mode::Always,
                Some("never") => Mode::Never,
                _ => Mode::AsNeeded,
            },
            require_return_for_object_literal: options
                .object(1)
                .bool_or("requireReturnForObjectLiteral", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Fn], Self::check);
    }
}
