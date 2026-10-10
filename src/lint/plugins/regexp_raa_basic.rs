#![allow(dead_code)] // until every rule of the plugin is written
//! `basic.ts` of regexp-ast-analysis: the questions about a node that need no flags.

use bun_lint::regex::ast as re;
use smallvec::SmallVec;

/// `node.alternatives`
pub(crate) fn alternatives_of<'r>(node: re::Node<'r>) -> Option<re::Nodes<'r>> {
    match node.kind() {
        re::Kind::Pattern { alternatives }
        | re::Kind::Group { alternatives, .. }
        | re::Kind::CapturingGroup { alternatives, .. }
        | re::Kind::Assertion(
            re::Assertion::Lookahead { alternatives, .. }
            | re::Assertion::Lookbehind { alternatives, .. },
        )
        | re::Kind::ClassStringDisjunction { alternatives } => Some(alternatives),
        _ => None,
    }
}

/// upstream's `hasSomeAncestor`: from the closest to the farthest, not the node itself.
pub(crate) fn has_some_ancestor<'r>(
    node: re::Node<'r>,
    condition: &mut dyn FnMut(re::Node<'r>) -> bool,
) -> bool {
    node.ancestors().any(condition)
}

/// upstream's `hasSomeDescendant`: the node itself first. `descent` is asked about a node for
/// which `condition` was false: whether to look below it.
pub(crate) fn has_some_descendant<'r>(
    node: re::Node<'r>,
    condition: &mut dyn FnMut(re::Node<'r>) -> bool,
    descent: Option<&mut dyn FnMut(re::Node<'r>) -> bool>,
) -> bool {
    match descent {
        Some(descent) => has_some_descendant_impl(node, condition, descent),
        None => has_some_descendant_impl(node, condition, &mut |_| true),
    }
}

/// upstream's `hasSomeDescendantImpl`. It does not know the modifiers of a group.
fn has_some_descendant_impl<'r>(
    node: re::Node<'r>,
    condition_fn: &mut dyn FnMut(re::Node<'r>) -> bool,
    descent_condition_fn: &mut dyn FnMut(re::Node<'r>) -> bool,
) -> bool {
    if condition_fn(node) {
        return true;
    }

    if !descent_condition_fn(node) {
        return false;
    }

    if let Some(alternatives) = alternatives_of(node) {
        return alternatives
            .iter()
            .any(|a| has_some_descendant_impl(a, condition_fn, descent_condition_fn));
    }
    match node.kind() {
        re::Kind::Alternative { elements }
        | re::Kind::CharacterClass { elements, .. }
        | re::Kind::StringAlternative { elements } => elements
            .iter()
            .any(|e| has_some_descendant_impl(e, condition_fn, descent_condition_fn)),
        re::Kind::ClassIntersection {
            left: first,
            right: second,
        }
        | re::Kind::ClassSubtraction {
            left: first,
            right: second,
        }
        | re::Kind::CharacterClassRange {
            min: first,
            max: second,
        }
        | re::Kind::RegExpLiteral {
            pattern: first,
            flags: second,
        } => {
            has_some_descendant_impl(first, condition_fn, descent_condition_fn)
                || has_some_descendant_impl(second, condition_fn, descent_condition_fn)
        }
        re::Kind::ExpressionCharacterClass {
            expression: only, ..
        }
        | re::Kind::Quantifier { element: only, .. } => {
            has_some_descendant_impl(only, condition_fn, descent_condition_fn)
        }
        _ => false,
    }
}

/// upstream's `getCapturingGroupNumber`: the number that a backreference has for the group.
pub(crate) fn get_capturing_group_number(group: re::Node<'_>) -> u32 {
    let mut found = 0;
    for node in group.ast().capturing_groups() {
        found += 1;
        if node == group {
            break;
        }
    }
    found
}

/// upstream's `MatchingDirection`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum MatchingDirection {
    Ltr,
    Rtl,
}

/// upstream's `OptionalMatchingDirection`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum OptionalMatchingDirection {
    Ltr,
    Rtl,
    Unknown,
}

impl MatchingDirection {
    /// upstream's `invertMatchingDirection`
    pub(crate) fn invert(self) -> Self {
        match self {
            MatchingDirection::Ltr => MatchingDirection::Rtl,
            MatchingDirection::Rtl => MatchingDirection::Ltr,
        }
    }
}

/// upstream's `getMatchingDirection`: that of the closest lookaround around the node.
pub(crate) fn get_matching_direction(node: re::Node<'_>) -> MatchingDirection {
    let closest_lookaround = node.ancestors().find_map(|a| match a.kind() {
        re::Kind::Assertion(assertion) => Some(assertion),
        _ => None,
    });

    match closest_lookaround {
        None | Some(re::Assertion::Lookahead { .. }) => MatchingDirection::Ltr,
        Some(_) => MatchingDirection::Rtl,
    }
}

/// upstream's `getMatchingDirectionFromAssertionKind`
pub(crate) fn get_matching_direction_from_assertion_kind(
    assertion: &re::Assertion<'_>,
) -> MatchingDirection {
    match assertion {
        re::Assertion::End | re::Assertion::Lookahead { .. } => MatchingDirection::Ltr,
        _ => MatchingDirection::Rtl,
    }
}

/// upstream's `isStrictBackreference`: whether its group has always matched before it. Upstream
/// throws if the name is that of several groups: not strict here.
pub(crate) fn is_strict_backreference(backreference: re::Node<'_>) -> bool {
    let re::Kind::Backreference {
        ambiguous: false,
        resolved,
        ..
    } = backreference.kind()
    else {
        return false;
    };
    let Some(group) = resolved.first() else {
        return false;
    };

    let Some(closest_ancestor) = get_closest_ancestor(&[backreference, group]) else {
        return false;
    };

    if closest_ancestor == group {
        return false;
    }

    if closest_ancestor.ty() != re::NodeType::Alternative {
        // They are in two alternatives.
        return false;
    }

    // `backRefAncestors.has(it)`: nothing else reaches from where it starts to where it ends.
    let is_around_backreference =
        |it: re::Node<'_>| it.start() <= backreference.start() && backreference.end() <= it.end();

    // `findBackreference`, which calls itself with `node`.
    let mut node = group;
    let mut direction = get_matching_direction(node);
    while let Some(parent) = node.parent() {
        match parent.kind() {
            re::Kind::Alternative { .. } => {
                // Whether one of the elements that are matched after `node` has the backreference.
                let is_after_node = match direction {
                    MatchingDirection::Ltr => node.end() <= backreference.start(),
                    MatchingDirection::Rtl => backreference.end() <= node.start(),
                };
                if is_after_node && is_around_backreference(parent) {
                    return true;
                }

                let Some(parent_parent) = parent.parent() else {
                    return false;
                };
                match parent_parent.kind() {
                    re::Kind::Pattern { .. }
                    | re::Kind::Assertion(
                        re::Assertion::Lookahead { negate: true, .. }
                        | re::Assertion::Lookbehind { negate: true, .. },
                    ) => return false,
                    re::Kind::Assertion(_) => direction = get_matching_direction(parent_parent),
                    _ => {}
                }
                if alternatives_of(parent_parent).is_some_and(|it| it.len() > 1) {
                    return false;
                }
                node = parent_parent;
            }
            re::Kind::Quantifier { min, .. } => {
                if min == 0 {
                    return false;
                }
                node = parent;
            }
            _ => return false,
        }
    }
    false
}

/// upstream's `containsCapturingGroup`: the node is one, or has one.
pub(crate) fn contains_capturing_group(node: re::Node<'_>) -> bool {
    has_some_descendant(node, &mut is_capturing_group, None)
}

fn is_capturing_group(node: re::Node<'_>) -> bool {
    node.ty() == re::NodeType::CapturingGroup
}

/// upstream's `getClosestAncestor`: one of the nodes if it is around the others. `None` without
/// nodes, and where upstream throws: for nodes of two trees.
pub(crate) fn get_closest_ancestor<'r>(nodes: &[re::Node<'r>]) -> Option<re::Node<'r>> {
    let (first, rest) = nodes.split_first()?;
    rest.iter()
        .try_fold(*first, |a, b| get_closest_ancestor_impl(a, *b))
}

fn get_closest_ancestor_impl<'r>(a: re::Node<'r>, b: re::Node<'r>) -> Option<re::Node<'r>> {
    if a == b {
        return Some(a);
    }
    if let Some(parent) = a.parent()
        && b.parent() == Some(parent)
    {
        return Some(parent);
    }
    let mut a_path = get_path_to_root(a);
    let mut b_path = get_path_to_root(b);

    loop {
        match (a_path.last().copied(), b_path.last().copied()) {
            (None, _) => return Some(a),
            (_, None) => return Some(b),
            (Some(a_last), Some(b_last)) if a_last == b_last => {
                a_path.pop();
                b_path.pop();
            }
            (Some(a_last), _) => return a_last.parent(),
        }
    }
}

fn get_path_to_root<'r>(a: re::Node<'r>) -> SmallVec<[re::Node<'r>; 32]> {
    std::iter::once(a).chain(a.ancestors()).collect()
}

/// upstream's `getEffectiveMaximumRepetition`: how often the node can be matched at most, inside
/// the closest lookaround. `Infinity * 0` is `NaN` here as there.
pub(crate) fn get_effective_maximum_repetition(node: re::Node<'_>) -> f64 {
    let mut max = 1.0;
    for n in node.ancestors() {
        match n.kind() {
            re::Kind::Quantifier { max: times, .. } => {
                max *= if times == re::INFINITY {
                    f64::INFINITY
                } else {
                    f64::from(times)
                };
                if max == 0.0 {
                    return 0.0;
                }
            }
            re::Kind::Assertion(_) => break,
            _ => {}
        }
    }
    max
}
