use crate::react::is_jsx;
use crate::util_variable::variable_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdMap;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::collections::hash_map::Entry;

/// Enforce JSX maximum depth
pub struct JsxMaxDepth {
    max: u32,
}

const WRONG_DEPTH: Message = Message::new(
    "wrongDepth",
    "Expected the depth of nested jsx elements to be <= {{needed}}, but found {{found}}.",
);
const JSX_MAX_DEPTH: Message = Message::new(
    "",
    "JSX nesting depth of {{depth}} exceeds the configured maximum of {{max}}",
);

#[derive(Default)]
pub struct State<'a> {
    /// The depth of each enclosing element and fragment, innermost last.
    depths: Vec<u32>,
    /// `calculate_variable_jsx_depth`. 0 while it's being computed.
    variables: IdMap<Symbol<'a>, u32>,
    /// The identifiers in braces, each with the braces' `getDepth`.
    containers: Vec<(Expr<'a>, u32)>,
    /// True if an element that contains elements may be assigned to a variable.
    may_assign_nested_jsx: bool,
    found: Vec<Found>,
}

/// A pending report.
struct Found {
    /// The start of the node where upstream's listener finds it.
    listener: u32,
    node: Span,
    depth: u32,
}

impl Rule for JsxMaxDepth {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-max-depth", Kind::None);
    const ON: On = On::new()
        .enter(NodeTags::new().exprs(&[ExprTag::Jsx]))
        .exit(NodeTags::new().exprs(&[ExprTag::Jsx]))
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxMaxDepth {
            max: options.object(0).number("max").map_or(2, |it| it as u32),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_jsx(file) && file.has_exprs([ExprTag::Jsx])).then(State::default)
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let parent = node.parent();
        // `getDepth`. oxlint counts the enclosing elements, whatever is in between.
        let is_child = matches!(parent, Node::Expr(parent) if parent.tag() == ExprTag::Jsx);
        let depth = match cx.state.depths.last() {
            Some(&enclosing_depth) if is_oxlint || is_child => enclosing_depth + 1,
            _ => 0,
        };
        cx.state.depths.push(depth);
        let Some(ExprKind::Jsx(jsx)) = node.as_expr().map(Expr::kind) else {
            return;
        };
        // `hasJSX`. oxlint skips what's in braces.
        let has_jsx = |it: Expr<'a>| {
            it.tag() == ExprTag::Jsx && !(is_oxlint && it.jsx_container_span().is_some())
        };
        // Only elements without child elements are checked.
        if !jsx.children().iter().any(has_jsx) {
            // oxlint adds the depth of the variables inside it. Upstream looks into them separately.
            let inside = if is_oxlint {
                Parts::from_element(jsx).depth(&mut cx.state.variables)
            } else {
                0
            };
            if depth + inside > self.max {
                let node = node.span();
                cx.state.found.push(Found {
                    listener: node.start,
                    node,
                    depth: depth + inside,
                });
            }
        } else if !is_oxlint {
            // These parents are certainly not a reference's `writeExpr`.
            cx.state.may_assign_nested_jsx |= match parent {
                Node::Func(_) | Node::Prop(_) => false,
                Node::Stmt(it) => !matches!(it.tag(), StmtTag::Return | StmtTag::Expr),
                Node::Expr(it) => it.tag() == ExprTag::Assign,
                _ => true,
            };
        }
        if is_oxlint {
            return;
        }
        let values = jsx
            .attrs()
            .iter()
            .filter(|it| it.kind() != PropKind::Spread)
            .filter_map(Prop::value);
        let children = jsx.children().iter().map(|it| (it, depth + 1));
        cx.state.containers.extend(
            values
                .map(|it| (it, 0))
                .chain(children)
                .filter(|it| it.0.tag() == ExprTag::Ident),
        );
    }

    fn exit<'a>(&self, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.depths.pop();
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut found = std::mem::take(&mut cx.state.found);
        // upstream's `JSXExpressionContainer`
        if cx.state.may_assign_nested_jsx {
            let (mut known, mut passing_depths) =
                (Known::default(), FxHashMap::<u32, u32>::default());
            for (expression, base_depth) in std::mem::take(&mut cx.state.containers) {
                let Some(element) = find_jsx_element_or_fragment(expression, &mut known) else {
                    continue;
                };
                let (start, before) = (element.opening_span().start, found.len());
                // If an element is fine at some depth, it's also fine at any lower depth.
                if passing_depths
                    .get(&start)
                    .is_some_and(|it| base_depth <= *it)
                {
                    continue;
                }
                self.check_descendant(expression.span().start, base_depth, element, &mut found);
                if found.len() == before {
                    passing_depths.insert(start, base_depth);
                }
            }
        }
        // Several reports can be at the same node.
        utils::sort::sort_by_key(&mut found, |it| it.listener);
        // oxlint has its own message.
        let (message, depth, max) = match cx.language().is_oxlint {
            true => (JSX_MAX_DEPTH, "depth", "max"),
            false => (WRONG_DEPTH, "found", "needed"),
        };
        for it in found {
            cx.report(it.node, message)
                .data(depth, it.depth)
                .data(max, self.max);
        }
    }
}

impl JsxMaxDepth {
    /// upstream's `checkDescendant`, for the children of `element`.
    fn check_descendant(
        &self,
        listener: u32,
        base_depth: u32,
        element: Jsx<'_>,
        found: &mut Vec<Found>,
    ) {
        let mut pending: SmallVec<[(Jsx<'_>, u32); 8]> = smallvec![(element, base_depth + 1)];
        while let Some((element, depth)) = pending.pop() {
            for node in element.children() {
                let ExprKind::Jsx(jsx) = node.kind() else {
                    continue;
                };
                match node.jsx_container_span() {
                    container if depth > self.max => {
                        found.push(Found {
                            listener,
                            node: container.unwrap_or_else(|| node.span()),
                            depth,
                        });
                    }
                    // Braces have no children.
                    Some(_) => {}
                    None => pending.push((jsx, depth + 1)),
                }
            }
        }
    }
}

/// Caches what `findJSXElementOrFragment` finds for a name from a scope. Also `None` while it's being computed.
type Known<'a> = FxHashMap<(Scope<'a>, Name<'a>), Option<Jsx<'a>>>;

/// upstream's `findJSXElementOrFragment`, for the identifier in the braces.
fn find_jsx_element_or_fragment<'a>(
    start_node: Expr<'a>,
    known: &mut Known<'a>,
) -> Option<Jsx<'a>> {
    let (scope, mut name) = (Node::Expr(start_node).scope(), start_node.as_ident()?);
    let mut names: SmallVec<[Name<'a>; 4]> = SmallVec::new();
    let element = loop {
        // A name that comes up again in the same search is a cycle.
        match known.entry((scope, name)) {
            Entry::Occupied(found) => break *found.get(),
            Entry::Vacant(entry) => entry.insert(None),
        };
        names.push(name);
        let last_write = variable_from_context(Node::Expr(start_node), name)
            .and_then(|it| it.references().rfind(|it| it.is_write()));
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

/// oxlint only: what determines the depth of an element, or of a variable's initializer.
#[derive(Default)]
struct Parts<'a> {
    /// How deeply elements are nested inside it.
    elements_depth: u32,
    /// The variables `a` of the `{a}` children inside it, each with the number of its elements around it. `None` for
    /// `const b = a`.
    variables: SmallVec<[(Symbol<'a>, Option<u32>); 4]>,
    /// How many of them have been resolved.
    known: usize,
}

impl<'a> Parts<'a> {
    fn from_element(jsx: Jsx<'a>) -> Self {
        let mut parts = Parts::default();
        let mut pending: SmallVec<[(Jsx<'a>, u32); 8]> = smallvec![(jsx, 0)];
        while let Some((jsx, level)) = pending.pop() {
            parts.elements_depth = parts.elements_depth.max(level);
            for child in jsx.children() {
                match child.kind() {
                    ExprKind::Jsx(child_jsx) if child.jsx_container_span().is_none() => {
                        pending.push((child_jsx, level + 1))
                    }
                    ExprKind::Ident(_)
                        if child.jsx_container_span().is_some() && !child.is_parenthesized() =>
                    {
                        parts
                            .variables
                            .extend(child.symbol().map(|it| (it, Some(level))));
                    }
                    _ => {}
                }
            }
        }
        parts
    }

    /// `calculate_expression_jsx_depth` of `variable`'s initializer.
    fn from_variable(variable: Symbol<'a>) -> Self {
        let init = match variable.declarations().next().and_then(Declaration::node) {
            Some(Node::VarDecl(declarator)) => declarator.init(),
            _ => None,
        };
        match init.map(|it| (it, it.kind())) {
            Some((_, ExprKind::Jsx(jsx))) => Parts::from_element(jsx),
            Some((ident, ExprKind::Ident(_))) => Parts {
                variables: ident.symbol().map(|it| (it, None)).into_iter().collect(),
                ..Parts::default()
            },
            _ => Parts::default(),
        }
    }

    /// Visits each variable once per file. oxlint visits each one once per starting element, so a variable that it
    /// reaches by two paths only counts on the first.
    fn depth(self, known: &mut IdMap<Symbol<'a>, u32>) -> u32 {
        // Every entry except the first is paired with its variable.
        let mut stack: Vec<(Option<Symbol<'a>>, Parts<'a>)> = vec![(None, self)];
        let mut depth = 0;
        while let Some((_, parts)) = stack.last_mut() {
            if let Some(&(variable, _)) = parts.variables.get(parts.known) {
                parts.known += 1;
                let mut is_new = false;
                known.get_or_insert_with(variable, || {
                    is_new = true;
                    0
                });
                if is_new {
                    stack.push((Some(variable), Parts::from_variable(variable)));
                }
                continue;
            }
            depth =
                parts
                    .variables
                    .iter()
                    .fold(parts.elements_depth, |depth, (variable, level)| {
                        let variable_depth = known.get(*variable).copied().unwrap_or(0);
                        depth.max(match level {
                            Some(level) if variable_depth > 0 => level + variable_depth + 1,
                            Some(_) => 0,
                            None => variable_depth,
                        })
                    });
            if let Some((Some(variable), _)) = stack.pop() {
                known.insert(variable, depth);
            }
        }
        depth
    }
}
