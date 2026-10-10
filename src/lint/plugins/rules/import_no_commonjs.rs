use bun_lint_oxlint::ast_util::{is_specific_id, static_property_name};
use bun_lint_oxlint::import::{is_in_root_scope, is_require_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Forbid the use of CommonJS `require` calls and `module.exports` or `exports.*`.
pub struct NoCommonjs {
    allow_primitive_modules: bool,
    allow_require: bool,
    allow_conditional_require: bool,
}

const NO_COMMONJS: Message = Message::new("", "Expected {{name}} instead of {{actual}}");

#[derive(Default)]
pub struct State<'a> {
    root_scope: AncestorMemo<'a, ()>,
    /// That something is in an `if`, a `try`, a `? :` or an operand of `&&`, `||` or `??`.
    conditional: AncestorMemo<'a, ()>,
}

impl Rule for NoCommonjs {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-commonjs", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index, ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoCommonjs {
            allow_primitive_modules: options.bool_or("allowPrimitiveModules", false),
            allow_require: options.bool_or("allowRequire", false),
            allow_conditional_require: options.bool_or("allowConditionalRequire", true),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions("exports") {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
        }
        if !self.allow_require && file.mentions("require") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Dot | ExprTag::Index => self.check_member(e, cx),
            ExprTag::Call => self.check_call(e, cx),
            _ => {}
        }
    }
}

/// What oxc has two levels above a member expression.
enum Grandparent<'a> {
    /// An expression statement that is an assignment: its right side.
    AssignmentStatement(Expr<'a>),
    /// An assignment: its right side.
    Assignment(Expr<'a>),
    Other,
}

/// How many nodes oxc has around `e` that are not nodes here: a `ChainExpression`, and one for each pair of parentheses.
fn wrappers(e: Expr) -> usize {
    usize::from(e.is_chain_root()) + if e.is_parenthesized() { e.parens().len() } else { 0 }
}

fn right_of_assignment(node: Node<'_>) -> Option<Expr<'_>> {
    match node.as_expr().map(Expr::kind) {
        Some(ExprKind::Assign { value, .. }) => Some(value),
        _ => None,
    }
}

fn grandparent(member: Expr<'_>) -> Grandparent<'_> {
    let parent = member.parent();
    match (wrappers(member), parent) {
        (1, _) => right_of_assignment(parent).map_or(Grandparent::Other, Grandparent::Assignment),
        (0, Node::Expr(e)) if wrappers(e) == 0 => match (e.parent(), right_of_assignment(parent)) {
            (Node::Stmt(stmt), Some(right)) if stmt.tag() == StmtTag::Expr => Grandparent::AssignmentStatement(right),
            (above, _) => right_of_assignment(above).map_or(Grandparent::Other, Grandparent::Assignment),
        },
        _ => Grandparent::Other,
    }
}

impl NoCommonjs {
    fn check_member<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(object) = member.object() else {
            return;
        };
        let is_module = is_specific_id(object, "module");
        if !is_module && !is_specific_id(object, "exports") || member.is_jsx_tag_name() || member.is_in_type_query() {
            return;
        }
        let Some(property_name) = static_property_name(member) else {
            return;
        };
        if !is_module && !is_in_root_scope(Node::Expr(member), &mut cx.state.root_scope) {
            return;
        }
        let report = || drop(cx.report(member, NO_COMMONJS).data("name", "export").data("actual", property_name));
        if !is_module {
            return report();
        }
        if !property_name.is("exports") {
            return;
        }
        if !self.allow_primitive_modules {
            report();
        }
        let is_reported_again = match grandparent(member) {
            Grandparent::AssignmentStatement(right) => {
                right.is_parenthesized() || !matches!(right.tag(), ExprTag::Fn | ExprTag::String | ExprTag::Template)
            }
            Grandparent::Assignment(right) => right.tag() == ExprTag::Object,
            Grandparent::Other => true,
        };
        if is_reported_again {
            report();
        }
    }

    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| is_require_call(*it)) else {
            return;
        };
        if matches!(call.args().first().map(Expr::kind), Some(ExprKind::Template(template)) if !template.exprs().is_empty()) {
            return;
        }
        let is_conditional = |it: Node| match it {
            Node::Stmt(stmt) => matches!(stmt.tag(), StmtTag::If | StmtTag::Try),
            Node::Expr(e) => e.tag() == ExprTag::Cond || matches!(e.binary_op(), Some(BinOp::And | BinOp::Or | BinOp::Nullish)),
            _ => false,
        };
        if self.allow_conditional_require
            && (!is_in_root_scope(Node::Expr(e), &mut cx.state.root_scope)
                || cx.state.conditional.find(Node::Expr(e), |_, parent| is_conditional(parent).then_some(())).is_some())
        {
            return;
        }
        if cx.file().top_level_scope().get("require").is_none() {
            cx.report(e, NO_COMMONJS).data("name", "import").data("actual", "require");
        }
    }
}
