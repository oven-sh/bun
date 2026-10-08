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
    let mut collector = Collector {
        source: pattern,
        control_chars: Vec::new(),
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
    cx.report(node, UNEXPECTED).data("controlChars", control_chars);
}

impl Rule for NoControlRegex {
    const META: Meta = Meta::eslint("no-control-regex", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoControlRegex
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Regex], |_, e, cx| {
            if let ExprKind::Regex(literal) = e.kind() {
                check(e, literal.pattern(), literal.flags(), cx);
            }
        });
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
