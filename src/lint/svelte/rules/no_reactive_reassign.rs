use crate::conditions::should_run;
use crate::reactive::{WITHOUT_RUNES, assignment_of, reactive_statements};
use crate::variables::owner_as;
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::get_property_name;

/// disallow reassigning reactive values
pub struct NoReactiveReassign {
    props: bool,
}

const ASSIGNMENT_TO_REACTIVE_VALUE: Message =
    Message::new("assignmentToReactiveValue", "Assignment to reactive value '{{name}}'.");
const ASSIGNMENT_TO_REACTIVE_VALUE_PROP: Message =
    Message::new("assignmentToReactiveValueProp", "Assignment to property of reactive value '{{name}}'.");

/// What reassigns a value, from [`reassignment`].
enum Reassigned<'a> {
    Node(Node<'a>),
    /// A component's `bind:`.
    Binding(SvelteNode<'a>),
}

/// The array methods that mutate the array.
const MUTATING: [&[u8]; 9] = [b"push", b"pop", b"shift", b"unshift", b"reverse", b"splice", b"sort", b"copyWithin", b"fill"];

/// `getReassignData`: what reassigns the value of `id` or one of its properties, and how many member accesses lead
/// there.
fn reassignment<'a>(id: Expr<'a>) -> Option<(Reassigned<'a>, usize)> {
    let mut path: Vec<Expr<'a>> = Vec::new();
    let mut node = id;
    loop {
        let parent = match node.parent() {
            Node::Expr(parent) => parent,
            Node::Prop(prop) => {
                // `{ a: id } = ..`, `{ ...id } = ..`
                let Node::Expr(object) = prop.parent() else {
                    return None;
                };
                if prop.value() != Some(node) || !object.is_assignment_target() {
                    return None;
                }
                node = object;
                continue;
            }
            Node::Stmt(statement) => {
                return match statement.kind() {
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left.as_expr() == Some(node) => {
                        Some((Reassigned::Node(Node::Stmt(statement)), path.len()))
                    }
                    _ => None,
                };
            }
            _ => {
                let directive = owner_as(node, SvelteTag::Directive, Role::Expression)?;
                return (directive.kind() == SvelteKind::Binding).then_some((Reassigned::Binding(directive), path.len()));
            }
        };
        match parent.kind() {
            ExprKind::Unary { op, .. } => {
                let is_reassign = matches!(op, UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec);
                return is_reassign.then_some((Reassigned::Node(Node::Expr(parent)), path.len()));
            }
            // A pattern's default isn't an assignment.
            ExprKind::Assign { .. } if parent.is_assignment_target() => return None,
            ExprKind::Assign { target, .. } => {
                return (target == node).then_some((Reassigned::Node(Node::Expr(parent)), path.len()));
            }
            ExprKind::Call(call) => {
                let member = path.last().copied()?;
                if call.callee() != node {
                    return None;
                }
                let name = get_property_name(member, None)?;
                if !MUTATING.contains(&&name[..]) {
                    return None;
                }
                path.pop();
                return Some((Reassigned::Node(Node::Expr(parent)), path.len()));
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == node => path.push(parent),
            ExprKind::Cond { test, .. } if test != node => {}
            ExprKind::Array(_) | ExprKind::Spread(_) if parent.is_assignment_target() => {}
            _ => return None,
        }
        node = parent;
    }
}

impl Rule for NoReactiveReassign {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-reactive-reassign", Kind::Problem).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoReactiveReassign {
            props: options.object(0).bool("props") != Some(false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.svelte().is_some() && should_run(file, WITHOUT_RUNES)).then_some(())
    }

    /// Upstream's `SvelteReactiveStatement` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for reactive in reactive_statements(file) {
            let Some(assignment) = assignment_of(reactive) else {
                continue;
            };
            let Some((_, left, _)) = assignment.as_assign() else {
                continue;
            };
            for variable in file.svelte_computed_of(assignment) {
                for reference in variable.references() {
                    if left.span().contains(reference.span()) {
                        continue;
                    }
                    let Some(id) = reference.expr() else {
                        continue;
                    };
                    let Some((reassigned, path)) = reassignment(id) else {
                        continue;
                    };
                    if !self.props && path > 0 {
                        continue;
                    }
                    let message = match path {
                        0 => ASSIGNMENT_TO_REACTIVE_VALUE,
                        _ => ASSIGNMENT_TO_REACTIVE_VALUE_PROP,
                    };
                    let name = reference.name().bytes();
                    match reassigned {
                        Reassigned::Node(node) => cx.report(node, message),
                        Reassigned::Binding(directive) => cx.report(directive, message),
                    }
                    .data("name", name)
                    .listened_by(reactive, false);
                }
            }
        }
    }
}
