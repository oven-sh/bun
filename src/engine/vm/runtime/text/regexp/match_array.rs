//! The result of `exec`.

use bun_engine_regexp::Flags;
use bun_engine_text::{PropertyName, names};

use crate::{
    Attributes, Captures, Cx, ElementKind, Gc, JsArray, JsFinalObject, JsObject, JsResult,
    JsString, Match, PropertyOffset, RealmSlot, RegExp, Shape, StringView, Value, ValueVec,
};

const MAX_NAMES_IN_SHARED_SHAPE: usize = 64;

/// False if the slot is not one of them.
pub fn initialize_match_array_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let global = cx.global();
    let adding = |shape: Gc<Shape>, name: &PropertyName<'_>| {
        shape.add_property_transition(cx, *name, Attributes::NONE).0
    };
    let shape = |properties: &[PropertyName<'_>]| {
        (properties.iter()).fold(global.array_shape(ElementKind::Contiguous), adding)
    };
    let properties = [names::index, names::input, names::groups, names::indices];
    match slot {
        RealmSlot::regexp_match_array_shape => {
            global.init_regexp_match_array_shape(shape(&properties[..3]));
        }
        RealmSlot::regexp_match_array_with_indices_shape => {
            global.init_regexp_match_array_with_indices_shape(shape(&properties));
        }
        RealmSlot::regexp_indices_array_shape => {
            global.init_regexp_indices_array_shape(shape(&[names::groups]));
        }
        _ => return false,
    }
    true
}

impl RegExp {
    pub const MATCH_INDEX: PropertyOffset = PropertyOffset::for_slot(0, 0);
    pub const MATCH_INPUT: PropertyOffset = PropertyOffset::for_slot(1, 0);
    pub const MATCH_GROUPS: PropertyOffset = PropertyOffset::for_slot(2, 0);

    #[inline(never)]
    pub(super) fn match_array(
        &self,
        cx: &Cx,
        input: Gc<JsString>,
        subject: &StringView,
        captures: Captures<'_>,
    ) -> JsResult<Gc<JsArray>> {
        if self.has_named_groups() || self.flags().contains(Flags::HAS_INDICES) {
            return self.match_array_slow(cx, input, subject, captures);
        }
        let index = Value::int32(captures.whole().start as i32);
        cx.or_out_of_memory(JsArray::try_from_fn(
            cx,
            cx.regexp_match_array_shape(),
            [index, input.into(), Value::UNDEFINED],
            captures.count(),
            #[inline(always)]
            |index| captures.value(cx, subject, index),
        ))
    }

    /// For what its machine code has found in `input`. `offsets` are as those of `Captures`.
    #[inline]
    pub fn array_for_offsets(
        &self,
        cx: &Cx,
        input: Gc<JsString>,
        offsets: &[u32],
    ) -> JsResult<Gc<JsArray>> {
        assert!(offsets.len() == (self.group_count() + 1) * 2);
        self.match_array(cx, input, &input.view(cx)?, Captures::new(offsets))
    }

    #[inline(never)]
    fn match_array_slow(
        &self,
        cx: &Cx,
        input: Gc<JsString>,
        subject: &StringView,
        captures: Captures<'_>,
    ) -> JsResult<Gc<JsArray>> {
        let (index, input) = (captures.whole().start.into(), input.into());
        let mut strings = ValueVec::new();
        cx.or_out_of_memory(strings.try_reserve(captures.count()))?;
        for index in 0..captures.count() {
            strings.push(captures.value(cx, subject, index));
        }
        let (groups, string) = (self.groups(cx, &strings), |index: usize| strings[index]);
        cx.or_out_of_memory(if self.flags().contains(Flags::HAS_INDICES) {
            let properties = [index, input, groups, self.indices(cx, captures)?.into()];
            let shape = cx.regexp_match_array_with_indices_shape();
            JsArray::try_from_fn(cx, shape, properties, strings.len(), string)
        } else {
            let shape = cx.regexp_match_array_shape();
            JsArray::try_from_fn(cx, shape, [index, input, groups], strings.len(), string)
        })
    }

    /// MakeMatchIndicesIndexPairArray
    fn indices(&self, cx: &Cx, captures: Captures<'_>) -> JsResult<Gc<JsArray>> {
        let mut pairs = ValueVec::new();
        cx.or_out_of_memory(pairs.try_reserve(captures.count()))?;
        for index in 0..captures.count() {
            pairs.push(match captures.get(index) {
                Some(Match { start, end }) => {
                    cx.new_array_from(&[start.into(), end.into()])?.into()
                }
                None => Value::UNDEFINED,
            });
        }
        let (shape, groups) = (cx.regexp_indices_array_shape(), self.groups(cx, &pairs));
        let array = JsArray::try_from_fn(cx, shape, [groups], pairs.len(), |index| pairs[index]);
        cx.or_out_of_memory(array)
    }

    /// `values` start with one for the match and one for each group. Undefined if no group has a name.
    pub(super) fn groups(&self, cx: &Cx, values: &[Value]) -> Value {
        let Some(analysis) = self.analysis().filter(|_| self.has_named_groups()) else {
            return Value::UNDEFINED;
        };
        let named = analysis.names.iter().map(|(_, groups)| {
            let mut candidates = groups.iter().map(|&group| values[usize::from(group)]);
            candidates.find(|it| !it.is_undefined()).unwrap_or_default()
        });
        if named.len() > MAX_NAMES_IN_SHARED_SHAPE {
            let object: Gc<JsObject> = cx.new_object_with_null_prototype();
            for (name, value) in analysis.identifiers.iter().zip(named) {
                object.put_direct(cx, name.name(), value, Attributes::NONE);
            }
            return object.into();
        }
        let shape = self.groups_shape();
        let shape = shape.filter(|it| it.global() == Some(cx.global()));
        let shape = shape.unwrap_or_else(|| {
            let empty = cx.null_prototype_object_shape();
            let shape = analysis.identifiers.iter().fold(empty, |shape, name| {
                (shape.add_property_transition(cx, name.name(), Attributes::NONE)).0
            });
            self.set_groups_shape(Some(shape));
            shape
        });
        let mut values = ValueVec::new();
        named.for_each(|value| values.push(value));
        JsFinalObject::create_with_values(cx, shape, &values).into()
    }
}
