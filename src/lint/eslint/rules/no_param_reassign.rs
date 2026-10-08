use bun_lint::prelude::*;
use bun_lint::utils::estree_compat::is_assignment_target;

/// Disallow reassigning function parameters.
pub struct NoParamReassign {
    props: bool,
    ignored_property_assignments_for: Vec<Box<[u8]>>,
    ignored_property_assignments_for_regex: Vec<Regex>,
}

const ASSIGNMENT_TO_FUNCTION_PARAM: Message = Message::new(
    "assignmentToFunctionParam",
    "Assignment to function parameter '{{name}}'.",
);
const ASSIGNMENT_TO_FUNCTION_PARAM_PROP: Message = Message::new(
    "assignmentToFunctionParamProp",
    "Assignment to property of function parameter '{{name}}'.",
);

/// Whether the identifier is read in order to modify a property of its value.
fn is_modifying_prop(identifier: Expr) -> bool {
    let mut node = identifier;
    loop {
        node = match node.parent() {
            Node::Expr(parent) => {
                match parent.kind() {
                    // A default value in a destructuring target is part of the left side of the
                    // assignment around it.
                    ExprKind::Assign { target, .. } => {
                        return target == node || is_assignment_target(parent);
                    }
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete,
                        ..
                    } => return true,
                    ExprKind::Call(call) if call.callee() != node => return false,
                    ExprKind::Index { index, .. } if index == node => return false,
                    ExprKind::Cond { test, .. } if test == node => return false,
                    _ => {}
                }
                parent
            }
            Node::Prop(prop) => {
                if matches!(prop.key().map(Key::kind), Some(KeyKind::Computed(key)) if key == node) {
                    return false;
                }
                match prop.parent() {
                    Node::Expr(object) => object,
                    _ => return false,
                }
            }
            Node::Stmt(statement) => {
                return match statement.kind() {
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                        matches!(left.kind(), StmtKind::Expr(target) if target == node)
                    }
                    _ => false,
                };
            }
            // A class expression does not end the search, a class declaration does.
            parent @ (Node::Class(_) | Node::Member(_)) => {
                match parent.ancestors().find(|it| !matches!(it, Node::Class(_))) {
                    Some(Node::Expr(owner)) => owner,
                    _ => return false,
                }
            }
            _ => return false,
        };
    }
}

impl NoParamReassign {
    fn is_ignored_property_assignment(&self, name: &[u8]) -> bool {
        self.ignored_property_assignments_for.iter().any(|ignored| **ignored == *name)
            || self.ignored_property_assignments_for_regex.iter().any(|ignored| ignored.test(name))
    }

    fn check_variable<'a>(&self, pat: Pat<'a>, cx: &Cx<'a, Self>) {
        let Some(symbol) = pat.symbol() else {
            return;
        };
        // Once for `function f(a, a) {}`.
        if !matches!(symbol.declarations().next(), Some(Declaration::Param(first)) if first == pat) {
            return;
        }
        // A destructuring assignment with a default value writes to the same identifier twice.
        let mut previous = None;
        for reference in symbol.references() {
            let at = reference.span();
            let is_repeated = previous.replace(at) == Some(at);
            if reference.is_init() || is_repeated {
                continue;
            }
            if reference.is_write() {
                cx.report(at, ASSIGNMENT_TO_FUNCTION_PARAM).data("name", reference.name());
            } else if self.props
                && reference.expr().is_some_and(is_modifying_prop)
                && !self.is_ignored_property_assignment(reference.name().bytes())
            {
                cx.report(at, ASSIGNMENT_TO_FUNCTION_PARAM_PROP).data("name", reference.name());
            }
        }
    }
}

impl Rule for NoParamReassign {
    const META: Meta = Meta::eslint("no-param-reassign", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoParamReassign {
            props: object.bool_or("props", false),
            ignored_property_assignments_for: object
                .strings("ignorePropertyModificationsFor")
                .into_iter()
                .map(|name| name.as_bytes().into())
                .collect(),
            ignored_property_assignments_for_regex: object
                .strings("ignorePropertyModificationsForRegex")
                .into_iter()
                .filter_map(|pattern| Regex::new(pattern, "u").ok())
                .collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.params(|rule, param, cx| {
            if param.func().is_some_and(Func::has_body) {
                param.pat().for_each_binding(&mut |pat| rule.check_variable(pat, cx));
            }
        });
    }
}
