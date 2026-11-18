//! <https://w3c.github.io/IndexedDB/#key-construct> and <https://w3c.github.io/IndexedDB/#key-path-construct>

use bun_jsc::webcore_types::Blob;
use bun_jsc::{ArrayBuffer, StringJsc};
use bun_markup::Chars;
use bun_web::storage::key::Token;

use super::*;
use crate::order::Order as _;

const MAX_DEPTH: usize = 2000;
const MAX_LEN_OF_ARRAY: usize = 1 << 24;

fn push_string(out: &mut Vec<u8>, text: &DomString) {
    match text.chars() {
        Chars::Latin1(it) => key::push_string(out, it.iter().map(|it| u16::from(*it))),
        Chars::Utf16(it) => key::push_string(out, it.iter().copied()),
    }
}

pub(crate) fn key_of_string(text: &DomString) -> Key {
    let mut key = Vec::new();
    push_string(&mut key, text);
    key.into()
}

pub(crate) fn string_of_key(mut key: &[u8]) -> DomString {
    if let Some(Token::String(units)) = key::read_token(&mut key) {
        DomString::from_chars(Chars::Utf16(&units))
    } else {
        DomString::default()
    }
}

/// The arrays that it is in.
struct Outer<'o> {
    array: JSValue,
    depth: usize,
    next: Option<&'o Outer<'o>>,
}

/// <https://w3c.github.io/IndexedDB/#convert-a-value-to-a-key>. False if it is invalid.
fn push_key<'a>(
    cx: Cx<'_, 'a>,
    value: JSValue,
    out: &mut Vec<u8>,
    outer: Option<&Outer<'_>>,
) -> Result<'a, bool> {
    let local = JsLocal::new(&cx.heap, value);
    if let Some(number) = value.get_number() {
        key::push_number(out, number);
        return Ok(!number.is_nan());
    }
    if let Some(string) = local.as_string() {
        push_string(out, &DomString::from_js_string(&cx.heap, string)?);
        return Ok(true);
    }
    if value.is_date() {
        key::push_date(out, value.get_unix_timestamp());
        return Ok(!value.get_unix_timestamp().is_nan());
    }
    if let Some(buffer) = local.as_buffer_source() {
        buffer.with_bytes(&cx.heap, |it| key::push_binary(out, it));
        return Ok(!value
            .as_array_buffer(cx.global())
            .is_some_and(|it| it.is_detached()));
    }
    let depth = outer.map_or(0, |it| it.depth + 1);
    if !value.is_array()
        || depth > MAX_DEPTH
        || core::iter::successors(outer, |it| it.next).any(|it| it.array == value)
    {
        return Ok(false);
    }
    cx.check_stack()?;
    key::begin_array(out);
    for index in 0..value.get_length(cx.global())? as u32 {
        let mut item = List::from_value(value).get(index);
        if out.len() > MAX_LEN_OF_ARRAY
            || (item.is_empty()
                && !value.has_own_property_value(cx.global(), JSValue::js_number(index.into()))?)
        {
            return Ok(false);
        }
        if item.is_empty() {
            item = value.get_index(cx.global(), index)?;
        }
        if !push_key(
            cx,
            item,
            out,
            Some(&Outer {
                array: value,
                depth,
                next: outer,
            }),
        )? {
            return Ok(false);
        }
    }
    key::end_array(out);
    Ok(true)
}

fn try_key_of<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, Option<Vec<u8>>> {
    let mut key = Vec::new();
    Ok(push_key(cx, value, &mut key, None)?.then_some(key))
}

pub(super) fn invalid_key<'a>(heap: &JsHeap<'a>) -> Error<'a> {
    dom_error(
        heap,
        DomError::DataError,
        "The parameter is not a valid key.",
    )
}

pub(super) fn key_of<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Vec<u8>> {
    try_key_of(cx, value.to_js())?.ok_or_else(|| invalid_key(&cx.heap))
}

/// `None` at the end of an array.
fn read_value<'a>(heap: &JsHeap<'a>, rest: &mut &[u8]) -> Result<'a, Option<JSValue>> {
    Ok(Some(match key::read_token(rest) {
        None | Some(Token::EndArray) => return Ok(None),
        Some(Token::Number(number)) => JSValue::js_number(JSValue::purify_nan(number)),
        Some(Token::Date(time)) => {
            JSValue::from_date_number(global_of(heap), JSValue::purify_nan(time))
        }
        Some(Token::String(units)) => DomString::from_chars(Chars::Utf16(&units))
            .to_js(heap)
            .to_js(),
        Some(Token::Binary(bytes)) => {
            ArrayBuffer::create::<{ bun_jsc::JSType::ArrayBuffer }>(global_of(heap), &bytes)?
        }
        Some(Token::BeginArray) if !bun_core::StackCheck::init().is_safe_to_recurse() => {
            return Err(global_of(heap).throw_stack_overflow().into());
        }
        Some(Token::BeginArray) => {
            let (array, mut len) = (JSValue::create_empty_array(global_of(heap), 0)?, 0);
            while let Some(item) = read_value(heap, rest)? {
                array.put_index(global_of(heap), len, item)?;
                len += 1;
            }
            array
        }
    }))
}

/// <https://w3c.github.io/IndexedDB/#convert-a-key-to-a-value>, of the first key.
pub(super) fn value_of_key<'a>(heap: &JsHeap<'a>, mut key: &[u8]) -> Result<'a, JSValue> {
    Ok(read_value(heap, &mut key)?.unwrap_or(JSValue::UNDEFINED))
}

pub(super) fn is_potentially_key_or_range<'a>(heap: &JsHeap<'a>, value: JsLocal<'a>) -> bool {
    let it = value.to_js();
    !it.is_object()
        || it.is_array()
        || it.is_date()
        || value.as_buffer_source().is_some()
        || IDBKeyRange::from_js(heap, it).is_some()
}

pub(super) fn strings_of<'a>(heap: &JsHeap<'a>, names: IDBNames<'a>) -> Result<'a, Vec<DomString>> {
    match names {
        IDBNames::One(name) => Ok(vec![DomString::from_js_string(heap, name)?]),
        IDBNames::Several(names) => names
            .iter()
            .map(|it| DomString::from_js_string(heap, it))
            .collect(),
    }
}

pub(super) struct KeyPath {
    pub(super) encoded: Key,
    pub(super) is_list: bool,
    /// The identifiers of each string.
    paths: Vec<Vec<bun_core::String>>,
}

pub(super) enum Extracted {
    Key(Vec<u8>),
    Invalid,
    Failure,
}

fn member_of_blob(
    global: &JSGlobalObject,
    blob: &Blob,
    name: &bun_core::String,
) -> JsResult<Option<JSValue>> {
    Ok(Some(match () {
        () if name.eq_ascii(b"size") => {
            JSValue::js_number(bun_web::runtime::size_of_blob(blob) as f64)
        }
        () if name.eq_ascii(b"type") => {
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, blob.content_type.get().given())?
        }
        () if name.eq_ascii(b"name") && blob.is_jsdom_file.get() => {
            StringJsc::to_js(blob.name.get(), global)?
        }
        () if name.eq_ascii(b"lastModified") && blob.is_jsdom_file.get() => {
            JSValue::js_number(blob.last_modified.get())
        }
        () => return Ok(None),
    }))
}

fn follow(
    global: &JSGlobalObject,
    mut value: JSValue,
    path: &[bun_core::String],
) -> JsResult<Option<JSValue>> {
    for name in path {
        let member = match value.as_class_ref::<Blob>() {
            Some(blob) => member_of_blob(global, &blob, name)?,
            None if value.is_object()
                || (value.is_string_literal() && name.eq_ascii(b"length")) =>
            {
                value.get_own(global, name)?
            }
            None => None,
        };
        let Some(member) = member.filter(|it| !it.is_undefined()) else {
            return Ok(None);
        };
        value = member;
    }
    Ok(Some(value))
}

impl KeyPath {
    pub(super) fn parse(encoded: &Key) -> KeyPath {
        let (mut rest, mut is_list, mut paths) = (&**encoded, false, Vec::new());
        while let Some(token) = key::read_token(&mut rest) {
            match token {
                Token::String(path) if path.is_empty() => paths.push(Vec::new()),
                Token::String(path) => paths.push(
                    path.split(|it| *it == u16::from(b'.'))
                        .map(bun_core::String::clone_utf16)
                        .collect(),
                ),
                _ => is_list = true,
            }
        }
        KeyPath {
            encoded: Key::clone(encoded),
            is_list,
            paths,
        }
    }

    pub(super) fn from_js<'a>(heap: &JsHeap<'a>, given: IDBNames<'a>) -> Result<'a, KeyPath> {
        let (is_list, mut encoded) = (matches!(given, IDBNames::Several(_)), Vec::new());
        if is_list {
            key::begin_array(&mut encoded);
        }
        strings_of(heap, given)?
            .iter()
            .for_each(|it| push_string(&mut encoded, it));
        if is_list {
            key::end_array(&mut encoded);
        }
        Ok(KeyPath::parse(&encoded.into()))
    }

    pub(super) fn validate<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        match !self.paths.is_empty()
            && self
                .paths
                .iter()
                .flatten()
                .all(|it| bun_core::identifier::is_identifier(&it.to_utf8()))
        {
            true => Ok(()),
            false => Err(dom_error(
                heap,
                DomError::SyntaxError,
                "The keyPath argument contains an invalid key path.",
            )),
        }
    }

    /// What has been stored can be without any.
    fn first(&self) -> &[bun_core::String] {
        self.paths.first().map_or(&[], |it| it)
    }

    pub(super) fn is_empty_string(&self) -> bool {
        !self.is_list && self.first().is_empty()
    }

    /// <https://w3c.github.io/IndexedDB/#extract-a-key-from-a-value-using-a-key-path>
    pub(super) fn extract<'a>(&self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, Extracted> {
        let (mut key, mut is_valid) = (Vec::new(), true);
        if self.is_list {
            key::begin_array(&mut key);
        }
        for path in &self.paths {
            let Some(part) = follow(cx.global(), value, path)? else {
                return Ok(Extracted::Failure);
            };
            is_valid &= push_key(cx, part, &mut key, None)?;
        }
        if self.is_list {
            key::end_array(&mut key);
        }
        Ok(if is_valid {
            Extracted::Key(key)
        } else {
            Extracted::Invalid
        })
    }

    pub(super) fn extract_for_index<'a>(
        &self,
        cx: Cx<'_, 'a>,
        value: JSValue,
        is_multi_entry: bool,
    ) -> Result<'a, Vec<Vec<u8>>> {
        if is_multi_entry
            && let Some(array) =
                follow(cx.global(), value, self.first())?.filter(|it| it.is_array())
        {
            let mut keys = Vec::new();
            for index in 0..array.get_length(cx.global())? as u32 {
                let item = array.get_direct_index(cx.global(), index)?;
                keys.extend(if item.is_empty() {
                    None
                } else {
                    try_key_of(cx, item)?
                });
            }
            keys.order_by(Ord::cmp);
            keys.dedup();
            return Ok(keys);
        }
        Ok(if let Extracted::Key(key) = self.extract(cx, value)? {
            vec![key]
        } else {
            Vec::new()
        })
    }

    /// <https://w3c.github.io/IndexedDB/#check-that-a-key-could-be-injected-into-a-value>
    pub(super) fn can_inject(&self, global: &JSGlobalObject, mut value: JSValue) -> JsResult<bool> {
        for name in self.first().split_last().map_or(&[][..], |it| it.1) {
            if !value.is_object() {
                return Ok(false);
            }
            let Some(member) = value.get_own(global, name)? else {
                return Ok(true);
            };
            value = member;
        }
        Ok(value.is_object())
    }

    /// <https://w3c.github.io/IndexedDB/#inject-a-key-into-a-value-using-a-key-path>
    pub(super) fn inject(
        &self,
        global: &JSGlobalObject,
        mut value: JSValue,
        key: f64,
    ) -> JsResult<()> {
        let Some((last, names)) = self.first().split_last() else {
            return Ok(());
        };
        for name in names {
            value = match value.get_own(global, name)? {
                Some(member) => member,
                None => {
                    let member = JSValue::create_empty_object(global, 1);
                    value.put_may_be_index(global, name, member)?;
                    member
                }
            };
        }
        value.put_may_be_index(global, last, JSValue::js_number(key))
    }
}

pub(crate) struct IDBKeyRange {
    lower: Option<Vec<u8>>,
    upper: Option<Vec<u8>>,
    is_lower_open: bool,
    is_upper_open: bool,
}

impl IDBKeyRange {
    fn range(&self) -> KeyRange {
        KeyRange::new(
            self.lower.as_deref(),
            self.upper.as_deref(),
            self.is_lower_open,
            self.is_upper_open,
        )
    }

    pub(crate) fn only<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, &'a IDBKeyRange> {
        let key = Some(key_of(cx, value)?);
        Ok(js_IDBKeyRange::create(
            &cx.heap,
            IDBKeyRange {
                lower: key.clone(),
                upper: key,
                is_lower_open: false,
                is_upper_open: false,
            },
        ))
    }

    pub(crate) fn lower_bound<'a>(
        cx: Cx<'_, 'a>,
        lower: JsLocal<'a>,
        is_open: bool,
    ) -> Result<'a, &'a IDBKeyRange> {
        let lower = Some(key_of(cx, lower)?);
        Ok(js_IDBKeyRange::create(
            &cx.heap,
            IDBKeyRange {
                lower,
                upper: None,
                is_lower_open: is_open,
                is_upper_open: true,
            },
        ))
    }

    pub(crate) fn upper_bound<'a>(
        cx: Cx<'_, 'a>,
        upper: JsLocal<'a>,
        is_open: bool,
    ) -> Result<'a, &'a IDBKeyRange> {
        let upper = Some(key_of(cx, upper)?);
        Ok(js_IDBKeyRange::create(
            &cx.heap,
            IDBKeyRange {
                lower: None,
                upper,
                is_lower_open: true,
                is_upper_open: is_open,
            },
        ))
    }

    pub(crate) fn bound<'a>(
        cx: Cx<'_, 'a>,
        lower: JsLocal<'a>,
        upper: JsLocal<'a>,
        is_lower_open: bool,
        is_upper_open: bool,
    ) -> Result<'a, &'a IDBKeyRange> {
        let (lower, upper) = (key_of(cx, lower)?, key_of(cx, upper)?);
        if lower > upper || (lower == upper && (is_lower_open || is_upper_open)) {
            return Err(dom_error(
                &cx.heap,
                DomError::DataError,
                "The lower key is greater than the upper key.",
            ));
        }
        Ok(js_IDBKeyRange::create(
            &cx.heap,
            IDBKeyRange {
                lower: Some(lower),
                upper: Some(upper),
                is_lower_open,
                is_upper_open,
            },
        ))
    }

    pub(crate) fn get_lower<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        value_of_key(heap, self.lower.as_deref().unwrap_or_default())
    }

    pub(crate) fn get_upper<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        value_of_key(heap, self.upper.as_deref().unwrap_or_default())
    }

    pub(crate) fn get_lower_open(&self) -> bool {
        self.is_lower_open
    }

    pub(crate) fn get_upper_open(&self) -> bool {
        self.is_upper_open
    }

    pub(crate) fn includes<'a>(&self, cx: Cx<'_, 'a>, key: JsLocal<'a>) -> Result<'a, bool> {
        Ok(self.range().includes(&key_of(cx, key)?))
    }
}

/// <https://w3c.github.io/IndexedDB/#convert-a-value-to-a-key-range>
pub(super) fn range_of<'a>(
    cx: Cx<'_, 'a>,
    query: JsLocal<'a>,
    is_required: bool,
) -> Result<'a, KeyRange> {
    match IDBKeyRange::from_js(&cx.heap, query.to_js()) {
        Some(range) => Ok(range.range()),
        None if !is_required && query.to_js().is_undefined_or_null() => Ok(KeyRange::all()),
        None => Ok(KeyRange::only(&key_of(cx, query)?)),
    }
}
