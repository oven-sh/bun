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

impl MaxLinesPerFunction {
    /// For each line, and for 0, how many lines up to it count.
    fn count_lines<'a>(&self, file: &'a File<'a>) -> Vec<u32> {
        let comment_only_lines = match self.skips_comments {
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
        if !ast_utils::is_function_with_body(func) {
            return;
        }
        // A method or an accessor counts from its first modifier or its name.
        let span = match (func.owner(), func.kind()) {
            (Node::Member(member), _) => member.span(),
            (Node::Expr(e), FnKind::Method | FnKind::Getter | FnKind::Setter) => e.parent().span(),
            (Node::Expr(e), _) if !self.counts_iifes && ast_utils::is_callee(e) => return,
            _ => func.estree_span(),
        };
        let file = cx.file();
        let (first, last) = (file.line_of(span.start), file.line_of(span.end));
        if last - first < self.max {
            return;
        }
        let mut line_count = last - first + 1;
        if self.skips_comments || self.skips_blank_lines {
            let counted = cx.state.get_or_insert_with(|| self.count_lines(file));
            let up_to = |line: u32| counted.get(line as usize).map_or(0, |&it| it);
            line_count = up_to(last).saturating_sub(up_to(first.saturating_sub(1)));
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
    /// What [`MaxLinesPerFunction::count_lines`] returns, once it is needed.
    type State<'a> = Option<Vec<u32>>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxLinesPerFunction {
            max: object.number("max").or_else(|| options.number(0)).map_or(50, |max| max as u32),
            skips_comments: object.bool_or("skipComments", false),
            skips_blank_lines: object.bool_or("skipBlankLines", false),
            counts_iifes: object.bool_or("IIFEs", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Option<Vec<u32>> {
        on.funcs(Self::check);
        None
    }
}
