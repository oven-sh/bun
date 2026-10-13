use bun_lint::prelude::*;
use bun_lint::types::tsutils::union_constituents;
use bun_lint::types::utils::{get_constrained_type_at_location, is_builtin_symbol_like, is_type_flag_set};
use bun_lint::types::{SymbolFlags, Type, TypeFlags};
use bun_lint::utils::ts_utils::{
    WrappingFixerParams, get_wrapping_fixer_for_chain_element, get_wrapping_fixer_without_wrap,
    is_strong_precedence_node,
};

/// Disallow conversion idioms when they do not change the type or value of the expression.
pub struct NoUnnecessaryTypeConversion;

const SUGGEST_REMOVE: Message = Message::new("suggestRemove", "Remove the type conversion.");
const SUGGEST_SATISFIES: Message = Message::new(
    "suggestSatisfies",
    "Instead, assert that the value satisfies the {{type}} type.",
);
const UNNECESSARY_TYPE_CONVERSION: Message = Message::new(
    "unnecessaryTypeConversion",
    "{{violation}} does not change the type or value of the {{type}}.",
);

fn is_enum_type(ty: Type) -> bool {
    ty.has_flags(TypeFlags::ENUM_LIKE)
}

fn is_enum_member_type(ty: Type) -> bool {
    ty.get_symbol().is_some_and(|symbol| symbol.has_flags(SymbolFlags::ENUM_MEMBER))
}

fn does_underlying_type_match_flag(ty: Type, type_flag: TypeFlags) -> bool {
    union_constituents(ty).iter().all(|t| is_type_flag_set(t, type_flag))
}

/// The type of an operand. tsgolint takes the constraint of a type parameter for it.
fn type_of_operand(e: Expr<'_>) -> Type<'_> {
    match e.file().language().is_oxlint {
        true => get_constrained_type_at_location(e),
        false => e.ty(),
    }
}

/// For tsgolint `('')` is a `ParenthesizedExpression`, not a string literal.
fn is_empty_string_literal(e: Expr) -> bool {
    e.as_string().is_some_and(|value| value.bytes().is_empty())
        && !(e.file().language().is_oxlint && e.is_parenthesized())
}

/// tsgolint's `IsStrongPrecedenceNode`: parentheses are a node that is one, and so are all of an optional chain and a
/// template without substitutions.
fn is_strong_precedence_node_for_tsgolint(e: Expr<'_>) -> bool {
    e.is_parenthesized()
        || match e.kind() {
            ExprKind::Call(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => true,
            ExprKind::Template(template) => template.exprs().is_empty(),
            _ => is_strong_precedence_node(e),
        }
}

/// `node` is the object of a member access, the callee of a call or of a `new`, or the tag of a template.
fn is_object_or_callee<'a>(node: Expr<'a>, parent: Expr<'a>) -> bool {
    match parent.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == node,
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => call.callee() == node,
        _ => false,
    }
}

/// tsgolint's `isWeakPrecedenceParent`: an assignment and a sequence are a `BinaryExpression` for it, and `typeof`,
/// `void` and `delete` are no `PrefixUnaryExpression`.
fn is_weak_precedence_parent_for_tsgolint(node: Expr<'_>) -> bool {
    let Node::Expr(parent) = node.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::Binary { .. } | ExprKind::Assign { .. } | ExprKind::Cond { .. } | ExprKind::Await(_) => true,
        // Not in tsgolint: `a satisfies string!` does not parse.
        ExprKind::NonNull(_) => true,
        ExprKind::Unary { op, .. } => !matches!(op, UnOp::Typeof | UnOp::Void | UnOp::Delete),
        _ => is_object_or_callee(node, parent),
    }
}

/// Whether an optional chain that is put in the place of `node` would go on with what follows `node`.
fn continues_chain(mut node: Expr<'_>) -> bool {
    loop {
        let Node::Expr(parent) = node.parent() else {
            return false;
        };
        if node.is_parenthesized() {
            return false;
        }
        match parent.kind() {
            ExprKind::NonNull(_) => node = parent,
            _ => return is_object_or_callee(node, parent),
        }
    }
}

/// The body of an `if`, of a loop, of a label or of a `with`: no statement is left there if it is removed.
fn is_embedded_statement(statement: Stmt<'_>) -> bool {
    let Node::Stmt(owner) = statement.parent() else {
        return false;
    };
    match owner.tag() {
        StmtTag::If
        | StmtTag::For
        | StmtTag::ForIn
        | StmtTag::ForOf
        | StmtTag::While
        | StmtTag::DoWhile
        | StmtTag::Labeled => true,
        // A `with` statement.
        StmtTag::Block => owner.as_block().is_none(),
        _ => false,
    }
}

/// tsgolint's `buildWrappingFix`. With `primitive_type` the inner node `satisfies` it, without only the inner node stays.
fn build_wrapping_fix<'a>(
    fixer: Fixer<'a>,
    node: Expr<'a>,
    inner_node: Expr<'a>,
    primitive_type: Option<&str>,
) -> Fix {
    let text = fixer.file().slice(inner_node.outer_span());
    // tsgolint leaves `a?.b` bare before `.c`, `()` and a template too, which then are a part of the chain or do not parse.
    let needs_parentheses = !is_strong_precedence_node_for_tsgolint(inner_node)
        || primitive_type.is_none()
            && inner_node.is_chain_root()
            && !inner_node.is_parenthesized()
            && continues_chain(node);
    let mut code = match needs_parentheses {
        true => [b"(".as_slice(), text, b")".as_slice()].concat(),
        false => text.to_vec(),
    };
    if let Some(primitive_type) = primitive_type {
        code.extend_from_slice(b" satisfies ");
        code.extend_from_slice(primitive_type.as_bytes());
        if is_weak_precedence_parent_for_tsgolint(node) && !node.is_parenthesized() {
            code = [b"(".as_slice(), code.as_slice(), b")".as_slice()].concat();
        }
    }
    // Not in tsgolint: after a line without a `;` the result would be a call or an access of what that line ends with.
    if matches!(code.first(), Some(b'(' | b'[' | b'`'))
        && ast_utils::is_start_of_expression_statement(node)
        && ast_utils::needs_preceding_semicolon(node)
    {
        code.insert(0, b';');
    }
    fixer.replace(node, code)
}

#[derive(Copy, Clone)]
struct Conversion<'a> {
    loc: Span,
    violation: &'static str,
    type_string: &'static str,
    /// What the suggestions replace.
    node: Expr<'a>,
    /// What they keep of it.
    inner_node: Expr<'a>,
}

type Context<'a> = Cx<'a, NoUnnecessaryTypeConversion>;

fn report<'a>(cx: &Context<'a>, conversion: &Conversion<'a>) {
    let Conversion {
        loc,
        violation,
        type_string,
        node,
        inner_node,
    } = *conversion;
    // Nothing is left of the statement `a += '';`.
    let statement = match (node.kind(), node.parent()) {
        (ExprKind::Assign { .. }, Node::Stmt(parent)) if matches!(parent.kind(), StmtKind::Expr(_)) => {
            Some(parent)
        }
        _ => None,
    };
    // For tsgolint parentheses are a part of the operand, and a `+` goes up to it.
    let operand = inner_node.outer_span();
    let loc = match (cx.language().is_oxlint, node.kind()) {
        (true, ExprKind::Unary { op: UnOp::Plus, .. }) => Span::new(loc.start, operand.start),
        (true, ExprKind::Binary { .. }) if loc.start < operand.start => Span::new(loc.start, operand.start),
        (true, ExprKind::Binary { .. }) => Span::new(operand.end, loc.end),
        _ => loc,
    };
    let is_oxlint = cx.language().is_oxlint;
    // oxlint points at what is converted.
    cx.report(if is_oxlint { operand } else { loc }, UNNECESSARY_TYPE_CONVERSION)
        .comments_apply_at(loc)
        .data("type", type_string)
        .data("violation", violation)
        .labels_with(|labels| {
            let ty = type_of_operand(inner_node).to_text();
            labels.first(format!("This expression already has type '{}'.", bstr::BStr::new(&ty)));
            labels.push(loc, "");
        })
        .suggest(SUGGEST_REMOVE, |fixer| match statement {
            // tsgolint removes the body of an `if` or of a loop too, which leaves `if (a) else` or gives the loop the next
            // statement.
            Some(statement) if !is_oxlint || !is_embedded_statement(statement) => fixer.remove(statement),
            _ if is_oxlint => build_wrapping_fix(fixer, node, inner_node, None),
            _ => get_wrapping_fixer_without_wrap(fixer, node, &[inner_node]),
        })
        .suggest_with(SUGGEST_SATISFIES, &[("type", type_string.as_bytes())], |fixer| match is_oxlint {
            true => build_wrapping_fix(fixer, node, inner_node, Some(type_string)),
            false => get_wrapping_fixer_for_chain_element(
                fixer,
                WrappingFixerParams {
                    node,
                    inner_nodes: &[inner_node],
                    wrap: |code: &[&[u8]]| [code[0], b" satisfies ", type_string.as_bytes()].concat(),
                },
            ),
        });
}

fn check_assignment<'a>(node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Assign {
        op: Some(BinOp::Add),
        target,
        value,
    } = node.kind()
    else {
        return;
    };
    // tsgolint looks at a name only.
    if cx.language().is_oxlint && (target.tag() != ExprTag::Ident || target.is_parenthesized()) {
        return;
    }
    if is_empty_string_literal(value) && does_underlying_type_match_flag(type_of_operand(target), TypeFlags::STRING_LIKE) {
        report(
            cx,
            &Conversion {
                loc: node.span(),
                violation: "Concatenating a string with ''",
                type_string: "string",
                node,
                inner_node: target,
            },
        );
    }
}

fn check_binary<'a>(node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Binary {
        op: BinOp::Add,
        left,
        right,
    } = node.kind()
    else {
        return;
    };
    if is_empty_string_literal(right) && does_underlying_type_match_flag(type_of_operand(left), TypeFlags::STRING_LIKE) {
        report(
            cx,
            &Conversion {
                loc: Span::new(left.span().end, node.span().end),
                violation: "Concatenating a string with ''",
                type_string: "string",
                node,
                inner_node: left,
            },
        );
    } else if is_empty_string_literal(left)
        && does_underlying_type_match_flag(type_of_operand(right), TypeFlags::STRING_LIKE)
    {
        report(
            cx,
            &Conversion {
                loc: Span::new(node.span().start, right.span().start),
                violation: "Concatenating '' with a string",
                type_string: "string",
                node,
                inner_node: right,
            },
        );
    }
}

fn check_call<'a>(node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Call(call) = node.kind() else {
        return;
    };
    let callee = call.callee();
    let (object, property) = match callee.kind() {
        ExprKind::Ident(name) => return check_built_in_call(node, call, name, cx),
        ExprKind::Dot { obj, name, .. } if name.bytes() == b"toString" => (obj, name.span()),
        // tsgolint looks at a `PropertyAccessExpression` only.
        ExprKind::Index { obj, index, .. } if !cx.language().is_oxlint && index.is_ident("toString") => {
            (obj, index.span())
        }
        _ => return,
    };
    // `(a?.toString)()` calls a `ChainExpression`. tsgolint leaves a callee in parentheses and a call
    // with arguments alone.
    if callee.is_chain_root()
        || cx.language().is_oxlint && (callee.is_parenthesized() || !call.args().is_empty())
    {
        return;
    }
    let ty = get_constrained_type_at_location(object);
    if is_enum_type(ty) || is_enum_member_type(ty) {
        return;
    }
    if does_underlying_type_match_flag(ty, TypeFlags::STRING_LIKE) {
        report(
            cx,
            &Conversion {
                loc: Span::new(property.start, node.span().end),
                violation: "Calling a string's .toString() method",
                type_string: "string",
                node,
                inner_node: object,
            },
        );
    }
}

fn check_built_in_call<'a>(node: Expr<'a>, call: Call<'a>, name: Name<'a>, cx: &Context<'a>) {
    let (type_flag, type_string, violation, builtins) = match name.bytes() {
        b"BigInt" => (
            TypeFlags::BIG_INT_LIKE,
            "bigint",
            "Passing a bigint to BigInt()",
            &["BigInt", "BigIntConstructor"],
        ),
        b"Boolean" => (
            TypeFlags::BOOLEAN_LIKE,
            "boolean",
            "Passing a boolean to Boolean()",
            &["Boolean", "BooleanConstructor"],
        ),
        b"Number" => (
            TypeFlags::NUMBER_LIKE,
            "number",
            "Passing a number to Number()",
            &["Number", "NumberConstructor"],
        ),
        b"String" => (
            TypeFlags::STRING_LIKE,
            "string",
            "Passing a string to String()",
            &["String", "StringConstructor"],
        ),
        _ => return,
    };
    let callee = call.callee();
    let Some(argument) = call.args().first() else {
        return;
    };
    if cx.language().is_oxlint {
        // tsgolint wants a name that is not in parentheses and one argument that is no spread, and
        // asks the type of the callee, not what the name is bound to.
        if callee.is_parenthesized()
            || call.args().len() > 1
            || argument.tag() == ExprTag::Spread
            || !is_builtin_symbol_like(callee.ty(), builtins)
            || !does_underlying_type_match_flag(get_constrained_type_at_location(argument), type_flag)
        {
            return;
        }
    } else if callee.symbol().is_some()
        || !does_underlying_type_match_flag(get_constrained_type_at_location(argument), type_flag)
        || Node::Expr(node).scope().resolve_name(name).is_some()
    {
        return;
    }
    report(
        cx,
        &Conversion {
            loc: callee.span(),
            violation,
            type_string,
            node,
            inner_node: argument,
        },
    );
}

/// tsgolint compares the value with its `math.Trunc`, which holds for an infinite one.
fn is_integer_literal_type(ty: Type, is_oxlint: bool) -> bool {
    is_type_flag_set(ty, TypeFlags::NUMBER_LITERAL)
        && ty
            .number_value()
            .is_some_and(|value| value.fract() == 0.0 || is_oxlint && value.is_infinite())
}

fn check_unary<'a>(outer_node: Expr<'a>, cx: &Context<'a>) {
    let ExprKind::Unary { op, operand } = outer_node.kind() else {
        return;
    };
    // `node` is the operator next to the argument: the second of `!!` and `~~`.
    let (node, argument) = match (op, operand.kind()) {
        (UnOp::Plus, _) => (outer_node, operand),
        // For tsgolint the parent of the inner operator of `!(!a)` is the parentheses.
        (UnOp::Not | UnOp::BitNot, ExprKind::Unary { op: inner, operand: argument })
            if inner == op && !(cx.language().is_oxlint && operand.is_parenthesized()) =>
        {
            (operand, argument)
        }
        _ => return,
    };
    let ty = type_of_operand(argument);
    let (is_unnecessary, type_string, violation) = match op {
        UnOp::Plus => (
            does_underlying_type_match_flag(ty, TypeFlags::NUMBER_LIKE),
            "number",
            "Using the unary + operator on a number",
        ),
        UnOp::Not => (
            does_underlying_type_match_flag(ty, TypeFlags::BOOLEAN_LIKE),
            "boolean",
            "Using !! on a boolean",
        ),
        _ => (
            union_constituents(ty).iter().all(|t| is_integer_literal_type(t, cx.language().is_oxlint)),
            "number",
            "Using ~~ on an integer",
        ),
    };
    if is_unnecessary {
        report(
            cx,
            &Conversion {
                loc: Span::new(outer_node.span().start, node.span().start + 1),
                violation,
                type_string,
                node: outer_node,
                inner_node: argument,
            },
        );
    }
}

impl Rule for NoUnnecessaryTypeConversion {
    const META: Meta = Meta::typescript("no-unnecessary-type-conversion", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[
        ExprTag::Assign,
        ExprTag::Binary,
        ExprTag::Call,
        ExprTag::Unary,
    ]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnnecessaryTypeConversion
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Assign => check_assignment(node, cx),
            ExprTag::Binary => check_binary(node, cx),
            ExprTag::Call => check_call(node, cx),
            ExprTag::Unary => check_unary(node, cx),
            _ => {}
        }
    }
}
