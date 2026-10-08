use bun_lint::prelude::*;

/// Enforce `return` statements in callbacks of array methods.
pub struct ArrayCallbackReturn {
    allow_implicit: bool,
    check_for_each: bool,
    allow_void: bool,
}

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

/// The name of the method of arrays that the function expression `func` is the callback of.
/// Generators are excluded. Async functions are allowed only for `Array.fromAsync`.
fn get_array_method_name(func: Func) -> Option<&'static str> {
    if func.is_generator() {
        return None;
    }
    let Node::Expr(mut current) = func.owner() else {
        return None;
    };
    loop {
        match current.parent() {
            Node::Expr(parent) => match parent.kind() {
                // `foo.every(nativeFoo || function foo() { .. })`
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                }
                | ExprKind::Cond { .. } => current = parent,
                ExprKind::Call(call) => {
                    let (callee, args) = (call.callee(), call.args());
                    let is_second = args.get(1) == Some(current);
                    if !func.is_async() {
                        if is_second && ast_utils::is_array_from_method(callee) {
                            return Some("from");
                        }
                        if args.first() == Some(current)
                            && let Some(name) = get_target_method(callee)
                        {
                            return Some(name);
                        }
                    }
                    return (is_second && ast_utils::is_array_from_async_method(callee)).then_some("fromAsync");
                }
                _ => return None,
            },
            // What a function that is called at once returns goes where the call is:
            // `foo.every((function() { return function callback() { .. }; })())`
            Node::Stmt(statement) if statement.tag() == StmtTag::Return => {
                let Node::Expr(upper) = ast_utils::get_upper_function(statement)?.owner() else {
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

    fn check_function<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Func(func) = node else {
            return;
        };
        if !matches!(func.kind(), FnKind::Expr | FnKind::Arrow) {
            return;
        }
        let Some(method) = get_array_method_name(func) else {
            return;
        };
        if method == "forEach" {
            if self.check_for_each {
                self.check_for_each_callback(func, cx);
            }
            return;
        }
        let mut has_return = false;
        for statement in func.returns() {
            has_return = true;
            if !self.allow_implicit && matches!(statement.kind(), StmtKind::Return(None)) {
                Self::report(cx, statement, EXPECTED_RETURN_VALUE, func, method);
            }
        }
        // If the end is reachable, there are paths which do not return or throw.
        if matches!(func.body(), FnBody::Block(_))
            && cx.state.last().is_some_and(|code_path| code_path.is_current_reachable())
        {
            let message = if has_return { EXPECTED_AT_END } else { EXPECTED_INSIDE };
            Self::report(cx, ast_utils::get_function_head_loc(func), message, func, method);
        }
    }

    /// Returning a value on any path is not allowed.
    fn check_for_each_callback<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>) {
        let is_allowed = |value: Expr<'a>| self.allow_void && is_expression_void(value);
        for statement in func.returns() {
            let StmtKind::Return(Some(argument)) = statement.kind() else {
                continue;
            };
            if is_allowed(argument) {
                continue;
            }
            let report = Self::report(cx, statement, EXPECTED_NO_RETURN_VALUE, func, "forEach");
            if self.allow_void {
                let start = statement.span().start;
                let keyword = Span::new(start, start + "return".len() as u32);
                report.suggest(PREPEND_VOID, |fixer| void_prepend_fixer(fixer, argument, keyword, true));
            }
        }
        let FnBody::Expr(body) = func.body() else {
            return;
        };
        if is_allowed(body) {
            return;
        }
        let head = ast_utils::get_function_head_loc(func);
        let report = Self::report(cx, head, EXPECTED_NO_RETURN_VALUE, func, "forEach")
            .suggest(WRAP_BRACES, |fixer| curly_wrap_fixer(fixer, func));
        if self.allow_void {
            report.suggest(PREPEND_VOID, |fixer| {
                Some(void_prepend_fixer(fixer, body, func.arrow_span()?, false))
            });
        }
    }
}

impl Rule for ArrayCallbackReturn {
    const META: Meta = Meta::eslint("array-callback-return", Kind::Problem).has_suggestions();
    /// The code paths around the current node.
    type State<'a> = Vec<CodePath<'a>>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        ArrayCallbackReturn {
            allow_implicit: options.bool_or("allowImplicit", false),
            check_for_each: options.bool_or("checkForEach", false),
            allow_void: options.bool_or("allowVoid", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<CodePath<'a>> {
        if !file.has_exprs([ExprTag::Fn]) || !file.has_exprs([ExprTag::Call]) {
            return Vec::new();
        }
        // TODO(api): replace by code_path::Func::is_end_reachable, which analyzes one function.
        on.code_path_start(|_, code_path, _, cx| cx.state.push(code_path));
        on.code_path_end(|_, _, _, cx| {
            cx.state.pop();
        });
        on.exit(NodeTags::FUNC, Self::check_function);
        Vec::new()
    }
}
