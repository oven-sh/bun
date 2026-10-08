use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce a maximum line length.
pub struct MaxLen {
    max_length: usize,
    tab_width: usize,
    ignore_comments: bool,
    ignore_strings: bool,
    ignore_template_literals: bool,
    ignore_reg_exp_literals: bool,
    ignore_trailing_comments: bool,
    ignore_urls: bool,
    /// `None` also for 0, which upstream takes for no limit.
    max_comment_length: Option<usize>,
    ignore_pattern: Option<Regex>,
}

const MAX: Message = Message::new(
    "max",
    "This line has a length of {{lineLength}}. Maximum allowed is {{maxLength}}.",
);
const MAX_COMMENT: Message = Message::new(
    "maxComment",
    "This line has a comment length of {{lineLength}}. Maximum allowed is {{maxCommentLength}}.",
);

/// The length of a line in code points, where a tab reaches to the next tab stop.
fn compute_line_length(line: &[u8], tab_width: usize) -> usize {
    if !strings::contains_char(line, b'\t') {
        return text::code_point_count(line);
    }
    let tab_width = tab_width as i64;
    // Upstream counts the offset of a tab in UTF-16 code units.
    let (mut offset, mut code_points, mut extra_character_count) = (0i64, 0i64, 0i64);
    for (_, c) in text::code_points(line) {
        if c == u32::from(b'\t') {
            let total_offset = offset + extra_character_count;
            let previous_tab_stop_offset = if tab_width != 0 { total_offset % tab_width } else { 0 };
            extra_character_count += tab_width - previous_tab_stop_offset - 1;
        }
        offset += i64::from(text::utf16_width(c));
        code_points += 1;
    }
    (code_points + extra_character_count).max(0) as usize
}

/// `/[^:/?#]:\/\/[^?#]/u.test(text)`
fn contains_url(text: &[u8]) -> bool {
    let mut from = 1;
    while let Some(found) = text.get(from..).and_then(|rest| strings::index_of(rest, b"://")) {
        let at = from + found;
        if text.get(at - 1).is_some_and(|before| !matches!(before, b':' | b'/' | b'?' | b'#'))
            && text.get(at + 3).is_some_and(|after| !matches!(after, b'?' | b'#'))
        {
            return true;
        }
        from = at + 1;
    }
    false
}

/// The braces of the `{/* .. */}` in JSX that `comment` is in, if they hold nothing else and are on
/// one line.
fn single_line_empty_container<'a>(file: &'a File<'a>, comment: Token<'a>) -> Option<Span> {
    let Node::Expr(element) = utils::get_node_by_range_index(file, comment.start()) else {
        return None;
    };
    let ExprKind::Jsx(jsx) = element.kind() else {
        return None;
    };
    let container = (jsx.children().iter())
        .filter(|child| child.is_missing())
        .filter_map(Expr::jsx_container_span)
        .find(|container| container.contains_offset(comment.start()))?;
    (file.line_of(container.start) == file.line_of(container.end)).then_some(container)
}

/// Upstream's `getAllComments()`, from the last that starts on a line or before it backwards.
struct CommentsUpTo<'a> {
    file: &'a File<'a>,
    has_jsx: bool,
    /// The comment that goes on after the end of the line.
    unfinished: Option<Token<'a>>,
    finished: Tokens<'a>,
    previous: Option<Span>,
}

impl<'a> CommentsUpTo<'a> {
    fn new(file: &'a File<'a>, line: Span) -> Self {
        CommentsUpTo {
            file,
            has_jsx: file.has_exprs([ExprTag::Jsx]),
            unfinished: file.comment_around(line.end),
            finished: file.comments_in(Span::new(0, line.end)),
            previous: None,
        }
    }
}

impl Iterator for CommentsUpTo<'_> {
    type Item = Span;

    fn next(&mut self) -> Option<Span> {
        loop {
            let comment = self.unfinished.take().or_else(|| self.finished.next_back())?;
            let container = match self.has_jsx {
                true => single_line_empty_container(self.file, comment),
                false => None,
            };
            // The comments in the same braces count as one.
            let span = container.unwrap_or_else(|| comment.span());
            if self.previous.replace(span) != Some(span) {
                return Some(span);
            }
        }
    }
}

/// Whether `comment` starts on `line` and reaches to `end`, where what is measured of the line
/// ends, or beyond the line.
fn is_trailing_comment(line: Span, end: u32, comment: Span) -> bool {
    line.start <= comment.start && comment.start <= line.end && (comment.end > line.end || comment.end == end)
}

/// Whether there is nothing but `comment`, which does not start after it, on `line`.
fn is_full_line_comment(file: &File, line: Span, comment: Span) -> bool {
    (comment.start < line.start || text::is_blank(file.slice(Span::new(line.start, comment.start))))
        && comment.end >= line.end
}

/// Where `line` ends without `comment` and the whitespace before it.
fn strip_trailing_comment(file: &File, line: Span, comment: Span) -> u32 {
    line.start + text::trim_end(file.slice(Span::new(line.start, comment.start))).len() as u32
}

/// Whether the `JsxText` `token` is the value of an attribute, not text between tags.
fn is_jsx_attribute_value<'a>(file: &'a File<'a>, token: Token<'a>) -> bool {
    match utils::get_node_by_range_index(file, token.start()) {
        Node::Expr(e) => {
            e.span().start == token.start()
                && e.tag() == ExprTag::String
                && matches!(e.parent(), Node::Prop(prop) if prop.is_jsx_attribute())
        }
        _ => false,
    }
}

impl MaxLen {
    /// Whether a string, a template or a regular expression that excuses `line` is on it, if only
    /// in part.
    fn has_ignored_literal<'a>(&self, file: &'a File<'a>, line: Span) -> bool {
        if !self.ignore_strings && !self.ignore_template_literals && !self.ignore_reg_exp_literals {
            return false;
        }
        let is_ignored = |token: Token<'a>| match token.kind() {
            TokenKind::String => self.ignore_strings,
            TokenKind::JsxText => self.ignore_strings && is_jsx_attribute_value(file, token),
            TokenKind::Template => self.ignore_template_literals,
            TokenKind::RegularExpression => self.ignore_reg_exp_literals,
            _ => false,
        };
        file.tokens_in(line).any(is_ignored)
            || file.token_around(line.start).is_some_and(is_ignored)
            || file.token_around(line.end).is_some_and(is_ignored)
    }

    /// `line` is longer than some limit.
    fn check_long_line<'a>(&self, line: Span, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let mut line_is_comment = false;
        // Where the text to measure ends.
        let mut end = line.end;
        if self.ignore_trailing_comments || self.max_comment_length.is_some() {
            let mut comments = CommentsUpTo::new(file, line);
            if let Some(comment) = comments.next() {
                if is_full_line_comment(file, line, comment) {
                    line_is_comment = true;
                } else if self.ignore_trailing_comments && is_trailing_comment(line, end, comment) {
                    end = strip_trailing_comment(file, line, comment);
                    while let Some(comment) = comments.next()
                        && is_trailing_comment(line, end, comment)
                    {
                        end = strip_trailing_comment(file, line, comment);
                    }
                }
            }
        }
        if line_is_comment && self.ignore_comments {
            return;
        }
        let measured = Span::new(line.start, end);
        let text_to_measure = file.slice(measured);
        let line_length = compute_line_length(text_to_measure, self.tab_width);
        let (message, limit_name, limit) = match self.max_comment_length {
            Some(max_comment_length) if line_is_comment => {
                (MAX_COMMENT, "maxCommentLength", max_comment_length)
            }
            _ => (MAX, "maxLength", self.max_length),
        };
        if line_length <= limit
            || self.ignore_urls && contains_url(text_to_measure)
            || self.ignore_pattern.as_ref().is_some_and(|it| it.test(text_to_measure))
            || self.has_ignored_literal(file, line)
        {
            return;
        }
        cx.report(measured, message).data("lineLength", line_length).data(limit_name, limit);
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        // No line that is not longer is reported.
        let limit = self.max_comment_length.map_or(self.max_length, |it| it.min(self.max_length));
        for number in 1..=file.line_count() {
            let mut line = file.line_span(number);
            if number == 1 && file.has_bom() {
                line.start = line.end.min(3);
            }
            let text = file.slice(line);
            let is_short = text.len() <= limit && (self.tab_width <= 1 || !strings::contains_char(text, b'\t'));
            if !is_short && compute_line_length(text, self.tab_width) > limit {
                self.check_long_line(line, cx);
            }
        }
    }
}

impl Rule for MaxLen {
    const META: Meta = Meta::eslint("max-len", Kind::Layout).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        // The object is the last option. The first two can be the length and the tab width.
        let object = Object::of(options.all().last());
        let as_length = |n: f64| n.max(0.0) as usize;
        let ignore_comments = object.bool_or("ignoreComments", false);
        MaxLen {
            max_length: options.number(0).map(as_length).or_else(|| object.usize("code")).unwrap_or(80),
            tab_width: options.number(1).map(as_length).or_else(|| object.usize("tabWidth")).unwrap_or(4),
            ignore_comments,
            ignore_strings: object.bool_or("ignoreStrings", false),
            ignore_template_literals: object.bool_or("ignoreTemplateLiterals", false),
            ignore_reg_exp_literals: object.bool_or("ignoreRegExpLiterals", false),
            ignore_trailing_comments: object.bool_or("ignoreTrailingComments", false) || ignore_comments,
            ignore_urls: object.bool_or("ignoreUrls", false),
            max_comment_length: object.usize("comments").filter(|it| *it > 0),
            ignore_pattern: match object.str("ignorePattern") {
                None | Some("") => None,
                Some(_) => object.regex("ignorePattern", "u"),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
