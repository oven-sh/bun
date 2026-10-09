use crate::react::is_jsx;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::collections::hash_map::Entry;

/// Enforces a maximum depth for nested JSX elements and fragments.
pub struct JsxMaxDepth {
    max: u32,
}

const JSX_MAX_DEPTH: Message =
    Message::new("", "JSX nesting depth of {{depth}} exceeds the configured maximum of {{max}}");

#[derive(Default)]
pub struct State<'a> {
    /// How many elements and fragments are around what comes next.
    ancestor_depth: u32,
    /// `calculate_variable_jsx_depth`. 0 while it is being found out.
    variables: FxHashMap<Symbol<'a>, u32>,
}

impl Rule for JsxMaxDepth {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-max-depth", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxMaxDepth { max: options.object(0).number("max").map_or(2, |it| it as u32) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_jsx(file) && file.has_exprs([ExprTag::Jsx]) {
            on.enter(ExprTag::Jsx, |rule, node, cx| {
                let ancestor_depth = cx.state.ancestor_depth;
                cx.state.ancestor_depth += 1;
                let Some(ExprKind::Jsx(jsx)) = node.as_expr().map(Expr::kind) else {
                    return;
                };
                // Only what has no element in it is looked at.
                if jsx.children().iter().any(|it| it.tag() == ExprTag::Jsx && it.jsx_container_span().is_none()) {
                    return;
                }
                let total_depth = ancestor_depth + Parts::of_element(jsx).depth(&mut cx.state.variables);
                if total_depth > rule.max {
                    cx.report(node, JSX_MAX_DEPTH)
                        .data("depth", total_depth.to_string())
                        .data("max", rule.max.to_string());
                }
            });
            on.exit(ExprTag::Jsx, |_, _, cx| cx.state.ancestor_depth -= 1);
        }
        State::default()
    }
}

/// What the depth of an element, or of what a variable is initialized with, is made of.
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
