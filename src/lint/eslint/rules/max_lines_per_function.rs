use bun_lint::prelude::*;

/// Enforce a maximum number of lines of code in a function.
pub struct MaxLinesPerFunction {
    max: u32,
    skips_comments: bool,
    skips_blank_lines: bool,
    counts_iifes: bool,
}

const EXCEED: Message = Message::new(
    "exceed",
    "{{name}} has too many lines ({{lineCount}}). Maximum allowed is {{maxLines}}.",
);

/// ESLint's `getCommentOnlyLines`: for each line, by its number, whether it has nothing but comments
/// and whitespace.
fn get_comment_only_lines<'a>(file: &'a File<'a>) -> Vec<bool> {
    let mut lines = vec![false; file.line_count() as usize + 1];
    for comment in file.comments() {
        let mut start = file.line_of(comment.start());
        let mut end = file.line_of(comment.end());
        if file.token_before(comment).is_some_and(|before| file.line_of(before.end()) == start) {
            start += 1;
        }
        if file.token_after(comment).is_some_and(|after| file.line_of(after.start()) == end) {
            end -= 1;
        }
        for line in start..=end {
            if let Some(is_comment_only) = lines.get_mut(line as usize) {
                *is_comment_only = true;
            }
        }
    }
    lines
}

/// For each comment where it starts, and how many lines oxlint's `count_comment_lines` finds in the comments up to it:
/// the lines that a comment has for itself. A line with two comments is a line of code.
fn count_comment_lines_as_oxlint<'a>(file: &'a File<'a>) -> Vec<(u32, u32)> {
    let mut count = 0;
    let counts = file.comments().map(|comment| {
        let (first, last) = (file.line_of(comment.start()), file.line_of(comment.end()));
        let is_first = text::is_blank(file.slice(Span::new(file.line_span(first).start, comment.start())));
        count += match comment.kind() {
            TokenKind::Block => {
                let is_last = text::is_blank(file.slice(Span::new(comment.end(), file.line_span(last).end)));
                (last + u32::from(is_last)).saturating_sub(first + u32::from(!is_first))
            }
            _ => u32::from(is_first),
        };
        (comment.start(), count)
    });
    counts.collect()
}

/// What is counted once in a file, when it is needed.
#[derive(Default)]
pub struct Counts {
    /// What [`MaxLinesPerFunction::count_lines`] returns.
    lines: Option<Vec<u32>>,
    /// What [`count_comment_lines_as_oxlint`] returns.
    comments: Option<Vec<(u32, u32)>>,
}

impl MaxLinesPerFunction {
    /// For each line, and for 0, how many lines up to it count.
    fn count_lines<'a>(&self, file: &'a File<'a>) -> Vec<u32> {
        let comment_only_lines = match self.skips_comments && !file.language().is_oxlint {
            true => get_comment_only_lines(file),
            false => Vec::new(),
        };
        let mut count = 0;
        let counts = (1..=file.line_count()).map(|line| {
            let is_skipped = comment_only_lines.get(line as usize) == Some(&true)
                || self.skips_blank_lines && text::is_blank(file.line_text(line));
            count += u32::from(!is_skipped);
            count
        });
        std::iter::once(0).chain(counts).collect()
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // For oxlint a method of a class is a function also if it has no body.
        let is_method_without_body = || {
            cx.language().is_oxlint
                && matches!(func.kind(), FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor)
                && matches!(func.owner(), Node::Member(member) if matches!(member.parent(), Node::Class(_)))
        };
        if !ast_utils::is_function_with_body(func) && !is_method_without_body() {
            return;
        }
        // A method or an accessor counts from its first modifier or its name.
        let span = match (func.owner(), func.kind()) {
            (Node::Member(member), _) => member.span(),
            (Node::Expr(e), FnKind::Method | FnKind::Getter | FnKind::Setter) => e.parent().span(),
            (Node::Expr(e), _) if !self.counts_iifes && ast_utils::is_callee(e) => return,
            _ => func.estree_span(),
        };
        // oxlint counts from where the function starts, which is after the name of a method.
        let is_oxlint = cx.language().is_oxlint;
        let span = if is_oxlint { func.estree_span() } else { span };
        let file = cx.file();
        let (first, last) = (file.line_of(span.start), file.line_of(span.end));
        if last - first < self.max {
            return;
        }
        let mut line_count = last - first + 1;
        if self.skips_comments || self.skips_blank_lines {
            let counted = cx.state.lines.get_or_insert_with(|| self.count_lines(file));
            let up_to = |line: u32| counted.get(line as usize).map_or(0, |&it| it);
            line_count = up_to(last).saturating_sub(up_to(first.saturating_sub(1)));
            if is_oxlint && self.skips_comments {
                let comments = cx.state.comments.get_or_insert_with(|| count_comment_lines_as_oxlint(file));
                let before = |offset: u32| {
                    let at = comments.partition_point(|it| it.0 < offset);
                    at.checked_sub(1).and_then(|it| comments.get(it)).map_or(0, |it| it.1)
                };
                line_count = line_count.saturating_sub(before(span.end).saturating_sub(before(span.start)));
            }
            if line_count <= self.max {
                return;
            }
        }
        // oxlint points at the function.
        let (name, place) = match cx.language().is_oxlint {
            true => ([&b"The "[..], &utils::oxlint::get_function_name_with_kind(func)].concat(), func.estree_span()),
            false => {
                let name = ast_utils::get_function_name_with_kind(func);
                (text::upper_case_first(&name).into_owned(), ast_utils::get_function_head_loc(func))
            }
        };
        cx.report(place, EXCEED)
            .data("name", name)
            .data("lineCount", line_count)
            .data("maxLines", self.max);
    }
}

impl Rule for MaxLinesPerFunction {
    const META: Meta = Meta::eslint("max-lines-per-function", Kind::Suggestion);
    type State<'a> = Counts;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxLinesPerFunction {
            max: object.number("max").or_else(|| options.number(0)).map_or(50, |max| max as u32),
            skips_comments: object.bool_or("skipComments", false),
            skips_blank_lines: object.bool_or("skipBlankLines", false),
            counts_iifes: object.bool_or("IIFEs", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Counts {
        on.funcs(Self::check);
        Counts::default()
    }
}
