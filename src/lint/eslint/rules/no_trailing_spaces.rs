use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow trailing whitespace at the end of lines.
pub struct NoTrailingSpaces {
    skip_blank_lines: bool,
    ignore_comments: bool,
}

const TRAILING_SPACE: Message = Message::new("trailingSpace", "Trailing spaces not allowed.");

/// The length in bytes of the character of ESLint's `BLANK_CLASS` that `line` ends with. 0 if it
/// ends with none.
#[inline]
fn trailing_blank_len(line: &[u8]) -> usize {
    match line {
        [.., b' ' | b'\t'] => 1,
        [.., 0xC2, 0xA0] => 2,
        [.., 0xE2, 0x80, 0x80..=0x8B] | [.., 0xE3, 0x80, 0x80] => 3,
        _ => 0,
    }
}

impl NoTrailingSpaces {
    fn check(&self, cx: &mut Cx<'_, Self>) {
        let (file, text) = (cx.file(), cx.text());
        let mut has_backtick = None;
        let mut line_start = if file.has_bom() { 3 } else { 0 };
        let mut line_breaks = ast_utils::create_global_linebreak_matcher(text);
        loop {
            let line_break = line_breaks.next();
            let line_end = line_break.map_or(text.len(), |it| it.0);
            let mut blank_start = line_end;
            while blank_start > line_start {
                match trailing_blank_len(text.get(line_start..blank_start).unwrap_or_default()) {
                    0 => break,
                    len => blank_start -= len,
                }
            }
            let blank = Span::new(blank_start as u32, line_end as u32);
            // What is at the end of a line in a comment is in it up to the line break, and what is in
            // the text of a template is in one token.
            if !blank.is_empty()
                && !(self.skip_blank_lines && blank_start == line_start)
                && !(*has_backtick.get_or_insert_with(|| strings::contains_char(text, b'`'))
                    && file.token_around(blank.start).is_some_and(|it| it.kind() == TokenKind::Template))
                && !(self.ignore_comments && file.comment_around(blank.start).is_some())
            {
                cx.report(blank, TRAILING_SPACE).fix(|fixer| fixer.remove(blank));
            }
            match line_break {
                Some((at, len)) => line_start = at + len,
                None => return,
            }
        }
    }
}

impl Rule for NoTrailingSpaces {
    const META: Meta = Meta::eslint("no-trailing-spaces", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoTrailingSpaces {
            skip_blank_lines: options.bool_or("skipBlankLines", false),
            ignore_comments: options.bool_or("ignoreComments", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
