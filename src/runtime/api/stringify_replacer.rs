//! `JSON.stringify`'s replacer for the YAML, TOML and JSON5 stringifiers.

use std::rc::Rc;

use bun_collections::{HashMap, StringHashMap};
use bun_core::{OwnedString, StackCheck, String as BunString};
use bun_jsc::{
    JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSType, JSValue, JsResult,
    MarkedArgumentBuffer, StringJsc,
};

pub(crate) enum Replacer {
    /// Called with the holder as `this` for the root (key `""`), every property and every element.
    Function(JSValue),
    /// `JSON.stringify`'s property list: the properties to write for every object, in this order.
    Keys(Rc<[OwnedString]>),
}

impl Replacer {
    /// `None` for what is neither callable nor an array, which `JSON.stringify` ignores too.
    pub(crate) fn from_js(global: &JSGlobalObject, replacer: JSValue) -> JsResult<Option<Self>> {
        if replacer.is_callable() {
            return Ok(Some(Self::Function(replacer)));
        }
        if !replacer.is_array() {
            return Ok(None);
        }

        let mut keys: Vec<OwnedString> = Vec::new();
        let mut seen: StringHashMap<()> = StringHashMap::default();
        let mut items = replacer.array_iterator(global)?;
        while let Some(item) = items.next()? {
            // ECMA-262 JSON.stringify step 4.b.ii: strings and numbers, boxed or not.
            let names_a_property = item.is_string() // also true for a String object
                || item.is_number()
                || (item.is_cell() && item.js_type() == JSType::NumberObject);
            if !names_a_property {
                continue;
            }
            let key = OwnedString::new(item.to_bun_string(global)?);
            if seen.get_or_put(key.to_utf8().slice())?.found_existing {
                continue;
            }
            keys.push(key);
        }
        Ok(Some(Self::Keys(Rc::from(keys))))
    }

    /// What to write instead of `value`: a function's results in a plain copy, or `value` itself.
    pub(crate) fn apply(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
        is_leaf: fn(JSValue) -> bool,
    ) -> JsResult<JSValue> {
        let Self::Function(function) = self else {
            return Ok(value);
        };
        MarkedArgumentBuffer::new(|roots| {
            let holder = JSValue::create_empty_object(global, 1);
            holder.put(global, b"", value);
            let value =
                function.call(global, holder, &[JSValue::js_empty_string(global), value])?;
            Copier {
                global,
                function: *function,
                is_leaf,
                stack_check: StackCheck::init(),
                ancestors: HashMap::default(),
                roots,
            }
            .replaced(value)
        })
    }

    /// The key list, for [`Properties::init`].
    pub(crate) fn keys(&self) -> Option<Rc<[OwnedString]>> {
        match self {
            Self::Keys(keys) => Some(Rc::clone(keys)),
            Self::Function(_) => None,
        }
    }
}

/// The properties a stringifier writes for one object: its own enumerable ones, or the listed ones.
pub(crate) enum Properties<'a> {
    Own(JSPropertyIterator<'a>),
    Listed {
        global: &'a JSGlobalObject,
        object: JSValue,
        keys: Rc<[OwnedString]>,
        next: usize,
    },
}

impl<'a> Properties<'a> {
    pub(crate) fn init(
        global: &'a JSGlobalObject,
        object: JSValue,
        keys: Option<Rc<[OwnedString]>>,
    ) -> JsResult<Self> {
        Ok(match keys {
            Some(keys) => Self::Listed {
                global,
                object,
                keys,
                next: 0,
            },
            None => Self::Own(JSPropertyIterator::init(
                global,
                object.to_object(global)?,
                JSPropertyIteratorOptions::new(false, true),
            )?),
        })
    }

    /// How many entries `next` can yield at most (a listed key the object lacks still counts).
    pub(crate) fn len(&self) -> usize {
        match self {
            Self::Own(iter) => iter.len,
            Self::Listed { keys, .. } => keys.len(),
        }
    }

    /// The next name (borrowed while `self` lives) and value; a missing key yields `undefined`.
    pub(crate) fn next(&mut self) -> JsResult<Option<(BunString, JSValue)>> {
        match self {
            Self::Own(iter) => Ok(iter.next()?.map(|name| (name, iter.value))),
            Self::Listed {
                global,
                object,
                keys,
                next,
            } => {
                let Some(key) = keys.get(*next) else {
                    return Ok(None);
                };
                *next += 1;
                Ok(Some((key.get(), object.get_may_be_index(global, key)?)))
            }
        }
    }
}

struct Copier<'a> {
    global: &'a JSGlobalObject,
    function: JSValue,
    /// The objects the format writes as one value (TOML's dates); they are kept as they are.
    is_leaf: fn(JSValue) -> bool,
    stack_check: StackCheck,
    /// The objects being copied right now, to their copies, so a cycle links back to one of them.
    ancestors: HashMap<JSValue, JSValue>,
    /// Keeps the entries of `ancestors` alive while the replacer runs JS.
    roots: &'a mut MarkedArgumentBuffer,
}

impl Copier<'_> {
    /// Unboxes (ECMA-262 SerializeJSONProperty step 4), then copies what a stringifier walks into.
    fn replaced(&mut self, value: JSValue) -> JsResult<JSValue> {
        let value = value.unwrap_boxed_primitive(self.global)?;
        if !value.is_object() || value.is_function() || (self.is_leaf)(value) {
            return Ok(value);
        }
        if let Some(copy) = self.ancestors.get(&value) {
            return Ok(*copy);
        }
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global.throw_stack_overflow());
        }
        if value.is_array() {
            self.copy_array(value)
        } else {
            self.copy_object(value)
        }
    }

    fn enter(&mut self, original: JSValue, copy: JSValue) -> JsResult<()> {
        self.roots.append(original);
        self.roots.append(copy);
        self.ancestors.put(original, copy)?;
        Ok(())
    }

    /// An `undefined` result is left out: it is written like a hole, and a sparse array stays so.
    fn copy_array(&mut self, array: JSValue) -> JsResult<JSValue> {
        let global = self.global;
        let mut items = array.array_iterator(global)?;
        let copy = JSValue::create_empty_array(global, items.len as usize)?;
        self.enter(array, copy)?;
        let mut index: u32 = 0;
        while let Some(item) = items.next()? {
            let key = JSValue::js_number_from_uint64(u64::from(index))
                .to_js_string(global)?
                .to_js();
            let item = self.function.call(global, array, &[key, item])?;
            let item = self.replaced(item)?;
            if !item.is_undefined() {
                copy.put_index(global, index, item)?;
            }
            index += 1;
        }
        self.ancestors.remove(&array);
        Ok(copy)
    }

    /// An `undefined` result is left out, which is how every stringifier writes it anyway.
    fn copy_object(&mut self, object: JSValue) -> JsResult<JSValue> {
        let global = self.global;
        // The stringifiers' own enumeration, so the copy holds what they would write.
        let mut properties = JSPropertyIterator::init(
            global,
            object.to_object(global)?,
            JSPropertyIteratorOptions::new(false, true),
        )?;
        let copy = JSValue::create_empty_object(global, properties.len);
        self.enter(object, copy)?;
        while let Some(name) = properties.next()? {
            let key = name.to_js(global)?;
            let value = self
                .function
                .call(global, object, &[key, properties.value])?;
            let value = self.replaced(value)?;
            if !value.is_undefined() {
                copy.put_may_be_index(global, &name, value)?;
            }
        }
        self.ancestors.remove(&object);
        Ok(copy)
    }
}
