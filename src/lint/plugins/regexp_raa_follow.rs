#![allow(dead_code)] // until every rule of the plugin is written
//! `follow.ts` of regexp-ast-analysis: all paths that lead on from an element, as a state that is
//! forked where the paths part and joined where they meet.

use crate::regexp_raa_basic::{
    MatchingDirection, get_matching_direction, get_matching_direction_from_assertion_kind,
};
use bun_lint::regex::ast as re;
use smallvec::SmallVec;

/// upstream's `FollowEndReason`: what has nothing after it in the direction of the path.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum FollowEndReason {
    Pattern,
    Assertion,
}

/// `startMode`: whether the start is the first element to be entered, or the one to go on after.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum StartMode {
    Enter,
    Next,
}

/// upstream's `FollowOperations`. An operation that is left out there is the default here. For an
/// element: `enter`, `continue_into`, what is in it, `leave`, `continue_after`.
pub(crate) trait FollowOperations<'r> {
    type State: Clone;

    /// A new path that parts from this one.
    fn fork(&mut self, state: Self::State, _direction: MatchingDirection) -> Self::State {
        state
    }

    /// One path of any number of them.
    fn join(&mut self, states: Vec<Self::State>, direction: MatchingDirection) -> Self::State;

    /// After a lookaround, with the joined paths through it. Not for `^`, `$`, `\b`, `\B`.
    fn assert(
        &mut self,
        state: Self::State,
        _direction: MatchingDirection,
        _assertion: Self::State,
        _assertion_direction: MatchingDirection,
    ) -> Self::State {
        state
    }

    fn enter(
        &mut self,
        _element: re::Node<'r>,
        state: Self::State,
        _direction: MatchingDirection,
    ) -> Self::State {
        state
    }

    fn leave(
        &mut self,
        _element: re::Node<'r>,
        state: Self::State,
        _direction: MatchingDirection,
    ) -> Self::State {
        state
    }

    /// At the end of the pattern or of a lookaround.
    fn end_path(
        &mut self,
        state: Self::State,
        _direction: MatchingDirection,
        _reason: FollowEndReason,
    ) -> Self::State {
        state
    }

    /// Whether the path goes through what is in the element. If not, `leave` gets the same state.
    fn continue_into(
        &mut self,
        _element: re::Node<'r>,
        _state: &Self::State,
        _direction: MatchingDirection,
    ) -> bool {
        true
    }

    /// Whether the path goes on after the element. A fork that stops is joined like the others.
    fn continue_after(
        &mut self,
        _element: re::Node<'r>,
        _state: &Self::State,
        _direction: MatchingDirection,
    ) -> bool {
        true
    }

    /// Whether the path goes on after the lookaround whose end it has reached from the inside.
    fn continue_outside(
        &mut self,
        _element: re::Node<'r>,
        _state: &Self::State,
        _direction: MatchingDirection,
    ) -> bool {
        false
    }
}

/// upstream's `followPaths`. `start` is an element outside of a character class or an
/// `Alternative`; without a `direction` it is the one in which `start` is matched.
pub(crate) fn follow_paths<'r, O: FollowOperations<'r>>(
    mut start: re::Node<'r>,
    mut start_mode: StartMode,
    mut initial_state: O::State,
    operations: &mut O,
    direction: Option<MatchingDirection>,
) -> O::State {
    let direction = direction.unwrap_or_else(|| get_matching_direction(start));

    if start.ty() == re::NodeType::Alternative {
        // To enter an alternative is to enter its first element, to leave it to leave its parent.
        let first = get_first_element(start, direction);
        if first.is_none() {
            start_mode = StartMode::Next;
        }

        if let Some(first) = first
            && start_mode == StartMode::Enter
        {
            start = first;
        } else {
            let Some(parent) = start.parent() else {
                return initial_state;
            };

            if parent.ty() == re::NodeType::Pattern {
                return operations.end_path(initial_state, direction, FollowEndReason::Pattern);
            } else if parent.ty() == re::NodeType::Assertion
                && !operations.continue_outside(parent, &initial_state, direction)
            {
                return operations.end_path(initial_state, direction, FollowEndReason::Assertion);
            }

            start = parent;
        }
    }

    if start_mode == StartMode::Enter {
        initial_state = op_enter(operations, start, initial_state, direction);
    }
    op_next(operations, start, initial_state, direction)
}

fn op_enter<'r, O: FollowOperations<'r>>(
    operations: &mut O,
    element: re::Node<'r>,
    mut state: O::State,
    direction: MatchingDirection,
) -> O::State {
    state = operations.enter(element, state, direction);

    let continue_into = operations.continue_into(element, &state, direction);
    if continue_into {
        match element.kind() {
            re::Kind::Assertion(
                kind @ (re::Assertion::Lookahead { alternatives, .. }
                | re::Assertion::Lookbehind { alternatives, .. }),
            ) => {
                let assertion_direction = get_matching_direction_from_assertion_kind(&kind);
                let states = alternatives
                    .iter()
                    .map(|a| {
                        let forked = operations.fork(state.clone(), direction);
                        enter_alternative(operations, a, forked, assertion_direction)
                    })
                    .collect();
                let assertion = operations.join(states, assertion_direction);
                state = operations.end_path(state, assertion_direction, FollowEndReason::Assertion);
                state = operations.assert(state, direction, assertion, assertion_direction);
            }
            re::Kind::Group { alternatives, .. }
            | re::Kind::CapturingGroup { alternatives, .. } => {
                let states = alternatives
                    .iter()
                    .map(|a| {
                        let forked = operations.fork(state.clone(), direction);
                        enter_alternative(operations, a, forked, direction)
                    })
                    .collect();
                state = operations.join(states, direction);
            }
            re::Kind::Quantifier { max: 0, .. } => {}
            re::Kind::Quantifier {
                min: 0,
                element: repeated,
                ..
            } => {
                let forked = operations.fork(state.clone(), direction);
                let entered = op_enter(operations, repeated, forked, direction);
                state = operations.join(vec![state, entered], direction);
            }
            re::Kind::Quantifier {
                element: repeated, ..
            } => state = op_enter(operations, repeated, state, direction),
            _ => {}
        }
    }

    operations.leave(element, state, direction)
}

fn enter_alternative<'r, O: FollowOperations<'r>>(
    operations: &mut O,
    alternative: re::Node<'r>,
    mut state: O::State,
    direction: MatchingDirection,
) -> O::State {
    let mut elements = alternative.elements().iter();
    while let Some(element) = match direction {
        MatchingDirection::Ltr => elements.next(),
        MatchingDirection::Rtl => elements.next_back(),
    } {
        state = op_enter(operations, element, state, direction);

        let continue_after = operations.continue_after(element, &state, direction);
        if !continue_after {
            break;
        }
    }

    state
}

fn op_next<'r, O: FollowOperations<'r>>(
    operations: &mut O,
    mut element: re::Node<'r>,
    mut state: O::State,
    direction: MatchingDirection,
) -> O::State {
    loop {
        let mut quantifiers = Quantifiers::new();
        let after = get_next_element(operations, element, &state, direction, &mut quantifiers);
        for quant in quantifiers {
            let forked = operations.fork(state.clone(), direction);
            let entered = op_enter(operations, quant, forked, direction);
            state = operations.join(vec![state, entered], direction);
        }

        match after {
            NextElement::False => return state,
            NextElement::End(reason) => return operations.end_path(state, direction, reason),
            NextElement::Element(after) => {
                state = op_enter(operations, after, state, direction);
                element = after;
            }
        }
    }
}

/// upstream's `NextElement`, but for `[Quantifier, NextElement]`: see [`Quantifiers`].
enum NextElement<'r> {
    False,
    Element(re::Node<'r>),
    End(FollowEndReason),
}

/// The quantifiers that the path leaves and that may bring it back to their start, from the inside.
type Quantifiers<'r> = SmallVec<[re::Node<'r>; 4]>;

/// For an element of a character class upstream throws.
fn get_next_element<'r, O: FollowOperations<'r>>(
    operations: &mut O,
    element: re::Node<'r>,
    state: &O::State,
    direction: MatchingDirection,
    quantifiers: &mut Quantifiers<'r>,
) -> NextElement<'r> {
    let Some(parent) = element.parent() else {
        return NextElement::False;
    };
    if !matches!(
        parent.ty(),
        re::NodeType::Quantifier | re::NodeType::Alternative
    ) {
        return NextElement::False;
    }

    let continue_path = operations.continue_after(element, state, direction);
    if !continue_path {
        return NextElement::False;
    }

    if let re::Kind::Quantifier { max, .. } = parent.kind() {
        // The path that leaves the quantifier, and if it can loop also the one that goes back in.
        if max > 1 {
            quantifiers.push(parent);
        }
        return get_next_element(operations, parent, state, direction, quantifiers);
    }

    if let Some(next_element) = get_sibling(parent.elements(), element, direction) {
        return NextElement::Element(next_element);
    }
    let Some(parent_parent) = parent.parent() else {
        return NextElement::False;
    };
    match parent_parent.ty() {
        re::NodeType::Pattern => NextElement::End(FollowEndReason::Pattern),
        re::NodeType::Assertion
            if !operations.continue_outside(parent_parent, state, direction) =>
        {
            NextElement::End(FollowEndReason::Assertion)
        }
        _ => get_next_element(operations, parent_parent, state, direction, quantifiers),
    }
}

/// `elements[elements.indexOf(element) + (direction === "ltr" ? +1 : -1)]`. The elements are in the
/// order of the source: the index is found by halving.
fn get_sibling<'r>(
    elements: re::Nodes<'r>,
    element: re::Node<'r>,
    direction: MatchingDirection,
) -> Option<re::Node<'r>> {
    let (mut index, mut end) = (0, elements.len());
    while index < end {
        let middle = index + (end - index) / 2;
        if elements.get(middle)?.start() < element.start() {
            index = middle + 1;
        } else {
            end = middle;
        }
    }
    match direction {
        MatchingDirection::Ltr => elements.get(index + 1),
        MatchingDirection::Rtl => elements.get(index.checked_sub(1)?),
    }
}

fn get_first_element<'r>(a: re::Node<'r>, dir: MatchingDirection) -> Option<re::Node<'r>> {
    match dir {
        MatchingDirection::Ltr => a.elements().first(),
        MatchingDirection::Rtl => a.elements().iter().next_back(),
    }
}
