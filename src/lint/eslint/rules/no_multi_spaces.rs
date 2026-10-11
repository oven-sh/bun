use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow multiple spaces.
pub struct NoMultiSpaces {
    ignore_eol_comments: bool,
    /// The types of nodes, as ESLint names them, in which anything goes.
    exceptions: Vec<Box<[u8]>>,
}

const MULTIPLE_SPACES: Message =
    Message::new("multipleSpaces", "Multiple spaces found before '{{displayValue}}'.");

/// ESLint's `formatReportedCommentValue`, appended to `out`.
fn format_reported_comment_value(value: &[u8], out: &mut Vec<u8>) {
    let first_line = &value[..strings::index_of_char_usize(value, b'\n').unwrap_or(value.len())];
    if first_line.len() == value.len() && strings::wtf8_len_utf16(value) <= 12 {
        out.extend_from_slice(value);
    } else {
        out.extend_from_slice(strings::wtf8_slice_by_utf16(first_line, 0, 12));
        out.extend_from_slice(b"...");
    }
}

fn display_value(token: Token<'_>) -> Vec<u8> {
    let mut out = Vec::new();
    match token.kind() {
        TokenKind::Block => {
            out.extend_from_slice(b"/*");
            format_reported_comment_value(token.comment_value(), &mut out);
            out.extend_from_slice(b"*/");
        }
        TokenKind::Line => {
            out.extend_from_slice(b"//");
            format_reported_comment_value(token.comment_value(), &mut out);
        }
        // Its `value` is without the `#`.
        TokenKind::PrivateIdentifier => out.extend_from_slice(token.text().get(1..).unwrap_or_default()),
        _ => out.extend_from_slice(token.text()),
    }
    out
}

impl NoMultiSpaces {
    /// `offset`: between two tokens.
    fn is_exception<'a>(&self, file: &'a File<'a>, offset: u32) -> bool {
        if self.exceptions.is_empty() {
            return false;
        }
        let name = utils::estree_type_at(file, offset);
        // espree ends the `Program` with its last token.
        let is_after = || file.tokens().next_back().is_none_or(|last| offset >= last.end());
        let is_outside = name == "Program"
            && (offset < file.program_span().start || !file.uses_typescript_parser() && is_after());
        !is_outside && self.exceptions.iter().any(|it| **it == *name.as_bytes())
    }
}

impl Rule for NoMultiSpaces {
    const META: Meta = Meta::eslint("no-multi-spaces", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut exceptions: Vec<Box<[u8]>> = vec![b"Property"[..].into()];
        for (name, is_exception) in options.object("exceptions").entries() {
            exceptions.retain(|it| **it != name[..]);
            if is_exception.as_bool() == Some(true) {
                exceptions.push(name[..].into());
            }
        }
        NoMultiSpaces {
            ignore_eol_comments: options.bool_or("ignoreEOLComments", false),
            exceptions,
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let mut tokens = file.tokens().with_comments();
        let Some(mut left) = tokens.next() else {
            return;
        };
        while let Some(right) = tokens.next() {
            let spaces = Span::new(left.end(), right.start());
            left = right;
            let between = file.slice(spaces);
            if between.len() < 2 || !strings::contains(between, b"  ") || strings::contains_js_line_break(between) {
                continue;
            }
            if self.ignore_eol_comments && right.is_comment() {
                let mut rest = tokens;
                let is_last_on_line = rest
                    .next()
                    .is_none_or(|next| {
                        strings::contains_js_line_break(file.slice(Span::new(right.end(), next.start())))
                    });
                if is_last_on_line {
                    continue;
                }
            }
            if self.is_exception(file, right.start() - 1) {
                continue;
            }
            cx.report(spaces, MULTIPLE_SPACES)
                .data("displayValue", display_value(right))
                .fix(|fixer| fixer.replace(spaces, " "));
        }
    }
}
