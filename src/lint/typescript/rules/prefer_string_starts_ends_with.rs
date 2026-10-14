use bun_core::printer::json_stringify_alloc;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::{Assertion, Kind as RegexKind};
use bun_lint::regex::{Mode, Options as RegexOptions, parse_pattern};
use bun_lint::types::TypeFlags;
use bun_lint::types::utils::get_type_name;
use bun_lint::utils::eslint_utils::{StaticValue, get_property_name, get_static_value};
use bun_lint::utils::text::string_from_code_points;
use bun_lint::utils::ts_utils::is_static_member_access_of_value;

/// Enforce using `String#startsWith` and `String#endsWith` over other equivalent methods of
/// checking substrings.
pub struct PreferStringStartsEndsWith {
    allow_single_element_equality: bool,
}

const PREFER_ENDS_WITH: Message =
    Message::new("preferEndsWith", "Use the 'String#endsWith' method instead.");
const PREFER_STARTS_WITH: Message =
    Message::new("preferStartsWith", "Use 'String#startsWith' method instead.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum Side {
    Start,
    End,
}

impl Side {
    fn message(self) -> Message {
        match self {
            Side::Start => PREFER_STARTS_WITH,
            Side::End => PREFER_ENDS_WITH,
        }
    }

    /// `.startsWith`, `?.endsWith`
    fn access(self, is_optional: bool) -> &'static str {
        match (self, is_optional) {
            (Side::Start, false) => ".startsWith",
            (Side::Start, true) => "?.startsWith",
            (Side::End, false) => ".endsWith",
            (Side::End, true) => "?.endsWith",
        }
    }
}

fn static_value(node: Expr<'_>) -> Option<StaticValue<'_>> {
    get_static_value(node, Some(node.file().scope()))
}

fn is_string_type(node: Expr) -> bool {
    let object_type = node.ty();
    // The name of no other type is `string`, and it need not be printed to tell.
    let can_be_string = TypeFlags::STRING_LIKE
        | TypeFlags::TYPE_PARAMETER
        | TypeFlags::UNION
        | TypeFlags::INTERSECTION;
    object_type.has_flags(can_be_string) && get_type_name(object_type) == b"string"
}

fn is_null(node: Expr) -> bool {
    static_value(node).is_some_and(|evaluated| evaluated.is_nullish())
}

fn is_number(node: Expr, value: f64) -> bool {
    let evaluated = match node.file().language().is_oxlint {
        true => tsgolint_static_number(node),
        false => static_value(node).and_then(|evaluated| evaluated.as_number()),
    };
    evaluated == Some(value)
}

/// Whether `node` is a string of one UTF-16 code unit.
fn is_character(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        return tsgolint_static_string(node, true).is_some_and(|it| strings::utf8_lossy_len_utf16(it) == 1);
    }
    static_value(node).is_some_and(|evaluated| evaluated.as_str().is_some_and(|it| strings::wtf8_len_utf16(it) == 1))
}

fn is_equality_comparison(op: BinOp) -> bool {
    matches!(op, BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq)
}

fn is_negative(op: BinOp) -> bool {
    matches!(op, BinOp::NotEq | BinOp::NotEqEq)
}

/// How many variables are followed to their initializers: `const a = b, b = a` has no end.
const MAX_INITIALIZERS: usize = 8;

/// What tsgolint evaluates in place of `node`, an identifier: the initializer of the variable, whatever else is
/// assigned to it. `for_fix`: of a variable alone that nothing else is assigned to.
fn tsgolint_initializer<'a>(node: Expr<'a>, for_fix: bool) -> Option<Expr<'a>> {
    if for_fix && node.symbol().is_none_or(|it| it.has_modifying_references() || it.declaration_count() != 1) {
        return None;
    }
    match node.ts_symbol()?.value_declaration()?.to_ast()? {
        Node::VarDecl(declaration) => declaration.init(),
        _ => None,
    }
}

/// tsgolint's `staticNumber`: a numeric literal, or one after `-`.
fn tsgolint_static_number(mut node: Expr) -> Option<f64> {
    let mut is_negated = false;
    while let ExprKind::Unary { op: UnOp::Minus, operand } = node.kind() {
        (node, is_negated) = (operand, !is_negated);
    }
    node.as_number().map(|it| if is_negated { -it } else { it })
}

/// tsgolint's `staticString`: a string, a template without substitutions, or a variable with one as its initializer.
fn tsgolint_static_string<'a>(mut node: Expr<'a>, for_fix: bool) -> Option<&'a [u8]> {
    for _ in 0..MAX_INITIALIZERS {
        match node.kind() {
            ExprKind::String(value) => return Some(value.bytes()),
            ExprKind::Template(template) => return Some(template.as_static()?.bytes()),
            ExprKind::Ident(_) => node = tsgolint_initializer(node, for_fix)?,
            _ => return None,
        }
    }
    None
}

/// tsgolint's `getNullishKind`: `null`, and with `is_loose`, which is for `==` and `!=`, also `void` and whatever is
/// named `undefined`. Or a variable with one of these as its initializer.
fn tsgolint_is_nullish(mut node: Expr, is_loose: bool, for_fix: bool) -> bool {
    for _ in 0..MAX_INITIALIZERS {
        match node.kind() {
            ExprKind::Null => return true,
            ExprKind::Unary { op: UnOp::Void, .. } => return is_loose,
            // `for_fix`: not an `undefined` that the file declares, unless its type is `null` or `undefined`.
            ExprKind::Ident(name) if name.is("undefined") => {
                return is_loose
                    && !(for_fix
                        && node.symbol().is_some()
                        && !node.ty().has_flags(TypeFlags::NULL | TypeFlags::UNDEFINED));
            }
            ExprKind::Ident(_) => match tsgolint_initializer(node, for_fix) {
                Some(initializer) => node = initializer,
                None => return false,
            },
            _ => return false,
        }
    }
    false
}

/// tsgolint's `getPropertyName`: the name as it is written, a private one with its `#`. Of a computed member the key
/// that is a string or a template without substitutions.
fn tsgolint_property_name<'a>(node: Expr<'a>) -> Option<&'a [u8]> {
    match node.kind() {
        ExprKind::Dot { name, .. } => Some(name.bytes()),
        ExprKind::Index { index, .. } => match index.kind() {
            ExprKind::String(value) => Some(value.bytes()),
            ExprKind::Template(template) => Some(template.as_static()?.bytes()),
            _ => None,
        },
        _ => None,
    }
}

/// tsgolint's `isSameTokens`: the same text without its white space, of which only that of ASCII is left out here.
/// `for_fix`: and the same tokens, which `"a b"` and `"ab"` are not, nor `x as T` and `xasT`.
fn tsgolint_is_same_tokens<'a>(left: Expr<'a>, right: Expr<'a>, for_fix: bool) -> bool {
    let without_white_space = |text: &'a [u8]| text.iter().filter(|byte| !matches!(**byte, b'\t'..=b'\r' | b' '));
    without_white_space(left.text()).eq(without_white_space(right.text()))
        && (!for_fix || ast_utils::equal_tokens(left.file(), left, right))
}

/// tsgolint's `isLengthExpression`. A string is as long as Go has it: half a surrogate pair counts as three.
/// `for_fix`: and as long as it is, and `foo?.length` is the length of a string alone.
fn tsgolint_is_length_expression<'a>(node: Expr<'a>, expected_object: Expr<'a>, for_fix: bool) -> bool {
    if let Some(object) = node.object()
        && tsgolint_property_name(node).is_some_and(|name| name == b"length")
        && tsgolint_is_same_tokens(object, expected_object, for_fix)
        && !(for_fix && node.is_optional() && !is_string_type(object))
    {
        return true;
    }
    let Some(evaluated_length) = tsgolint_static_number(node) else {
        return false;
    };
    tsgolint_static_string(expected_object, for_fix).is_some_and(|it| {
        evaluated_length == f64::from(strings::utf8_lossy_len_utf16(it))
            && (!for_fix || evaluated_length == f64::from(strings::wtf8_len_utf16(it)))
    })
}

/// Whether `node` is the length of the string `expected_object_node`: its `length` property, or
/// for a string that is known, the number. `for_fix`: not what tsgolint reports for its text alone.
fn is_length_expression<'a>(node: Expr<'a>, expected_object_node: Expr<'a>, for_fix: bool) -> bool {
    if node.file().language().is_oxlint {
        return tsgolint_is_length_expression(node, expected_object_node, for_fix);
    }
    if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = node.kind()
        && !node.is_chain_root()
    {
        return get_property_name(node, Some(node.file().scope())).is_some_and(|name| *name == *b"length")
            && ast_utils::equal_tokens(node.file(), obj, expected_object_node);
    }
    let Some(evaluated_length) = static_value(node).and_then(|it| it.as_number()) else {
        return false;
    };
    static_value(expected_object_node)
        .is_some_and(|it| it.as_str().is_some_and(|it| evaluated_length == f64::from(strings::wtf8_len_utf16(it))))
}

/// Whether `node` is `-substring.length` or `parentString.length - substring.length`.
fn is_length_ahead_of_end<'a>(node: Expr<'a>, substring: Expr<'a>, parent_string: Expr<'a>, for_fix: bool) -> bool {
    match node.kind() {
        ExprKind::Unary { op: UnOp::Minus, operand } => is_length_expression(operand, substring, for_fix),
        ExprKind::Binary { op: BinOp::Sub, left, right } => {
            is_length_expression(left, parent_string, for_fix) && is_length_expression(right, substring, for_fix)
        }
        _ => false,
    }
}

/// `foo.length - 1`
fn is_last_index_expression<'a>(node: Expr<'a>, expected_object_node: Expr<'a>, for_fix: bool) -> bool {
    matches!(
        node.kind(),
        ExprKind::Binary { op: BinOp::Sub, left, right }
            if is_length_expression(left, expected_object_node, for_fix) && is_number(right, 1.0)
    )
}

/// The `[foo]` of `obj[foo]`, the `.foo` of `(obj).foo`.
fn get_property_range<'a>(node: Expr<'a>, object: Expr<'a>) -> Span {
    Span::new(skip_trivia(node.file().text(), object.outer_span().end), node.span().end)
}

/// The string that `pattern` matches besides its `^` or `$`, if there is only one.
fn parse_reg_exp_text(pattern: &[u8], unicode: bool) -> Option<Vec<u8>> {
    let mode = Mode {
        unicode,
        unicode_sets: false,
    };
    let ast = parse_pattern(pattern, mode, RegexOptions::default()).ok()?;
    let RegexKind::Pattern { alternatives } = ast.pattern().kind() else {
        return None;
    };
    if alternatives.len() != 1 {
        return None;
    }
    let RegexKind::Alternative { elements } = alternatives.first()?.kind() else {
        return None;
    };
    let mut chars = elements.iter();
    if matches!(elements.first()?.kind(), RegexKind::Assertion(Assertion::Start)) {
        chars.next();
    } else {
        chars.next_back();
    }
    let value = |c: bun_lint::regex::Node| match c.kind() {
        RegexKind::Character { value } => Some(value),
        _ => None,
    };
    if !chars.clone().all(|c| value(c).is_some()) {
        return None;
    }
    Some(string_from_code_points(chars.filter_map(value)))
}

/// Whether tsgolint's `parseRegExpText` can read `content`, a pattern without its `^` or `$`: it has no parser for
/// regular expressions, and gives up at every character that can have a meaning, also where it has none.
fn tsgolint_can_read(content: &[u8]) -> bool {
    let mut is_escaped = false;
    for &byte in content {
        let not_read: &[u8] = if is_escaped { b"dDwWsSbBcxukpP123456789" } else { b".*+?|^$[](){}" };
        if strings::contains_char(not_read, byte) {
            return false;
        }
        is_escaped = !is_escaped && byte == b'\\';
    }
    !is_escaped
}

/// What tsgolint's `parseRegExpText` reads in `content`, which `tsgolint_can_read` says it can read.
fn tsgolint_text(content: &[u8]) -> Vec<u8> {
    let mut text = Vec::with_capacity(content.len());
    let mut is_escaped = false;
    for &byte in content {
        if is_escaped {
            text.push(match byte {
                b'n' => b'\n',
                b'r' => b'\r',
                b't' => b'\t',
                b'v' => 0x0B,
                b'f' => 0x0C,
                b'0' => 0,
                _ => byte,
            });
        } else if byte != b'\\' {
            text.push(byte);
        }
        is_escaped = !is_escaped && byte == b'\\';
    }
    text
}

/// tsgolint's `parseRegExp`: a literal, `new RegExp` of one or two strings, or a variable with one of these as its
/// initializer. `RegExp` is whatever has the name, and the pattern has a `$` at its end also after a `\`.
/// `for_fix`: not a `RegExp` that the file declares.
fn tsgolint_parse_reg_exp<'a>(mut node: Expr<'a>, for_fix: bool) -> Option<(Side, Vec<u8>)> {
    // Here it does not skip parentheses.
    let string_literal = |argument: Expr<'a>| argument.as_string().filter(|_| !argument.is_parenthesized());
    for _ in 0..MAX_INITIALIZERS {
        let (pattern, flags) = match node.kind() {
            ExprKind::Regex(regex) => (regex.pattern(), regex.flags()),
            ExprKind::New(call)
                if call.callee().is_ident("RegExp")
                    && !call.callee().is_parenthesized()
                    && !(for_fix && call.callee().symbol().is_some()) =>
            {
                let args = call.args();
                let pattern = string_literal(args.first()?)?.bytes();
                match args.get(1) {
                    Some(flags) => (pattern, string_literal(flags)?.bytes()),
                    None => (pattern, b"".as_slice()),
                }
            }
            ExprKind::Ident(_) => {
                node = tsgolint_initializer(node, for_fix)?;
                continue;
            }
            _ => return None,
        };
        if strings::index_of_any(flags, b"imgy").is_some() {
            return None;
        }
        let (side, content) = match (pattern.strip_prefix(b"^"), pattern.strip_suffix(b"$")) {
            (Some(content), None) => (Side::Start, content),
            (None, Some(content)) => (Side::End, content),
            _ => return None,
        };
        return tsgolint_can_read(content).then(|| (side, tsgolint_text(content)));
    }
    None
}

/// What `node` matches, if it is a `RegExp` for a string at the start or at the end.
fn parse_reg_exp(node: Expr) -> Option<(Side, Vec<u8>)> {
    if node.file().language().is_oxlint {
        return tsgolint_parse_reg_exp(node, false);
    }
    let evaluated = static_value(node)?;
    let (source, flags) = evaluated.as_regex()?;
    let is_starts_with = source.starts_with(b"^");
    // A `$` after an even number of backslashes, and something before these.
    let is_ends_with = source.strip_suffix(b"$").is_some_and(|before| {
        let backslashes = before.iter().rev().take_while(|byte| **byte == b'\\').count();
        backslashes % 2 == 0 && backslashes < before.len()
    });
    if is_starts_with == is_ends_with || strings::index_of_any(flags, b"im").is_some() {
        return None;
    }
    let text = parse_reg_exp_text(source, strings::contains_char(flags, b'u'))?;
    Some((if is_starts_with { Side::Start } else { Side::End }, text))
}

/// A comparison whose left side is `member`, or a call of it.
#[derive(Copy, Clone)]
struct Comparison<'a> {
    /// The `BinaryExpression`.
    node: Expr<'a>,
    op: BinOp,
    left: Expr<'a>,
    right: Expr<'a>,
    /// The `MemberExpression`.
    member: Expr<'a>,
    object: Expr<'a>,
}

impl<'a> Comparison<'a> {
    /// The operator and the right side. tsgolint and typescript-eslint take the `)` of `(foo.indexOf(bar)) === 0` with
    /// them, and what is left cannot be parsed.
    fn after_left(self) -> Span {
        let left = match self.node.file().language().is_oxlint {
            true => self.left.outer_span(),
            false => self.left.span(),
        };
        Span::new(left.end, self.node.span().end)
    }

    /// `foo.slice(0, 3) === 'bar'` → `foo.startsWith('bar')`
    fn fix_with_right_operand(self, fixer: Fixer<'a>, side: Side) -> Vec<Fix> {
        let file = self.node.file();
        let property_range = get_property_range(self.member, self.object);
        let (node, mut right) = (self.node.span(), self.right.span());
        let access = side.access(self.member.is_optional());
        let mut fixes = Vec::with_capacity(4);
        if is_negative(self.op) {
            fixes.push(fixer.insert_before(node, "!"));
        }
        if file.language().is_oxlint {
            // `(a, b)` is one argument with its parentheses alone.
            if matches!(self.right.kind(), ExprKind::Binary { op: BinOp::Comma, .. }) {
                right = self.right.outer_span();
            }
            // tsgolint takes the `)` of `(foo[0]) === 'a'` and of `(foo?.slice)(0, 3) === 'bar'` away with the rest.
            if self.left.is_parenthesized() || self.member.is_parenthesized() {
                let call = [b"(".as_slice(), file.slice(right), b")".as_slice()].concat();
                let end_of_left = self.left.span().end;
                if property_range.end == end_of_left {
                    fixes.push(fixer.replace(property_range, [access.as_bytes(), call.as_slice()].concat()));
                } else {
                    fixes.push(fixer.replace(property_range, access));
                    let after_member = self.member.outer_span().end;
                    fixes.push(fixer.replace(Span::new(after_member, end_of_left), call));
                }
                fixes.push(fixer.remove(self.after_left()));
                return fixes;
            }
        }
        fixes.push(fixer.replace(Span::new(property_range.start, right.start), [access, "("].concat()));
        fixes.push(fixer.replace(Span::new(right.end, node.end), ")"));
        fixes
    }

    /// `foo.indexOf('bar') === 0` → `foo.startsWith('bar')`
    fn fix_with_argument(self, fixer: Fixer<'a>, side: Side) -> Vec<Fix> {
        let mut fixes = Vec::with_capacity(3);
        if is_negative(self.op) {
            fixes.push(fixer.insert_before(self.node, "!"));
        }
        fixes.push(fixer.replace(
            get_property_range(self.member, self.object),
            side.access(self.member.is_optional()),
        ));
        fixes.push(fixer.remove(self.after_left()));
        fixes
    }
}

impl PreferStringStartsEndsWith {
    /// `foo[0] === "a"`, `foo.charAt(0) === "a"`, `foo[foo.length - 1] === "a"`,
    /// `foo.charAt(foo.length - 1) === "a"`
    fn check_single_element<'a>(&self, it: &Comparison<'a>, index_node: Expr<'a>, cx: &Cx<'a, Self>) {
        if self.allow_single_element_equality
            || !is_equality_comparison(it.op)
            || !is_string_type(it.object)
        {
            return;
        }
        let side = if is_last_index_expression(index_node, it.object, false) {
            Side::End
        } else if is_number(index_node, 0.0) {
            Side::Start
        } else {
            return;
        };
        cx.report(it.node, side.message()).fix(|fixer| {
            // Anything else can change the behavior.
            let is_valid = is_character(it.right)
                && (side == Side::Start || is_last_index_expression(index_node, it.object, true));
            is_valid.then(|| it.fix_with_right_operand(fixer, side))
        });
    }

    /// `foo.indexOf('bar') === 0`
    fn check_index_of<'a>(it: &Comparison<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        if call.args().len() != 1
            || !is_equality_comparison(it.op)
            || !is_number(it.right, 0.0)
            || !is_string_type(it.object)
        {
            return;
        }
        cx.report(it.node, PREFER_STARTS_WITH)
            .fix(|fixer| it.fix_with_argument(fixer, Side::Start));
    }

    /// `foo.lastIndexOf('bar') === foo.length - 3`, `foo.lastIndexOf(bar) === foo.length - bar.length`
    fn check_last_index_of<'a>(it: &Comparison<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        let Some(argument) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        let ExprKind::Binary { op: BinOp::Sub, left, right } = it.right.kind() else {
            return;
        };
        if !is_equality_comparison(it.op)
            || !is_length_expression(left, it.object, false)
            || !is_length_expression(right, argument, false)
            || !is_string_type(it.object)
        {
            return;
        }
        cx.report(it.node, PREFER_ENDS_WITH).fix(|fixer| {
            let is_valid = is_length_expression(left, it.object, true) && is_length_expression(right, argument, true);
            is_valid.then(|| it.fix_with_argument(fixer, Side::End))
        });
    }

    /// `foo.match(/^bar/) === null`, `foo.match(/bar$/) === null`
    fn check_match<'a>(it: &Comparison<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        let Some(argument) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let is_loose = matches!(it.op, BinOp::EqEq | BinOp::NotEq);
        let is_nullish = match is_oxlint {
            // What `match` gives is never `undefined`: tsgolint leaves `=== undefined`.
            true => tsgolint_is_nullish(it.right, is_loose, false),
            false => is_null(it.right),
        };
        if !is_nullish || !is_string_type(it.object) {
            return;
        }
        let Some((side, text)) = parse_reg_exp(argument) else {
            return;
        };
        // typescript-eslint reports the call, tsgolint the comparison.
        let reported = if is_oxlint { it.node } else { it.left };
        cx.report(reported, side.message()).fix(|fixer| {
            let mut argument_range = argument.span();
            if is_oxlint {
                // tsgolint also fixes what only looks like `null` and like a `RegExp`.
                if !tsgolint_is_nullish(it.right, is_loose, true) || tsgolint_parse_reg_exp(argument, true).is_none() {
                    return None;
                }
                argument_range = argument.outer_span();
            }
            let mut fixes = Vec::with_capacity(4);
            if !is_negative(it.op) {
                fixes.push(fixer.insert_before(it.node, "!"));
            }
            fixes.push(fixer.replace(
                get_property_range(it.member, it.object),
                side.access(it.member.is_optional()),
            ));
            fixes.push(fixer.replace(argument_range, json_stringify_alloc(&text)));
            fixes.push(fixer.remove(it.after_left()));
            Some(fixes)
        });
    }

    /// `foo.slice(0, 3) === 'bar'`, `foo.slice(-3) === 'bar'`, `foo.slice(-3, foo.length) === 'bar'`,
    /// `foo.substring(0, 3) === 'bar'`, `foo.substring(foo.length - 3) === 'bar'`,
    /// `foo.substring(foo.length - 3, foo.length) === 'bar'`
    fn check_slice<'a>(it: &Comparison<'a>, call: Call<'a>, negative_index_supported: bool, cx: &Cx<'a, Self>) {
        if !is_equality_comparison(it.op) || !is_string_type(it.object) {
            return;
        }
        let args = call.args();
        let side_of = |for_fix: bool| match (args.len(), args.first(), args.get(1)) {
            // `foo.slice(-bar.length) === bar`, `foo.slice(foo.length - bar.length) === bar`
            (1, Some(start), _) if is_length_ahead_of_end(start, it.right, it.object, for_fix) => Some(Side::End),
            // `foo.slice(0, bar.length) === bar`
            (2, Some(start), Some(end)) if is_number(start, 0.0) && is_length_expression(end, it.right, for_fix) => {
                Some(Side::Start)
            }
            // `foo.slice(foo.length - bar.length, foo.length) === bar`, `foo.slice(-bar.length, 0) === bar`
            (2, Some(start), Some(end))
                if (is_length_expression(end, it.object, for_fix) || is_number(end, 0.0))
                    && is_length_ahead_of_end(start, it.right, it.object, for_fix) =>
            {
                Some(Side::End)
            }
            _ => None,
        };
        let Some(side) = side_of(false) else {
            return;
        };
        cx.report(it.node, side.message()).fix(|fixer| {
            // `==` converts what is not a string.
            if matches!(it.op, BinOp::EqEq | BinOp::NotEq) && it.right.tag() != ExprTag::String {
                return None;
            }
            // tsgolint also fixes what only looks like the lengths, and `foo.slice(-bar.length, 0)`, which is empty.
            if it.node.file().language().is_oxlint
                && (side_of(true) != Some(side)
                    || (side == Side::End
                        && args.get(1).is_some_and(|end| !is_length_expression(end, it.object, true))))
            {
                return None;
            }
            // The code is likely a mistake if the lengths differ, or if it relies on `substring`
            // taking a negative index for 0.
            let is_valid = match side {
                Side::Start => is_length_expression(args.get(1)?, it.right, true),
                Side::End => match args.first()?.kind() {
                    ExprKind::Binary { op: BinOp::Sub, left, right } => {
                        is_length_expression(left, it.object, true) && is_length_expression(right, it.right, true)
                    }
                    ExprKind::Unary { op: UnOp::Minus, operand } => {
                        negative_index_supported && is_length_expression(operand, it.right, true)
                    }
                    _ => false,
                },
            };
            is_valid.then(|| it.fix_with_right_operand(fixer, side))
        });
    }

    fn check_binary_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = node.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // A `LogicalExpression` or a `SequenceExpression`. tsgolint listens to the four equality operators alone.
        if matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
            || (is_oxlint && !is_equality_comparison(op))
        {
            return;
        }
        let comparison = |member: Expr<'a>, object: Expr<'a>| Comparison {
            node,
            op,
            left,
            right,
            member,
            object,
        };
        let call = match left.kind() {
            ExprKind::Index { obj, index, .. } => {
                return self.check_single_element(&comparison(left, obj), index, cx);
            }
            ExprKind::Call(call) => call,
            _ => return,
        };
        let callee = call.callee();
        let (object, name) = match callee.kind() {
            // `(a?.b)()` calls a `ChainExpression`. tsgolint has parentheses there, which it skips.
            _ if callee.is_chain_root() && !is_oxlint => return,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if is_oxlint => {
                match tsgolint_property_name(callee) {
                    Some(name) => (obj, name),
                    None => return,
                }
            }
            // The `name` of a `PrivateIdentifier` has no `#`.
            ExprKind::Dot { obj, name, .. } => (obj, name.bytes().strip_prefix(b"#").unwrap_or_else(|| name.bytes())),
            ExprKind::Index { obj, index, .. } => {
                if is_static_member_access_of_value(callee, &["slice", "substring"]) {
                    Self::check_slice(&comparison(callee, obj), call, index.is_ident("slice"), cx);
                }
                return;
            }
            _ => return,
        };
        let it = &comparison(callee, object);
        match name {
            b"charAt" => {
                if let Some(index_node) = call.args().first().filter(|_| call.args().len() == 1) {
                    self.check_single_element(it, index_node, cx);
                }
            }
            b"indexOf" => Self::check_index_of(it, call, cx),
            b"lastIndexOf" => Self::check_last_index_of(it, call, cx),
            b"match" => Self::check_match(it, call, cx),
            b"slice" => Self::check_slice(it, call, true, cx),
            b"substring" => Self::check_slice(it, call, false, cx),
            _ => {}
        }
    }

    /// `/^bar/.test(foo)`, `/bar$/.test(foo)`
    fn check_test_call<'a>(&self, call_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = call_node.kind() else {
            return;
        };
        let callee = call.callee();
        let is_oxlint = cx.language().is_oxlint;
        let obj = if is_oxlint {
            // tsgolint's `callMemberCallee` and `getPropertyName`: also `/a/["test"]` and `(/a/?.test)`, not `#test`.
            match (callee.object(), tsgolint_property_name(callee)) {
                (Some(obj), Some(name)) if name == b"test" => obj,
                _ => return,
            }
        } else {
            let ExprKind::Dot { obj, name, .. } = callee.kind() else {
                return;
            };
            if !name.name().is_any(&["test", "#test"]) || callee.is_chain_root() {
                return;
            }
            obj
        };
        let Some(arg_node) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        let Some((side, text)) = parse_reg_exp(obj) else {
            return;
        };
        cx.report(call_node, side.message()).fix(|fixer| {
            // tsgolint also fixes what only looks like a `RegExp`, and has `(...a).startsWith("a")` for `...a`.
            if is_oxlint
                && (tsgolint_parse_reg_exp(obj, true).is_none() || matches!(arg_node.kind(), ExprKind::Spread(_)))
            {
                return None;
            }
            let needs_paren = match arg_node.kind() {
                // tsgolint has parentheses around `null`, and none around `a?.b`.
                ExprKind::True | ExprKind::False | ExprKind::Null => is_oxlint,
                ExprKind::String(_)
                | ExprKind::Number(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex(_)
                | ExprKind::Template(_)
                | ExprKind::Ident(_) => false,
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                    !is_oxlint && arg_node.is_chain_root()
                }
                _ => true,
            };
            // tsgolint leaves the `)` of `(a)` behind. Here both stay, and no more are needed.
            let needs_paren = needs_paren && !(is_oxlint && arg_node.is_parenthesized());
            let arg = if is_oxlint { arg_node.outer_span() } else { arg_node.span() };
            let mut fixes = vec![fixer.remove(Span::new(call_node.span().start, arg.start))];
            if needs_paren {
                fixes.push(fixer.insert_before(arg, "("));
                fixes.push(fixer.insert_after(arg, ")"));
            }
            let (access, search) = (side.access(callee.is_optional()).as_bytes(), json_stringify_alloc(&text));
            fixes.push(fixer.insert_after(arg, [access, b"(", search.as_slice()].concat()));
            Some(fixes)
        });
    }
}

impl Rule for PreferStringStartsEndsWith {
    const META: Meta = Meta::typescript("prefer-string-starts-ends-with", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Binary, ExprTag::Call]);
    no_state!();

    fn new(options: &Options) -> Self {
        PreferStringStartsEndsWith {
            allow_single_element_equality: options.object(0).str("allowSingleElementEquality") == Some("always"),
        }
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match expr.tag() {
            ExprTag::Binary => self.check_binary_expression(expr, cx),
            ExprTag::Call => self.check_test_call(expr, cx),
            _ => {}
        }
    }
}
