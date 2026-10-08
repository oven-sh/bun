use bun_lint::prelude::*;

/// Enforce a maximum number of lines per file.
pub struct MaxLines {
    max: usize,
    skip_comments: bool,
    skip_blank_lines: bool,
}

const EXCEED: Message = Message::new(
    "exceed",
    "File has too many lines ({{actual}}). Maximum allowed is {{max}}.",
);

/// ESLint's `getLinesWithoutCode`: the first and the last of the lines of `comment` that have no
/// code on them. The `#!` line counts as code there, but no comment shares a line with it.
fn lines_without_code<'a>(file: &'a File<'a>, comment: Token<'a>) -> (u32, u32) {
    let mut start = file.line_of(comment.start());
    let mut end = file.line_of(comment.end());
    if file.token_before(comment).is_some_and(|token| file.line_of(token.end()) == start) {
        start += 1;
    }
    if file.token_after(comment).is_some_and(|token| file.line_of(token.start()) == end) {
        end -= 1;
    }
    (start, end)
}

impl MaxLines {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut count = file.line_count();
        // After a line break at the end of the file there is no line.
        if count > 1 && file.line_span(count).is_empty() {
            count -= 1;
        }
        if count as usize <= self.max {
            return;
        }
        let mut is_comment_line = Vec::new();
        if self.skip_comments {
            is_comment_line.resize(count as usize + 2, false);
            for comment in file.comments() {
                let (start, end) = lines_without_code(file, comment);
                for line in start..=end {
                    if let Some(it) = is_comment_line.get_mut(line as usize) {
                        *it = true;
                    }
                }
            }
        }
        let (mut actual, mut first_excess) = (0usize, None);
        for line in 1..=count {
            if self.skip_blank_lines && text::is_blank(file.line_text(line))
                || is_comment_line.get(line as usize) == Some(&true)
            {
                continue;
            }
            if actual == self.max {
                first_excess = Some(line);
            }
            actual += 1;
        }
        if let Some(line) = first_excess {
            cx.report(Span::new(file.line_span(line).start, file.span().end), EXCEED)
                .data("max", self.max)
                .data("actual", actual);
        }
    }
}

impl Rule for MaxLines {
    const META: Meta = Meta::eslint("max-lines", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxLines {
            max: (object.usize("max"))
                .or(options.number(0).map(|n| n as usize))
                .unwrap_or(300),
            skip_comments: object.bool_or("skipComments", false),
            skip_blank_lines: object.bool_or("skipBlankLines", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
