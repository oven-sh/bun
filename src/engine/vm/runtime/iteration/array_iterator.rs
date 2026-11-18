use bun_engine_macros::cell;

use crate::{Cx, FieldArray, Gc, JsObject, JsObjectInit, JsResult, JsTypedArray, Shape, Value, Vm};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum IterationKind {
    Keys = 0,
    Values = 1,
    Entries = 2,
}

impl IterationKind {
    /// Of an internal field.
    #[inline(always)]
    pub(crate) fn from_field(value: Value) -> IterationKind {
        match value.as_int32() {
            Some(0) => IterationKind::Keys,
            Some(1) => IterationKind::Values,
            _ => IterationKind::Entries,
        }
    }
}

impl From<IterationKind> for Value {
    #[inline(always)]
    fn from(kind: IterationKind) -> Value {
        Value::int32(kind as i32)
    }
}

#[cell(name = "ArrayIterator", cell_type = ArrayIterator)]
pub struct JsArrayIterator {
    base: JsObject,
    pub(self) fields: FieldArray<Value, 3>,
}

impl JsArrayIterator {
    /// A number, or `DONE`.
    pub const INDEX: usize = 0;
    pub const ITERATED_OBJECT: usize = 1;
    pub const KIND: usize = 2;
    pub const DONE: Value = Value::int32(-1);

    pub fn create_with_shape(
        vm: &Vm,
        shape: Gc<Shape>,
        object: Gc<JsObject>,
        kind: IterationKind,
    ) -> Gc<JsArrayIterator> {
        vm.allocate::<JsArrayIterator>(JsArrayIteratorInit {
            base: JsObjectInit::new(vm, shape),
            fields: [Value::ZERO, object.into(), kind.into()],
        })
    }

    /// CreateArrayIterator
    #[inline]
    pub fn create(cx: &Cx, object: Gc<JsObject>, kind: IterationKind) -> Gc<JsArrayIterator> {
        Self::create_with_shape(cx, cx.array_iterator_shape(), object, kind)
    }

    #[inline(always)]
    pub fn iterated_object(&self) -> Gc<JsObject> {
        self.fields().at(Self::ITERATED_OBJECT).cast()
    }

    #[inline(always)]
    pub fn kind(&self) -> IterationKind {
        IterationKind::from_field(self.fields().at(Self::KIND))
    }

    /// `None` once it is done.
    #[inline(always)]
    pub fn index(&self) -> Option<u64> {
        let index = self.fields().at(Self::INDEX);
        match index.as_index_int32() {
            Some(index) => Some(index.into()),
            None => (index.as_double())
                .filter(|&index| index >= 0.0)
                .map(|index| index as u64),
        }
    }

    #[inline(always)]
    pub fn set_index(&self, index: Option<u64>) {
        let index = index.map_or(Self::DONE, Value::from);
        self.fields().set(Self::INDEX, index);
    }

    /// The next key and value, if they are those of an element which a dense array has.
    #[inline(always)]
    pub(super) fn try_next(&self) -> Option<(Value, Value)> {
        let key = self.fields().at(Self::INDEX);
        let index = key.as_index_int32()?;
        let value = self
            .iterated_object()
            .as_exact_array()?
            .try_get_dense(index)?;
        (self.fields()).set(Self::INDEX, Value::int32(index as i32 + 1));
        Some((key, value))
    }

    /// `%ArrayIteratorPrototype%.next`, without the object for the result.
    #[inline]
    pub fn next(&self, cx: &mut Cx) -> JsResult<Option<Value>> {
        let Some(index) = self.index() else {
            return Ok(None);
        };
        let object = self.iterated_object();
        let length = match object.as_exact_array() {
            Some(array) => array.length().into(),
            None => length_of_other(cx, object)?,
        };
        if index >= length {
            self.set_index(None);
            return Ok(None);
        }
        self.set_index(Some(index + 1));
        let kind = self.kind();
        if kind == IterationKind::Keys {
            return Ok(Some(index.into()));
        }
        let element = object.get_index(cx, index)?;
        if kind == IterationKind::Values {
            return Ok(Some(element));
        }
        Ok(Some(cx.new_pair(index.into(), element)?.into()))
    }
}

fn length_of_other(cx: &mut Cx, object: Gc<JsObject>) -> JsResult<u64> {
    match object.downcast::<JsTypedArray>() {
        Some(array) => array.validate(cx).map(|length| length as u64),
        None => object.length_of_array_like(cx),
    }
}
