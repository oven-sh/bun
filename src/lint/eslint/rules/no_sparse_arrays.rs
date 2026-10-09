use bun_lint::prelude::*;

/// Disallow sparse arrays.
pub struct NoSparseArrays;

const UNEXPECTED_SPARSE_ARRAY: Message =
    Message::new("unexpectedSparseArray", "Unexpected comma in middle of array.");

impl Rule for NoSparseArrays {
    const META: Meta = Meta::eslint("no-sparse-arrays", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSparseArrays
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Array], |_, array, cx| {
            let ExprKind::Array(elements) = array.kind() else {
                return;
            };
            if !elements.iter().any(Expr::is_missing) || utils::is_assignment_target(array) {
                return;
            }
            // oxlint says one thing about an array: before the first of the commas, or at the array if there are ten, before it
            // if it is long.
            let is_oxlint = cx.language().is_oxlint;
            if is_oxlint && elements.iter().filter(|it| it.is_missing()).count() >= 10 {
                let span = array.span();
                cx.report(if span.len() < 50 { span } else { Span::empty(span.start) }, UNEXPECTED_SPARSE_ARRAY);
                return;
            }
            let text = cx.text();
            // After the `[` or the previous comma.
            let mut at = array.span().start + 1;
            for element in elements {
                let is_hole = element.is_missing();
                let comma = skip_trivia(text, if is_hole { at } else { element.outer_span().end });
                if is_hole {
                    if is_oxlint {
                        cx.report(Span::empty(comma), UNEXPECTED_SPARSE_ARRAY);
                        return;
                    }
                    cx.report(Span::new(comma, comma + 1), UNEXPECTED_SPARSE_ARRAY);
                }
                at = comma + 1;
            }
        });
    }
}
