use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{get_inner_expression, plain};
use smallvec::{SmallVec, smallvec};
use std::cell::OnceCell;

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

/// Where things are that few fixes ask for.
#[derive(Default)]
pub struct State<'a> {
    /// The start of the initializer of each `for`, in source order, with the greatest end of this
    /// one and those before it.
    for_loop_initializers: OnceCell<Vec<(u32, u32)>>,
    /// The end of the left side of each `in` operator, in ascending order.
    in_operators: OnceCell<Vec<u32>>,
    /// The object literals, in source order.
    objects: OnceCell<Vec<Expr<'a>>>,
}

impl<'a> State<'a> {
    /// The object literal that starts at `offset`.
    fn object_at(&self, file: &'a File<'a>, offset: u32) -> Option<Expr<'a>> {
        let objects = self.objects.get_or_init(|| {
            let mut objects: Vec<_> = file.exprs_of_kind(ExprTag::Object).collect();
            utils::sort::sort_unstable_by_key(&mut objects, |it| it.span().start);
            objects
        });
        let at = objects.binary_search_by_key(&offset, |it| it.span().start).ok()?;
        objects.get(at).copied()
    }

    /// ESLint's `isInsideForLoopInitializer`.
    fn is_inside_for_loop_initializer(&self, e: Expr<'_>) -> bool {
        let initializers = self.for_loop_initializers.get_or_init(|| {
            let initializers = e.file().stmts_of_kind(StmtTag::For).filter_map(|statement| match statement.kind() {
                StmtKind::For { init: Some(init), .. } => Some(match init.kind() {
                    StmtKind::Expr(head) => head.span(),
                    _ => init.span(),
                }),
                _ => None,
            });
            let mut initializers: Vec<_> = initializers.map(|it| (it.start, it.end)).collect();
            initializers.sort_unstable();
            let mut greatest_end = 0;
            for (_, end) in &mut initializers {
                greatest_end = greatest_end.max(*end);
                *end = greatest_end;
            }
            initializers
        });
        let start = e.span().start;
        let before = initializers.partition_point(|it| it.0 <= start);
        before.checked_sub(1).and_then(|last| initializers.get(last)).is_some_and(|it| it.1 > start)
    }

    /// Whether there is an `in` operator anywhere in `e`.
    fn has_in_operator(&self, e: Expr<'_>) -> bool {
        let operators = self.in_operators.get_or_init(|| {
            let operators = e.file().exprs_of_kind(ExprTag::Binary).filter_map(|it| match it.kind() {
                ExprKind::Binary { op: BinOp::In, left, .. } => Some(left.span().end),
                _ => None,
            });
            let mut operators: Vec<_> = operators.collect();
            operators.sort_unstable();
            operators
        });
        let span = e.span();
        operators.get(operators.partition_point(|&it| it < span.start)).is_some_and(|&it| it < span.end)
    }
}

/// Makes an expression of the body `{ return argument; }`, which is at `body`.
fn remove_block<'a>(
    fixer: Fixer<'a>,
    state: &State<'a>,
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
        || (state.is_inside_for_loop_initializer(arrow) && state.has_in_operator(arrow)))
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
fn add_block<'a>(fixer: Fixer<'a>, state: &State<'a>, arrow: Expr<'a>, func: Func<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let text = file.text();
    let first = skip_trivia(text, func.arrow_span()?.end);
    let second = skip_trivia(text, first + 1);
    let end = Span::empty(arrow.span().end);

    let is_paren_and_brace =
        text.get(first as usize) == Some(&b'(') && text.get(second as usize) == Some(&b'{');
    let parenthesised_object_literal = is_paren_and_brace
        .then(|| state.object_at(file, second))
        .flatten()
        .filter(|it| !utils::is_assignment_target(*it));

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

/// oxlint's `starts_with_object_literal`
fn starts_with_object_literal(e: Expr) -> bool {
    let mut at = Some(e).filter(|it| !it.is_chain_root());
    while let Some(e) = at {
        let leftmost = match e.kind() {
            ExprKind::Object(_) => return true,
            ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => obj,
            ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => call.callee(),
            ExprKind::Binary { op, left, .. } if op != BinOp::Comma => left,
            ExprKind::Cond { test, .. } => test,
            _ => return false,
        };
        at = plain(leftmost);
    }
    false
}

/// oxlint's `contains_in_operator`
fn contains_in_operator(e: Expr) -> bool {
    let mut pending: SmallVec<[Expr; 8]> = smallvec![e];
    while let Some(e) = pending.pop() {
        let inner = get_inner_expression(e);
        if inner.is_chain_root() {
            continue;
        }
        match inner.kind() {
            // `#a in b` is another kind of node.
            ExprKind::Binary { op: BinOp::In, left, .. } if left.tag() == ExprTag::PrivateIdentifier => {}
            ExprKind::Binary { op: BinOp::In, .. } => return true,
            ExprKind::Binary { left, right, .. } => pending.extend([left, right]),
            ExprKind::Cond { test, yes, no } => pending.extend([test, yes, no]),
            ExprKind::Assign { value, .. } => pending.push(value),
            _ => {}
        }
    }
    false
}

/// oxlint's `is_inside_for_loop_init`. It does not look at what `arrow` is directly in.
fn is_inside_for_loop_init(arrow: Expr) -> bool {
    for ancestor in Node::Expr(arrow).ancestors() {
        match ancestor {
            Node::Stmt(statement) => {
                if let StmtKind::For { init, .. } = statement.kind() {
                    return init.is_some_and(|init| {
                        init.span().contains(arrow.span())
                            && !matches!(init.kind(), StmtKind::Expr(head) if head == arrow && !arrow.is_parenthesized())
                    });
                }
            }
            Node::Func(func) if !matches!(func.kind(), FnKind::StaticBlock) => return false,
            _ => {}
        }
    }
    false
}

/// oxlint's `fix_block_to_concise`: the braces, `return` with one blank after it, and the `;` go. The rest stays.
fn remove_block_as_oxlint<'a>(
    fixer: Fixer<'a>,
    arrow: Expr<'a>,
    body: Span,
    statement: Stmt<'a>,
    argument: Expr<'a>,
) -> Vec<Fix> {
    let inner = get_inner_expression(argument);
    let needs_parens = !argument.is_parenthesized()
        && (starts_with_object_literal(inner)
            || inner.binary_op() == Some(BinOp::Comma)
            || contains_in_operator(argument) && is_inside_for_loop_init(arrow));
    let start = statement.span().start;
    let after_keyword = fixer.file().text().get((start + RETURN_LEN) as usize);
    let has_blank = after_keyword.is_some_and(u8::is_ascii_whitespace);
    let mut fixes = vec![
        fixer.replace(Span::new(body.start, body.start + 1), if needs_parens { "(" } else { "" }),
        fixer.remove(Span::new(start, start + RETURN_LEN + u32::from(has_blank))),
    ];
    fixes.extend(statement.semicolon().map(|it| fixer.remove(it)));
    fixes.push(fixer.replace(Span::new(body.end - 1, body.end), if needs_parens { ")" } else { "" }));
    fixes
}

/// oxlint's `fix_concise_to_block`. Of an object literal it leaves out what is around it.
fn add_block_as_oxlint<'a>(fixer: Fixer<'a>, body: Expr<'a>) -> Fix {
    let inner = get_inner_expression(body);
    let returned = if inner.tag() == ExprTag::Object { inner.span() } else { body.outer_span() };
    fixer.replace(body.outer_span(), [&b"{return "[..], fixer.file().slice(returned), b"}"].concat())
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
                    // For oxlint the parentheses are part of the body.
                    match cx.language().is_oxlint {
                        true => (cx.report(body.outer_span(), EXPECTED_BLOCK))
                            .fix(|fixer| add_block_as_oxlint(fixer, body)),
                        false => cx.report(body, EXPECTED_BLOCK).fix(|fixer| add_block(fixer, &cx.state, e, func)),
                    };
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
                // oxlint does not look into parentheses.
                && argument.is_some_and(|it| {
                    it.tag() == ExprTag::Object && !(cx.language().is_oxlint && it.is_parenthesized())
                })
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
            Some((statement, Some(argument))) if cx.language().is_oxlint => {
                Some(remove_block_as_oxlint(fixer, e, body, statement, argument))
            }
            Some((statement, Some(argument))) => remove_block(fixer, &cx.state, e, body, statement, argument),
            _ => None,
        });
    }
}

impl Rule for ArrowBodyStyle {
    const META: Meta = Meta::eslint("arrow-body-style", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = State<'a>;

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.exprs([ExprTag::Fn], Self::check);
        State::default()
    }
}
