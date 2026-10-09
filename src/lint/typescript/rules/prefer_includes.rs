use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::Kind as RegexKind;
use bun_lint::regex::{Mode, Options as RegexOptions, parse_pattern};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{NameOf, SyntaxKind, TsNode};
use bun_lint::utils::eslint_utils::get_static_value;
use bun_lint::utils::text::push_code_point;
use bun_lint::utils::ts_utils::is_static_member_access_of_value;
use std::borrow::Cow;

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

/// `param.getText()`: the name, the type and the question token at once.
fn get_text(param: TsNode<'_>) -> Cow<'_, [u8]> {
    let text = param.get_source_text();
    if !text.is_empty() {
        return Cow::Borrowed(text);
    }
    // TODO(api): replace by types::TsNode::get_source_text, which is empty in the default library.
    // All of its `indexOf` and `includes` are written `name?: T`.
    let mut text = Vec::new();
    if param.has_dot_dot_dot_token() {
        text.extend_from_slice(b"...");
    }
    if let Some(name) = param.name() {
        text.extend_from_slice(name.text());
    }
    if param.has_question_token() {
        text.push(b'?');
    }
    if let Some(ty) = param.type_node() {
        text.extend_from_slice(b": ");
        text.extend_from_slice(&ty.get_type_from_type_node().to_text());
    }
    Cow::Owned(text)
}

fn has_same_parameters<'a>(node_a: TsNode<'a>, node_b: TsNode<'a>) -> bool {
    node_a.kind().is_function_like()
        && node_b.kind().is_function_like()
        && parameters(node_a).count() == parameters(node_b).count()
        && parameters(node_a).zip(parameters(node_b)).all(|(a, b)| get_text(a) == get_text(b))
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

/// tsgolint's `isSimpleLiteralPattern`, which goes by the character before.
fn tsgolint_is_simple_literal_pattern(pattern: &[u8]) -> bool {
    let mut before = 0;
    for &byte in pattern {
        let not_simple: &[u8] = if before == b'\\' { b"dDwWsSbBcxu" } else { b".*+?|^$[](){}" };
        if strings::contains_char(not_simple, byte) {
            return false;
        }
        before = byte;
    }
    !pattern.is_empty()
}

/// `/a/` without flags.
fn tsgolint_is_simple_literal(e: Expr) -> bool {
    matches!(
        e.kind(),
        ExprKind::Regex(it)
            if !e.is_parenthesized() && it.flags().is_empty() && tsgolint_is_simple_literal_pattern(it.pattern())
    )
}

/// tsgolint's `resolveRegexPattern`: it has no evaluation of expressions. It knows `/a/`, and a variable whose value is
/// that or `new RegExp("a")`.
fn tsgolint_resolves_regex_pattern(node: Expr) -> bool {
    if tsgolint_is_simple_literal(node) {
        return true;
    }
    if node.is_parenthesized() || node.tag() != ExprTag::Ident {
        return false;
    }
    let mut declarations = node.symbol().into_iter().flat_map(Symbol::declarations);
    let Some(Declaration::Var(pat)) = declarations.next() else {
        return false;
    };
    let Node::VarDecl(declaration) = pat.parent() else {
        return false;
    };
    declaration.init().is_some_and(|init| match init.kind() {
        _ if init.is_parenthesized() => false,
        ExprKind::New(call) => {
            !call.callee().is_parenthesized()
                && call.callee().is_ident("RegExp")
                && (call.args().first().filter(|it| !it.is_parenthesized()))
                    .and_then(|it| it.as_string())
                    .is_some_and(|it| tsgolint_is_simple_literal_pattern(it.bytes()))
        }
        _ => tsgolint_is_simple_literal(init),
    })
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
        if cx.language().is_oxlint && !tsgolint_resolves_regex_pattern(obj) {
            return;
        }
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
            let open: &[u8] = if needs_paren { b"(" } else { b"" };
            let close: &[u8] = if needs_paren { b")" } else { b"" };
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
