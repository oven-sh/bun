use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::Kind as RegexKind};
use bun_lint::utils::char_source::Written;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap, get_string_if_constant};
use std::cell::OnceCell;

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
    let as_is = OnceCell::new();
    let in_string = OnceCell::new();
    let group_name = OnceCell::new();
    // Where the last group starts in `pattern`, in bytes and in UTF-16 units, and the offset in
    // bytes that `regex_node` has after as many units. The groups come in the order of their `(`,
    // so that all of them take time in proportion to the texts.
    let (mut start, mut utf16_start) = (0, 0);
    let mut written = Utf16Cursor::new(regex_node.text());
    for group in ast.capturing_groups() {
        if !matches!(group.kind(), RegexKind::CapturingGroup { name: None, .. }) {
            continue;
        }
        let since = pattern.get(start..group.start() as usize).unwrap_or_default();
        utf16_start += regex::utf16_index(since, since.len()) as u32;
        start += since.len();
        // oxlint points at the group, where it is written, or else at what the pattern is made of.
        let place = match cx.language().is_oxlint {
            true if *as_is.get_or_init(|| is_written_as_is(pattern, regex_node)) => {
                let pattern_start = regex_node.span().start + 1;
                Span::new(pattern_start + group.start(), pattern_start + group.end())
            }
            true => (in_string.get_or_init(|| Written::new(regex_node)).as_ref())
                .and_then(|it| it.span(utf16_start, utf16_start + regex::utf16_index(group.raw(), group.raw().len()) as u32))
                .unwrap_or_else(|| regex_node.span()),
            false => node.span(),
        };
        let report = cx.report(place, REQUIRED).data("group", group.raw().to_vec());
        if *as_is.get_or_init(|| is_written_as_is(pattern, regex_node)) {
            // After the delimiter and the `(`.
            let after_paren = Span::empty(regex_node.span().start + written.byte_offset(utf16_start + 2) as u32);
            report
                .suggest(ADD_GROUP_NAME, |fixer| {
                    fixer.insert_before(after_paren, &group_name.get_or_init(|| temporary_group_name(pattern))[..])
                })
                .suggest(ADD_NON_CAPTURE, |fixer| fixer.insert_before(after_paren, "?:"));
        }
    }
}

/// [`text::utf16_offset_to_byte`] for indices that do not decrease.
struct Utf16Cursor<'t> {
    text: &'t [u8],
    at: usize,
    /// How many UTF-16 units `text[..at]` has.
    units: u32,
}

impl<'t> Utf16Cursor<'t> {
    fn new(text: &'t [u8]) -> Self {
        Utf16Cursor {
            text,
            at: 0,
            units: 0,
        }
    }

    fn byte_offset(&mut self, index: u32) -> usize {
        loop {
            let (c, size) = text::code_point_at(self.text, self.at);
            let units = self.units + text::utf16_width(c);
            if size == 0 || units > index {
                return self.at;
            }
            (self.at, self.units) = (self.at + size, units);
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
            // For ESLint a literal is the string that it would be made into, for oxlint it is no string.
            if cx.language().is_oxlint && regex_node.tag() == ExprTag::Regex {
                continue;
            }
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
