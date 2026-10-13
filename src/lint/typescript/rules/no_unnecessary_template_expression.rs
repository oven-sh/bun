use bun_core::strings;
use bun_lint::ast::Regex as RegexLiteral;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::{is_union_or_intersection_type, type_constituents};
use bun_lint::types::utils::{get_constraint_info, is_string_like};
use bun_lint::types::{SyntaxKind, Type};
use bun_lint::utils::text::number_to_string;
use bun_lint::utils::ts_utils::{
    OperatorPrecedence, get_moved_node_code, get_operator_precedence_for_node, get_operator_precedence_of_ts_parent,
};
use smallvec::SmallVec;

/// Disallow unnecessary template expressions.
pub struct NoUnnecessaryTemplateExpression;

const NO_UNNECESSARY_TEMPLATE_EXPRESSION: Message = Message::new(
    "noUnnecessaryTemplateExpression",
    "Template literal expression is unnecessary and can be simplified.",
);

/// A `TemplateLiteral` or a `TSTemplateLiteralType`.
trait TemplateLiteralTypeOrValue<'a>: Copy {
    fn cooked_of_quasi(self, i: usize) -> Option<Name<'a>>;
    fn raw_of_quasi(self, i: usize) -> &'a [u8];
    fn span_of_quasi(self, i: usize) -> Span;
}

impl<'a> TemplateLiteralTypeOrValue<'a> for Template<'a> {
    fn cooked_of_quasi(self, i: usize) -> Option<Name<'a>> {
        self.cooked(i)
    }
    fn raw_of_quasi(self, i: usize) -> &'a [u8] {
        self.raw(i)
    }
    fn span_of_quasi(self, i: usize) -> Span {
        self.quasi_span(i)
    }
}

impl<'a> TemplateLiteralTypeOrValue<'a> for TypeTemplate<'a> {
    fn cooked_of_quasi(self, i: usize) -> Option<Name<'a>> {
        self.cooked(i)
    }
    fn raw_of_quasi(self, i: usize) -> &'a [u8] {
        self.raw(i)
    }
    fn span_of_quasi(self, i: usize) -> Span {
        self.quasi_span(i)
    }
}

/// What can be written in the text of the template as well as between `${` and `}`.
#[derive(Copy, Clone)]
enum Interpolation<'a> {
    /// `undefined`, `Infinity`, `NaN`, and the types `null` and `undefined`.
    Name,
    /// Its value.
    String(Name<'a>),
    Number(f64),
    /// In base 10.
    BigInt(Name<'a>),
    /// `true`, `false`, `null`
    Keyword(&'static str),
    Regex(RegexLiteral<'a>),
    Template {
        quasi_count: usize,
        first_raw: &'a [u8],
        last_raw: &'a [u8],
        /// Its value, if it has no substitutions.
        value: Option<Name<'a>>,
    },
}

struct InterpolationInfo<'a> {
    interpolation: Span,
    kind: Interpolation<'a>,
    prev_quasi: Span,
    prev_raw: &'a [u8],
    next_quasi: Span,
    next_raw: &'a [u8],
}

fn interpolation_of_expression(node: Expr<'_>) -> Option<Interpolation<'_>> {
    // For tsgolint a `ParenthesizedExpression` is not the literal in it.
    if node.file().language().is_oxlint && node.is_parenthesized() {
        return None;
    }
    Some(match node.kind() {
        ExprKind::Ident(name) if name.is_any(&["undefined", "Infinity", "NaN"]) => Interpolation::Name,
        ExprKind::String(value) => Interpolation::String(value),
        ExprKind::Number(value) => Interpolation::Number(value),
        ExprKind::BigInt(value) => Interpolation::BigInt(value),
        ExprKind::True => Interpolation::Keyword("true"),
        ExprKind::False => Interpolation::Keyword("false"),
        ExprKind::Null => Interpolation::Keyword("null"),
        ExprKind::Regex(regex) => Interpolation::Regex(regex),
        ExprKind::Template(template) => Interpolation::Template {
            quasi_count: template.quasi_count(),
            first_raw: template.raw(0),
            last_raw: template.raw(template.quasi_count() - 1),
            value: template.as_static(),
        },
        _ => return None,
    })
}

fn interpolation_of_type(node: TypeNode<'_>) -> Option<Interpolation<'_>> {
    // The literal of `-1` is a `UnaryExpression`.
    let is_negative = || node.text().starts_with(b"-");
    // For tsgolint a `ParenthesizedType` is not the literal in it.
    if node.file().language().is_oxlint && node.is_parenthesized() {
        return None;
    }
    Some(match node.kind() {
        TypeKind::Keyword(Keyword::Null | Keyword::Undefined) => Interpolation::Name,
        TypeKind::StringLit(value) if node.text().starts_with(b"`") => {
            let raw = node.file().slice(node.span().shrink(1, 1));
            Interpolation::Template {
                quasi_count: 1,
                first_raw: raw,
                last_raw: raw,
                value: Some(value),
            }
        }
        TypeKind::StringLit(value) => Interpolation::String(value),
        TypeKind::NumberLit(value) if !is_negative() => Interpolation::Number(value),
        TypeKind::BigIntLit { text, negative: false } => Interpolation::BigInt(text),
        TypeKind::BoolLit(true) => Interpolation::Keyword("true"),
        TypeKind::BoolLit(false) => Interpolation::Keyword("false"),
        _ => return None,
    })
}

/// For tsgolint a line ends with `\n` or `\r\n`.
fn starts_with_new_line(x: &[u8], is_oxlint: bool) -> bool {
    match is_oxlint {
        true => x.starts_with(b"\n") || x.starts_with(b"\r\n"),
        false => strings::js_line_break_len(x) > 0,
    }
}

/// Whitespace before the end of a line is clearer in `${' '}`.
fn is_trailing_whitespace(kind: Interpolation, next_raw: &[u8], is_oxlint: bool) -> bool {
    let is_whitespace = match kind {
        Interpolation::String(value) => strings::is_all_js_whitespace(value.bytes()),
        // tsgolint tests the value of a template without substitutions.
        Interpolation::Template { value, .. } if is_oxlint => {
            value.is_some_and(|it| strings::is_all_js_whitespace(it.bytes()))
        }
        Interpolation::Template { quasi_count, first_raw, .. } => {
            quasi_count == 1 && strings::is_all_js_whitespace(first_raw)
        }
        _ => false,
    };
    is_whitespace && starts_with_new_line(next_raw, is_oxlint)
}

fn backslashes_at_end(text: &[u8]) -> usize {
    text.iter().rev().take_while(|byte| **byte == b'\\').count()
}

fn ends_with_unescaped_dollar_sign(text: &[u8]) -> bool {
    matches!(text.split_last(), Some((b'$', before)) if backslashes_at_end(before).is_multiple_of(2))
}

/// `String(regex)`, with every backslash escaped.
fn regex_text(regex: RegexLiteral) -> Vec<u8> {
    let mut text = vec![b'/'];
    for &byte in regex.pattern() {
        if byte == b'\\' {
            text.push(b'\\');
        }
        text.push(byte);
    }
    text.push(b'/');
    let flags = regex.flags();
    text.extend(b"dgimsuvy".iter().filter(|flag| strings::contains_char(flags, **flag)));
    text
}

/// With a backslash before each `` ` `` and `${` that is not escaped.
fn escape_template_syntax(value: &[u8]) -> Vec<u8> {
    let mut escaped = Vec::with_capacity(value.len() + 2);
    let mut backslashes = 0;
    for (i, &byte) in value.iter().enumerate() {
        let is_syntax = byte == b'`' || byte == b'$' && value.get(i + 1) == Some(&b'{');
        if is_syntax && backslashes % 2 == 0 {
            escaped.push(b'\\');
        }
        escaped.push(byte);
        backslashes = if byte == b'\\' { backslashes + 1 } else { 0 };
    }
    escaped
}

fn remove(span: Span) -> Fix {
    Fix {
        span,
        text: Vec::new(),
    }
}

fn is_enum_member_type(ty: Type, is_oxlint: bool) -> bool {
    type_constituents(ty).iter().any(|t| {
        // tsgolint's `TypeRecurser` goes into the unions and intersections among them.
        if is_oxlint && is_union_or_intersection_type(t) {
            return is_enum_member_type(t, is_oxlint);
        }
        t.get_symbol()
            .and_then(|symbol| symbol.value_declaration())
            .is_some_and(|declaration| declaration.kind() == SyntaxKind::EnumMember)
    })
}

type Context<'a> = Cx<'a, NoUnnecessaryTemplateExpression>;

/// `${a}`, without a comment. `first` is the interpolation with its parentheses.
fn is_trivial_interpolation<'a>(
    template: impl TemplateLiteralTypeOrValue<'a>,
    interpolations: usize,
    first: Span,
    cx: &Context<'a>,
) -> bool {
    if interpolations != 1 {
        return false;
    }
    let (head, tail) = (template.span_of_quasi(0), template.span_of_quasi(1));
    // tsgolint compares the values of the texts, and looks for comments before and after the interpolation, not in it.
    if cx.language().is_oxlint {
        let is_empty = |i: usize| template.cooked_of_quasi(i).is_some_and(|it| it.bytes().is_empty());
        return is_empty(0)
            && is_empty(1)
            && !cx.file().comments_exist_between(head, first)
            && !cx.file().comments_exist_between(first, tail);
    }
    template.raw_of_quasi(0).is_empty()
        && template.raw_of_quasi(1).is_empty()
        && !cx.file().comments_exist_between(head, tail)
}

/// Whether tsgolint puts parentheses around `moved` where `template` was: unless it binds more tightly than what the
/// template is in. For typescript-go a call binds like a member access, and an arrow function like an assignment.
fn is_wrapped_by_tsgolint(template: Expr, moved: Expr) -> bool {
    use OperatorPrecedence as P;
    let like_member = |it: P| if it == P::LeftHandSide { P::Member } else { it };
    let around = match template.parent() {
        _ if template.is_parenthesized() => P::Primary,
        Node::Func(func) if func.is_arrow() => P::Assignment,
        // `a || b ?? c` is a syntax error.
        Node::Expr(parent)
            if parent.binary_op() == Some(BinOp::Nullish)
                && matches!(moved.binary_op(), Some(BinOp::And | BinOp::Or)) =>
        {
            P::Primary
        }
        _ => like_member(get_operator_precedence_of_ts_parent(template)),
    };
    !moved.is_parenthesized() && like_member(get_operator_precedence_for_node(moved)) <= around
}

/// `head` is the text before the interpolation, `outer` the interpolation with its parentheses.
fn report_single_interpolation<'a>(
    node: Node<'a>,
    interpolation: Node<'a>,
    head: Span,
    outer: Span,
    cx: &Context<'a>,
) {
    let is_oxlint = cx.language().is_oxlint;
    let span = interpolation.span();
    // tsgolint reports from the `${`, whatever space follows, to the character after the interpolation and its
    // parentheses.
    let place = match is_oxlint {
        true => Span::new(head.end - 2, outer.end + 1),
        false => Span::new(span.start.saturating_sub(2), span.end + 1),
    };
    // For tsgolint parentheses are a part of what is in them.
    if let (Node::Expr(template), Node::Expr(moved), true) = (node, interpolation, is_oxlint) {
        cx.report(place, NO_UNNECESSARY_TEMPLATE_EXPRESSION)
            .fix(|fixer| match is_wrapped_by_tsgolint(template, moved) {
                true => fixer.replace(node, [&b"("[..], moved.text(), b")"].concat()),
                false => fixer.replace(node, cx.slice(outer)),
            });
        return;
    }
    cx.report(place, NO_UNNECESSARY_TEMPLATE_EXPRESSION)
        .fix(|fixer| fixer.replace(node, get_moved_node_code(node, interpolation)));
}

fn report_interpolations<'a>(
    template: impl TemplateLiteralTypeOrValue<'a>,
    interpolations: impl Iterator<Item = (Span, Option<Interpolation<'a>>)>,
    cx: &Context<'a>,
) {
    let mut infos: SmallVec<[InterpolationInfo<'a>; 4]> = SmallVec::new();
    for (index, (interpolation, kind)) in interpolations.enumerate() {
        let Some(kind) = kind else {
            continue;
        };
        let next_raw = template.raw_of_quasi(index + 1);
        if is_trailing_whitespace(kind, next_raw, cx.language().is_oxlint) {
            continue;
        }
        let (prev_quasi, next_quasi) = (template.span_of_quasi(index), template.span_of_quasi(index + 1));
        // tsgolint looks for comments before and after the interpolation, not in it.
        let has_comments = match cx.language().is_oxlint {
            true => {
                cx.file().comments_exist_between(prev_quasi, interpolation)
                    || cx.file().comments_exist_between(interpolation, next_quasi)
            }
            false => cx.file().comments_exist_between(prev_quasi, next_quasi),
        };
        if has_comments {
            continue;
        }
        infos.push(InterpolationInfo {
            interpolation,
            kind,
            prev_quasi,
            prev_raw: template.raw_of_quasi(index),
            next_quasi,
            next_raw,
        });
    }
    report_infos(&infos, cx);
}

fn report_infos<'a>(infos: &[InterpolationInfo<'a>], cx: &Context<'a>) {
    let mut next_character_is_opening_curly_brace = false;
    for info in infos.iter().rev() {
        let interpolation = info.interpolation;
        let warn_loc_start = info.prev_quasi.end - 2;
        let warn_loc_end = info.next_quasi.start + 1;
        // The parts of the quasis that belong to the expression.
        let mut fixes = vec![
            remove(Span::before(warn_loc_start, interpolation)),
            remove(Span::after(interpolation, warn_loc_end)),
        ];

        if !info.next_raw.is_empty() {
            next_character_is_opening_curly_brace = info.next_raw.starts_with(b"{");
        }

        let literal = match info.kind {
            Interpolation::Name => {
                next_character_is_opening_curly_brace = false;
                None
            }
            Interpolation::Template { quasi_count, first_raw, last_raw, .. } => {
                // The `$` at its end and the `{` after it would be a `${`.
                if next_character_is_opening_curly_brace && ends_with_unescaped_dollar_sign(last_raw) {
                    fixes.push(Fix {
                        span: Span::empty(interpolation.end - 2),
                        text: b"\\".to_vec(),
                    });
                }
                if quasi_count == 1 && !first_raw.is_empty() {
                    next_character_is_opening_curly_brace = first_raw.starts_with(b"{");
                }
                fixes.push(remove(Span::new(interpolation.start, interpolation.start + 1)));
                fixes.push(remove(Span::new(interpolation.end - 1, interpolation.end)));
                None
            }
            // Without the quotes.
            Interpolation::String(_) => Some(escape_template_syntax(cx.slice(interpolation.shrink(1, 1)))),
            Interpolation::Number(value) => Some(number_to_string(value)),
            Interpolation::BigInt(value) => Some(value.bytes().to_vec()),
            Interpolation::Keyword(value) => Some(value.as_bytes().to_vec()),
            Interpolation::Regex(regex) => Some(escape_template_syntax(&regex_text(regex))),
        };
        if let Some(mut escaped_value) = literal {
            if next_character_is_opening_curly_brace && ends_with_unescaped_dollar_sign(&escaped_value) {
                escaped_value.insert(escaped_value.len() - 1, b'\\');
            }
            if !escaped_value.is_empty() {
                next_character_is_opening_curly_brace = escaped_value.starts_with(b"{");
            }
            fixes.push(Fix {
                span: interpolation,
                text: escaped_value,
            });
        }

        // The `$` before the `${` and the `{` that follows it now.
        if next_character_is_opening_curly_brace && ends_with_unescaped_dollar_sign(info.prev_raw) {
            fixes.push(Fix {
                span: Span::new(info.prev_quasi.end - 3, info.prev_quasi.end - 2),
                text: b"\\$".to_vec(),
            });
        }

        cx.report(Span::new(warn_loc_start, warn_loc_end), NO_UNNECESSARY_TEMPLATE_EXPRESSION)
            .fix(|_| fixes);
    }
}

impl NoUnnecessaryTemplateExpression {
    fn check_template_literal<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Template(template) = node.kind() else {
            return;
        };
        let expressions = template.exprs();
        let Some(first) = expressions.first() else {
            return;
        };
        if matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate) {
            return;
        }
        let outer = first.outer_span();
        if is_trivial_interpolation(template, expressions.len(), outer, cx)
            && get_constraint_info(first.ty()).constraint_type.is_some_and(is_string_like)
        {
            report_single_interpolation(node.into(), first.into(), template.quasi_span(0), outer, cx);
            return;
        }
        let interpolations = expressions.iter().map(|it| (it.span(), interpolation_of_expression(it)));
        report_interpolations(template, interpolations, cx);
    }

    fn check_template_literal_type<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(template) = node.as_template() else {
            return;
        };
        let types = template.types();
        let Some(first) = types.first() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let outer = first.outer_span();
        if is_trivial_interpolation(template, types.len(), outer, cx) {
            let info = get_constraint_info(first.ty());
            if !info.is_type_parameter
                && info.constraint_type.is_some_and(|it| is_string_like(it) && !is_enum_member_type(it, is_oxlint))
            {
                report_single_interpolation(node.into(), first.into(), template.quasi_span(0), outer, cx);
                return;
            }
        }
        let interpolations = types.iter().map(|it| (it.span(), interpolation_of_type(it)));
        report_interpolations(template, interpolations, cx);
    }
}

impl Rule for NoUnnecessaryTemplateExpression {
    const META: Meta = Meta::typescript("no-unnecessary-template-expression", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new()
        .exprs(&[ExprTag::Template])
        .types(&[TypeTag::Template]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnnecessaryTemplateExpression
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_template_literal(node, cx);
    }

    fn ty<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.check_template_literal_type(node, cx);
    }
}
