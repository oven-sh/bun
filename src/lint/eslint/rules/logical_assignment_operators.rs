use bun_lint::prelude::*;

/// Require or disallow logical assignment operator shorthand.
pub struct LogicalAssignmentOperators {
    is_never: bool,
    check_if: bool,
}

const ASSIGNMENT: Message = Message::new(
    "assignment",
    "Assignment (=) can be replaced with operator assignment ({{operator}}).",
);
const USE_LOGICAL_OPERATOR: Message = Message::new(
    "useLogicalOperator",
    "Convert this assignment to use the operator {{ operator }}.",
);
const LOGICAL: Message = Message::new(
    "logical",
    "Logical expression can be replaced with an assignment ({{ operator }}).",
);
const CONVERT_LOGICAL: Message = Message::new(
    "convertLogical",
    "Replace this logical expression with an assignment with the operator {{ operator }}.",
);
const IF: Message = Message::new(
    "if",
    "'if' statement can be replaced with a logical operator assignment with operator {{ operator }}.",
);
const CONVERT_IF: Message = Message::new(
    "convertIf",
    "Replace this 'if' statement with a logical assignment with operator {{ operator }}.",
);
const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected logical operator assignment ({{operator}}) shorthand.",
);
const SEPARATE: Message = Message::new(
    "separate",
    "Separate the logical assignment into an assignment with a logical operator.",
);

const PRECEDENCE_OF_ASSIGNMENT_EXPR: i32 = 1;

fn is_logical(op: BinOp) -> bool {
    matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
}

/// `undefined` or `void 0`.
fn is_undefined(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Ident(name) if name.is("undefined") => ast_utils::is_reference_to_global_variable(e),
        ExprKind::Unary { op: UnOp::Void, operand } => matches!(operand.kind(), ExprKind::Number(n) if n == 0.0),
        _ => false,
    }
}

/// An `Identifier` or a `MemberExpression`. An optional chain is neither.
fn is_reference(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Ident(name) => !name.is("undefined"),
        ExprKind::Dot { .. } | ExprKind::Index { .. } => !e.is_in_optional_chain(),
        _ => false,
    }
}

/// Of the two operands of a comparison: the one that is taken for the reference, and the other.
fn reference_first<'a>(left: Expr<'a>, right: Expr<'a>) -> (Expr<'a>, Expr<'a>) {
    if is_reference(left) { (left, right) } else { (right, left) }
}

/// The `arg` of `Boolean(arg)`.
fn boolean_cast_argument(e: Expr<'_>) -> Option<Expr<'_>> {
    let call = e.as_call()?;
    let is_cast = !e.is_in_optional_chain()
        && call.callee().is_ident("Boolean")
        && call.args().len() == 1
        && ast_utils::is_reference_to_global_variable(call.callee());
    call.args().first().filter(|_| is_cast)
}

/// What a condition tests the existence of, and the operator that does the same:
/// - `value`, `Boolean(value)`, `!!value`
/// - `!value`, `!Boolean(value)`
/// - `value == null`, `value === undefined || value === null`
fn get_existence(expression: Expr<'_>) -> Option<(Expr<'_>, BinOp)> {
    let (base, truthiness) = match expression.kind() {
        ExprKind::Unary { op: UnOp::Not, operand } => (operand, BinOp::Or),
        _ => (expression, BinOp::And),
    };
    if is_reference(base) {
        return Some((base, truthiness));
    }
    if let ExprKind::Unary { op: UnOp::Not, operand } = base.kind()
        && is_reference(operand)
    {
        return Some((operand, BinOp::And));
    }
    if let Some(argument) = boolean_cast_argument(base)
        && is_reference(argument)
    {
        return Some((argument, truthiness));
    }
    let ExprKind::Binary { op, left, right } = expression.kind() else {
        return None;
    };
    match (op, left.kind(), right.kind()) {
        (BinOp::EqEq, ..) => {
            let (reference, nullish) = reference_first(left, right);
            (is_reference(reference) && (ast_utils::is_null_literal(nullish) || is_undefined(nullish)))
                .then_some((reference, BinOp::Nullish))
        }
        (
            BinOp::Or,
            ExprKind::Binary { op: BinOp::EqEqEq, left: first_left, right: first_right },
            ExprKind::Binary { op: BinOp::EqEqEq, left: second_left, right: second_right },
        ) => {
            let (first, first_nullish) = reference_first(first_left, first_right);
            let (second, second_nullish) = reference_first(second_left, second_right);
            (ast_utils::is_same_reference(first, second, false)
                && ((ast_utils::is_null_literal(first_nullish) && is_undefined(second_nullish))
                    || (is_undefined(first_nullish) && ast_utils::is_null_literal(second_nullish))))
            .then_some((first, BinOp::Nullish))
        }
        _ => None,
    }
}

/// Whether `e` is in the body of a `with` statement, in code that is not strict.
fn is_inside_with_block(e: Expr<'_>) -> bool {
    let mut inner = Node::Expr(e);
    for ancestor in inner.ancestors() {
        if let Node::Stmt(statement) = ancestor
            && let StmtKind::With { body, .. } = statement.kind()
            && Node::Stmt(body) == inner
        {
            return !e.file().scope().is_strict();
        }
        inner = ancestor;
    }
    false
}

/// Whether reading `e` cannot call a getter.
fn cannot_be_getter(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Ident && !is_inside_with_block(e)
}

/// Whether evaluating `e` reads a single property.
fn accesses_single_property(e: Expr<'_>) -> bool {
    if is_inside_with_block(e) {
        return e.tag() == ExprTag::Ident;
    }
    let is_base = |object: Expr| matches!(object.tag(), ExprTag::Ident | ExprTag::Super | ExprTag::This);
    match e.kind() {
        ExprKind::Dot { obj, .. } => is_base(obj),
        ExprKind::Index { obj, index, .. } => {
            is_base(obj) && !matches!(index.tag(), ExprTag::Dot | ExprTag::Index) && !index.is_in_optional_chain()
        }
        _ => false,
    }
}

/// Whether an assignment in the place of `logical` needs parentheses.
fn requires_outer_parenthesis(logical: Expr<'_>) -> bool {
    match logical.parent() {
        Node::Stmt(parent) => !matches!(parent.kind(), StmtKind::Expr(_)),
        // The body of an arrow function.
        Node::Func(_) => false,
        Node::Expr(parent) => {
            let precedence = ast_utils::get_precedence(parent);
            precedence == -1 || PRECEDENCE_OF_ASSIGNMENT_EXPR < precedence
        }
        _ => true,
    }
}

/// What is reported, and what the change is called where it is only suggested.
#[derive(Copy, Clone)]
struct Descriptor {
    node: Span,
    message: Message,
    suggestion: Message,
    operator: BinOp,
    should_be_fixed: bool,
}

impl LogicalAssignmentOperators {
    /// ESLint's `createConditionalFixer`. `fix` returns nothing if there are comments in the way.
    fn report<'a>(cx: &Cx<'a, Self>, descriptor: Descriptor, fix: impl FnOnce(Fixer<'a>) -> Vec<Fix>) {
        let operator = assign_op_text(Some(descriptor.operator));
        let report = cx.report(descriptor.node, descriptor.message).data("operator", operator);
        if descriptor.should_be_fixed {
            report.fix(fix);
        } else {
            report.suggest_with(descriptor.suggestion, &[("operator", operator.as_bytes())], fix);
        }
    }

    /// `"never"`: `a ||= b`
    fn check_logical_assignment<'a>(&self, assignment: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { op: Some(op), target, value } = assignment.kind() else {
            return;
        };
        if !is_logical(op) {
            return;
        }
        let descriptor = Descriptor {
            node: assignment.span(),
            message: UNEXPECTED,
            suggestion: SEPARATE,
            operator: op,
            should_be_fixed: cannot_be_getter(target),
        };
        Self::report(cx, descriptor, |fixer| {
            let Some(operator_token) = assignment.operator_span() else {
                return Vec::new();
            };
            if fixer.file().comments_in(assignment).next().is_some() {
                return Vec::new();
            }
            let operator = bin_op_text(op).as_bytes();
            let mut fixes = vec![
                fixer.replace(operator_token, "="),
                fixer.insert_after(operator_token, [&b" "[..], target.text(), b" ", operator].concat()),
            ];
            let has_lower_precedence =
                ast_utils::get_precedence(value) <= ast_utils::get_binary_operator_precedence(op);
            let is_mixed = op == BinOp::Nullish && ast_utils::is_logical_expression(value);
            if !ast_utils::is_parenthesised(value) && (has_lower_precedence || is_mixed) {
                fixes.push(fixer.insert_before(value, "("));
                fixes.push(fixer.insert_after(value, ")"));
            }
            fixes
        });
    }

    /// `a = a || b`
    fn check_assignment<'a>(&self, assignment: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { op: None, target, value } = assignment.kind() else {
            return;
        };
        let ExprKind::Binary { op, mut left, .. } = value.kind() else {
            return;
        };
        if !is_logical(op) {
            return;
        }
        // The leftmost operand of consecutive expressions with the same operator, unless
        // parentheses make the order of evaluation explicit, and the expression it is the left of.
        let mut parent = value;
        while !left.is_parenthesized()
            && let ExprKind::Binary { op: inner, left: next, .. } = left.kind()
            && inner == op
        {
            (parent, left) = (left, next);
        }
        if !ast_utils::is_same_reference(target, left, false) || utils::is_assignment_target(assignment) {
            return;
        }
        let descriptor = Descriptor {
            node: assignment.span(),
            message: ASSIGNMENT,
            suggestion: USE_LOGICAL_OPERATOR,
            operator: op,
            should_be_fixed: cannot_be_getter(target),
        };
        Self::report(cx, descriptor, |fixer| {
            let (Some(assignment_operator), Some(logical_operator)) =
                (assignment.operator_span(), parent.operator_span())
            else {
                return Vec::new();
            };
            let file = fixer.file();
            if file.comments_in(assignment).next().is_some() {
                return Vec::new();
            }
            let first_right_operand_token = skip_trivia(file.text(), logical_operator.end);
            vec![
                fixer.insert_before(assignment_operator, bin_op_text(op)),
                fixer.remove(Span::new(parent.span().start, first_right_operand_token)),
            ]
        });
    }

    /// `a || (a = b)`
    fn check_logical<'a>(&self, logical: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = logical.kind() else {
            return;
        };
        if !is_logical(op) {
            return;
        }
        let ExprKind::Assign { op: None, target, .. } = right.kind() else {
            return;
        };
        if !is_reference(left) || !ast_utils::is_same_reference(left, target, false) {
            return;
        }
        let descriptor = Descriptor {
            node: logical.span(),
            message: LOGICAL,
            suggestion: CONVERT_LOGICAL,
            operator: op,
            should_be_fixed: cannot_be_getter(left) || accesses_single_property(left),
        };
        Self::report(cx, descriptor, |fixer| {
            let Some(operator_token) = right.operator_span() else {
                return Vec::new();
            };
            if fixer.file().comments_in(logical).next().is_some() {
                return Vec::new();
            }
            let mut fixes = Vec::with_capacity(5);
            if !ast_utils::is_parenthesised(logical) && requires_outer_parenthesis(logical) {
                fixes.push(fixer.insert_before(logical, "("));
                fixes.push(fixer.insert_after(logical, ")"));
            }
            fixes.push(fixer.remove(Span::new(logical.span().start, right.span().start)));
            fixes.push(fixer.remove(Span::new(right.span().end, logical.span().end)));
            fixes.push(fixer.insert_before(operator_token, bin_op_text(op)));
            fixes
        });
    }

    /// `if (a) a = b`
    fn check_if_statement<'a>(&self, if_node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::If { test, yes, no: None } = if_node.kind() else {
            return;
        };
        let (body, has_body) = match yes.kind() {
            StmtKind::Block(statements) => match (statements.first(), statements.len()) {
                (Some(only), 1) => (only, true),
                _ => return,
            },
            _ => (yes, false),
        };
        let StmtKind::Expr(expression) = body.kind() else {
            return;
        };
        let ExprKind::Assign { op: None, target, .. } = expression.kind() else {
            return;
        };
        let Some((reference, operator)) = get_existence(test) else {
            return;
        };
        if !ast_utils::is_same_reference(reference, target, false) {
            return;
        }
        let is_logical_test = matches!(test.kind(), ExprKind::Binary { op, .. } if is_logical(op));
        let descriptor = Descriptor {
            node: if_node.span(),
            message: IF,
            suggestion: CONVERT_IF,
            operator,
            should_be_fixed: cannot_be_getter(reference) || (!is_logical_test && accesses_single_property(reference)),
        };
        Self::report(cx, descriptor, |fixer| {
            let file = fixer.file();
            let (Some(operator_token), Some(first_body_token)) = (expression.operator_span(), file.first_token(body))
            else {
                return Vec::new();
            };
            if file.comments_in(if_node).next().is_some() {
                return Vec::new();
            }
            // The assignment must not continue the statement before.
            if let Some(previous) = file.token_before(if_node)
                && !previous.is(";")
                && !previous.is("{")
                && !matches!(first_body_token.kind(), TokenKind::Identifier | TokenKind::Keyword)
            {
                return Vec::new();
            }
            let mut fixes = vec![
                fixer.insert_before(operator_token, bin_op_text(operator)),
                fixer.remove(Span::new(if_node.span().start, body.span().start)),
                fixer.remove(Span::new(body.span().end, if_node.span().end)),
            ];
            if has_body && file.token_after(expression).is_some_and(|next| !next.is(";")) {
                fixes.push(fixer.insert_after(if_node, ";"));
            }
            fixes
        });
    }
}

impl Rule for LogicalAssignmentOperators {
    const META: Meta = Meta::eslint("logical-assignment-operators", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let is_never = options.str(0) == Some("never");
        LogicalAssignmentOperators {
            is_never,
            check_if: !is_never && options.object(1).bool_or("enforceForIfStatements", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.is_never {
            on.exprs([ExprTag::Assign], Self::check_logical_assignment);
            return;
        }
        on.exprs([ExprTag::Assign], Self::check_assignment);
        on.exprs([ExprTag::Binary], Self::check_logical);
        if self.check_if {
            on.stmts([StmtTag::If], Self::check_if_statement);
        }
    }
}
