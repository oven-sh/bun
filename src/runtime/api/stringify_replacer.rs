//! `JSON.stringify`'s replacer for the YAML, TOML and JSON5 stringifiers.

use std::rc::Rc;

use bun_collections::StringHashMap;
use bun_core::{String as BunString, StringView};
use bun_jsc::{
    JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSType, JSValue, JsResult,
    StringJsc,
};

pub(crate) enum Replacer {
    /// Called with the holder as `this` for the root (key `""`), every property and every element.
    Function(JSValue),
    /// `JSON.stringify`'s property list: the properties to write for every object, in this order.
    Keys(Rc<[BunString]>),
}

impl Replacer {
    /// `None` for what is neither callable nor an array, which `JSON.stringify` ignores too.
    pub(crate) fn from_js(global: &JSGlobalObject, replacer: JSValue) -> JsResult<Option<Self>> {
        if replacer.is_callable() {
            return Ok(Some(Self::Function(replacer)));
        }
        if !replacer.is_array_including_proxy(global)? {
            return Ok(None);
        }

        let mut keys: Vec<BunString> = Vec::new();
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
            let key = item.to_bun_string(global)?;
            if seen.get_or_put(key.to_utf8().slice())?.found_existing {
                continue;
            }
            keys.push(key);
        }
        Ok(Some(Self::Keys(Rc::from(keys))))
    }

    /// Whether the replacer is a function, which every occurrence of a value goes through.
    pub(crate) fn is_function(&self) -> bool {
        matches!(self, Self::Function(_))
    }

    /// The root after the replacer: `replacer.call({ "": value }, "", value)` for a function.
    pub(crate) fn replace_root(
        &self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<JSValue> {
        let Self::Function(function) = self else {
            return Ok(value);
        };
        let holder = JSValue::create_empty_object(global, 1);
        holder.put(global, b"", value);
        function.call(global, holder, &[JSValue::js_empty_string(global), value])
    }

    /// `holder[name]` after the replacer.
    pub(crate) fn replace_property(
        &self,
        global: &JSGlobalObject,
        holder: JSValue,
        name: &BunString,
        value: JSValue,
    ) -> JsResult<JSValue> {
        let Self::Function(function) = self else {
            return Ok(value);
        };
        function.call(global, holder, &[name.to_js(global)?, value])
    }

    /// `array[index]` after the replacer.
    pub(crate) fn replace_element(
        &self,
        global: &JSGlobalObject,
        array: JSValue,
        index: u32,
        value: JSValue,
    ) -> JsResult<JSValue> {
        let Self::Function(function) = self else {
            return Ok(value);
        };
        let key = JSValue::js_number_from_uint64(u64::from(index))
            .to_js_string(global)?
            .to_js();
        function.call(global, array, &[key, value])
    }
}

/// The properties a stringifier writes for one object: its own enumerable ones, or the listed ones.
pub(crate) enum Properties<'a> {
    Own(JSPropertyIterator<'a>),
    Listed {
        global: &'a JSGlobalObject,
        object: JSValue,
        keys: Rc<[BunString]>,
        next: usize,
    },
}

impl<'a> Properties<'a> {
    pub(crate) fn init(
        global: &'a JSGlobalObject,
        object: JSValue,
        replacer: Option<&Replacer>,
    ) -> JsResult<Self> {
        Ok(match replacer {
            Some(Replacer::Keys(keys)) => Self::Listed {
                global,
                object,
                keys: Rc::clone(keys),
                next: 0,
            },
            _ => Self::Own(JSPropertyIterator::init(
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
    pub(crate) fn next(&mut self) -> JsResult<Option<(StringView<'_>, JSValue)>> {
        match self {
            Self::Own(iter) => iter.next(),
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
                Ok(Some((
                    StringView::new(key),
                    object.get_may_be_index(global, key)?,
                )))
            }
        }
    }
}
