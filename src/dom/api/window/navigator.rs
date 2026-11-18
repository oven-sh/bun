//! <https://html.spec.whatwg.org/#the-navigator-object>

use bun_core::strings;
use bun_jsc::{DOMExceptionCode, Strong};
use bun_web::host::Connection;
use bun_web::origin::Origin;
use bun_web::tasks::{self, Priority, Work};
use bun_web::url::Url;

use super::screen::WindowControlsOverlay;
use super::*;
use crate::api::transfer::clipboard::Clipboard;
use crate::api::{on_behalf, ui};
use crate::generated_bindgen::interaction::UserActivation;

const PLATFORM: &str = match () {
    () if cfg!(target_os = "macos") => "MacIntel",
    () if cfg!(windows) => "Win32",
    () if cfg!(target_arch = "aarch64") => "Linux aarch64",
    () => "Linux x86_64",
};
const SYSTEM: &str = match () {
    () if cfg!(target_os = "macos") => "macOS",
    () if cfg!(windows) => "Windows",
    () => "Linux",
};

macro_rules! constants {
    ($($Type:ty { $($get:ident -> $Result:ty = $value:expr;)* })*) => {$(
        impl $Type {
            $(pub(crate) fn $get(&self) -> $Result {
                $value
            })*
        }
    )*};
}

constants! {
    NavigatorEverywhere {
        get_app_code_name -> &str = "Mozilla";
        get_app_name -> &str = "Netscape";
        get_platform -> &str = PLATFORM;
        get_product -> &str = "Gecko";
        get_hardware_concurrency -> u32 = bun_core::get_thread_count().into();
        get_device_memory -> f64 = 8.0;
    }
    DomNavigator {
        get_product_sub -> &str = "20030107";
        get_vendor -> &str = "Google Inc.";
        get_vendor_sub -> &str = "";
        get_cookie_enabled -> bool = true;
        get_pdf_viewer_enabled -> bool = false;
        get_webdriver -> bool = false;
        get_do_not_track -> Option<&str> = None;
        get_max_touch_points -> i32 = 0;
        java_enabled -> bool = false;
    }
    NetworkInformation {
        get_effective_type -> &str = "4g";
        get_rtt -> u32 = 50;
        get_downlink -> f64 = 10.0;
        get_save_data -> bool = false;
    }
    NavigatorUAData {
        get_mobile -> bool = false;
        get_platform -> &str = SYSTEM;
    }
    PluginArray {
        refresh -> () = ();
    }
    Keyboard {
        unlock -> () = ();
    }
}

impl Window {
    pub(crate) fn get_navigator<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DomNavigator {
        let navigator = js_DomNavigator::create(self.realm(heap), Default::default());
        js_AnyNavigator::set_scope(navigator, Some(self));
        navigator
    }

    pub(crate) fn get_client_information<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DomNavigator {
        js_DomWindow::navigator(self).unwrap_or_else(|| {
            let navigator = self.get_navigator(heap);
            js_DomWindow::set_navigator(self, Some(navigator));
            navigator
        })
    }

    pub(super) fn set_languages(&self, languages: Vec<String>) {
        if !WindowTarget::set_languages(self, languages) {
            return;
        }
        if let Some(navigator) = js_DomWindow::navigator(self) {
            js_AnyNavigator::set_languages(navigator, JSValue::ZERO);
        }
    }
}

impl AnyNavigator {
    fn scope(&self) -> &WindowTarget {
        js_AnyNavigator::scope(self).expect("set when it is made")
    }
}

impl NavigatorEverywhere {
    pub(crate) fn get_user_agent(&self) -> &str {
        &self.scope().browser().user_agent
    }

    pub(crate) fn get_app_version(&self) -> &str {
        let user_agent = self.get_user_agent();
        user_agent.strip_prefix("Mozilla/").unwrap_or(user_agent)
    }

    pub(crate) fn get_language(&self) -> String {
        self.scope().language()
    }

    pub(crate) fn get_languages<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if let Some(languages) = js_AnyNavigator::languages(self) {
            return Ok(languages);
        }
        let heap = self.realm(&cx.heap);
        let languages = heap.create_array(self.scope().languages(), |heap, it| {
            Ok(heap.create_utf8_string(it.as_bytes())?.as_value())
        })?;
        js_AnyNavigator::set_languages(self, heap.freeze_array(languages)?.to_js());
        Ok(languages.to_js())
    }

    pub(crate) fn get_on_line(&self, _: Cx<'_, '_>) -> bool {
        self.scope().host().connection() == Connection::Online
    }

    pub(crate) fn get_connection<'a>(&'a self, heap: &JsHeap<'a>) -> &'a NetworkInformation {
        js_NetworkInformation::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_user_agent_data<'a>(&'a self, heap: &JsHeap<'a>) -> &'a NavigatorUAData {
        let data = js_NavigatorUAData::create(self.realm(heap), Default::default());
        js_NavigatorUAData::set_scope(data, Some(self.scope()));
        data
    }
}

/// <https://html.spec.whatwg.org/#safelisted-scheme>
const SAFELISTED_SCHEMES: &str = "bitcoin cabal dat did doi dweb ethereum geo hyper im ipfs ipns irc ircs magnet mailto matrix mms news nntp openpgp4fpr sip sms smsto ssb ssh tel urn webcal wtai xmpp";

fn may_be_handled(scheme: &[u8]) -> bool {
    match scheme.strip_prefix(b"web+") {
        Some(rest) => !rest.is_empty() && rest.iter().all(u8::is_ascii_lowercase),
        None => strings::split(SAFELISTED_SCHEMES.as_bytes(), b" ").any(|it| it == scheme),
    }
}

impl DomNavigator {
    fn window(&self) -> &Window {
        self.scope().downcast().expect("what has made it")
    }

    pub(crate) fn get_plugins<'a>(&'a self, heap: &JsHeap<'a>) -> &'a PluginArray {
        js_PluginArray::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_mime_types<'a>(&'a self, heap: &JsHeap<'a>) -> &'a MimeTypeArray {
        js_MimeTypeArray::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_scheduling<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Scheduling {
        js_Scheduling::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_keyboard<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Keyboard {
        js_Keyboard::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_user_activation<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> Option<&'a UserActivation> {
        Some(ui::entry::new_user_activation(
            heap,
            ui::Ui::of(self.window().document())?,
        ))
    }

    pub(crate) fn get_clipboard<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Clipboard {
        Clipboard::new(heap, self.window())
    }

    pub(crate) fn get_window_controls_overlay<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> &'a WindowControlsOverlay {
        WindowControlsOverlay::new(heap, self.window())
    }

    /// <https://html.spec.whatwg.org/#normalize-protocol-handler-parameters>. There is nobody to ask for more.
    pub(crate) fn decline_protocol_handler<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        scheme: &[u8],
        url: &DomString,
    ) -> Result<'a> {
        if !may_be_handled(&scheme.to_ascii_lowercase()) {
            let scheme = crate::values::text(scheme);
            return Err(cx.heap.dom_exception(
                DOMExceptionCode::SecurityError,
                format_args!("The scheme '{scheme}' is not allowed."),
            ));
        }
        let (doc, text) = (self.window().document(), url.to_utf8());
        let without_placeholder = strings::index_of(text.as_bytes(), b"%s")
            .map(|at| DomString::from_utf8(&[&text[..at], &text[at + 2..]].concat()));
        let resolved = without_placeholder
            .and_then(|it| on_behalf::resolve(cx, doc, &it))
            .filter(|_| on_behalf::resolve(cx, doc, url).is_some());
        let Some(resolved) = resolved.and_then(|it| Url::parse(it.to_utf8().as_bytes())) else {
            return Err(cx.heap.dom_exception(
                DOMExceptionCode::SyntaxError,
                format_args!("The URL '{text}' is invalid or does not contain '%s'."),
            ));
        };
        let origin = Origin::from_serialized(self.window().origin(&cx.heap).to_utf8().as_bytes());
        if !resolved.is_http() || !origin.is_origin_of(&resolved) {
            return Err(cx.heap.dom_exception(
                DOMExceptionCode::SecurityError,
                format_args!("Can only register a handler in the origin of the document."),
            ));
        }
        Ok(())
    }

    pub(crate) fn get_gamepads(&self, _: &JsHeap<'_>) -> [JSValue; 0] {
        []
    }

    pub(crate) fn vibrate(&self, _: JsLocal<'_>) -> bool {
        false
    }
}

macro_rules! empty_lists {
    ($($Type:ty)*) => {$(
        impl $Type {
            pub(crate) fn get_length(&self) -> u32 {
                0
            }

            pub(crate) fn indexed_get<'a>(&self, _: &JsHeap<'a>, _: u32) -> Option<JsLocal<'a, JSObject>> {
                None
            }

            pub(crate) fn item<'a>(&self, _: &JsHeap<'a>, _: u32) -> Option<JsLocal<'a, JSObject>> {
                None
            }

            pub(crate) fn named_item<'a>(&self, _: &JsHeap<'a>, _: JsLocal<'a, bun_jsc::JSString>) -> Option<JsLocal<'a, JSObject>> {
                None
            }
        }
    )*};
}

empty_lists!(PluginArray MimeTypeArray);

impl Scheduling {
    pub(crate) fn is_input_pending(&self, _: Cx<'_, '_>, options: &IsInputPendingOptions) -> bool {
        bun_ui::queue::is_input_pending(options.include_continuous)
    }
}

impl Keyboard {
    /// There is no browser to take keys from.
    pub(crate) fn lock<'a>(
        &self,
        cx: Cx<'_, 'a>,
        _: bindgen::JsList<'a, JsLocal<'a, bun_jsc::JSString>>,
    ) -> Result<'a, JSValue> {
        Ok(cx.promise_resolve(JSValue::UNDEFINED)?.to_js())
    }
}

fn put_text<'a>(
    heap: &JsHeap<'a>,
    object: JsLocal<'a, JSObject>,
    name: &str,
    text: &str,
) -> Result<'a> {
    object.to_js().put(
        global_of(heap),
        name.as_bytes(),
        heap.create_utf8_string(text.as_bytes())?.to_js(),
    );
    Ok(())
}

fn brands<'a>(heap: &JsHeap<'a>, versions: [&str; 2]) -> Result<'a, JSValue> {
    let brands = heap.create_array(
        ["Not_A Brand", "Chromium"].into_iter().zip(versions),
        |heap, (brand, version)| {
            let object = heap.create_empty_object();
            put_text(heap, object, "brand", brand)?;
            put_text(heap, object, "version", version)?;
            Ok(object.as_value())
        },
    )?;
    Ok(heap.freeze_array(brands)?.to_js())
}

impl NavigatorUAData {
    fn version(&self) -> &str {
        &js_NavigatorUAData::scope(self)
            .expect("set when it is made")
            .browser()
            .version
    }

    pub(crate) fn get_brands<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        brands(
            self.realm(&cx.heap),
            [
                "24",
                &self.version()[..strings::index_of(self.version().as_bytes(), b".")
                    .unwrap_or_else(|| self.version().len())],
            ],
        )
    }

    fn low_entropy_values<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JsLocal<'a, JSObject>> {
        let values = cx.heap.create_empty_object();
        let brands = self.get_brands(cx)?;
        values.to_js().put(cx.global(), b"brands", brands);
        values.to_js().put(cx.global(), b"mobile", JSValue::FALSE);
        put_text(&cx.heap, values, "platform", SYSTEM)?;
        Ok(values)
    }

    pub(crate) fn to_json<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        Ok(self.low_entropy_values(cx)?.to_js())
    }

    pub(crate) fn get_high_entropy_values<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        hints: &[bun_core::Utf8Bytes<'_>],
    ) -> Result<'a, JSValue> {
        let values = self.low_entropy_values(cx)?;
        let wants = |name: &str| hints.iter().any(|it| **it == *name.as_bytes());
        let architecture = if cfg!(target_arch = "aarch64") {
            "arm"
        } else {
            "x86"
        };
        for (name, text) in [
            ("architecture", architecture),
            ("bitness", "64"),
            ("model", ""),
            ("uaFullVersion", self.version()),
        ] {
            if wants(name) {
                put_text(&cx.heap, values, name, text)?;
            }
        }
        if wants("formFactors") {
            let factors = cx.heap.create_array(["Desktop"], |heap, it| {
                Ok(heap.create_latin1_string(it.as_bytes()).as_value())
            })?;
            values
                .to_js()
                .put(cx.global(), b"formFactors", factors.to_js());
        }
        if wants("fullVersionList") {
            let list = brands(&cx.heap, ["24.0.0.0", self.version()])?;
            values.to_js().put(cx.global(), b"fullVersionList", list);
        }
        if wants("wow64") {
            values.to_js().put(cx.global(), b"wow64", JSValue::FALSE);
        }
        if !wants("platformVersion") {
            return Ok(cx.promise_resolve(values.to_js())?.to_js());
        }
        let promise = cx.heap.create_promise().to_js();
        let held =
            [self.to_js(), promise, values.to_js()].map(|it| Strong::create(it, cx.global()));
        js_NavigatorUAData::scope(self)
            .expect("set when it is made")
            .host()
            .system_version(move |global, version| {
                let held = held.each_ref().map(Strong::get);
                let finish = move |global: &JSGlobalObject, held: &[JSValue]| {
                    held[2].put(
                        global,
                        b"platformVersion",
                        bun_jsc::bun_string_jsc::create_utf8_for_js(global, version.as_bytes())?,
                    );
                    held[1].as_promise().map_or(Ok(()), |it| {
                        bun_jsc::JSPromise::opaque_mut(it).resolve(global, held[2])
                    })
                };
                // SAFETY: it is `self`.
                let realm = unsafe { NavigatorUAData::from_js_unchecked(held[0]) }
                    .realm(JsHeap::from_global(global));
                tasks::post(
                    global_of(realm),
                    Priority::Visible,
                    Work::Once(Box::new(finish)),
                    &held,
                );
            });
        Ok(promise)
    }
}
