use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::Kind as RegexKind;
use bun_lint::regex::{Mode, Options as RegexOptions, parse_pattern};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{NameOf, SyntaxKind, TsNode};
use bun_lint::utils::eslint_utils::get_static_value;
use bun_lint::utils::ts_utils::is_static_member_access_of_value;

/// Enforce `includes` method over `indexOf` method.
pub struct PreferIncludes;

const PREFER_INCLUDES: Message = Message::new("preferIncludes", "Use 'includes()' method instead.");
const PREFER_STRING_INCLUDES: Message = Message::new(
    "preferStringIncludes",
    "Use `String#includes()` method with a string instead.",
);

fn is_number(node: Expr, value: f64) -> bool {
    get_static_value(node, Some(node.file().scope())).and_then(|it| it.as_number()) == Some(value)
}

fn parameters(node: TsNode<'_>) -> impl Iterator<Item = TsNode<'_>> {
    node.children().filter(|child| child.kind() == SyntaxKind::Parameter)
}

/// `paramA.getText() === paramB.getText()`: the name, the type and the question token at once.
fn has_same_text<'a>(param_a: TsNode<'a>, param_b: TsNode<'a>) -> bool {
    let (text_a, text_b) = (param_a.get_source_text(), param_b.get_source_text());
    if !text_a.is_empty() || !text_b.is_empty() {
        return text_a == text_b;
    }
    // TODO(api): replace by types::TsNode::get_source_text, which is empty in the default library.
    let written_type = |param: TsNode| param.type_node().map(|ty| ty.get_type_from_type_node().to_text());
    param_a.name().map(|it| it.text()) == param_b.name().map(|it| it.text())
        && param_a.has_question_token() == param_b.has_question_token()
        && param_a.has_dot_dot_dot_token() == param_b.has_dot_dot_dot_token()
        && written_type(param_a) == written_type(param_b)
}

fn has_same_parameters<'a>(node_a: TsNode<'a>, node_b: TsNode<'a>) -> bool {
    node_a.kind().is_function_like()
        && node_b.kind().is_function_like()
        && parameters(node_a).count() == parameters(node_b).count()
        && parameters(node_a).zip(parameters(node_b)).all(|(a, b)| has_same_text(a, b))
}

/// Whether the type that declares the `indexOf` method has an `includes` method with the same
/// parameters.
fn has_matching_includes_method(index_of_method_decl: TsNode) -> bool {
    let Some(type_decl) = index_of_method_decl.parent() else {
        return false;
    };
    type_decl.get_type_at_location().get_property(b"includes").is_some_and(|includes| {
        includes.declarations().any(|decl| has_same_parameters(decl, index_of_method_decl))
    })
}

/// A code point as UTF-8. Half a surrogate pair is the three bytes that its code point would have.
fn push_code_point(out: &mut Vec<u8>, c: u32) {
    match char::from_u32(c) {
        Some(c) => out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
        None => out.extend_from_slice(&[
            0xE0 | ((c >> 12) & 0x0F) as u8,
            0x80 | ((c >> 6) & 0x3F) as u8,
            0x80 | (c & 0x3F) as u8,
        ]),
    }
}

/// The one string that `node` matches, if it is a `RegExp` that matches only one.
fn parse_reg_exp(node: Expr) -> Option<Vec<u8>> {
    let evaluated = get_static_value(node, Some(node.file().scope()))?;
    let (pattern, flags) = evaluated.as_regex()?;
    if strings::index_of_any(flags, b"ig").is_some() {
        return None;
    }
    let ast = parse_pattern(pattern, Mode::of_flags(flags), RegexOptions::default()).ok()?;
    let RegexKind::Pattern { alternatives } = ast.pattern().kind() else {
        return None;
    };
    if alternatives.len() != 1 {
        return None;
    }
    let RegexKind::Alternative { elements } = alternatives.first()?.kind() else {
        return None;
    };
    let mut text = Vec::with_capacity(elements.len());
    // Without the `u` flag a character outside the BMP is two.
    let mut lead: Option<u32> = None;
    for element in elements {
        let RegexKind::Character { value } = element.kind() else {
            return None;
        };
        match (lead.take(), value) {
            (Some(lead), 0xDC00..=0xDFFF) => {
                push_code_point(&mut text, 0x10000 + ((lead - 0xD800) << 10) + (value - 0xDC00));
            }
            (alone, _) => {
                if let Some(alone) = alone {
                    push_code_point(&mut text, alone);
                }
                match value {
                    0xD800..=0xDBFF => lead = Some(value),
                    _ => push_code_point(&mut text, value),
                }
            }
        }
    }
    if let Some(alone) = lead {
        push_code_point(&mut text, alone);
    }
    Some(text)
}

fn escape_string(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for &byte in text {
        match byte {
            0 => out.extend_from_slice(b"\\0"),
            b'\t' => out.extend_from_slice(b"\\t"),
            b'\n' => out.extend_from_slice(b"\\n"),
            0x0B => out.extend_from_slice(b"\\v"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\'' => out.extend_from_slice(b"\\'"),
            b'\\' => out.extend_from_slice(b"\\\\"),
            _ => out.push(byte),
        }
    }
    out
}

impl PreferIncludes {
    /// `a.indexOf(b) !== -1`
    fn check_comparison<'a>(&self, compare_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left: call_node, right } = compare_node.kind() else {
            return;
        };
        let (negative, number) = match op {
            BinOp::NotEqEq | BinOp::NotEq | BinOp::Gt => (false, -1.0),
            BinOp::Ge => (false, 0.0),
            BinOp::EqEqEq | BinOp::EqEq | BinOp::Le => (true, -1.0),
            BinOp::Lt => (true, 0.0),
            _ => return,
        };
        let ExprKind::Call(call) = call_node.kind() else {
            return;
        };
        // Upstream's selector takes every `MemberExpression` directly in the call: also an argument.
        for node in std::iter::once(call.callee()).chain(call.args()) {
            // `(a?.indexOf)(b)` calls a `ChainExpression`.
            if !matches!(node.tag(), ExprTag::Dot | ExprTag::Index)
                || node.is_chain_root()
                || !is_static_member_access_of_value(node, &["indexOf"])
                || !is_number(right, number)
            {
                continue;
            }
            let (property, symbol) = match node.kind() {
                ExprKind::Dot { name, .. } => (name.span(), NameOf(node).ts_symbol()),
                ExprKind::Index { index, .. } => (index.span(), index.ts_symbol()),
                _ => continue,
            };
            let Some(symbol) = symbol else {
                continue;
            };
            if symbol.declarations().next().is_none()
                || !symbol.declarations().all(has_matching_includes_method)
            {
                continue;
            }
            let report = cx.report(compare_node, PREFER_INCLUDES);
            // `a?.indexOf(b) !== -1` is not the same as `a?.includes(b)`.
            if call_node.is_chain_root() {
                continue;
            }
            report.fix(|fixer| {
                let mut fixes = vec![
                    fixer.replace(property, "includes"),
                    fixer.remove(Span::new(call_node.span().end, compare_node.span().end)),
                ];
                if negative {
                    fixes.push(fixer.insert_before(call_node, "!"));
                }
                fixes
            });
        }
    }

    /// `/bar/.test(foo)`
    fn check_test_call<'a>(&self, call_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = call_node.kind() else {
            return;
        };
        let callee = call.callee();
        let ExprKind::Dot { obj, name, chain } = callee.kind() else {
            return;
        };
        if !name.name().is_any(&["test", "#test"]) || callee.is_chain_root() {
            return;
        }
        let Some(argument) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        let Some(text) = parse_reg_exp(obj) else {
            return;
        };
        let includes = get_constrained_type_at_location(argument).get_property(b"includes");
        if includes.is_none_or(|it| it.declarations().next().is_none()) {
            return;
        }
        cx.report(call_node, PREFER_STRING_INCLUDES).fix(|fixer| {
            let needs_paren = match argument.kind() {
                ExprKind::String(_)
                | ExprKind::Number(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex(_)
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Null
                | ExprKind::Template(_)
                | ExprKind::Ident(_) => false,
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => argument.is_chain_root(),
                _ => true,
            };
            let (open, close): (&[u8], &[u8]) = if needs_paren { (b"(", b")") } else { (b"", b"") };
            let dot: &[u8] = if chain == Chain::Start { b"?." } else { b"." };
            let escaped = escape_string(&text);
            fixer.replace(call_node, [open, argument.text(), close, dot, b"includes('", escaped.as_slice(), b"')"].concat())
        });
    }
}

impl Rule for PreferIncludes {
    const META: Meta = Meta::typescript("prefer-includes", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferIncludes
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check_comparison);
        on.exprs([ExprTag::Call], Self::check_test_call);
    }
}
