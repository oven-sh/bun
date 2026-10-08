use bun_core::strings;
use bun_lint::ast::Regex as RegexLiteral;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::type_constituents;
use bun_lint::types::utils::{get_constraint_info, is_string_like};
use bun_lint::types::{SyntaxKind, Type};
use bun_lint::utils::text::{is_blank, line_break_len, number_to_string};
use bun_lint::utils::ts_utils::get_moved_node_code;
use smallvec::SmallVec;

/// Disallow unnecessary template expressions.
pub struct NoUnnecessaryTemplateExpression;

const NO_UNNECESSARY_TEMPLATE_EXPRESSION: Message = Message::new(
    "noUnnecessaryTemplateExpression",
    "Template literal expression is unnecessary and can be simplified.",
);

/// A `TemplateLiteral` or a `TSTemplateLiteralType`.
trait TemplateLiteralTypeOrValue<'a>: Copy {
    fn raw_of_quasi(self, i: usize) -> &'a [u8];
    fn span_of_quasi(self, i: usize) -> Span;
}

impl<'a> TemplateLiteralTypeOrValue<'a> for Template<'a> {
    fn raw_of_quasi(self, i: usize) -> &'a [u8] {
        self.raw(i)
    }
    fn span_of_quasi(self, i: usize) -> Span {
        self.quasi_span(i)
    }
}

impl<'a> TemplateLiteralTypeOrValue<'a> for TypeTemplate<'a> {
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
        },
        _ => return None,
    })
}

fn interpolation_of_type(node: TypeNode<'_>) -> Option<Interpolation<'_>> {
    // The literal of `-1` is a `UnaryExpression`.
    let is_negative = || node.text().starts_with(b"-");
    Some(match node.kind() {
        TypeKind::Keyword(Keyword::Null | Keyword::Undefined) => Interpolation::Name,
        TypeKind::StringLit(_) if node.text().starts_with(b"`") => {
            let raw = node.file().slice(node.span().shrink(1, 1));
            Interpolation::Template {
                quasi_count: 1,
                first_raw: raw,
                last_raw: raw,
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

fn starts_with_new_line(x: &[u8]) -> bool {
    line_break_len(x) > 0
}

/// Whitespace before the end of a line is clearer in `${' '}`.
fn is_trailing_whitespace(kind: Interpolation, next_raw: &[u8]) -> bool {
    let is_whitespace = match kind {
        Interpolation::String(value) => is_blank(value.bytes()),
        Interpolation::Template { quasi_count, first_raw, .. } => quasi_count == 1 && is_blank(first_raw),
        _ => false,
    };
    is_whitespace && starts_with_new_line(next_raw)
}

fn backslashes_at_end(text: &[u8]) -> usize {
    text.iter().rev().take_while(|byte| **byte == b'\\').count()
}

fn ends_with_unescaped_dollar_sign(text: &[u8]) -> bool {
    matches!(text.split_last(), Some((b'$', before)) if backslashes_at_end(before) % 2 == 0)
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

fn remove(start: u32, end: u32) -> Fix {
    Fix {
        span: Span::new(start, end),
        text: Vec::new(),
    }
}

fn is_enum_member_type(ty: Type) -> bool {
    type_constituents(ty).iter().any(|t| {
        t.get_symbol()
            .and_then(|symbol| symbol.value_declaration())
            .is_some_and(|declaration| declaration.kind() == SyntaxKind::EnumMember)
    })
}

type Context<'a> = Cx<'a, NoUnnecessaryTemplateExpression>;

/// `${a}`, without a comment.
fn is_trivial_interpolation<'a>(
    template: impl TemplateLiteralTypeOrValue<'a>,
    interpolations: usize,
    cx: &Context<'a>,
) -> bool {
    interpolations == 1
        && template.raw_of_quasi(0).is_empty()
        && template.raw_of_quasi(1).is_empty()
        && !cx.file().comments_exist_between(template.span_of_quasi(0), template.span_of_quasi(1))
}

fn report_single_interpolation<'a>(node: Node<'a>, interpolation: Node<'a>, cx: &Context<'a>) {
    let span = interpolation.span();
    cx.report(Span::new(span.start.saturating_sub(2), span.end + 1), NO_UNNECESSARY_TEMPLATE_EXPRESSION)
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
        if is_trailing_whitespace(kind, next_raw) {
            continue;
        }
        let (prev_quasi, next_quasi) = (template.span_of_quasi(index), template.span_of_quasi(index + 1));
        if cx.file().comments_exist_between(prev_quasi, next_quasi) {
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

    let mut next_character_is_opening_curly_brace = false;
    for info in infos.iter().rev() {
        let interpolation = info.interpolation;
        let warn_loc_start = info.prev_quasi.end - 2;
        let warn_loc_end = info.next_quasi.start + 1;
        // The parts of the quasis that belong to the expression.
        let mut fixes = vec![
            remove(warn_loc_start, interpolation.start),
            remove(interpolation.end, warn_loc_end),
        ];

        if !info.next_raw.is_empty() {
            next_character_is_opening_curly_brace = info.next_raw.starts_with(b"{");
        }

        let literal = match info.kind {
            Interpolation::Name => {
                next_character_is_opening_curly_brace = false;
                None
            }
            Interpolation::Template { quasi_count, first_raw, last_raw } => {
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
                fixes.push(remove(interpolation.start, interpolation.start + 1));
                fixes.push(remove(interpolation.end - 1, interpolation.end));
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
        if is_trivial_interpolation(template, expressions.len(), cx)
            && get_constraint_info(first.ty()).constraint_type.is_some_and(is_string_like)
        {
            report_single_interpolation(node.into(), first.into(), cx);
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
        if is_trivial_interpolation(template, types.len(), cx) {
            let info = get_constraint_info(first.ty());
            if !info.is_type_parameter
                && info.constraint_type.is_some_and(|it| is_string_like(it) && !is_enum_member_type(it))
            {
                report_single_interpolation(node.into(), first.into(), cx);
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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryTemplateExpression
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Template], Self::check_template_literal);
        on.types([TypeTag::Template], Self::check_template_literal_type);
    }
}
