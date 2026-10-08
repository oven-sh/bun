use bun_lint::prelude::*;
use bun_lint::tokens::next_token;

/// Enforce consistent spacing inside array brackets.
pub struct ArrayBracketSpacing {
    spaced: bool,
    single_element_exception: bool,
    objects_in_arrays_exception: bool,
    arrays_in_arrays_exception: bool,
}

const UNEXPECTED_SPACE_AFTER: Message = Message::new(
    "unexpectedSpaceAfter",
    "There should be no space after '{{tokenValue}}'.",
);
const UNEXPECTED_SPACE_BEFORE: Message = Message::new(
    "unexpectedSpaceBefore",
    "There should be no space before '{{tokenValue}}'.",
);
const MISSING_SPACE_AFTER: Message = Message::new(
    "missingSpaceAfter",
    "A space is required after '{{tokenValue}}'.",
);
const MISSING_SPACE_BEFORE: Message = Message::new(
    "missingSpaceBefore",
    "A space is required before '{{tokenValue}}'.",
);

/// What an element is, as far as the exceptions are concerned.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Shape {
    Object,
    Array,
    Other,
}

/// An array literal or an array pattern.
#[derive(Copy, Clone)]
struct Brackets {
    /// From the `[` to the `]`.
    span: Span,
    /// The `?` after the `]` of an optional parameter, which ESLint takes for the last token.
    question: Option<Span>,
    /// Holes included.
    count: usize,
    first: Shape,
    last: Shape,
    /// Where the last element that is not a hole ends.
    last_element_end: Option<u32>,
}

/// ESLint's `isSpaceBetween` for the two tokens around `between`, where there are no others.
fn is_space<'a>(file: &'a File<'a>, between: Span) -> bool {
    let inside = file.slice(between);
    if inside.is_empty() {
        return false;
    }
    text::trim(inside).len() != inside.len()
        || file.is_space_between(Span::empty(between.start), Span::empty(between.end))
}

impl ArrayBracketSpacing {
    fn must_be_spaced(&self, shape: Shape, count: usize) -> bool {
        let is_exception = (self.objects_in_arrays_exception && shape == Shape::Object)
            || (self.arrays_in_arrays_exception && shape == Shape::Array)
            || (self.single_element_exception && count == 1);
        self.spaced != is_exception
    }

    fn validate<'a>(&self, brackets: Brackets, cx: &Cx<'a, Self>) {
        let (file, source) = (cx.file(), cx.text());
        let first = Span::new(brackets.span.start, brackets.span.start + 1);
        let bracket = Span::new(brackets.span.end - 1, brackets.span.end);

        let after_first = Span::new(first.end, skip_trivia(source, first.end));
        if !text::has_line_break(file.slice(after_first)) {
            let is_spaced = is_space(file, after_first);
            match self.must_be_spaced(brackets.first, brackets.count) {
                true if !is_spaced => {
                    cx.report(first, MISSING_SPACE_AFTER)
                        .data("tokenValue", file.slice(first))
                        .fix(|fixer| fixer.insert_after(first, " "));
                }
                false if is_spaced => {
                    cx.report(after_first, UNEXPECTED_SPACE_AFTER)
                        .data("tokenValue", file.slice(first))
                        .fix(|fixer| fixer.remove(after_first));
                }
                _ => {}
            }
        }

        let (last, penultimate_end) = match brackets.question {
            Some(question) => (question, bracket.end),
            None => {
                // After the last element there can be commas.
                let mut end = brackets.last_element_end.unwrap_or(first.end);
                loop {
                    let next = next_token(source, end);
                    if next.is_empty() || next.start >= bracket.start {
                        break;
                    }
                    end = next.end;
                }
                (bracket, end)
            }
        };
        let before_last = Span::new(penultimate_end, last.start);
        if penultimate_end != first.end && !text::has_line_break(file.slice(before_last)) {
            let is_spaced = is_space(file, before_last);
            match self.must_be_spaced(brackets.last, brackets.count) {
                true if !is_spaced => {
                    cx.report(last, MISSING_SPACE_BEFORE)
                        .data("tokenValue", file.slice(last))
                        .fix(|fixer| fixer.insert_before(last, " "));
                }
                false if is_spaced => {
                    cx.report(before_last, UNEXPECTED_SPACE_BEFORE)
                        .data("tokenValue", file.slice(last))
                        .fix(|fixer| fixer.remove(before_last));
                }
                _ => {}
            }
        }
    }

    fn check_expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Array(elements) = e.kind() else {
            return;
        };
        let count = elements.len();
        if self.spaced && count == 0 {
            return;
        }
        let shape = |element: Option<Expr<'a>>| match element.map(Expr::tag) {
            Some(ExprTag::Object) => Shape::Object,
            Some(ExprTag::Array) => Shape::Array,
            _ => Shape::Other,
        };
        let last_element = elements.iter().rev().find(|it| !it.is_missing());
        self.validate(
            Brackets {
                span: e.span(),
                question: None,
                count,
                first: shape(elements.first()),
                last: shape(elements.last()),
                last_element_end: last_element.map(|it| it.outer_span().end),
            },
            cx,
        );
    }

    fn check_pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Array(elements) = pat.kind() else {
            return;
        };
        let count = elements.len();
        if self.spaced && count == 0 {
            return;
        }
        // One with a default is an `AssignmentPattern`, `...rest` is a `RestElement`.
        let shape = |element: Option<PatElem<'a>>| {
            let plain = element.filter(|it| it.default().is_none() && !it.is_rest());
            match plain.and_then(PatElem::pat).map(Pat::tag) {
                Some(PatTag::Object) => Shape::Object,
                Some(PatTag::Array) => Shape::Array,
                _ => Shape::Other,
            }
        };
        let span = pat.span();
        let question = match pat.parent() {
            Node::Param(param) if param.is_optional() => {
                let at = skip_trivia(cx.text(), span.end);
                (cx.text().get(at as usize) == Some(&b'?')).then(|| Span::new(at, at + 1))
            }
            _ => None,
        };
        let last_element = elements.iter().rev().find(|it| it.pat().is_some());
        self.validate(
            Brackets {
                span,
                question,
                count,
                first: shape(elements.first()),
                last: shape(elements.last()),
                last_element_end: last_element.map(|it| it.span().end),
            },
            cx,
        );
    }
}

impl Rule for ArrayBracketSpacing {
    const META: Meta = Meta::eslint("array-bracket-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let spaced = options.str(0) == Some("always");
        let exceptions = options.object(1);
        let is_option_set = |option: &str| exceptions.bool(option) == Some(!spaced);
        ArrayBracketSpacing {
            spaced,
            single_element_exception: is_option_set("singleValue"),
            objects_in_arrays_exception: is_option_set("objectsInArrays"),
            arrays_in_arrays_exception: is_option_set("arraysInArrays"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Array], Self::check_expr);
        on.pats([PatTag::Array], Self::check_pat);
    }
}
