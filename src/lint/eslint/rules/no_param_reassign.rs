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

/// Whether ESLint's node for `func` is none of those that end the search: a `TSFunctionType`, a
/// `TSConstructorType`, a `TSMethodSignature`, a `TSIndexSignature`.
fn is_part_of_a_type(func: Func) -> bool {
    match func.kind() {
        FnKind::FunctionType | FnKind::ConstructorType | FnKind::IndexSignature => true,
        FnKind::Method | FnKind::Getter | FnKind::Setter => {
            matches!(func.owner(), owner @ Node::Member(_) if !matches!(owner.parent(), Node::Class(_)))
        }
        _ => false,
    }
}

/// Whether what is at `identifier` is read in order to modify a property of its value.
/// A name in a type counts as well: `(a as typeof b).c = 1`.
fn is_modifying_prop(identifier: Node) -> bool {
    let mut node = identifier;
    loop {
        let parent = node.parent();
        match parent {
            Node::Expr(parent) => match parent.kind() {
                // A default value in a destructuring target is part of the left side of the
                // assignment around it.
                ExprKind::Assign { target, .. } => {
                    return Node::Expr(target) == node || is_assignment_target(parent);
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete,
                    ..
                } => return true,
                ExprKind::Call(call) if Node::Expr(call.callee()) != node => return false,
                ExprKind::Index { index, .. } if Node::Expr(index) == node => return false,
                ExprKind::Cond { test, .. } if Node::Expr(test) == node => return false,
                _ => {}
            },
            Node::Prop(prop) => {
                if matches!(prop.key().map(Key::kind), Some(KeyKind::Computed(key)) if Node::Expr(key) == node) {
                    return false;
                }
            }
            Node::Stmt(statement) => {
                return match statement.kind() {
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                        matches!(left.kind(), StmtKind::Expr(target) if Node::Expr(target) == node)
                    }
                    _ => false,
                };
            }
            Node::Func(func) if is_part_of_a_type(func) => {}
            Node::Param(_) if matches!(node, Node::Type(_)) => {}
            // The others are in a `TSTypeParameterDeclaration`.
            Node::TypeParam(_) if matches!(parent.parent(), Node::Type(_)) => {}
            Node::Type(_) | Node::TupleElem(_) | Node::Class(_) | Node::Member(_) => {}
            _ => return false,
        }
        node = parent;
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
        // ESLint defines the parameters before everything else in the scope of the function.
        // Once for `function f(a, a) {}`.
        let is_parameter = |it: &Declaration<'a>| matches!(it, Declaration::Param(_));
        if !matches!(symbol.declarations().find(is_parameter), Some(Declaration::Param(first)) if first == pat) {
            return;
        }
        // ESLint comes to the variable from each function that declares it:
        // `function f(a) { function a() {} }`.
        let redeclarations = symbol.declarations().filter(|it| matches!(it, Declaration::Fn(func) if func.has_body()));
        for _ in 0..=redeclarations.count() {
            self.check_references(symbol, cx);
        }
    }

    fn check_references<'a>(&self, symbol: Symbol<'a>, cx: &Cx<'a, Self>) {
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
                && matches!(reference.node(), node @ (Node::Expr(_) | Node::Type(_)) if is_modifying_prop(node))
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
