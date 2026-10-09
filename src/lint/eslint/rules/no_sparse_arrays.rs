use bun_lint::prelude::*;

/// Disallow sparse arrays.
pub struct NoSparseArrays;

const UNEXPECTED_SPARSE_ARRAY: Message =
    Message::new("unexpectedSparseArray", "Unexpected comma in middle of array.");
/// What oxlint says instead.
const UNEXPECTED_COMMA: Message = Message::new("unexpectedSparseArray", "Unexpected comma in middle of array");
const UNEXPECTED_COMMAS: Message =
    Message::new("unexpectedSparseArray", "{{count}} unexpected commas in middle of array");

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
            let count = elements.iter().filter(|it| it.is_missing()).count();
            if is_oxlint && count >= 10 {
                let span = array.span();
                let (place, label) = match span.len() < 50 {
                    true => (span, "the array here"),
                    false => (Span::empty(span.start), "the array starting here"),
                };
                cx.report(place, UNEXPECTED_COMMAS).data("count", count).first_label(label);
                return;
            }
            let text = cx.text();
            // After the `[` or the previous comma.
            let mut at = array.span().start + 1;
            let mut commas_of_holes = elements.iter().filter_map(|element| {
                let is_hole = element.is_missing();
                let comma = skip_trivia(text, if is_hole { at } else { element.outer_span().end });
                at = comma + 1;
                is_hole.then_some(comma)
            });
            if is_oxlint {
                if let Some(first) = commas_of_holes.next() {
                    cx.report(Span::empty(first), UNEXPECTED_COMMA).labels_with(|labels| {
                        labels.first("unexpected comma");
                        for comma in commas_of_holes {
                            labels.push(Span::empty(comma), "unexpected comma");
                        }
                    });
                }
                return;
            }
            for comma in commas_of_holes {
                cx.report(Span::new(comma, comma + 1), UNEXPECTED_SPARSE_ARRAY);
            }
        });
    }
}
