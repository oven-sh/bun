use bun_lint::prelude::*;

/// Disallow multiple empty lines.
pub struct NoMultipleEmptyLines {
    max: u32,
    max_eof: u32,
    max_bof: u32,
}

const BLANK_BEGINNING_OF_FILE: Message = Message::new(
    "blankBeginningOfFile",
    "Too many blank lines at the beginning of file. Max of {{max}} allowed.",
);
const BLANK_END_OF_FILE: Message = Message::new(
    "blankEndOfFile",
    "Too many blank lines at the end of file. Max of {{max}} allowed.",
);
const CONSECUTIVE_BLANK: Message = Message::new(
    "consecutiveBlank",
    "More than {{max}} blank {{pluralizedLines}} not allowed.",
);

/// Where the line `line` starts, after a byte order mark. The end of the text if there is no such
/// line.
fn start_of_line(file: &File, line: u32) -> u32 {
    match file.line_span(line).start {
        0 if file.has_bom() => 3,
        start => start,
    }
}

impl NoMultipleEmptyLines {
    fn collect_template<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !text::has_line_break(e.text()) {
            return;
        }
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        for i in 0..template.quasi_count() {
            let quasi = template.quasi_span(i);
            if text::has_line_break(cx.slice(quasi)) {
                cx.state.push(quasi);
            }
        }
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        cx.state.sort_unstable_by_key(|quasi| quasi.start);
        let quasis: &[Span] = &cx.state;
        // An empty line in the text of a template means something.
        let is_in_template = |offset: u32| {
            let after = quasis.partition_point(|quasi| quasi.start <= offset);
            after.checked_sub(1).and_then(|at| quasis.get(at)).is_some_and(|quasi| offset < quasi.end)
        };

        // What is after the final line break is not a line.
        let mut line_count = file.line_count();
        if start_of_line(file, line_count) == file.span().end {
            line_count -= 1;
        }

        let mut last_line = 0;
        for line in 1..=line_count + 1 {
            if line <= line_count {
                let span = file.line_span(line);
                if text::is_blank(file.slice(span)) && !is_in_template(span.start) {
                    continue;
                }
            }
            let (message, max_allowed) = if last_line == 0 {
                (BLANK_BEGINNING_OF_FILE, self.max_bof)
            } else if line == line_count + 1 {
                (BLANK_END_OF_FILE, self.max_eof)
            } else {
                (CONSECUTIVE_BLANK, self.max)
            };
            if line - last_line - 1 > max_allowed {
                // TODO(api): where the last line is blank and has no line break, ESLint's end is
                // the line after it, which does not exist: `Report::end_at(Position)`.
                let at = Span::new(
                    start_of_line(file, last_line + max_allowed + 1),
                    start_of_line(file, line),
                );
                cx.report(at, message)
                    .data("max", max_allowed)
                    .data("pluralizedLines", if max_allowed == 1 { "line" } else { "lines" })
                    .fix(|fixer| {
                        fixer.remove(Span::new(
                            start_of_line(file, last_line + 1),
                            start_of_line(file, line - max_allowed),
                        ))
                    });
            }
            last_line = line;
        }
    }
}

impl Rule for NoMultipleEmptyLines {
    const META: Meta = Meta::eslint("no-multiple-empty-lines", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    /// The pieces of text of the templates that have a line break in them.
    type State<'a> = Vec<Span>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let limit = |key: &str| object.usize(key).map(|n| n.min(u32::MAX as usize) as u32);
        let max = limit("max").unwrap_or(2);
        NoMultipleEmptyLines {
            max,
            max_eof: limit("maxEOF").unwrap_or(max),
            max_bof: limit("maxBOF").unwrap_or(max),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<Span> {
        on.exprs([ExprTag::Template], Self::collect_template);
        on.finish(Self::check);
        Vec::new()
    }
}
