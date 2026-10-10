use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint_oxlint::import::is_in_root_scope;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Forbid CommonJS `require` calls and `module.exports` or `exports.*`.
pub struct NoCommonjs {
    allow_primitive_modules: bool,
    allow_require: bool,
    allow_conditional_require: bool,
}

const EXPORT_MESSAGE: Message = Message::new("", "Expected \"export\" or \"export default\"");
const IMPORT_MESSAGE: Message = Message::new("", "Expected \"import\" instead of \"require()\"");
const OXLINT: Message = Message::new("", "Expected {{name}} instead of {{actual}}");

#[derive(Default)]
pub struct State<'a> {
    root_scope: AncestorMemo<'a, ()>,
    /// That something is in an `if`, a `try`, a `? :` or an operand of `&&`, `||` or `??`.
    conditional: AncestorMemo<'a, ()>,
}

impl Rule for NoCommonjs {
    const META: Meta = Meta::plugin(Plugin::Import, "no-commonjs", Kind::Suggestion);
    const ON: On =
        On::new().exprs(&[ExprTag::Dot, ExprTag::Index, ExprTag::Call]).stmts(&[StmtTag::Interface]).classes();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let is_legacy = options.str(0) == Some("allow-primitive-modules");
        let options = options.object(0);
        NoCommonjs {
            allow_primitive_modules: is_legacy || options.bool_or("allowPrimitiveModules", false),
            allow_require: options.bool_or("allowRequire", false),
            allow_conditional_require: options.bool_or("allowConditionalRequire", true),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        // `module`: a private name is not among what a file mentions.
        if file.mentions_any(&["exports", "module"]) {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
            // oxlint has the name of a type after `implements`, and after the `extends` of an interface.
            if !file.language().is_oxlint {
                on = on.stmts(&[StmtTag::Interface]).classes();
            }
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

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = stmt.kind() {
            for ty in interface.extends() {
                check_heritage(ty, cx);
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for ty in class.implements() {
            check_heritage(ty, cx);
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

/// `node.property.name === 'exports'`: an identifier, in brackets too, or a private name.
fn is_property_named_exports(member: Expr) -> bool {
    match member.kind() {
        ExprKind::Dot { name, .. } => matches!(name.bytes(), b"exports" | b"#exports"),
        ExprKind::Index { index, .. } => index.is_ident("exports"),
        _ => false,
    }
}

/// `scope.variables.some((variable) => variable.name === 'exports')`
fn declares_exports(scope: Scope) -> bool {
    scope.get("exports").is_some()
        || match (scope.kind(), scope.node()) {
            // What the configuration or a comment defines is a variable of the global scope.
            (ScopeKind::Global, Node::File(file)) => file.global(b"exports").is_some(),
            // ESLint has the name of a class declaration in the scope of the class as well.
            (ScopeKind::Class, Node::Class(class)) => class.name().is_some_and(|it| it.name().is("exports")),
            _ => false,
        }
}

/// `interface A extends exports.B`, `class A implements exports.B`: typescript-eslint has a `MemberExpression` there.
fn check_heritage<'a>(ty: TypeNode<'a>, cx: &Cx<'a, NoCommonjs>) {
    let TypeKind::Ref { name, .. } = ty.kind() else {
        return;
    };
    let (Some(object), Some(property)) = (name.get(0), name.get(1)) else {
        return;
    };
    let is_reported = match object.bytes() {
        b"module" => property.name().is("exports"),
        b"exports" => !declares_exports(Node::Type(ty).scope()),
        _ => false,
    };
    if is_reported {
        cx.report(object.span().to(property.span()), EXPORT_MESSAGE);
    }
}

impl NoCommonjs {
    /// upstream's `allowPrimitive`
    fn allow_primitive(&self, member: Expr) -> bool {
        self.allow_primitive_modules
            && !member.is_chain_root()
            && matches!(
                member.parent().as_expr().map(|it| (it.kind(), it.is_assignment_target())),
                Some((ExprKind::Assign { value, .. }, false)) if value.tag() != ExprTag::Object
            )
    }

    fn check_member<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(object) = member.object() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint looks through TypeScript's wrappers.
        let object = if is_oxlint { get_inner_expression(object) } else { object };
        let is_module = object.is_ident("module");
        if !is_module && !object.is_ident("exports") || !ast_utils::is_member_expression(member) {
            return;
        }
        if !is_oxlint {
            let is_reported = match is_module {
                true => is_property_named_exports(member) && !self.allow_primitive(member),
                false => !declares_exports(Node::Expr(member).scope()),
            };
            if is_reported {
                cx.report(member, EXPORT_MESSAGE);
            }
            return;
        }
        // oxlint knows a name that is written as a string, names it, and asks whether anything around makes a scope.
        let Some(property_name) = static_property_name(member) else {
            return;
        };
        if !is_module && !is_in_root_scope(Node::Expr(member), &mut cx.state.root_scope) {
            return;
        }
        let report = || drop(cx.report(member, OXLINT).data("name", "export").data("actual", property_name));
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
        let Some(call) = e.as_call() else {
            return;
        };
        let (callee, arguments, is_oxlint) = (call.callee(), call.args(), cx.language().is_oxlint);
        let Some(path) = arguments.first().filter(|_| arguments.len() == 1 && callee.is_ident("require")) else {
            return;
        };
        // upstream's `isLiteralString`
        let is_literal_string = match path.kind() {
            ExprKind::String(_) => true,
            ExprKind::Template(template) => template.exprs().is_empty(),
            _ => false,
        };
        // oxlint takes parentheses for nodes.
        if !is_literal_string || is_oxlint && (callee.is_parenthesized() || path.is_parenthesized()) {
            return;
        }
        let is_at_the_top = match is_oxlint {
            // oxlint asks only with the option, whatever the file is, and a block is a scope to it.
            true => !self.allow_conditional_require || is_in_root_scope(Node::Expr(e), &mut cx.state.root_scope),
            false => Node::Expr(e).scope().variable_scope().kind() == ScopeKind::Module,
        };
        let is_conditional = |it: Node| match it {
            Node::Stmt(stmt) => matches!(stmt.tag(), StmtTag::If | StmtTag::Try),
            Node::Expr(e) => e.tag() == ExprTag::Cond || matches!(e.binary_op(), Some(BinOp::And | BinOp::Or | BinOp::Nullish)),
            _ => false,
        };
        if !is_at_the_top
            || self.allow_conditional_require
                && cx.state.conditional.find(Node::Expr(e), |_, parent| is_conditional(parent).then_some(())).is_some()
        {
            return;
        }
        if !is_oxlint {
            cx.report(callee, IMPORT_MESSAGE);
        } else if cx.file().top_level_scope().get("require").is_none() {
            // oxlint leaves a `require` that the file declares alone, and points at the call.
            cx.report(e, OXLINT).data("name", "import").data("actual", "require");
        }
    }
}
