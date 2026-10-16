use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::prelude::*;
use rustc_hash::FxHashSet;
use std::cmp::Reverse;

/// Disallow unreachable code after `return`, `throw`, `continue`, and `break` statements.
pub struct NoUnreachable;

const UNREACHABLE_CODE: Message = Message::new("unreachableCode", "Unreachable code.");

#[derive(Default)]
pub struct State<'a> {
    /// ESLint's `ConsecutiveRange`: consecutive unreachable statements that are not reported yet.
    range: Option<Span>,
    /// For each of the constructors around the current node, whether a `super()` has been seen.
    constructors: Vec<bool>,
    /// With a configuration of oxlint: the last `catch` block that cannot be reached.
    catch_block: Option<Span>,
    /// What is reported at the end.
    found: Vec<Span>,
    /// The statements that cannot be reached, where the nodes are not entered one by one.
    unreachable: Vec<Stmt<'a>>,
}

/// Whether ESLint has a `MethodDefinition` with the kind `constructor` for it.
fn is_constructor(member: Member) -> bool {
    member.kind() == MemberKind::Constructor && !member.is_static()
}

/// Not `var a, b;`
fn is_more_than_hoisted<'a>(declarations: List<'a, VarDecl<'a>>) -> bool {
    declarations.first().is_some_and(|it| it.var_kind() != VarKind::Var)
        || declarations.iter().any(|it| it.init().is_some())
}

/// Whether the rule listens for `stmt`, or for the `ExportNamedDeclaration` or the
/// `ExportDefaultDeclaration` around it.
fn is_listened(stmt: Stmt) -> bool {
    match stmt.kind() {
        StmtKind::Var(declarations) => is_more_than_hoisted(declarations) || stmt.is_exported(),
        StmtKind::Fn(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::ImportEquals(_) => stmt.is_exported(),
        _ => true,
    }
}

/// What is no statement for oxlint: what declares something else than variables, and of the exports all but `export default`.
/// Of `export const a = 1` the declaration is one.
fn is_no_statement_for_oxlint(stmt: Stmt) -> bool {
    match stmt.kind() {
        _ if stmt.is_default_export() => false,
        StmtKind::Var(declarations) => !is_more_than_hoisted(declarations),
        StmtKind::Fn(_)
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. } => true,
        _ => false,
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
    let with_call: FxHashSet<Member> = (file.exprs_of_kind(ExprTag::Super))
        .filter(|&e| matches!(e.parent(), Node::Expr(parent) if parent.as_call().is_some_and(|call| call.callee() == e)))
        .filter_map(constructor_around)
        .collect();
    constructors.any(|member| !with_call.contains(&member))
}

const KINDS: &[StmtTag] = &[
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
];
const STATEMENTS: NodeTags = NodeTags::new().stmts(KINDS);

/// The statements and the functions in what is walked.
struct Entered<'a>(Vec<Node<'a>>);

impl<'a> Visitor<'a> for Entered<'a> {
    fn enter(&mut self, node: Node<'a>) {
        if STATEMENTS.union(NodeTags::FUNC).contains(node) {
            self.0.push(node);
        }
    }

    fn exit(&mut self, _: Node<'a>) {}
}

/// Puts statements and functions in the order in which they are entered.
fn sort_as_entered(nodes: &mut [Node]) {
    utils::sort::sort_by_key(nodes, |it| (it.span().start, Reverse(it.span().end), matches!(it, Node::Func(_))));
}

impl<'a> State<'a> {
    /// Reports the current range, which `next` replaces.
    fn report_range(&mut self, next: Option<Span>) {
        self.found.extend(std::mem::replace(&mut self.range, next));
    }

    /// ESLint's `reportIfUnreachable`, for a node that is unreachable.
    fn add_unreachable(&mut self, node: Span, file: &'a File<'a>) {
        let Some(range) = self.range else {
            self.range = Some(node);
            return;
        };
        if range.contains(node) {
            return;
        }
        // oxlint reports each statement.
        if !file.language().is_oxlint && file.token_before(node).is_some_and(|before| range.contains(before.span())) {
            self.range = Some(range.to(node));
            return;
        }
        self.report_range(Some(node));
    }

    /// What cannot be reached and oxlint says nothing about: what is no statement for it, and a `catch` block, which it takes
    /// for reachable whatever the `try` block is.
    fn oxlint_passes_over(&mut self, stmt: Stmt<'a>) -> bool {
        if self.catch_block.is_some_and(|it| it.contains(stmt.span())) {
            return true;
        }
        let is_catch_block = matches!(stmt.parent(), Node::Stmt(parent)
            if matches!(parent.kind(), StmtKind::Try { handler: Some(handler), .. } if handler == stmt));
        if is_catch_block {
            self.catch_block = Some(stmt.span());
        }
        is_catch_block || is_no_statement_for_oxlint(stmt)
    }

    fn enter_statement(&mut self, stmt: Stmt<'a>) {
        let is_reachable = stmt.is_reachable();
        if is_reachable && self.range.is_none() || !is_listened(stmt) {
            return;
        }
        let is_oxlint = stmt.file().language().is_oxlint;
        if !is_reachable && is_oxlint && self.oxlint_passes_over(stmt) {
            return;
        }
        match is_reachable {
            true => self.report_range(None),
            false if is_oxlint && stmt.tag() == StmtTag::Var => self.add_unreachable(stmt.span_without_export(), stmt.file()),
            false => self.add_unreachable(stmt.span(), stmt.file()),
        }
    }

    /// The `BlockStatement` that is the body of a function can always be reached.
    fn enter_function(&mut self, func: Func<'a>) {
        if self.range.is_some() && func.kind() != FnKind::StaticBlock && func.body_statements().is_some() {
            self.report_range(None);
        }
    }

    /// The instance fields of a subclass are never created if its constructor does not call
    /// `super()`.
    fn exit_member(&mut self, member: Member<'a>) {
        if !is_constructor(member) {
            return;
        }
        let has_super_call = self.constructors.pop().unwrap_or(true);
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
                self.add_unreachable(element.span(), element.file());
            }
        }
    }

    fn enter_super(&mut self, e: Expr<'a>) {
        if let Node::Expr(parent) = e.parent()
            && matches!(parent.kind(), ExprKind::Call(call) if call.callee() == e)
            && let Some(has_super_call) = self.constructors.last_mut()
        {
            *has_super_call = true;
        }
    }

    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Stmt(stmt) => self.enter_statement(stmt),
            Node::Func(func) => self.enter_function(func),
            Node::Member(member) if is_constructor(member) => self.constructors.push(false),
            Node::Expr(e) => self.enter_super(e),
            _ => {}
        }
    }

    /// Enters what is in `self.unreachable`. What is entered between a range and a statement matters only if the statement is
    /// in the range or follows it at once, and then all of that is in the range.
    #[inline(never)]
    fn enter_what_is_unreachable(&mut self) {
        let mut unreachable = std::mem::take(&mut self.unreachable);
        utils::sort::sort_unstable_by_key(&mut unreachable, |it| (it.span().start, Reverse(it.span().end)));
        let (mut entered, mut end) = (Entered(Vec::new()), 0);
        for stmt in unreachable {
            if stmt.span().start >= end {
                end = stmt.span().end;
                walk_node(Node::Stmt(stmt), &mut entered);
            }
        }
        sort_as_entered(&mut entered.0);
        entered.0.into_iter().for_each(|node| self.enter(node));
    }
}

/// What is found if all statements and functions of `file` are entered.
fn found_in_all<'a>(file: &'a File<'a>) -> Vec<Span> {
    let statements = KINDS.iter().flat_map(|&kind| file.stmts_of_kind(kind)).map(Node::Stmt);
    let mut all: Vec<Node<'a>> = statements.chain(file.funcs().map(Node::Func)).collect();
    sort_as_entered(&mut all);
    let mut state = State::default();
    all.into_iter().for_each(|node| state.enter(node));
    state.report_range(None);
    state.found
}

/// Explains why the statements in `range` are unreachable.
fn hint<'a>(range: Span, file: &'a File<'a>) -> Option<String> {
    let all = KINDS.iter().flat_map(|&kind| file.stmts_of_kind(kind));
    let first = all.filter(|it| it.span().start == range.start && !it.is_reachable()).max_by_key(|it| it.span().end)?;
    let list = match first.parent() {
        Node::File(file) => file.body(),
        Node::Func(func) => func.body_statements()?,
        Node::Case(case) => case.body(),
        Node::Stmt(block) => block.as_block()?,
        _ => return None,
    };
    // Skip back over hoisted declarations. They're unreachable too, but aren't part of `range`.
    let mut cause = list.before(first.span().start)?;
    while !cause.is_reachable() {
        cause = list.before(cause.span().start)?;
    }
    let line = file.line_of(cause.span().start);
    let (jump, around) = match cause.tag() {
        StmtTag::Return => ("return", ""),
        StmtTag::Throw => ("throw", ""),
        StmtTag::Break => ("break", ""),
        StmtTag::Continue => ("continue", ""),
        StmtTag::While | StmtTag::DoWhile | StmtTag::For => {
            return Some(format!("The loop on line {line} runs forever, or leaves by return or throw."));
        }
        StmtTag::If => ("", "if"),
        StmtTag::Switch => ("", "switch"),
        StmtTag::Try => ("", "try"),
        _ => ("", "statement"),
    };
    Some(match around {
        "" => format!("Nothing runs after the {jump} on line {line}."),
        _ => format!("Every path through the {around} on line {line} ends in return, throw, break or continue."),
    })
}

impl Rule for NoUnreachable {
    const META: Meta = Meta::eslint("no-unreachable", Kind::Problem).recommended().hints();
    const ON: On = On::new()
        .stmts(KINDS)
        .enter(STATEMENTS)
        .enter(NodeTags::FUNC)
        .enter(NodeTags::MEMBER)
        .exit(NodeTags::MEMBER)
        .enter(NodeTags::new().exprs(&[ExprTag::Super]))
        .finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnreachable
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // oxlint says nothing about the fields of a class.
        if !file.language().is_oxlint && has_constructor_without_super_call(file) {
            return On::new()
                .enter(STATEMENTS)
                .enter(NodeTags::FUNC)
                .enter(NodeTags::MEMBER)
                .exit(NodeTags::MEMBER)
                .enter(NodeTags::new().exprs(&[ExprTag::Super]))
                .finish();
        }
        match file.has_unreachable_statements() {
            true => On::new().stmts(KINDS).finish(),
            false => On::new(),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    #[inline]
    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if !stmt.is_reachable() {
            cx.state.unreachable.push(stmt);
        }
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.enter(node);
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Member(member) = node {
            cx.state.exit_member(member);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let is_entered_in_part = !cx.state.unreachable.is_empty();
        cx.state.enter_what_is_unreachable();
        cx.state.report_range(None);
        debug_assert!(!is_entered_in_part || cx.state.found == found_in_all(cx.file()));
        for &range in &cx.state.found {
            cx.report(range, UNREACHABLE_CODE).hint_with(|| hint(range, cx.file()));
        }
    }
}
