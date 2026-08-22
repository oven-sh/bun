//! `with { type: "macro" }`: running a JS function at transpile time and
//! splicing its result into the AST.
//!
//! Every macro in the process is evaluated on one dedicated thread, the
//! [`MacroHost`], which owns a `VirtualMachine` of its own and drives that
//! VM's event loop like a worker does. A transpiling thread — the JS thread in
//! the middle of a `require()`, a bundler pool worker, a `RuntimeTranspilerStore`
//! job — resolves the macro specifier with its own resolver, posts a
//! [`MacroRequest`] to the host and parks until it is answered. On the host the
//! request is an ordinary task: it imports the macro module, calls the export,
//! and if the result is a promise attaches reactions to it, so an `async` macro
//! (or a macro module with top-level await) simply runs on the host's loop while
//! its caller waits. Nothing on either side ever turns an event loop it does not
//! own.
//!
//! JS values cannot cross VMs and AST nodes are allocated in thread-local
//! stores, so the answer travels back as an owned [`MacroValue`] tree and the
//! *caller* builds the `Expr` from it, in its own arena.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::OnceLock;

use bun_alloc::Arena;
use bun_ast::{E, Expr, ExprData, ExprNodeList, G, Loc, Log, Range, Source};
use bun_bundler::Transpiler;
use bun_collections::{HashMap, VecExt};
use bun_core::Output;
use bun_core::strings;
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_js_parser as js_parser;
use bun_jsc::js_property_iterator::JSPropertyIteratorOptions;
use bun_jsc::virtual_machine::{InitOptions, VirtualMachine, runtime_hooks};
use bun_jsc::{
    self as jsc, CallFrame, ConsoleObject, JSArrayIterator, JSGlobalObject, JSPropertyIterator,
    JSValue, JsResult, ModuleLoader, PromiseStatus, Strong, VmHandle, WebCore,
};
use bun_jsc::{BuildMessage, ResolveMessage};
use bun_resolver::package_json::{
    MacroImportReplacementMap as MacroRemapEntry, MacroMap as MacroRemap,
};
use bun_threading::ResetEvent;

use crate::expr_jsc::ExprJsc;

unsafe extern "C" {
    safe fn JSC__VM__getAPILock(vm: &jsc::VM);
}

const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

fn is_macro_path(str: &[u8]) -> bool {
    strings::has_prefix(str, NAMESPACE_WITH_COLON)
}

// ══════════════════════════════════════════════════════════════════════════
// Caller side: MacroContext
// ══════════════════════════════════════════════════════════════════════════

/// Per-`Transpiler` state the parser reaches through
/// `bun_js_parser::Macro::MacroContext`. A raw pointer because the parser
/// that calls us is itself running inside that `Transpiler`; a `&'a mut` here
/// would forbid that aliasing.
pub(crate) struct MacroContext {
    pub(crate) transpiler: *mut Transpiler<'static>,
    /// `Bun.Transpiler#transformSync(code, ctx)`'s context object, a value in
    /// the *calling* VM. It reaches the macro as a structured clone.
    pub(crate) javascript_object: JSValue,
    /// Backs the lifetime-erased slices (property keys, string data, blob
    /// JSON) of every `Expr` a macro produced for this transpiler; the parser
    /// splices those into the AST and prints them before the `Transpiler`
    /// drops. Lazy so a `Transpiler` that never runs a macro never creates a
    /// heap (`Arena::new()` is `mi_heap_new()`).
    pub(crate) bump: Option<Arena>,
}

impl MacroContext {
    pub(crate) fn init(transpiler: &mut Transpiler<'static>) -> MacroContext {
        MacroContext {
            transpiler,
            javascript_object: JSValue::ZERO,
            bump: None,
        }
    }

    pub(crate) fn get_remap(&self, path: &[u8]) -> Option<&MacroRemapEntry> {
        // SAFETY: the `Transpiler` outlives its `MacroContext`.
        let remap = unsafe { &(*self.transpiler).options.macro_remap };
        if remap.is_empty() {
            return None;
        }
        remap.get(path)
    }

    /// Runs on the transpiling thread with the parser on the stack.
    pub(crate) fn call(
        &mut self,
        import_record_path: &[u8],
        source_dir: &[u8],
        log: &mut Log,
        source: &Source,
        import_range: Range,
        caller: Expr,
        function_name: &[u8],
    ) -> crate::Result<Expr> {
        let import_record_path_without_macro_prefix = if is_macro_path(import_record_path) {
            &import_record_path[NAMESPACE_WITH_COLON.len()..]
        } else {
            import_record_path
        };
        debug_assert!(!is_macro_path(import_record_path_without_macro_prefix));

        if VirtualMachine::is_loaded() && VirtualMachine::get().is_macro_vm {
            log.add_error_fmt(
                Some(source),
                caller.loc,
                format_args!("Macros cannot be invoked from inside a macro"),
            );
            return Err(crate::Error::MacroFailed);
        }

        let ExprData::ECall(call) = &caller.data else {
            if matches!(caller.data, ExprData::ETemplate(_)) {
                log.add_error_fmt(
                    Some(source),
                    caller.loc,
                    format_args!("template literal macro invocations are not supported"),
                );
                return Err(crate::Error::MacroFailed);
            }
            unreachable!("macro call site is neither a call nor a tagged template");
        };

        // SAFETY: the `Transpiler` outlives `self` (see struct comment); its
        // resolver is not otherwise in use while the parser visits.
        let resolver = unsafe { &mut (*self.transpiler).resolver };
        let specifier: &[u8] = 'brk: {
            if let Some(replacement) = ModuleLoader::HardcodedModule::Alias::get(
                import_record_path,
                bun_ast::Target::Bun,
                Default::default(),
            ) {
                break 'brk replacement.path.as_bytes();
            }
            match resolver.resolve(
                source_dir,
                import_record_path_without_macro_prefix,
                bun_ast::ImportKind::Stmt,
            ) {
                // The resolver's `Result` owns its path strings via the global
                // `DirnameStore`, so the text outlives `resolve_result`.
                Ok(r) => break 'brk r.path_pair.primary.text,
                Err(bun_resolver::Error::ModuleNotFound) => {
                    log.add_resolve_error(
                        Some(source),
                        import_range,
                        format_args!(
                            "Macro \"{}\" not found",
                            bstr::BStr::new(import_record_path)
                        ),
                        import_record_path,
                        bun_ast::ImportKind::Stmt,
                        bun_ast::Error::ModuleNotFound,
                    );
                    return Err(crate::Error::MacroNotFound);
                }
                Err(e) => {
                    log.add_range_error_fmt(
                        Some(source),
                        import_range,
                        format_args!(
                            "{} resolving macro \"{}\"",
                            e.name(),
                            bstr::BStr::new(import_record_path)
                        ),
                    );
                    return Err(e.into());
                }
            }
        };

        let context = if self.javascript_object == JSValue::ZERO {
            None
        } else {
            // Only `transformSync(code, ctx)` on a JS thread sets this.
            let global = VirtualMachine::get().global();
            match self
                .javascript_object
                .serialize(global, jsc::SerializedFlags::default())
            {
                Ok(bytes) => Some(bytes),
                Err(err) => {
                    let reason = global.take_error(err);
                    let mut holder = jsc::zig_exception::Holder::init();
                    let exception = holder.zig_exception();
                    if let Some(error) = reason.to_error() {
                        error.to_zig_exception(global, exception);
                    }
                    let reason = exception.message.to_owned_slice();
                    log.add_error_fmt(
                        Some(source),
                        caller.loc,
                        format_args!(
                            "the macro context object passed to transformSync() could not be cloned: {}",
                            bstr::BStr::new(&reason)
                        ),
                    );
                    return Err(crate::Error::MacroFailed);
                }
            }
        };

        if bun_core::env::IS_DEBUG {
            bun_core::prettyln!(
                "<r><d>[macro]<r> call <d><b>{}<r>",
                bstr::BStr::new(function_name)
            );
            Output::flush();
        }
        bun_analytics::features::macros.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        // SAFETY: the `Transpiler` outlives `self`; read once to seed the host.
        let host = MacroHost::get_or_start(|| unsafe { MacroHostSeed::new(&*self.transpiler) });

        let mut request = MacroRequest {
            specifier,
            function_name,
            args: call.args.slice(),
            context,
            outcome: MacroOutcome::Failed(MacroFailure::text(
                "the macro host shut down before running this macro",
            )),
            done: ResetEvent::default(),
            task: ConcurrentTask::default(),
        };
        host.run(&mut request);

        match core::mem::replace(
            &mut request.outcome,
            MacroOutcome::Value(MacroValue::Undefined),
        ) {
            MacroOutcome::Value(value) => {
                let bump = self.bump.get_or_insert_with(Arena::new);
                materialize(&value, bump, log, caller.loc)
            }
            MacroOutcome::Failed(failure) => {
                log.add_error_fmt(
                    Some(source),
                    caller.loc,
                    format_args!("{}", bstr::BStr::new(&failure.message)),
                );
                Err(crate::Error::MacroFailed)
            }
        }
    }
}

// ── Lower-tier bridge (`bun_js_parser::Macro::MacroContext` ⇆ this crate) ──
//
// `bun_js_parser` / `bun_bundler` cannot name `Resolver` / JSC types, so the
// parser-visible `MacroContext` carries an opaque `data` pointer to a boxed
// instance of this crate's `MacroContext` and dispatches through `extern
// "Rust"` fns resolved at link time.

#[unsafe(no_mangle)]
fn __bun_macro_context_init(transpiler: *mut c_void) -> js_parser::Macro::MacroContext {
    // SAFETY: every caller of `js_parser::Macro::MacroContext::init<T>` passes a
    // `&mut bun_bundler::Transpiler<'_>`; the lifetime parameter is erased at
    // runtime so reading it as `'static` is layout-identical. `bump` is `None`
    // on init, so this never calls `mi_heap_new()`.
    let transpiler = unsafe { &mut *transpiler.cast::<Transpiler<'static>>() };
    let data = bun_core::heap::into_raw(Box::new(MacroContext::init(transpiler)));
    js_parser::Macro::MacroContext {
        javascript_object: js_parser::Macro::MacroJSCtx::ZERO,
        data: data.cast::<c_void>(),
    }
}

#[unsafe(no_mangle)]
fn __bun_macro_context_deinit(data: *mut c_void) {
    if data.is_null() {
        return;
    }
    // SAFETY: `data` is exactly the `Box<MacroContext>` allocated in
    // `__bun_macro_context_init`; sole owner. Dropping it runs
    // `MimallocArena::drop` on the lazily-created `bump`, if any.
    drop(unsafe { Box::<MacroContext>::from_raw(data.cast::<MacroContext>()) });
}

#[unsafe(no_mangle)]
fn __bun_macro_context_call(
    ctx: &mut js_parser::Macro::MacroContext,
    import_record_path: &[u8],
    source_dir: &[u8],
    log: &mut Log,
    source: &Source,
    import_range: Range,
    caller: Expr,
    function_name: &[u8],
) -> Result<Expr, bun_js_parser::Error> {
    debug_assert!(
        !ctx.data.is_null(),
        "MacroContext.call reached without init"
    );
    // SAFETY: `data` is the `Box<MacroContext>` allocated in `init` above; the
    // lower-tier handle is uniquely borrowed for this call so no alias exists.
    let inner = unsafe { &mut *ctx.data.cast::<MacroContext>() };
    inner.javascript_object = JSValue::from_encoded(ctx.javascript_object.0 as usize);
    inner
        .call(
            import_record_path,
            source_dir,
            log,
            source,
            import_range,
            caller,
            function_name,
        )
        .map_err(|_| bun_js_parser::Error::MacroFailed)
}

#[unsafe(no_mangle)]
fn __bun_macro_context_get_remap(
    data: *mut c_void,
    path: &[u8],
) -> Option<&'static js_parser::Macro::MacroRemapEntry> {
    // SAFETY: `data` is the `Box<MacroContext>` allocated in `init` above; the
    // remap table lives in `Transpiler.options` which outlives every parse, so
    // the `'static` borrow is sound for callers that drop it before the
    // `Transpiler` does.
    let inner = unsafe { &*data.cast::<MacroContext>() };
    inner.get_remap(path).map(|e| {
        // SAFETY: as above.
        unsafe { &*std::ptr::from_ref::<js_parser::Macro::MacroRemapEntry>(e) }
    })
}

// ══════════════════════════════════════════════════════════════════════════
// The request and its answer
// ══════════════════════════════════════════════════════════════════════════

/// What a macro returned, in a form that belongs to no VM and no thread's AST
/// store. Mirrors exactly the set of JS values a macro may return.
pub enum MacroValue {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    /// Decimal digits, no sign.
    BigInt {
        negative: bool,
        digits: Box<[u8]>,
    },
    /// Always UTF-16 so the printer escapes it the same way regardless of the
    /// JS string's internal representation.
    String(Box<[u16]>),
    /// A `Blob` (or a `Response`/`Request` body): becomes JSON, a string, or a
    /// base64 `data:` URL depending on its type.
    Blob {
        bytes: Box<[u8]>,
        content_type: Box<[u8]>,
    },
    Array(Vec<MacroValue>),
    Object(Vec<(Box<[u8]>, MacroValue)>),
    /// The same JS array/object as the `n`th `Array`/`Object` node in pre-order
    /// (shared references and cycles survive the trip).
    Shared(u32),
}

pub struct MacroFailure {
    /// Attributed to the call site by the caller.
    message: Vec<u8>,
}

impl MacroFailure {
    fn text(message: impl Into<Vec<u8>>) -> MacroFailure {
        MacroFailure {
            message: message.into(),
        }
    }
}

pub enum MacroOutcome {
    Value(MacroValue),
    Failed(MacroFailure),
}

/// One macro invocation. Lives on the calling thread's stack; that thread is
/// parked in [`MacroHost::run`] from the moment the request is posted until
/// `done` is set, so the host has exclusive use of it in between and may read
/// `args` (which point into the caller's AST) in place.
pub struct MacroRequest<'a> {
    /// Absolute path of the macro module (or a builtin module name).
    specifier: &'a [u8],
    function_name: &'a [u8],
    args: &'a [Expr],
    /// Structured clone of `transformSync`'s context object, if any.
    context: Option<jsc::SerializedScriptValue>,
    outcome: MacroOutcome,
    done: ResetEvent,
    task: ConcurrentTask,
}

// SAFETY: handed to the host thread through the concurrent task queue and
// touched there only while the owning thread is parked on `done`; the borrowed
// `args`/`specifier` are read-only for that window, `context` is an owned byte
// buffer, and `outcome` is written before `done.set()` publishes it.
unsafe impl Send for MacroRequest<'_> {}

impl Taskable for MacroRequest<'_> {
    const TAG: TaskTag = task_tag::MacroRequest;
    /// The host VM is tearing down with this request still in its queue: the
    /// macro will never run. Answer it so its caller wakes.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: released ⇒ never dispatched; the parked caller is the only
        // other party and does nothing until `done` is set.
        unsafe {
            (*this).outcome = MacroOutcome::Failed(MacroFailure::text(
                "the macro host shut down before running this macro",
            ));
            (*this).done.set();
        }
    }
}

impl MacroRequest<'_> {
    /// `bun_runtime::dispatch` arm for [`task_tag::MacroRequest`]: runs on the
    /// host thread inside its event loop's task phase.
    pub fn run_on_macro_host(this: *mut Self, global: &JSGlobalObject) {
        HostState::with(|state| state.start(this.cast(), global));
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Caller side: MacroValue → Expr
// ══════════════════════════════════════════════════════════════════════════

/// Builds the `Expr` for `value` on the calling thread: nodes go into this
/// thread's AST store, list buffers into its `AstAlloc` arena, and byte/UTF-16
/// payloads into `bump` (see [`MacroContext::bump`]).
fn materialize(value: &MacroValue, bump: &Arena, log: &mut Log, loc: Loc) -> crate::Result<Expr> {
    struct Builder<'a> {
        bump: &'a Arena,
        log: &'a mut Log,
        loc: Loc,
        /// `Array`/`Object` nodes in pre-order, for `MacroValue::Shared`.
        containers: Vec<Expr>,
    }
    impl Builder<'_> {
        fn build(&mut self, value: &MacroValue) -> crate::Result<Expr> {
            let loc = self.loc;
            Ok(match value {
                MacroValue::Undefined => Expr::init(E::Undefined {}, loc),
                MacroValue::Null => Expr::init(E::Null {}, loc),
                MacroValue::Boolean(b) => Expr {
                    data: ExprData::EBoolean(E::Boolean { value: *b }),
                    loc,
                },
                MacroValue::Number(n) => Expr::init(E::Number::new(*n), loc),
                MacroValue::BigInt { negative, digits } => {
                    let digits: &[u8] = self.bump.alloc_slice_copy(digits);
                    let literal = Expr::init(
                        E::BigInt {
                            value: bun_ast::StoreStr::new(digits),
                        },
                        loc,
                    );
                    if *negative {
                        Expr::init(
                            E::Unary {
                                op: bun_ast::OpCode::UnNeg,
                                value: literal,
                                flags: E::UnaryFlags::default(),
                            },
                            loc,
                        )
                    } else {
                        literal
                    }
                }
                MacroValue::String(utf16) => {
                    let slice: &[u16] = self.bump.alloc_slice_copy(utf16);
                    Expr::init(E::EString::init_utf16(slice), loc)
                }
                MacroValue::Blob {
                    bytes,
                    content_type,
                } => expr_from_blob(bytes, self.bump, content_type, self.log, loc)?,
                MacroValue::Array(items) => {
                    let expr = Expr::init(
                        E::Array {
                            items: bun_alloc::AstAlloc::vec(),
                            was_originally_macro: true,
                            ..Default::default()
                        },
                        loc,
                    );
                    self.containers.push(expr);
                    let mut list = ExprNodeList::init_capacity(items.len());
                    for item in items {
                        let elem = self.build(item)?;
                        if elem.is_missing() {
                            continue;
                        }
                        VecExt::append(&mut list, elem);
                    }
                    if let ExprData::EArray(mut array) = expr.data {
                        array.items = list;
                    }
                    expr
                }
                MacroValue::Object(properties) => {
                    let expr = Expr::init(
                        E::Object {
                            properties: bun_alloc::AstAlloc::vec(),
                            was_originally_macro: true,
                            ..Default::default()
                        },
                        loc,
                    );
                    self.containers.push(expr);
                    let mut list = G::PropertyList::init_capacity(properties.len());
                    for (key, value) in properties {
                        let value = self.build(value)?;
                        let key_bytes: &[u8] = self.bump.alloc_slice_copy(key);
                        let key = Expr::init(E::EString::init(key_bytes), loc);
                        VecExt::append(
                            &mut list,
                            G::Property {
                                flags: E::own_key_property_flags(&key),
                                key: Some(key),
                                value: Some(value),
                                ..Default::default()
                            },
                        );
                    }
                    if let ExprData::EObject(mut object) = expr.data {
                        object.properties = list;
                    }
                    expr
                }
                MacroValue::Shared(index) => self.containers[*index as usize],
            })
        }
    }
    Builder {
        bump,
        log,
        loc,
        containers: Vec::new(),
    }
    .build(value)
}

/// Lives here, not on `bun_ast::Expr`, because it parses JSON via `bun_parsers`
/// — `bun_ast` is a leaf below both.
fn expr_from_blob(
    bytes: &[u8],
    bump: &Arena,
    mime_type: &[u8],
    log: &mut Log,
    loc: Loc,
) -> crate::Result<Expr> {
    use bun_ast::StoreStr as Str;

    // MimeType::Category::Json — `application/json` or `+json`/`/json` suffix.
    let is_json = mime_type == b"application/json"
        || mime_type.ends_with(b"+json")
        || mime_type.ends_with(b"/json");

    if is_json {
        // The parsed strings borrow the source bytes; keep them in `bump`.
        let bytes: &[u8] = bump.alloc_slice_copy(bytes);
        let source = &Source::init_path_string(b"fetch.json", bytes);
        let mut out_expr: Expr = match bun_parsers::json::parse_for_macro(source, log, bump) {
            Ok(e) => e,
            Err(_) => return Err(crate::Error::MacroFailed),
        };
        out_expr.loc = loc;
        match &mut out_expr.data {
            ExprData::EObject(obj) => obj.was_originally_macro = true,
            ExprData::EArray(arr) => arr.was_originally_macro = true,
            _ => {}
        }
        return Ok(out_expr);
    }

    // MimeType::Category::isTextLike — text/*, application/javascript-ish, xml.
    let is_text_like = mime_type.starts_with(b"text/")
        || mime_type == b"application/javascript"
        || mime_type == b"application/x-javascript"
        || mime_type == b"application/ecmascript"
        || mime_type == b"application/xml";

    if is_text_like {
        let mut output = bun_core::MutableString::init_empty();
        bun_core::quote_for_json(bytes, &mut output, true)?;
        let owned = output.to_owned_slice();
        // strip the surrounding quotes; copy into the bump arena so the
        // `E.String` data outlives `owned`.
        let unquoted: &[u8] = if owned.len() >= 2 {
            &owned[1..owned.len() - 1]
        } else {
            &owned[..]
        };
        let data = Str::new(bump.alloc_slice_copy(unquoted));
        return Ok(Expr::init(
            E::String {
                data,
                ..Default::default()
            },
            loc,
        ));
    }

    // Fallback: base64 data URL.
    let prefix = b"data:";
    let mid = b";base64,";
    let encoded_len = bun_base64::encode_len(bytes);
    let total = prefix.len() + mime_type.len() + mid.len() + encoded_len;
    let buf: &mut [u8] = bump.alloc_slice_fill_copy(total, 0u8);
    let mut i = 0usize;
    buf[i..i + prefix.len()].copy_from_slice(prefix);
    i += prefix.len();
    buf[i..i + mime_type.len()].copy_from_slice(mime_type);
    i += mime_type.len();
    buf[i..i + mid.len()].copy_from_slice(mid);
    i += mid.len();
    let n = bun_base64::encode(&mut buf[i..], bytes);
    let data = Str::new(&buf[..i + n]);
    Ok(Expr::init(
        E::String {
            data,
            ..Default::default()
        },
        loc,
    ))
}

// ══════════════════════════════════════════════════════════════════════════
// MacroHost: the thread and its VM
// ══════════════════════════════════════════════════════════════════════════

/// Configures the host VM's own transpiler (for the imports *inside* macro
/// modules; the macro specifier itself is always resolved by the caller):
/// the program's configuration when there is a main-thread VM, as for a
/// Worker; otherwise (`bun build`) the calling transpiler's, which is the
/// command's.
struct MacroHostSeed {
    transform_options: bun_options_types::schema::api::TransformOptions,
    env_map: bun_dotenv::Map,
}

impl MacroHostSeed {
    fn new(caller: &Transpiler<'_>) -> MacroHostSeed {
        let transpiler: &Transpiler<'_> = match VirtualMachine::get_main_thread_vm() {
            // SAFETY: the main-thread VM outlives every transpile in the
            // process; its options and env are only read here.
            Some(vm) => unsafe { &(*vm).transpiler },
            None => caller,
        };
        MacroHostSeed {
            transform_options: (*transpiler.options.transform_options).clone(),
            env_map: bun_core::handle_oom(transpiler.env().map.clone_with_allocator()),
        }
    }
}

pub struct MacroHost {
    /// How every other thread reaches the host VM: post a request, wake it.
    /// `Err` if the VM could not be created; every request then fails with it.
    handle: Result<VmHandle, Vec<u8>>,
    /// Whether the host still takes requests. Cleared by the host thread, under
    /// this lock, right before it releases whatever is queued; [`run`] posts
    /// under it, so a request is either queued in time to be released or not
    /// posted at all — never stranded.
    accepting: bun_threading::Guarded<bool>,
    thread: bun_threading::Guarded<Option<std::thread::JoinHandle<()>>>,
}

/// What the host thread reports once it has started (or failed to).
type HostStartup = std::sync::Arc<(
    bun_threading::Guarded<Option<Result<VmHandle, Vec<u8>>>>,
    ResetEvent,
)>;

static HOST: OnceLock<MacroHost> = OnceLock::new();

/// Set by [`MacroHost::shutdown`]; read by the host thread between turns.
static STOP: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

impl MacroHost {
    /// The process's macro host, starting it (and waiting until its VM is up)
    /// on first use. `seed` is evaluated only by the caller that starts it.
    fn get_or_start(seed: impl FnOnce() -> MacroHostSeed) -> &'static MacroHost {
        HOST.get_or_init(|| {
            let seed = seed();
            let ready: HostStartup =
                std::sync::Arc::new((bun_threading::Guarded::new(None), ResetEvent::default()));
            let ready_for_thread = std::sync::Arc::clone(&ready);
            // `VirtualMachine::init` plus module evaluation needs more than the
            // 2 MiB `std::thread` default (same as the debugger thread).
            let thread = std::thread::Builder::new()
                .name("Macros".to_string())
                .stack_size(16 * 1024 * 1024)
                .spawn(move || host_thread_main(seed, ready_for_thread))
                .expect("failed to spawn the macro host thread");
            ready.1.wait();
            let handle = ready
                .0
                .lock()
                .take()
                .expect("macro host reported before signalling ready");
            MacroHost {
                handle,
                accepting: bun_threading::Guarded::new(true),
                thread: bun_threading::Guarded::new(Some(thread)),
            }
        })
    }

    /// Post `request` to the host and park until it has been answered.
    fn run(&self, request: &mut MacroRequest<'_>) {
        let handle = match &self.handle {
            Ok(handle) => handle,
            Err(reason) => {
                request.outcome = MacroOutcome::Failed(MacroFailure::text(reason.clone()));
                return;
            }
        };
        let request_ptr: *mut MacroRequest<'_> = request;
        let task = NonNull::from(request.task.from(request_ptr, AutoDeinit::ManualDeinit));
        let posted = {
            let accepting = self.accepting.lock();
            *accepting && matches!(handle.post(task), bun_jsc::Posted::Queued)
        };
        // Otherwise the host has shut down (process exit is under way on
        // another thread); `outcome` still holds its initial failure.
        if posted {
            request.done.wait();
        }
    }

    /// Stop the host thread and tear its VM down, if one was started. Requests
    /// still queued or in flight are answered as failed so their callers wake.
    /// Waits for the thread, so nothing of the host outlives this call. Called
    /// from the main `VirtualMachine`'s teardown alongside its workers, or by
    /// `bun build` before it exits.
    pub fn shutdown() {
        let Some(host) = HOST.get() else { return };
        let Some(thread) = host.thread.lock().take() else {
            return;
        };
        let Ok(handle) = &host.handle else { return };
        STOP.store(true, core::sync::atomic::Ordering::Release);
        // Also interrupts a macro that is stuck in synchronous JS.
        handle.request_termination();
        let _ = thread.join();
    }
}

fn host_thread_main(seed: MacroHostSeed, ready: HostStartup) {
    Output::Source::configure_named_thread(bun_core::zstr!("Macros"));
    jsc::mark_binding();
    // First JSC user in a `bun build` with no runtime VM; a no-op otherwise.
    jsc::initialize(jsc::InitializeOptions::default());

    let MacroHostSeed {
        transform_options,
        env_map,
    } = seed;
    let env_loader: *mut bun_dotenv::Loader =
        bun_core::heap::into_raw(Box::new(bun_dotenv::Loader::init_with_map(env_map)));
    let vm_ptr = match VirtualMachine::init(InitOptions {
        transform_options,
        env_loader: NonNull::new(env_loader),
        is_main_thread: false,
        is_macro_vm: true,
        ..Default::default()
    }) {
        Ok(vm) => vm,
        Err(err) => {
            *ready.0.lock() = Some(Err([
                b"the macro VM failed to start: ".as_slice(),
                bun_core::output::ErrName::name(&err),
            ]
            .concat()));
            ready.1.set();
            // SAFETY: `heap::into_raw` above; nothing else holds it.
            drop(unsafe { bun_core::heap::take(env_loader) });
            return;
        }
    };
    debug_assert!(core::ptr::eq(vm_ptr, VirtualMachine::get_mut_ptr()));
    let vm = VirtualMachine::get().as_mut();

    // Macro modules and everything they import are built for this target: the
    // parser refuses nested macro calls in them, `process.env.BUN_*` defines
    // apply, and the "macro" export condition is honoured.
    vm.transpiler.options.target = bun_ast::Target::BunMacro;
    // bunfig `[macros]` remaps describe the program, not macro modules.
    vm.transpiler.options.macro_remap = MacroRemap::default();
    vm.has_any_macro_remappings = false;
    let startup_error: Option<String> = match vm.transpiler.configure_defines() {
        Ok(()) => None,
        Err(err) => Some(format!(
            "the macro VM could not load its environment: {}",
            bstr::BStr::new(bun_core::output::ErrName::name(&err))
        )),
    };
    vm.load_extra_env_and_source_code_printer();
    vm.event_loop_mut().ensure_waker();

    let global = vm.global();
    // Held for the thread's whole life and abandoned with the VM, as
    // `WebWorker::thread_main` does (no RAII guard: the VM is destroyed
    // before this function returns).
    JSC__VM__getAPILock(global.vm());
    // So another thread may `request_termination()` at process exit (a VM
    // creates the cell lazily, on its own thread).
    let _ = global.vm().termination_exception();

    let state = HostState {
        startup_error,
        functions: RefCell::new(HashMap::default()),
        in_flight: RefCell::new(Vec::new()),
    };
    HOST_STATE.set(&raw const state);

    *ready.0.lock() = Some(Ok(vm.handle()));
    ready.1.set();
    drop(ready);

    // Something to park on between requests: with nothing else registered the
    // loop is not "active" and `auto_tick` would return immediately.
    vm.event_loop_mut().ref_keep_alive();
    while !STOP.load(core::sync::atomic::Ordering::Acquire) {
        vm.event_loop_mut().tick();
        if STOP.load(core::sync::atomic::Ordering::Acquire) {
            break;
        }
        vm.event_loop_mut().auto_tick();
    }
    vm.event_loop_mut().unref_keep_alive();

    // Requests whose promises never settled: their reactions will not run once
    // script is forbidden, so answer them here. Requests still queued are
    // released (and so answered) now too, before teardown joins this VM's
    // workers: a worker parked on one of them would never finish otherwise.
    for request in state.in_flight.take() {
        // SAFETY: an in-flight request's caller is parked until `done` is set.
        unsafe {
            (*request).outcome = MacroOutcome::Failed(MacroFailure::text(
                "the process exited before this macro finished",
            ));
            (*request).done.set();
        }
    }
    if let Some(host) = HOST.get() {
        *host.accepting.lock() = false;
    }
    vm.release_queued_work();
    state.functions.borrow_mut().clear();
    HOST_STATE.set(core::ptr::null());

    vm.is_shutting_down = true;
    // SAFETY: this thread's VM (`init` was passed `log: None`); its handle is
    // the only thing other threads hold; nothing dereferences it afterwards.
    unsafe { VirtualMachine::teardown_and_free_thread_vm(vm_ptr) };
    // SAFETY: `heap::into_raw` above; the VM that borrowed it is gone.
    drop(unsafe { bun_core::heap::take(env_loader) });
}

// ══════════════════════════════════════════════════════════════════════════
// Host side: running a request
// ══════════════════════════════════════════════════════════════════════════

/// The host thread's bookkeeping. Reached from the task dispatch arm and the
/// promise reactions through [`HOST_STATE`]; only ever touched on that thread.
/// Interior-mutable because a reaction for one request can run (as a
/// microtask) while another request's macro call is on the stack.
struct HostState {
    startup_error: Option<String>,
    /// Loaded macro functions by `specifier NUL export`.
    functions: RefCell<HashMap<Box<[u8]>, Strong>>,
    /// Requests that have been started and not yet answered (waiting on an
    /// import or on the macro's promise).
    in_flight: RefCell<Vec<*mut MacroRequest<'static>>>,
}

#[thread_local]
static HOST_STATE: Cell<*const HostState> = Cell::new(core::ptr::null());

impl HostState {
    fn with<R>(f: impl FnOnce(&HostState) -> R) -> R {
        let state = HOST_STATE.get();
        debug_assert!(
            !state.is_null(),
            "macro request dispatched off the macro host thread"
        );
        // SAFETY: set for the lifetime of `host_thread_main`'s loop, which is
        // the only caller (via dispatch / reactions); host thread only.
        f(unsafe { &*state })
    }

    fn key(request: &MacroRequest<'_>) -> Box<[u8]> {
        [request.specifier, b"\0", request.function_name]
            .concat()
            .into_boxed_slice()
    }

    fn start(&self, request: *mut MacroRequest<'static>, global: &JSGlobalObject) {
        self.in_flight.borrow_mut().push(request);
        // SAFETY: the caller is parked until we answer; exclusive access.
        let req = unsafe { &*request };
        if let Some(err) = &self.startup_error {
            return self.fail(request, MacroFailure::text(err.clone()));
        }
        if STOP.load(core::sync::atomic::Ordering::Acquire) {
            return self.fail(request, MacroFailure::text("the process is exiting"));
        }
        let cached = self
            .functions
            .borrow()
            .get(&Self::key(req))
            .map(Strong::get);
        if let Some(function) = cached {
            return self.call(request, global, function);
        }
        let specifier = bun_core::String::clone_utf8(req.specifier);
        let promise = match jsc::JSModuleLoader::import_ptr(global.as_mut_ptr(), &specifier) {
            Ok(p) => p,
            Err(err) => {
                let failure = self.failure_from_exception(global, err, "load");
                return self.fail(request, failure);
            }
        };
        // SAFETY: `import_ptr` returns a live promise cell.
        let promise = unsafe { promise.as_ref() }.as_value(global);
        promise.then(global, request, on_import_resolve, on_import_reject);
    }

    fn imported(
        &self,
        request: *mut MacroRequest<'static>,
        global: &JSGlobalObject,
        namespace: JSValue,
    ) {
        // SAFETY: the caller is parked until we answer; exclusive access.
        let req = unsafe { &*request };
        let function = match namespace.get(global, req.function_name) {
            Ok(Some(f)) if f.is_callable() => f,
            Ok(_) => {
                return self.fail(
                    request,
                    MacroFailure::text(format!(
                        "Macro \"{}\" not found in \"{}\"",
                        bstr::BStr::new(req.function_name),
                        bstr::BStr::new(req.specifier)
                    )),
                );
            }
            Err(err) => {
                let failure = self.failure_from_exception(global, err, "load");
                return self.fail(request, failure);
            }
        };
        self.functions
            .borrow_mut()
            .insert(Self::key(req), Strong::create(function, global));
        self.call(request, global, function);
    }

    fn call(
        &self,
        request: *mut MacroRequest<'static>,
        global: &JSGlobalObject,
        function: JSValue,
    ) {
        // SAFETY: the caller is parked until we answer; exclusive access.
        let req = unsafe { &*request };
        let mut args: Vec<JSValue> = Vec::with_capacity(req.args.len() + 1);
        // Converting one argument allocates and can collect the ones before it.
        let mut roots: Vec<jsc::ProtectedJSValue> = Vec::with_capacity(req.args.len() + 1);
        for arg in req.args {
            match arg.to_js(global) {
                Ok(value) => {
                    roots.push(value.protected());
                    args.push(value);
                }
                Err(err) => {
                    if let bun_ast::ToJSError::JSError = err {
                        let failure =
                            self.failure_from_exception(global, jsc::JsError::Thrown, "call");
                        return self.fail(request, failure);
                    }
                    return self.fail(
                        request,
                        MacroFailure::text(match err {
                            bun_ast::ToJSError::CannotConvertIdentifierToJS => {
                                "cannot pass an identifier to a macro; its arguments must be statically known".into()
                            }
                            _ => format!("cannot pass this argument to a macro: {}", <&'static str>::from(&err)),
                        }),
                    );
                }
            }
        }
        if let Some(context) = &req.context {
            match JSValue::deserialize(context.data(), global) {
                Ok(value) => {
                    roots.push(value.protected());
                    args.push(value);
                }
                Err(err) => {
                    let failure = self.failure_from_exception(global, err, "call");
                    return self.fail(request, failure);
                }
            }
        }
        let result = match function.call(global, JSValue::UNDEFINED, &args) {
            Ok(result) => result,
            Err(err) => {
                let failure = self.failure_from_exception(global, err, "call");
                return self.fail(request, failure);
            }
        };
        drop(roots);
        self.settle(request, global, result);
    }

    /// `value` is what the macro returned (or what its promise fulfilled with).
    fn settle(&self, request: *mut MacroRequest<'static>, global: &JSGlobalObject, value: JSValue) {
        if let Some(promise) = value.as_any_promise() {
            match promise.status() {
                PromiseStatus::Pending => {
                    value.then(global, request, on_result_resolve, on_result_reject);
                    return;
                }
                PromiseStatus::Fulfilled => {
                    return self.settle(request, global, promise.result(global.vm()));
                }
                PromiseStatus::Rejected => {
                    promise.set_handled(global.vm());
                    let failure = self.failure_from_value(global, promise.result(global.vm()));
                    return self.fail(request, failure);
                }
            }
        }
        let outcome = {
            let mut convert = Convert {
                global,
                seen: HashMap::default(),
                containers: 0,
            };
            match convert.value(value) {
                Ok(v) => MacroOutcome::Value(v),
                Err(ConvertError::Message(text)) => MacroOutcome::Failed(MacroFailure::text(text)),
                Err(ConvertError::Value(v)) => {
                    MacroOutcome::Failed(self.failure_from_value(global, v))
                }
                Err(ConvertError::Exception(err)) => {
                    MacroOutcome::Failed(self.failure_from_exception(global, err, "return value"))
                }
            }
        };
        self.answer(request, outcome);
    }

    fn fail(&self, request: *mut MacroRequest<'static>, failure: MacroFailure) {
        self.answer(request, MacroOutcome::Failed(failure));
    }

    fn answer(&self, request: *mut MacroRequest<'static>, outcome: MacroOutcome) {
        {
            let mut in_flight = self.in_flight.borrow_mut();
            if let Some(i) = in_flight.iter().position(|r| core::ptr::eq(*r, request)) {
                in_flight.swap_remove(i);
            }
        }
        // Whatever the macro printed goes out before its caller continues.
        Output::flush();
        // SAFETY: the caller is parked until `done` is set; after `set()` the
        // request may be gone, so it is not touched again.
        unsafe {
            (*request).outcome = outcome;
            (*request).done.set();
        }
    }

    /// A pending JS exception (`proof`) becomes the failure text.
    fn failure_from_exception(
        &self,
        global: &JSGlobalObject,
        proof: jsc::JsError,
        doing: &str,
    ) -> MacroFailure {
        let value = global.take_error(proof);
        if value.is_termination_exception() {
            return MacroFailure::text(format!(
                "the macro VM was terminated during the macro {doing}"
            ));
        }
        self.failure_from_value(global, value)
    }

    /// An error value (thrown, rejected with, or returned) as log lines.
    fn failure_from_value(&self, global: &JSGlobalObject, value: JSValue) -> MacroFailure {
        // The macro VM's own build/resolve errors (a macro module that does not
        // parse, an import it cannot find): message and position, as the log
        // would print them.
        let build_msg = value
            .as_class_ref::<BuildMessage>()
            .map(|b| &b.msg)
            .or_else(|| value.as_class_ref::<ResolveMessage>().map(|r| &r.msg));
        if let Some(msg) = build_msg {
            use std::io::Write as _;
            let mut text = msg.data.text.to_vec();
            if let Some(loc) = &msg.data.location {
                let _ = write!(
                    text,
                    "
    at {}:{}:{}",
                    bstr::BStr::new(&loc.file),
                    loc.line,
                    loc.column
                );
            }
            return MacroFailure { message: text };
        }
        let mut holder = jsc::zig_exception::Holder::init();
        let exception = holder.zig_exception();
        if let Some(error) = value.to_error() {
            error.to_zig_exception(global, exception);
        } else {
            match value.to_bun_string(global) {
                Ok(s) => exception.message = s,
                Err(err) => {
                    // Its toString() threw too; say what kind of value it was.
                    let unprintable = global.take_error(err);
                    exception.message = bun_core::String::clone_utf8(
                        format!(
                            "macro threw a {:?} value whose string conversion threw a {:?}",
                            value.js_type(),
                            unprintable.js_type()
                        )
                        .as_bytes(),
                    );
                }
            }
        }
        use std::io::Write as _;
        let name = exception.name.to_owned_slice();
        let mut text = exception.message.to_owned_slice();
        if !name.is_empty() && name != b"Error" {
            text.splice(0..0, [name, b": ".to_vec()].concat());
        }
        if text.is_empty() {
            text.extend_from_slice(b"macro threw a value with no message");
        }
        for frame in exception.stack.frames() {
            let function = frame.function_name.to_owned_slice();
            let file = frame.source_url.to_owned_slice();
            if file.is_empty() {
                continue;
            }
            let line = frame.position.line.one_based();
            let column = frame.position.column.one_based();
            let _ = if function.is_empty() {
                write!(
                    text,
                    "\n    at {}:{}:{}",
                    bstr::BStr::new(&file),
                    line,
                    column
                )
            } else {
                write!(
                    text,
                    "\n    at {} ({}:{}:{})",
                    bstr::BStr::new(&function),
                    bstr::BStr::new(&file),
                    line,
                    column
                )
            };
        }
        // A module that fails to parse rejects its import with an
        // AggregateError of the parse errors; those are the useful part.
        if value.is_aggregate_error(global) {
            let each = value.get(global, "errors").and_then(|errors| match errors {
                Some(errors) if errors.is_array() => {
                    errors.array_iterator(global).and_then(|mut it| {
                        let mut out = Vec::new();
                        while let Some(e) = it.next()? {
                            out.push(self.failure_from_value(global, e).message);
                        }
                        Ok(out)
                    })
                }
                _ => Ok(Vec::new()),
            });
            match each {
                Ok(each) => {
                    for message in each {
                        text.extend_from_slice(
                            b"
  ",
                        );
                        text.extend_from_slice(&message);
                    }
                }
                Err(err) => {
                    text.extend_from_slice(
                        b"
  ",
                    );
                    text.extend_from_slice(
                        &self
                            .failure_from_exception(global, err, "error report")
                            .message,
                    );
                }
            }
        }
        MacroFailure { message: text }
    }
}

fn request_from_callframe(callframe: &CallFrame) -> (*mut MacroRequest<'static>, JSValue) {
    let args = callframe.arguments();
    let request = args[args.len() - 1].as_promise_ptr::<MacroRequest<'static>>();
    let value = if args.len() > 1 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    (request, value)
}

fn import_resolved(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let (request, namespace) = request_from_callframe(callframe);
    HostState::with(|state| state.imported(request, global, namespace));
    Ok(JSValue::UNDEFINED)
}

fn import_rejected(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let (request, reason) = request_from_callframe(callframe);
    HostState::with(|state| {
        let failure = state.failure_from_value(global, reason);
        state.fail(request, failure);
    });
    Ok(JSValue::UNDEFINED)
}

fn result_resolved(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let (request, value) = request_from_callframe(callframe);
    HostState::with(|state| state.settle(request, global, value));
    Ok(JSValue::UNDEFINED)
}

fn result_rejected(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let (request, reason) = request_from_callframe(callframe);
    HostState::with(|state| {
        let failure = state.failure_from_value(global, reason);
        state.fail(request, failure);
    });
    Ok(JSValue::UNDEFINED)
}

// Exported as function symbols so `Zig::GlobalObject::promiseHandlerID`'s
// address comparison matches (see `PromiseFunctions` in ZigGlobalObject.h).
bun_jsc::jsc_promise_handler!(fn on_import_resolve = "Bun__Macro__onImportResolve" => import_resolved);
bun_jsc::jsc_promise_handler!(fn on_import_reject = "Bun__Macro__onImportReject" => import_rejected);
bun_jsc::jsc_promise_handler!(fn on_result_resolve = "Bun__Macro__onResultResolve" => result_resolved);
bun_jsc::jsc_promise_handler!(fn on_result_reject = "Bun__Macro__onResultReject" => result_rejected);

// ── JSValue → MacroValue ───────────────────────────────────────────────────

enum ConvertError {
    Message(String),
    /// A `BuildMessage`/`ResolveMessage`/`Error` the macro handed back.
    Value(JSValue),
    Exception(jsc::JsError),
}

impl From<jsc::JsError> for ConvertError {
    fn from(e: jsc::JsError) -> Self {
        ConvertError::Exception(e)
    }
}

struct Convert<'a> {
    global: &'a JSGlobalObject,
    /// Arrays/objects already visited → their pre-order index.
    seen: HashMap<JSValue, u32>,
    containers: u32,
}

impl Convert<'_> {
    fn cannot_coerce(&self, value: JSValue) -> ConvertError {
        let name = value.get_class_info_name().unwrap_or(b"unknown");
        ConvertError::Message(format!(
            "cannot coerce {} ({:?}) to Bun's AST. Please return a simpler type",
            bstr::BStr::new(name),
            value.js_type(),
        ))
    }

    fn value(&mut self, value: JSValue) -> Result<MacroValue, ConvertError> {
        use ConsoleObject::formatter::Tag as T;
        let global = self.global;
        if value.js_type() == jsc::JSType::RegExpObject {
            // The formatter tags these as strings; "/a/g" as a string literal
            // is not what anyone returned.
            return Err(self.cannot_coerce(value));
        }
        Ok(match T::get(value, global)?.tag.tag() {
            T::Undefined => MacroValue::Undefined,
            T::Null => MacroValue::Null,
            T::Boolean => MacroValue::Boolean(value.to_boolean()),
            T::BigInt => {
                let text = value.to_bun_string(global)?.to_owned_slice();
                match text.strip_prefix(b"-") {
                    Some(digits) => MacroValue::BigInt {
                        negative: true,
                        digits: Box::from(digits),
                    },
                    None => MacroValue::BigInt {
                        negative: false,
                        digits: text.into_boxed_slice(),
                    },
                }
            }
            T::Integer => MacroValue::Number(value.to_int32() as f64),
            T::Double => MacroValue::Number(value.as_number()),
            T::String => {
                let string = bun_core::OwnedString::new(value.to_bun_string(global)?);
                // JS-sourced WTF strings are never UTF-8-tagged: two arms suffice.
                MacroValue::String(if string.is_utf16() {
                    Box::from(string.utf16())
                } else {
                    string.latin1().iter().map(|&b| b as u16).collect()
                })
            }
            T::Error => return Err(ConvertError::Value(value)),
            T::Array => {
                if let Some(index) = self.seen.get(&value) {
                    return Ok(MacroValue::Shared(*index));
                }
                self.seen.insert(value, self.containers);
                self.containers += 1;
                let mut iter = JSArrayIterator::init(value, global)?;
                let mut items = Vec::with_capacity(iter.len as usize);
                while let Some(item) = iter.next()? {
                    items.push(self.value(item)?);
                }
                MacroValue::Array(items)
            }
            T::Object => {
                if let Some(index) = self.seen.get(&value) {
                    return Ok(MacroValue::Shared(*index));
                }
                self.seen.insert(value, self.containers);
                self.containers += 1;
                let object = value.get_object().expect("Tag::Object is an object");
                // SAFETY: `object` is a live JSC heap cell for the duration of the iteration.
                let object = unsafe { &*object };
                let mut iter = JSPropertyIterator::init(
                    global,
                    object,
                    JSPropertyIteratorOptions::new(false, true),
                )?;
                let mut properties = Vec::with_capacity(iter.len);
                while let Some(key) = iter.next()? {
                    let value = self.value(iter.value)?;
                    properties.push((Box::from(key.to_owned_slice()), value));
                }
                MacroValue::Object(properties)
            }
            T::Promise => {
                let promise = value.as_any_promise().expect("Tag::Promise is a promise");
                match promise.status() {
                    PromiseStatus::Fulfilled => self.value(promise.result(global.vm()))?,
                    PromiseStatus::Rejected => {
                        promise.set_handled(global.vm());
                        return Err(ConvertError::Value(promise.result(global.vm())));
                    }
                    PromiseStatus::Pending => {
                        return Err(ConvertError::Message(
                            "macro returned a Promise inside an array or object; await it inside the macro instead"
                                .into(),
                        ));
                    }
                }
            }
            T::Private => {
                if value.js_type() == jsc::JSType::DOMWrapper {
                    // `Response` / `Request`: their body as a Blob (the mixin
                    // lives in `bun_runtime`, hence the hook).
                    let hooks = runtime_hooks().expect("RuntimeHooks not installed");
                    if let Some(body_blob) = (hooks.body_mixin_get_blob)(value, global)? {
                        return self.value(body_blob);
                    }
                    if let Some(blob) = value.as_::<WebCore::Blob>() {
                        // SAFETY: `blob` is the payload of a live JS cell held
                        // by `value` on the stack.
                        let (bytes, content_type) =
                            unsafe { ((*blob).shared_view(), (*blob).content_type_slice()) };
                        return Ok(MacroValue::Blob {
                            bytes: Box::from(bytes),
                            content_type: Box::from(content_type),
                        });
                    }
                    if value.as_::<ResolveMessage>().is_some()
                        || value.as_::<BuildMessage>().is_some()
                    {
                        return Err(ConvertError::Value(value));
                    }
                }
                return Err(self.cannot_coerce(value));
            }
            _ => return Err(self.cannot_coerce(value)),
        })
    }
}
