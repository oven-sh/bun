//! What `Object`, `Object.prototype` and `Reflect` do that the tiers and the embedder ask for directly.

use bun_engine_text::{PropertyName, Text, names};

use crate::{
    CachedNames, CellType, Cx, DontEnumMode, ElementKind, Gc, ImmutableArray, JsArray,
    JsArrayBufferView, JsObject, JsResult, JsString, PropertyNameMode, PropertyOffset, ProxyObject,
    ShapeFlags, SpecialProperty, TypeFlags, Value, is_array_for,
};

const MAX_SLOTS_TO_FLATTEN: usize = 64;

fn cached_kind(kinds: PropertyNameMode, mode: DontEnumMode) -> Option<CachedNames> {
    Some(match (kinds, mode) {
        (PropertyNameMode::Strings, DontEnumMode::Exclude) => CachedNames::EnumerableStrings,
        (PropertyNameMode::Strings, DontEnumMode::Include) => CachedNames::Strings,
        (PropertyNameMode::Symbols, DontEnumMode::Include) => CachedNames::Symbols,
        (PropertyNameMode::StringsAndSymbols, DontEnumMode::Include) => {
            CachedNames::StringsAndSymbols
        }
        _ => return None,
    })
}

impl JsObject {
    /// `[[OwnPropertyKeys]]`, filtered, as an array.
    #[inline]
    pub fn own_keys_array(
        &self,
        cx: &mut Cx,
        kinds: PropertyNameMode,
        mode: DontEnumMode,
    ) -> JsResult<Gc<JsArray>> {
        let keys = self.own_key_values(cx, kinds, mode)?;
        JsArray::from_immutable(cx, keys)
    }

    /// The same, as a list that may be shared.
    #[inline]
    pub fn own_key_values(
        &self,
        cx: &mut Cx,
        kinds: PropertyNameMode,
        mode: DontEnumMode,
    ) -> JsResult<Gc<ImmutableArray>> {
        match cached_kind(kinds, mode).and_then(|kind| self.shape().cached_names(kind)) {
            Some(keys) => Ok(keys),
            None => self.collect_own_key_values(cx, kinds, mode),
        }
    }

    #[inline(never)]
    fn collect_own_key_values(
        &self,
        cx: &mut Cx,
        kinds: PropertyNameMode,
        mode: DontEnumMode,
    ) -> JsResult<Gc<ImmutableArray>> {
        if let Some(proxy) = self.downcast::<ProxyObject>()
            && !proxy.target().is::<ProxyObject>()
            && proxy.forwards_own_keys(cx, mode)
        {
            return proxy.target().own_key_values(cx, kinds, mode);
        }
        // Such as the prototype of a class, which is complete by now.
        if self.shape().slot_count() <= MAX_SLOTS_TO_FLATTEN
            && (self.shape()).has(ShapeFlags::CACHEABLE_DICTIONARY)
            && !(self.shape()).has(ShapeFlags::HAS_BEEN_DICTIONARY)
            && self.shape().lists_names_again()
        {
            self.flatten_dictionary(cx);
        }
        let shape = self.shape();
        let plain = (self.count_plain_indices()).filter(|_| kinds != PropertyNameMode::Symbols);
        let names = match plain {
            Some(_) => self.snapshot_own_non_index_keys(cx, kinds, mode)?,
            None => self.snapshot_own_keys(cx, kinds, mode)?,
        };
        let (index_count, has_holes) = plain.unwrap_or_default();
        let indices = (0..)
            .filter(|&index| !has_holes || self.try_get_dense(index).is_some())
            .take(index_count)
            .map(|index| match cx.is_termination_requested() {
                true => Value::UNDEFINED,
                false => JsString::from_number(cx, index.into()).into(),
            });
        let all = indices.chain(names.iter().map(|name| Value::from_name(cx, name)));
        let keys = ImmutableArray::try_from_iter(cx, index_count + names.count(), all);
        let keys = cx.or_out_of_memory(keys)?;
        cx.check_traps()?;
        if let Some(kind) = cached_kind(kinds, mode)
            && self.shape() == shape
            && shape.should_cache_names(kind)
        {
            shape.set_cached_names(kind, keys);
        }
        Ok(keys)
    }

    /// How many own keys are indices and whether any is left out, if there are some and listing the other keys cannot
    /// change that. All are enumerable.
    fn count_plain_indices(&self) -> Option<(usize, bool)> {
        if CellType::TYPED_ARRAYS.contains(self.cell_type()) {
            let length = self.as_object().cast::<JsArrayBufferView>().length();
            return Some((length, false));
        }
        let lists_names = TypeFlags::OVERRIDES_OWN_PROPERTY_NAMES
            | TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES;
        (self.element_kind().is_dense()
            && (self.cell_type() == CellType::Array
                || !self.shape().type_flags().intersects(lists_names)))
        .then(|| self.count_dense_elements())
        .map(|count| (count, count != self.public_length() as usize))
    }

    /// The object has only plain enumerable properties.
    fn for_each_enumerable_named_slot(&self, visit: impl FnMut(PropertyOffset)) {
        let shape = self.shape();
        if shape.has_properties_in_slot_order() {
            let capacity = shape.inline_capacity();
            (0..shape.slot_count())
                .map(|number| PropertyOffset::for_slot(number, capacity))
                .for_each(visit);
        } else {
            (shape.properties().iter())
                .filter(|(name, _, attributes)| attributes.is_enumerable() && !name.is_symbol())
                .map(|(_, offset, _)| offset)
                .for_each(visit);
        }
    }

    fn plain_enumerable_values(&self, cx: &mut Cx) -> JsResult<Gc<JsArray>> {
        let room = self.count_dense_elements() + self.shape().slot_count();
        JsArray::build(cx, ElementKind::Contiguous, room, |writer, no_gc| {
            writer.extend_without_holes(self.dense_elements(no_gc));
            self.for_each_enumerable_named_slot(|offset| writer.push(self.get_direct_at(offset)));
        })
    }

    fn collect_enumerable(
        &self,
        cx: &mut Cx,
        make: impl Fn(&Cx, PropertyName<'_>, Value) -> JsResult<Value>,
    ) -> JsResult<Gc<JsArray>> {
        let keys = self.snapshot_own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Include)?;
        let result = cx.new_array();
        for key in keys.iter() {
            if let Some(value) = self.get_if_own_and_enumerable(cx, key)? {
                let element = make(cx, key, value)?;
                result.append(cx, element)?;
            }
        }
        Ok(result)
    }

    /// EnumerableOwnProperties(O, value)
    pub fn enumerable_own_values(&self, cx: &mut Cx) -> JsResult<Gc<JsArray>> {
        if self.has_only_plain_enumerable_properties() {
            return self.plain_enumerable_values(cx);
        }
        self.collect_enumerable(cx, |_, _, value| Ok(value))
    }

    /// EnumerableOwnProperties(O, key+value)
    pub fn enumerable_own_entries(&self, cx: &mut Cx) -> JsResult<Gc<JsArray>> {
        if !self.has_only_plain_enumerable_properties() {
            return self.collect_enumerable(cx, |cx, name, value| {
                let pair = [Value::from_name(cx, name), value];
                cx.new_array_from(&pair).map(Into::into)
            });
        }
        let keys = self.own_key_values(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
        let result = self.plain_enumerable_values(cx)?;
        for (index, key) in (0..result.length()).zip(keys.iter()) {
            let value = result.try_get_dense(index).unwrap_or_default();
            let pair = cx.new_array_from(&[key, value])?;
            result.put_direct_index(cx, index, pair.into())?;
        }
        Ok(result)
    }

    /// What `Object.prototype.toString` returns without a `Symbol.toStringTag`.
    pub fn builtin_tagged_string(&self, cx: &Cx) -> JsResult<PropertyName<'static>> {
        Ok(match self.cell_type() {
            CellType::FinalObject => names::objectObject,
            CellType::Array | CellType::DerivedArray => names::objectArray,
            CellType::DirectArguments | CellType::ScopedArguments | CellType::ClonedArguments => {
                names::objectArguments
            }
            CellType::Function | CellType::InternalFunction => names::objectFunction,
            CellType::ErrorInstance => names::objectError,
            CellType::Date => names::objectDate,
            CellType::RegExpObject => names::objectRegExp,
            CellType::BooleanObject => names::objectBoolean,
            CellType::NumberObject => names::objectNumber,
            CellType::StringObject | CellType::DerivedStringObject => names::objectString,
            _ if is_array_for(cx, self.as_value(), "Object.prototype.toString")? => {
                names::objectArray
            }
            _ if self.is_callable() => names::objectFunction,
            _ => names::objectObject,
        })
    }

    #[inline]
    pub fn to_tagged_string(&self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        match self.shape().cached_tagged_string() {
            Some(string) => Ok(string),
            None => self.make_tagged_string(cx),
        }
    }

    #[inline(never)]
    fn make_tagged_string(&self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        let builtin = self.builtin_tagged_string(cx)?;
        let value = self.get_special_property(cx, SpecialProperty::ToStringTag)?;
        let Some(tag) = value.as_string() else {
            let string = JsString::from_name(cx, builtin);
            if !self.inline_flags().contains(TypeFlags::OVERRIDES_CALL_DATA) {
                self.shape().cache_tagged_string(value, string);
            }
            return Ok(string);
        };
        let (open, close) = (Text::from_ascii("[object "), Text::from_ascii("]"));
        let string = cx.new_string_from_parts(&[open, tag.view(cx)?.text(), close])?;
        self.shape().cache_tagged_string(value, string);
        Ok(string)
    }
}

impl Value {
    /// `Object.prototype.toString`
    pub fn to_tagged_string(self, cx: &mut Cx) -> JsResult<Gc<JsString>> {
        match self {
            Value::UNDEFINED => Ok(JsString::from_name(cx, names::objectUndefined)),
            Value::NULL => Ok(JsString::from_name(cx, names::objectNull)),
            _ => self.to_object(cx)?.to_tagged_string(cx),
        }
    }
}
