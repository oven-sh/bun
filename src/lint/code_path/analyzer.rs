//! ESLint's `CodePathAnalyzer`, driven by the walk over the nodes of this crate.
//!
//! ESLint decides what to do from the type of an ESTree node and from which child of its parent
//! it is. Each function here that has the name of one of ESLint's does the same from the nodes
//! that exist here. For an ESTree node that does not exist here and that matters to the analysis
//! (`ChainExpression`, `CatchClause`, the name after a `.`), entering and leaving it is part of
//! entering or leaving the node that stands for it.

use super::state::{ChoiceKind, Cx, LoopKind, State};
use super::{CodePath, Event, Origin, Segment, SegmentIds};
use crate::ast::{
    BinOp, Chain, Expr, ExprKind, File, Flags, FnKind, Func, Member, MemberKind, Node, Pat, PatKind,
    PropKind, Stmt, StmtKind, StmtTag,
};
use bun_sema::atom::Atom;

bitflags::bitflags! {
    /// What is known about a node from its ancestors.
    #[derive(Copy, Clone, PartialEq, Eq)]
    struct Is: u8 {
        /// An expression that ESTree has as a pattern: all or a part of the target of an
        /// assignment.
        const PATTERN = 1 << 0;
        /// The `Stmt` around an expression that is the `left` of a `for`-`in` or `for`-`of`.
        const LEFT_OF_FOR = 1 << 1;
        /// Part of an optional chain, up to its outermost expression.
        const IN_CHAIN = 1 << 2;
        /// The outermost expression of an optional chain: ESTree has a `ChainExpression` around it.
        const CHAIN_ROOT = 1 << 3;
        /// The value of a `PropertyDefinition`.
        const FIELD_INITIALIZER = 1 << 4;
        /// All or a part of the name of a JSX element.
        const JSX_NAME = 1 << 5;
        /// Not a node of ESTree, and nothing to the analysis.
        const ABSENT = 1 << 6;
        /// The `Stmt` around an expression in the head of a `for`, `for`-`in` or `for`-`of`.
        /// Entering it is entering the expression. Leaving it is nothing.
        const WRAPPER = 1 << 7;
    }
}

#[derive(Copy, Clone)]
struct Frame<'a> {
    node: Node<'a>,
    is: Is,
}

/// ESLint's `CodePathAnalyzer`.
pub(crate) struct Analyzer<'a> {
    file: &'a File<'a>,
    /// The states of the code paths that have started and not ended.
    states: Vec<State>,
    /// Those of code paths that have ended, to be used again.
    spare_states: Vec<State>,
    /// The nodes that have been entered and not left.
    ancestors: Vec<Frame<'a>>,
}

fn choice_kind(op: BinOp) -> Option<ChoiceKind> {
    match op {
        BinOp::And => Some(ChoiceKind::And),
        BinOp::Or => Some(ChoiceKind::Or),
        BinOp::Nullish => Some(ChoiceKind::Nullish),
        _ => None,
    }
}

/// `isForkingByTrueOrFalse`
fn is_forking_by_true_or_false<'a>(e: Expr<'a>, parent: Option<Node<'a>>) -> bool {
    match parent {
        Some(Node::Expr(parent)) => match parent.kind() {
            ExprKind::Cond { test, .. } => test == e,
            ExprKind::Binary { op, .. } | ExprKind::Assign { op: Some(op), .. } => {
                choice_kind(op).is_some()
            }
            _ => false,
        },
        Some(Node::Stmt(parent)) => match parent.kind() {
            StmtKind::If { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::DoWhile { test, .. }
            | StmtKind::For {
                test: Some(test), ..
            } => test == e,
            _ => false,
        },
        _ => false,
    }
}

/// `getBooleanValueIfSimpleConstant`
fn boolean_value_if_simple_constant(e: Expr) -> Option<bool> {
    match e.kind() {
        ExprKind::True | ExprKind::Regex(_) => Some(true),
        ExprKind::False | ExprKind::Null => Some(false),
        ExprKind::Number(value) => Some(value != 0.0 && !value.is_nan()),
        ExprKind::String(value) => Some(!value.bytes().is_empty()),
        ExprKind::BigInt(_) => {
            let digits = match e.text() {
                [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', digits @ ..] => digits,
                digits => digits,
            };
            Some(digits.iter().any(|digit| !matches!(digit, b'0' | b'_' | b'n')))
        }
        _ => None,
    }
}

/// `getLabel`
fn label_of(parent: Option<Node>) -> Option<Atom> {
    match parent {
        Some(Node::Stmt(parent)) => match parent.kind() {
            StmtKind::Labeled { label, .. } => Some(label.atom()),
            _ => None,
        },
        _ => None,
    }
}

/// `breakableTypePattern`
fn is_breakable(stmt: Stmt) -> bool {
    stmt.is_loop() || stmt.tag() == StmtTag::Switch
}

/// What an expression continues, if it is part of an optional chain.
fn chain_operand(e: Expr) -> Option<Expr> {
    match e.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        ExprKind::Call(call) => Some(call.callee()),
        ExprKind::NonNull(operand) => Some(operand),
        _ => None,
    }
}

/// Whether the `!` of `e` directly follows an optional chain, as in `a?.b!`.
fn is_non_null_after_chain(e: Expr) -> bool {
    let mut e = e;
    while let ExprKind::NonNull(operand) = e.kind() {
        if operand.is_parenthesized() {
            return false;
        }
        e = operand;
    }
    e.chain() != Chain::No
}

/// Whether ESLint starts a code path for `func`.
fn has_code_path(func: Func) -> bool {
    func.has_body() && func.kind() != FnKind::StaticBlock
}

/// Whether `member` is a `PropertyDefinition`.
fn is_property_definition(member: Member) -> bool {
    member.kind() == MemberKind::Property
        && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
        && matches!(member.parent(), Node::Class(_))
}

impl<'a> Analyzer<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Analyzer {
            file,
            states: Vec::new(),
            spare_states: Vec::new(),
            ancestors: Vec::new(),
        }
    }

    // ───────────────────────────── events ─────────────────────────────

    /// `forwardCurrentToHead`
    fn forward_current_to_head(&mut self, cx: &mut Cx<'_, 'a>) {
        let (file, store) = (cx.file, cx.store());
        let Some(state) = self.states.last() else {
            return;
        };
        let head = state.head_segments();
        if store.is_current(state.path, head) {
            return;
        }
        let current = store.current_segments(state.path);
        for (i, &id) in current.iter().enumerate() {
            if head.get(i) != Some(&id) {
                let segment = Segment::new(file, id);
                (cx.emit)(match store.is_reachable(id) {
                    true => Event::SegmentEnd(segment, cx.node),
                    false => Event::UnreachableSegmentEnd(segment, cx.node),
                });
            }
        }
        store.set_current_segments(state.path, head);
        for (i, &id) in head.iter().enumerate() {
            if current.get(i) != Some(&id) {
                store.mark_used(id);
                let segment = Segment::new(file, id);
                (cx.emit)(match store.is_reachable(id) {
                    true => Event::SegmentStart(segment, cx.node),
                    false => Event::UnreachableSegmentStart(segment, cx.node),
                });
            }
        }
    }

    /// `leaveFromCurrentSegment`
    fn leave_from_current_segment(path: u32, cx: &mut Cx<'_, 'a>) {
        let store = cx.store();
        for id in store.current_segments(path) {
            let segment = Segment::new(cx.file, id);
            (cx.emit)(match store.is_reachable(id) {
                true => Event::SegmentEnd(segment, cx.node),
                false => Event::UnreachableSegmentEnd(segment, cx.node),
            });
        }
        store.set_current_segments(path, &SegmentIds::new());
    }

    fn start_code_path(&mut self, origin: Origin, cx: &mut Cx<'_, 'a>) {
        self.forward_current_to_head(cx);
        let store = cx.store();
        let path = store.new_code_path(origin, self.states.last().map(|upper| upper.path));
        let mut state = self.spare_states.pop().unwrap_or_else(State::new);
        state.reset(store, path);
        self.states.push(state);
        (cx.emit)(Event::CodePathStart(CodePath::new(cx.file, path), cx.node));
    }

    fn end_code_path(&mut self, cx: &mut Cx<'_, 'a>) {
        let Some(mut state) = self.states.pop() else {
            return;
        };
        state.make_final(cx.store());
        Self::leave_from_current_segment(state.path, cx);
        (cx.emit)(Event::CodePathEnd(CodePath::new(cx.file, state.path), cx.node));
        self.spare_states.push(state);
    }

    /// Leaving an `Identifier` of ESTree for which `isIdentifierReference` holds. What it changes
    /// is told to the rules with the next node.
    fn leave_identifier_reference(&mut self, cx: &Cx<'_, 'a>) {
        if let Some(state) = self.states.last_mut() {
            state.make_first_throwable_path_in_try_or_catch_block(cx.store());
        }
    }

    // ───────────────────────────── entering ─────────────────────────────

    /// `preprocess`: what follows from which child of `parent` the node `cx.node` is.
    fn preprocess(&mut self, parent: Frame<'a>, cx: &mut Cx<'_, 'a>) {
        let (store, node) = (cx.store(), cx.node);
        let Some(state) = self.states.last_mut() else {
            return;
        };
        let is = |child: Expr<'a>| node == Node::Expr(child);
        let is_stmt = |child: Stmt<'a>| node == Node::Stmt(child);
        let fork_for_default = |state: &mut State| {
            state.push_fork_context();
            state.fork_bypass_path(store);
            state.fork_path(store);
        };
        match parent.node {
            Node::Expr(parent_expr) => match parent_expr.kind() {
                ExprKind::Call(call) => {
                    if call.is_optional() && call.args().first().is_some_and(is) {
                        state.make_optional_right(store);
                    }
                }
                ExprKind::Index {
                    index,
                    chain: Chain::Start,
                    ..
                } => {
                    if is(index) {
                        state.make_optional_right(store);
                    }
                }
                ExprKind::Binary { op, right, .. } => {
                    if choice_kind(op).is_some() && is(right) {
                        state.make_logical_right(store);
                    }
                }
                ExprKind::Assign {
                    op: Some(op),
                    value,
                    ..
                } => {
                    if choice_kind(op).is_some() && is(value) {
                        state.make_logical_right(store);
                    }
                }
                ExprKind::Assign {
                    op: None, value, ..
                } => {
                    if parent.is.contains(Is::PATTERN) && is(value) {
                        fork_for_default(state);
                    }
                }
                ExprKind::Cond { yes, no, .. } => {
                    if is(yes) {
                        state.make_if_consequent(store);
                    } else if is(no) {
                        state.make_if_alternate(store);
                    }
                }
                _ => {}
            },
            Node::Stmt(parent_stmt) => match parent_stmt.kind() {
                StmtKind::If { yes, no, .. } => {
                    if is_stmt(yes) {
                        state.make_if_consequent(store);
                    } else if no.is_some_and(is_stmt) {
                        state.make_if_alternate(store);
                    }
                }
                StmtKind::Try {
                    param,
                    handler,
                    finalizer,
                    ..
                } => {
                    let starts_catch_clause = match param {
                        Some(param) => node == Node::VarDecl(param),
                        None => handler.is_some_and(is_stmt),
                    };
                    if starts_catch_clause {
                        state.make_catch_block(store);
                        if let Some(handler) = handler {
                            cx.node = Node::Stmt(handler);
                            self.forward_current_to_head(cx);
                            cx.node = node;
                        }
                    } else if finalizer.is_some_and(is_stmt) {
                        state.make_finally_block(store);
                    }
                }
                StmtKind::While { test, body } => {
                    if is(test) {
                        state.make_while_test(store, boolean_value_if_simple_constant(test));
                    } else if is_stmt(body) {
                        state.make_while_body(store);
                    }
                }
                StmtKind::DoWhile { body, test } => {
                    if is_stmt(body) {
                        state.make_do_while_body(store);
                    } else if is(test) {
                        state.make_do_while_test(store, boolean_value_if_simple_constant(test));
                    }
                }
                StmtKind::For {
                    test, update, body, ..
                } => {
                    if let Some(test) = test.filter(|&test| is(test)) {
                        state.make_for_test(store, boolean_value_if_simple_constant(test));
                    } else if update.is_some_and(is) {
                        state.make_for_update(store);
                    } else if is_stmt(body) {
                        state.make_for_body(cx);
                    }
                }
                StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                    if is_stmt(left) {
                        state.make_for_in_of_left(store);
                    } else if is(expr) {
                        state.make_for_in_of_right(store);
                    } else if is_stmt(body) {
                        state.make_for_in_of_body(cx);
                    }
                }
                _ => {}
            },
            Node::Case(case) => {
                if case.body().first().is_some_and(is_stmt) {
                    state.make_switch_case_body(store, false, case.is_default());
                }
            }
            Node::Param(param) => {
                if param.default().is_some_and(is) {
                    fork_for_default(state);
                }
            }
            Node::PatElem(element) => {
                if element.default().is_some_and(is) {
                    fork_for_default(state);
                }
            }
            Node::PatProp(prop) => {
                if prop.default().is_some_and(is) {
                    fork_for_default(state);
                }
            }
            _ => {}
        }
    }

    /// What `e` is because of where it is.
    fn place_of_expr(e: Expr<'a>, parent: Frame<'a>) -> Is {
        let mut is = Is::empty();
        match parent.node {
            Node::Expr(parent_expr) => match parent_expr.kind() {
                ExprKind::Assign { target, .. } if target == e => is |= Is::PATTERN,
                ExprKind::Array(_) | ExprKind::Spread(_) => is |= parent.is & Is::PATTERN,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } if left == e
                    && matches!(e.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
                    && !e.is_parenthesized() =>
                {
                    is |= Is::ABSENT;
                }
                ExprKind::Jsx(jsx) if jsx.tag() == Some(e) || jsx.close_tag() == Some(e) => {
                    is |= Is::JSX_NAME;
                }
                ExprKind::Dot { .. } => is |= parent.is & Is::JSX_NAME,
                _ => {}
            },
            Node::Prop(prop) if prop.value() == Some(e) => is |= parent.is & Is::PATTERN,
            Node::Stmt(_) if parent.is.contains(Is::LEFT_OF_FOR) => is |= Is::PATTERN,
            Node::Member(member) if member.init() == Some(e) && is_property_definition(member) => {
                is |= Is::FIELD_INITIALIZER;
            }
            _ => {}
        }
        let continues_chain = || {
            parent.is.contains(Is::IN_CHAIN)
                && matches!(parent.node, Node::Expr(parent) if chain_operand(parent) == Some(e))
                && !e.is_parenthesized()
        };
        match e.kind() {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } if chain == Chain::No => {}
            ExprKind::Call(call) if call.chain() == Chain::No => {}
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                is |= Is::IN_CHAIN;
                if !continues_chain() {
                    is |= Is::CHAIN_ROOT;
                }
            }
            ExprKind::NonNull(_) => {
                if continues_chain() {
                    is |= Is::IN_CHAIN;
                } else if is_non_null_after_chain(e) {
                    is |= Is::IN_CHAIN | Is::CHAIN_ROOT;
                }
            }
            _ => {}
        }
        is
    }

    /// `processCodePathToEnter`, without the last step.
    fn enter_expr(&mut self, e: Expr<'a>, is: Is, parent: Option<Node<'a>>, cx: &mut Cx<'_, 'a>) {
        if is.contains(Is::FIELD_INITIALIZER) {
            self.start_code_path(Origin::ClassFieldInitializer, cx);
        }
        if is.contains(Is::CHAIN_ROOT) {
            if let Some(state) = self.states.last_mut() {
                state.push_chain_context();
            }
            self.forward_current_to_head(cx);
        }
        let Some(state) = self.states.last_mut() else {
            return;
        };
        match e.kind() {
            ExprKind::Fn(func) if has_code_path(func) => {
                cx.node = Node::Func(func);
                self.start_code_path(Origin::Function, cx);
            }
            ExprKind::Call(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                if e.is_optional() {
                    state.make_optional_node();
                }
            }
            ExprKind::Binary { op, .. } | ExprKind::Assign { op: Some(op), .. } => {
                if let Some(kind) = choice_kind(op) {
                    state.push_choice_context(kind, is_forking_by_true_or_false(e, parent));
                }
            }
            ExprKind::Cond { .. } => state.push_choice_context(ChoiceKind::Test, false),
            _ => {}
        }
    }

    /// `processCodePathToEnter`, without the last step.
    fn enter_stmt(&mut self, stmt: Stmt<'a>, parent: Option<Node<'a>>, cx: &mut Cx<'_, 'a>) {
        let Some(state) = self.states.last_mut() else {
            return;
        };
        match stmt.kind() {
            StmtKind::Fn(func) if has_code_path(func) => {
                cx.node = Node::Func(func);
                self.start_code_path(Origin::Function, cx);
            }
            StmtKind::If { .. } => state.push_choice_context(ChoiceKind::Test, false),
            StmtKind::Switch { cases, .. } => {
                let has_case = cases.iter().any(|case| !case.is_default());
                state.push_switch_context(has_case, label_of(parent));
            }
            StmtKind::Try { finalizer, .. } => state.push_try_context(finalizer.is_some()),
            StmtKind::While { .. } => state.push_loop_context(LoopKind::While, label_of(parent)),
            StmtKind::DoWhile { .. } => state.push_loop_context(LoopKind::DoWhile, label_of(parent)),
            StmtKind::For { .. } => state.push_loop_context(LoopKind::For, label_of(parent)),
            StmtKind::ForIn { .. } => state.push_loop_context(LoopKind::ForIn, label_of(parent)),
            StmtKind::ForOf { .. } => state.push_loop_context(LoopKind::ForOf, label_of(parent)),
            StmtKind::Labeled { label, body } => {
                if !is_breakable(body) {
                    state.push_break_context(false, Some(label.atom()));
                }
            }
            _ => {}
        }
    }

    /// `enterNode`, up to where it calls the listeners of the node.
    pub(crate) fn enter(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let cx = &mut Cx {
            file: self.file,
            node,
            emit,
        };
        let parent = self.ancestors.last().copied();
        let mut is = Is::empty();
        if let (Node::Expr(e), Some(parent)) = (node, parent) {
            is = Self::place_of_expr(e, parent);
        }
        self.ancestors.push(Frame { node, is });
        if is.contains(Is::ABSENT) {
            return;
        }
        if let Some(parent) = parent {
            self.preprocess(parent, cx);
        }
        let parent_node = parent.map(|it| it.node);
        let mut leaves_identifier = false;
        match node {
            Node::File(_) => self.start_code_path(Origin::Program, cx),
            Node::Expr(e) => self.enter_expr(e, is, parent_node, cx),
            Node::Stmt(stmt) => {
                self.enter_stmt(stmt, parent_node, cx);
                if stmt.tag() == StmtTag::Expr
                    && let Some(Node::Stmt(parent)) = parent_node
                    && let Some(frame) = self.ancestors.last_mut()
                {
                    frame.is |= match parent.kind() {
                        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt => {
                            Is::WRAPPER | Is::LEFT_OF_FOR
                        }
                        StmtKind::For { init, .. } if init == Some(stmt) => Is::WRAPPER,
                        _ => Is::empty(),
                    };
                }
            }
            Node::Func(func) => {
                if has_code_path(func) && matches!(parent_node, Some(Node::Member(_))) {
                    self.start_code_path(Origin::Function, cx);
                }
            }
            Node::Member(member) => {
                if member.kind() == MemberKind::StaticBlock {
                    self.start_code_path(Origin::ClassStaticBlock, cx);
                }
            }
            Node::Case(case) => {
                let is_first = matches!(parent_node, Some(Node::Stmt(parent))
                    if matches!(parent.kind(), StmtKind::Switch { cases, .. } if cases.first() == Some(case)));
                if !is_first && let Some(state) = self.states.last_mut() {
                    state.fork_path(cx.store());
                }
            }
            Node::Prop(prop) => {
                if let (Some(parent), Some(frame)) = (parent, self.ancestors.last_mut()) {
                    frame.is |= parent.is & Is::PATTERN;
                }
                leaves_identifier = prop.kind() == PropKind::Shorthand;
            }
            Node::PatProp(prop) => leaves_identifier = prop.is_shorthand(),
            _ => {}
        }
        self.forward_current_to_head(cx);
        if leaves_identifier {
            self.leave_identifier_reference(cx);
        }
    }

    // ───────────────────────────── leaving ─────────────────────────────

    /// `isIdentifierReference` for an identifier that is an expression.
    fn is_identifier_reference(&self, is: Is) -> bool {
        if is.contains(Is::JSX_NAME) {
            return false;
        }
        if !is.contains(Is::PATTERN) {
            return true;
        }
        // In an `ArrayPattern` or a `RestElement` it is not.
        match self.ancestors.iter().rev().nth(1).map(|parent| parent.node) {
            Some(Node::Expr(parent)) => {
                !matches!(parent.kind(), ExprKind::Array(_) | ExprKind::Spread(_))
            }
            Some(Node::Prop(parent)) => parent.kind() != PropKind::Spread,
            _ => true,
        }
    }

    /// `isIdentifierReference` for an identifier that is bound.
    fn is_binding_a_reference(pat: Pat<'a>) -> bool {
        match pat.parent() {
            Node::PatProp(prop) => !prop.is_rest(),
            Node::PatElem(element) => element.default().is_some(),
            Node::Param(param) => !param.is_rest(),
            _ => false,
        }
    }

    /// `processCodePathToExit`. Returns ESLint's `dontForward`.
    fn leave_expr(&mut self, e: Expr<'a>, is: Is, cx: &mut Cx<'_, 'a>) -> bool {
        let store = cx.store();
        let Some(state) = self.states.last_mut() else {
            return false;
        };
        match e.kind() {
            ExprKind::Cond { .. } => state.pop_choice_context(store),
            ExprKind::Binary { op, .. } | ExprKind::Assign { op: Some(op), .. } => {
                if choice_kind(op).is_some() {
                    state.pop_choice_context(store);
                }
            }
            ExprKind::Assign { op: None, .. } => {
                if is.contains(Is::PATTERN) {
                    state.pop_fork_context(store);
                }
            }
            ExprKind::Ident(_) => {
                if state.is_before_first_throwable(store) && self.is_identifier_reference(is) {
                    self.leave_identifier_reference(cx);
                }
                return true;
            }
            ExprKind::Dot { chain, .. } => {
                if is.contains(Is::JSX_NAME) {
                    return false;
                }
                // The name is a node of ESTree, which is entered and left here.
                if chain == Chain::Start {
                    state.make_optional_right(store);
                    self.forward_current_to_head(cx);
                }
                self.leave_identifier_reference(cx);
            }
            ExprKind::Call(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::Index { .. }
            | ExprKind::New(_)
            | ExprKind::NewTarget
            | ExprKind::ImportMeta => {
                state.make_first_throwable_path_in_try_or_catch_block(store);
            }
            ExprKind::Yield { .. } => state.make_yield(store),
            _ => {}
        }
        false
    }

    /// `processCodePathToExit`. Returns ESLint's `dontForward`.
    fn leave_stmt(&mut self, stmt: Stmt<'a>, cx: &mut Cx<'_, 'a>) -> bool {
        let store = cx.store();
        let kind = stmt.kind();
        if matches!(
            kind,
            StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Return(_) | StmtKind::Throw(_)
        ) {
            self.forward_current_to_head(cx);
        }
        let Some(state) = self.states.last_mut() else {
            return false;
        };
        match kind {
            StmtKind::If { .. } => state.pop_choice_context(store),
            StmtKind::Switch { .. } => state.pop_switch_context(cx),
            StmtKind::Try { .. } => state.pop_try_context(store),
            StmtKind::Break(label) => {
                state.make_break(store, label.map(|it| it.atom()));
                return true;
            }
            StmtKind::Continue(label) => {
                state.make_continue(cx, label.map(|it| it.atom()));
                return true;
            }
            StmtKind::Return(_) => {
                state.make_return(store);
                return true;
            }
            StmtKind::Throw(_) => {
                state.make_throw(store);
                return true;
            }
            StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. } => state.pop_loop_context(cx),
            StmtKind::Labeled { body, .. } => {
                if !is_breakable(body) {
                    state.pop_break_context_of_label(store);
                }
            }
            _ => {}
        }
        false
    }

    /// The node that stands for `node` in an event.
    fn node_of_event(node: Node<'a>) -> Node<'a> {
        match node {
            Node::Expr(e) => match e.kind() {
                ExprKind::Fn(func) => Node::Func(func),
                _ => node,
            },
            Node::Stmt(stmt) => match stmt.kind() {
                StmtKind::Fn(func) => Node::Func(func),
                _ => node,
            },
            _ => node,
        }
    }

    /// `leaveNode`, before it calls the listeners of the node.
    pub(crate) fn before_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let cx = &mut Cx {
            file: self.file,
            node: Self::node_of_event(node),
            emit,
        };
        let is = self.ancestors.last().map_or(Is::empty(), |frame| frame.is);
        if is.intersects(Is::ABSENT | Is::WRAPPER) {
            return;
        }
        let store = cx.store();
        let dont_forward = match node {
            Node::Expr(e) => self.leave_expr(e, is, cx),
            Node::Stmt(stmt) => self.leave_stmt(stmt, cx),
            Node::Case(case) => match self.states.last_mut() {
                Some(state) => {
                    if case.body().is_empty() {
                        state.make_switch_case_body(store, true, case.is_default());
                    }
                    state.is_reachable(store)
                }
                None => false,
            },
            Node::Pat(pat) => {
                if matches!(pat.kind(), PatKind::Ident(_)) {
                    let is_first = (self.states.last())
                        .is_some_and(|state| state.is_before_first_throwable(store));
                    if is_first && Self::is_binding_a_reference(pat) {
                        self.leave_identifier_reference(cx);
                    }
                    true
                } else {
                    false
                }
            }
            Node::Param(_) | Node::PatElem(_) | Node::PatProp(_) => {
                let has_default = match node {
                    Node::Param(param) => param.default().is_some(),
                    Node::PatElem(element) => element.default().is_some(),
                    Node::PatProp(prop) => prop.default().is_some(),
                    _ => false,
                };
                if has_default && let Some(state) = self.states.last_mut() {
                    state.pop_fork_context(store);
                }
                false
            }
            _ => false,
        };
        if !dont_forward {
            self.forward_current_to_head(cx);
        }
    }

    /// `leaveNode`, after it has called them: `postprocess`.
    pub(crate) fn after_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let cx = &mut Cx {
            file: self.file,
            node: Self::node_of_event(node),
            emit,
        };
        let Some(Frame { is, .. }) = self.ancestors.pop() else {
            return;
        };
        match node {
            Node::File(_) => self.end_code_path(cx),
            Node::Expr(e) => {
                match e.kind() {
                    ExprKind::Fn(func) if has_code_path(func) => self.end_code_path(cx),
                    ExprKind::Call(call) if call.is_optional() && call.args().is_empty() => {
                        if let Some(state) = self.states.last_mut() {
                            state.make_optional_right(cx.store());
                        }
                    }
                    _ => {}
                }
                if is.contains(Is::CHAIN_ROOT) {
                    if let Some(state) = self.states.last_mut() {
                        state.pop_chain_context(cx.store());
                    }
                    self.forward_current_to_head(cx);
                }
                if is.contains(Is::FIELD_INITIALIZER) {
                    cx.node = node;
                    self.end_code_path(cx);
                }
            }
            Node::Stmt(stmt) => {
                if matches!(stmt.kind(), StmtKind::Fn(func) if has_code_path(func)) {
                    self.end_code_path(cx);
                }
            }
            Node::Func(func) => {
                let is_of_member =
                    matches!(self.ancestors.last(), Some(parent) if matches!(parent.node, Node::Member(_)));
                if has_code_path(func) && is_of_member {
                    self.end_code_path(cx);
                }
            }
            Node::Member(member) => {
                if member.kind() == MemberKind::StaticBlock {
                    self.end_code_path(cx);
                }
            }
            _ => {}
        }
    }
}
