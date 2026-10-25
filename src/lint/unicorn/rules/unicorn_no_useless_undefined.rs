use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::is_method_call;

/// Disallow useless `undefined`.
pub struct NoUselessUndefined {
    check_arguments: bool,
    check_arrow_function_body: bool,
}

const NO_USELESS_UNDEFINED: Message = Message::new("", "Do not use useless `undefined`.");

pub struct State<'a> {
    undefined: Name<'a>,
    /// Caches whether the enclosing function has a return type.
    return_types: AncestorMemo<'a, bool>,
    /// The start of the first optional parameter, for a function with many parameters.
    first_optional_parameters: IdMap<Func<'a>, Option<u32>>,
}

impl Rule for NoUselessUndefined {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-useless-undefined", Kind::Suggestion)
        .fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Ident]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUselessUndefined {
            check_arguments: options.bool_or("checkArguments", true),
            check_arrow_function_body: options.bool_or("checkArrowFunctionBody", true),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State {
            undefined: file.find_name("undefined")?,
            return_types: AncestorMemo::default(),
            first_optional_parameters: IdMap::new(),
        })
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if expr.as_ident() == Some(cx.state.undefined) {
            self.check_identifier(expr, cx);
        }
    }
}

impl NoUselessUndefined {
    fn check_identifier<'a>(&self, undefined_literal: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        let end = undefined_literal.span().end;
        let is_this_undefined = |e: Option<Expr<'a>>| e == Some(undefined_literal);
        // In TypeScript, a function that ends in `return;` returns `void`, not `undefined`, and `let a;` has no type.
        let is_untyped = undefined_literal.file().is_javascript();
        // The span to replace, the replacement, and whether the program still behaves the same and type checks
        // afterwards.
        let (replaced, replacement, is_safe) = match undefined_literal.parent() {
            // `return undefined`
            Node::Stmt(ret_stmt) if ret_stmt.tag() == StmtTag::Return => {
                (Replaced::AfterReturn(ret_stmt), "", is_untyped)
            }
            // `yield undefined`
            Node::Expr(yield_expr)
                if matches!(yield_expr.kind(), ExprKind::Yield { star: false, .. }) =>
            {
                (Replaced::Span(yield_expr.span()), "yield", true)
            }
            // `foo(undefined)`
            Node::Expr(call) if self.check_arguments && call.tag() == ExprTag::Call => {
                return check_call(call, undefined_literal, cx);
            }
            // `() => undefined`
            Node::Func(arrow)
                if self.check_arrow_function_body && matches!(arrow.body(), FnBody::Expr(_)) =>
            {
                (
                    Replaced::Span(undefined_literal.outer_span()),
                    "{}",
                    is_untyped,
                )
            }
            // `let foo = undefined` / `var foo = undefined`
            Node::VarDecl(declarator)
                if is_this_undefined(declarator.init()) && declarator.var_kind() != VarKind::Const =>
            {
                // A `var` without an initializer keeps its value from the previous loop iteration.
                (
                    Replaced::Span(Span::new(declarator.pat().span().end, end)),
                    "",
                    is_untyped && declarator.var_kind() == VarKind::Let,
                )
            }
            // `const {foo = undefined} = {}`
            Node::PatProp(property) if is_this_undefined(property.default()) => (
                Replaced::Span(Span::new(property.value().span().end, end)),
                "",
                true,
            ),
            Node::PatElem(element) if is_this_undefined(element.default()) => match element.pat() {
                Some(left) => (Replaced::Span(Span::new(left.span().end, end)), "", true),
                None => return,
            },
            // `function foo(bar = undefined) {}`
            Node::Param(parameter)
                if is_this_undefined(parameter.default()) && !undefined_literal.is_parenthesized() =>
            {
                // Without the default the parameter is required, which isn't allowed after an optional parameter.
                let Some(func) = parameter.func() else {
                    return;
                };
                let first_optional = || {
                    func.params()
                        .iter()
                        .find(|it| !it.is_rest() && it.is_optional())
                        .map(|it| it.span().start)
                };
                let first_optional = match func.params().len() {
                    0..=8 => first_optional(),
                    _ => *state
                        .first_optional_parameters
                        .get_or_insert_with(func, first_optional),
                };
                if first_optional.is_some_and(|it| it < parameter.span().start) {
                    return;
                }
                let left = parameter
                    .ty()
                    .map_or_else(|| parameter.pat().span().end, |it| it.annotation_span().end);
                // A function's `length` counts the parameters before the first default, so removing a default can
                // change it.
                (Replaced::Span(Span::new(left, end)), "", false)
            }
            _ => return,
        };
        let is_yield = replacement == "yield";
        if !is_yield
            && state
                .return_types
                .find(Node::Expr(undefined_literal), has_function_return_type)
                == Some(true)
        {
            return;
        }
        cx.report(undefined_literal, NO_USELESS_UNDEFINED)
            .fix_where_safe(|| is_safe, |fixer| {
                let span = match replaced {
                    Replaced::Span(span) => span,
                    Replaced::AfterReturn(ret_stmt) => {
                        let start = fixer
                            .file()
                            .comments_in(ret_stmt)
                            .next_back()
                            .map_or_else(|| ret_stmt.span().start + 6, |it| it.end());
                        Span::new(start, end)
                    }
                };
                (span.start <= span.end)
                    .then(|| fixer.replace(span, replacement))
                    .filter(|it| fixer.keeps_comments(it))
            });
    }
}

#[derive(Copy, Clone)]
enum Replaced<'a> {
    Span(Span),
    /// Starts after the `return`, or after the last comment in the statement.
    AfterReturn(Stmt<'a>),
}

fn has_function_return_type<'a>(_: Node<'a>, parent: Node<'a>) -> Option<bool> {
    let func = parent.as_func()?;
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
    .then(|| func.return_type().is_some())
}

const FUNCTION_NAMES: [&str; 27] = [
    "add",
    // `React.createContext(undefined)`
    "createContext",
    "equal",
    "has",
    "include",
    "includes",
    "is",
    "not",
    "notEqual",
    "notPropertyVal",
    "notSame",
    "notStrictEqual",
    "property",
    "propertyVal",
    "push",
    // Vue's `ref(undefined)`
    "ref",
    "same",
    "set",
    "strictEqual",
    "strictNotSame",
    "strictSame",
    "toBe",
    "toContain",
    "toContainEqual",
    "toEqual",
    "toHaveBeenCalledWith",
    "unshift",
];

fn should_ignore(callee: Expr) -> bool {
    let name = match callee.kind() {
        ExprKind::Ident(name) => name,
        ExprKind::Dot { name, .. } if !callee.is_private_member() => name.name(),
        _ => return false,
    };
    // `setState(undefined)`
    !callee.is_parenthesized() && (name.bytes().starts_with(b"set") || name.is_any(&FUNCTION_NAMES))
}

/// `e` is a call that directly contains an `undefined`. It's only checked once, for the last argument.
fn check_call<'a>(e: Expr<'a>, undefined_literal: Expr<'a>, cx: &Cx<'a, NoUselessUndefined>) {
    let Some(call_expr) = e.as_call() else {
        return;
    };
    let undefined = cx.state.undefined;
    let arguments = call_expr.args();
    if arguments.last() != Some(undefined_literal) {
        return;
    }
    let undefined_count = arguments
        .iter()
        .rev()
        .take_while(|it| it.as_ident() == Some(undefined) && !it.is_parenthesized())
        .count();
    if undefined_count == 0 || should_ignore(call_expr.callee()) {
        return;
    }
    // Skip the arguments of `Function#bind()`, except `this`.
    if arguments.len() != 1
        && !call_expr.is_optional()
        && is_method_call(call_expr, None, Some(&["bind"]), None, None)
    {
        return;
    }
    let remaining_count = arguments.len() - undefined_count;
    let (Some(first_undefined), Some(last_undefined)) =
        (arguments.get(remaining_count), arguments.last())
    else {
        return;
    };
    // oxlint's rule is called with the call.
    let report = cx
        .report(first_undefined, NO_USELESS_UNDEFINED)
        .called_with(e);
    let report = arguments
        .iter()
        .skip(remaining_count + 1)
        .fold(report, |report, it| report.label(it, ""));
    // `String(undefined)` isn't `String()`, and a function can check `arguments.length`.
    report.fix_dangerously(|fixer| {
        fixer.remove(
            match remaining_count
                .checked_sub(1)
                .and_then(|it| arguments.get(it))
            {
                Some(previous_argument) => Span::new(
                    previous_argument.outer_span().end,
                    last_undefined.span().end,
                ),
                // Including the trailing comma.
                None => Span::new(first_undefined.span().start, e.span().end.saturating_sub(1)),
            },
        )
    });
}
