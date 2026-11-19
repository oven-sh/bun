//! ESLint's `CodePathAnalyzer`, driven by a walk over this crate's nodes.
//!
//! ESLint decides what to do based on an ESTree node's type and which child of its parent it is.
//! Each function here that's named after one of ESLint's does the same with this crate's nodes.
//! Some ESTree nodes that matter to the analysis don't exist here (`ChainExpression`,
//! `CatchClause`, the name after a `.`). Entering and leaving one of those happens as part of
//! entering or leaving the node that represents it.
//!
//! Most nodes are irrelevant to the analysis. What's learned about a node on entry is saved in a
//! few flags, so that neither its children nor its exit have to inspect it again.

use super::matters::Matters;
use super::reach::Reach;
use super::state::{ChoiceKind, Cx, LoopKind, State};
use super::{CodePath, Event, Segment, SegmentIds, Store};
use crate::ast::{
    BinOp, Chain, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Key, KeyKind, MemberKind,
    Node, Pat, PatTag, PropKind, Stmt, StmtKind, StmtTag, TypeKind,
};
use crate::rule::NodeTags;
pub(super) use crate::utils::ast_utils::is_property_definition;
use bun_sema::atom::Atom;
use bun_sema::hir;

bitflags::bitflags! {
    /// Facts about a node that has been entered.
    #[derive(Copy, Clone, PartialEq, Eq)]
    struct Is: u16 {
        /// An expression that's a pattern in ESTree: all or part of an assignment target.
        const PATTERN = 1 << 0;
        /// Part of an optional chain, up to its outermost expression.
        const IN_CHAIN = 1 << 1;
        /// Continues the optional chain its parent is part of.
        const CONTINUES_CHAIN = 1 << 2;
        /// The outermost expression of an optional chain, which ESTree wraps in a
        /// `ChainExpression`.
        const CHAIN_ROOT = 1 << 3;
        /// The value of a `PropertyDefinition`.
        const FIELD_INITIALIZER = 1 << 4;
        /// All or part of a JSX element's name.
        const JSX_NAME = 1 << 5;
        /// Not an ESTree node, and irrelevant to the analysis.
        const ABSENT = 1 << 6;
        /// It matters which of its children a node is. See `flags_from_parent` and `preprocess`.
        const CHILD_POSITION_MATTERS = 1 << 7;
        /// Leaving it takes more work than just emitting pending segment changes.
        const HAS_EXIT = 1 << 8;
        /// There's work to do after it has been left.
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
pub(super) struct Builder<'s, 'a> {
    file: &'a File<'a>,
    /// Where the graphs are built.
    store: &'s Store,
    /// The states of the code paths that have started but not ended.
    pub(super) states: Vec<State>,
    /// States of ended code paths, kept for reuse.
    spare_states: Vec<State>,
    /// The nodes that have been entered but not left.
    ancestors: Vec<Frame<'a>>,
    /// True if every segment change so far has been emitted to the rules.
    is_settled: bool,
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
pub(super) fn boolean_value_if_simple_constant(e: Expr) -> Option<bool> {
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
pub(super) fn is_breakable(stmt: Stmt) -> bool {
    stmt.is_loop() || stmt.tag() == StmtTag::Switch
}

/// The sub-expression that `e` continues, if `e` is part of an optional chain.
fn chain_operand(e: Expr) -> Option<Expr> {
    match e.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        ExprKind::Call(call) => Some(call.callee()),
        ExprKind::NonNull(operand) => Some(operand),
        _ => None,
    }
}

/// True if the `!` of `e` directly follows an optional chain, as in `a?.b!`.
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

/// True if ESLint starts a code path for `func`.
pub(super) fn has_code_path(func: Func) -> bool {
    func.has_body() && func.kind() != FnKind::StaticBlock
}

/// True if `node`'s first child in ESTree is an `Identifier` that doesn't exist here and that
/// passes `isIdentifierReference`. Every name passes unless ESLint knows it's something else, so
/// all the names in TypeScript-only syntax pass.
pub(super) fn starts_with_identifier_reference(node: Node) -> bool {
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
        // ESLint knows that the key of a `MethodDefinition` or `PropertyDefinition` isn't a
        // reference.
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

/// `isIdentifierReference` for a binding identifier.
pub(super) fn is_binding_a_reference(pat: Pat) -> bool {
    match pat.parent() {
        Node::PatProp(prop) => !prop.is_rest(),
        Node::PatElem(element) => element.default().is_some(),
        Node::Param(param) => !param.is_rest(),
        _ => false,
    }
}

/// The flags `e` gets from being a particular child of `parent`.
fn flags_from_parent<'a>(e: Expr<'a>, parent: Frame<'a>) -> Is {
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
                Is::ABSENT | Is::CHILD_POSITION_MATTERS
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

/// True if `node` is irrelevant to the analysis, provided it isn't in a `try` statement and it
/// doesn't matter which child of its parent it is. That's true of most nodes.
#[inline]
fn is_plain(node: Node) -> bool {
    use hir::ExprKind as K;
    match node {
        Node::Expr(e) => match e.try_raw().map(|raw| raw.kind) {
            Some(K::Fn(_) | K::Cond { .. } | K::Yield { .. } | K::Jsx(_) | K::NonNull(_)) => false,
            Some(K::Binary { op, .. }) => choice_kind(op).is_none() && op != BinOp::Comma,
            Some(K::Assign { op, target, .. }) => {
                let is_destructuring = matches!(
                    e.file().hir.exprs.get(target.idx()).map(|raw| raw.kind),
                    Some(K::Array(_) | K::Object(_))
                );
                !is_destructuring && op.and_then(choice_kind).is_none()
            }
            Some(K::Dot { chain, .. } | K::Index { chain, .. }) => chain == Chain::No,
            Some(K::Call(call)) => {
                (e.file().hir.calls.get(call.idx())).is_none_or(|call| call.chain == Chain::No)
            }
            _ => true,
        },
        Node::Stmt(stmt) => matches!(
            stmt.tag(),
            StmtTag::Expr | StmtTag::Var | StmtTag::Block | StmtTag::Class | StmtTag::Empty
        ),
        Node::Type(_)
        | Node::TypeParam(_)
        | Node::TupleElem(_)
        | Node::Pat(_)
        | Node::Prop(_)
        | Node::VarDecl(_)
        | Node::Class(_) => true,
        _ => false,
    }
}

/// The flags for a parameter or a part of a pattern, which is an `AssignmentPattern` in ESTree if
/// it has a default value.
#[inline]
fn with_default(default: Option<Expr>) -> Is {
    match default {
        Some(_) => Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS,
        None => Is::empty(),
    }
}

impl<'s, 'a> Builder<'s, 'a> {
    pub(super) fn new(file: &'a File<'a>, store: &'s Store) -> Self {
        Builder {
            file,
            store,
            states: Vec::new(),
            spare_states: Vec::new(),
            ancestors: Vec::new(),
            is_settled: false,
        }
    }

    // ───────────────────────────── events ─────────────────────────────

    /// `forwardCurrentToHead`
    #[inline]
    pub(super) fn forward_current_to_head(&mut self, cx: &mut Cx<'_, 'a>) {
        let Some(state) = self.states.last_mut() else {
            return;
        };
        let is_current = match (&state.current_segments[..], state.head_segments()) {
            ([current], [head]) => current == head,
            (current, head) => current == head,
        };
        if !is_current {
            Self::forward(state, cx);
        }
        self.is_settled = true;
    }

    #[cold]
    fn forward(state: &mut State, cx: &mut Cx<'_, 'a>) {
        let (file, store, node) = (cx.file, cx.store(), cx.event_node());
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

    pub(super) fn start_code_path(&mut self, cx: &mut Cx<'_, 'a>) {
        self.forward_current_to_head(cx);
        let store = cx.store();
        let path = store.new_code_path();
        let mut state = self.spare_states.pop().unwrap_or_else(State::new);
        state.reset(store, path);
        self.states.push(state);
        self.is_settled = false;
        let node = cx.event_node();
        (cx.emit)(Event::CodePathStart(CodePath::new(cx.file, path), node));
    }

    pub(super) fn end_code_path(&mut self, cx: &mut Cx<'_, 'a>) {
        let Some(mut state) = self.states.pop() else {
            return;
        };
        let (store, node) = (cx.store(), cx.event_node());
        self.is_settled = false;
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

    /// True if the last node entered started a code path other than the outermost.
    fn has_started_inner_code_path(&self) -> bool {
        self.states.len() > 1
            && matches!(self.ancestors.last(), Some(it) if it.is.intersects(Is::HAS_CODE_PATH | Is::FIELD_INITIALIZER))
    }

    #[inline]
    fn is_before_first_throwable(&self) -> bool {
        matches!(self.states.last(), Some(state) if state.is_before_first_throwable(self.store))
    }

    /// Called when leaving a node that may throw. If it's an ESTree `Identifier` that passes
    /// `isIdentifierReference`, the resulting segment changes are emitted with the next node.
    #[inline]
    fn leave_throwable(&mut self, cx: &Cx<'_, 'a>) {
        self.is_settled = false;
        if let Some(state) = self.states.last_mut() {
            state.make_first_throwable_path_in_try_or_catch_block(cx.store());
        }
    }

    // ───────────────────────────── entering ─────────────────────────────

    /// `preprocess`: updates the state based on which child of `parent` the node `cx.node` is.
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

    /// `processCodePathToEnter`, without the last step. `is` has the flags derived from the parent.
    /// Returns the additional flags.
    fn enter_expr(
        &mut self,
        e: Expr<'a>,
        is: Is,
        parent: Option<Node<'a>>,
        cx: &mut Cx<'_, 'a>,
    ) -> Is {
        if is.contains(Is::FIELD_INITIALIZER) {
            cx.keeps_function_expression = true;
            self.start_code_path(cx);
            self.forward_current_to_head(cx);
            cx.keeps_function_expression = false;
        }
        // Whether it may throw only matters in a `try` statement, and a `try` can't start inside an
        // expression.
        let may_throw = match self.states.last() {
            Some(state) if state.is_in_try() => Is::HAS_EXIT,
            _ => Is::empty(),
        };
        let mut more = match e.tag() {
            ExprTag::Fn => {
                return match e.as_fn() {
                    Some(func) if has_code_path(func) => {
                        self.start_code_path(cx);
                        Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
                    }
                    _ => Is::empty(),
                };
            }
            ExprTag::Ident
            | ExprTag::New
            | ExprTag::ImportCall
            | ExprTag::NewTarget
            | ExprTag::ImportMeta
            | ExprTag::AsConst => return may_throw,
            ExprTag::Yield => return Is::HAS_EXIT,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call => match e.chain() {
                Chain::No if is.contains(Is::JSX_NAME) => return Is::CHILD_POSITION_MATTERS,
                Chain::No => return may_throw,
                _ => Is::IN_CHAIN | Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS,
            },
            ExprTag::NonNull if is.contains(Is::CONTINUES_CHAIN) || is_non_null_after_chain(e) => {
                Is::IN_CHAIN | Is::CHILD_POSITION_MATTERS
            }
            ExprTag::Array | ExprTag::Spread | ExprTag::Object if is.contains(Is::PATTERN) => {
                return Is::CHILD_POSITION_MATTERS;
            }
            ExprTag::Jsx => return Is::CHILD_POSITION_MATTERS,
            ExprTag::Binary | ExprTag::Assign | ExprTag::Cond => Is::empty(),
            _ => return Is::empty(),
        };
        if more.contains(Is::IN_CHAIN) && !is.contains(Is::CONTINUES_CHAIN) {
            // Enter the `ChainExpression`.
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
                    more |= Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS;
                } else if op == BinOp::Comma {
                    more |= Is::CHILD_POSITION_MATTERS;
                }
            }
            ExprKind::Assign { op, .. } => {
                more |= Is::CHILD_POSITION_MATTERS;
                if let Some(kind) = op.and_then(choice_kind) {
                    state.push_choice_context(kind, is_forking_by_true_or_false(e, parent));
                    more |= Is::HAS_EXIT;
                } else if op.is_none() && is.contains(Is::PATTERN) {
                    more |= Is::HAS_EXIT;
                }
            }
            ExprKind::Cond { .. } => {
                state.push_choice_context(ChoiceKind::Test, false);
                more |= Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS;
            }
            _ => {}
        }
        more
    }

    /// `processCodePathToEnter`, without the last step. Returns the flags for `stmt`.
    fn enter_stmt(&mut self, stmt: Stmt<'a>, parent: Option<Node<'a>>, cx: &mut Cx<'_, 'a>) -> Is {
        if stmt.tag() == StmtTag::Fn
            && let StmtKind::Fn(func) = stmt.kind()
        {
            if !has_code_path(func) {
                return Is::empty();
            }
            self.start_code_path(cx);
            return Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS;
        }
        let Some(state) = self.states.last_mut() else {
            return Is::empty();
        };
        let kind = match stmt.tag() {
            StmtTag::Break | StmtTag::Continue | StmtTag::Return | StmtTag::Throw => {
                return Is::HAS_EXIT;
            }
            StmtTag::If => {
                state.push_choice_context(ChoiceKind::Test, false);
                return Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS;
            }
            StmtTag::While => LoopKind::While,
            StmtTag::DoWhile => LoopKind::DoWhile,
            StmtTag::For => LoopKind::For,
            StmtTag::ForIn => LoopKind::ForIn,
            StmtTag::ForOf => LoopKind::ForOf,
            StmtTag::Switch | StmtTag::Try | StmtTag::Labeled => match stmt.kind() {
                StmtKind::Switch { cases, .. } => {
                    let has_case = cases.iter().any(|case| !case.is_default());
                    state.push_switch_context(has_case, label_of(parent));
                    return Is::HAS_EXIT;
                }
                StmtKind::Try { finalizer, .. } => {
                    state.push_try_context(finalizer.is_some());
                    return Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS;
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
        Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS
    }

    /// `enterNode`, up to where it calls the node's listeners.
    #[inline]
    fn enter(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let position_matters = matches!(self.ancestors.last(), Some(parent) if parent.is.contains(Is::CHILD_POSITION_MATTERS));
        let is_in_try = matches!(self.states.last(), Some(state) if state.is_in_try());
        if self.is_settled && !position_matters && !is_in_try && is_plain(node) {
            let is = Is::empty();
            self.ancestors.push(Frame { node, is });
            return;
        }
        self.enter_slow(node, emit);
    }

    #[inline(never)]
    fn enter_slow(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        self.is_settled = false;
        let cx = &mut Cx::new(self.file, self.store, node, emit);
        let parent = self.ancestors.last().copied();
        let mut is = Is::empty();
        if let Some(parent) = parent
            && parent.is.contains(Is::CHILD_POSITION_MATTERS)
        {
            match node {
                Node::Expr(e) => is = flags_from_parent(e, parent),
                Node::Prop(_) if parent.is.contains(Is::PATTERN) => {
                    is = Is::PATTERN | Is::CHILD_POSITION_MATTERS
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
            Node::Pat(pat) => match self.states.last() {
                Some(state) if state.is_in_try() && pat.tag() == PatTag::Ident => Is::HAS_EXIT,
                _ => Is::empty(),
            },
            Node::File(_) => {
                self.start_code_path(cx);
                Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
            }
            Node::Func(func) => match parent {
                Some(Node::Member(_)) if has_code_path(func) => {
                    self.start_code_path(cx);
                    Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
                }
                _ => Is::empty(),
            },
            Node::Member(member) => match member.kind() {
                MemberKind::StaticBlock => {
                    self.start_code_path(cx);
                    Is::HAS_CODE_PATH | Is::HAS_POSTPROCESS
                }
                MemberKind::Property
                    if member.init().is_some() && is_property_definition(member) =>
                {
                    Is::CHILD_POSITION_MATTERS
                }
                _ => Is::empty(),
            },
            Node::Case(case) => {
                let is_first = matches!(parent, Some(Node::Stmt(parent))
                    if matches!(parent.kind(), StmtKind::Switch { cases, .. } if cases.first() == Some(case)));
                if !is_first && let Some(state) = self.states.last_mut() {
                    state.fork_path(cx.store());
                }
                Is::HAS_EXIT | Is::CHILD_POSITION_MATTERS
            }
            Node::Param(param) => with_default(param.default()),
            Node::PatElem(element) => with_default(element.default()),
            Node::PatProp(prop) => with_default(prop.default()),
            _ => Is::empty(),
        };
        self.ancestors.push(Frame { node, is });
        self.forward_current_to_head(cx);
        if self.is_before_first_throwable() && starts_with_identifier_reference(node) {
            self.leave_throwable(cx);
        }
    }

    // ───────────────────────────── leaving ─────────────────────────────

    /// `isIdentifierReference` for an identifier expression.
    fn is_identifier_reference(&self, is: Is) -> bool {
        if is.contains(Is::JSX_NAME) {
            return false;
        }
        if !is.contains(Is::PATTERN) {
            return true;
        }
        // It isn't one in an `ArrayPattern` or a `RestElement`.
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
                // The name is an ESTree node, which is entered and left here.
                if is.contains(Is::IN_CHAIN) && e.is_optional() {
                    state.make_optional_right(store);
                    self.forward_current_to_head(cx);
                }
                self.leave_throwable(cx);
            }
            // ESLint treats the names of a `MetaProperty` as references.
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

    /// `leaveNode`, up to where it calls the node's listeners.
    #[inline]
    fn before_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let Some(&Frame { is, .. }) = self.ancestors.last() else {
            return;
        };
        if is.contains(Is::ABSENT) || self.is_settled && !is.contains(Is::HAS_EXIT) {
            return;
        }
        self.leave_slow(node, is, emit);
    }

    #[inline(never)]
    fn leave_slow(&mut self, node: Node<'a>, is: Is, emit: &mut dyn FnMut(Event<'a>)) {
        let cx = &mut Cx::new(self.file, self.store, node, emit);
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
                    if self.is_before_first_throwable() && is_binding_a_reference(pat) {
                        self.leave_throwable(cx);
                    }
                    true
                }
                // Leave the `AssignmentPattern`.
                Node::Param(_) | Node::PatElem(_) | Node::PatProp(_) => {
                    if let Some(state) = self.states.last_mut() {
                        state.pop_fork_context(store);
                    }
                    false
                }
                _ => false,
            };
        match dont_forward {
            true => self.is_settled = false,
            false => self.forward_current_to_head(cx),
        }
    }

    /// `leaveNode`, after it has called the listeners: `postprocess`.
    #[inline]
    fn after_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        if let Some(Frame { is, .. }) = self.ancestors.pop()
            && is.contains(Is::HAS_POSTPROCESS)
        {
            self.postprocess(node, is, emit);
        }
    }

    #[inline(never)]
    fn postprocess(&mut self, node: Node<'a>, is: Is, emit: &mut dyn FnMut(Event<'a>)) {
        self.is_settled = false;
        let cx = &mut Cx::new(self.file, self.store, node, emit);
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
            // Leave the `ChainExpression`.
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

/// One step of the walk, for the rules to act on.
#[derive(Copy, Clone)]
pub enum Step<'a> {
    /// Call the listeners for entering the node.
    Enter(Node<'a>),
    /// Call the listeners for leaving the node.
    Exit(Node<'a>),
    /// Call the listeners for the event.
    Event(Event<'a>),
}

struct Recorder<'s, 'a> {
    builder: Builder<'s, 'a>,
    steps: Vec<Step<'a>>,
    enter: NodeTags,
    exit: NodeTags,
}

impl<'a> Recorder<'_, 'a> {
    #[inline]
    fn enter(&mut self, node: Node<'a>) {
        let steps = &mut self.steps;
        self.builder
            .enter(node, &mut |event| steps.push(Step::Event(event)));
        if self.enter.contains(node) {
            steps.push(Step::Enter(node));
        }
    }

    #[inline]
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

    /// `ast::walk::walk_node` for each of `nodes`, last one first, skipping whatever doesn't
    /// matter.
    ///
    /// With `is_shallow` it doesn't descend into anything that has its own code path.
    fn walk(&mut self, nodes: Vec<Node<'a>>, matters: Option<&Matters>, is_shallow: bool) {
        enum Todo<'a> {
            Enter(Node<'a>),
            Exit(Node<'a>),
        }
        let mut todo: Vec<Todo<'a>> = nodes.into_iter().map(Todo::Enter).collect();
        while let Some(next) = todo.pop() {
            let node = match next {
                Todo::Enter(node) => node,
                Todo::Exit(node) => {
                    self.exit(node);
                    continue;
                }
            };
            self.enter(node);
            // Until something may have thrown in a `try` block, every name matters.
            let is_skipped = matters.is_some_and(|it| it.can_skip(node))
                && !self.builder.is_before_first_throwable()
                || is_shallow && self.builder.has_started_inner_code_path();
            if is_skipped {
                self.exit(node);
                continue;
            }
            todo.push(Todo::Exit(node));
            let first = todo.len();
            node.for_each_child(|child| todo.push(Todo::Enter(child)));
            todo[first..].reverse();
        }
    }
}

/// Walks and analyzes `file`. Returns, in order, the events plus the nodes whose kinds are in
/// `enter` and `exit`, which are the kinds that rules listen for.
///
/// Like ESLint, it analyzes the whole file before the first listener is called. So a rule sees the
/// finished graph from the first event on, including the segments that follow the current one and
/// those that loop back to it.
pub fn steps<'a>(file: &'a File<'a>, enter: NodeTags, exit: NodeTags) -> Steps<'a> {
    let statements = file.hir.stmts.len();
    file.lazy.code_paths.clear(statements);
    let mut recorder = Recorder {
        builder: Builder::new(file, &file.lazy.code_paths),
        steps: Vec::with_capacity(2 * statements),
        enter,
        exit,
    };
    recorder.walk(
        vec![Node::File(file)],
        Some(&Matters::new(file, enter | exit)),
        false,
    );
    file.lazy.code_paths.finish(0);
    Steps {
        file,
        steps: recorder.steps.into_iter(),
    }
}

/// [`steps`] for only the code path that starts at `root`: the file, a function, a static block or
/// a field initializer.
///
/// With `is_shallow` the contents of nested code paths are skipped.
///
/// Earlier results stay valid.
pub(super) fn steps_of<'a>(
    root: Node<'a>,
    enter: NodeTags,
    exit: NodeTags,
    is_shallow: bool,
) -> Steps<'a> {
    let file = root.file();
    let store = &file.lazy.code_paths;
    let first_segment = store.segment_count();
    let mut recorder = Recorder {
        builder: Builder::new(file, store),
        steps: Vec::new(),
        enter,
        exit,
    };
    // Whether a node starts a code path depends on its parent.
    let (parent_frame, first) = match root {
        Node::Func(func) => match func.owner() {
            owner @ Node::Member(_) => (Some((owner, Is::empty())), root),
            owner => (None, owner),
        },
        Node::Expr(_) => (Some((root.parent(), Is::CHILD_POSITION_MATTERS)), root),
        _ => (None, root),
    };
    if let Some((node, is)) = parent_frame {
        recorder.builder.ancestors.push(Frame { node, is });
    }
    recorder.walk(vec![first], None, is_shallow);
    store.finish(first_segment);
    Steps {
        file,
        steps: recorder.steps.into_iter(),
    }
}

/// The loop whose next iteration starts at `node`. It's `isLoopingTarget` from ESLint's
/// `no-unreachable-loop`.
fn loop_with_target(node: Node<'_>) -> Option<Stmt<'_>> {
    let node = match node {
        Node::Func(func) => func.owner(),
        _ => node,
    };
    let parent = node.parent().as_stmt()?;
    let is_target = match parent.kind() {
        StmtKind::While { test, .. } => node == Node::Expr(test),
        StmtKind::DoWhile { body, .. } => node == Node::Stmt(body),
        StmtKind::For {
            test, update, body, ..
        } => match update.or(test) {
            Some(first) => node == Node::Expr(first),
            None => node == Node::Stmt(body),
        },
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
            node == Node::Stmt(left)
                || matches!(left.kind(), StmtKind::Expr(e) if node == Node::Expr(e))
        }
        _ => false,
    };
    is_target.then_some(parent)
}

/// Analyzes only the code path of `node`, which is a function or the file, skipping nested
/// functions. Returns true if its end is reachable, and fills in `reach` for its statements and
/// cases.
pub(super) fn is_end_reachable(node: Node, reach: Option<&mut Reach>) -> bool {
    let (file, store) = (node.file(), &Store::default());
    let (enter, exit) = match reach {
        Some(_) => (
            StmtTag::ALL
                .iter()
                .fold(NodeTags::EMPTY, |all, &tag| all | tag.into()),
            NodeTags::CASE,
        ),
        None => (NodeTags::EMPTY, NodeTags::EMPTY),
    };
    let mut recorder = Recorder {
        builder: Builder::new(file, store),
        steps: Vec::new(),
        enter,
        exit,
    };
    let discard_events = &mut |_| {};
    let cx = &mut Cx::new(file, store, node, discard_events);
    recorder.builder.start_code_path(cx);
    let mut children = node.children();
    children.reverse();
    let matters = file.lazy.code_paths.matters_without_listeners(file);
    recorder.walk(children, Some(matters), true);
    let is_end_reachable =
        matches!(recorder.builder.states.last(), Some(state) if state.is_reachable(store));
    let Some(reach) = reach else {
        return is_end_reachable;
    };
    // The code paths that have started but not ended. `node`'s is the first one in the store.
    let mut paths = vec![0];
    // Each loop, paired with the segment it jumps back to for its next iteration.
    let mut loops: Vec<(u32, Stmt)> = Vec::new();
    for step in recorder.steps {
        match step {
            Step::Event(event) => {
                store.follow(event);
                match event {
                    Event::CodePathStart(path, _) => paths.push(path.id()),
                    Event::CodePathEnd(..) => {
                        paths.pop();
                    }
                    Event::SegmentStart(segment, node) => {
                        loops.extend(loop_with_target(node).map(|it| (segment.id(), it)));
                    }
                    // Only from a statement, which excludes the right side of a `for`-`in` or
                    // `for`-`of`.
                    Event::SegmentLoop(_, to, Node::Stmt(from)) => {
                        for &(_, it) in loops.iter().filter(|it| it.0 == to.id()) {
                            if from == it || from.tag() == StmtTag::Continue {
                                reach.set_repeating(it);
                            }
                        }
                    }
                    _ => {}
                }
            }
            // A function declaration's code path has already started.
            Step::Enter(Node::Stmt(stmt)) => {
                let is_inside = matches!(stmt.kind(), StmtKind::Fn(func) if has_code_path(func));
                if let Some(&path) = paths.iter().rev().nth(usize::from(is_inside)) {
                    reach.set_statement(stmt, store.is_current_reachable(path));
                }
            }
            Step::Exit(Node::Case(case)) => {
                if let Some(&path) = paths.last() {
                    reach.set_case_end(case, store.is_current_reachable(path));
                }
            }
            _ => {}
        }
    }
    is_end_reachable
}

/// See [`steps`].
pub struct Steps<'a> {
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
