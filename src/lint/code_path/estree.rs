//! Code path analysis for JavaScript plugins, which see ESTree.
//!
//! A JavaScript rule observes more than the graph. It sees between which two ESTree nodes an event
//! fires and which node comes with it. `analyzer.rs` walks `crate::ast`, which has no node for
//! `ChainExpression`, `CatchClause`, `AssignmentPattern`, the `b` of `a.b` and others, so its events
//! can't be placed in an ESTree traversal. This driver walks the numbered ESTree instead. It's a port
//! of ESLint's `code-path-analyzer.js` and makes the same calls into [`State`], which builds the graph
//! for both drivers.
//!
//! # The message
//!
//! [`analyze`] returns `u32` words for `jsLintCodePaths` in `src/jsc/bindings/LintNodes.cpp`.
//!
//! | Part | Words |
//! | --- | --- |
//! | header | event count, code path count, segment count, length of the lists |
//! | events | 4 each: step, `node << 3 \| kind`, first argument, second argument |
//! | code paths | 7 each: origin, upper code path + 1 (0 for none), initial segment, then the lists `finalSegments`, `returnedSegments`, `thrownSegments`, `childCodePaths` |
//! | segments | 8 each: code path, number, flags, then the lists `nextSegments`, `prevSegments`, `allNextSegments`, `allPrevSegments`, `loopedPrevSegments` |
//! | lists | a length followed by that many indices |
//!
//! A list is stored as its offset into the last part. Offset 0 is the empty list.
//!
//! A traversal enters and leaves each node, and every enter or leave is one step, counted from 0. An
//! event with step `n` fires before the listeners of step `n`. Counting steps instead of naming a
//! node keeps the position exact for the nodes that espree puts in two fields of their parent, which
//! ESLint visits twice.

use super::analyzer::Builder;
use super::state::{ChoiceKind, Cx, LoopKind, State};
use super::{Event, Store};
use crate::ast::{File, Node};
use crate::estree::{Field, NodeType, VNode, Value};
use crate::js_plugin::wire::push_list;
use bun_sema::atom::Atom;

/// The ESTree of a file. Nodes are numbered in traversal order and `Program` is 0.
#[derive(Copy, Clone)]
pub(crate) struct Tree<'t, 'a> {
    pub(crate) nodes: &'t [VNode<'a>],
    /// [`NodeType`] of each node.
    pub(crate) types: &'t [u8],
    pub(crate) parents: &'t [u32],
    /// Nodes that ESLint visits twice in a row, in ascending order.
    pub(crate) twice: &'t [u32],
}

/// `codePath.origin`. `main.js` has the strings in this order.
#[derive(Copy, Clone)]
enum Origin {
    Program,
    Function,
    ClassFieldInitializer,
    ClassStaticBlock,
}

const REACHABLE: u32 = 1;
/// Only used segments are part of the graph.
const USED: u32 = 2;

struct Walker<'t, 's, 'a> {
    file: &'a File<'a>,
    store: &'s Store,
    tree: Tree<'t, 'a>,
    builder: Builder<'s, 'a>,
    events: Vec<u32>,
    /// Origin and upper code path + 1 of each code path.
    started: Vec<(Origin, u32)>,
    step: u32,
}

/// `getBooleanValueIfSimpleConstant`
fn boolean_value_if_simple_constant(node: VNode) -> Option<bool> {
    if node.node_type() != NodeType::Literal {
        return None;
    }
    Some(match node.field(Field::Value) {
        Value::Bool(value) => value,
        Value::Number(value) => value != 0.0 && !value.is_nan(),
        Value::Str(value) => !value.is_empty(),
        Value::BigInt(digits) => digits.iter().any(|&digit| digit != b'0'),
        Value::Regex { .. } => true,
        _ => false,
    })
}

/// The choice context for `&&`, `||`, `??` and their assignment forms.
fn choice_kind(node: VNode) -> Option<ChoiceKind> {
    match node.field(Field::Operator) {
        Value::Str(b"&&" | b"&&=") => Some(ChoiceKind::And),
        Value::Str(b"||" | b"||=") => Some(ChoiceKind::Or),
        Value::Str(b"??" | b"??=") => Some(ChoiceKind::Nullish),
        _ => None,
    }
}

fn is_true(node: VNode, field: Field) -> bool {
    matches!(node.field(field), Value::Bool(true))
}

fn has_node(node: VNode, field: Field) -> bool {
    matches!(node.field(field), Value::Node(_))
}

fn is_field<'a>(parent: VNode<'a>, field: Field, node: VNode<'a>) -> bool {
    matches!(parent.field(field), Value::Node(it) if it == node)
}

fn is_first<'a>(parent: VNode<'a>, field: Field, node: VNode<'a>) -> bool {
    matches!(parent.field(field), Value::Nodes(list) if list.get(0) == Some(Some(node)))
}

fn is_empty(node: VNode, field: Field) -> bool {
    matches!(node.field(field), Value::Nodes(list) if list.get(0).is_none())
}

fn label_of(node: VNode) -> Option<Atom> {
    Some(node.stmt()?.label()?.name().atom())
}

/// `breakableTypePattern`
fn is_breakable(node_type: NodeType) -> bool {
    loop_kind(node_type).is_some() || node_type == NodeType::SwitchStatement
}

fn loop_kind(node_type: NodeType) -> Option<LoopKind> {
    match node_type {
        NodeType::WhileStatement => Some(LoopKind::While),
        NodeType::DoWhileStatement => Some(LoopKind::DoWhile),
        NodeType::ForStatement => Some(LoopKind::For),
        NodeType::ForInStatement => Some(LoopKind::ForIn),
        NodeType::ForOfStatement => Some(LoopKind::ForOf),
        _ => None,
    }
}

fn labels_a_plain_statement(node: VNode) -> bool {
    matches!(node.field(Field::Body), Value::Node(body) if !is_breakable(body.node_type()))
}

fn is_function(node_type: NodeType) -> bool {
    matches!(
        node_type,
        NodeType::FunctionDeclaration
            | NodeType::FunctionExpression
            | NodeType::ArrowFunctionExpression
    )
}

/// Appends an event that fires at `step` with the node `id`.
fn push_event(events: &mut Vec<u32>, step: u32, id: u32, event: Event) {
    let (kind, first, second) = match event {
        Event::CodePathStart(path, _) => (0, path.id(), 0),
        Event::CodePathEnd(path, _) => (1, path.id(), 0),
        Event::SegmentStart(segment, _) => (2, segment.id(), 0),
        Event::SegmentEnd(segment, _) => (3, segment.id(), 0),
        Event::UnreachableSegmentStart(segment, _) => (4, segment.id(), 0),
        Event::UnreachableSegmentEnd(segment, _) => (5, segment.id(), 0),
        Event::SegmentLoop(from, to, _) => (6, from.id(), to.id()),
    };
    events.extend_from_slice(&[step, id << 3 | kind, first, second]);
}

impl<'a> Walker<'_, '_, 'a> {
    #[inline]
    fn node(&self, id: u32) -> VNode<'a> {
        self.tree.nodes[id as usize]
    }

    #[inline]
    fn node_type(&self, id: u32) -> NodeType {
        NodeType::ALL[self.tree.types[id as usize] as usize]
    }

    /// `None` for the `Program`.
    #[inline]
    fn parent(&self, id: u32) -> Option<u32> {
        (id != 0).then(|| self.tree.parents[id as usize])
    }

    /// Runs `then` with the builder. Events it emits fire at the current step with the node `id`.
    #[inline]
    fn with<T>(
        &mut self,
        id: u32,
        then: impl FnOnce(&mut Builder<'_, 'a>, &mut Cx<'_, 'a>) -> T,
    ) -> T {
        let (events, step) = (&mut self.events, self.step);
        let emit = &mut |event| push_event(events, step, id, event);
        let cx = &mut Cx::new(self.file, self.store, Node::File(self.file), emit);
        then(&mut self.builder, cx)
    }

    /// Runs `then` with the state of the current code path.
    #[inline]
    fn with_state(&mut self, id: u32, then: impl FnOnce(&mut State, &mut Cx<'_, 'a>)) {
        self.with(id, |builder, cx| {
            if let Some(state) = builder.states.last_mut() {
                then(state, cx);
            }
        });
    }

    /// Whether the rules know about every segment change so far.
    #[inline]
    fn is_settled(&self) -> bool {
        self.builder
            .states
            .last()
            .is_none_or(|state| state.current_segments[..] == *state.head_segments())
    }

    #[inline]
    fn forward_current_to_head(&mut self, id: u32) {
        if !self.is_settled() {
            self.with(id, |builder, cx| builder.forward_current_to_head(cx));
        }
    }

    fn start_code_path(&mut self, id: u32, origin: Origin) {
        let upper = self.builder.states.last().map_or(0, |it| it.path + 1);
        self.started.push((origin, upper));
        self.with(id, |builder, cx| builder.start_code_path(cx));
    }

    fn end_code_path(&mut self, id: u32) {
        self.with(id, |builder, cx| builder.end_code_path(cx));
    }

    /// `isPropertyDefinitionValue`
    fn is_property_definition_value(&self, id: u32) -> bool {
        self.parent(id).is_some_and(|parent| {
            self.node_type(parent) == NodeType::PropertyDefinition
                && is_field(self.node(parent), Field::Value, self.node(id))
        })
    }

    /// `getLabel`
    fn label_around(&self, id: u32) -> Option<Atom> {
        let parent = self.parent(id)?;
        match self.node_type(parent) {
            NodeType::LabeledStatement => label_of(self.node(parent)),
            _ => None,
        }
    }

    /// `isForkingByTrueOrFalse`
    fn is_forking_by_true_or_false(&self, id: u32) -> bool {
        let Some(parent) = self.parent(id) else {
            return false;
        };
        match self.node_type(parent) {
            NodeType::ConditionalExpression
            | NodeType::IfStatement
            | NodeType::WhileStatement
            | NodeType::DoWhileStatement
            | NodeType::ForStatement => is_field(self.node(parent), Field::Test, self.node(id)),
            NodeType::LogicalExpression | NodeType::AssignmentExpression => {
                choice_kind(self.node(parent)).is_some()
            }
            _ => false,
        }
    }

    /// `isIdentifierReference`
    fn is_identifier_reference(&self, id: u32) -> bool {
        let Some(parent) = self.parent(id) else {
            return true;
        };
        let (node, parent_node) = (self.node(id), self.node(parent));
        match self.node_type(parent) {
            NodeType::LabeledStatement
            | NodeType::BreakStatement
            | NodeType::ContinueStatement
            | NodeType::ArrayPattern
            | NodeType::RestElement
            | NodeType::ImportSpecifier
            | NodeType::ImportDefaultSpecifier
            | NodeType::ImportNamespaceSpecifier
            | NodeType::CatchClause => false,
            NodeType::FunctionDeclaration
            | NodeType::FunctionExpression
            | NodeType::ArrowFunctionExpression
            | NodeType::ClassDeclaration
            | NodeType::ClassExpression
            | NodeType::VariableDeclarator => !is_field(parent_node, Field::Id, node),
            NodeType::Property | NodeType::PropertyDefinition | NodeType::MethodDefinition => {
                !is_field(parent_node, Field::Key, node)
                    || is_true(parent_node, Field::Computed)
                    || is_true(parent_node, Field::Shorthand)
            }
            _ => true,
        }
    }

    /// `preprocess`
    fn preprocess(&mut self, id: u32, parent: u32) {
        let (node, parent_type, parent) =
            (self.node(id), self.node_type(parent), self.node(parent));
        let is = |field: Field| is_field(parent, field, node);
        self.with_state(id, |state, cx| {
            let store = cx.store();
            match parent_type {
                NodeType::CallExpression => {
                    if is_true(parent, Field::Optional) && is_first(parent, Field::Arguments, node)
                    {
                        state.make_optional_right(store);
                    }
                }
                NodeType::MemberExpression => {
                    if is_true(parent, Field::Optional) && is(Field::Property) {
                        state.make_optional_right(store);
                    }
                }
                NodeType::LogicalExpression | NodeType::AssignmentExpression => {
                    if is(Field::Right) && choice_kind(parent).is_some() {
                        state.make_logical_right(store);
                    }
                }
                NodeType::ConditionalExpression | NodeType::IfStatement => {
                    if is(Field::Consequent) {
                        state.make_if_consequent(store);
                    } else if is(Field::Alternate) {
                        state.make_if_alternate(store);
                    }
                }
                NodeType::SwitchCase => {
                    if is_first(parent, Field::Consequent, node) {
                        state.make_switch_case_body(store, false, !has_node(parent, Field::Test));
                    }
                }
                NodeType::TryStatement => {
                    if is(Field::Handler) {
                        state.make_catch_block(store);
                    } else if is(Field::Finalizer) {
                        state.make_finally_block(store);
                    }
                }
                NodeType::WhileStatement => match is(Field::Test) {
                    true => state.make_while_test(store, boolean_value_if_simple_constant(node)),
                    false => state.make_while_body(store),
                },
                NodeType::DoWhileStatement => match is(Field::Body) {
                    true => state.make_do_while_body(store),
                    false => {
                        state.make_do_while_test(store, boolean_value_if_simple_constant(node))
                    }
                },
                NodeType::ForStatement => {
                    if is(Field::Test) {
                        state.make_for_test(store, boolean_value_if_simple_constant(node));
                    } else if is(Field::Update) {
                        state.make_for_update(store);
                    } else if is(Field::Body) {
                        state.make_for_body(cx);
                    }
                }
                NodeType::ForInStatement | NodeType::ForOfStatement => {
                    if is(Field::Left) {
                        state.make_for_in_of_left(store);
                    } else if is(Field::Right) {
                        state.make_for_in_of_right(store);
                    } else {
                        state.make_for_in_of_body(cx);
                    }
                }
                NodeType::AssignmentPattern => {
                    if is(Field::Right) {
                        state.push_fork_context();
                        state.fork_bypass_path(store);
                        state.fork_path(store);
                    }
                }
                _ => {}
            }
        });
    }

    /// `processCodePathToEnter`
    fn process_code_path_to_enter(&mut self, id: u32) {
        let (node, node_type) = (self.node(id), self.node_type(id));
        if self.is_property_definition_value(id) {
            self.start_code_path(id, Origin::ClassFieldInitializer);
        }
        match node_type {
            NodeType::Program => self.start_code_path(id, Origin::Program),
            _ if is_function(node_type) => self.start_code_path(id, Origin::Function),
            NodeType::StaticBlock => self.start_code_path(id, Origin::ClassStaticBlock),
            NodeType::LogicalExpression | NodeType::AssignmentExpression => {
                if let Some(kind) = choice_kind(node) {
                    let is_forking = self.is_forking_by_true_or_false(id);
                    self.with_state(id, |state, _| state.push_choice_context(kind, is_forking));
                }
            }
            NodeType::SwitchStatement => {
                let has_case = match node.field(Field::Cases) {
                    Value::Nodes(cases) => cases.flatten().any(|case| has_node(case, Field::Test)),
                    _ => false,
                };
                let label = self.label_around(id);
                self.with_state(id, |state, _| state.push_switch_context(has_case, label));
            }
            NodeType::SwitchCase => {
                let is_first_case = self
                    .parent(id)
                    .is_some_and(|parent| is_first(self.node(parent), Field::Cases, node));
                if !is_first_case {
                    self.with_state(id, |state, cx| state.fork_path(cx.store()));
                }
            }
            _ if loop_kind(node_type).is_some() => {
                let label = self.label_around(id);
                self.with_state(id, |state, _| {
                    if let Some(kind) = loop_kind(node_type) {
                        state.push_loop_context(kind, label);
                    }
                });
            }
            _ => self.with_state(id, |state, _| match node_type {
                NodeType::ChainExpression => state.push_chain_context(),
                NodeType::CallExpression | NodeType::MemberExpression => {
                    if is_true(node, Field::Optional) {
                        state.make_optional_node();
                    }
                }
                NodeType::ConditionalExpression | NodeType::IfStatement => {
                    state.push_choice_context(ChoiceKind::Test, false);
                }
                NodeType::TryStatement => state.push_try_context(has_node(node, Field::Finalizer)),
                NodeType::LabeledStatement => {
                    if labels_a_plain_statement(node) {
                        state.push_break_context(false, label_of(node));
                    }
                }
                _ => {}
            }),
        }
        self.forward_current_to_head(id);
    }

    /// `processCodePathToExit`
    fn process_code_path_to_exit(&mut self, id: u32) {
        let (node, node_type) = (self.node(id), self.node_type(id));
        if node_type == NodeType::Identifier {
            // Most nodes are identifiers outside of `try`, with nothing left to tell the rules.
            let is_in_try = self.builder.states.last().is_some_and(State::is_in_try);
            if !is_in_try && self.is_settled() {
                return;
            }
            if self.is_identifier_reference(id) {
                self.with_state(id, |state, cx| {
                    state.make_first_throwable_path_in_try_or_catch_block(cx.store());
                });
                return;
            }
        }
        if matches!(
            node_type,
            NodeType::BreakStatement
                | NodeType::ContinueStatement
                | NodeType::ReturnStatement
                | NodeType::ThrowStatement
        ) {
            self.forward_current_to_head(id);
        }
        let mut dont_forward = false;
        self.with_state(id, |state, cx| {
            let store = cx.store();
            match node_type {
                NodeType::ChainExpression => state.pop_chain_context(store),
                NodeType::IfStatement | NodeType::ConditionalExpression => {
                    state.pop_choice_context(store);
                }
                NodeType::LogicalExpression | NodeType::AssignmentExpression => {
                    if choice_kind(node).is_some() {
                        state.pop_choice_context(store);
                    }
                }
                NodeType::SwitchStatement => state.pop_switch_context(cx),
                NodeType::SwitchCase => {
                    if is_empty(node, Field::Consequent) {
                        state.make_switch_case_body(store, true, !has_node(node, Field::Test));
                    }
                    dont_forward = state.is_reachable(store);
                }
                NodeType::TryStatement => state.pop_try_context(store),
                NodeType::BreakStatement => {
                    state.make_break(store, label_of(node));
                    dont_forward = true;
                }
                NodeType::ContinueStatement => {
                    state.make_continue(cx, label_of(node));
                    dont_forward = true;
                }
                NodeType::ReturnStatement => {
                    state.make_return(store);
                    dont_forward = true;
                }
                NodeType::ThrowStatement => {
                    state.make_throw(store);
                    dont_forward = true;
                }
                NodeType::CallExpression
                | NodeType::ImportExpression
                | NodeType::MemberExpression
                | NodeType::NewExpression => {
                    state.make_first_throwable_path_in_try_or_catch_block(store);
                }
                NodeType::YieldExpression => state.make_yield(store),
                NodeType::AssignmentPattern => state.pop_fork_context(store),
                NodeType::LabeledStatement => {
                    if labels_a_plain_statement(node) {
                        state.pop_break_context_of_label(store);
                    }
                }
                _ if loop_kind(node_type).is_some() => state.pop_loop_context(cx),
                _ => {}
            }
        });
        if !dont_forward {
            self.forward_current_to_head(id);
        }
    }

    /// `postprocess`
    fn postprocess(&mut self, id: u32) {
        let (node, node_type) = (self.node(id), self.node_type(id));
        match node_type {
            NodeType::Program | NodeType::StaticBlock => self.end_code_path(id),
            _ if is_function(node_type) => self.end_code_path(id),
            NodeType::CallExpression => {
                if is_true(node, Field::Optional) && is_empty(node, Field::Arguments) {
                    self.with_state(id, |state, cx| state.make_optional_right(cx.store()));
                }
            }
            _ => {}
        }
        if self.is_property_definition_value(id) {
            self.end_code_path(id);
        }
    }

    /// `enterNode`
    fn enter(&mut self, id: u32) {
        if let Some(parent) = self.parent(id) {
            self.preprocess(id, parent);
        }
        self.process_code_path_to_enter(id);
        self.step += 1;
    }

    /// `leaveNode`
    fn leave(&mut self, id: u32) {
        self.process_code_path_to_exit(id);
        self.step += 1;
        self.postprocess(id);
    }

    fn walk(&mut self) {
        let mut open: Vec<u32> = Vec::new();
        let mut twice = self.tree.twice.iter().copied().peekable();
        for id in 0..self.tree.nodes.len() as u32 {
            while let Some(&last) = open.last()
                && Some(last) != self.parent(id)
            {
                open.pop();
                self.leave(last);
            }
            self.enter(id);
            if twice.next_if_eq(&id).is_some() {
                self.leave(id);
                self.enter(id);
            }
            open.push(id);
        }
        while let Some(last) = open.pop() {
            self.leave(last);
        }
    }
}

/// Analyzes the whole file and returns the message described at the top of this file.
pub(crate) fn analyze<'a>(file: &'a File<'a>, tree: Tree<'_, 'a>) -> Vec<u32> {
    let store = &Store::default();
    let mut walker = Walker {
        file,
        store,
        tree,
        builder: Builder::new(file, store),
        events: Vec::new(),
        started: Vec::new(),
        step: 0,
    };
    walker.walk();
    let (events, started) = (walker.events, walker.started);
    let (paths, segments) = (store.paths.borrow(), store.segments.borrow());

    let mut children: Vec<Vec<u32>> = vec![Vec::new(); paths.len()];
    for (&(_, upper), id) in started.iter().zip(0..) {
        if let Some(upper) = upper.checked_sub(1) {
            children[upper as usize].push(id);
        }
    }
    let mut lists = vec![0];
    let mut records = Vec::with_capacity(paths.len() * 7 + segments.len() * 8);
    for ((path, &(origin, upper)), children) in paths.iter().zip(&started).zip(&children) {
        records.extend_from_slice(&[origin as u32, upper, path.initial_segment]);
        for list in [
            &path.final_segments,
            &path.returned_segments,
            &path.thrown_segments,
            children,
        ] {
            records.push(push_list(&mut lists, list));
        }
    }
    for segment in segments.iter() {
        let flags = if segment.is_reachable { REACHABLE } else { 0 }
            | if segment.is_used { USED } else { 0 };
        records.extend_from_slice(&[segment.path, segment.number, flags]);
        if !segment.is_used {
            records.extend_from_slice(&[0; 5]);
            continue;
        }
        for list in [
            &segment.next[..],
            &segment.prev,
            &segment.all_next,
            &segment.all_prev,
            &segment.looped_prev,
        ] {
            records.push(push_list(&mut lists, list));
        }
    }

    let mut message = Vec::with_capacity(4 + events.len() + records.len() + lists.len());
    message.extend_from_slice(&[
        (events.len() / 4) as u32,
        paths.len() as u32,
        segments.len() as u32,
        lists.len() as u32,
    ]);
    message.extend_from_slice(&events);
    message.extend_from_slice(&records);
    message.extend_from_slice(&lists);
    message
}
