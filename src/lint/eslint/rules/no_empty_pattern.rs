use bun_lint::prelude::*;

/// Disallow empty destructuring patterns.
pub struct NoEmptyPattern {
    allows_object_patterns_as_parameters: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected empty {{type}} pattern.");

/// `{}` or `{} = {}` as a parameter of a function.
fn is_allowed_parameter(pat: Pat) -> bool {
    let Node::Param(param) = pat.parent() else {
        return false;
    };
    if param.is_rest()
        || param.is_parameter_property()
        || !param.func().is_some_and(ast_utils::is_function_with_body)
    {
        return false;
    }
    match param.default().map(Expr::kind) {
        None => true,
        Some(ExprKind::Object(props)) => props.is_empty(),
        Some(_) => false,
    }
}

fn report<'a>(at: Span, kind: &'static str, cx: &Cx<'a, NoEmptyPattern>) {
    let report = cx.report(at, UNEXPECTED).data("type", kind);
    if cx.language().is_oxlint {
        report.help(match kind {
            "array" => {
                "Passing non-iterable values (null, undefined, numbers, booleans, etc.) will result in a runtime \
                 error because these values are not iterable."
            }
            _ => {
                "Passing `null` or `undefined` will result in runtime error because `null` and `undefined` cannot \
                 be destructured."
            }
        });
    }
}

impl Rule for NoEmptyPattern {
    const META: Meta = Meta::eslint("no-empty-pattern", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoEmptyPattern {
            allows_object_patterns_as_parameters: options
                .object(0)
                .bool_or("allowObjectPatternsAsParameters", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.pats([PatTag::Object, PatTag::Array], |rule, pat, cx| {
            let kind = match pat.kind() {
                PatKind::Object(props) if props.is_empty() => {
                    if rule.allows_object_patterns_as_parameters && is_allowed_parameter(pat) {
                        return;
                    }
                    "object"
                }
                PatKind::Array(elements) if elements.is_empty() => "array",
                _ => return,
            };
            report(utils::estree_span(pat.into()), kind, cx);
        });
        on.exprs([ExprTag::Object, ExprTag::Array], |_, e, cx| {
            let kind = match e.kind() {
                ExprKind::Object(props) if props.is_empty() => "object",
                ExprKind::Array(elements) if elements.is_empty() => "array",
                _ => return,
            };
            if utils::is_assignment_target(e) {
                report(e.span(), kind, cx);
            }
        });
    }
}
