use std::cell::RefCell;
use std::collections::HashMap;

use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSUint8Array, JSValue, Strong, bun_string_jsc};

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
unsafe extern "C" {
    fn Bun__Desktop__sendIpcReply(
        id: u32,
        req_id: u32,
        ok: bool,
        json_ptr: *const u8,
        json_len: u32,
    );
    fn Bun__Desktop__sendIpcBinaryReply(
        id: u32,
        req_id: u32,
        status: u16,
        data_ptr: *const u8,
        data_len: u32,
    );
}

#[derive(Default)]
struct IpcRegistry {
    handlers: HashMap<String, Strong>,
    listeners: HashMap<String, Vec<Strong>>,
    dispatcher: Option<Strong>,
    binary_dispatcher: Option<Strong>,
}

thread_local! {
    static IPC_REGISTRY: RefCell<IpcRegistry> = RefCell::new(IpcRegistry::default());
}

#[allow(dead_code)]
pub(crate) fn reset_on_hot_reload() {
    IPC_REGISTRY.with(|r| {
        let mut reg = r.borrow_mut();
        reg.handlers.clear();
        reg.listeners.clear();
    });
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onIpcMessage(
    global: *mut JSGlobalObject,
    window_id: u32,
    req_id: u32,
    is_invoke: bool,
    ch_ptr: *const u8,
    ch_len: u32,
    args_ptr: *const u8,
    args_len: u32,
) {
    if global.is_null() {
        return;
    }
    let dispatcher = IPC_REGISTRY.with(|r| r.borrow().dispatcher.as_ref().map(|s| s.get()));
    let Some(func) = dispatcher else {
        return;
    };
    let global_ref = unsafe { &*global };
    let ch_bytes = if ch_ptr.is_null() || ch_len == 0 {
        &[][..]
    } else {
        unsafe { core::slice::from_raw_parts(ch_ptr, ch_len as usize) }
    };
    let args_bytes = if args_ptr.is_null() || args_len == 0 {
        &b"[]"[..]
    } else {
        unsafe { core::slice::from_raw_parts(args_ptr, args_len as usize) }
    };
    let Ok(ch_js) = bun_string_jsc::create_utf8_for_js(global_ref, ch_bytes) else {
        return;
    };
    let Ok(args_js) = bun_string_jsc::create_utf8_for_js(global_ref, args_bytes) else {
        return;
    };
    let call_args = [
        JSValue::js_number(window_id as f64),
        JSValue::js_number(req_id as f64),
        JSValue::js_boolean(is_invoke),
        ch_js,
        args_js,
    ];
    let _ = func.call(global_ref, JSValue::UNDEFINED, &call_args);
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onIpcBinaryMessage(
    global: *mut JSGlobalObject,
    window_id: u32,
    req_id: u32,
    ch_ptr: *const u8,
    ch_len: u32,
    data_ptr: *const u8,
    data_len: u32,
) {
    if global.is_null() {
        return;
    }
    let dispatcher = IPC_REGISTRY.with(|r| r.borrow().binary_dispatcher.as_ref().map(|s| s.get()));
    let Some(func) = dispatcher else {
        return;
    };
    let global_ref = unsafe { &*global };
    let ch_bytes = if ch_ptr.is_null() || ch_len == 0 {
        &[][..]
    } else {
        unsafe { core::slice::from_raw_parts(ch_ptr, ch_len as usize) }
    };
    let data_bytes = if data_ptr.is_null() || data_len == 0 {
        &[][..]
    } else {
        unsafe { core::slice::from_raw_parts(data_ptr, data_len as usize) }
    };
    let Ok(ch_js) = bun_string_jsc::create_utf8_for_js(global_ref, ch_bytes) else {
        return;
    };
    let Ok(data_js) = (if data_bytes.is_empty() {
        JSUint8Array::create_empty(global_ref)
    } else {
        JSUint8Array::from_bytes_copy(global_ref, data_bytes)
    }) else {
        return;
    };
    let call_args = [
        JSValue::js_number(window_id as f64),
        JSValue::js_number(req_id as f64),
        ch_js,
        data_js,
    ];
    let _ = func.call(global_ref, JSValue::UNDEFINED, &call_args);
}

pub(crate) mod ipc_main {
    use super::*;

    pub(crate) fn handle<'a>(
        cx: &mut JsScope<'a>,
        channel: &[u8],
        listener: JsLocal<'a, Callable>,
    ) {
        let key = String::from_utf8_lossy(channel).into_owned();
        let strong = Strong::create(listener.to_js(), cx.global());
        IPC_REGISTRY.with(|r| {
            r.borrow_mut().handlers.insert(key, strong);
        });
    }

    pub(crate) fn remove_handler(channel: &[u8]) {
        let key = String::from_utf8_lossy(channel);
        IPC_REGISTRY.with(|r| {
            r.borrow_mut().handlers.remove(key.as_ref());
        });
    }

    pub(crate) fn on<'a>(cx: &mut JsScope<'a>, channel: &[u8], listener: JsLocal<'a, Callable>) {
        let key = String::from_utf8_lossy(channel).into_owned();
        let strong = Strong::create(listener.to_js(), cx.global());
        IPC_REGISTRY.with(|r| {
            r.borrow_mut()
                .listeners
                .entry(key)
                .or_default()
                .push(strong);
        });
    }

    pub(crate) fn remove_all_listeners(channel: Option<&[u8]>) {
        IPC_REGISTRY.with(|r| {
            let mut reg = r.borrow_mut();
            match channel {
                Some(ch) => {
                    let key = String::from_utf8_lossy(ch);
                    reg.listeners.remove(key.as_ref());
                }
                None => reg.listeners.clear(),
            }
        });
    }

    pub(crate) fn set_dispatcher<'a>(cx: &mut JsScope<'a>, func: JsLocal<'a, Callable>) {
        let strong = Strong::create(func.to_js(), cx.global());
        IPC_REGISTRY.with(|r| {
            r.borrow_mut().dispatcher = Some(strong);
        });
    }

    pub(crate) fn send_ipc_reply(window_id: u32, req_id: u32, ok: bool, json: &[u8]) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__sendIpcReply(window_id, req_id, ok, json.as_ptr(), json.len() as u32);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = (window_id, req_id, ok, json);
    }

    pub(crate) fn set_binary_dispatcher<'a>(cx: &mut JsScope<'a>, func: JsLocal<'a, Callable>) {
        let strong = Strong::create(func.to_js(), cx.global());
        IPC_REGISTRY.with(|r| {
            r.borrow_mut().binary_dispatcher = Some(strong);
        });
    }

    pub(crate) fn send_ipc_binary_reply(window_id: u32, req_id: u32, status: u16, data: &[u8]) {
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__sendIpcBinaryReply(
                window_id,
                req_id,
                status,
                data.as_ptr(),
                data.len() as u32,
            );
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = (window_id, req_id, status, data);
    }
}
