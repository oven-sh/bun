//! The domain DOMStorage, and what the document has loaded.

use bun_core::strings;
use bun_jsc::bindgen::JsInterface as _;
use bun_web::net::schemes::mime_of_file;

use super::*;
use crate::api::storage::WebStorage;
use crate::api::window::Window;

/// The id that the client has for each of the two areas that it has looked at, and the hashes of the values.
#[derive(Default)]
pub(super) struct Reported(RefCell<[Option<(Value, Map<Atom, u64>)>; 2]>);

fn area<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, is_local: bool) -> Result<&'a WebStorage, String> {
    let window = doc
        .window()
        .and_then(|it| it.downcast::<Window>())
        .ok_or("Frame not found for the given storage id")?;
    let area = if is_local {
        window.get_local_storage(cx)
    } else {
        window.get_session_storage(cx)
    };
    or_message(cx, area)
}

fn hashes(items: &[(Atom, DomString)]) -> Map<Atom, u64> {
    items
        .iter()
        .map(|it| (it.0.clone(), nodes::hash(&it.1)))
        .collect()
}

pub(super) fn resources<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> Outcome {
    let mut all = Vec::new();
    for element in doc.descendant_elements() {
        let (kind, name) = match element.html_tag() {
            atom!("img") => ("Image", atom!("src")),
            atom!("script") => ("Script", atom!("src")),
            atom!("link")
                if element.with_attr(atom!("rel"), |it| it.eq_ignore_ascii_case("stylesheet"))
                    == Some(true) =>
            {
                ("Stylesheet", atom!("href"))
            }
            _ => continue,
        };
        let url = element
            .attr(name)
            .and_then(|it| doc.parse_url(cx, &it))
            .map(|it| utf8(it.href()));
        if let Some(url) = url.filter(|it| !it.text().starts_with("data:")) {
            let mime = mime_of_file(
                strings::split_any(url.text().as_bytes(), b"?#")
                    .next()
                    .unwrap_or_default(),
            );
            all.push(record! { "url": url, "type": kind, "mimeType": lossy(&mime) });
        }
    }
    Ok(record! { "resources": Value::List(all) })
}

impl Inspector {
    pub(super) fn compare_storage<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
        let mut is_watched = false;
        for is_local in [false, true] {
            let Some((id, before)) = self.site.0.borrow_mut()[usize::from(is_local)].take() else {
                continue;
            };
            let now = area(cx, doc, is_local)
                .map(WebStorage::entries)
                .unwrap_or_default();
            let hashes = hashes(&now);
            for key in before.keys().filter(|it| !hashes.contains_key(*it)) {
                self.emit(
                    "DOMStorage.domStorageItemRemoved",
                    record! { "storageId": &id, "key": &*key.as_utf8() },
                );
            }
            for (key, value) in now
                .iter()
                .filter(|it| before.get(&it.0) != hashes.get(&it.0))
            {
                let event = if before.contains_key(key) {
                    "DOMStorage.domStorageItemUpdated"
                } else {
                    "DOMStorage.domStorageItemAdded"
                };
                self.emit(event, record! { "storageId": &id, "key": &*key.as_utf8(), "oldValue": "", "newValue": utf8(value) });
            }
            self.site.0.borrow_mut()[usize::from(is_local)] = Some((id, hashes));
            is_watched = true;
        }
        is_watched
    }

    pub(super) fn about_storage<'a>(
        &self,
        cx: Cx<'_, 'a>,
        doc: &'a Doc,
        name: &str,
        params: &Value,
    ) -> Option<Outcome> {
        if !matches!(
            name,
            "getDOMStorageItems" | "setDOMStorageItem" | "removeDOMStorageItem" | "clear"
        ) {
            return None;
        }
        let (is_local, key) = (
            params["storageId"]["isLocalStorage"].is_truthy(),
            Atom::new(params["key"].text()),
        );
        Some(area(cx, doc, is_local).and_then(|area| {
            let result = match name {
                "getDOMStorageItems" => {
                    let all = area.entries();
                    self.site.0.borrow_mut()[usize::from(is_local)] = Some((params["storageId"].clone(), hashes(&all)));
                    return Ok(record! { "entries": all.iter().map(|it| list![&*it.0.as_utf8(), utf8(&it.1)]).collect::<Value>() });
                }
                "setDOMStorageItem" => area.set_item(cx, key, DomString::from_utf8(params["value"].text())),
                "removeDOMStorageItem" => area.remove_item(cx, &key),
                _ => area.clear(cx),
            };
            or_message(cx, result)?;
            self.compare_storage(cx, doc);
            empty()
        }))
    }
}
