use bun_lint::prelude::*;

/// Disallow assignments where both sides are exactly the same.
pub struct NoSelfAssign {
    props: bool,
}

const SELF_ASSIGNMENT: Message = Message::new("selfAssignment", "'{{name}}' is assigned to itself.");

/// ESLint's `eachSelfAssignment`: goes through the target `left` and the value `right` in parallel.
fn each_self_assignment<'a>(left: Expr<'a>, right: Expr<'a>, props: bool, report: &mut dyn FnMut(Expr<'a>)) {
    match (left.kind(), right.kind()) {
        (ExprKind::Ident(l), ExprKind::Ident(r)) => {
            if l == r {
                report(right);
            }
        }
        (ExprKind::Array(targets), ExprKind::Array(values)) => {
            let count = values.len();
            for (i, (target, value)) in targets.iter().zip(values).enumerate() {
                // `[...a] = [...a, 1]`
                if target.tag() == ExprTag::Spread && i + 1 < count {
                    break;
                }
                each_self_assignment(target, value, props, report);
                // What follows a spread is at an unknown index.
                if value.tag() == ExprTag::Spread {
                    break;
                }
            }
        }
        (ExprKind::Spread(l), ExprKind::Spread(r)) => each_self_assignment(l, r, props, report),
        (ExprKind::Object(targets), ExprKind::Object(values)) => {
            // A spread can overwrite the properties before it.
            let mut start = 0;
            for (i, value) in values.iter().enumerate() {
                if value.kind() == PropKind::Spread {
                    start = i + 1;
                }
            }
            for target in targets {
                for value in values.iter().skip(start) {
                    each_self_assigned_property(target, value, props, report);
                }
            }
        }
        (ExprKind::Dot { .. } | ExprKind::Index { .. }, ExprKind::Dot { .. } | ExprKind::Index { .. }) => {
            if props && ast_utils::is_same_reference(left, right, false) {
                report(right);
            }
        }
        _ => {}
    }
}

fn each_self_assigned_property<'a>(left: Prop<'a>, right: Prop<'a>, props: bool, report: &mut dyn FnMut(Expr<'a>)) {
    if left.kind() == PropKind::Spread || !matches!(right.kind(), PropKind::Init | PropKind::Shorthand) {
        return;
    }
    if let Some(name) = ast_utils::get_static_property_name(left)
        && Some(name) == ast_utils::get_static_property_name(right)
        && let (Some(target), Some(value)) = (left.value(), right.value())
    {
        each_self_assignment(target, value, props, report);
    }
}

/// `text.replace(/\s+/gu, "")`
fn without_spaces(source: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(source.len());
    let mut points = text::code_points(source).peekable();
    while let Some((start, c)) = points.next() {
        if !text::is_js_whitespace(c) {
            let end = points.peek().map_or(source.len(), |next| next.0);
            out.extend_from_slice(source.get(start..end).unwrap_or_default());
        }
    }
    out
}

impl Rule for NoSelfAssign {
    const META: Meta = Meta::eslint("no-self-assign", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoSelfAssign {
            props: options.object(0).bool_or("props", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Assign], |rule, e, cx| {
            let ExprKind::Assign { op, target, value } = e.kind() else {
                return;
            };
            if !matches!(op, None | Some(BinOp::And | BinOp::Or | BinOp::Nullish)) {
                return;
            }
            each_self_assignment(target, value, rule.props, &mut |found| {
                // A default value in a destructuring assignment is not an assignment.
                if !utils::is_assignment_target(e) {
                    cx.report(found, SELF_ASSIGNMENT).data("name", without_spaces(found.text()));
                }
            });
        });
    }
}
