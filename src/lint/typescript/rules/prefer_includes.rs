use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::Kind as RegexKind;
use bun_lint::regex::{Mode, Options as RegexOptions, parse_pattern};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{NameOf, SyntaxKind, TsNode};
use bun_lint::utils::eslint_utils::get_static_value;
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

/// tsgolint's `isNumberLiteral`: a numeric literal, or `-` before one. Nothing is evaluated.
fn tsgolint_is_number_literal(node: Expr, value: f64) -> bool {
    if node.is_parenthesized() {
        return false;
    }
    match node.kind() {
        ExprKind::Unary { op: UnOp::Minus, operand } => {
            !operand.is_parenthesized() && operand.as_number().map(|number| -number) == Some(value)
        }
        _ => node.as_number() == Some(value),
    }
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

/// tsgolint's `extractRegexLiteralPattern`: what is written between the slashes of a `/a/` without flags.
fn tsgolint_extract_regex_literal_pattern(node: Expr<'_>) -> Option<&[u8]> {
    let regex = node.as_regex().filter(|_| !node.is_parenthesized())?;
    let pattern = regex.pattern();
    (regex.flags().is_empty() && tsgolint_is_simple_literal_pattern(pattern)).then_some(pattern)
}

/// tsgolint's `extractRegExpConstructorPattern`: the first argument of `new RegExp("a")`. What `RegExp` is and the
/// other arguments are not looked at.
fn tsgolint_extract_reg_exp_constructor_pattern(node: Expr<'_>) -> Option<&[u8]> {
    let ExprKind::New(call) = node.kind() else {
        return None;
    };
    if node.is_parenthesized() || call.callee().is_parenthesized() || !call.callee().is_ident("RegExp") {
        return None;
    }
    let pattern = call.args().first().filter(|it| !it.is_parenthesized())?.as_string()?.bytes();
    tsgolint_is_simple_literal_pattern(pattern).then_some(pattern)
}

/// tsgolint's `resolveRegexPattern`, which evaluates nothing: the pattern of `/a/`, or of a variable whose
/// `valueDeclaration` has that or `new RegExp("a")` as its initializer, whatever is assigned to it later.
/// With the expression that the pattern is read from.
fn tsgolint_resolve_regex_pattern<'a>(node: Expr<'a>) -> Option<(Expr<'a>, &'a [u8])> {
    if let Some(pattern) = tsgolint_extract_regex_literal_pattern(node) {
        return Some((node, pattern));
    }
    if node.is_parenthesized() || node.tag() != ExprTag::Ident {
        return None;
    }
    let Some(Node::VarDecl(declaration)) = node.ts_symbol()?.value_declaration()?.to_ast() else {
        return None;
    };
    let init = declaration.init()?;
    let pattern = tsgolint_extract_regex_literal_pattern(init)
        .or_else(|| tsgolint_extract_reg_exp_constructor_pattern(init))?;
    Some((init, pattern))
}

/// The one string that `node` matches, if it is a `RegExp` that matches only one and has none of
/// `excluded_flags`.
fn parse_reg_exp(node: Expr, excluded_flags: &[u8]) -> Option<Vec<u8>> {
    let evaluated = get_static_value(node, Some(node.file().scope()))?;
    let (pattern, flags) = evaluated.as_regex()?;
    if strings::index_of_any(flags, excluded_flags).is_some() {
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
    for element in elements {
        let RegexKind::Character { value } = element.kind() else {
            return None;
        };
        // Without the `u` flag a character outside the BMP is two.
        strings::push_codepoint_wtf8_joined(&mut text, value);
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

/// tsgolint's `escapeString`: the pattern goes into the string as it is written.
fn tsgolint_escape_string(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for &byte in text {
        if byte == b'\'' {
            out.push(b'\\');
        }
        out.push(byte);
    }
    out
}

/// The value of the string literal `'{body}'` in a module. `None` if it is none, or has an escape that
/// `tsgolint_is_simple_literal_pattern` lets no pattern have.
fn string_literal_value(body: &[u8]) -> Option<Vec<u8>> {
    let mut value = Vec::with_capacity(body.len());
    let mut rest = body;
    while let [byte, after @ ..] = rest {
        rest = after;
        match *byte {
            b'\'' | b'\n' | b'\r' => return None,
            b'\\' => {
                let [escaped, after @ ..] = rest else {
                    return None;
                };
                rest = after;
                value.push(match *escaped {
                    b'n' => b'\n',
                    b't' => b'\t',
                    b'r' => b'\r',
                    b'b' => 0x08,
                    b'v' => 0x0B,
                    b'f' => 0x0C,
                    b'0' if !rest.first().is_some_and(u8::is_ascii_digit) => 0,
                    // An octal escape, `\x`, `\u`, a line continuation.
                    b'0'..=b'9' | b'x' | b'u' | b'\n' | b'\r' | 0x80..=0xFF => return None,
                    escaped => escaped,
                });
            }
            byte => value.push(byte),
        }
    }
    Some(value)
}

/// Whether a variable is a `RegExp` that matches `value` alone wherever it is read: nothing but its
/// declarations writes it, and every initializer is such a `RegExp`. A type of the same name is no value.
fn is_always_reg_exp_of(symbol: Symbol<'_>, value: &[u8]) -> bool {
    !symbol.has_modifying_references()
        && symbol.declarations().all(|declaration| match declaration {
            Declaration::Var(pat) => match pat.parent() {
                Node::VarDecl(declaration) => (declaration.init())
                    .is_none_or(|init| parse_reg_exp(init, b"igy").is_some_and(|it| it.as_slice() == value)),
                _ => false,
            },
            Declaration::Interface(_) | Declaration::TypeAlias(_) => true,
            _ => false,
        })
}

/// tsgolint's fix of `/a/.test(b)`: `b` as it is written after the `(`, then `.includes('a')` with the pattern
/// as it is written. `regex` is where tsgolint reads the pattern: `object`, or the initializer of the variable
/// that `object` is. No fix where tsgolint's is another program or none: `regex` is not a `RegExp` that
/// matches one string wherever it starts, the variable is written again, `b` is a spread.
fn tsgolint_fix_test_call<'a>(
    fixer: Fixer<'a>,
    call_node: Expr<'a>,
    object: Expr<'a>,
    regex: Expr<'a>,
    argument: Expr<'a>,
    pattern: &[u8],
) -> Option<Fix> {
    let needs_parens = !argument.is_parenthesized()
        && match argument.kind() {
            ExprKind::Spread(_) => return None,
            ExprKind::Ident(_)
            | ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_) => false,
            ExprKind::Template(template) => !template.exprs().is_empty(),
            _ => true,
        };
    let value = parse_reg_exp(regex, b"igy").filter(|value| strings::is_valid_utf8(value))?;
    if object.tag() == ExprTag::Ident && !object.symbol().is_some_and(|it| is_always_reg_exp_of(it, &value)) {
        return None;
    }
    let written_pattern = tsgolint_escape_string(pattern);
    let escaped = if string_literal_value(&written_pattern).is_some_and(|it| it == value) {
        written_pattern
    } else if strings::contains_char(&value, 0) {
        // `\0` before a digit is an octal escape.
        return None;
    } else {
        escape_string(&value)
    };
    let file = fixer.file();
    let (open, close): (&[u8], &[u8]) = if needs_parens { (b"(", b")") } else { (b"", b"") };
    let argument_text = file.slice(argument.outer_span());
    Some(fixer.replace(call_node, [open, argument_text, close, b".includes('", escaped.as_slice(), b"')"].concat()))
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
        let is_oxlint = cx.language().is_oxlint;
        // tsgolint wants the call on the left as it is written.
        if is_oxlint && call_node.is_parenthesized() {
            return;
        }
        // Upstream's selector takes every `MemberExpression` directly in the call: also an argument.
        // tsgolint takes the callee alone.
        let candidates = if is_oxlint { 1 } else { usize::MAX };
        for node in std::iter::once(call.callee()).chain(call.args()).take(candidates) {
            let is_index_of = if is_oxlint {
                // The property access as it is written, with a name that is no `#indexOf`.
                matches!(node.kind(), ExprKind::Dot { name, .. } if name.name().is("indexOf"))
                    && !node.is_parenthesized()
                    && tsgolint_is_number_literal(right, number)
            } else {
                // `(a?.indexOf)(b)` calls a `ChainExpression`.
                matches!(node.tag(), ExprTag::Dot | ExprTag::Index)
                    && !node.is_chain_root()
                    && is_static_member_access_of_value(node, &["indexOf"])
                    && is_number(right, number)
            };
            if !is_index_of {
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
            // `a?.indexOf(b) !== -1` is not the same as `a?.includes(b)`. tsgolint makes it that.
            if call_node.is_chain_root() && !is_oxlint {
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
        let is_oxlint = cx.language().is_oxlint;
        // tsgolint wants the property access as it is written, with a name that is no `#test`.
        if is_oxlint && (callee.is_parenthesized() || !name.name().is("test")) {
            return;
        }
        let Some(argument) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        // tsgolint has the pattern as it is written, and neither evaluates nor parses it.
        let resolved: Option<(Expr<'a>, Cow<'_, [u8]>)> = if is_oxlint {
            tsgolint_resolve_regex_pattern(obj).map(|(regex, pattern)| (regex, Cow::Borrowed(pattern)))
        } else {
            parse_reg_exp(obj, b"ig").map(|text| (obj, Cow::Owned(text)))
        };
        let Some((regex, text)) = resolved else {
            return;
        };
        let includes = get_constrained_type_at_location(argument).get_property(b"includes");
        if includes.is_none_or(|it| it.declarations().next().is_none()) {
            return;
        }
        cx.report(call_node, PREFER_STRING_INCLUDES).fix(|fixer| {
            if is_oxlint {
                return tsgolint_fix_test_call(fixer, call_node, obj, regex, argument, &text);
            }
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
            Some(fixer.replace(call_node, [open, argument.text(), close, dot, b"includes('", escaped.as_slice(), b"')"].concat()))
        });
    }
}

impl Rule for PreferIncludes {
    const META: Meta = Meta::typescript("prefer-includes", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Binary, ExprTag::Call]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferIncludes
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match expr.tag() {
            ExprTag::Binary => self.check_comparison(expr, cx),
            ExprTag::Call => self.check_test_call(expr, cx),
            _ => {}
        }
    }
}
