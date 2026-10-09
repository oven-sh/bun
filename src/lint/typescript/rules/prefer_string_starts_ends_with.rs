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
    static_value(node).and_then(|evaluated| evaluated.as_number()) == Some(value)
}

/// Whether `node` is a string of one UTF-16 code unit.
fn is_character(node: Expr) -> bool {
    static_value(node).is_some_and(|evaluated| evaluated.as_str().is_some_and(|it| strings::wtf8_len_utf16(it) == 1))
}

fn is_equality_comparison(op: BinOp) -> bool {
    matches!(op, BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq)
}

fn is_negative(op: BinOp) -> bool {
    matches!(op, BinOp::NotEq | BinOp::NotEqEq)
}

/// Whether `node` is the length of the string `expected_object_node`: its `length` property, or
/// for a string that is known, the number.
fn is_length_expression<'a>(node: Expr<'a>, expected_object_node: Expr<'a>) -> bool {
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
fn is_length_ahead_of_end<'a>(node: Expr<'a>, substring: Expr<'a>, parent_string: Expr<'a>) -> bool {
    match node.kind() {
        ExprKind::Unary { op: UnOp::Minus, operand } => is_length_expression(operand, substring),
        ExprKind::Binary { op: BinOp::Sub, left, right } => {
            is_length_expression(left, parent_string) && is_length_expression(right, substring)
        }
        _ => false,
    }
}

/// `foo.length - 1`
fn is_last_index_expression<'a>(node: Expr<'a>, expected_object_node: Expr<'a>) -> bool {
    matches!(
        node.kind(),
        ExprKind::Binary { op: BinOp::Sub, left, right }
            if is_length_expression(left, expected_object_node) && is_number(right, 1.0)
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

/// What `node` matches, if it is a `RegExp` for a string at the start or at the end.
fn parse_reg_exp(node: Expr) -> Option<(Side, Vec<u8>)> {
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
    let content = if is_starts_with { source.get(1..) } else { source.get(..source.len().saturating_sub(1)) };
    if node.file().language().is_oxlint
        && (strings::index_of_any(flags, b"gy").is_some() || !tsgolint_can_read(content.unwrap_or_default()))
    {
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
    right: Expr<'a>,
    /// The `MemberExpression`.
    member: Expr<'a>,
    object: Expr<'a>,
}

impl<'a> Comparison<'a> {
    /// `foo.slice(0, 3) === 'bar'` → `foo.startsWith('bar')`
    fn fix_with_right_operand(self, fixer: Fixer<'a>, side: Side) -> Vec<Fix> {
        let property_range = get_property_range(self.member, self.object);
        let (node, right) = (self.node.span(), self.right.span());
        let mut fixes = Vec::with_capacity(3);
        if is_negative(self.op) {
            fixes.push(fixer.insert_before(node, "!"));
        }
        fixes.push(fixer.replace(
            Span::new(property_range.start, right.start),
            [side.access(self.member.is_optional()), "("].concat(),
        ));
        fixes.push(fixer.replace(Span::new(right.end, node.end), ")"));
        fixes
    }

    /// `foo.indexOf('bar') === 0` → `foo.startsWith('bar')`
    fn fix_with_argument(self, fixer: Fixer<'a>, call_node: Expr<'a>, side: Side) -> Vec<Fix> {
        let mut fixes = Vec::with_capacity(3);
        if is_negative(self.op) {
            fixes.push(fixer.insert_before(self.node, "!"));
        }
        fixes.push(fixer.replace(
            get_property_range(self.member, self.object),
            side.access(self.member.is_optional()),
        ));
        fixes.push(fixer.remove(Span::new(call_node.span().end, self.node.span().end)));
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
        let side = if is_last_index_expression(index_node, it.object) {
            Side::End
        } else if is_number(index_node, 0.0) {
            Side::Start
        } else {
            return;
        };
        cx.report(it.node, side.message()).fix(|fixer| {
            // Anything else can change the behavior.
            is_character(it.right).then(|| it.fix_with_right_operand(fixer, side))
        });
    }

    /// `foo.indexOf('bar') === 0`
    fn check_index_of<'a>(it: &Comparison<'a>, call_node: Expr<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        if call.args().len() != 1
            || !is_equality_comparison(it.op)
            || !is_number(it.right, 0.0)
            || !is_string_type(it.object)
        {
            return;
        }
        cx.report(it.node, PREFER_STARTS_WITH)
            .fix(|fixer| it.fix_with_argument(fixer, call_node, Side::Start));
    }

    /// `foo.lastIndexOf('bar') === foo.length - 3`, `foo.lastIndexOf(bar) === foo.length - bar.length`
    fn check_last_index_of<'a>(it: &Comparison<'a>, call_node: Expr<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        let Some(argument) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        let ExprKind::Binary { op: BinOp::Sub, left, right } = it.right.kind() else {
            return;
        };
        if !is_equality_comparison(it.op)
            || !is_length_expression(left, it.object)
            || !is_length_expression(right, argument)
            || !is_string_type(it.object)
        {
            return;
        }
        cx.report(it.node, PREFER_ENDS_WITH)
            .fix(|fixer| it.fix_with_argument(fixer, call_node, Side::End));
    }

    /// `foo.match(/^bar/) === null`, `foo.match(/bar$/) === null`
    fn check_match<'a>(it: &Comparison<'a>, call_node: Expr<'a>, call: Call<'a>, cx: &Cx<'a, Self>) {
        let Some(argument) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        if !is_null(it.right) || !is_string_type(it.object) {
            return;
        }
        // What `match` gives is never `undefined`: tsgolint 7.0 leaves `=== undefined`.
        if cx.language().is_oxlint
            && matches!(it.op, BinOp::EqEqEq | BinOp::NotEqEq)
            && !matches!(static_value(it.right), Some(StaticValue::Null))
        {
            return;
        }
        let Some((side, text)) = parse_reg_exp(argument) else {
            return;
        };
        cx.report(call_node, side.message()).fix(|fixer| {
            let mut fixes = Vec::with_capacity(4);
            if !is_negative(it.op) {
                fixes.push(fixer.insert_before(it.node, "!"));
            }
            fixes.push(fixer.replace(
                get_property_range(it.member, it.object),
                side.access(it.member.is_optional()),
            ));
            fixes.push(fixer.replace(argument, json_stringify_alloc(&text)));
            fixes.push(fixer.remove(Span::new(call_node.span().end, it.node.span().end)));
            fixes
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
        let side = match (args.len(), args.first(), args.get(1)) {
            // `foo.slice(-bar.length) === bar`, `foo.slice(foo.length - bar.length) === bar`
            (1, Some(start), _) if is_length_ahead_of_end(start, it.right, it.object) => Side::End,
            // `foo.slice(0, bar.length) === bar`
            (2, Some(start), Some(end)) if is_number(start, 0.0) && is_length_expression(end, it.right) => {
                Side::Start
            }
            // `foo.slice(foo.length - bar.length, foo.length) === bar`, `foo.slice(-bar.length, 0) === bar`
            (2, Some(start), Some(end))
                if (is_length_expression(end, it.object) || is_number(end, 0.0))
                    && is_length_ahead_of_end(start, it.right, it.object) =>
            {
                Side::End
            }
            _ => return,
        };
        cx.report(it.node, side.message()).fix(|fixer| {
            // `==` converts what is not a string.
            if matches!(it.op, BinOp::EqEq | BinOp::NotEq) && it.right.tag() != ExprTag::String {
                return None;
            }
            // The code is likely a mistake if the lengths differ, or if it relies on `substring`
            // taking a negative index for 0.
            let is_valid = match side {
                Side::Start => is_length_expression(args.get(1)?, it.right),
                Side::End => match args.first()?.kind() {
                    ExprKind::Binary { op: BinOp::Sub, left, right } => {
                        is_length_expression(left, it.object) && is_length_expression(right, it.right)
                    }
                    ExprKind::Unary { op: UnOp::Minus, operand } => {
                        negative_index_supported && is_length_expression(operand, it.right)
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
        // A `LogicalExpression` or a `SequenceExpression`.
        if matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) {
            return;
        }
        let comparison = |member: Expr<'a>, object: Expr<'a>| Comparison {
            node,
            op,
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
        match callee.kind() {
            // `(a?.b)()` calls a `ChainExpression`.
            _ if callee.is_chain_root() => {}
            ExprKind::Dot { obj, name, .. } => {
                let it = &comparison(callee, obj);
                // The `name` of a `PrivateIdentifier` has no `#`.
                match name.bytes().strip_prefix(b"#").unwrap_or_else(|| name.bytes()) {
                    b"charAt" => {
                        if let Some(index_node) = call.args().first().filter(|_| call.args().len() == 1) {
                            self.check_single_element(it, index_node, cx);
                        }
                    }
                    b"indexOf" => Self::check_index_of(it, left, call, cx),
                    b"lastIndexOf" => Self::check_last_index_of(it, left, call, cx),
                    b"match" => Self::check_match(it, left, call, cx),
                    b"slice" => Self::check_slice(it, call, true, cx),
                    b"substring" => Self::check_slice(it, call, false, cx),
                    _ => {}
                }
            }
            ExprKind::Index { obj, index, .. } => {
                if is_static_member_access_of_value(callee, &["slice", "substring"]) {
                    Self::check_slice(&comparison(callee, obj), call, index.is_ident("slice"), cx);
                }
            }
            _ => {}
        }
    }

    /// `/^bar/.test(foo)`, `/bar$/.test(foo)`
    fn check_test_call<'a>(&self, call_node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = call_node.kind() else {
            return;
        };
        let callee = call.callee();
        let ExprKind::Dot { obj, name, .. } = callee.kind() else {
            return;
        };
        if !name.name().is_any(&["test", "#test"]) || callee.is_chain_root() {
            return;
        }
        let Some(arg_node) = call.args().first().filter(|_| call.args().len() == 1) else {
            return;
        };
        let Some((side, text)) = parse_reg_exp(obj) else {
            return;
        };
        cx.report(call_node, side.message()).fix(|fixer| {
            let needs_paren = match arg_node.kind() {
                ExprKind::String(_)
                | ExprKind::Number(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex(_)
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Null
                | ExprKind::Template(_)
                | ExprKind::Ident(_) => false,
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => arg_node.is_chain_root(),
                _ => true,
            };
            let mut fixes = vec![fixer.remove(Span::new(call_node.span().start, arg_node.span().start))];
            if needs_paren {
                fixes.push(fixer.insert_before(arg_node, "("));
                fixes.push(fixer.insert_after(arg_node, ")"));
            }
            let (access, search) = (side.access(callee.is_optional()).as_bytes(), json_stringify_alloc(&text));
            fixes.push(fixer.insert_after(arg_node, [access, b"(", search.as_slice()].concat()));
            fixes
        });
    }
}

impl Rule for PreferStringStartsEndsWith {
    const META: Meta = Meta::typescript("prefer-string-starts-ends-with", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferStringStartsEndsWith {
            allow_single_element_equality: options.object(0).str("allowSingleElementEquality") == Some("always"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check_binary_expression);
        on.exprs([ExprTag::Call], Self::check_test_call);
    }
}
