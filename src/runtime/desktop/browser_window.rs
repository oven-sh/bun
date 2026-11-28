use std::cell::{Cell, RefCell};
use std::collections::HashMap;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
use std::sync::atomic::{AtomicU32, Ordering};

use bun_jsc::bindgen::{self, JsScope};
use bun_jsc::rare_data::HotMapEntry;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, bun_string_jsc};
use bun_ptr::{RefCount, RefCounted, RefPtr};

use crate::generated_bindgen::desktop_window::BrowserWindowOptions;

const DESKTOP_WINDOW_HOT_TAG: u8 = 42;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
unsafe extern "C" {
    fn Bun__Desktop__createWindow(
        g: *const JSGlobalObject,
        width: i32,
        height: i32,
        x: i32,
        y: i32,
        flags: u8,
        title_ptr: *const u8,
        title_len: u32,
        preload_ptr: *const u8,
        preload_len: u32,
    ) -> u32;
    fn Bun__Desktop__navigate(id: u32, url_ptr: *const u8, url_len: u32);
    fn Bun__Desktop__close(id: u32);
    fn Bun__Desktop__setTitle(id: u32, title_ptr: *const u8, title_len: u32);
    fn Bun__Desktop__showWindow(id: u32, visible: bool);
    fn Bun__Desktop__setSize(id: u32, width: u32, height: u32);
    fn Bun__Desktop__windowAction(id: u32, action: u8);
    fn Bun__Desktop__setWindowProgress(id: u32, progress: f64);
    fn Bun__Desktop__dispatchToRenderer(
        id: u32,
        ch_ptr: *const u8,
        ch_len: u32,
        args_ptr: *const u8,
        args_len: u32,
    );
    fn Bun__Desktop__evaluateJS(id: u32, req_id: u32, script_ptr: *const u8, script_len: u32);
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
static NEXT_WINDOW_ID: AtomicU32 = AtomicU32::new(1);

thread_local! {
    static PENDING_NAVS: RefCell<HashMap<u32, JSPromiseStrong>> = RefCell::new(HashMap::new());
    static NEXT_EVAL_REQ_ID: Cell<u32> = const { Cell::new(1) };
    static PENDING_EVALS: RefCell<HashMap<u32, JSPromiseStrong>> = RefCell::new(HashMap::new());
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onEvalResult(
    global: *mut JSGlobalObject,
    req_id: u32,
    ok: bool,
    res_ptr: *const u8,
    res_len: u32,
) {
    let maybe = PENDING_EVALS.with(|m| m.borrow_mut().remove(&req_id));
    let Some(mut strong) = maybe else {
        return;
    };
    if global.is_null() {
        return;
    }
    let global_ref = unsafe { &*global };
    let slice = if res_ptr.is_null() || res_len == 0 {
        if ok { &b"null"[..] } else { &b"Eval failed"[..] }
    } else {
        unsafe { core::slice::from_raw_parts(res_ptr, res_len as usize) }
    };
    let promise = JSPromise::opaque_mut(strong.swap());
    let val = bun_string_jsc::create_utf8_for_js(global_ref, slice).unwrap_or(JSValue::UNDEFINED);
    if ok {
        let _ = promise.resolve(global_ref, val);
    } else {
        let _ = promise.reject(global_ref, Ok(val));
    }
}

fn settle_pending_nav(global: *mut JSGlobalObject, window_id: u32, ok: bool, msg: &[u8]) {
    let maybe = PENDING_NAVS.with(|m| m.borrow_mut().remove(&window_id));
    let Some(mut strong) = maybe else {
        return;
    };
    if global.is_null() {
        return;
    }
    let global_ref = unsafe { &*global };
    let promise = JSPromise::opaque_mut(strong.swap());
    if ok {
        let _ = promise.resolve(global_ref, JSValue::UNDEFINED);
    } else {
        let err_val =
            bun_string_jsc::create_utf8_for_js(global_ref, msg).unwrap_or(JSValue::UNDEFINED);
        let _ = promise.reject(global_ref, Ok(err_val));
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onNavDone(
    global: *mut JSGlobalObject,
    window_id: u32,
    ok: bool,
    err_ptr: *const u8,
    err_len: u32,
) {
    let msg = if ok || err_ptr.is_null() || err_len == 0 {
        &b"Navigation failed"[..]
    } else {
        unsafe { core::slice::from_raw_parts(err_ptr, err_len as usize) }
    };
    settle_pending_nav(global, window_id, ok, msg);
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onWindowClosed(global: *mut JSGlobalObject, window_id: u32) {
    settle_pending_nav(global, window_id, false, b"Window closed");
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Desktop__onHostDied() {
    PENDING_NAVS.with(|m| m.borrow_mut().clear());
}

pub(crate) struct DesktopWindow {
    ref_count: RefCount<Self>,
    id: u32,
    title: RefCell<String>,
    width: Cell<i32>,
    height: Cell<i32>,
    visible: Cell<bool>,
    maximized: Cell<bool>,
    minimized: Cell<bool>,
    closed: Cell<bool>,
    hot_key: RefCell<Option<String>>,
    vm_ptr: Cell<*const VirtualMachine>,
}

impl RefCounted for DesktopWindow {
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        unsafe { &raw mut (*this).ref_count }
    }

    unsafe fn destructor(this: *mut Self) {
        unsafe {
            drop(Box::from_raw(this));
        }
    }
}

impl DesktopWindow {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        options: &BrowserWindowOptions,
    ) -> bindgen::Result<'a, RefPtr<Self>> {
        let title_str = String::from_utf8_lossy(options.title).into_owned();
        let vm_ptr = core::ptr::from_ref(cx.global().bun_vm());
        let hot_key_str = format!(
            "desktop:win:{}",
            options
                .id
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .unwrap_or_else(|| "default".to_string())
        );

        if let Some(hot) = unsafe { (*vm_ptr).hot_map() }
            && let Some(entry) = hot.get_entry(hot_key_str.as_bytes())
            && entry.tag == DESKTOP_WINDOW_HOT_TAG
        {
            let win_ptr = entry.ptr.cast::<Self>();
            let win = unsafe { &*win_ptr };
            if !win.closed.get() {
                win.set_title(options.title);
                win.set_size(options.width, options.height);
                return Ok(unsafe { RefPtr::init_ref(win_ptr) });
            }
            hot.remove(hot_key_str.as_bytes());
            unsafe { RefCount::<Self>::deref(win_ptr) };
        }

        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        let id = {
            let mut flags: u8 = 0;
            if options.show {
                flags |= 1 << 0;
            }
            if options.resizable {
                flags |= 1 << 1;
            }
            if options.frame {
                flags |= 1 << 2;
            }
            if options.transparent {
                flags |= 1 << 3;
            }
            let (x, y) = match (options.x, options.y) {
                (Some(px), Some(py)) => {
                    flags |= 1 << 4;
                    (px, py)
                }
                _ => (0, 0),
            };
            let preload_js = options
                .preload_code
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .or_else(|| {
                    options
                        .preload
                        .and_then(|p| std::fs::read_to_string(String::from_utf8_lossy(p).as_ref()).ok())
                })
                .unwrap_or_default();

            let win_id = unsafe {
                Bun__Desktop__createWindow(
                    cx.global(),
                    options.width,
                    options.height,
                    x,
                    y,
                    flags,
                    options.title.as_ptr(),
                    options.title.len() as u32,
                    preload_js.as_ptr(),
                    preload_js.len() as u32,
                )
            };
            if win_id == 0 {
                return Err(cx
                    .heap
                    .invalid_arguments(format_args!("Failed to spawn WebView host process")));
            }
            win_id
        };

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let id = {
            let _ = cx;
            NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
        };

        let ptr = RefPtr::new(Self {
            ref_count: RefCount::init(),
            id,
            title: RefCell::new(title_str),
            width: Cell::new(options.width),
            height: Cell::new(options.height),
            visible: Cell::new(options.show),
            maximized: Cell::new(false),
            minimized: Cell::new(false),
            closed: Cell::new(false),
            hot_key: RefCell::new(None),
            vm_ptr: Cell::new(vm_ptr),
        });
        if let Some(hot) = unsafe { (*vm_ptr).hot_map() } {
            let raw_ptr = ptr.as_ptr();
            *unsafe { &*raw_ptr }.hot_key.borrow_mut() = Some(hot_key_str.clone());
            unsafe { RefCount::<Self>::ref_(raw_ptr) };
            hot.insert_raw(
                hot_key_str.as_bytes(),
                HotMapEntry {
                    tag: DESKTOP_WINDOW_HOT_TAG,
                    ptr: raw_ptr.cast(),
                },
            );
        }
        Ok(ptr)
    }

    pub(crate) fn finalize(&self) {
        if !self.closed.get() {
            self.close();
        }
    }

    pub(crate) fn get_id(&self) -> u32 {
        self.id
    }

    pub(crate) fn load_url<'a>(
        &self,
        cx: &mut JsScope<'a>,
        url: &[u8],
    ) -> bindgen::Result<'a, JSValue> {
        if self.closed.get() {
            return Err(cx
                .heap
                .invalid_arguments(format_args!("BrowserWindow is closed")));
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let promise = JSPromiseStrong::init(cx.global());
            let promise_val = promise.value();
            if let Some(mut old) = PENDING_NAVS.with(|m| m.borrow_mut().insert(self.id, promise)) {
                let err = bun_string_jsc::create_utf8_for_js(cx.global(), b"Navigation superseded")
                    .unwrap_or(JSValue::UNDEFINED);
                let p = JSPromise::opaque_mut(old.swap());
                let _ = p.reject(cx.global(), Ok(err));
            }
            unsafe {
                Bun__Desktop__navigate(self.id, url.as_ptr(), url.len() as u32);
            }
            Ok(promise_val)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = url;
            Ok(JSPromise::resolved_promise_value(
                cx.global(),
                JSValue::UNDEFINED,
            ))
        }
    }

    pub(crate) fn load_file<'a>(
        &self,
        cx: &mut JsScope<'a>,
        path: &[u8],
    ) -> bindgen::Result<'a, JSValue> {
        let path_str = String::from_utf8_lossy(path);
        let abs = std::fs::canonicalize(path_str.as_ref())
            .or_else(|_| std::env::current_dir().map(|d| d.join(path_str.as_ref())))
            .map_err(|e| {
                cx.heap
                    .invalid_arguments(format_args!("Failed to resolve path: {e}"))
            })?;
        let url = format!("file://{}", abs.to_string_lossy());
        self.load_url(cx, url.as_bytes())
    }

    pub(crate) fn show(&self) {
        if self.closed.get() {
            return;
        }
        self.visible.set(true);
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__showWindow(self.id, true);
        }
    }

    pub(crate) fn hide(&self) {
        if self.closed.get() {
            return;
        }
        self.visible.set(false);
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__showWindow(self.id, false);
        }
    }

    pub(crate) fn close(&self) {
        if self.closed.replace(true) {
            return;
        }
        self.visible.set(false);
        if let Some(key) = self.hot_key.borrow_mut().take() {
            let vm_ptr = self.vm_ptr.get();
            if !vm_ptr.is_null()
                && let Some(hot) = unsafe { (*vm_ptr).hot_map() }
                && hot.get_entry(key.as_bytes()).is_some()
            {
                hot.remove(key.as_bytes());
                unsafe { RefCount::<Self>::deref(self as *const Self as *mut Self) };
            }
        }
        PENDING_NAVS.with(|m| {
            m.borrow_mut().remove(&self.id);
        });
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__close(self.id);
        }
    }

    pub(crate) fn set_title(&self, title: &[u8]) {
        *self.title.borrow_mut() = String::from_utf8_lossy(title).into_owned();
        if self.closed.get() {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__setTitle(self.id, title.as_ptr(), title.len() as u32);
        }
    }

    pub(crate) fn get_title(&self) -> String {
        self.title.borrow().clone()
    }

    pub(crate) fn set_size(&self, width: i32, height: i32) {
        self.width.set(width);
        self.height.set(height);
        if self.closed.get() {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__setSize(self.id, width.max(1) as u32, height.max(1) as u32);
        }
    }

    pub(crate) fn get_size(&self) -> Vec<i32> {
        vec![self.width.get(), self.height.get()]
    }

    fn send_window_action(&self, action: u8) {
        if self.closed.get() {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__windowAction(self.id, action);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = action;
    }

    pub(crate) fn maximize(&self) {
        self.maximized.set(true);
        self.send_window_action(1);
    }

    pub(crate) fn unmaximize(&self) {
        self.maximized.set(false);
        self.send_window_action(2);
    }

    pub(crate) fn is_maximized(&self) -> bool {
        self.maximized.get()
    }

    pub(crate) fn minimize(&self) {
        self.minimized.set(true);
        self.send_window_action(3);
    }

    pub(crate) fn is_minimized(&self) -> bool {
        self.minimized.get()
    }

    pub(crate) fn restore(&self) {
        self.minimized.set(false);
        self.send_window_action(6);
    }

    pub(crate) fn focus(&self) {
        self.visible.set(true);
        self.minimized.set(false);
        self.send_window_action(4);
    }

    pub(crate) fn center(&self) {
        self.send_window_action(5);
    }

    pub(crate) fn evaluate_java_script<'a>(
        &self,
        cx: &mut JsScope<'a>,
        code: &[u8],
    ) -> bindgen::Result<'a, JSValue> {
        if self.closed.get() {
            return Err(cx
                .heap
                .invalid_arguments(format_args!("BrowserWindow is closed")));
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        {
            let req_id = NEXT_EVAL_REQ_ID.with(|c| {
                let id = c.get();
                c.set(id.wrapping_add(1).max(1));
                id
            });
            let promise = JSPromiseStrong::init(cx.global());
            let promise_val = promise.value();
            PENDING_EVALS.with(|m| {
                m.borrow_mut().insert(req_id, promise);
            });
            unsafe {
                Bun__Desktop__evaluateJS(self.id, req_id, code.as_ptr(), code.len() as u32);
            }
            Ok(promise_val)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = code;
            Ok(JSPromise::resolved_promise_value(
                cx.global(),
                JSValue::UNDEFINED,
            ))
        }
    }

    pub(crate) fn set_progress_bar(&self, progress: f64) {
        if self.closed.get() {
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__setWindowProgress(self.id, progress);
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = progress;
    }

    pub(crate) fn send_to_renderer<'a>(
        &self,
        channel: &[u8],
        payload: &[u8],
    ) -> bindgen::Result<'a, ()> {
        if self.closed.get() {
            return Ok(());
        }
        #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
        unsafe {
            Bun__Desktop__dispatchToRenderer(
                self.id,
                channel.as_ptr(),
                channel.len() as u32,
                payload.as_ptr(),
                payload.len() as u32,
            );
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let _ = (channel, payload);
        Ok(())
    }
}
