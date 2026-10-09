use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, Handler, Mode};

/// Disallow control characters in regular expressions.
pub struct NoControlRegex;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected control character(s) in regular expression: {{controlChars}}.",
);

struct Collector<'s> {
    source: &'s [u8],
    control_chars: Vec<u8>,
    /// Where the first of them is in `source`.
    first: Option<Span>,
    /// Whether a control character that is written as it is counts.
    counts_as_it_is: bool,
}

impl Handler for Collector<'_> {
    fn on_pattern_enter(&mut self, _: u32) {
        self.control_chars.clear();
        self.first = None;
    }

    fn on_character(&mut self, start: u32, end: u32, value: u32) {
        let written = self.source.get(start as usize..).unwrap_or_default();
        if value <= 0x1F
            && (self.counts_as_it_is && written.first() == Some(&(value as u8))
                || written.starts_with(b"\\x")
                || written.starts_with(b"\\u"))
        {
            self.control_chars.push(value as u8);
            self.first.get_or_insert_with(|| Span::new(start, end));
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
        first: None,
        counts_as_it_is: !is_oxlint
            || !is_literal && (strings::contains(node.text(), b"\\x") || strings::contains(node.text(), b"\\u")),
    };
    // What precedes a syntax error counts.
    _ = regex::validate_pattern(pattern, Mode::of_flags(flags), regex::Options::default(), &mut collector);
    if collector.control_chars.is_empty() {
        return;
    }
    let mut control_chars = String::new();
    for c in collector.control_chars {
        if !control_chars.is_empty() {
            control_chars.push_str(", ");
        }
        control_chars.push_str(&format!("\\x{c:02x}"));
    }
    let place = match collector.first {
        Some(first) if is_oxlint && is_literal => {
            let pattern_start = node.span().start + 1;
            Span::new(pattern_start + first.start, pattern_start + first.end)
        }
        _ => node.span(),
    };
    cx.report(place, UNEXPECTED).data("controlChars", control_chars);
}

impl Rule for NoControlRegex {
    const META: Meta = Meta::eslint("no-control-regex", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoControlRegex
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Regex], |_, e, cx| {
            if let ExprKind::Regex(literal) = e.kind() {
                check(e, literal.pattern(), literal.flags(), cx);
            }
        });
        if file.mentions("RegExp") {
            on.exprs([ExprTag::Call, ExprTag::New], |_, e, cx| {
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
            });
        }
    }
}
