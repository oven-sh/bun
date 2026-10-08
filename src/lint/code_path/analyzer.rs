//! ESLint's `CodePathAnalyzer`, driven by the walk over the nodes of this crate.
//!
//! ESLint decides what to do from the type of an ESTree node and from which child of its parent
//! it is. Each function here that has the name of one of ESLint's does the same from the nodes
//! that exist here. For an ESTree node that does not exist here and that matters to the analysis
//! (`ChainExpression`, `CatchClause`, the name after a `.`), entering and leaving it is part of
//! entering or leaving the node that stands for it.
//!
//! Most nodes are nothing to the analysis. What is known about a node when it is entered is kept
//! in a few flags, so that neither its children nor leaving it have to look at it again.

use super::state::{ChoiceKind, Cx, LoopKind, State};
use super::{CodePath, Event, Origin, Segment, SegmentIds};
use crate::ast::walk::{Visitor, walk};
use crate::ast::{
    BinOp, Chain, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Key, KeyKind, Member,
    MemberKind, Node, Pat, PatTag, PropKind, Stmt, StmtKind, StmtTag, TypeKind,
};
use crate::rule::NodeTags;
use bun_sema::atom::Atom;

bitflags::bitflags! {
    /// What is known about a node that has been entered.
    #[derive(Copy, Clone, PartialEq, Eq)]
    struct Is: u16 {
        /// An expression that ESTree has as a pattern: all or a part of the target of an
        /// assignment.
        const PATTERN = 1 << 0;
        /// Part of an optional chain, up to its outermost expression.
        const IN_CHAIN = 1 << 1;
        /// It continues the optional chain that its parent is part of.
        const CONTINUES_CHAIN = 1 << 2;
        /// The outermost expression of an optional chain: ESTree has a `ChainExpression` around it.
        const CHAIN_ROOT = 1 << 3;
        /// The value of a `PropertyDefinition`.
        const FIELD_INITIALIZER = 1 << 4;
        /// All or a part of the name of a JSX element.
        const JSX_NAME = 1 << 5;
        /// Not a node of ESTree, and nothing to the analysis.
        const ABSENT = 1 << 6;
        /// Which of its children a node is matters: see `place_of_expr` and `preprocess`.
        const PLACES_CHILDREN = 1 << 7;
        /// There is something to do when it is left, besides telling what has changed.
        const HAS_EXIT = 1 << 8;
        /// There is something to do after it has been left.
        const HAS_POSTPROCESS = 1 << 9;
        /// A code path starts with it and ends after it.
        const HAS_CODE_PATH = 1 << 10;
    }
}

#[derive(Copy, Clone)]
struct Frame<'a> {
    node: Node<'a>,
    is: Is,
}

/// ESLint's `CodePathAnalyzer`.
struct Builder<'a> {
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
            Some(
                digits
                    .iter()
                    .any(|digit| !matches!(digit, b'0' | b'_' | b'n')),
            )
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

/// Whether the first child that `node` has in ESTree is an `Identifier` that does not exist here
/// and for which `isIdentifierReference` holds. It holds for every name that ESLint does not
/// know to be something else, which includes all the names in the syntax of TypeScript.
fn starts_with_identifier_reference(node: Node) -> bool {
    let is_identifier =
        |key: Option<Key>| key.is_some_and(|key| matches!(key.kind(), KeyKind::Ident(_)));
    match node {
        Node::Prop(prop) => prop.kind() == PropKind::Shorthand,
        Node::PatProp(prop) => prop.is_shorthand(),
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { .. } => true,
            TypeKind::Import { name, .. } => !name.is_empty(),
            TypeKind::Predicate { param, .. } => !param.is("this"),
            _ => false,
        },
        Node::TypeParam(_) => true,
        Node::TupleElem(element) => element.name().is_some(),
        Node::EnumMember(member) => is_identifier(member.key()),
        // The key of a `MethodDefinition` or a `PropertyDefinition` is known not to be a reference.
        Node::Member(member) => {
            let is_definition = matches!(member.parent(), Node::Class(_))
                && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT);
            !is_definition && is_identifier(member.key())
        }
        Node::Stmt(stmt) => match stmt.kind() {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Enum(_) => true,
            StmtKind::Fn(func) => !func.has_body() && func.name().is_some(),
            _ => false,
        },
        // The `const` is a `TSTypeReference`.
        Node::Expr(e) => e.tag() == ExprTag::AsConst && e.is_angle_bracket_assertion(),
        _ => false,
    }
}

/// `isIdentifierReference` for an identifier that is bound.
fn is_binding_a_reference(pat: Pat) -> bool {
    match pat.parent() {
        Node::PatProp(prop) => !prop.is_rest(),
        Node::PatElem(element) => element.default().is_some(),
        Node::Param(param) => !param.is_rest(),
        _ => false,
    }
}

/// What `e` is because of which child of `parent` it is.
fn place_of_expr<'a>(e: Expr<'a>, parent: Frame<'a>) -> Is {
    match parent.node {
        Node::Expr(parent_expr) => match parent_expr.kind() {
            ExprKind::Assign { target, .. } if target == e => Is::PATTERN,
            ExprKind::Array(_) | ExprKind::Spread(_) => parent.is & Is::PATTERN,
            // ESTree has one `SequenceExpression` for `a, b, c`.
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                ..
            } if left == e
                && matches!(
                    e.kind(),
                    ExprKind::Binary {
                        op: BinOp::Comma,
                        ..
                    }
                )
                && !e.is_parenthesized() =>
            {
                Is::ABSENT | Is::PLACES_CHILDREN
            }
            ExprKind::Jsx(jsx) if jsx.tag() == Some(e) || jsx.close_tag() == Some(e) => {
                Is::JSX_NAME
            }
            ExprKind::Dot { .. } if parent.is.contains(Is::JSX_NAME) => Is::JSX_NAME,
            _ if parent.is.contains(Is::IN_CHAIN)
                && chain_operand(parent_expr) == Some(e)
                && !e.is_parenthesized() =>
            {
                Is::CONTINUES_CHAIN
            }
            _ => Is::empty(),
        },
        Node::Prop(prop) if prop.value() == Some(e) => parent.is & Is::PATTERN,
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if matches!(left.kind(), StmtKind::Expr(left) if left == e) => {
                Is::PATTERN
            }
            _ => Is::empty(),
        },
        Node::Member(member) if member.init() == Some(e) => {
            Is::FIELD_INITIALIZER | Is::HAS_POSTPROCESS
        }
        _ => Is::empty(),
    }
}

/// What is known about a parameter or a part of a pattern, which ESTree has as an
/// `AssignmentPattern` if it has a default value.
#[inline]
fn with_default(default: Option<Expr>) -> Is {
    match default {
        Some(_) => Is::HAS_EXIT | Is::PLACES_CHILDREN,
        None => Is::empty(),
    }
}

impl<'a> Builder<'a> {
    // ───────────────────────────── events ─────────────────────────────

    /// `forwardCurrentToHead`
    #[inline]
    fn forward_current_to_head(&mut self, cx: &mut Cx<'_, 'a>) {
        if let Some(state) = self.states.last_mut()
            && state.current_segments[..] != *state.head_segments()
        {
            Self::forward(state, cx);
        }
    }

    #[cold]
    fn forward(state: &mut State, cx: &mut Cx<'_, 'a>) {
        let (file, store, node) = (cx.file, cx.store(), cx.node_of_event());
        let head = SegmentIds::from_slice(state.head_segments());
        let current = std::mem::replace(&mut state.current_segments, head.clone());
        for (i, &id) in current.iter().enumerate() {
            if head.get(i) != Some(&id) {
                let segment = Segment::new(file, id);
                (cx.emit)(match store.is_reachable(id) {
                    true => Event::SegmentEnd(segment, node),
                    false => Event::UnreachableSegmentEnd(segment, node),
                });
            }
        }
        for (i, &id) in head.iter().enumerate() {
            if current.get(i) != Some(&id) {
                store.mark_used(id);
                let segment = Segment::new(file, id);
                (cx.emit)(match store.is_reachable(id) {
                    true => Event::SegmentStart(segment, node),
                    false => Event::UnreachableSegmentStart(segment, node),
                });
            }
        }
    }

    fn start_code_path(&mut self, origin: Origin, cx: &mut Cx<'_, 'a>) {
        self.forward_current_to_head(cx);
        let store = cx.store();
        let path = store.new_code_path(origin, self.states.last().map(|upper| upper.path));
        let mut state = self.spare_states.pop().unwrap_or_else(State::new);
        state.reset(store, path);
        self.states.push(state);
        let node = cx.node_of_event();
        (cx.emit)(Event::CodePathStart(CodePath::new(cx.file, path), node));
    }

    fn end_code_path(&mut self, cx: &mut Cx<'_, 'a>) {
        let Some(mut state) = self.states.pop() else {
            return;
        };
        let (store, node) = (cx.store(), cx.node_of_event());
        state.make_final(store);
        // `leaveFromCurrentSegment`
        for id in state.current_segments.drain(..) {
            let segment = Segment::new(cx.file, id);
            (cx.emit)(match store.is_reachable(id) {
                true => Event::SegmentEnd(segment, node),
                false => Event::UnreachableSegmentEnd(segment, node),
            });
        }
        (cx.emit)(Event::CodePathEnd(CodePath::new(cx.file, state.path), node));
        self.spare_states.push(state);
    }

    #[inline]
    fn is_before_first_throwable(&self, cx: &Cx<'_, 'a>) -> bool {
        self.states
            .last()
            .is_some_and(|state| state.is_before_first_throwable(cx.store()))
    }

    /// Leaving a node that may throw. If it is an `Identifier` of ESTree for which
    /// `isIdentifierReference` holds, what changes is told to the rules with the next node.
    #[inline]
    fn leave_throwable(&mut self, cx: &Cx<'_, 'a>) {
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
                StmtKind::ForIn { left, expr, body }
                | StmtKind::ForOf {
                    left, expr, body, ..
                } => {
                    if is_stmt(left) || matches!(left.kind(), StmtKind::Expr(left) if is(left)) {
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
                } else if node == Node::Pat(prop.value()) {
                    // The `AssignmentPattern` is entered here, after the key.
                    cx.node = parent.node;
                    self.forward_current_to_head(cx);
                    cx.node = node;
                }
            }
            _ => {}
        }
    }

    /// `processCodePathToEnter`, without the last step. `is`: what is known from the parent.
    /// Returns what else is known.
    fn enter_expr(
        &mut self,
        e: Expr<'a>,
        is: Is,
        parent: Option<Node<'a>>,
        cx: &mut Cx<'_, 'a>,
    ) -> Is {
        if is.contains(Is::FIELD_INITIALIZER) {
            cx.keeps_function_expression = true;
            self.start_code_path(Origin::ClassFieldInitializer, cx);
            self.forward_current_to_head(cx);
            cx.keeps_function_expression = false;
        }
        let mut more = match e.tag() {
            ExprTag::Ident
            | ExprTag::New
            | ExprTag::ImportCall
            | ExprTag::NewTarget
            | ExprTag::ImportMeta
            | ExprTag::Yield
            | ExprTag::AsConst => return Is::HAS_EXIT,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call => match e.chain() {
                Chain::No if is.contains(Is::JSX_NAME) => {
                    return Is::HAS_EXIT | Is::PLACES_CHILDREN;
                }
                Chain::No => return Is::HAS_EXIT,
                _ => Is::IN_CHAIN | Is::HAS_EXIT | Is::PLACES_CHILDREN,
            },
            ExprTag::NonNull if is.contains(Is::CONTINUES_CHAIN) || is_non_null_after_chain(e) => {
                Is::IN_CHAIN | Is::PLACES_CHILDREN
            }
            ExprTag::Array | ExprTag::Spread | ExprTag::Object if is.contains(Is::PATTERN) => {
                return Is::PLACES_CHILDREN;
            }
            ExprTag::Jsx => return Is::PLACES_CHILDREN,
            ExprTag::Fn | ExprTag::Binary | ExprTag::Assign | ExprTag::Cond => Is::empty(),
            _ => return Is::empty(),
        };
        if more.contains(Is::IN_CHAIN) && !is.contains(Is::CONTINUES_CHAIN) {
            // The `ChainExpression` is entered.
            more |= Is::CHAIN_ROOT | Is::HAS_POSTPROCESS;
            if let Some(state) = self.states.last_mut() {
                state.push_chain_context();
            }
            self.forward_current_to_head(cx);
        }
        let Some(state) = self.states.last_mut() else {
            return more;
        };
        match e.kind() {
            ExprKind::Fn(func) if has_code_path(func) => {
                self.start_code_path(Origin::Function, cx);
                more |= Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS;
            }
            ExprKind::Call(call) => {
                if call.is_optional() {
                    state.make_optional_node();
                    if call.args().is_empty() {
                        more |= Is::HAS_POSTPROCESS;
                    }
                }
            }
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => {
                if chain == Chain::Start {
                    state.make_optional_node();
                }
            }
            ExprKind::Binary { op, .. } => {
                if let Some(kind) = choice_kind(op) {
                    state.push_choice_context(kind, is_forking_by_true_or_false(e, parent));
                    more |= Is::HAS_EXIT | Is::PLACES_CHILDREN;
                } else if op == BinOp::Comma {
                    more |= Is::PLACES_CHILDREN;
                }
            }
            ExprKind::Assign { op, .. } => {
                more |= Is::PLACES_CHILDREN;
                if let Some(kind) = op.and_then(choice_kind) {
                    state.push_choice_context(kind, is_forking_by_true_or_false(e, parent));
                    more |= Is::HAS_EXIT;
                } else if op.is_none() && is.contains(Is::PATTERN) {
                    more |= Is::HAS_EXIT;
                }
            }
            ExprKind::Cond { .. } => {
                state.push_choice_context(ChoiceKind::Test, false);
                more |= Is::HAS_EXIT | Is::PLACES_CHILDREN;
            }
            _ => {}
        }
        more
    }

    /// `processCodePathToEnter`, without the last step. Returns what is known about `stmt`.
    fn enter_stmt(&mut self, stmt: Stmt<'a>, parent: Option<Node<'a>>, cx: &mut Cx<'_, 'a>) -> Is {
        let Some(state) = self.states.last_mut() else {
            return Is::empty();
        };
        let kind = match stmt.tag() {
            StmtTag::Break | StmtTag::Continue | StmtTag::Return | StmtTag::Throw => {
                return Is::HAS_EXIT;
            }
            StmtTag::If => {
                state.push_choice_context(ChoiceKind::Test, false);
                return Is::HAS_EXIT | Is::PLACES_CHILDREN;
            }
            StmtTag::While => LoopKind::While,
            StmtTag::DoWhile => LoopKind::DoWhile,
            StmtTag::For => LoopKind::For,
            StmtTag::ForIn => LoopKind::ForIn,
            StmtTag::ForOf => LoopKind::ForOf,
            StmtTag::Fn | StmtTag::Switch | StmtTag::Try | StmtTag::Labeled => match stmt.kind() {
                StmtKind::Fn(func) if has_code_path(func) => {
                    self.start_code_path(Origin::Function, cx);
                    return Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS;
                }
                StmtKind::Switch { cases, .. } => {
                    let has_case = cases.iter().any(|case| !case.is_default());
                    state.push_switch_context(has_case, label_of(parent));
                    return Is::HAS_EXIT;
                }
                StmtKind::Try { finalizer, .. } => {
                    state.push_try_context(finalizer.is_some());
                    return Is::HAS_EXIT | Is::PLACES_CHILDREN;
                }
                StmtKind::Labeled { label, body } if !is_breakable(body) => {
                    state.push_break_context(false, Some(label.atom()));
                    return Is::HAS_EXIT;
                }
                _ => return Is::empty(),
            },
            _ => return Is::empty(),
        };
        state.push_loop_context(kind, label_of(parent));
        Is::HAS_EXIT | Is::PLACES_CHILDREN
    }

    /// `enterNode`, up to where it calls the listeners of the node.
    fn enter(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let cx = &mut Cx::new(self.file, node, emit);
        let parent = self.ancestors.last().copied();
        let mut is = Is::empty();
        if let Some(parent) = parent
            && parent.is.contains(Is::PLACES_CHILDREN)
        {
            match node {
                Node::Expr(e) => is = place_of_expr(e, parent),
                Node::Prop(_) if parent.is.contains(Is::PATTERN) => {
                    is = Is::PATTERN | Is::PLACES_CHILDREN
                }
                _ => {}
            }
            if is.contains(Is::ABSENT) {
                self.ancestors.push(Frame { node, is });
                return;
            }
            self.preprocess(parent, cx);
        }
        let parent = parent.map(|it| it.node);
        is |= match node {
            Node::Expr(e) => self.enter_expr(e, is, parent, cx),
            Node::Stmt(stmt) => self.enter_stmt(stmt, parent, cx),
            Node::Pat(pat) => match pat.tag() {
                PatTag::Ident => Is::HAS_EXIT,
                _ => Is::empty(),
            },
            Node::File(_) => {
                self.start_code_path(Origin::Program, cx);
                Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
            }
            Node::Func(func) => match parent {
                Some(Node::Member(_)) if has_code_path(func) => {
                    self.start_code_path(Origin::Function, cx);
                    Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
                }
                _ => Is::empty(),
            },
            Node::Member(member) => match member.kind() {
                MemberKind::StaticBlock => {
                    self.start_code_path(Origin::ClassStaticBlock, cx);
                    Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
                }
                MemberKind::Property
                    if member.init().is_some() && is_property_definition(member) =>
                {
                    Is::PLACES_CHILDREN
                }
                _ => Is::empty(),
            },
            Node::Case(case) => {
                let is_first = matches!(parent, Some(Node::Stmt(parent))
                    if matches!(parent.kind(), StmtKind::Switch { cases, .. } if cases.first() == Some(case)));
                if !is_first && let Some(state) = self.states.last_mut() {
                    state.fork_path(cx.store());
                }
                Is::HAS_EXIT | Is::PLACES_CHILDREN
            }
            Node::Param(param) => with_default(param.default()),
            Node::PatElem(element) => with_default(element.default()),
            Node::PatProp(prop) => with_default(prop.default()),
            _ => Is::empty(),
        };
        self.ancestors.push(Frame { node, is });
        self.forward_current_to_head(cx);
        if self.is_before_first_throwable(cx) && starts_with_identifier_reference(node) {
            self.leave_throwable(cx);
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
            Some(Node::Expr(parent)) => !matches!(parent.tag(), ExprTag::Array | ExprTag::Spread),
            Some(Node::Prop(parent)) => parent.kind() != PropKind::Spread,
            _ => true,
        }
    }

    /// `processCodePathToExit`. Returns ESLint's `dontForward`.
    fn leave_expr(&mut self, e: Expr<'a>, is: Is, cx: &mut Cx<'_, 'a>) -> bool {
        let store = cx.store();
        let Some(state) = self.states.last_mut() else {
            return false;
        };
        match e.tag() {
            ExprTag::Ident => {
                if state.is_before_first_throwable(store) && self.is_identifier_reference(is) {
                    self.leave_throwable(cx);
                }
                return true;
            }
            ExprTag::Dot => {
                if is.contains(Is::JSX_NAME) {
                    return false;
                }
                // The name is a node of ESTree, which is entered and left here.
                if is.contains(Is::IN_CHAIN) && e.is_optional() {
                    state.make_optional_right(store);
                    self.forward_current_to_head(cx);
                }
                self.leave_throwable(cx);
            }
            // The names of a `MetaProperty` are references to ESLint.
            ExprTag::Call
            | ExprTag::ImportCall
            | ExprTag::Index
            | ExprTag::New
            | ExprTag::NewTarget
            | ExprTag::ImportMeta => state.make_first_throwable_path_in_try_or_catch_block(store),
            ExprTag::Cond | ExprTag::Binary => state.pop_choice_context(store),
            ExprTag::Assign => match matches!(e.kind(), ExprKind::Assign { op: None, .. }) {
                true => state.pop_fork_context(store),
                false => state.pop_choice_context(store),
            },
            ExprTag::Yield => state.make_yield(store),
            // The `const` is a `TSTypeReference`, whose name is an `Identifier`.
            ExprTag::AsConst => {
                if state.is_before_first_throwable(store) && !e.is_angle_bracket_assertion() {
                    self.leave_throwable(cx);
                }
            }
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
            StmtKind::Labeled { .. } => state.pop_break_context_of_label(store),
            _ => {}
        }
        false
    }

    /// `leaveNode`, before it calls the listeners of the node.
    fn before_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let cx = &mut Cx::new(self.file, node, emit);
        let is = self.ancestors.last().map_or(Is::empty(), |frame| frame.is);
        if is.contains(Is::ABSENT) {
            return;
        }
        let store = cx.store();
        let dont_forward = is.contains(Is::HAS_EXIT)
            && match node {
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
                    if self.is_before_first_throwable(cx) && is_binding_a_reference(pat) {
                        self.leave_throwable(cx);
                    }
                    true
                }
                // The `AssignmentPattern` is left.
                Node::Param(_) | Node::PatElem(_) | Node::PatProp(_) => {
                    if let Some(state) = self.states.last_mut() {
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
    fn after_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let Some(Frame { is, .. }) = self.ancestors.pop() else {
            return;
        };
        if !is.contains(Is::HAS_POSTPROCESS) {
            return;
        }
        let cx = &mut Cx::new(self.file, node, emit);
        if is.contains(Is::HAS_CODE_PATH) {
            self.end_code_path(cx);
        }
        if is.contains(Is::IN_CHAIN)
            && let Some(state) = self.states.last_mut()
        {
            // The other case of `makeOptionalRight` is in `preprocess`.
            let is_call_without_arguments = matches!(node, Node::Expr(e)
                if matches!(e.kind(), ExprKind::Call(call) if call.is_optional() && call.args().is_empty()));
            if is_call_without_arguments {
                state.make_optional_right(cx.store());
            }
            // The `ChainExpression` is left.
            if is.contains(Is::CHAIN_ROOT) {
                state.pop_chain_context(cx.store());
                self.forward_current_to_head(cx);
            }
        }
        if is.contains(Is::FIELD_INITIALIZER) {
            cx.keeps_function_expression = true;
            self.end_code_path(cx);
        }
    }
}

// ───────────────────────────── the walk ─────────────────────────────

/// A step of the walk of a file for the rules.
#[derive(Copy, Clone)]
pub(crate) enum Step<'a> {
    /// Call the listeners for entering the node.
    Enter(Node<'a>),
    /// Call the listeners for leaving the node.
    Exit(Node<'a>),
    /// Call the listeners for the event.
    Event(Event<'a>),
}

struct Recorder<'a> {
    builder: Builder<'a>,
    steps: Vec<Step<'a>>,
    enter: NodeTags,
    exit: NodeTags,
}

impl<'a> Visitor<'a> for Recorder<'a> {
    fn enter(&mut self, node: Node<'a>) {
        let steps = &mut self.steps;
        self.builder
            .enter(node, &mut |event| steps.push(Step::Event(event)));
        if self.enter.contains(node) {
            steps.push(Step::Enter(node));
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        let steps = &mut self.steps;
        self.builder
            .before_exit(node, &mut |event| steps.push(Step::Event(event)));
        if self.exit.contains(node) {
            steps.push(Step::Exit(node));
        }
        self.builder
            .after_exit(node, &mut |event| steps.push(Step::Event(event)));
    }
}

/// Walks and analyzes `file`. Returns what to tell the rules, in order: the events, and the nodes
/// of the kinds `enter` and `exit`, which are those that a rule listens for.
///
/// Like ESLint, it analyzes the whole file before the first listener is called: a rule sees the
/// finished graph from the first event on, with the segments that follow the current one and
/// those that lead back to it from the end of a loop.
pub(crate) fn steps<'a>(file: &'a File<'a>, enter: NodeTags, exit: NodeTags) -> Steps<'a> {
    file.lazy.code_paths.clear();
    let mut recorder = Recorder {
        builder: Builder {
            file,
            states: Vec::new(),
            spare_states: Vec::new(),
            ancestors: Vec::new(),
        },
        steps: Vec::new(),
        enter,
        exit,
    };
    walk(file, &mut recorder);
    file.lazy.code_paths.finish();
    Steps {
        file,
        steps: recorder.steps.into_iter(),
    }
}

/// See [`steps`].
pub(crate) struct Steps<'a> {
    file: &'a File<'a>,
    steps: std::vec::IntoIter<Step<'a>>,
}

impl<'a> Iterator for Steps<'a> {
    type Item = Step<'a>;

    #[inline]
    fn next(&mut self) -> Option<Step<'a>> {
        let step = self.steps.next()?;
        if let Step::Event(event) = step {
            self.file.lazy.code_paths.follow(event);
        }
        Some(step)
    }
}

/// [`steps`] for a caller that walks the file itself.
pub(crate) struct Analyzer<'a> {
    steps: std::iter::Peekable<Steps<'a>>,
}

impl<'a> Analyzer<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Analyzer {
            steps: steps(file, NodeTags::ALL, NodeTags::ALL).peekable(),
        }
    }

    /// Emits the events up to the next node.
    fn events(&mut self, emit: &mut dyn FnMut(Event<'a>)) {
        while let Some(Step::Event(event)) =
            self.steps.next_if(|step| matches!(step, Step::Event(_)))
        {
            emit(event);
        }
    }

    /// ESLint's `enterNode`, up to where it calls the listeners of the node.
    pub(crate) fn enter(&mut self, _: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        self.events(emit);
        self.steps.next();
    }

    /// `leaveNode`, before it calls the listeners of the node.
    pub(crate) fn before_exit(&mut self, _: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        self.events(emit);
        self.steps.next();
    }

    /// `leaveNode`, after it has called them.
    pub(crate) fn after_exit(&mut self, _: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        self.events(emit);
    }
}
