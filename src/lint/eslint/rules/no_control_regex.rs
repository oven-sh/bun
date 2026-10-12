use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, Handler, Mode};
use bun_lint_oxlint::regex_pattern::run_on_regex_node;

/// Disallow control characters in regular expressions.
pub struct NoControlRegex;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected control character(s) in regular expression: {{controlChars}}.",
);
/// What oxlint says instead.
const CONTROL_CHARACTER: Message = Message::new("unexpected", "Unexpected control character");
const CONTROL_CHARACTERS: Message = Message::new("unexpected", "Unexpected control characters");

struct Collector<'s> {
    source: &'s [u8],
    control_chars: Vec<u8>,
}

impl Handler for Collector<'_> {
    fn on_pattern_enter(&mut self, _: u32) {
        self.control_chars.clear();
    }

    fn on_character(&mut self, start: u32, _: u32, value: u32) {
        let written = self.source.get(start as usize..).unwrap_or_default();
        if value <= 0x1F
            && (written.first() == Some(&(value as u8))
                || written.starts_with(b"\\x")
                || written.starts_with(b"\\u"))
        {
            self.control_chars.push(value as u8);
        }
    }
}

fn check<'a>(node: Expr<'a>, pattern: &[u8], flags: &[u8], cx: &mut Cx<'a, NoControlRegex>) {
    if !pattern.iter().any(|b| *b <= 0x1F)
        && !strings::contains(pattern, b"\\x")
        && !strings::contains(pattern, b"\\u")
    {
        return;
    }
    let mut collector = Collector { source: pattern, control_chars: Vec::new() };
    // What precedes a syntax error counts.
    _ = regex::validate_pattern(pattern, Mode::of_flags(flags), regex::Options::default(), &mut collector);
    if collector.control_chars.is_empty() {
        return;
    }
    let mut control_chars = String::new();
    for c in &collector.control_chars {
        if !control_chars.is_empty() {
            control_chars.push_str(", ");
        }
        control_chars.push_str(&format!("\\x{c:02x}"));
    }
    cx.report(node, UNEXPECTED).data("controlChars", control_chars);
}

/// oxlint's `ControlCharacterFinder`
#[derive(Default)]
struct Finder {
    /// With where each of them is in the pattern.
    control_chars: Vec<(u8, u32, u32)>,
    capture_groups: u32,
}

impl Handler for Finder {
    fn on_pattern_enter(&mut self, _: u32) {
        *self = Finder::default();
    }

    fn on_character(&mut self, start: u32, end: u32, value: u32) {
        if value <= 0x1F {
            self.control_chars.push((value as u8, start, end));
        }
    }

    fn on_capturing_group_enter(&mut self, _: u32, _: Option<&[u8]>) {
        self.capture_groups += 1;
    }
}

/// oxlint goes by how a character is written in the file: as `\x1b` or `\u001b`, in a string too, or so that the first
/// character after the backslashes is the value as a hexadecimal digit, which `\1` without a group is, and `\cL`. It points at
/// each of them.
fn check_as_oxlint<'a>(e: Expr<'a>, cx: &Cx<'a, NoControlRegex>) {
    let Some(pattern) = run_on_regex_node(e) else {
        return;
    };
    let text = pattern.text();
    if !strings::contains_char(text, b'\\') && !text.iter().any(|b| *b <= 0x1F) {
        return;
    }
    let mut finder = Finder::default();
    if regex::validate_pattern(text, pattern.mode, regex::Options::default(), &mut finder).is_err() {
        return;
    }
    let byte = |at: u32| text.get(at as usize).copied();
    let is_escaped_digit = |start: u32| byte(start) == Some(b'\\') && byte(start + 1).is_some_and(|it| it.is_ascii_digit());
    let groups = finder.capture_groups;
    let mut found = finder.control_chars.iter().filter_map(|&(value, start, end)| {
        // `\0`
        let is_octal = is_escaped_digit(start);
        let is_null = is_octal && end == start + 2 && value == 0 && !byte(end).is_some_and(|it| it.is_ascii_digit());
        if is_null || groups > 0 && value > 1 && u32::from(value) <= groups {
            return None;
        }
        let place = pattern.span(start, end);
        let written = cx.slice(place);
        let after_backslashes = strings::trim_left(written, b"\\");
        let is_the_digit = after_backslashes.first().and_then(|it| char::from(*it).to_digit(16)) == Some(u32::from(value));
        let escape = written.strip_prefix(b"\\\\").or_else(|| written.strip_prefix(b"\\"));
        if !is_the_digit && !escape.is_some_and(|it| matches!(it.first(), Some(b'x' | b'u'))) {
            return None;
        }
        let label = move || match (is_octal, place.end - place.start) {
            (false, _) => format!("'U+{value:04X}' is a control character."),
            (true, len) => {
                let digits = if matches!(len, 3 | 4) { len as usize - 1 } else { 1 };
                format!(
                    "'\\{value:0digits$o}' is a control character. It looks like a backreference, but there is no corresponding capture group."
                )
            }
        };
        Some((place, label))
    });
    let Some((first, label)) = found.next() else {
        return;
    };
    let others: Vec<_> = found.collect();
    let message = if others.is_empty() { CONTROL_CHARACTER } else { CONTROL_CHARACTERS };
    cx.report(first, message).labels_with(|labels| {
        labels.first(label());
        for (place, label) in &others {
            labels.push(*place, label());
        }
    });
}

impl Rule for NoControlRegex {
    const META: Meta = Meta::eslint("no-control-regex", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Regex, ExprTag::New]).calls_named(&["RegExp"]);
    /// `RegExp`, if the file mentions it.
    type State<'a> = Option<Name<'a>>;

    fn new(_: &Options) -> Self {
        NoControlRegex
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Option<Name<'a>>> {
        Some(file.mentions("RegExp").then(|| file.name_of("RegExp")))
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Regex]);
        match (file.mentions("RegExp"), file.language().is_oxlint) {
            (false, _) => on,
            // `window.RegExp()`
            (true, true) => on.exprs(&[ExprTag::New]).calls_named(&["RegExp"]),
            (true, false) => on.exprs(&[ExprTag::New]).function_calls(&["RegExp"]),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            return check_as_oxlint(e, cx);
        }
        match e.tag() {
            ExprTag::Regex => {
                if let Some(literal) = e.as_regex() {
                    check(e, literal.pattern(), literal.flags(), cx);
                }
            }
            ExprTag::Call | ExprTag::New => {
                let Some(call) = e.as_call_like() else {
                    return;
                };
                if cx.state.is_some()
                    && call.callee().as_ident() == cx.state
                    && let Some(first) = call.args().first()
                    && let Some(pattern) = first.as_string()
                    && ast_utils::is_global_reference(call.callee())
                {
                    let flags = call.args().get(1).and_then(Expr::as_string);
                    check(first, pattern.bytes(), flags.map_or(&b""[..], Name::bytes), cx);
                }
            }
            _ => {}
        }
    }
}
