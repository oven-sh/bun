#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/Components.js` of eslint-plugin-react from `getWrapperFunctions` on: what detects the
//! components of a file. The list that it fills is [`ComponentList`].
//!
//! Upstream merges its visitors with the rule's and fills the list while ESLint walks the tree.
//! Here [`Components`] collects its own nodes and goes through them up to a moment that the rule
//! names: [`Components::advance`] first in each listener that asks or tells it anything,
//! [`Components::finish`] first in `finish`.
//!
//! | upstream | here |
//! |---|---|
//! | `Components.detect(rule)` | [`Components::new`] |
//! | `mergeRules([detectionInstructions, ..])` | [`Components::with`], [`Instructions`] |
//! | `utils.findReturnStatement` | `util_ast::find_return_statement` |
//! | `utils.isReactHookCall`, `reactImportInstructions` | in `hook-use-state`, their one reader |
//! | `components.add(node, 0)` of a `ThisExpression` | nothing: nobody asks for that `this` |
//!
//! A `Call`, a `Dot` or an `Index` that is the whole of an optional chain is taken for the
//! `CallExpression` or the `MemberExpression`, not for the `ChainExpression` around it.

use crate::util_ast::get_property_name;
use crate::util_component_util::{
    Pragmas, get_parent_es5_component, get_parent_es6_component, is_es5_component,
    is_es6_component, is_explicit_component_function, may_have_explicit_components,
};
use crate::util_components_list::{At, Component, ComponentId, ComponentList, Queue};
use crate::util_components_related::Related;
use crate::util_is_create_element::is_member_called;
use crate::util_is_destructured_from_pragma_import::is_destructured_from_pragma_import;
use crate::util_is_first_letter_capitalized::is_first_letter_capitalized;
use crate::util_jsx::{self, Branches, Nulls};
use crate::util_pragma::{get_create_class_from_context, mentions_create_class};
use crate::util_props::{is_default_props_declaration, is_prop_types_declaration};
use crate::util_steps::Way;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, last_sequence_expression, normalize};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::cell::{OnceCell, RefCell};

// ───────────────────────────── the stages ─────────────────────────────

/// Whether an [`Instructions`] has `X` alone or `X:exit` too.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Visit {
    Enter,
    EnterAndExit,
}

/// One of the visitors that upstream merges between its detection and the rule.
pub(crate) trait Instructions<'a> {
    /// Every node that it wants to be called with, in any order, as few as a cheap test allows.
    fn nodes(&self, file: &'a File<'a>, add: &mut dyn FnMut(Node<'a>, Visit));
    fn enter(&mut self, node: Node<'a>, components: &mut Components<'a>);
    fn exit(&mut self, _node: Node<'a>, _components: &mut Components<'a>) {}
    fn program_exit(&mut self, _components: &mut Components<'a>) {}
}

/// Which method of an [`Instructions`] is due.
#[derive(Copy, Clone)]
enum Moment<'a> {
    Enter(Node<'a>),
    Exit(Node<'a>),
    ProgramExit,
}

// ───────────────────────────── node.parent ─────────────────────────────

/// `node.parent` of an expression, as far as upstream asks for its `type`.
#[derive(Copy, Clone)]
enum Parent<'a> {
    VariableDeclarator(VarDecl<'a>),
    AssignmentExpression(Expr<'a>),
    /// A `Prop` or a `PatProp`. `node` is its value or its computed key.
    Property(Node<'a>),
    ReturnStatement(Stmt<'a>),
    ExportDefaultDeclaration,
    /// `node` is its body.
    ArrowFunctionExpression(Func<'a>),
    SequenceExpression(Expr<'a>),
    CallExpression(Expr<'a>),
    Other,
}

impl<'a> Parent<'a> {
    /// The expression that `node` is written as.
    fn written(node: Node<'a>) -> Option<Expr<'a>> {
        node.as_written().as_expr()
    }

    fn of(node: Node<'a>) -> Parent<'a> {
        let Some(e) = Parent::written(node) else {
            return Parent::Other;
        };
        // A `ChainExpression`, a `JSXExpressionContainer`.
        if e.is_chain_root() || e.jsx_container_span().is_some() {
            return Parent::Other;
        }
        match estree_parent(Node::Expr(e)) {
            Node::VarDecl(declarator) => Parent::VariableDeclarator(declarator),
            Node::Expr(parent) => match parent.kind() {
                // A default is in an `AssignmentPattern`.
                ExprKind::Assign { .. } if !parent.is_assignment_target() => {
                    Parent::AssignmentExpression(parent)
                }
                ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => Parent::SequenceExpression(parent),
                ExprKind::Call(_) => Parent::CallExpression(parent),
                _ => Parent::Other,
            },
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Return(_) => Parent::ReturnStatement(statement),
                StmtKind::ExportDefault(_) => Parent::ExportDefaultDeclaration,
                _ => Parent::Other,
            },
            Node::Func(arrow) => Parent::ArrowFunctionExpression(arrow),
            parent @ Node::Prop(prop)
                if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() =>
            {
                Parent::Property(parent)
            }
            parent @ Node::PatProp(prop) if prop.default() != Some(e) => Parent::Property(parent),
            _ => Parent::Other,
        }
    }

    /// `parent.left.name` of an `AssignmentExpression`, `parent.key.name` of a `Property`. The
    /// outer `None`: it is neither.
    fn name(self) -> Option<Option<&'a [u8]>> {
        match self {
            Parent::AssignmentExpression(assignment) => {
                Some(assignment.left().and_then(Expr::as_ident).map(Name::bytes))
            }
            Parent::Property(property) => Some(get_property_name(property)),
            _ => None,
        }
    }
}

/// `property.key`
fn key_of(property: Node<'_>) -> Option<Key<'_>> {
    match property {
        Node::Prop(prop) => prop.key(),
        Node::PatProp(prop) => prop.key(),
        _ => None,
    }
}

// ───────────────────────────── wrapper functions ─────────────────────────────

/// An element of what `getWrapperFunctions` returns. `None`: `undefined`, or an `object` that is
/// falsy.
#[derive(Copy, Clone)]
struct WrapperFunction<'a> {
    object: Option<&'a [u8]>,
    property: Option<&'a [u8]>,
}

/// `getWrapperFunctions`. What can equal no name is left out.
fn get_wrapper_functions<'a>(file: &'a File<'a>, pragma: &'a [u8]) -> Vec<WrapperFunction<'a>> {
    let component_wrapper_functions = file.settings().get(b"componentWrapperFunctions");
    let component_wrapper_functions =
        (component_wrapper_functions.and_then(Json::as_array)).unwrap_or_default();
    let configured = component_wrapper_functions
        .iter()
        .filter_map(|wrapper_function| {
            if let Some(property) = wrapper_function.as_str() {
                return Some(WrapperFunction {
                    object: None,
                    property: Some(property),
                });
            }
            let property = match wrapper_function.get(b"property") {
                Some(property) => Some(property.as_str()?),
                None => None,
            };
            let object = match wrapper_function.get(b"object").filter(|it| it.is_truthy()) {
                Some(object) => Some(object.as_str()?),
                None => None,
            };
            let object = object.map(|it| if it == b"<pragma>" { pragma } else { it });
            Some(WrapperFunction { object, property })
        });
    let of_the_pragma = ["forwardRef", "memo"].map(|property| WrapperFunction {
        object: Some(pragma),
        property: Some(property.as_bytes()),
    });
    configured.chain(of_the_pragma).collect()
}

/// `getComponentNameFromJSXElement`
fn get_component_name_from_jsx_element(node: Expr<'_>) -> Option<Name<'_>> {
    match node.kind() {
        ExprKind::Jsx(jsx) => jsx.tag()?.as_ident(),
        _ => None,
    }
}

/// `getNameOfWrappedComponent`: the name of the first JSX element.
fn get_name_of_wrapped_component<'a>(node: List<'a, Expr<'a>>) -> Option<Name<'a>> {
    match node.first()?.as_fn()?.body() {
        FnBody::Expr(body) => get_component_name_from_jsx_element(body),
        FnBody::Block(body) => body
            .iter()
            .find_map(|item| match item.kind() {
                StmtKind::Return(argument) => Some(argument),
                _ => None,
            })?
            .and_then(get_component_name_from_jsx_element),
        FnBody::None => None,
    }
}

/// The name under which `getDetectedComponents` has `node`, which is [`normalize`]d.
fn name_of_detected_component(node: Node<'_>) -> Option<Name<'_>> {
    match node {
        Node::Class(class) if matches!(class.owner(), Node::Stmt(_)) => {
            class.name().map(Ident::name)
        }
        Node::Func(func) if func.is_arrow() => match Parent::of(node) {
            Parent::VariableDeclarator(declarator) => declarator.pat().as_ident(),
            _ => None,
        },
        _ => None,
    }
}

// ───────────────────────────── the engine ─────────────────────────────

/// What `isReturningJSX`, `isReturningJSXOrNull` and `isReturningOnlyNull` have said of a function:
/// a bit for each question.
#[derive(Copy, Clone, Default)]
struct Returning {
    asked: u8,
    answers: u8,
}

/// What a rule gets from `Components.detect`: `components` and `utils`.
pub(crate) struct Components<'a> {
    file: &'a File<'a>,
    pragmas: OnceCell<Pragmas<'a>>,
    wrapper_functions: OnceCell<Vec<WrapperFunction<'a>>>,
    list: ComponentList<'a>,
    /// What `getDetectedComponents` returns, by the name. Who is in it can have been banned since.
    detected: FxHashMap<Name<'a>, SmallVec<[ComponentId; 1]>>,
    related: Related<'a>,
    returning: RefCell<FxHashMap<Func<'a>, Returning>>,
    queue: Queue<'a>,
    /// `None` while it is called.
    stages: Vec<Option<Box<dyn Instructions<'a> + 'a>>>,
    is_started: bool,
    is_finished: bool,
    /// See [`Components::closest_candidate`].
    candidates: FxHashMap<Scope<'a>, Option<Scope<'a>>>,
    /// [`get_name_of_wrapped_component`], by the first argument: it looks through a whole body.
    wrapped: FxHashMap<Expr<'a>, Option<Name<'a>>>,
    /// [`may_have_explicit_components`]
    may_have_explicit: OnceCell<bool>,
    /// For [`is_explicit_component_function`].
    documented_at: AncestorMemo<'a, Option<u32>>,
}

impl<'a> Components<'a> {
    /// `false` is certain: nothing but what is banned gets into the list of this file.
    pub(crate) fn may_have_any(file: &'a File<'a>) -> bool {
        const NAMES: [&str; 8] = [
            "Component",
            "PureComponent",
            "createElement",
            "memo",
            "forwardRef",
            "propTypes",
            "defaultProps",
            "getDefaultProps",
        ];
        // `@extends React.Component`
        let has_tag = || {
            let mut comments = file.comments().map(|it| it.comment_value());
            file.has_classes() && comments.any(|it| strings::contains(it, b"React."))
        };
        file.mentions_any(&NAMES)
            || file.has_exprs([ExprTag::Jsx, ExprTag::Null])
            || mentions_create_class(file, get_create_class_from_context(file))
            || file.settings().get(b"componentWrapperFunctions").is_some()
            || has_tag()
    }

    /// It costs nothing before the first question.
    pub(crate) fn new(file: &'a File<'a>) -> Components<'a> {
        Components {
            file,
            pragmas: OnceCell::new(),
            wrapper_functions: OnceCell::new(),
            list: ComponentList::default(),
            detected: FxHashMap::default(),
            related: Related::default(),
            returning: RefCell::default(),
            queue: Queue::default(),
            stages: Vec::new(),
            is_started: false,
            is_finished: false,
            candidates: FxHashMap::default(),
            wrapped: FxHashMap::default(),
            may_have_explicit: OnceCell::new(),
            documented_at: AncestorMemo::default(),
        }
    }

    /// `componentUtil.isES6Component(node, context)`, of a node of the list.
    pub(crate) fn is_es6_component(&mut self, node: Node<'a>) -> bool {
        match node {
            Node::Class(class) => is_es6_component(class, self.pragmas()),
            Node::Func(func) => {
                let file = self.file;
                *(self.may_have_explicit).get_or_init(|| may_have_explicit_components(file))
                    && is_explicit_component_function(func, &mut self.documented_at)
            }
            _ => false,
        }
    }

    /// With one more of the visitors between the detection and the rule, in upstream's order.
    pub(crate) fn with(mut self, stage: Box<dyn Instructions<'a> + 'a>) -> Components<'a> {
        self.stages.push(Some(stage));
        self
    }

    pub(crate) fn pragmas(&self) -> &Pragmas<'a> {
        self.pragmas.get_or_init(|| Pragmas::new(self.file))
    }

    fn wrapper_functions(&self) -> &[WrapperFunction<'a>] {
        self.wrapper_functions
            .get_or_init(|| get_wrapper_functions(self.file, self.pragmas().pragma))
    }

    // ───────────────────────────── the walk ─────────────────────────────

    /// `node` is one for `detectionInstructions`.
    fn push(&mut self, node: Node<'a>) {
        self.queue.push(At::enter(node), 0, node);
    }

    /// `callee.property.name` or `callee.name`
    fn name_of_callee(callee: Expr<'a>) -> Option<&'a [u8]> {
        match callee.tag() {
            ExprTag::Dot | ExprTag::Index if !callee.is_chain_root() => {
                get_property_name(Node::Expr(callee))
            }
            _ => callee.as_ident().map(Name::bytes),
        }
    }

    /// Collects the nodes that upstream's visitors do something at.
    fn start(&mut self) {
        if std::mem::replace(&mut self.is_started, true) {
            return;
        }
        let file = self.file;
        let pragmas = *self.pragmas();
        let mentions = |name: &[u8]| std::str::from_utf8(name).is_ok_and(|it| file.mentions(it));
        // With a stage, when `components.list()` is called shows: nothing is left out.
        let has_stages = !self.stages.is_empty();

        // CallExpression
        let properties = self.wrapper_functions().iter().map(|it| it.property);
        if properties.clone().any(|it| it.is_none_or(mentions)) {
            let properties: SmallVec<[Option<&[u8]>; 4]> = properties.collect();
            for call in file.exprs_of_kind(ExprTag::Call) {
                let callee = call.callee().and_then(Components::name_of_callee);
                if properties.contains(&callee) {
                    self.push(Node::Expr(call));
                }
            }
        }
        // ClassExpression, ClassDeclaration
        for class in file.classes() {
            if is_es6_component(class, &pragmas) {
                self.push(Node::Class(class));
            }
        }
        // ObjectExpression
        if mentions_create_class(file, pragmas.create_class) {
            let calls = [ExprTag::Call, ExprTag::New].map(|tag| file.exprs_of_kind(tag));
            for call in calls.into_iter().flatten().filter_map(Expr::as_call_like) {
                for argument in call.args() {
                    let node = Node::Expr(argument);
                    if argument.tag() == ExprTag::Object && is_es5_component(node, &pragmas) {
                        self.push(node);
                    }
                }
            }
        }
        // FunctionExpression, FunctionDeclaration, ArrowFunctionExpression
        let can_return_jsx_or_null =
            file.has_exprs([ExprTag::Jsx, ExprTag::Null]) || file.mentions("createElement");
        for func in file
            .funcs()
            .filter(|it| ast_utils::is_function_with_body(*it))
        {
            let node = Node::Func(func);
            // No function is a component that does not return JSX or `null`.
            if has_stages
                || (func.is_async() && func.is_generator())
                || (can_return_jsx_or_null && self.is_returning_jsx_or_null(node, Branches::Any))
            {
                self.push(node);
            }
        }
        // ThisExpression
        if has_stages {
            let this_expressions = file.exprs_of_kind(ExprTag::This);
            for e in this_expressions.filter(|it| !it.is_jsx_tag_name()) {
                self.push(Node::Expr(e));
            }
        }
        // MemberExpression of propTypes.js and defaultProps.js
        if file.mentions_any(&["propTypes", "defaultProps", "getDefaultProps"]) {
            let members = [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag));
            for node in members.into_iter().flatten().map(Node::Expr) {
                if is_prop_types_declaration(node) || is_default_props_declaration(node) {
                    self.push(node);
                }
            }
        }

        let queue = &mut self.queue;
        for (stage, rank) in self.stages.iter().flatten().zip(1u8..) {
            stage.nodes(file, &mut |node, visit| {
                queue.push(At::enter(node), rank, node);
                if visit == Visit::EnterAndExit {
                    queue.push(At::exit(node), rank, node);
                }
            });
        }
    }

    /// `detectionInstructions`, and the one thing that propTypes.js and defaultProps.js do to the
    /// list.
    fn detect(&mut self, node: Node<'a>) {
        match node {
            Node::Expr(e) => match e.kind() {
                ExprKind::Call(call) => {
                    if self.is_pragma_component_wrapper(node)
                        && call.args().first().is_some_and(|it| it.as_fn().is_some())
                    {
                        self.add(node, 2);
                    }
                }
                ExprKind::Object(_) => {
                    self.add(node, 2);
                }
                // What it bans nobody asks for. On the way it can ask for the list.
                ExprKind::This => {
                    self.get_parent_stateless_component(node);
                }
                _ => {
                    self.get_related_component(e);
                }
            },
            Node::Func(func) if func.is_async() && func.is_generator() => {
                self.add(node, 0);
            }
            Node::Func(_) => {
                if let Some(component) = self.get_stateless_component(node) {
                    self.add(component, 2);
                }
            }
            _ => {
                self.add(node, 2);
            }
        }
    }

    fn instruct(&mut self, stage: usize, moment: Moment<'a>) {
        let Some(mut instructions) = self.stages.get_mut(stage).and_then(Option::take) else {
            return;
        };
        match moment {
            Moment::Enter(node) => instructions.enter(node, self),
            Moment::Exit(node) => instructions.exit(node, self),
            Moment::ProgramExit => instructions.program_exit(self),
        }
        if let Some(place) = self.stages.get_mut(stage) {
            *place = Some(instructions);
        }
    }

    /// Does what upstream's visitors have done when the rule's listener is called at `to`. It
    /// never goes back.
    pub(crate) fn advance(&mut self, to: At) {
        self.start();
        while let Some(event) = self.queue.pop_until(to) {
            match event.rank.checked_sub(1).map(usize::from) {
                None => self.detect(event.node),
                Some(stage) if event.at.is_exit() => {
                    self.instruct(stage, Moment::Exit(event.node));
                }
                Some(stage) => self.instruct(stage, Moment::Enter(event.node)),
            }
        }
    }

    /// The rest of the walk, and the `Program:exit` of the stages.
    pub(crate) fn finish(&mut self) {
        self.advance(At::END);
        if std::mem::replace(&mut self.is_finished, true) {
            return;
        }
        for stage in 0..self.stages.len() {
            self.instruct(stage, Moment::ProgramExit);
        }
    }

    // ───────────────────────────── components ─────────────────────────────

    pub(crate) fn add(&mut self, node: Node<'a>, confidence: u8) -> ComponentId {
        let id = self.list.add(node, confidence);
        if confidence >= 2
            && let Some(name) = name_of_detected_component(normalize(node))
        {
            let detected = self.detected.entry(name).or_default();
            if detected.last() != Some(&id) {
                detected.push(id);
            }
        }
        id
    }

    pub(crate) fn get(&self, node: Node<'a>) -> Option<ComponentId> {
        self.list.get(node)
    }

    pub(crate) fn set(&mut self, node: Node<'a>) -> Option<ComponentId> {
        self.list.set(node)
    }

    pub(crate) fn list(&mut self) -> Vec<ComponentId> {
        self.list.list()
    }

    pub(crate) fn length(&self) -> usize {
        self.list.length()
    }

    pub(crate) fn component(&self, id: ComponentId) -> &Component<'a> {
        self.list.component(id)
    }

    pub(crate) fn component_mut(&mut self, id: ComponentId) -> &mut Component<'a> {
        self.list.component_mut(id)
    }

    // ───────────────────────────── utils ─────────────────────────────

    /// `isDestructuredFromPragmaImport`
    pub(crate) fn is_destructured_from_pragma_import(
        &self,
        node: Node<'a>,
        variable: Name<'a>,
    ) -> bool {
        is_destructured_from_pragma_import(node, variable, self.pragmas().pragma)
    }

    /// `ask(node)`. What it says of a function is remembered as the answer to `question`.
    fn is_returning(&self, node: Node<'a>, question: u8, ask: &dyn Fn(Node<'a>) -> bool) -> bool {
        let Node::Func(func) = normalize(node) else {
            return ask(node);
        };
        let bit = 1 << question;
        let known = self.returning.borrow().get(&func).copied();
        if let Some(known) = known.filter(|it| it.asked & bit != 0) {
            return known.answers & bit != 0;
        }
        let answer = ask(node);
        let mut returning = self.returning.borrow_mut();
        let known = returning.entry(func).or_default();
        known.asked |= bit;
        known.answers |= u8::from(answer) << question;
        answer
    }

    /// `isReturningJSX`
    pub(crate) fn is_returning_jsx(&self, node: Node<'a>, branches: Branches) -> bool {
        let pragma = self.pragmas().pragma;
        self.is_returning(node, u8::from(branches == Branches::All), &|node| {
            util_jsx::is_returning_jsx(node, pragma, branches, Nulls::Ignore)
        })
    }

    /// `isReturningJSXOrNull`
    pub(crate) fn is_returning_jsx_or_null(&self, node: Node<'a>, branches: Branches) -> bool {
        let pragma = self.pragmas().pragma;
        self.is_returning(node, 2 + u8::from(branches == Branches::All), &|node| {
            util_jsx::is_returning_jsx(node, pragma, branches, Nulls::Count)
        })
    }

    /// `isReturningOnlyNull`
    pub(crate) fn is_returning_only_null(&self, node: Node<'a>) -> bool {
        self.is_returning(node, 4, &util_jsx::is_returning_only_null)
    }

    /// `getPragmaComponentWrapper`: the outermost of the calls of wrapper functions around `node`.
    pub(crate) fn get_pragma_component_wrapper(&mut self, node: Node<'a>) -> Option<Expr<'a>> {
        let mut current_node = node;
        let mut prev_node = None;
        while let Parent::CallExpression(call) = Parent::of(current_node)
            && self.is_pragma_component_wrapper(Node::Expr(call))
        {
            current_node = Node::Expr(call);
            prev_node = Some(call);
        }
        prev_node
    }

    /// `nodeWrapsComponent`: whether `memo` or `forwardRef` wraps a component that is detected by
    /// now, or makes a new one.
    fn node_wraps_component(&mut self, node: Call<'a>) -> bool {
        let child_component = node.args().first().and_then(|first| {
            let wrapped = self.wrapped.entry(first);
            *wrapped.or_insert_with(|| get_name_of_wrapped_component(node.args()))
        });
        // `getDetectedComponents` asks for the list, which moves the props that are used.
        if !self.stages.is_empty() {
            self.list.list_in_the_walk();
        }
        child_component
            .and_then(|it| self.detected.get(&it))
            .is_some_and(|detected| {
                let mut detected = detected.iter().map(|&id| self.list.component(id));
                detected.any(|it| it.confidence >= 2)
            })
    }

    /// `isPragmaComponentWrapper`. It depends on the time.
    pub(crate) fn is_pragma_component_wrapper(&mut self, node: Node<'a>) -> bool {
        let Some(call) = node.as_expr().and_then(Expr::as_call) else {
            return false;
        };
        let callee = call.callee();
        let name = Components::name_of_callee(callee);
        if matches!(callee.tag(), ExprTag::Dot | ExprTag::Index) && !callee.is_chain_root() {
            let object = callee.object().and_then(Expr::as_ident).map(Name::bytes);
            let is_wrapper = self
                .wrapper_functions()
                .iter()
                .any(|it| it.object.is_some() && it.object == object && it.property == name);
            return is_wrapper && !self.node_wraps_component(call);
        }
        let pragma = self.pragmas().pragma;
        self.wrapper_functions().iter().any(|it| {
            it.property == name
                && it.object.is_none_or(|object| {
                    // Functions coming from the current pragma need special handling
                    let name = callee.as_ident().filter(|_| object == pragma);
                    name.is_some_and(|name| self.is_destructured_from_pragma_import(node, name))
                })
        })
    }

    /// `getParentComponent`
    pub(crate) fn get_parent_component(&mut self, node: Node<'a>) -> Option<Node<'a>> {
        let pragmas = *self.pragmas();
        get_parent_es6_component(node, &pragmas)
            .map(Node::Class)
            .or_else(|| get_parent_es5_component(node, &pragmas).map(Node::Expr))
            .or_else(|| self.get_parent_stateless_component(node))
    }

    /// `isInAllowedPositionForComponent`
    fn is_in_allowed_position_for_component(mut node: Node<'a>) -> bool {
        loop {
            match Parent::of(node) {
                Parent::VariableDeclarator(_)
                | Parent::AssignmentExpression(_)
                | Parent::Property(_)
                | Parent::ReturnStatement(_)
                | Parent::ExportDefaultDeclaration
                | Parent::ArrowFunctionExpression(_) => return true,
                Parent::SequenceExpression(sequence)
                    if Some(last_sequence_expression(sequence)) == Parent::written(node) =>
                {
                    node = Node::Expr(sequence);
                }
                _ => return false,
            }
        }
    }

    /// `getStatelessComponent`: `node` if it is a stateless component, or the call of `memo` or
    /// `forwardRef` around it.
    pub(crate) fn get_stateless_component(&mut self, node: Node<'a>) -> Option<Node<'a>> {
        let node = normalize(node);
        let func = node
            .as_func()
            .filter(|it| ast_utils::is_function_with_body(*it))?;
        let id = func.name().map(Ident::bytes);
        let any = Branches::Any;
        if func.kind() == FnKind::Decl {
            return ((id.is_none() || is_first_letter_capitalized(id))
                && self.is_returning_jsx_or_null(node, any))
            .then_some(node);
        }

        let parent = Parent::of(node);
        let left = match parent {
            Parent::AssignmentExpression(assignment) => assignment.left(),
            _ => None,
        };
        let member_on_the_left = left.filter(|it| ast_utils::is_member_expression(*it));
        let is_property_assignment = member_on_the_left.is_some();
        let is_module_exports_assignment = member_on_the_left.is_some_and(|it| {
            it.object().is_some_and(|object| object.is_ident("module"))
                && is_member_called(it, "exports")
        });

        match parent {
            Parent::ExportDefaultDeclaration => {
                return self.is_returning_jsx(node, any).then_some(node);
            }
            Parent::VariableDeclarator(declarator) if self.is_returning_jsx_or_null(node, any) => {
                let name = declarator.pat().as_ident().map(Name::bytes);
                return is_first_letter_capitalized(name).then_some(node);
            }
            // case: const any = () => { return (props) => null }
            // case: const any = () => (props) => null
            Parent::ReturnStatement(_) | Parent::ArrowFunctionExpression(_)
                if !self.is_returning_jsx(node, any) =>
            {
                return None;
            }
            _ => {}
        }

        // case: any = () => { return => null }
        // case: any = () => null
        if let Some(left) = left
            && !is_property_assignment
            && self.is_returning_jsx_or_null(node, any)
        {
            let name = left.as_ident().map(Name::bytes);
            return is_first_letter_capitalized(name).then_some(node);
        }

        let function_around = match parent {
            // case: any = () => () => null
            // case: { any: () => () => null }
            Parent::ArrowFunctionExpression(arrow) => Some(arrow),
            // case: any = function() {return function() {return null;};}
            // case: { any: function() {return function() {return null;};} }
            Parent::ReturnStatement(statement) => {
                if is_first_letter_capitalized(id) {
                    return Some(node);
                }
                // `node.parent.parent.parent` of what is directly in the block of a function.
                statement.parent().as_func()
            }
            _ => None,
        };
        if let Some(name) = function_around.and_then(|it| Parent::of(Node::Func(it)).name())
            && self.is_returning_jsx_or_null(node, any)
        {
            return is_first_letter_capitalized(name).then_some(node);
        }

        if let Parent::Property(property) = parent {
            let key = key_of(property);
            // for case abc = { [someobject.somekey]: props => { ... return not-jsx } }
            if matches!(key.map(Key::kind), Some(KeyKind::Computed(key))
                if ast_utils::is_member_expression(key) && !key.is_chain_root())
                && !self.is_returning_jsx(node, any)
                && !self.is_returning_only_null(node)
            {
                return None;
            }
            // case: { f() { return ... } }
            // case: { f: () => ... }
            if id.is_none() && !key.is_some_and(Key::is_computed) {
                return (is_first_letter_capitalized(get_property_name(property))
                    && self.is_returning_jsx(node, any))
                .then_some(node);
            }
        }

        // Case like `React.memo(() => <></>)` or `React.forwardRef(...)`
        let pragma_component_wrapper = self.get_pragma_component_wrapper(node);
        if let Some(pragma_component_wrapper) = pragma_component_wrapper
            && self.is_returning_jsx_or_null(node, any)
        {
            return Some(Node::Expr(pragma_component_wrapper));
        }

        if !(Components::is_in_allowed_position_for_component(node)
            && self.is_returning_jsx_or_null(node, any))
        {
            return None;
        }

        if Components::is_parent_component_not_stateless_component(func, parent) {
            return None;
        }

        if id.is_some() {
            return is_first_letter_capitalized(id).then_some(node);
        }

        if let Some(left) = member_on_the_left
            && !is_module_exports_assignment
            && !is_first_letter_capitalized(get_property_name(Node::Expr(left)))
        {
            return None;
        }

        if matches!(parent, Parent::Property(_)) && self.is_returning_only_null(node) {
            return None;
        }

        Some(node)
    }

    /// Whether `node` is given to something with the name of a wrapper function: only then what
    /// `get_stateless_component` says of it depends on the time, and the list is asked for.
    fn is_given_to_wrapper(&self, node: Node<'a>) -> bool {
        let Parent::CallExpression(call) = Parent::of(normalize(node)) else {
            return false;
        };
        let name = call.callee().and_then(Components::name_of_callee);
        self.wrapper_functions()
            .iter()
            .any(|it| it.property == name)
    }

    /// The closest scope at or above `scope` whose function is a stateless component, or is given
    /// to a wrapper. Many nodes under many functions go up these once.
    fn closest_candidate(&mut self, scope: Scope<'a>) -> Option<Scope<'a>> {
        let mut passed: SmallVec<[Scope<'a>; 8]> = SmallVec::new();
        let mut current = Some(scope);
        let found = loop {
            let Some(it) = current else {
                break None;
            };
            if let Some(&known) = self.candidates.get(&it) {
                break known;
            }
            passed.push(it);
            let node = it.node();
            if self.is_given_to_wrapper(node) || self.get_stateless_component(node).is_some() {
                break Some(it);
            }
            current = it.parent();
        };
        let passed = passed.into_iter().map(|it| (it, found));
        self.candidates.extend(passed);
        found
    }

    /// `getParentStatelessComponent`
    pub(crate) fn get_parent_stateless_component(&mut self, node: Node<'a>) -> Option<Node<'a>> {
        let way = Way::new(self.file);
        let mut scope = Some(node.scope());
        while let Some(candidate) = scope.and_then(|it| self.closest_candidate(it)) {
            // Many nodes under many functions that are given to wrappers.
            if !way.take(8) {
                return None;
            }
            let found = self.get_stateless_component(candidate.node());
            if found.is_some() {
                return found;
            }
            scope = candidate.parent();
        }
        None
    }

    /// `getRelatedComponent`, for a `MemberExpression`. It adds what it finds to the list.
    pub(crate) fn get_related_component(&mut self, member: Expr<'a>) -> Option<ComponentId> {
        let component_node = self.related.component_node(member)?;
        Some(self.add(component_node, 1))
    }

    /// `isParentComponentNotStatelessComponent`, where `parent` is that of `node`.
    fn is_parent_component_not_stateless_component(node: Func<'a>, parent: Parent<'a>) -> bool {
        let Parent::Property(property) = parent else {
            return false;
        };
        // custom component functions must start with a capital letter
        let starts_with_no_capital = get_property_name(property).is_some_and(|name| {
            let (first, size) = strings::wtf8_codepoint_at(name, 0);
            // `charAt(0)` of a character outside the BMP has no case.
            first > 0xFFFF || name.get(..size).is_some_and(text::is_lower_case)
        });
        // react render function cannot have params
        starts_with_no_capital && node.params_with_this().next().is_some()
    }
}
