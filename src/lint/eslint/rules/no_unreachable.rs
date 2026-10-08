use bun_lint::prelude::*;

/// Disallow unreachable code after `return`, `throw`, `continue`, and `break` statements.
pub struct NoUnreachable;

const UNREACHABLE_CODE: Message = Message::new("unreachableCode", "Unreachable code.");

#[derive(Default)]
pub struct State {
    /// ESLint's `ConsecutiveRange`: consecutive unreachable statements that are not reported yet.
    range: Option<Span>,
    /// For each of the constructors around the current node, whether a `super()` has been seen.
    constructors: Vec<bool>,
}

type Context<'a> = Cx<'a, NoUnreachable>;

/// Reports the current range, which `next` replaces.
fn report_range(next: Option<Span>, cx: &mut Context) {
    if let Some(range) = std::mem::replace(&mut cx.state.range, next) {
        cx.report(range, UNREACHABLE_CODE);
    }
}

/// ESLint's `reportIfUnreachable`, for a node that is unreachable.
fn add_unreachable(node: Span, cx: &mut Context) {
    let Some(range) = cx.state.range else {
        cx.state.range = Some(node);
        return;
    };
    if range.contains(node) {
        return;
    }
    if cx.file().token_before(node).is_some_and(|before| range.contains(before.span())) {
        cx.state.range = Some(range.to(node));
        return;
    }
    report_range(Some(node), cx);
}

/// Whether ESLint has a `MethodDefinition` with the kind `constructor` for it.
fn is_constructor(member: Member) -> bool {
    member.kind() == MemberKind::Constructor && !member.is_static()
}

/// Whether the rule listens for `stmt`, or for the `ExportNamedDeclaration` or the
/// `ExportDefaultDeclaration` around it.
fn is_listened(stmt: Stmt) -> bool {
    match stmt.kind() {
        StmtKind::Var(declarations) => {
            declarations.first().is_some_and(|it| it.var_kind() != VarKind::Var)
                || declarations.iter().any(|it| it.init().is_some())
                || stmt.is_exported()
        }
        StmtKind::Fn(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::ImportEquals(_) => stmt.is_exported(),
        _ => true,
    }
}

/// Whether there can be a subclass whose constructor does not call `super()`.
fn has_constructor_without_super_call<'a>(file: &'a File<'a>) -> bool {
    let mut constructors = (file.classes().filter(|class| class.extends().is_some()))
        .flat_map(|class| class.members())
        .filter(|&member| is_constructor(member))
        .peekable();
    if constructors.peek().is_none() {
        return false;
    }
    let constructor_around = |e: Expr<'a>| {
        Node::Expr(e).ancestors().find_map(|it| match it {
            Node::Member(member) if is_constructor(member) => Some(member),
            _ => None,
        })
    };
    let with_call: Vec<Member> = (file.exprs_of_kind(ExprTag::Super))
        .filter(|&e| matches!(e.parent(), Node::Expr(parent) if parent.as_call().is_some_and(|call| call.callee() == e)))
        .filter_map(constructor_around)
        .collect();
    constructors.any(|member| !with_call.contains(&member))
}

impl NoUnreachable {
    fn enter_statement<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Stmt(stmt) = node else {
            return;
        };
        let is_reachable = stmt.is_reachable();
        if is_reachable && cx.state.range.is_none() || !is_listened(stmt) {
            return;
        }
        match is_reachable {
            true => report_range(None, cx),
            false => add_unreachable(stmt.span(), cx),
        }
    }

    /// The `BlockStatement` that is the body of a function can always be reached.
    fn enter_function<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.range.is_some()
            && let Node::Func(func) = node
            && func.kind() != FnKind::StaticBlock
            && func.body_statements().is_some()
        {
            report_range(None, cx);
        }
    }

    fn enter_member<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(node, Node::Member(member) if is_constructor(member)) {
            cx.state.constructors.push(false);
        }
    }

    /// The instance fields of a subclass are never created if its constructor does not call
    /// `super()`.
    fn exit_member<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Member(member) = node else {
            return;
        };
        if !is_constructor(member) {
            return;
        }
        let has_super_call = cx.state.constructors.pop().unwrap_or(true);
        let Node::Class(class) = member.parent() else {
            return;
        };
        if has_super_call || class.extends().is_none() || !member.func().is_some_and(Func::has_body) {
            return;
        }
        for element in class.members() {
            if element.kind() == MemberKind::Property
                && !element.flags().intersects(Flags::STATIC | Flags::ACCESSOR | Flags::ABSTRACT)
            {
                add_unreachable(element.span(), cx);
            }
        }
    }

    fn enter_super<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Expr(e) = node
            && let Node::Expr(parent) = e.parent()
            && matches!(parent.kind(), ExprKind::Call(call) if call.callee() == e)
            && let Some(has_super_call) = cx.state.constructors.last_mut()
        {
            *has_super_call = true;
        }
    }
}

impl Rule for NoUnreachable {
    const META: Meta = Meta::eslint("no-unreachable", Kind::Problem).recommended();
    type State<'a> = State;

    fn new(_: &Options) -> Self {
        NoUnreachable
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State {
        if !file.has_unreachable_statements() && !has_constructor_without_super_call(file) {
            return State::default();
        }
        on.enter(
            [
                StmtTag::Block,
                StmtTag::Break,
                StmtTag::Class,
                StmtTag::Continue,
                StmtTag::Debugger,
                StmtTag::DoWhile,
                StmtTag::Expr,
                StmtTag::ForIn,
                StmtTag::ForOf,
                StmtTag::For,
                StmtTag::If,
                StmtTag::Labeled,
                StmtTag::Return,
                StmtTag::Switch,
                StmtTag::Throw,
                StmtTag::Try,
                StmtTag::Var,
                StmtTag::While,
                StmtTag::ExportNamed,
                StmtTag::ExportDefault,
                StmtTag::ExportStar,
                // These only with an `export`.
                StmtTag::Fn,
                StmtTag::Interface,
                StmtTag::TypeAlias,
                StmtTag::Enum,
                StmtTag::Module,
                StmtTag::ImportEquals,
            ],
            Self::enter_statement,
        );
        on.enter(NodeTags::FUNC, Self::enter_function);
        on.enter(NodeTags::MEMBER, Self::enter_member);
        on.exit(NodeTags::MEMBER, Self::exit_member);
        on.enter(ExprTag::Super, Self::enter_super);
        on.finish(|_, cx| report_range(None, cx));
        State::default()
    }
}
