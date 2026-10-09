use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::unicorn::concat;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Prefer default parameters over reassignment.
pub struct PreferDefaultParameters;

const PREFER_DEFAULT_PARAMETERS: Message = Message::new("", "Prefer default parameters over reassignment for '{{name}}'.");
const USE_DEFAULT_PARAMETER: Message = Message::new("", "Prefer default parameters over reassignment.");

impl Rule for PreferDefaultParameters {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-default-parameters", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDefaultParameters
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // Only a statement directly in the body of a function is ever reported.
        on.stmts([StmtTag::Expr], |_, statement, cx| {
            if let StmtKind::Expr(e) = statement.kind()
                && let ExprKind::Assign { op, target, value } = e.kind()
                && let Some(left_name) = target.as_ident()
                && !e.is_parenthesized()
            {
                match op {
                    None => check_expression(statement, left_name, value, Some(e), cx),
                    Some(BinOp::Or | BinOp::Nullish) if is_literal(value) => {
                        check_parameter_default(statement, left_name, left_name, value, target, Reassignment::Logical(e), cx);
                    }
                    Some(_) => {}
                }
            }
        });
        on.stmts([StmtTag::Var], |_, statement, cx| {
            if let StmtKind::Var(declarations) = statement.kind()
                && declarations.len() == 1
                && let Some(declarator) = declarations.first()
                && let (Some(left_name), Some(init)) = (declarator.pat().as_ident(), declarator.init())
            {
                check_expression(statement, left_name, init, None, cx);
            }
        });
    }
}

/// What the statement is.
#[derive(Copy, Clone)]
enum Reassignment<'a> {
    /// `const left_name = param || literal`
    Declaration,
    /// `param = param || literal`
    Assignment(Expr<'a>),
    /// `param ||= literal`, `param ??= literal`
    Logical(Expr<'a>),
}

fn is_literal(e: Expr) -> bool {
    matches!(
        get_inner_expression(e).tag(),
        ExprTag::True | ExprTag::False | ExprTag::Null | ExprTag::Number | ExprTag::BigInt | ExprTag::Regex | ExprTag::String
    )
}

/// `assignment`: the `left_name = right` that `statement` is. Otherwise that declares `left_name`.
fn check_expression<'a>(
    statement: Stmt<'a>,
    left_name: Name<'a>,
    right: Expr<'a>,
    assignment: Option<Expr<'a>>,
    cx: &Cx<'a, PreferDefaultParameters>,
) {
    let ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left: param_ident, right: default_value } = right.kind() else {
        return;
    };
    let Some(param_name) = param_ident.as_ident() else {
        return;
    };
    if !is_literal(default_value) || assignment.is_some() && left_name != param_name {
        return;
    }
    let reassignment = assignment.map_or(Reassignment::Declaration, Reassignment::Assignment);
    check_parameter_default(statement, param_name, left_name, default_value, param_ident, reassignment, cx);
}

/// `param_ident`: where `statement` reads the parameter.
fn check_parameter_default<'a>(
    statement: Stmt<'a>,
    param_name: Name<'a>,
    left_name: Name<'a>,
    default_value: Expr<'a>,
    param_ident: Expr<'a>,
    reassignment: Reassignment<'a>,
    cx: &Cx<'a, PreferDefaultParameters>,
) {
    let Node::Func(func) = statement.parent() else {
        return;
    };
    if matches!(func.kind(), FnKind::Setter | FnKind::StaticBlock) {
        return;
    }
    // The last parameter, the first of that name, without a default.
    let Some(param) = func.params().last().filter(|it| !it.is_rest() && it.default().is_none()) else {
        return;
    };
    if func.params().iter().find(|it| it.pat().as_ident() == Some(param_name)) != Some(param) {
        return;
    }
    let Some(symbol) = param.pat().symbol() else {
        return;
    };
    let references = || symbol.references().filter(|it| !matches!(it.node(), Node::Type(ty) if ty.tag() == TypeTag::Predicate));
    let is_it = |it: &Reference| it.span() == param_ident.span();
    let has_no_extra_references = match reassignment {
        Reassignment::Logical(_) => references().next().is_some_and(|it| is_it(&it)),
        Reassignment::Assignment(_) => {
            references().filter(|it| it.is_write()).count() == 1 && references().any(|it| !it.is_write() && is_it(&it))
        }
        Reassignment::Declaration => references().count() == 1 && references().all(|it| is_it(&it)),
    };
    if !has_no_extra_references || !has_no_side_effects_before(func, statement, param_name) {
        return;
    }
    let place = match reassignment {
        Reassignment::Declaration => statement.span(),
        Reassignment::Assignment(e) | Reassignment::Logical(e) => e.span(),
    };
    cx.report(place, PREFER_DEFAULT_PARAMETERS).data("name", param_name).suggest(USE_DEFAULT_PARAMETER, |fixer| {
        let file = fixer.file();
        let binding = param.pat().span();
        let (annotation, mut replace_span) = match param.ty() {
            Some(ty) => (file.slice(ty.annotation_span()), Span::new(binding.start, ty.annotation_span().end)),
            None if param.is_optional() => (&b""[..], Span::new(binding.start, param.span().end)),
            None => (&b""[..], binding),
        };
        let mut new_param_text = concat(&[left_name.bytes(), annotation, b" = ", file.slice(default_value.outer_span())]);
        // `const foo = bar => {}`
        if func.is_arrow() && func.close_paren().is_none() {
            new_param_text = concat(&[b"(", &new_param_text, b")"]);
            replace_span = func.params_span()?;
        }
        Some([fixer.replace(replace_span, new_param_text), fixer.remove(expand_statement_delete_span(file.text(), statement.span()))])
    });
}

/// With the indentation before the statement, if it starts its line, a space after it, and the line break.
fn expand_statement_delete_span(source_text: &[u8], statement_span: Span) -> Span {
    let (mut start, mut end) = (statement_span.start as usize, statement_span.end as usize);
    let before = source_text.get(..start).unwrap_or_default();
    let indentation = before.iter().rev().take_while(|it| matches!(it, b' ' | b'\t')).count();
    if matches!(before.get(..start - indentation).and_then(<[u8]>::last), Some(b'\n' | b'\r')) {
        start -= indentation;
    }
    if source_text.get(end) == Some(&b' ') {
        end += 1;
    }
    match source_text.get(end..).unwrap_or_default() {
        [b'\r', b'\n', ..] => end += 2,
        [b'\r' | b'\n', ..] => end += 1,
        _ => {}
    }
    Span::new(start as u32, end as u32)
}

fn has_no_side_effects_before<'a>(func: Func<'a>, statement: Stmt<'a>, param_name: Name<'a>) -> bool {
    let statements = func.body_statements().into_iter().flatten();
    statements.take_while(|it| *it != statement).all(|it| match it.kind() {
        StmtKind::Var(declarations) => declarations.iter().filter_map(VarDecl::init).all(|it| is_side_effect_free_expression(it, param_name)),
        StmtKind::Expr(e) => is_side_effect_free_expression(e, param_name),
        StmtKind::Fn(func) => func.has_body(),
        _ => false,
    })
}

fn is_side_effect_free_expression<'a>(expr: Expr<'a>, param_name: Name<'a>) -> bool {
    let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![expr];
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::Template(_)
            | ExprKind::Fn(_) => {}
            ExprKind::Ident(name) if name != param_name => {}
            ExprKind::Assign { target, value, .. } if target.as_ident().is_some_and(|it| it != param_name) => pending.push(value),
            ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) && left.tag() != ExprTag::PrivateIdentifier =>
            {
                pending.extend([left, right]);
            }
            ExprKind::Unary { op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof | UnOp::Void, operand } => {
                pending.push(operand);
            }
            _ => return false,
        }
    }
    true
}
