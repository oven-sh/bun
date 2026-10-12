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

/// `is_of_property` means the pattern is a property's value, after the `:`.
fn report<'a>(at: Span, kind: &'static str, is_of_property: bool, cx: &Cx<'a, NoEmptyPattern>) {
    let report = cx.report(at, UNEXPECTED).data("type", kind).hint(match (is_of_property, kind) {
        (false, _) => "It declares no variables.",
        (true, "array") => "It declares no variables. For a default value, write = [] instead of : [].",
        (true, _) => "It declares no variables. For a default value, write = {} instead of : {}.",
    });
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
    const META: Meta = Meta::eslint("no-empty-pattern", Kind::Problem).recommended().hints();
    const ON: On = On::new()
        .pats(&[PatTag::Object, PatTag::Array])
        .exprs(&[ExprTag::Object, ExprTag::Array]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoEmptyPattern {
            allows_object_patterns_as_parameters: options
                .object(0)
                .bool_or("allowObjectPatternsAsParameters", false),
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let kind = match pat.kind() {
            PatKind::Object(props) if props.is_empty() => {
                if self.allows_object_patterns_as_parameters && is_allowed_parameter(pat) {
                    return;
                }
                "object"
            }
            PatKind::Array(elements) if elements.is_empty() => "array",
            _ => return,
        };
        report(utils::estree_span(pat.into()), kind, matches!(pat.parent(), Node::PatProp(_)), cx);
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let kind = match e.tag() {
            ExprTag::Object if e.as_object().is_some_and(List::is_empty) => "object",
            ExprTag::Array if e.as_array().is_some_and(List::is_empty) => "array",
            _ => return,
        };
        // oxlint looks at what declares only.
        if !cx.language().is_oxlint && utils::is_assignment_target(e) {
            report(e.span(), kind, matches!(e.parent(), Node::Prop(_)), cx);
        }
    }
}
