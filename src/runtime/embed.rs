//! Host embedding: a process that links the runtime crates and runs the CLI
//! entry on a thread of its own ([`Cli::run_main`]) can exchange messages
//! with the script it runs — in-process, no sockets or pipes.
//!
//! [`Cli::run_main`]: crate::cli::Cli::run_main
//!
//! - Before `run_main`, the host calls [`set_host`] with a message handler.
//!   The main VM then exposes `globalThis.__bun_embed.postMessage(string)`;
//!   each call runs the handler with the string's UTF-8 bytes, on the JS
//!   thread, before returning to JS. Without a registered host the global is
//!   not installed and nothing else here has any effect.
//! - From any thread, [`post`] queues a closure to run on the main VM's JS
//!   thread with its global object, in posting order. [`call`] is the common
//!   case: call a function reached from `globalThis` by a dotted path (say
//!   `"__app.send"`) with string arguments. Closures posted before the VM
//!   exists are held and run, in order, once it is.
//! - While a host is registered the main VM's loop is kept alive after the
//!   entry script settles, so a host that serves requests through the two
//!   directions above needs no `setInterval` to stay up; the loop ends when
//!   the process does (or the script calls `process.exit`).
//!
//! The runtime side is [`install`], called once by `Run::start` on the main
//! VM right before it loads the entry point.

use std::sync::{Mutex, OnceLock};

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, LoopKind, ManagedTask, VmHandle};

/// A message from JS: the UTF-8 bytes of the string passed to
/// `globalThis.__bun_embed.postMessage`. Runs on the JS thread; must not
/// block on JS.
pub type MessageHandler = Box<dyn Fn(&[u8]) + Send + Sync + 'static>;

/// A closure that runs on the JS thread of the main VM. A JS exception it
/// leaves is reported as uncaught, like one thrown from a timer callback.
pub type JsTask = Box<dyn FnOnce(&JSGlobalObject) -> JsResult<()> + Send + 'static>;

/// [`set_host`] was already called in this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostAlreadySet;

impl core::fmt::Display for HostAlreadySet {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("the embedding host was already registered")
    }
}
impl std::error::Error for HostAlreadySet {}

/// [`post`] found no host: [`set_host`] was never called.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoHost;

impl core::fmt::Display for NoHost {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("no embedding host is registered (call embed::set_host before running Bun)")
    }
}
impl std::error::Error for NoHost {}

static HOST: OnceLock<MessageHandler> = OnceLock::new();

/// The main VM once [`install`] ran, plus the closures posted before that.
struct MainVm {
    handle: Option<VmHandle>,
    pending: Vec<JsTask>,
}

static MAIN: Mutex<MainVm> = Mutex::new(MainVm {
    handle: None,
    pending: Vec::new(),
});

/// Register the host's message handler. Call once, before
/// [`Cli::run_main`](crate::cli::Cli::run_main); it is what turns the
/// embedding surface on.
pub fn set_host(handler: MessageHandler) -> Result<(), HostAlreadySet> {
    HOST.set(handler).map_err(|_| HostAlreadySet)
}

/// Whether [`set_host`] was called.
pub fn has_host() -> bool {
    HOST.get().is_some()
}

/// Queue `task` to run on the main VM's JS thread. Any thread. Tasks run in
/// the order they were posted; those posted before the VM is up run once it
/// is. Errors only when no host is registered; a task posted after the VM
/// has shut down is dropped without running.
pub fn post(task: JsTask) -> Result<(), NoHost> {
    if !has_host() {
        return Err(NoHost);
    }
    let handle = {
        let mut main = MAIN.lock().unwrap_or_else(|e| e.into_inner());
        match &main.handle {
            Some(h) => h.clone(),
            None => {
                main.pending.push(task);
                return Ok(());
            }
        }
    };
    post_to(&handle, task);
    Ok(())
}

/// Queue a call to the function at `path` — property names from
/// `globalThis`, joined by `.` (`"__app.send"` is `globalThis.__app.send`) —
/// with `args` as JS strings, `this` = the object the function was read from.
/// Any thread; see [`post`]. A missing property or a non-callable target
/// throws a `TypeError` in JS (reported as uncaught) rather than failing here.
pub fn call(path: &str, args: &[&str]) -> Result<(), NoHost> {
    let path = path.to_owned();
    let args: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
    post(Box::new(move |global| call_path(global, &path, &args)))
}

/// Resolve `path` from `globalThis` and call it with `args` as strings.
/// JS thread.
pub fn call_path(global: &JSGlobalObject, path: &str, args: &[String]) -> JsResult<()> {
    let mut this = global.to_js_value();
    let mut target = this;
    for name in path.split('.') {
        this = target;
        target = match target.get(global, name)? {
            Some(v) if !v.is_undefined_or_null() => v,
            _ => {
                return Err(global.throw_type_error(format_args!(
                    "embed: globalThis.{path} is not defined (missing '{name}')"
                )));
            }
        };
    }
    if !target.is_callable() {
        return Err(global.throw_type_error(format_args!(
            "embed: globalThis.{path} is not a function"
        )));
    }
    let mut js_args = Vec::with_capacity(args.len());
    for a in args {
        js_args.push(bun_jsc::bun_string_jsc::create_utf8_for_js(global, a.as_bytes())?);
    }
    target.call(global, this, &js_args)?;
    Ok(())
}

fn post_to(handle: &VmHandle, task: JsTask) {
    let boxed: Box<JsTask> = Box::new(task);
    let raw = Box::into_raw(boxed);
    let managed = ManagedTask::ManagedTask::new_owned(raw, run_js_task);
    let item = bun_jsc::ConcurrentTask::create(managed);
    if let bun_jsc::Posted::Refused(item) = handle.post(LoopKind::Regular, item) {
        // The VM is gone: free the closure without running it.
        // SAFETY: refused ⇒ never queued; ours to release.
        unsafe { bun_jsc::ConcurrentTask::ConcurrentTask::release_refused(item) };
    }
}

/// `ManagedTask` body: take the closure out of its box and run it.
fn run_js_task(raw: *mut JsTask) -> JsResult<()> {
    // SAFETY: `raw` is the `Box::into_raw` from `post_to`; `new_owned` gives
    // the pointer back exactly once and never frees it before this runs.
    let task: JsTask = *unsafe { Box::from_raw(raw) };
    let global = bun_jsc::virtual_machine::VirtualMachine::get().global();
    task(global)
}

/// Runtime side: on the main VM's JS thread, before the entry point loads.
/// With a host registered, installs `globalThis.__bun_embed`, remembers the
/// VM for [`post`], flushes closures posted so far and keeps the loop alive.
/// No-op otherwise.
pub(crate) fn install(vm: &bun_jsc::virtual_machine::VirtualMachine) {
    let global = vm.global();
    // The VM is reachable from other threads from here on, host or not:
    // `post_task` / [`Poster`] work for any embedder.
    let handle = vm.handle();
    let pending = {
        let mut main = MAIN.lock().unwrap_or_else(|e| e.into_inner());
        main.handle = Some(handle.clone());
        core::mem::take(&mut main.pending)
    };
    for task in pending {
        post_to(&handle, task);
    }
    fire_ready(global);
    if !has_host() {
        return;
    }
    let api = bun_jsc::host_object::create_host_function_object(
        global,
        &[("postMessage", __jsc_host_post_message, 1)],
    );
    global.to_js_value().put(global, b"__bun_embed", api);
    vm.event_loop_mut().ref_keep_alive();
}

#[bun_jsc::host_fn]
fn post_message(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [message] = frame.arguments_as_array::<1>();
    if !message.is_string() {
        return Err(global.throw_type_error(format_args!(
            "__bun_embed.postMessage: expected a string"
        )));
    }
    let bytes = message.to_slice(global)?;
    if let Some(host) = HOST.get() {
        host(bytes.slice());
    }
    Ok(JSValue::UNDEFINED)
}

// ─── generic host helpers ────────────────────────────────────────────────
//
// The message surface above is one fixed shape (a string each way). The
// helpers below are the generic building blocks a host uses to define its own
// surface: a callback that runs on the JS thread once the VM is up, JS
// functions backed by Rust closures, module import, function calls, and a
// cross-thread poster.

/// A callback the host runs on the JS thread once the runtime is up.
pub type ReadyHook = Box<dyn FnOnce(&JSGlobalObject) + Send + 'static>;

static READY_HOOK: Mutex<Option<ReadyHook>> = Mutex::new(None);

/// Register `hook` to run on the main VM's JS thread after its global object
/// exists and before the entry module is loaded. Any thread; call before
/// [`Cli::run_main`](crate::cli::Cli::run_main). A later call replaces an
/// unfired hook.
///
/// The hook typically installs globals: a host function the entry module
/// calls (see [`make_host_function`], [`set_global`]) and takes a [`Poster`]
/// with [`poster`] for the host's other threads.
pub fn on_ready(hook: impl FnOnce(&JSGlobalObject) + Send + 'static) {
    *READY_HOOK.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(hook));
}

/// JS thread: fire the hook registered with [`on_ready`], if any (once).
fn fire_ready(global: &JSGlobalObject) {
    let hook = READY_HOOK.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(hook) = hook {
        hook(global);
    }
}

// ─── strings ─────────────────────────────────────────────────────────────

/// A JS string from a Rust `&str`. JS thread.
pub fn js_string(global: &JSGlobalObject, s: &str) -> JsResult<JSValue> {
    bun_jsc::bun_string_jsc::create_utf8_for_js(global, s.as_bytes())
}

/// `String(value)` as a Rust `String` (`toString()` semantics: objects are
/// stringified, symbols throw). JS thread.
pub fn to_rust_string(global: &JSGlobalObject, value: JSValue) -> JsResult<String> {
    let bytes = value.to_slice(global)?.into_vec();
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// ─── globals ─────────────────────────────────────────────────────────────

/// Install `value` as `globalThis[name]`. JS thread.
pub fn set_global(global: &JSGlobalObject, name: &str, value: JSValue) {
    global.to_js_value().put(global, name.as_bytes(), value);
}

/// Read `globalThis[name]` (`None` when absent). JS thread.
pub fn get_global(global: &JSGlobalObject, name: &str) -> JsResult<Option<JSValue>> {
    global.to_js_value().get(global, name.as_bytes())
}

// ─── host functions ──────────────────────────────────────────────────────

/// The Rust side of a JS function made by [`make_host_function`]: receives
/// the global object and the call's arguments; `Err` means a JS exception is
/// pending on the global (throw one with `global.throw(...)`).
pub type HostFn = dyn Fn(&JSGlobalObject, &[JSValue]) -> JsResult<JSValue> + 'static;

struct HostFnData {
    f: Box<HostFn>,
}

#[bun_jsc::host_fn]
fn host_function_trampoline(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let Some(data) = bun_jsc::host_fn::get_function_data(frame.callee()) else {
        return Err(global.throw(format_args!("embed: host function has no callback")));
    };
    // SAFETY: `data` was set by `make_host_function` to a leaked
    // `Box<HostFnData>` that is never freed (see there), so it is live for
    // the process; the closure runs on the JS thread only.
    let data = unsafe { &*data.cast::<HostFnData>() };
    (data.f)(global, frame.arguments())
}

/// A JS function whose body is the Rust closure `f`. JS thread.
///
/// `name` is the function's `name` property and `arg_count` its `length`.
/// The closure runs on the JS thread with the arguments the JS caller passed
/// and lives for the rest of the process (functions a host installs are
/// process-lifetime; there is no finalizer).
pub fn make_host_function(
    global: &JSGlobalObject,
    name: &str,
    arg_count: u32,
    f: impl Fn(&JSGlobalObject, &[JSValue]) -> JsResult<JSValue> + 'static,
) -> JSValue {
    let data: *mut HostFnData = Box::into_raw(Box::new(HostFnData { f: Box::new(f) }));
    let name = bun_core::ZigString::init(name.as_bytes());
    let function = bun_jsc::host_fn::new_function_with_data(
        global,
        Some(&name),
        arg_count,
        __jsc_host_host_function_trampoline,
        data.cast(),
    );
    function.ensure_still_alive();
    function
}

// ─── modules ─────────────────────────────────────────────────────────────

/// Import the module at `path` (an absolute path, or any specifier Bun's
/// resolver accepts from the current working directory) and return its
/// namespace object. Runs the event loop until the module — and any
/// top-level `await` in it — has settled. JS thread.
///
/// `Err` when the module rejected: its error is the pending exception on
/// `global` (take it with `global.take_exception(err)`).
pub fn eval_module(global: &JSGlobalObject, path: &str) -> JsResult<JSValue> {
    use bun_jsc::js_promise::Status;

    let specifier = bun_core::String::from_bytes(path.as_bytes());
    let promise = bun_jsc::JSModuleLoader::import_ptr(
        core::ptr::from_ref(global).cast_mut(),
        &specifier,
    )?;
    let _protected = JSValue::from_cell(promise.as_ptr()).protected();

    let vm = VirtualMachine::get();
    // SAFETY: `promise` is a live JSC heap cell, protected above.
    let promise_ref = unsafe { &mut *promise.as_ptr() };
    if promise_ref.status() == Status::Pending {
        let _ = vm
            .as_mut()
            .wait_for_promise(bun_jsc::AnyPromise::Internal(promise.as_ptr()));
    }
    match promise_ref.status() {
        Status::Fulfilled => Ok(promise_ref.result(vm.jsc_vm())),
        Status::Rejected => {
            let reason = promise_ref.result(vm.jsc_vm());
            promise_ref.set_handled();
            Err(global.throw_value(reason))
        }
        // The VM was stopped while the module loaded.
        Status::Pending => Err(global.throw(format_args!(
            "embed: module {path} did not finish loading before the runtime stopped"
        ))),
    }
}

// ─── calls ───────────────────────────────────────────────────────────────

/// Call `function` with `this` and `args`; the result, or `Err` with the
/// thrown exception pending on `global`. JS thread. (For a call posted from
/// another thread by dotted path, see [`call`].)
pub fn call_function(
    global: &JSGlobalObject,
    function: JSValue,
    this: JSValue,
    args: &[JSValue],
) -> JsResult<JSValue> {
    if !function.is_callable() {
        return Err(global.throw_type_error(format_args!(
            "embed: value is not a function"
        )));
    }
    function.call(global, this, args)
}

// ─── cross-thread posting ────────────────────────────────────────────────

/// Queue `f` to run on the main VM's JS thread. Any thread. Closures run in
/// posting order; those posted before the VM is up run once it is; one posted
/// after the VM has shut down is dropped without running. Unlike [`post`],
/// this needs no registered host.
pub fn post_task(f: impl FnOnce(&JSGlobalObject) + Send + 'static) {
    let task: JsTask = Box::new(move |global| {
        f(global);
        Ok(())
    });
    let handle = {
        let mut main = MAIN.lock().unwrap_or_else(|e| e.into_inner());
        match &main.handle {
            Some(h) => h.clone(),
            None => {
                main.pending.push(task);
                return;
            }
        }
    };
    post_to(&handle, task);
}

/// A `Send + Sync` handle to one VM's event loop for other threads: posts
/// Rust closures onto its JS thread and adjusts its keep-alive. Take one on
/// that JS thread with [`poster`]; clone freely.
#[derive(Clone)]
pub struct Poster {
    handle: VmHandle,
}

/// The [`Poster`] for `global`'s VM. JS thread.
pub fn poster(global: &JSGlobalObject) -> Poster {
    Poster {
        handle: global.bun_vm().handle(),
    }
}

impl Poster {
    /// Queue `f` to run on the VM's JS thread and wake its loop. Any thread.
    /// Returns `false` (and drops `f`) if the VM has already shut down.
    /// Closures posted from one thread run in posting order.
    pub fn post_task(&self, f: impl FnOnce(&JSGlobalObject) + Send + 'static) -> bool {
        let task: JsTask = Box::new(move |global| {
            f(global);
            Ok(())
        });
        let boxed: Box<JsTask> = Box::new(task);
        let raw = Box::into_raw(boxed);
        let managed = ManagedTask::ManagedTask::new_owned(raw, run_js_task);
        let item = bun_jsc::ConcurrentTask::create(managed);
        match self.handle.post(LoopKind::Regular, item) {
            bun_jsc::Posted::Queued => true,
            bun_jsc::Posted::Refused(item) => {
                // SAFETY: refused ⇒ never queued; ours to release (drops the
                // closure through `new_owned`'s cleanup).
                unsafe { bun_jsc::ConcurrentTask::ConcurrentTask::release_refused(item) };
                false
            }
        }
    }

    /// Count one more thing keeping the loop alive, so it keeps polling (and
    /// servicing posts) with no JS work pending. Any thread; no-op once the
    /// VM has closed.
    pub fn ref_keep_alive(&self) {
        self.handle.add_keep_alive(LoopKind::Regular, 1);
    }

    /// Balance a [`Self::ref_keep_alive`]. Any thread.
    pub fn unref_keep_alive(&self) {
        self.handle.add_keep_alive(LoopKind::Regular, -1);
    }

    /// Wake the loop without queueing anything. Any thread.
    pub fn wake(&self) {
        self.handle.wake();
    }

    /// Whether the VM still runs script (neither stopping nor closed).
    pub fn is_open(&self) -> bool {
        self.handle.script_allowed()
    }
}
