//! `perfectionist/sort-objects`: `rules/sort-objects.ts` and `rules/sort-objects/*` of eslint-plugin-perfectionist.
//! `crate::perfectionist` sorts and reports.

use crate::perfectionist::configuration_if::{Subject, key_name};
use crate::perfectionist::fixes::{FixOptions, range_to_diff};
use crate::perfectionist::options::{Patterns, RuleKind, RuleOptions, SortObjectsOptions};
use crate::perfectionist::sort::{IgnoredForGroup, Sorted};
use crate::perfectionist::{
    Configuration, FileState, Messages, SortingNode, groups, partition, report, sort,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::Cell;

/// `addSafetySemicolonWhenInline: false` on every sorting node.
const FIX_OPTIONS: FixOptions = FixOptions {
    add_safety_semicolon_when_inline: false,
};

/// Enforce sorted objects.
pub struct SortObjects {
    options: RuleOptions,
    /// This rule's own options, one per element of [`RuleOptions::configurations`].
    own: Vec<SortObjectsOptions>,
}

pub struct State(pub(crate) FileState);

const DEPENDENCY_ORDER: &Message = &Message::new(
    "unexpectedObjectsDependencyOrder",
    "Expected dependency \"{{right}}\" to come before \"{{nodeDependentOnRight}}\".",
);
const MISSED_SPACING: &Message = &Message::new(
    "missedSpacingBetweenObjectMembers",
    "Missed spacing between \"{{left}}\" and \"{{right}}\".",
);
const EXTRA_SPACING: &Message = &Message::new(
    "extraSpacingBetweenObjectMembers",
    "Extra spacing between \"{{left}}\" and \"{{right}}\".",
);
const GROUP_ORDER: &Message = &Message::new(
    "unexpectedObjectsGroupOrder",
    "Expected \"{{right}}\" ({{rightGroup}}) to come before \"{{left}}\" ({{leftGroup}}).",
);
const ORDER: &Message =
    &Message::new("unexpectedObjectsOrder", "Expected \"{{right}}\" to come before \"{{left}}\".");

/// Upstream's `availableMessageIds`.
const MESSAGES: Messages = Messages {
    unexpected_order: ORDER,
    unexpected_group_order: GROUP_ORDER,
    unexpected_dependency_order: Some(DEPENDENCY_ORDER),
    missed_spacing: MISSED_SPACING,
    extra_spacing: EXTRA_SPACING,
};

/// `context.id`, which an `eslint-disable` comment names.
const RULE_ID: &[u8] = b"perfectionist/sort-objects";

/// The node the rule sorts: ESLint's `ObjectExpression` or `ObjectPattern`. A destructuring assignment's target is an
/// object literal here and an `ObjectPattern` there.
#[derive(Clone, Copy)]
enum ObjectNode<'a> {
    Literal(Expr<'a>, List<'a, Prop<'a>>),
    Pattern(Pat<'a>, List<'a, PatProp<'a>>),
}

/// ESLint's `Property`, `SpreadElement` or `RestElement` in either kind of object.
#[derive(Clone, Copy)]
enum Member<'a> {
    Prop(Prop<'a>),
    PatProp(PatProp<'a>),
}

impl<'a> ObjectNode<'a> {
    fn node(self) -> Node<'a> {
        match self {
            ObjectNode::Literal(e, _) => Node::Expr(e),
            ObjectNode::Pattern(p, _) => Node::Pat(p),
        }
    }

    fn span(self) -> Span {
        self.node().span()
    }

    fn len(self) -> usize {
        match self {
            ObjectNode::Literal(_, props) => props.len(),
            ObjectNode::Pattern(_, props) => props.len(),
        }
    }

    /// `node.type === AST_NODE_TYPES.ObjectPattern`
    fn is_destructured(self) -> bool {
        match self {
            ObjectNode::Literal(e, _) => e.is_assignment_target(),
            ObjectNode::Pattern(..) => true,
        }
    }

    fn members(self) -> impl Iterator<Item = Member<'a>> + Clone {
        let (props, pat_props) = match self {
            ObjectNode::Literal(_, props) => (Some(props.iter()), None),
            ObjectNode::Pattern(_, props) => (None, Some(props.iter())),
        };
        props
            .into_iter()
            .flatten()
            .map(Member::Prop)
            .chain(pat_props.into_iter().flatten().map(Member::PatProp))
    }
}

impl<'a> Member<'a> {
    fn node(self) -> Node<'a> {
        match self {
            Member::Prop(prop) => Node::Prop(prop),
            Member::PatProp(prop) => Node::PatProp(prop),
        }
    }

    fn span(self) -> Span {
        match self {
            Member::Prop(prop) => prop.span(),
            Member::PatProp(prop) => prop.span(),
        }
    }

    /// `None` for a `SpreadElement` or a `RestElement`.
    fn key(self) -> Option<Key<'a>> {
        match self {
            Member::Prop(prop) => prop.key(),
            Member::PatProp(prop) => prop.key(),
        }
    }

    fn is_computed(self) -> bool {
        match self {
            Member::Prop(prop) => prop.has_computed_key(),
            Member::PatProp(prop) => prop.has_computed_key(),
        }
    }

    /// The `method` selector: the value is a `FunctionExpression` or an `ArrowFunctionExpression`. A pattern's
    /// property has a pattern or an `AssignmentPattern` for a value, so it is always a `property`.
    fn is_method(self) -> bool {
        match self {
            Member::Prop(prop) => prop.value().is_some_and(|value| value.as_fn().is_some()),
            Member::PatProp(_) => false,
        }
    }

    /// Upstream's `computeNodeValue`, with `''` for its `null`: the text of a default value, or of a literal's value,
    /// unless that is a function.
    fn value(self, file: &'a File<'a>, is_destructured: bool) -> &'a [u8] {
        let value = match self {
            Member::PatProp(prop) => prop.default(),
            Member::Prop(prop) => match prop.value() {
                Some(value) if value.tag() == ExprTag::Assign && is_destructured => value.right(),
                Some(_) if is_destructured => None,
                value => value,
            },
        };
        match value {
            Some(value) if value.as_fn().is_none() => file.slice(value.span()),
            _ => b"",
        }
    }
}

/// Upstream's `computeDependencyNames`: the names a pattern binds, without duplicates. For an assignment target the
/// pattern is an expression: an identifier, a default, or an array or object of those.
fn dependency_names<'a>(member: Member<'a>) -> SmallVec<[Name<'a>; 1]> {
    let mut names: SmallVec<[Name<'a>; 1]> = SmallVec::new();
    let mut push = |name: Name<'a>| {
        if !names.contains(&name) {
            names.push(name);
        }
    };
    match member {
        Member::PatProp(prop) => prop.value().for_each_binding(&mut |pat| {
            if let Some(name) = pat.as_ident() {
                push(name);
            }
        }),
        Member::Prop(prop) => {
            let mut pending: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
            pending.extend(prop.value());
            while let Some(e) = pending.pop() {
                match e.kind() {
                    ExprKind::Ident(name) => push(name),
                    ExprKind::Assign { target, .. } | ExprKind::Spread(target) => {
                        pending.push(target);
                    }
                    ExprKind::Object(props) => {
                        pending.extend(props.iter().rev().filter_map(Prop::value));
                    }
                    ExprKind::Array(elements) => pending.extend(elements.iter().rev()),
                    _ => {}
                }
            }
        }
    }
    names
}

/// `computeDependencies` without `useExperimentalDependencyDetection`. In an object literal `a: b = 1` is an
/// assignment, not a default.
fn dependencies_in_default<'a>(member: Member<'a>, is_destructured: bool) -> SmallVec<[Name<'a>; 2]> {
    let mut names: SmallVec<[Name<'a>; 2]> = SmallVec::new();
    let default = match member {
        Member::PatProp(prop) => prop.default(),
        Member::Prop(_) if !is_destructured => None,
        Member::Prop(prop) => prop.value().filter(|value| value.tag() == ExprTag::Assign).and_then(Expr::right),
    };
    // The children go on the stack last first, so they come off in source order.
    let mut pending: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
    pending.extend(default);
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Ident(name) => names.push(name),
            ExprKind::Object(props) => {
                for prop in props.iter().rev() {
                    pending.extend(prop.value());
                    match prop.key().map(Key::kind) {
                        Some(KeyKind::Ident(name)) => names.push(name),
                        Some(KeyKind::Computed(key)) => pending.push(key),
                        _ => {}
                    }
                }
            }
            ExprKind::Cond { test, yes, no } => pending.extend([no, yes, test]),
            ExprKind::Binary { left, right, .. } => pending.extend([right, left]),
            ExprKind::Assign { target, value, .. } => pending.extend([value, target]),
            ExprKind::Call(call) | ExprKind::New(call) => {
                pending.extend(call.args().iter().rev());
                pending.push(call.callee());
            }
            ExprKind::Array(elements) => pending.extend(elements.iter().rev()),
            ExprKind::Template(template) => pending.extend(template.exprs().iter().rev()),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => pending.push(obj),
            ExprKind::Unary { operand, .. }
            | ExprKind::Spread(operand)
            | ExprKind::Await(operand)
            | ExprKind::As { expr: operand, .. }
            | ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Instantiation { expr: operand, .. } => pending.push(operand),
            ExprKind::Yield { value, .. } => pending.extend(value),
            _ => {}
        }
    }
    names
}

/// Upstream's `canHavePropertyDependencies`: a pattern in which some property has a default value or a computed key,
/// anywhere in its nesting. An object literal never has dependencies.
fn can_have_property_dependencies(object: ObjectNode<'_>) -> bool {
    match object {
        ObjectNode::Pattern(pat, _) => pattern_may_contain_references(pat),
        ObjectNode::Literal(e, _) => e.is_assignment_target() && target_may_contain_references(e),
    }
}

/// `mayContainReferences` over a binding pattern.
fn pattern_may_contain_references(pat: Pat<'_>) -> bool {
    match pat.kind() {
        PatKind::Missing | PatKind::Ident(_) => false,
        PatKind::Object(props) => props.iter().any(|prop| {
            prop.has_computed_key()
                || prop.default().is_some()
                || pattern_may_contain_references(prop.value())
        }),
        PatKind::Array(elems) => elems.iter().any(|elem| {
            elem.default().is_some() || elem.pat().is_some_and(pattern_may_contain_references)
        }),
    }
}

/// `mayContainReferences` over a destructuring assignment's target, where the patterns are expressions.
fn target_may_contain_references(target: Expr<'_>) -> bool {
    match target.kind() {
        ExprKind::Ident(_) | ExprKind::Missing => false,
        ExprKind::Object(props) => props.iter().any(|prop| {
            prop.has_computed_key() || prop.value().is_some_and(target_may_contain_references)
        }),
        ExprKind::Array(elements) => elements.iter().any(target_may_contain_references),
        ExprKind::Spread(argument) => target_may_contain_references(argument),
        _ => true,
    }
}

/// `isStyleComponent`
fn is_style_component(object: ObjectNode<'_>) -> bool {
    let ObjectNode::Literal(mut root, _) = object else {
        return false;
    };
    if root.is_assignment_target() {
        return false;
    }
    while let Node::Prop(prop) = root.parent()
        && let Node::Expr(outer) = prop.parent()
        && outer.tag() == ExprTag::Object
        && !outer.is_assignment_target()
    {
        root = outer;
    }
    let parent = root.parent();
    if is_style_node(parent) {
        return true;
    }
    // The arrow's `Func` is a level of its own here: its owner is the `Fn` expression, whose parent is what upstream
    // reads as `ArrowFunctionExpression.parent`.
    match parent {
        Node::Func(func) if func.is_arrow() => is_style_node(func.owner().parent()),
        _ => false,
    }
}

/// Upstream's `isStyleNode`.
fn is_style_node(node: Node<'_>) -> bool {
    match node {
        Node::Prop(attribute) => {
            attribute.is_jsx_attribute() && attribute.key().is_some_and(|key| key.is("style"))
        }
        Node::Expr(e) => e.as_call().is_some_and(|call| {
            let callee = call.callee();
            callee.is_ident("css")
                || callee.object().is_some_and(|object| object.is_ident("styled"))
                || callee.as_call().is_some_and(|inner| inner.callee().is_ident("styled"))
        }),
        _ => false,
    }
}

impl SortObjects {
    /// Upstream's `sortObject`.
    fn sort_object<'a>(&self, object: ObjectNode<'a>, cx: &mut Cx<'a, Self>) {
        if object.len() <= 1 {
            return;
        }
        let file = cx.file();
        let state = &cx.state.0;
        let is_destructured = object.is_destructured();
        let subject = Subject::Object {
            node: object.node(),
            is_destructured,
        };
        let names = object.members().filter_map(Member::key).map(|key| key_name(file, key));
        let Some((config, index)) = state.pick(&self.options, subject, &names, cx, object.span()) else {
            return;
        };
        let Some(own) = self.own.get(index) else {
            return;
        };
        if !own.styled_components && is_style_component(object) {
            return;
        }
        let can_have_dependencies = can_have_property_dependencies(object);
        if !report::can_report_errors(config, can_have_dependencies) {
            return;
        }
        let disabled_lines = state.disabled_lines(file, RULE_ID);
        let for_comparison = |with_size: bool| {
            object.members().filter_map(move |member| {
                let span = member.span();
                let name = key_name(file, member.key()?);
                let value = member.value(file, is_destructured);
                let size = if with_size { range_to_diff(file, span) } else { 0 };
                Some(SortingNode::for_comparison(span, name, value, size))
            })
        };
        if report::is_in_order_without_groups(config, can_have_dependencies, disabled_lines, for_comparison) {
            return;
        }

        let mut nodes: Vec<SortingNode<'a>> = Vec::with_capacity(object.len());
        let mut members: Vec<Member<'a>> = Vec::with_capacity(object.len());
        let mut partition_id = 1;
        let mut last: Option<Span> = None;
        for member in object.members() {
            let Some(key) = member.key() else {
                partition_id += 1;
                last = None;
                continue;
            };
            if !is_destructured && own.partition_by_computed_key && member.is_computed() {
                partition_id += 1;
                last = None;
                continue;
            }
            let span = member.span();
            let selectors: &[&str] = match member.is_method() {
                true => &["method", "member"],
                false => &["property", "member"],
            };
            let modifiers: &[&str] = match file.line_of(span.start) == file.line_of(span.end) {
                true => &[],
                false => &["multiline"],
            };
            let name = key_name(file, key);
            let value = member.value(file, is_destructured);
            let group = match groups::compute_group(config, selectors, modifiers, name, value) {
                Ok(group) => group,
                Err(message) => {
                    cx.throw(object.span(), "SyntaxError", message);
                    return;
                }
            };
            match partition::should_partition(file, config, last, span, None) {
                Ok(true) => partition_id += 1,
                Ok(false) => {}
                Err(message) => {
                    cx.throw(object.span(), "SyntaxError", message);
                    return;
                }
            }
            let dependencies = match own.use_experimental_dependency_detection {
                true => SmallVec::new(),
                false => dependencies_in_default(member, is_destructured),
            };
            nodes.push(SortingNode {
                span,
                outer_span: span,
                name: Cow::Borrowed(name),
                value,
                size: range_to_diff(file, span),
                group,
                group_index: groups::group_index(config, group),
                partition_id,
                is_eslint_disabled: disabled_lines.contains(file, span),
                dependency_names: match is_destructured {
                    true => dependency_names(member),
                    false => SmallVec::new(),
                },
                dependencies,
            });
            members.push(member);
            last = Some(span);
        }

        if can_have_dependencies
            && own.use_experimental_dependency_detection
            && let Err(message) = add_dependencies_outside_deferred_functions(
                file,
                &mut nodes,
                &members,
                &own.ignore_callback_dependencies_patterns,
            )
        {
            cx.throw(object.span(), "SyntaxError", message);
            return;
        }

        let reached_invalid_locale = Cell::new(false);
        let sorted = Sorted {
            all: sort_nodes_by_dependencies(&nodes, config, false, &reached_invalid_locale),
            without_disabled: sort_nodes_by_dependencies(
                &nodes,
                config,
                true,
                &reached_invalid_locale,
            ),
        };
        if reached_invalid_locale.get()
            && let Some(message) = &config.invalid_locale
        {
            cx.throw(object.span(), "RangeError", message.clone());
            return;
        }
        report::report_all_errors(cx, &MESSAGES, &nodes, &sorted, config, FIX_OPTIONS);
    }
}

/// Upstream's `sortNodesExcludingEslintDisabled`: by groups within each partition, then by dependencies.
fn sort_nodes_by_dependencies(
    nodes: &[SortingNode<'_>],
    config: &Configuration,
    ignore_eslint_disabled: bool,
    reached_invalid_locale: &Cell<bool>,
) -> Vec<u32> {
    let by_groups = sort::sort_nodes_by_groups(
        nodes,
        config,
        ignore_eslint_disabled,
        IgnoredForGroup::Nothing,
        reached_invalid_locale,
    );
    sort::sort_nodes_by_dependencies(nodes, &by_groups, ignore_eslint_disabled)
}

/// `computeDependenciesOutsideDeferredFunctionsBySortingNode` with `populateSortingNodeGroupsWithDependencies`.
/// `Err` is a pattern of `ignoreCallbackDependenciesPatterns` that does not compile.
fn add_dependencies_outside_deferred_functions<'a, 'p>(
    file: &'a File<'a>,
    nodes: &mut [SortingNode<'a>],
    members: &[Member<'a>],
    ignore_callback_dependencies_patterns: &'p Patterns,
) -> Result<(), &'p str> {
    let (Some(first), Some(last)) = (nodes.first(), nodes.last()) else {
        return Ok(());
    };
    let range = Span::new(first.span.start, last.span.end);
    let node_containing = |at: Span| -> Option<usize> {
        let after = nodes.partition_point(|node| node.span.start <= at.start);
        let index = after.checked_sub(1)?;
        nodes.get(index)?.span.contains(at).then_some(index)
    };
    let mut edges: SmallVec<[(usize, usize); 4]> = SmallVec::new();
    for reference in file.references_within(range) {
        let Some(symbol) = reference.symbol() else {
            continue;
        };
        let Some(referencing) = node_containing(reference.span()) else {
            continue;
        };
        let Some(max_parent) = members.get(referencing) else {
            continue;
        };
        if is_node_inside_deferred_function(
            reference.node(),
            max_parent.node(),
            ignore_callback_dependencies_patterns,
        )? {
            continue;
        }
        let Some(declared) = symbol.declarations().next().and_then(Declaration::name_span) else {
            continue;
        };
        if let Some(referenced) = node_containing(declared)
            && referenced != referencing
        {
            edges.push((referencing, referenced));
        }
    }
    for (referencing, referenced) in edges {
        let names = nodes.get(referenced).map(|node| node.dependency_names.clone());
        if let (Some(node), Some(names)) = (nodes.get_mut(referencing), names) {
            node.dependencies.extend(names);
        }
    }
    Ok(())
}

/// `isNodeInsideDeferredFunction`
fn is_node_inside_deferred_function<'a, 'p>(
    node: Node<'a>,
    max_parent: Node<'a>,
    ignore_callback_dependencies_patterns: &'p Patterns,
) -> Result<bool, &'p str> {
    let ancestors = || node.ancestors().take_while(|ancestor| *ancestor != max_parent);
    if !ignore_callback_dependencies_patterns.0.is_empty() {
        for ancestor in ancestors() {
            if let Node::Expr(e) = ancestor
                && let Some(call) = e.as_call()
                && let Some(name) = call.callee().as_ident()
                && ignore_callback_dependencies_patterns.first_match(name.bytes())?
            {
                return Ok(true);
            }
        }
    }
    for ancestor in ancestors() {
        let Node::Func(func) = ancestor else {
            continue;
        };
        let is_deferred = match func.owner() {
            // A method of a class: its parent is the `MethodDefinition`.
            Node::Member(_) => func.kind() != FnKind::StaticBlock,
            Node::Expr(e) => match e.parent() {
                Node::Expr(parent) => {
                    parent.as_call().is_none()
                        && !parent.as_new().is_some_and(|new| new.callee() == e)
                }
                _ => true,
            },
            _ => false,
        };
        if is_deferred {
            return Ok(true);
        }
    }
    Ok(false)
}

impl Rule for SortObjects {
    const META: Meta = Meta::plugin(Plugin::Perfectionist, "sort-objects", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().exprs(&[ExprTag::Object]).pats(&[PatTag::Object]);
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        SortObjects {
            options: RuleOptions::new(options, RuleKind::Objects),
            own: SortObjectsOptions::parse_all(options),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        RuleOptions::validate(options)
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        Some(State(self.options.file_state(file.settings())))
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(props) = expr.as_object() else {
            return;
        };
        // The `{ .. }` of `with { type: "json" }` is an `ImportAttribute` list, not an object.
        if expr.owner_of_import_attributes().is_some() {
            return;
        }
        self.sort_object(ObjectNode::Literal(expr, props), cx);
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(props) = pat.kind() else {
            return;
        };
        self.sort_object(ObjectNode::Pattern(pat, props), cx);
    }
}
