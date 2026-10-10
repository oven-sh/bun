use bun_lint::code_path::{Event, Step, steps_of_code_path};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Require returning inside each `then()` to create readable and reusable Promise chains.
pub struct AlwaysReturn {
    ignore_last_callback: bool,
    ignore_assignment_variable: Vec<String>,
}

const ALWAYS_RETURN: Message = Message::new("", "Each then() should return a value or throw");

impl Rule for AlwaysReturn {
    const META: Meta = Meta::oxlint(Plugin::Promise, "always-return", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        AlwaysReturn {
            ignore_last_callback: options.bool_or("ignoreLastCallback", false),
            ignore_assignment_variable: match options.has("ignoreAssignmentVariable") {
                true => options.strings("ignoreAssignmentVariable").into_iter().map(String::from).collect(),
                false => vec!["globalThis".to_owned()],
            },
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("then").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // `a.then(function () { .. })`, `a.then(() => { .. })`
        let Some(func) = e.as_call().filter(|it| is_member_call(*it, &["then"])).and_then(|it| it.args().first()).and_then(|it| {
            it.as_fn().filter(|func| !it.is_parenthesized() && matches!(func.body(), FnBody::Block(_)))
        }) else {
            return;
        };
        if (self.ignore_last_callback || self.has_ignored_assignment(func)) && is_last_callback(e) {
            return;
        }
        if has_no_return_code_path(func) {
            cx.report(func.estree_span(), ALWAYS_RETURN);
        }
    }
}

/// `a.name()`, where neither `a.name` is in parentheses nor `name` is private.
fn is_member_call(call_expr: Call, member_names: &[&str]) -> bool {
    let callee = call_expr.callee();
    !callee.is_parenthesized() && !callee.is_private_member() && callee.member_name().is_some_and(|it| it.name().is_any(member_names))
}

/// Whether nothing is done with what `call`, a call of `then`, returns.
fn is_last_callback(call: Expr) -> bool {
    let mut target = call;
    loop {
        let parent = match target.parent() {
            // `{ promise.then(() => value) }`
            Node::Stmt(statement) => return statement.tag() == StmtTag::Expr,
            Node::Expr(parent) => parent,
            _ => return false,
        };
        target = match parent.kind() {
            // `void promise.then(() => value)`
            ExprKind::Unary { op, .. } => return op == UnOp::Void,
            // `(promise.then(() => value), expr)`
            ExprKind::Binary { op: BinOp::Comma, left, .. } if left == target => return true,
            ExprKind::Binary { op: BinOp::Comma, .. } | ExprKind::Await(_) => parent,
            // `promise.then(() => value).catch(e => {})`
            ExprKind::Dot { .. } if !parent.is_private_member() && !parent.is_parenthesized() && !parent.is_chain_root() => {
                match parent.parent() {
                    Node::Expr(call) if call.as_call().is_some_and(|it| is_member_call(it, &["catch", "finally"])) => call,
                    _ => return false,
                }
            }
            _ => return false,
        };
    }
}

/// `process.exit(0)`, `process.abort()`
fn is_nodejs_terminal_statement(statement: Stmt) -> bool {
    let StmtKind::Expr(e) = statement.kind() else {
        return false;
    };
    !e.is_parenthesized()
        && e.chain() == Chain::No
        && e.as_call().is_some_and(|call_expr| {
            is_member_call(call_expr, &["exit", "abort"])
                && call_expr.callee().object().is_some_and(|it| it.is_ident("process") && !it.is_parenthesized())
        })
}

/// Whether the end of the function can be reached, other than after `process.exit()` in the same segment of its code path.
fn has_no_return_code_path(func: Func) -> bool {
    if !func.is_end_reachable() {
        return false;
    }
    if !func.file().mentions("process") {
        return true;
    }
    let root = Node::Func(func);
    let mut code_path = None;
    // The segments that have started and not ended, and those with a `process.exit()`.
    let mut current_segments: SmallVec<[Segment; 4]> = SmallVec::new();
    let mut terminated_segments: SmallVec<[Segment; 4]> = SmallVec::new();
    for step in steps_of_code_path(root, NodeTags::EMPTY, NodeTags::FUNC | ExprTag::Dot.into()) {
        match step {
            Step::Event(Event::CodePathStart(path, node)) if node == root => code_path = Some(path),
            Step::Event(Event::SegmentStart(segment, _)) if Some(segment.code_path()) == code_path => current_segments.push(segment),
            Step::Event(Event::SegmentEnd(segment, _)) if Some(segment.code_path()) == code_path => {
                current_segments.pop();
            }
            Step::Exit(Node::Expr(callee)) => {
                if let Node::Expr(call) = callee.parent()
                    && let Node::Stmt(statement) = call.parent()
                    && call.callee() == Some(callee)
                    && is_nodejs_terminal_statement(statement)
                {
                    terminated_segments.extend(current_segments.last().copied());
                }
            }
            Step::Exit(node) if node == root => return current_segments.iter().any(|it| !terminated_segments.contains(it)),
            _ => {}
        }
    }
    false
}

impl AlwaysReturn {
    /// Whether a statement of the function assigns to one of the variables, or to something in one.
    fn has_ignored_assignment(&self, func: Func) -> bool {
        !self.ignore_assignment_variable.is_empty()
            && func.body_statements().into_iter().flatten().any(|it| match it.kind() {
                StmtKind::Expr(e) if !e.is_parenthesized() => match e.kind() {
                    ExprKind::Assign { target, .. } => {
                        get_root_object_name(target).is_some_and(|name| self.ignore_assignment_variable.iter().any(|it| name.is(it)))
                    }
                    _ => false,
                },
                _ => false,
            })
    }
}

/// The `a` of `a`, `a.b`, `a[b].c`.
fn get_root_object_name(assignment_target: Expr<'_>) -> Option<Name<'_>> {
    let mut at = assignment_target;
    loop {
        at = match at.kind() {
            ExprKind::Ident(name) => return Some(name),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !at.is_private_member() && !obj.is_parenthesized() => obj,
            _ => return None,
        };
    }
}
