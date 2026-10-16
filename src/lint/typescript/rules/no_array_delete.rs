use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::utils::ts_utils::{is_start_of_expression_statement, needs_preceding_semicolon};

/// Disallow using the `delete` operator on array values.
pub struct NoArrayDelete;

const NO_ARRAY_DELETE: Message = Message::new(
    "noArrayDelete",
    "Using the `delete` operator with an array expression is unsafe.",
);
const USE_SPLICE: Message = Message::new("useSplice", "Use `array.splice()` instead.");

fn is_underlying_type_array(ty: Type) -> bool {
    let predicate = |t: Type| t.is_array_type() || t.is_tuple_type();
    if ty.is_union() {
        return ty.types().iter().all(predicate);
    }
    if ty.is_intersection() {
        return ty.types().iter().any(predicate);
    }
    predicate(ty)
}

fn use_splice<'a>(fixer: Fixer<'a>, node: Expr<'a>, object: Expr<'a>, key: Span, is_sequence: bool) -> Fix {
    let file = fixer.file();
    let mut suggestion = Vec::new();
    let indentation = file.position(node.span().start).column as usize;
    for comment in file.comments_in(node) {
        suggestion.extend_from_slice(comment.text());
        suggestion.push(b'\n');
        suggestion.resize(suggestion.len() + indentation, b' ');
    }
    suggestion.extend_from_slice(object.text());
    suggestion.extend_from_slice(if is_sequence { ".splice((" } else { ".splice(" }.as_bytes());
    suggestion.extend_from_slice(file.slice(key));
    suggestion.extend_from_slice(if is_sequence { "), 1)" } else { ", 1)" }.as_bytes());
    fixer.replace(node, suggestion)
}

/// What tsgolint suggests: the `delete` goes, the `[` becomes `.splice(` and the `]` becomes `, 1)`.
/// For `a?.[b]` tsgolint puts `.splice(` over the `?.` and keeps the `[`, which does not parse: here
/// the `[` goes and the `?.` stays. Nor does tsgolint add the `;` without which a `(` or `[` continues the line before.
fn use_splice_as_tsgolint<'a>(
    fixer: Fixer<'a>,
    node: Expr<'a>,
    keyword: Span,
    object: Expr<'a>,
    argument: Expr<'a>,
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let first = file.token_after(keyword)?;
    let add_semi_colon = (first.is_punctuator("(") || first.is_punctuator("["))
        && is_start_of_expression_statement(node)
        && needs_preceding_semicolon(node);
    let open = file.token_after(object.outer_span())?;
    let close = file.last_token(argument)?;
    let is_optional = open.is_punctuator("?.");
    let call = if is_optional { "?.splice(" } else { ".splice(" };
    let mut changes = vec![
        fixer.replace(keyword, if add_semi_colon { ";" } else { "" }),
        fixer.replace(open, call),
        fixer.replace(close, ", 1)"),
    ];
    if is_optional {
        changes.push(fixer.remove(file.token_after(open)?));
    }
    Some(changes)
}

impl Rule for NoArrayDelete {
    const META: Meta = Meta::typescript("no-array-delete", Kind::Problem)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Unary]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoArrayDelete
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Unary { op: UnOp::Delete, operand: argument } = node.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let (object, key, is_sequence) = match argument.kind() {
            // tsgolint looks at `a[b]` only.
            ExprKind::Dot { .. } if is_oxlint => return,
            ExprKind::Dot { obj, name, .. } => (obj, name.span(), false),
            ExprKind::Index { obj, index, .. } => {
                let is_sequence = matches!(index.kind(), ExprKind::Binary { op: BinOp::Comma, .. });
                // The parentheses of `a[(b, c)]` stay in what tsgolint writes.
                (obj, index.span(), is_sequence && !(is_oxlint && index.is_parenthesized()))
            }
            _ => return,
        };
        // A `ChainExpression` for ESLint. tsgolint looks at `a?.[b]` like at `a[b]`.
        if !is_oxlint && argument.is_in_optional_chain() {
            return;
        }
        if !is_underlying_type_array(get_constrained_type_at_location(object)) {
            return;
        }
        // oxlint points at the array.
        let keyword = Span::new(node.span().start, node.span().start + "delete".len() as u32);
        let report = cx
            .report(if is_oxlint { object.outer_span() } else { node.span() }, NO_ARRAY_DELETE)
            .comments_apply_at(keyword)
            .labels_with(|labels| {
                labels.first("This expression evaluates to an array.");
                labels.push(keyword, "");
            });
        match is_oxlint {
            true => report.suggest_change_of_behavior(USE_SPLICE, &[], |fixer| use_splice_as_tsgolint(fixer, node, keyword, object, argument)),
            false => report.suggest_change_of_behavior(USE_SPLICE, &[], |fixer| use_splice(fixer, node, object, key, is_sequence)),
        };
    }
}
