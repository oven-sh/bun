//! One member at a time, as ECMA-262 has it.

use bun_alloc::AllocError;
use bun_engine_number::NumberText;
use bun_engine_text::{Identifier, PropertyName, StringBuilder, names};

use super::options::Replacer;
use super::plan::{Plan, lacks_to_json};
use super::{Holder, Keys, MAX_DEPTH, Members, Settled, Writer};
use crate::caches::get_megamorphic;
use crate::json::RawJson;
use crate::{
    Attributes, BigIntObject, BooleanObject, CellType, Cx, DontEnumMode, Gc, JsObject, JsResult,
    JsString, JsTypedArray, JsWrapperObject, NumberObject, PropertyNameMode, SpecialProperty,
    Storage, StringObject, TypeFlags, Value, is_array,
};

#[derive(Clone, Copy)]
enum Key<'a> {
    Index(u32),
    Name(PropertyName<'a>),
}

impl Key<'_> {
    fn to_value(self, cx: &Cx) -> Value {
        match self {
            Key::Index(index) => JsString::from_number(cx, index.into()).into(),
            Key::Name(name) => JsString::from_name(cx, name).into(),
        }
    }
}

/// With the value, which is not known.
fn named(names: &[Identifier], index: usize) -> Option<(Key<'_>, Option<Value>)> {
    Some((Key::Name(names.get(index)?.name()), None))
}

#[inline(always)]
fn get_element(cx: &mut Cx, object: &JsObject, index: u32) -> JsResult<Value> {
    if is_plain(object)
        && let Some(sparse) = object.sparse_elements()
    {
        match sparse.get(index) {
            Some(entry) if !entry.value.is_accessor_cell() => return Ok(entry.value),
            None if !object.holes_must_forward_to_prototype() => return Ok(Value::UNDEFINED),
            _ => {}
        }
    }
    object.get_index(cx, index.into())
}

fn unwrap(cx: &mut Cx, object: Gc<JsObject>) -> JsResult<Value> {
    let value = Value::from(object);
    Ok(if object.is::<NumberObject>() {
        value.to_number(cx)?.into()
    } else if object.is::<StringObject>() {
        value.to_string(cx)?.into()
    } else if object.is::<BooleanObject>() || object.is::<BigIntObject>() {
        object.cast::<JsWrapperObject>().internal_value()
    } else {
        value
    })
}

#[inline(always)]
fn is_plain(object: &JsObject) -> bool {
    matches!(object.cell_type(), CellType::FinalObject | CellType::Array)
}

impl Replacer {
    /// SerializeJSONProperty up to where it is known what to write, if anything.
    #[inline(always)]
    fn resolve(
        &self,
        cx: &mut Cx,
        holder: Value,
        key: Key<'_>,
        mut value: Value,
    ) -> JsResult<Option<Value>> {
        let to_json = match value.as_object() {
            Some(object) if lacks_to_json(&object, cx.full_prototype_chain_epoch()) => None,
            Some(object) => Some(object.get_special_property(cx, SpecialProperty::ToJson)?),
            None if value.is_bigint() => Some(value.get(cx, names::toJSON)?),
            None => None,
        };
        if let Some(to_json) = to_json.filter(|it| it.is_callable()) {
            value = cx.call(to_json, value, &[key.to_value(cx)])?;
        }
        if let Replacer::Function(replacer) = *self {
            value = cx.call(replacer, holder, &[key.to_value(cx), value])?;
        }
        if let Some(object) = value.as_object() {
            if is_plain(&object) {
                return Ok(Some(value));
            }
            value = unwrap(cx, object)?;
        }
        if value.is_bigint() {
            return Err(cx.throw_type_error("JSON.stringify cannot serialize BigInt."));
        }
        Ok((!value.is_undefined() && !value.is_symbol() && !value.is_callable()).then_some(value))
    }
}

/// The table and the elements have all own properties.
#[inline(always)]
pub(super) fn has_ordinary_properties(object: &JsObject) -> bool {
    const EXOTIC: TypeFlags = TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT
        .union(TypeFlags::OVERRIDES_OWN_PROPERTY_NAMES)
        .union(TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES);
    let shape = object.shape();
    !shape.type_flags().intersects(EXOTIC) && !shape.has_non_reified_static_properties()
}

/// The indices of the enumerable elements, if the other keys are those of the table.
fn own_indices(cx: &Cx, object: &JsObject) -> JsResult<Option<Vec<u32>>> {
    fn collect(count: usize, all: impl Iterator<Item = u32>) -> Result<Vec<u32>, AllocError> {
        let mut indices = Vec::new();
        if count > Storage::MAX_VECTOR_LENGTH as usize || indices.try_reserve_exact(count).is_err()
        {
            return Err(AllocError);
        }
        indices.extend(all);
        Ok(indices)
    }
    let indices = if let Some(array) = object.downcast::<JsTypedArray>()
        && !object.shape().has_non_reified_static_properties()
    {
        let length = array.length();
        collect(length, 0..length as u32)
    } else if !has_ordinary_properties(object) {
        return Ok(None);
    } else if let Some(sparse) = object.sparse_elements() {
        sparse.try_sorted_indices(0..u32::MAX, DontEnumMode::Exclude)
    } else {
        let all = 0..object.public_length();
        let present = all.filter(|&index| object.try_get_dense(index).is_some());
        collect(object.count_dense_elements(), present)
    };
    cx.or_out_of_memory(indices).map(Some)
}

impl Holder {
    #[inline(always)]
    fn has_keys(&self) -> bool {
        self.members as u8 >= Members::Stored as u8
    }
}

impl Settled {
    /// Up to this depth a cycle is found by going through the holders.
    const SEARCHED: usize = 32;

    #[inline(always)]
    pub(super) fn contains(&self, holders: &[Holder], object: Gc<JsObject>) -> bool {
        let near = &holders[..self.count.min(Self::SEARCHED)];
        near.iter().any(|holder| holder.object == object)
            || (self.count > Self::SEARCHED && self.objects.contains(&object.address()))
    }

    #[inline]
    fn add(&mut self, cx: &Cx, holders: &[Holder], object: Gc<JsObject>) -> JsResult<()> {
        if self.contains(holders, object) {
            let message = "JSON.stringify cannot serialize cyclic structures.";
            return Err(cx.throw_type_error(message));
        }
        if self.count >= Self::SEARCHED {
            self.objects.insert(object.address());
        }
        self.count += 1;
        Ok(())
    }

    /// The last one, which is inside of so many.
    #[inline]
    pub(super) fn remove(&mut self, holder: &Holder, depth: usize) {
        debug_assert!(depth + 1 == self.count);
        self.count = depth;
        self.exposed = self.exposed.min(depth);
        if depth >= Self::SEARCHED {
            self.objects.remove(&holder.object.address());
        }
        if holder.has_keys() {
            self.keys.pop();
        }
    }
}

impl Writer<'_, '_> {
    #[inline(always)]
    pub(super) fn settle(&mut self, cx: &Cx) -> JsResult<()> {
        if self.settled.count < self.holders.len() {
            return self.settle_more(cx);
        }
        Ok(())
    }

    /// To scripts.
    #[inline(always)]
    pub(super) fn expose(&mut self, cx: &Cx) -> JsResult<()> {
        self.settled.exposed = self.holders.len();
        self.settle(cx)
    }

    #[inline(never)]
    fn settle_more(&mut self, cx: &Cx) -> JsResult<()> {
        while let (around, [holder, ..]) = self.holders.split_at_mut(self.settled.count) {
            self.settled.add(cx, around, holder.object)?;
            let shape = *holder.shape.insert(holder.object.shape());
            if holder.has_keys() {
                self.settled.keys.push(Keys::Stored(shape.properties()));
            }
        }
        Ok(())
    }

    /// False if there is no text for the value, which is the outermost one.
    #[inline(never)]
    pub(super) fn begin(
        &mut self,
        cx: &mut Cx,
        out: &mut StringBuilder,
        value: Value,
    ) -> JsResult<bool> {
        let mut wrapper = Value::UNDEFINED;
        if let Replacer::Function(_) = self.replacer {
            let object = cx.new_object();
            object.put_direct(cx, PropertyName::EMPTY, value, Attributes::NONE);
            wrapper = object.into();
        }
        let key = Key::Name(PropertyName::EMPTY);
        let Some(value) = self.replacer.resolve(cx, wrapper, key, value)? else {
            return Ok(false);
        };
        self.write_resolved(cx, out, value)?;
        Ok(true)
    }

    /// Of an object or an array, only the beginning. All holders are settled.
    #[inline(always)]
    fn write_resolved(
        &mut self,
        cx: &mut Cx,
        out: &mut StringBuilder,
        value: Value,
    ) -> JsResult<()> {
        if let Some(string) = value.as_string() {
            out.push_json_quoted(string.view(cx)?.text());
        } else if let Some(object) = value.as_object() {
            self.open(cx, out, object)?;
        } else if let Some(integer) = value.as_int32() {
            out.push_latin1_slice(&NumberText::from(integer));
        } else if let Some(number) = value.as_double().filter(|it| it.is_finite()) {
            out.push_latin1_slice(&NumberText::from(number));
        } else {
            out.push_ascii(match value {
                Value::TRUE => "true",
                Value::FALSE => "false",
                _ => "null",
            });
        }
        Ok(())
    }

    #[inline(always)]
    fn open(&mut self, cx: &mut Cx, out: &mut StringBuilder, object: Gc<JsObject>) -> JsResult<()> {
        if self.holders.len() < MAX_DEPTH && !self.settled.contains(self.holders, object) {
            if let Some(array) = object.as_exact_array() {
                self.holders.push(Holder::of_array(object, array.length()));
                return Ok(());
            }
            if object.cell_type() == CellType::FinalObject
                && !object.indexing_mode().has_elements()
                && has_ordinary_properties(&object)
                && !matches!(self.replacer, Replacer::List(_))
            {
                let has_plan = Plan::ensure_with_members(&object.shape()).is_some();
                let members = if has_plan {
                    Members::Planned
                } else {
                    Members::Stored
                };
                self.holders.push(Holder::new(object, members));
                return Ok(());
            }
        }
        self.open_any(cx, out, object)
    }

    #[inline(never)]
    fn open_any(
        &mut self,
        cx: &mut Cx,
        out: &mut StringBuilder,
        object: Gc<JsObject>,
    ) -> JsResult<()> {
        if let Some(raw) = object.downcast::<RawJson>() {
            out.push_text(raw.text().view(cx)?.text());
            return Ok(());
        }
        self.settled.add(cx, self.holders, object)?;
        if self.holders.len() >= MAX_DEPTH {
            return Err(cx.throw_stack_overflow());
        }
        let holder = if is_array(cx, object.into())? {
            let length = object.length_of_array_like(cx)?;
            let length = u32::try_from(length).map_err(|_| cx.throw_out_of_memory())?;
            Holder::of_array(object, length)
        } else if let Replacer::List(_) = self.replacer {
            Holder::new(object, Members::Listed)
        } else if let Some(indices) = own_indices(cx, &object)? {
            let stored = object.shape().properties();
            if indices.is_empty() {
                self.settled.keys.push(Keys::Stored(stored));
                Holder::new(object, Members::Stored)
            } else {
                self.settled.keys.push(Keys::Indexed(indices, stored));
                Holder::new(object, Members::Indexed)
            }
        } else {
            let names = object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
            self.settled.keys.push(Keys::Named(names.into_vec()));
            Holder::new(object, Members::Named)
        };
        self.holders.push(holder);
        self.settled.exposed = self.holders.len();
        Ok(())
    }

    fn close(&mut self, out: &mut StringBuilder) {
        let Some(holder) = self.holders.pop() else {
            return;
        };
        self.settled.remove(&holder, self.holders.len());
        if holder.separator == b',' {
            self.start_line(out);
        } else {
            out.push_latin1(holder.separator);
        }
        out.push_latin1(match holder.members {
            Members::Elements => b']',
            _ => b'}',
        });
    }

    fn start_line(&self, out: &mut StringBuilder) {
        let Some(gap) = self.gap else { return };
        let length = gap.line_length(self.holders.len());
        if gap.is_latin1() {
            out.write_latin1(length, |to| gap.start_exact_line(length, to));
        } else {
            out.write_utf16(length, |to| gap.start_exact_line(length, to));
        }
    }

    /// So many times, unless it is at the end.
    #[inline(never)]
    pub(super) fn step(
        &mut self,
        cx: &mut Cx,
        out: &mut StringBuilder,
        count: usize,
    ) -> JsResult<()> {
        for _ in 0..count {
            if self.holders.is_empty() || out.has_overflowed() {
                break;
            }
            self.write_next(cx, out)?;
        }
        Ok(())
    }

    /// The next member of the innermost holder, or its end.
    #[inline(always)]
    fn write_next(&mut self, cx: &mut Cx, out: &mut StringBuilder) -> JsResult<()> {
        self.expose(cx)?;
        cx.check_traps()?;
        let Some(holder) = self.holders.last_mut() else {
            return Ok(());
        };
        let (object, index) = (holder.object, holder.next as usize);
        let shape = holder.shape.unwrap_or_else(|| object.shape());
        let member = match (holder.members, self.settled.keys.last(), self.replacer) {
            (Members::Planned, ..) => {
                let members = Plan::of(shape.anchor()).map_or_default(Plan::members);
                members.get(index).map(|member| {
                    let is_same = object.shape() == shape;
                    // SAFETY: if it is.
                    let stored = is_same.then(|| unsafe { member.value_in(&object) });
                    (Key::Name(member.name()), stored.flatten())
                })
            }
            (Members::Stored, Some(Keys::Stored(stored) | Keys::Indexed(_, stored)), _) => {
                let rest = stored.entries()[index..].iter();
                let mut found = rest.filter_map(|entry| {
                    holder.next += 1;
                    entry.as_enumerable_string()
                });
                found.next().map(|(name, offset)| {
                    holder.next -= 1;
                    let is_current = stored.are_those_of(&object.shape());
                    // SAFETY: if it is from the shape.
                    let stored = is_current.then(|| unsafe { object.get_direct_unchecked(offset) });
                    (Key::Name(name), stored)
                })
            }
            (Members::Indexed, Some(Keys::Indexed(indices, _)), _) => match indices.get(index) {
                Some(&index) => Some((Key::Index(index), None)),
                None => {
                    (holder.members, holder.next) = (Members::Stored, 0);
                    return Ok(());
                }
            },
            (Members::Named, Some(Keys::Named(names)), _)
            | (Members::Listed, _, Replacer::List(names)) => named(names, index),
            _ => (holder.next < holder.length).then_some((Key::Index(holder.next), None)),
        };
        let Some((key, stored)) = member else {
            self.close(out);
            return Ok(());
        };
        holder.next += 1;
        let is_element = holder.members == Members::Elements;
        let value = match (stored.filter(|it| !it.is_accessor_cell()), key) {
            (Some(value), _) => value,
            (None, Key::Name(name)) => get_megamorphic(cx, object.into(), name)?,
            (None, Key::Index(index)) => get_element(cx, &object, index)?,
        };
        let value = match self.replacer.resolve(cx, object.into(), key, value)? {
            Some(value) => value,
            None if is_element => Value::NULL,
            None => return Ok(()),
        };
        let separator = core::mem::replace(&mut holder.separator, b',');
        if let (Key::Name(name), None) = (key, self.gap) {
            out.push_json_key(separator, name.text());
            return self.write_resolved(cx, out, value);
        }
        out.push_latin1(separator);
        self.start_line(out);
        if !is_element {
            match key {
                Key::Name(name) => out.push_json_quoted(name.text()),
                Key::Index(index) => out.push_json_quoted(NumberText::from(index).text()),
            }
            out.push_ascii(if self.gap.is_none() { ":" } else { ": " });
        }
        self.write_resolved(cx, out, value)
    }
}
