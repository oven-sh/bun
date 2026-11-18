//! InternalizeJSONProperty of ECMA-262.

use core::ops::Range;

use bun_engine_text::{Identifier, PropertyName, names};

use super::Failure;
use super::parser::Parser;
use super::records::{RecordBuilder, Records};
use crate::{
    Attributes, Cx, DontEnumMode, FastHashMap, Gc, JsFinalObject, JsObject, JsResult, JsString,
    PropertyNameMode, Shape, StringView, Value, is_array, root_vec,
};

/// `JSON.parse` with a reviver that can be called.
pub fn parse_with_reviver(cx: &mut Cx, source: &StringView, reviver: Value) -> JsResult<Value> {
    let (text, builder) = (source.text().into(), RecordBuilder::default());
    let records = Parser::run(cx, text, builder, |parser, tables, cursor| {
        parser.text(tables, cursor)?;
        Ok(parser.recorder.finish(cx)?)
    });
    let records = records.map_err(|failure: Failure| failure.throw(cx, text))?;
    let empty = cx.object_shape();
    let (context_shape, _) = empty.add_property_transition(cx, names::source, Attributes::NONE);
    let walk = Walk {
        source,
        reviver,
        records,
        context_shape,
    };
    walk.run(cx)
}

struct Walk<'a> {
    source: &'a StringView,
    reviver: Value,
    records: Records,
    /// Of a context that has the source.
    context_shape: Gc<Shape>,
}

/// An object or an array whose members are being revived.
struct Holder {
    object: Gc<JsObject>,
    /// `None` for an array.
    names: Option<Vec<Identifier>>,
    current: u32,
    count: u32,
    /// Those of the members that the parser gave it.
    records: Range<u32>,
    /// The same by the address of the name, if they are many.
    records_by_name: FastHashMap<usize, u32>,
}

impl Holder {
    fn name(&self) -> Option<PropertyName<'_>> {
        Some(self.names.as_ref()?[self.current as usize].name())
    }
}

impl Walk<'_> {
    const MAX_DEPTH: usize = 40_000;
    const MAX_SEARCHED: usize = 8;

    fn run(&self, cx: &mut Cx) -> JsResult<Value> {
        let mut holders = root_vec();
        let root = self.records.values.len() - 1;
        let (mut value, mut record) = (self.value_of(root), Some(root));
        loop {
            cx.check_traps()?;
            if let Some(object) = value.as_object() {
                let is_array = is_array(cx, value)?;
                if holders.len() >= Self::MAX_DEPTH {
                    return Err(cx.throw_stack_overflow());
                }
                holders.push(self.open(cx, object, is_array, record)?);
            } else if let Some(holder) = holders.last_mut() {
                self.revive_member(cx, holder, value, record)?;
            } else {
                return self.revive_root(cx, value, record);
            }
            (value, record) = loop {
                let Some(holder) = holders.last().filter(|it| it.current < it.count) else {
                    let done = holders.pop().map_or_default(|it| it.object.into());
                    match holders.last_mut() {
                        Some(holder) => self.revive_member(cx, holder, done, None)?,
                        None => return self.revive_root(cx, done, None),
                    }
                    continue;
                };
                break self.read_member(cx, holder)?;
            };
        }
    }

    fn value_of(&self, record: u32) -> Value {
        self.records.values.get(record).unwrap_or_default()
    }

    fn range_of(&self, record: u32) -> Range<u32> {
        self.records.records[record as usize].range.clone()
    }

    fn name_address(&self, record: u32) -> usize {
        let key = self.records.records[record as usize].key.as_ref();
        key.map_or(0, |key| key.name().address())
    }

    fn open(
        &self,
        cx: &mut Cx,
        object: Gc<JsObject>,
        is_array: bool,
        record: Option<u32>,
    ) -> JsResult<Holder> {
        let records = record.map_or(0..0, |record| self.range_of(record));
        let mut records_by_name = FastHashMap::default();
        let (names, count) = if is_array {
            (None, object.length_of_array_like(cx)?)
        } else {
            if records.len() > Self::MAX_SEARCHED {
                (records_by_name.try_reserve(records.len()))
                    .map_err(|_| cx.throw_out_of_memory())?;
                records_by_name.extend(records.clone().map(|it| (self.name_address(it), it)));
            }
            let names = object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
            let count = names.len() as u64;
            (Some(names.into_vec()), count)
        };
        Ok(Holder {
            object,
            names,
            current: 0,
            count: u32::try_from(count).map_err(|_| cx.throw_out_of_memory())?,
            records,
            records_by_name,
        })
    }

    /// The value, and its record if it is still what the parser made.
    fn read_member(&self, cx: &mut Cx, holder: &Holder) -> JsResult<(Value, Option<u32>)> {
        let mut records = holder.records.clone();
        let (value, record) = match holder.name() {
            None => (
                holder.object.get_index(cx, holder.current.into())?,
                records.nth(holder.current as usize),
            ),
            Some(name) => (
                holder.object.get(cx, name)?,
                if records.len() > Self::MAX_SEARCHED {
                    holder.records_by_name.get(&name.address()).copied()
                } else {
                    records.rfind(|&it| self.name_address(it) == name.address())
                },
            ),
        };
        match record {
            Some(record) if self.value_of(record).same_value(cx, value)? => {
                Ok((value, Some(record)))
            }
            _ => Ok((value, None)),
        }
    }

    /// `record` is that of a primitive.
    fn call(
        &self,
        cx: &mut Cx,
        holder: Gc<JsObject>,
        key: Gc<JsString>,
        value: Value,
        record: Option<u32>,
    ) -> JsResult<Value> {
        let context = match record.map(|record| self.range_of(record)) {
            Some(range) => {
                let range = range.start as usize..range.end as usize;
                let source = self.source.substring(cx, range);
                let context = JsFinalObject::create(cx, self.context_shape);
                context.put_direct_at(cx, self.context_shape.max_offset(), source.into());
                context.upcast()
            }
            None => cx.new_object(),
        };
        let arguments = [key.into(), value, context.into()];
        cx.call(self.reviver, holder.into(), &arguments)
    }

    fn revive_member(
        &self,
        cx: &mut Cx,
        holder: &mut Holder,
        value: Value,
        record: Option<u32>,
    ) -> JsResult<()> {
        let (object, index) = (holder.object, holder.current);
        let key = match holder.name() {
            Some(name) => JsString::from_name(cx, name),
            None => JsString::from_number(cx, index.into()),
        };
        let revived = self.call(cx, object, key, value, record)?;
        match (holder.name(), revived.is_undefined()) {
            (Some(name), true) => object.delete(cx, name)?,
            (Some(name), false) => object.create_data_property(cx, name, revived, false)?,
            (None, true) => object.delete_index(cx, index.into())?,
            (None, false) => object.create_data_index(cx, index.into(), revived, false)?,
        };
        holder.current += 1;
        Ok(())
    }

    fn revive_root(&self, cx: &mut Cx, value: Value, record: Option<u32>) -> JsResult<Value> {
        let root = cx.new_object();
        root.put_direct(cx, PropertyName::EMPTY, value, Attributes::NONE);
        self.call(cx, root, cx.small_strings.empty(), value, record)
    }
}
