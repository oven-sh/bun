//! Which kind of node has the effects of a form.

use bun_engine_vm::direct::{Form, Gives, Reach, State, Throws};

use super::{Fibers, Kind};

/// The data of a node that calls a form.
#[derive(Clone, Copy)]
pub(crate) struct FormCall {
    pub(crate) form: Form,
    /// About the first string among the operands.
    pub(crate) subject: Fibers,
    /// The pattern of a plain RegExp object is certain to be global or sticky.
    pub(crate) uses_last_index: bool,
    /// How many the pattern is certain to have, if they are few.
    pub(crate) groups: Option<u8>,
}

impl FormCall {
    pub(crate) fn to_data(self) -> u32 {
        self.form as u32
            | self.subject.bits() << 16
            | u32::from(self.uses_last_index) << 23
            | self.groups.map_or(0, |count| u32::from(count) + 1) << 24
    }

    pub(crate) fn from_data(data: u32) -> Self {
        Self {
            form: Form::ALL[usize::from(data as u16)],
            subject: Fibers::from_bits_truncate(data >> 16),
            uses_last_index: data >> 23 & 1 != 0,
            groups: ((data >> 24) as u8).checked_sub(1),
        }
    }
}

/// What `SearchValue` and the nodes that follow it cover.
const OF_SEARCHES: State = State::LAST_MATCH
    .union(State::LAST_INDEX)
    .union(State::ITERATOR)
    .union(State::TRANSITIONS);

impl Kind {
    /// `None` if there is no kind for them.
    pub(crate) fn calling(form: Form) -> Option<Kind> {
        let by_result = |value, int32, double| match form.gives {
            Gives::Int32 { .. } | Gives::Boolean => int32,
            Gives::Double(_) => double,
            _ => Some(value),
        };
        let (reads, writes) = (form.reads, form.writes);
        if form.reach == Reach::Leaf {
            return match writes {
                State::DATE => Some(Kind::ChangeDate),
                State::CLOCK => Some(Kind::ReadClock),
                _ if !writes.is_empty() => None,
                _ if reads.is_empty() => by_result(
                    Kind::LeafValue,
                    Some(Kind::LeafInt32),
                    Some(Kind::LeafDouble),
                ),
                _ => by_result(
                    Kind::ReadingLeafValue,
                    Some(Kind::ReadingLeafInt32),
                    Some(Kind::ReadingLeafDouble),
                ),
            };
        }
        let never_fails = form.throws == Throws::Never && !form.resolves_ropes;
        if never_fails && form.is_distinct && State::CLOCK.contains(writes) {
            Some(Kind::MakeDistinct)
        } else if never_fails && reads.is_empty() {
            Some(Kind::MakePrimitive)
        } else if State::TRANSITIONS.contains(writes) {
            by_result(Kind::TextValue, Some(Kind::TextInt32), None)
        } else if writes.contains(State::LAST_MATCH) && OF_SEARCHES.contains(writes) {
            by_result(Kind::SearchValue, Some(Kind::SearchInt32), None)
        } else {
            by_result(Kind::ChangeAnything, None, None)
        }
    }

    pub(crate) fn calls_form(self) -> bool {
        (Kind::LeafValue as u16..=Kind::ChangeAnything as u16).contains(&(self as u16))
    }
}
