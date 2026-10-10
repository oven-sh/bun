use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, Handler, Mode};

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
    /// With where each of them is in `source`.
    control_chars: Vec<(u8, Span)>,
    /// Whether a control character that is written as it is counts.
    counts_as_it_is: bool,
}

impl Handler for Collector<'_> {
    fn on_pattern_enter(&mut self, _: u32) {
        self.control_chars.clear();
    }

    fn on_character(&mut self, start: u32, end: u32, value: u32) {
        let written = self.source.get(start as usize..).unwrap_or_default();
        if value <= 0x1F
            && (self.counts_as_it_is && written.first() == Some(&(value as u8))
                || written.starts_with(b"\\x")
                || written.starts_with(b"\\u"))
        {
            self.control_chars.push((value as u8, Span::new(start, end)));
        }
    }
}

/// oxlint reads the pattern as it is written in the file: what counts is `\x1b` and `\u001b`, in a string too, and not
/// a tab or `"\t"`. In a regular expression it points at the first of the characters.
fn check<'a>(node: Expr<'a>, pattern: &[u8], flags: &[u8], cx: &mut Cx<'a, NoControlRegex>) {
    if !pattern.iter().any(|b| *b <= 0x1F)
        && !strings::contains(pattern, b"\\x")
        && !strings::contains(pattern, b"\\u")
    {
        return;
    }
    let is_oxlint = cx.language().is_oxlint;
    let is_literal = node.tag() == ExprTag::Regex;
    let mut collector = Collector {
        source: pattern,
        control_chars: Vec::new(),
        counts_as_it_is: !is_oxlint
            || !is_literal && (strings::contains(node.text(), b"\\x") || strings::contains(node.text(), b"\\u")),
    };
    // What precedes a syntax error counts.
    _ = regex::validate_pattern(pattern, Mode::of_flags(flags), regex::Options::default(), &mut collector);
    if collector.control_chars.is_empty() {
        return;
    }
    let message = match (is_oxlint, collector.control_chars.len()) {
        (false, _) => UNEXPECTED,
        (true, 1) => CONTROL_CHARACTER,
        (true, _) => CONTROL_CHARACTERS,
    };
    let mut control_chars = String::new();
    for (c, _) in &collector.control_chars {
        if !control_chars.is_empty() {
            control_chars.push_str(", ");
        }
        control_chars.push_str(&format!("\\x{c:02x}"));
    }
    let pattern_start = node.span().start + 1;
    let in_file = |it: &Span| Span::new(pattern_start + it.start, pattern_start + it.end);
    let place = match collector.control_chars.first() {
        Some((_, first)) if is_oxlint && is_literal => in_file(first),
        _ => node.span(),
    };
    cx.report(place, message).data("controlChars", control_chars).labels_with(|labels| {
        for (i, (c, place)) in collector.control_chars.iter().enumerate() {
            let text = format!("'U+{c:04X}' is a control character.");
            match i {
                0 => labels.first(text),
                _ if is_literal => labels.push(in_file(place), text),
                _ => break,
            }
        }
    });
}

impl Rule for NoControlRegex {
    const META: Meta = Meta::eslint("no-control-regex", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Regex, ExprTag::Call, ExprTag::New]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoControlRegex
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Regex]);
        if file.mentions("RegExp") {
            on = on.exprs(&[ExprTag::Call, ExprTag::New]);
        }
        on
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Regex => {
                if let ExprKind::Regex(literal) = e.kind() {
                    check(e, literal.pattern(), literal.flags(), cx);
                }
            }
            ExprTag::Call | ExprTag::New => {
                let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
                    return;
                };
                if call.callee().is_ident("RegExp")
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
