use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use bun_jsc::bindgen::{self, Callable, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, Strong, bun_string_jsc};

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
unsafe extern "C" {
    fn Bun__Desktop__clipboardWriteText(ptr: *const u8, len: u32) -> bool;
    fn Bun__Desktop__clipboardReadText(out_buf: *mut u8, out_cap: u32) -> u32;
    fn Bun__Desktop__isDarkMode() -> bool;
    fn Bun__Desktop__getPrimaryDisplay(out_values: *mut f64) -> bool;
    fn Bun__Desktop__setMenu(ptr: *const u8, len: u32);
    fn Bun__Desktop__showDialog(
        g: *const JSGlobalObject,
        window_id: u32,
        req_id: u32,
        kind: u8,
        opts_ptr: *const u8,
        opts_len: u32,
    );
    fn Bun__Desktop__powerSaveStart(kind: u8) -> u32;
    fn Bun__Desktop__powerSaveStop(id: u32) -> bool;
    fn Bun__Desktop__powerSaveIsStarted(id: u32) -> bool;
    fn Bun__Desktop__imageSizeFromPath(ptr: *const u8, len: u32, out_wh: *mut f64) -> bool;
    fn Bun__Desktop__openExternal(ptr: *const u8, len: u32) -> bool;
    fn Bun__Desktop__showItemInFolder(ptr: *const u8, len: u32) -> bool;
    fn Bun__Desktop__trashItem(ptr: *const u8, len: u32) -> bool;
    fn Bun__Desktop__showNotification(
        title_ptr: *const u8,
        title_len: u32,
        body_ptr: *const u8,
        body_len: u32,
    ) -> bool;
    fn Bun__Desktop__warm(g: *const JSGlobalObject);
}

thread_local! {
    static NEXT_DIALOG_REQ_ID: Cell<u32> = const { Cell::new(1) };
    static PENDING_DIALOGS: RefCell<HashMap<u32, JSPromiseStrong>> = RefCell::new(HashMap::new());
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onDialogResult(
    global: *mut JSGlobalObject,
    req_id: u32,
    res_ptr: *const u8,
    res_len: u32,
) {
    let maybe = PENDING_DIALOGS.with(|m| m.borrow_mut().remove(&req_id));
    let Some(mut strong) = maybe else {
        return;
    };
    if global.is_null() {
        return;
    }
    let slice = if res_ptr.is_null() || res_len == 0 {
        &b"{}"[..]
    } else {
        unsafe { core::slice::from_raw_parts(res_ptr, res_len as usize) }
    };
    let global_ref = unsafe { &*global };
    let promise = JSPromise::opaque_mut(strong.swap());
    let val = bun_string_jsc::create_utf8_for_js(global_ref, slice).unwrap_or(JSValue::UNDEFINED);
    let _ = promise.resolve(global_ref, val);
}

struct AppState {
    ready: bool,
    name: String,
    version: String,
    listeners: Vec<(String, Strong)>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            ready: true,
            name: "Bun Desktop".to_string(),
            version: "0.1.0".to_string(),
            listeners: Vec::new(),
        }
    }
}

thread_local! {
    static APP_STATE: RefCell<AppState> = RefCell::new(AppState::default());
}

pub(crate) mod app {
    use super::*;

    pub(crate) fn is_ready() -> bool {
        APP_STATE.with(|s| s.borrow().ready)
    }

    pub(crate) fn warm<'a>(cx: &mut JsScope<'a>) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__warm(cx.global());
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = cx;
    }

    pub(crate) fn quit<'a>(_cx: &mut JsScope<'a>) {
        // Phase 2: notify host process and emit before-quit / will-quit.
        APP_STATE.with(|s| s.borrow_mut().listeners.clear());
    }

    pub(crate) fn exit(code: i32) {
        std::process::exit(code);
    }

    pub(crate) fn get_name() -> String {
        APP_STATE.with(|s| s.borrow().name.clone())
    }

    pub(crate) fn set_name(name: &[u8]) {
        APP_STATE.with(|s| {
            s.borrow_mut().name = String::from_utf8_lossy(name).into_owned();
        });
    }

    pub(crate) fn get_version() -> String {
        APP_STATE.with(|s| s.borrow().version.clone())
    }

    pub(crate) fn get_path<'a>(heap: &JsHeap<'a>, name: &[u8]) -> bindgen::Result<'a, String> {
        let key = std::str::from_utf8(name)
            .map_err(|_| heap.error(format_args!("Invalid app.getPath() key")))?;
        let path = match key {
            "temp" => std::env::temp_dir().to_string_lossy().into_owned(),
            "home" => std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default(),
            "appData" | "userData" => {
                #[cfg(target_os = "macos")]
                {
                    let home = std::env::var("HOME").unwrap_or_default();
                    let app_name = get_name();
                    if key == "appData" {
                        format!("{home}/Library/Application Support")
                    } else {
                        format!("{home}/Library/Application Support/{app_name}")
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let base = std::env::var("XDG_CONFIG_HOME")
                        .or_else(|_| std::env::var("APPDATA"))
                        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
                    if key == "appData" {
                        base
                    } else {
                        format!("{base}/{}", get_name())
                    }
                }
            }
            "exe" => std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" => {
                let home = std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .unwrap_or_default();
                let sub = match key {
                    "desktop" => "Desktop",
                    "documents" => "Documents",
                    "downloads" => "Downloads",
                    "music" => "Music",
                    "pictures" => "Pictures",
                    "videos" => "Movies",
                    _ => "",
                };
                if home.is_empty() {
                    sub.to_string()
                } else {
                    format!("{home}/{sub}")
                }
            }
            "logs" | "cache" => {
                let home = std::env::var("HOME")
                    .or_else(|_| std::env::var("USERPROFILE"))
                    .unwrap_or_default();
                let app_name = get_name();
                #[cfg(target_os = "macos")]
                {
                    if key == "logs" {
                        format!("{home}/Library/Logs/{app_name}")
                    } else {
                        format!("{home}/Library/Caches/{app_name}")
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let base = std::env::var("XDG_CACHE_HOME")
                        .unwrap_or_else(|_| format!("{home}/.cache"));
                    if key == "logs" {
                        format!("{base}/{app_name}/logs")
                    } else {
                        format!("{base}/{app_name}")
                    }
                }
            }
            _ => {
                return Err(heap.error(format_args!("Failed to get '{key}' path")));
            }
        };
        Ok(path)
    }

    pub(crate) fn on_event<'a>(
        cx: &mut JsScope<'a>,
        event: &[u8],
        callback: JsLocal<'a, Callable>,
    ) {
        let event_name = String::from_utf8_lossy(event).into_owned();
        let strong = Strong::create(callback.to_js(), cx.global());
        APP_STATE.with(|s| {
            s.borrow_mut().listeners.push((event_name, strong));
        });
    }

    pub(crate) fn clipboard_read_text() -> String {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let mut buf = vec![0u8; 64 * 1024];
            let n = unsafe { Bun__Desktop__clipboardReadText(buf.as_mut_ptr(), buf.len() as u32) };
            buf.truncate((n as usize).min(buf.len()));
            return String::from_utf8_lossy(&buf).into_owned();
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        String::new()
    }

    pub(crate) fn clipboard_write_text(text: &[u8]) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__clipboardWriteText(text.as_ptr(), text.len() as u32) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = text;
            false
        }
    }

    pub(crate) fn is_dark_mode() -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__isDarkMode() };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        false
    }

    pub(crate) fn get_primary_display() -> Vec<f64> {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let mut vals = [0.0f64; 9];
            if unsafe { Bun__Desktop__getPrimaryDisplay(vals.as_mut_ptr()) } {
                return vals.to_vec();
            }
        }
        vec![0.0, 0.0, 1440.0, 900.0, 0.0, 0.0, 1440.0, 875.0, 1.0]
    }

    pub(crate) fn set_menu(json: &[u8]) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__setMenu(json.as_ptr(), json.len() as u32);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = json;
    }

    pub(crate) fn show_dialog<'a>(
        cx: &mut JsScope<'a>,
        window_id: u32,
        kind: u8,
        opts_json: &[u8],
    ) -> JSValue {
        let global = cx.global();
        let req_id = NEXT_DIALOG_REQ_ID.with(|c| {
            let id = c.get();
            c.set(id.wrapping_add(1).max(1));
            id
        });
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let strong = JSPromiseStrong::init(global);
            let promise_val = strong.value();
            PENDING_DIALOGS.with(|m| {
                m.borrow_mut().insert(req_id, strong);
            });
            unsafe {
                Bun__Desktop__showDialog(
                    global as *const JSGlobalObject,
                    window_id,
                    req_id,
                    kind,
                    opts_json.as_ptr(),
                    opts_json.len() as u32,
                );
            }
            promise_val
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = (window_id, kind, opts_json, req_id);
            let val =
                bun_string_jsc::create_utf8_for_js(global, b"{}").unwrap_or(JSValue::UNDEFINED);
            JSPromise::resolved_promise_value(global, val)
        }
    }

    pub(crate) fn power_save_start(kind: u8) -> u32 {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__powerSaveStart(kind) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = kind;
            0
        }
    }

    pub(crate) fn power_save_stop(id: u32) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__powerSaveStop(id) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = id;
            false
        }
    }

    pub(crate) fn power_save_is_started(id: u32) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__powerSaveIsStarted(id) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = id;
            false
        }
    }

    pub(crate) fn image_size_from_path(path: &[u8]) -> Vec<f64> {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let mut wh = [0.0f64; 2];
            if unsafe {
                Bun__Desktop__imageSizeFromPath(path.as_ptr(), path.len() as u32, wh.as_mut_ptr())
            } {
                return wh.to_vec();
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = path;
        vec![0.0, 0.0]
    }

    pub(crate) fn open_external(url: &[u8]) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__openExternal(url.as_ptr(), url.len() as u32) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = url;
            false
        }
    }

    pub(crate) fn show_item_in_folder(path: &[u8]) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__showItemInFolder(path.as_ptr(), path.len() as u32) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = path;
            false
        }
    }

    pub(crate) fn trash_item(path: &[u8]) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe { Bun__Desktop__trashItem(path.as_ptr(), path.len() as u32) };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = path;
            false
        }
    }

    pub(crate) fn show_notification(title: &[u8], body: &[u8]) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            return unsafe {
                Bun__Desktop__showNotification(
                    title.as_ptr(),
                    title.len() as u32,
                    body.as_ptr(),
                    body.len() as u32,
                )
            };
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = (title, body);
            false
        }
    }
}
