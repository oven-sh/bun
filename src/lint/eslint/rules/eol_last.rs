use bun_lint::prelude::*;

/// Require or disallow newline at the end of files.
pub struct EolLast {
    mode: Mode,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    /// As `Always`, and the fix appends `\r\n`.
    Windows,
    Never,
}

const MISSING: Message = Message::new("missing", "Newline required at end of file but not found.");
const UNEXPECTED: Message = Message::new("unexpected", "Newline not allowed at end of file.");

/// Where `/(?:\r?\n)+$/` matches in `text`.
fn final_line_breaks_start(text: &[u8]) -> usize {
    let mut rest = text;
    while let Some(before) = rest.strip_suffix(b"\n") {
        rest = before.strip_suffix(b"\r").unwrap_or(before);
    }
    rest.len()
}

impl EolLast {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let text = cx.text();
        let end = text.len() as u32;
        // ESLint's text is without the byte order mark.
        let is_empty = text.is_empty() || cx.has_bom() && text.len() == 3;
        if is_empty {
            return;
        }
        let ends_with_newline = text.ends_with(b"\n");
        if self.mode != Mode::Never && !ends_with_newline {
            let line_break = if self.mode == Mode::Windows { "\r\n" } else { "\n" };
            cx.report_at(end, MISSING).fix(|fixer| fixer.insert_after(Span::empty(end), line_break));
        } else if self.mode == Mode::Never && ends_with_newline {
            let start = end - if text.ends_with(b"\r\n") { 2 } else { 1 };
            cx.report(Span::new(start, end), UNEXPECTED)
                .fix(|fixer| fixer.remove(Span::new(final_line_breaks_start(text) as u32, end)));
        }
    }
}

impl Rule for EolLast {
    const META: Meta = Meta::eslint("eol-last", Kind::Layout).fixable(Fixable::Whitespace).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        EolLast {
            mode: match options.str(0) {
                Some("never") => Mode::Never,
                Some("windows") => Mode::Windows,
                _ => Mode::Always,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
