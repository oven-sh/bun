use bun_core::strings;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};

use crate::generated_bindgen::telemetry::{BaggageEntry, BaggageEntryInit};

#[derive(Clone)]
struct Entry {
    key: Box<[u8]>,
    value: Box<[u8]>,
    metadata: Option<Box<[u8]>>,
}

/// `@opentelemetry/api`'s `Baggage`.
#[derive(Default)]
pub(crate) struct Baggage(Vec<Entry>);

fn append_member(header: &mut Vec<u8>, key: &[u8], value: &[u8], metadata: Option<&[u8]>) {
    if !header.is_empty() {
        header.push(b',');
    }
    strings::percent_encode_uri_component(key, header);
    header.push(b'=');
    strings::percent_encode_uri_component(value, header);
    if let Some(metadata) = metadata {
        header.push(b';');
        header.extend_from_slice(metadata);
    }
}

impl Baggage {
    /// `None` if `header` has no member.
    pub(crate) fn parse(header: &[u8]) -> Option<Baggage> {
        if !bun_telemetry::propagation::baggage_is_reasonable(header) {
            return None;
        }
        let trim = |s| strings::trim(s, b" \t");
        let mut baggage = Baggage::default();
        for member in strings::split(header, b",") {
            let (pair, metadata) = match strings::split_once_char(member, b';') {
                Some((pair, metadata)) => (pair, Some(trim(metadata).into())),
                None => (member, None),
            };
            if let Some((key, value)) = strings::split_once_char(pair, b'=')
                && !trim(key).is_empty()
            {
                baggage.insert(Entry {
                    key: bun_url::PercentEncoding::decode_lenient_alloc(trim(key)),
                    value: bun_url::PercentEncoding::decode_lenient_alloc(trim(value)),
                    metadata,
                });
            }
        }
        (!baggage.0.is_empty()).then_some(baggage)
    }

    /// The header of any api `Baggage`. Runs the `getAllEntries()` of one that is not ours.
    pub(crate) fn header_of(global: &JSGlobalObject, baggage: JSValue) -> JsResult<Vec<u8>> {
        let mut header = Vec::new();
        if let Some(own) = baggage.as_class_ref::<Baggage>() {
            for e in &own.0 {
                append_member(&mut header, &e.key, &e.value, e.metadata.as_deref());
            }
        } else if baggage.is_object()
            && let Some(get_all_entries) = baggage.get(global, "getAllEntries")?
            && get_all_entries.is_callable()
        {
            let entries = get_all_entries.call_for_running_script(global, baggage, &[])?;
            entries.try_for_each(global, |pair| {
                let key = pair.get_index(global, 0)?.to_utf8(global)?;
                let entry = BaggageEntryInit::from_js(global, pair.get_index(global, 1)?)?;
                append_member(&mut header, &key, &entry.value, entry.metadata.as_deref());
                Ok(())
            })?;
        }
        Ok(header)
    }

    fn insert(&mut self, entry: Entry) {
        match self.0.iter_mut().find(|e| e.key == entry.key) {
            Some(present) => *present = entry,
            None => self.0.push(entry),
        }
    }

    fn without(&self, is_removed: impl Fn(&[u8]) -> bool) -> Baggage {
        let kept = self.0.iter().filter(|e| !is_removed(&e.key));
        Baggage(kept.cloned().collect())
    }

    pub(crate) fn get_entry(&self, key: &[u8]) -> Option<BaggageEntry> {
        let entry = self.0.iter().find(|e| *e.key == *key)?;
        Some(BaggageEntry {
            value: entry.value.to_vec(),
            metadata: entry.metadata.as_deref().map(<[u8]>::to_vec),
        })
    }

    pub(crate) fn get_all_entries(&self, heap: &JsHeap<'_>) -> JsResult<JSValue> {
        // SAFETY: strings, arrays and objects are made, and their properties are defined and not set.
        let global = unsafe { heap.global() };
        let string = |s: &[u8]| bun_string_jsc::create_utf8_for_js(global, s);
        JSValue::create_array_from_iter(global, self.0.iter(), |e| {
            let entry = JSValue::create_empty_object(global, 2);
            entry.put(global, "value", string(&e.value)?);
            if let Some(metadata) = &e.metadata {
                entry.put(global, "metadata", string(metadata)?);
            }
            JSValue::create_array_from_slice(global, &[string(&e.key)?, entry])
        })
    }

    pub(crate) fn set_entry<'a>(
        &self,
        heap: &JsHeap<'a>,
        key: &[u8],
        entry: &BaggageEntryInit,
    ) -> JsWrapper<'a, Self> {
        let mut changed = Baggage(self.0.clone());
        changed.insert(Entry {
            key: key.into(),
            value: (*entry.value).into(),
            metadata: entry.metadata.as_deref().map(Into::into),
        });
        changed.into_js(heap)
    }

    pub(crate) fn remove_entry<'a>(&self, heap: &JsHeap<'a>, key: &[u8]) -> JsWrapper<'a, Self> {
        self.without(|k| k == key).into_js(heap)
    }

    pub(crate) fn remove_entries<'a>(
        &self,
        cx: &mut JsScope<'a>,
        keys: &[JsLocal<'a>],
    ) -> JsResult<JsWrapper<'a, Self>> {
        let keys = keys
            .iter()
            .map(|key| key.to_js().to_utf8(cx.global()))
            .collect::<JsResult<Vec<_>>>()?;
        let kept = self.without(|k| keys.iter().any(|key| **key == *k));
        Ok(kept.into_js(&cx.heap))
    }

    pub(crate) fn clear<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        Baggage::default().into_js(heap)
    }
}
