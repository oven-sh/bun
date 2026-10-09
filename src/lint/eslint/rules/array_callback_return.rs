use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce `return` statements in callbacks of array methods.
pub struct ArrayCallbackReturn {
    allow_implicit: bool,
    check_for_each: bool,
    allow_void: bool,
}

/// What oxlint says if the last statement is a `switch` without `default`, or an `if` without `else`.
const MAY_FALL_THROUGH_SWITCH: Message = Message::new(
    "mayFallThroughSwitch",
    "Callback for array method \"{{arrayMethodName}}\" may fall through a `switch` without returning",
);
const MAY_REACH_END_OF_IF: Message = Message::new(
    "mayReachEndOfIf",
    "Callback for array method \"{{arrayMethodName}}\" may reach the end of an `if` without returning",
);
const EXPECTED_AT_END: Message = Message::new(
    "expectedAtEnd",
    "{{arrayMethodName}}() expects a value to be returned at the end of {{name}}.",
);
const EXPECTED_INSIDE: Message = Message::new(
    "expectedInside",
    "{{arrayMethodName}}() expects a return value from {{name}}.",
);
const EXPECTED_RETURN_VALUE: Message = Message::new(
    "expectedReturnValue",
    "{{arrayMethodName}}() expects a return value from {{name}}.",
);
const EXPECTED_NO_RETURN_VALUE: Message = Message::new(
    "expectedNoReturnValue",
    "{{arrayMethodName}}() expects no useless return value from {{name}}.",
);
/// oxlint's `help` with `allowVoid`.
const EXPECTED_VOID: &str = "Expected the return expression to be started with `void`";
const WRAP_BRACES: Message = Message::new("wrapBraces", "Wrap the expression in `{}`.");
const PREPEND_VOID: Message = Message::new("prependVoid", "Prepend `void` to the expression.");

const TARGET_METHODS: [&str; 14] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
    "toSorted",
];

/// ESLint's `getPrecedence({ type: "UnaryExpression", operator: "void" })`.
const PRECEDENCE_OF_VOID: i32 = 16;

/// The one of `TARGET_METHODS` that `callee` is an access to.
fn get_target_method(callee: Expr) -> Option<&'static str> {
    let name = ast_utils::get_static_property_name(callee)?;
    TARGET_METHODS.into_iter().find(|it| *name == *it.as_bytes())
}

fn full_method_name(array_method_name: &str) -> String {
    let prefix = match array_method_name {
        "from" | "fromAsync" => "Array.",
        _ => "Array.prototype.",
    };
    [prefix, array_method_name].concat()
}

#[derive(Default)]
pub struct State<'a> {
    /// The outermost of the `&&`, `||`, `??` and `?:` that an expression is an operand of, or itself,
    /// and the parent of that.
    around_choices: AncestorMemo<'a, (Node<'a>, Node<'a>)>,
    /// ESLint's `getUpperFunction`.
    functions: AncestorMemo<'a, Func<'a>>,
}

/// The name of the method of arrays that the function expression `func` is the callback of, and what is called.
/// Generators are excluded. Async functions are allowed only for `Array.fromAsync`.
fn get_array_method_name<'a>(func: Func<'a>, state: &mut State<'a>) -> Option<(&'static str, Expr<'a>)> {
    if func.is_generator() {
        return None;
    }
    let Node::Expr(mut current) = func.owner() else {
        return None;
    };
    loop {
        // `foo.every(nativeFoo || function foo() { .. })`
        let (outermost, parent) = state.around_choices.find(Node::Expr(current), |child, parent| {
            let is_choice = matches!(parent, Node::Expr(parent) if matches!(
                parent.kind(),
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } | ExprKind::Cond { .. }
            ));
            (!is_choice).then_some((child, parent))
        })?;
        current = outermost.as_expr()?;
        match parent {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Call(call) => {
                    let (callee, args) = (call.callee(), call.args());
                    let is_second = args.get(1) == Some(current);
                    // oxlint looks only at a call without further arguments, and at no `from` but that of `Array`.
                    if current.file().language().is_oxlint
                        && (args.len() != if is_second { 2 } else { 1 }
                            || is_second
                                && !matches!(callee.kind(), ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                                    if obj.is_ident("Array")))
                    {
                        return None;
                    }
                    if !func.is_async() {
                        if is_second && ast_utils::is_array_from_method(callee) {
                            return Some(("from", callee));
                        }
                        if args.first() == Some(current)
                            && let Some(name) = get_target_method(callee)
                        {
                            return Some((name, callee));
                        }
                    }
                    return (is_second && ast_utils::is_array_from_async_method(callee))
                        .then_some(("fromAsync", callee));
                }
                _ => return None,
            },
            // What a function that is called at once returns goes where the call is:
            // `foo.every((function() { return function callback() { .. }; })())`
            Node::Stmt(statement) if statement.tag() == StmtTag::Return => {
                let function = state.functions.find(Node::Stmt(statement), |_, it| ast_utils::as_function(it));
                let Node::Expr(upper) = function?.owner() else {
                    return None;
                };
                if !ast_utils::is_callee(upper) {
                    return None;
                }
                current = upper.parent().as_expr()?;
            }
            _ => return None,
        }
    }
}

fn is_expression_void(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Unary { op: UnOp::Void, .. })
}

/// Puts `void ` before `node`, which follows the `return` or the `=>` at `return_or_arrow`.
fn void_prepend_fixer<'a>(fixer: Fixer<'a>, node: Expr<'a>, return_or_arrow: Span, is_return: bool) -> [Fix; 2] {
    let requires_parens =
        ast_utils::get_precedence(node) < PRECEDENCE_OF_VOID && !ast_utils::is_parenthesised(node);
    let first_token = skip_trivia(fixer.file().text(), return_or_arrow.end);
    // `=>` allows `void` to be adjacent.
    let prepend_space = is_return && return_or_arrow.end == first_token;
    let before = [
        if prepend_space { " " } else { "" },
        "void ",
        if requires_parens { "(" } else { "" },
    ];
    [
        fixer.insert_before(Span::empty(first_token), before.concat()),
        fixer.insert_after(node, if requires_parens { ")" } else { "" }),
    ]
}

/// Puts `{}` around the body of the arrow function `func`.
fn curly_wrap_fixer<'a>(fixer: Fixer<'a>, func: Func<'a>) -> Option<[Fix; 2]> {
    let first_token = skip_trivia(fixer.file().text(), func.arrow_span()?.end);
    Some([
        fixer.insert_before(Span::empty(first_token), "{"),
        fixer.insert_after(func.estree_span(), "}"),
    ])
}

impl ArrayCallbackReturn {
    fn report<'a>(
        cx: &Cx<'a, Self>,
        at: impl Spanned,
        message: Message,
        func: Func<'a>,
        array_method_name: &str,
    ) -> Report<'a> {
        cx.report(at, message)
            .data("name", ast_utils::get_function_name_with_kind(func))
            .data("arrayMethodName", full_method_name(array_method_name))
    }

    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(func.kind(), FnKind::Expr | FnKind::Arrow) {
            return;
        }
        let Some((method, callee)) = get_array_method_name(func, &mut cx.state) else {
            return;
        };
        if method == "forEach" {
            if self.check_for_each {
                self.check_for_each_callback(func, callee, cx);
            }
            return;
        }
        if cx.language().is_oxlint {
            return self.check_as_oxlint(func, method, cx);
        }
        let mut has_return = false;
        for statement in func.returns() {
            has_return = true;
            if !self.allow_implicit && matches!(statement.kind(), StmtKind::Return(None)) {
                Self::report(cx, statement, EXPECTED_RETURN_VALUE, func, method);
            }
        }
        // If the end is reachable, there are paths which do not return or throw.
        let FnBody::Block(body) = func.body() else {
            return;
        };
        let ends_with_jump =
            matches!(body.last().map(Stmt::tag), Some(StmtTag::Return | StmtTag::Throw));
        if !ends_with_jump && func.is_end_reachable() {
            let message = if has_return { EXPECTED_AT_END } else { EXPECTED_INSIDE };
            Self::report(cx, ast_utils::get_function_head_loc(func), message, func, method);
        }
    }

    /// oxlint reports a callback once: at its body, or at its head if it ends with an `if` without `else` or a `switch`
    /// without `default`.
    fn check_as_oxlint<'a>(&self, func: Func<'a>, method: &str, cx: &Cx<'a, Self>) {
        let FnBody::Block(body) = func.body() else {
            return;
        };
        // An `async` function returns something, unless there is nothing in it.
        if func.is_async() && (!body.is_empty() || self.allow_implicit) {
            return;
        }
        let (last, mut returns) = (body.last(), func.returns());
        let is_end_reachable =
            !matches!(last.map(Stmt::tag), Some(StmtTag::Return | StmtTag::Throw)) && func.is_end_reachable();
        let mut returns_nothing = || returns.any(|it| matches!(it.kind(), StmtKind::Return(None)));
        if !is_end_reachable && (self.allow_implicit || !returns_nothing()) {
            return;
        }
        let message = match last.map(Stmt::kind) {
            Some(StmtKind::Switch { cases, .. }) if !cases.iter().any(Case::is_default) => MAY_FALL_THROUGH_SWITCH,
            Some(StmtKind::If { no: None, .. }) => MAY_REACH_END_OF_IF,
            _ => EXPECTED_INSIDE,
        };
        let can_run_past_the_last = message.id != EXPECTED_INSIDE.id;
        let start = func.estree_span().start;
        let place = match can_run_past_the_last {
            true if func.is_arrow() => func.arrow_span(),
            true => func.params_span().map(|params| Span::new(start, params.start)),
            false => func.body_span(),
        };
        if let Some(place) = place {
            // The end of oxlint's `help`.
            let value_requirement = match self.allow_implicit {
                true => "",
                false => "\nReturn a value on each path (or enable `allowImplicit` to allow `return;`).",
            };
            Self::report(cx, place, message, func, method).data("value_requirement", value_requirement);
        }
    }

    /// Returning a value on any path is not allowed. `callee`: the `a.forEach`.
    fn check_for_each_callback<'a>(&self, func: Func<'a>, callee: Expr<'a>, cx: &Cx<'a, Self>) {
        let is_allowed = |value: Expr<'a>| self.allow_void && is_expression_void(value);
        // oxlint reports a callback once, at the name of the method.
        let place_of_oxlint = match callee.kind() {
            _ if !cx.language().is_oxlint => None,
            ExprKind::Dot { name, .. } => Some(name.span()),
            ExprKind::Index { index, .. } => Some(index.span()),
            _ => None,
        };
        for statement in func.returns() {
            let StmtKind::Return(Some(argument)) = statement.kind() else {
                continue;
            };
            if is_allowed(argument) {
                continue;
            }
            let place = place_of_oxlint.unwrap_or_else(|| statement.span());
            let mut report = Self::report(cx, place, EXPECTED_NO_RETURN_VALUE, func, "forEach");
            if self.allow_void && place_of_oxlint.is_some() {
                report = report.help(EXPECTED_VOID);
            }
            if self.allow_void {
                let start = statement.span().start;
                let keyword = Span::new(start, start + "return".len() as u32);
                report.suggest(PREPEND_VOID, |fixer| void_prepend_fixer(fixer, argument, keyword, true));
            }
            if place_of_oxlint.is_some() {
                return;
            }
        }
        let FnBody::Expr(body) = func.body() else {
            return;
        };
        if is_allowed(body) {
            return;
        }
        let head = place_of_oxlint.unwrap_or_else(|| ast_utils::get_function_head_loc(func));
        let mut report = Self::report(cx, head, EXPECTED_NO_RETURN_VALUE, func, "forEach")
            .suggest(WRAP_BRACES, |fixer| curly_wrap_fixer(fixer, func));
        if self.allow_void && place_of_oxlint.is_some() {
            report = report.help(EXPECTED_VOID);
        }
        if self.allow_void {
            report.suggest(PREPEND_VOID, |fixer| {
                Some(void_prepend_fixer(fixer, body, func.arrow_span()?, false))
            });
        }
    }
}

impl Rule for ArrayCallbackReturn {
    const META: Meta = Meta::eslint("array-callback-return", Kind::Problem).has_suggestions();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        ArrayCallbackReturn {
            allow_implicit: options.bool_or("allowImplicit", false),
            check_for_each: options.bool_or("checkForEach", false),
            allow_void: options.bool_or("allowVoid", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.has_exprs([ExprTag::Call]) {
            on.funcs(Self::check_function);
        }
        State::default()
    }
}
