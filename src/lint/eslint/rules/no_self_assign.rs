use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// Disallow assignments where both sides are exactly the same.
pub struct NoSelfAssign {
    props: bool,
}

const SELF_ASSIGNMENT: Message = Message::new("selfAssignment", "'{{name}}' is assigned to itself.");

/// ESLint's `eachSelfAssignment`: goes through the target `left` and the value `right` in parallel.
fn each_self_assignment<'a>(left: Expr<'a>, right: Expr<'a>, props: bool, report: &mut dyn FnMut(Expr<'a>)) {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return;
    }
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
        // oxlint does not look at what comes after `...`.
        (ExprKind::Spread(l), ExprKind::Spread(r)) if !left.file().language().is_oxlint => {
            each_self_assignment(l, r, props, report);
        }
        (ExprKind::Object(targets), ExprKind::Object(values)) => {
            // A spread can overwrite the properties before it.
            let mut start = 0;
            for (i, value) in values.iter().enumerate() {
                if value.kind() == PropKind::Spread {
                    start = i + 1;
                }
            }
            if targets.len().min(values.len() - start) <= 8 {
                for target in targets {
                    for value in values.iter().skip(start) {
                        each_self_assigned_property(target, value, props, report);
                    }
                }
                return;
            }
            let mut by_name: FxHashMap<Cow<'a, [u8]>, Vec<Prop<'a>>> = FxHashMap::default();
            for value in values.iter().skip(start) {
                if let Some(name) = ast_utils::get_static_property_name(value) {
                    by_name.entry(name).or_default().push(value);
                }
            }
            for target in targets {
                let name = ast_utils::get_static_property_name(target);
                for &value in name.and_then(|name| by_name.get(&name)).into_iter().flatten() {
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

impl Rule for NoSelfAssign {
    const META: Meta = Meta::eslint("no-self-assign", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Assign]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoSelfAssign {
            props: options.object(0).bool_or("props", true),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { op, target, value } = e.kind() else {
            return;
        };
        if !matches!(op, None | Some(BinOp::And | BinOp::Or | BinOp::Nullish)) {
            return;
        }
        each_self_assignment(target, value, self.props, &mut |found| {
            // A default value in a destructuring assignment is not an assignment.
            if !utils::is_assignment_target(e) {
                cx.report(found, SELF_ASSIGNMENT).data("name", strings::without_js_whitespace(found.text()));
            }
        });
    }
}
