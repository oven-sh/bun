use crate::react::is_jsx;
use crate::util_variable::get_variable_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::collections::hash_map::Entry;

/// Enforce JSX maximum depth
pub struct JsxMaxDepth {
    max: u32,
}

const WRONG_DEPTH: Message =
    Message::new("wrongDepth", "Expected the depth of nested jsx elements to be <= {{needed}}, but found {{found}}.");
const JSX_MAX_DEPTH: Message =
    Message::new("", "JSX nesting depth of {{depth}} exceeds the configured maximum of {{max}}");

#[derive(Default)]
pub struct State<'a> {
    /// The depth of each element and fragment around what comes next, the innermost last.
    depths: Vec<u32>,
    /// `calculate_variable_jsx_depth`. 0 while it is being found out.
    variables: FxHashMap<Symbol<'a>, u32>,
    /// The identifiers in braces, each with the `getDepth` of the braces.
    containers: Vec<(Expr<'a>, u32)>,
    /// Whether an element with elements in it may be what a variable is given.
    is_any_written: bool,
    found: Vec<Found>,
}

/// What is reported.
struct Found {
    /// Where the node starts at which upstream finds it.
    listener: u32,
    node: Span,
    depth: u32,
}

impl Rule for JsxMaxDepth {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-max-depth", Kind::None);
    const ON: On =
        On::new().enter(NodeTags::new().exprs(&[ExprTag::Jsx])).exit(NodeTags::new().exprs(&[ExprTag::Jsx])).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxMaxDepth { max: options.object(0).number("max").map_or(2, |it| it as u32) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_jsx(file) && file.has_exprs([ExprTag::Jsx])).then(State::default)
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let parent = node.parent();
        // `getDepth`. oxlint counts the elements around it, whatever is between.
        let is_child = matches!(parent, Node::Expr(parent) if parent.tag() == ExprTag::Jsx);
        let depth = match cx.state.depths.last() {
            Some(&around) if is_oxlint || is_child => around + 1,
            _ => 0,
        };
        cx.state.depths.push(depth);
        let Some(ExprKind::Jsx(jsx)) = node.as_expr().map(Expr::kind) else {
            return;
        };
        // `hasJSX`. oxlint passes over what is in braces.
        let has_jsx = |it: Expr<'a>| it.tag() == ExprTag::Jsx && !(is_oxlint && it.jsx_container_span().is_some());
        // Only what has no element in it is looked at.
        if !jsx.children().iter().any(has_jsx) {
            // oxlint adds what the variables in it have, where upstream looks into them.
            let inside = if is_oxlint { Parts::of_element(jsx).depth(&mut cx.state.variables) } else { 0 };
            if depth + inside > self.max {
                let node = node.span();
                cx.state.found.push(Found { listener: node.start, node, depth: depth + inside });
            }
        } else if !is_oxlint {
            // What is certainly no `writeExpr` of a reference.
            cx.state.is_any_written |= match parent {
                Node::Func(_) | Node::Prop(_) => false,
                Node::Stmt(it) => !matches!(it.tag(), StmtTag::Return | StmtTag::Expr),
                Node::Expr(it) => it.tag() == ExprTag::Assign,
                _ => true,
            };
        }
        if is_oxlint {
            return;
        }
        let values = jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread).filter_map(Prop::value);
        let children = jsx.children().iter().map(|it| (it, depth + 1));
        cx.state.containers.extend(values.map(|it| (it, 0)).chain(children).filter(|it| it.0.tag() == ExprTag::Ident));
    }

    fn exit<'a>(&self, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.depths.pop();
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut found = std::mem::take(&mut cx.state.found);
        // upstream's `JSXExpressionContainer`
        if cx.state.is_any_written {
            let (mut known, mut fine) = (Known::default(), FxHashMap::<u32, u32>::default());
            for (expression, base_depth) in std::mem::take(&mut cx.state.containers) {
                let Some(element) = find_jsx_element_or_fragment(expression, &mut known) else {
                    continue;
                };
                let (start, before) = (element.opening_span().start, found.len());
                // Where nothing is found in an element, nothing is found with less around it.
                if fine.get(&start).is_some_and(|it| base_depth <= *it) {
                    continue;
                }
                self.check_descendant(expression.span().start, base_depth, element, &mut found);
                if found.len() == before {
                    fine.insert(start, base_depth);
                }
            }
        }
        // Several can be at one node.
        utils::sort::sort_by_key(&mut found, |it| it.listener);
        // oxlint has a text of its own.
        let (message, depth, max) = match cx.language().is_oxlint {
            true => (JSX_MAX_DEPTH, "depth", "max"),
            false => (WRONG_DEPTH, "found", "needed"),
        };
        for it in found {
            cx.report(it.node, message).data(depth, it.depth).data(max, self.max);
        }
    }
}

impl JsxMaxDepth {
    /// upstream's `checkDescendant`, for the children of `element`.
    fn check_descendant(&self, listener: u32, base_depth: u32, element: Jsx<'_>, found: &mut Vec<Found>) {
        let mut pending: SmallVec<[(Jsx<'_>, u32); 8]> = smallvec![(element, base_depth + 1)];
        while let Some((element, depth)) = pending.pop() {
            for node in element.children() {
                let ExprKind::Jsx(jsx) = node.kind() else {
                    continue;
                };
                match node.jsx_container_span() {
                    container if depth > self.max => {
                        found.push(Found { listener, node: container.unwrap_or_else(|| node.span()), depth });
                    }
                    // Braces have no children.
                    Some(_) => {}
                    None => pending.push((jsx, depth + 1)),
                }
            }
        }
    }
}

/// What `findJSXElementOrFragment` finds from a scope for a name. `None` also while it is being found out.
type Known<'a> = FxHashMap<(Scope<'a>, Name<'a>), Option<Jsx<'a>>>;

/// upstream's `findJSXElementOrFragment`, for the identifier in the braces.
fn find_jsx_element_or_fragment<'a>(start_node: Expr<'a>, known: &mut Known<'a>) -> Option<Jsx<'a>> {
    let (file, scope, mut name) = (start_node.file(), Node::Expr(start_node).scope(), start_node.as_ident()?);
    let mut names: SmallVec<[Name<'a>; 4]> = SmallVec::new();
    let element = loop {
        // A name that comes again in one search is a circle.
        match known.entry((scope, name)) {
            Entry::Occupied(found) => break *found.get(),
            Entry::Vacant(entry) => entry.insert(None),
        };
        names.push(name);
        let last_write = match get_variable_from_context(Node::Expr(start_node), name) {
            Some(variable) => {
                // For upstream the name of a class declaration is a second variable inside the class.
                let class = variable.declarations().find_map(|it| match it {
                    Declaration::Class(class) => class.scope(),
                    _ => None,
                });
                let is_in_class = |scope| class.is_some_and(|it| it.contains(scope));
                let is_inner = is_in_class(scope);
                variable.references().rfind(|it| it.is_write() && is_in_class(it.scope()) == is_inner)
            }
            // What the configuration defines is a variable for upstream.
            None => (file.global_named(name))
                .and_then(|_| file.unresolved_references_to(name.bytes()).rfind(|it| it.is_write())),
        };
        match last_write.and_then(Reference::write_expr).map(Expr::kind) {
            Some(ExprKind::Jsx(jsx)) => break Some(jsx),
            Some(ExprKind::Ident(next)) => name = next,
            _ => break None,
        }
    };
    if element.is_some() {
        known.extend(names.into_iter().map(|it| ((scope, it), element)));
    }
    element
}

/// For oxlint: what the depth of an element, or of what a variable is initialized with, is made of.
#[derive(Default)]
struct Parts<'a> {
    /// How deeply elements are nested in it.
    elements_depth: u32,
    /// The variables `a` of the children `{a}` in it, with how many elements of it are around each. `None`: `const b =
    /// a`.
    variables: SmallVec<[(Symbol<'a>, Option<u32>); 4]>,
    /// How many of them are known.
    known: usize,
}

impl<'a> Parts<'a> {
    fn of_element(jsx: Jsx<'a>) -> Self {
        let mut parts = Parts::default();
        let mut pending: SmallVec<[(Jsx<'a>, u32); 8]> = smallvec![(jsx, 0)];
        while let Some((jsx, level)) = pending.pop() {
            parts.elements_depth = parts.elements_depth.max(level);
            for child in jsx.children() {
                match child.kind() {
                    ExprKind::Jsx(child_jsx) if child.jsx_container_span().is_none() => {
                        pending.push((child_jsx, level + 1))
                    }
                    ExprKind::Ident(_) if child.jsx_container_span().is_some() && !child.is_parenthesized() => {
                        parts.variables.extend(child.symbol().map(|it| (it, Some(level))));
                    }
                    _ => {}
                }
            }
        }
        parts
    }

    /// `calculate_expression_jsx_depth` of what `variable` is declared with.
    fn of_variable(variable: Symbol<'a>) -> Self {
        let init = match variable.declarations().next().and_then(Declaration::node) {
            Some(Node::VarDecl(declarator)) => declarator.init(),
            _ => None,
        };
        match init.map(|it| (it, it.kind())) {
            Some((_, ExprKind::Jsx(jsx))) => Parts::of_element(jsx),
            Some((ident, ExprKind::Ident(_))) => {
                Parts { variables: ident.symbol().map(|it| (it, None)).into_iter().collect(), ..Parts::default() }
            }
            _ => Parts::default(),
        }
    }

    /// Each variable is looked at once in a file. oxlint looks at each once for every element that it starts from, so
    /// that a variable which it gets to on two ways counts on the first only.
    fn depth(self, known: &mut FxHashMap<Symbol<'a>, u32>) -> u32 {
        // With the variable that each but the first is of.
        let mut stack: Vec<(Option<Symbol<'a>>, Parts<'a>)> = vec![(None, self)];
        let mut depth = 0;
        while let Some((_, parts)) = stack.last_mut() {
            if let Some(&(variable, _)) = parts.variables.get(parts.known) {
                parts.known += 1;
                if let Entry::Vacant(entry) = known.entry(variable) {
                    entry.insert(0);
                    stack.push((Some(variable), Parts::of_variable(variable)));
                }
                continue;
            }
            depth = parts.variables.iter().fold(parts.elements_depth, |depth, (variable, level)| {
                let of_variable = known.get(variable).copied().unwrap_or(0);
                depth.max(match level {
                    Some(level) if of_variable > 0 => level + of_variable + 1,
                    Some(_) => 0,
                    None => of_variable,
                })
            });
            if let Some((Some(variable), _)) = stack.pop() {
                known.insert(variable, depth);
            }
        }
        depth
    }
}
