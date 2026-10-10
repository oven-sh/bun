use bun_lint::prelude::*;

/// Disallow mixed binary operators.
pub struct NoMixedOperators {
    /// Each group as a set of operators: see [`bit`].
    groups: Vec<u32>,
    allows_same_precedence: bool,
}

const UNEXPECTED_MIXED_OPERATOR: Message = Message::new(
    "unexpectedMixedOperator",
    "Unexpected mix of '{{leftOperator}}' and '{{rightOperator}}'. Use parentheses to clarify the intended order of operations.",
);

const DEFAULT_GROUPS: [&[&str]; 5] = [
    &["+", "-", "*", "/", "%", "**"],
    &["&", "|", "^", "<<", ">>", ">>>"],
    &["==", "!=", "===", "!==", ">", ">=", "<", "<="],
    &["&&", "||"],
    &["in", "instanceof"],
];

const OPERATORS: [BinOp; 25] = [
    BinOp::Add,
    BinOp::Sub,
    BinOp::Mul,
    BinOp::Div,
    BinOp::Rem,
    BinOp::Pow,
    BinOp::Shl,
    BinOp::Shr,
    BinOp::UShr,
    BinOp::BitAnd,
    BinOp::BitOr,
    BinOp::BitXor,
    BinOp::Lt,
    BinOp::Le,
    BinOp::Gt,
    BinOp::Ge,
    BinOp::EqEq,
    BinOp::NotEq,
    BinOp::EqEqEq,
    BinOp::NotEqEq,
    BinOp::In,
    BinOp::Instanceof,
    BinOp::And,
    BinOp::Or,
    BinOp::Nullish,
];

/// `?:` in a set of operators.
const TERNARY: u32 = 1 << 31;

/// `op` in a set of operators.
fn bit(op: BinOp) -> u32 {
    1 << (op as u32)
}

/// The operator that is written `text` in a set of operators. `~`, which the schema allows, is
/// never the operator of a binary expression.
fn bit_of_text(text: &[u8]) -> u32 {
    if text == b"?:" {
        return TERNARY;
    }
    let mut operators = OPERATORS.iter();
    operators
        .find(|op| bin_op_text(**op).as_bytes() == text)
        .map_or(0, |op| bit(*op))
}

/// Where an operator is written, and its text.
type Operator = (Span, &'static str);

/// That of a binary or a conditional expression.
fn operator_of(e: Expr) -> Option<Operator> {
    match e.kind() {
        ExprKind::Binary { op, .. } => Some((e.operator_span()?, bin_op_text(op))),
        ExprKind::Cond { test, .. } => {
            let start = skip_trivia(e.file().text(), test.outer_span().end);
            Some((Span::new(start, start + 1), "?:"))
        }
        _ => None,
    }
}

impl Rule for NoMixedOperators {
    const META: Meta = Meta::eslint("no-mixed-operators", Kind::Suggestion).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Binary]).finish();
    /// The expressions that are mixed with their parents, each with the left and the right operator.
    type State<'a> = Vec<(Span, Operator, Operator)>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut groups: Vec<u32> = (options.array("groups").iter())
            .map(|group| {
                let operators = group.as_array().unwrap_or_default().iter();
                operators
                    .filter_map(Json::as_str)
                    .fold(0, |all, it| all | bit_of_text(it))
            })
            .collect();
        if groups.is_empty() {
            let set = |group: &&[&str]| {
                group
                    .iter()
                    .fold(0, |all, it| all | bit_of_text(it.as_bytes()))
            };
            groups = DEFAULT_GROUPS.iter().map(set).collect();
        }
        NoMixedOperators {
            groups,
            allows_same_precedence: options.bool_or("allowSamePrecedence", true),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.has_exprs([ExprTag::Binary]).then(Vec::new)
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, .. } = node.kind() else {
            return;
        };
        let Node::Expr(parent) = node.parent() else {
            return;
        };
        if op == BinOp::Comma {
            return;
        }
        let (parent_bit, first_child) = match parent.kind() {
            ExprKind::Binary {
                op: parent_op,
                left,
                ..
            } if parent_op != BinOp::Comma && parent_op != op => (bit(parent_op), left),
            ExprKind::Cond { test, .. } => (TERNARY, test),
            _ => return,
        };
        let both = bit(op) | parent_bit;
        if node.is_parenthesized()
            || !self.groups.iter().any(|group| group & both == both)
            || (self.allows_same_precedence
                && ast_utils::get_precedence(node) == ast_utils::get_precedence(parent))
        {
            return;
        }
        let (left, right) = if first_child == node {
            (node, parent)
        } else {
            (parent, node)
        };
        let (Some(left), Some(right)) = (operator_of(left), operator_of(right)) else {
            return;
        };
        cx.state.push((node.span(), left, right));
    }

    /// An operator can be reported for its own expression and for an operand: ESLint has the outer expression first.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut mixed = std::mem::take(&mut cx.state);
        mixed.sort_by_key(|it| (it.0.start, std::cmp::Reverse(it.0.end)));
        for (_, left, right) in mixed {
            for at in [left.0, right.0] {
                cx.report(at, UNEXPECTED_MIXED_OPERATOR)
                    .data("leftOperator", left.1)
                    .data("rightOperator", right.1);
            }
        }
    }
}
