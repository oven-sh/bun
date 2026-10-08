use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::Kind as RegexKind};
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap, get_string_if_constant};

/// Enforce using named capture group in regular expression.
pub struct PreferNamedCaptureGroup;

const ADD_GROUP_NAME: Message = Message::new("addGroupName", "Add name to capture group.");
const ADD_NON_CAPTURE: Message = Message::new("addNonCapture", "Convert group to non-capturing.");
const REQUIRED: Message = Message::new(
    "required",
    "Capture group '{{group}}' should be converted to a named or non-capturing group.",
);

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);

/// Whether a position in `pattern` is known to be the same position in the text of `regex_node`,
/// after its delimiter.
fn is_written_as_is(pattern: &[u8], regex_node: Expr<'_>) -> bool {
    match regex_node.kind() {
        ExprKind::String(_) => !strings::contains_char(regex_node.text(), b'\\'),
        ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Regex(_) => true,
        ExprKind::Template(template) => template.exprs().is_empty() && template.raw(0) == pattern,
        _ => false,
    }
}

/// `?<tempN>`, where `N` is one more than the highest that `pattern` has.
fn temporary_group_name(pattern: &[u8]) -> Vec<u8> {
    let mut highest_temp_count = 0.0_f64;
    let mut rest = pattern;
    while let Some(at) = strings::index_of(rest, b"temp") {
        rest = &rest[at + "temp".len()..];
        let (digits, after) = rest.split_at(rest.iter().take_while(|b| b.is_ascii_digit()).count());
        if !digits.is_empty() {
            highest_temp_count = highest_temp_count.max(text::string_to_number(digits));
        }
        rest = after;
    }
    let count = text::number_to_string(highest_temp_count + 1.0);
    [&b"?<temp"[..], count.as_slice(), b">"].concat()
}

/// `node`: what has the regular expression, or the call. `regex_node`: what has the regular
/// expression.
fn check_regex<'a>(
    cx: &Cx<'a, PreferNamedCaptureGroup>,
    pattern: &[u8],
    node: Expr<'a>,
    regex_node: Expr<'a>,
    flags: &[u8],
) {
    if !strings::contains_char(pattern, b'(') {
        return;
    }
    let Ok(ast) = regex::parse_pattern(pattern, regex::Mode::of_flags(flags), regex::Options::default()) else {
        return;
    };
    for group in ast.capturing_groups() {
        if !matches!(group.kind(), RegexKind::CapturingGroup { name: None, .. }) {
            continue;
        }
        let report = cx.report(node, REQUIRED).data("group", group.raw().to_vec());
        if is_written_as_is(pattern, regex_node) {
            // After the delimiter and the `(`.
            let after_paren = text::utf16_offset_to_byte(regex_node.text(), group.utf16_start() + 2);
            let start = Span::empty(regex_node.span().start + after_paren as u32);
            report
                .suggest(ADD_GROUP_NAME, |fixer| fixer.insert_before(start, temporary_group_name(pattern)))
                .suggest(ADD_NON_CAPTURE, |fixer| fixer.insert_before(start, "?:"));
        }
    }
}

impl PreferNamedCaptureGroup {
    fn check_calls<'a>(&self, cx: &mut Cx<'a, Self>) {
        for reference in ReferenceTracker::new(cx.file()).iterate_global_references(&TRACE_MAP) {
            let (Some(node), Some(call)) = (reference.expr(), reference.call()) else {
                continue;
            };
            let Some(regex_node) = call.args().first() else {
                continue;
            };
            let Some(pattern) = get_string_if_constant(regex_node, None) else {
                continue;
            };
            let flags = call.args().get(1).and_then(|it| get_string_if_constant(it, None));
            check_regex(cx, &pattern, node, regex_node, flags.as_deref().unwrap_or_default());
        }
    }
}

impl Rule for PreferNamedCaptureGroup {
    const META: Meta = Meta::eslint("prefer-named-capture-group", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferNamedCaptureGroup
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Regex], |_, e, cx| {
            if let ExprKind::Regex(literal) = e.kind() {
                check_regex(cx, literal.pattern(), e, e, literal.flags());
            }
        });
        if file.has_exprs([ExprTag::Call, ExprTag::New]) {
            on.finish(Self::check_calls);
        }
    }
}
