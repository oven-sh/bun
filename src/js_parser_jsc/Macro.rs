use bun_collections::VecExt;
use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_ast::DisableStoreReset;
use bun_ast::{self as js_ast, E, Expr, ExprData, ExprNodeList, G, S, ToJSError};
use bun_ast::{Log, Range, Source};
use bun_bundler::{Transpiler, entry_points::MacroEntryPoint};
use bun_collections::{ArrayHashMap, HashMap};
use bun_core::strings;
use bun_core::{Error, Output, err};
use bun_dotenv::Loader as DotEnvLoader;
use bun_js_parser as js_parser;
use bun_resolver::Resolver;
use bun_resolver::package_json::{
    MacroImportReplacementMap as MacroRemapEntry, MacroMap as MacroRemap,
};

// PORT NOTE: Zig spec aliases `const js = bun.jsc.C;` (Macro.zig:642) — the
// C-API surface is intentionally `#[deprecated]` upstream but is the spec'd
// call path for `JSObjectCallAsFunctionReturnValueHoldingAPILock`.
use crate::expr_jsc::ExprJsc;
use bun_jsc::js_property_iterator::JSPropertyIteratorOptions;
use bun_jsc::virtual_machine::{
    InitOptions as VirtualMachineInitOptions, MacroModeGuard, VirtualMachine, runtime_hooks,
};
#[allow(deprecated)]
use bun_jsc::{
    self as jsc, ConsoleObject, JSArrayIterator, JSGlobalObject, JSPropertyIterator, JSValue,
    JsError, ModuleLoader, WebCore, c as js,
};
use bun_jsc::{BuildMessage, ResolveMessage};

use bun_resolver::Result as ResolveResult;

pub const NAMESPACE: &[u8] = b"macro";
pub const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

pub fn is_macro_path(str: &[u8]) -> bool {
    strings::has_prefix(str, NAMESPACE_WITH_COLON)
}

// ══════════════════════════════════════════════════════════════════════════
// MacroContext
// ══════════════════════════════════════════════════════════════════════════

// PORT NOTE: Zig stores `*Resolver` / `*DotEnv.Loader` and copies the
// `MacroRemap` hash-map header by value (which aliases the same backing
// storage). Rust models all three as raw pointers because the referents live
// inside the owning `Transpiler` and are also reachable through other aliases
// (`Transpiler.resolver`, `Transpiler.env`, `Transpiler.options`); a `&'a mut`
// here would forbid that aliasing under stacked-borrows. The `'static`
// erasure on `Resolver`/`DotEnvLoader` matches the `Transpiler<'static>`
// stored in `VirtualMachine` (the only producer of `MacroContext`).
pub struct MacroContext {
    pub resolver: *mut Resolver<'static>,
    pub env: *mut DotEnvLoader<'static>,
    pub macros: MacroMap,
    pub remap: bun_ptr::BackRef<MacroRemap>,
    pub javascript_object: JSValue,
    /// PORT NOTE: Zig threads `default_allocator` (mimalloc, process-lifetime)
    /// through `Runner::run` → `Run.allocator`; the slices it backs (property
    /// keys / UTF-16 string data / `from_blob` JSON sub-parse) are never
    /// individually freed and outlive the call frame. The Rust AST takes
    /// lifetime-erased `&[u8]` arena slices, so we own the backing arena here
    /// — `MacroContext` is stored in the long-lived `Transpiler` and outlives
    /// every `Expr` it produces (the parser splices the result into the AST and
    /// prints it before the `Transpiler` drops).
    ///
    /// Lazy: `Arena::new()` calls `mi_heap_new()`, and `MacroContext::init`
    /// runs once per `RuntimeTranspilerStore::TranspilerJob::run` iteration
    /// (the worker bytewise-copies `vm.transpiler`, sets `macro_context =
    /// None`, and `parse_maybe` re-creates it). `call()` is only reached when
    /// a file actually invokes a macro, so deferring the heap until then
    /// avoids one `mi_heap_new`/`mi_heap_destroy` pair on every dynamic
    /// `import()` (require-cache.test.ts T040 — on macOS arm64 the per-iter
    /// heap churn fragments mimalloc's segment cache).
    pub bump: Option<bun_alloc::Arena>,
}

pub type MacroMap = ArrayHashMap<i32, Macro>;

impl MacroContext {
    pub fn get_remap(&self, path: &[u8]) -> Option<&MacroRemapEntry> {
        // `remap` is a `BackRef` into `Transpiler.options`, which outlives
        // every `MacroContext` (see struct PORT NOTE).
        let remap = self.remap.get();
        if remap.is_empty() {
            return None;
        }
        remap.get(path)
    }
}

impl MacroContext {
    pub fn init(transpiler: &mut Transpiler<'static>) -> MacroContext {
        MacroContext {
            macros: MacroMap::new(),
            resolver: &raw mut transpiler.resolver,
            env: transpiler.env,
            remap: bun_ptr::BackRef::new(&transpiler.options.macro_remap),
            javascript_object: JSValue::ZERO,
            // Deferred until `call()` — see field doc.
            bump: None,
        }
    }

    pub fn call(
        &mut self,
        import_record_path: &[u8],
        source_dir: &[u8],
        log: &mut Log,
        source: &Source,
        import_range: Range,
        caller: Expr,
        function_name: &[u8],
    ) -> Result<Expr, Error> {
        let _store_guard = DisableStoreReset::new();
        // const is_package_path = isPackagePath(specifier);
        let import_record_path_without_macro_prefix = if is_macro_path(import_record_path) {
            &import_record_path[NAMESPACE_WITH_COLON.len()..]
        } else {
            import_record_path
        };

        debug_assert!(!is_macro_path(import_record_path_without_macro_prefix));

        // SAFETY: `resolver` outlives `self` (see struct PORT NOTE); uniquely
        // accessed for the duration of this resolve call.
        let resolver = unsafe { &mut *self.resolver };

        let input_specifier: &[u8] = 'brk: {
            if let Some(replacement) = ModuleLoader::HardcodedModule::Alias::get(
                import_record_path,
                bun_ast::Target::Bun,
                Default::default(),
            ) {
                break 'brk replacement.path.as_bytes();
            }

            let resolve_result = match resolver.resolve(
                source_dir,
                import_record_path_without_macro_prefix,
                bun_ast::ImportKind::Stmt,
            ) {
                Ok(r) => r,
                Err(e) if e == err!("ModuleNotFound") => {
                    log.add_resolve_error(
                        Some(source),
                        import_range,
                        format_args!(
                            "Macro \"{}\" not found",
                            bstr::BStr::new(import_record_path)
                        ),
                        import_record_path,
                        bun_ast::ImportKind::Stmt.into(),
                        e,
                    );
                    return Err(err!("MacroNotFound"));
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
                    return Err(e);
                }
            };
            // PORT NOTE: Zig captures the resolved primary path's `.text` and
            // hands the slice to `Macro.init`/`loadMacroEntryPoint`, which
            // copies into a buffer before the borrow ends. The Rust resolver's
            // `Result` owns its path strings via the global `DirnameStore`
            // (lifetime-erased `&'static [u8]`), so dropping `resolve_result`
            // does not invalidate `text`.
            break 'brk resolve_result.path_pair.primary.text;
        };

        let mut specifier_buf = [0u8; 64];
        let mut specifier_buf_len: u32 = 0;
        let hash = MacroEntryPoint::generate_id(
            input_specifier,
            function_name,
            &mut specifier_buf,
            &mut specifier_buf_len,
        );

        let macro_entry = self.macros.get_or_put(hash).expect("unreachable");
        if !macro_entry.found_existing {
            *macro_entry.value_ptr = match Macro::init(
                resolver,
                input_specifier,
                log,
                self.env,
                function_name,
                &specifier_buf[0..specifier_buf_len as usize],
                hash,
            ) {
                Ok(m) => m,
                Err(e) => {
                    // Zig: `Macro{ .resolver = undefined, .disabled = true }`
                    *macro_entry.value_ptr = Macro::disabled_sentinel();
                    return Err(e);
                }
            };
            Output::flush();
        }
        let _flush_guard = Output::flush_guard();

        // PORT NOTE: reshaped for borrowck — Zig copies the Macro by value out
        // of the map. We snapshot the small POD fields we need (`disabled`,
        // `vm`) so the macro_entry borrow can be released.
        let macro_disabled = macro_entry.value_ptr.disabled;
        let macro_vm = macro_entry.value_ptr.vm;
        let macro_: *const Macro = macro_entry.value_ptr;
        if macro_disabled {
            return Ok(caller);
        }
        // SAFETY: `Some` for every non-disabled Macro; see `Macro` PORT NOTE.
        let vm = macro_vm
            .expect("Macro.vm accessed on disabled sentinel")
            .as_ptr();
        // `vm` is the per-thread VM (BackRef invariant: outlives this guard).
        // Enables macro mode now; disables on scope exit.
        let _mode_guard = MacroModeGuard::new(vm);
        // SAFETY: `event_loop()` returns a self-pointer into `*vm`.
        unsafe { (*(*vm).event_loop()).ensure_waker() };

        // PORT NOTE: Zig builds `Wrapper { args: ArgsTuple, ret }` and calls
        // `vm.runWithAPILock(Wrapper, &wrapper, Wrapper.call)` which is just
        // `holdAPILock(ctx, fn(ctx))`. The Rust `run_with_api_lock` already
        // takes a closure, so the wrapper struct collapses into captures.
        let javascript_object = self.javascript_object;
        // PORT NOTE: reshaped for borrowck — `self.bump` is shared-borrowed for
        // the closure while `self.macros` was already released above; capture
        // as a raw pointer so the closure does not extend `&mut self`.
        // Lazy-init the backing arena now that a macro is actually being
        // invoked (see field doc — avoids per-`import()` `mi_heap_new`).
        let bump: *const bun_alloc::Arena =
            &raw const *self.bump.get_or_insert_with(bun_alloc::Arena::new);
        let ret = VirtualMachine::get().run_with_api_lock(|| {
            // SAFETY: `macro_` points into `self.macros` which is not mutated
            // for the duration of this closure; `bump` points into `*self`,
            // which outlives the closure and is not otherwise borrowed.
            Runner::run(
                unsafe { &*macro_ },
                log,
                unsafe { &*bump },
                function_name,
                caller,
                source,
                hash,
                javascript_object,
            )
        });
        Ok(ret?)
        // this.macros.getOrPut(key: K)
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Lower-tier bridge (`bun_ast::Macro::MacroContext` ⇆ this crate)
//
// `bun_js_parser` / `bun_bundler` cannot name `Resolver`/`DotEnv`/JSC types,
// so the parser-visible `MacroContext` carries an opaque `data` pointer to a
// boxed instance of this crate's `MacroContext` and dispatches `init`/`call`/
// `get_remap` through `extern "Rust"` fns resolved at link time. All type
// erasure is confined to these three bodies.
// ══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub fn __bun_macro_context_init(
    transpiler: *mut core::ffi::c_void,
) -> js_parser::Macro::MacroContext {
    // SAFETY: every caller of `js_parser::Macro::MacroContext::init<T>` passes a
    // `&mut bun_bundler::Transpiler<'_>`; the lifetime parameter is erased at
    // runtime so reading it as `'static` is layout-identical. The boxed state
    // is leaked for the long-lived `vm.transpiler` instance (Zig backed it
    // with `default_allocator`, process-lifetime) — but callers that run on a
    // short-lived bytewise-cloned `Transpiler` (e.g.
    // `RuntimeTranspilerStore::TranspilerJob::run`) MUST pair this with
    // `__bun_macro_context_deinit` or the `Box<MacroContext>` (and, if a macro
    // was actually invoked, its lazily-created `bump` arena) leaks per
    // iteration. `bump` is `None` on init, so this fn itself never calls
    // `mi_heap_new()`.
    let transpiler = unsafe { &mut *transpiler.cast::<Transpiler<'static>>() };
    let data = bun_core::heap::into_raw(Box::new(MacroContext::init(transpiler)));
    js_parser::Macro::MacroContext {
        javascript_object: js_parser::Macro::MacroJSCtx::ZERO,
        data: data.cast::<core::ffi::c_void>(),
    }
}

#[unsafe(no_mangle)]
pub fn __bun_macro_context_deinit(data: *mut core::ffi::c_void) {
    if data.is_null() {
        return;
    }
    // SAFETY: `data` is exactly the `Box<MacroContext>` allocated in
    // `__bun_macro_context_init` above; sole owner. Dropping the Box frees the
    // `MacroMap` and, if a macro was invoked, runs `MimallocArena::drop`
    // (→ `mi_heap_destroy`) on the lazily-created `bump`.
    drop(unsafe { Box::<MacroContext>::from_raw(data.cast::<MacroContext>()) });
}

#[unsafe(no_mangle)]
pub fn __bun_macro_context_call(
    ctx: &mut js_parser::Macro::MacroContext,
    import_record_path: &[u8],
    source_dir: &[u8],
    log: &mut Log,
    source: &Source,
    import_range: Range,
    caller: Expr,
    function_name: &[u8],
) -> Result<Expr, Error> {
    debug_assert!(
        !ctx.data.is_null(),
        "MacroContext.call reached without init"
    );
    // SAFETY: `data` is the `Box<MacroContext>` allocated in `init` above; the
    // lower-tier handle is uniquely borrowed for this call so no alias exists.
    let inner = unsafe { &mut *ctx.data.cast::<MacroContext>() };
    inner.javascript_object = JSValue::from_encoded(ctx.javascript_object.0 as usize);
    inner.call(
        import_record_path,
        source_dir,
        log,
        source,
        import_range,
        caller,
        function_name,
    )
}

#[unsafe(no_mangle)]
pub fn __bun_macro_context_get_remap(
    data: *mut core::ffi::c_void,
    path: &[u8],
) -> Option<&'static js_parser::Macro::MacroRemapEntry> {
    // SAFETY: `data` is the `Box<MacroContext>` allocated in `init` above; the
    // remap table lives in `Transpiler.options` which outlives every parse, so
    // the `'static` borrow is sound for callers that drop it before the
    // `Transpiler` does (matches the Zig by-value copy of the map header).
    let inner = unsafe { &*data.cast::<MacroContext>() };
    inner
        .get_remap(path)
        .map(|e| unsafe { &*(e as *const js_parser::Macro::MacroRemapEntry) })
}

// ══════════════════════════════════════════════════════════════════════════
// MacroResult
// ══════════════════════════════════════════════════════════════════════════

#[derive(Default)]
pub struct MacroResult {
    pub import_statements: Box<[S::Import]>,
    pub replacement: Expr,
}

// ══════════════════════════════════════════════════════════════════════════
// Macro
// ══════════════════════════════════════════════════════════════════════════

// PORT NOTE: Zig stores `*Resolver` / `*VirtualMachine` and leaves them `undefined`
// for the disabled sentinel (`Macro{ .resolver = undefined, .disabled = true }`).
// Rust references cannot be uninitialised, so both are carried as `Option<NonNull<_>>`;
// they are `Some` for every live macro and `None` only when `disabled == true`, which
// is checked before any access (see `MacroContext::call`).
pub struct Macro {
    // PORT NOTE: `Resolver<'a>` carries a borrow lifetime, but `Macro` is stored
    // by value in a `MacroMap` keyed by hash and outlives any single call frame.
    // The Zig original stores a raw `*Resolver`; `NonNull` already erases borrow
    // tracking, so `'static` here is the lifetime-erased moral equivalent.
    pub resolver: Option<NonNull<Resolver<'static>>>,
    pub vm: Option<NonNull<VirtualMachine>>,

    pub resolved: ResolveResult,
    pub disabled: bool,
}

impl Default for Macro {
    fn default() -> Self {
        Self::disabled_sentinel()
    }
}

impl Macro {
    /// Sentinel stored in the `MacroMap` when `Macro::init` fails, so subsequent
    /// calls with the same hash short-circuit instead of retrying the load.
    /// Mirrors Zig's `Macro{ .resolver = undefined, .disabled = true }`.
    fn disabled_sentinel() -> Self {
        Macro {
            resolver: None,
            vm: None,
            resolved: ResolveResult::default(),
            disabled: true,
        }
    }

    /// Unwrap the VM handle. Only valid when `!self.disabled` — `MacroContext::call`
    /// returns early on `disabled` before any `vm()` access, mirroring Zig where the
    /// raw pointer is left `undefined` and never dereferenced on that path.
    #[inline]
    pub fn vm(&self) -> *mut VirtualMachine {
        debug_assert!(!self.disabled);
        // SAFETY-adjacent: `Some` for every non-disabled Macro; see struct PORT NOTE.
        self.vm
            .expect("Macro.vm accessed on disabled sentinel")
            .as_ptr()
    }

    pub fn init(
        // allocator param deleted — always default_allocator
        resolver: &mut Resolver<'static>,
        input_specifier: &[u8],
        log: &mut Log,
        env: *mut DotEnvLoader<'static>,
        function_name: &[u8],
        specifier: &[u8],
        hash: i32,
    ) -> Result<Macro, Error> {
        // TODO(port): narrow error set
        let vm: *mut VirtualMachine = if VirtualMachine::is_loaded() {
            VirtualMachine::get_mut_ptr()
        } else {
            // PORT NOTE: Zig saved/restored `resolver.opts.transform_options`
            // across this block because `VirtualMachine.init` (via
            // `Config.configureTransformOptionsForBunVM`) mutates the *passed*
            // `args`. In the Rust port the resolver's forward-decl
            // `BundleOptions` does not carry `transform_options` (the canonical
            // owner is the bundler's `BundleOptions<'a>`), and
            // `RuntimeHooks::init_runtime_state` builds the macro VM's
            // transpiler from a fresh `TransformOptions` value rather than
            // borrowing the caller's, so there is nothing to mutate-and-restore
            // on `resolver.opts` here. `log`/`env_loader` *are* threaded so the
            // CLI-path macro VM uses the caller's log sink and env loader.

            // JSC needs to be initialized if building from CLI
            jsc::initialize(false);

            let _vm = VirtualMachine::init(VirtualMachineInitOptions {
                log: Some(NonNull::from(&mut *log)),
                env_loader: NonNull::new(env),
                is_main_thread: false,
                ..Default::default()
            })?;

            // SAFETY: `_vm` is the freshly-allocated per-thread VM.
            unsafe {
                (*_vm).enable_macro_mode();
                (*(*_vm).event_loop()).ensure_waker();
                (*_vm).transpiler.configure_defines()?;
            }
            _vm
        };

        // SAFETY: `vm` is the per-thread VM; uniquely accessed here.
        unsafe {
            (*vm).enable_macro_mode();
            (*(*vm).event_loop()).ensure_waker();
        }

        // SAFETY: `vm` is the per-thread VM; uniquely accessed here.
        let loaded_result = unsafe {
            (*vm).load_macro_entry_point(input_specifier, function_name, specifier, hash)
        }?;

        // SAFETY: `loaded_result` is a live heap-allocated `JSInternalPromise`
        // returned by `loadAndEvaluateModule`; `jsc_vm` is the live JSC VM.
        let unwrapped = unsafe {
            (*loaded_result).unwrap(&*(*vm).jsc_vm, jsc::PromiseUnwrapMode::LeaveUnhandled)
        };
        if let jsc::PromiseResult::Rejected(result) = unwrapped {
            // SAFETY: `vm.global` is the live per-thread global; `loaded_result`
            // is a live promise cell.
            unsafe {
                (*vm).unhandled_rejection(&*(*vm).global, result, (*loaded_result).to_js());
                (*vm).disable_macro_mode();
            }
            return Err(err!("MacroLoadError"));
        }

        Ok(Macro {
            vm: NonNull::new(vm),
            resolver: Some(NonNull::from(resolver)),
            resolved: ResolveResult::default(),
            disabled: false,
        })
    }
}

// ══════════════════════════════════════════════════════════════════════════
// Runner / Run
// ══════════════════════════════════════════════════════════════════════════

pub struct Runner;

type VisitMap = HashMap<JSValue, Expr>;

thread_local! {
    static EXCEPTION_HOLDER: Cell<bool> = const { Cell::new(false) };
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum MacroError {
    #[error("MacroFailed")]
    MacroFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error(transparent)]
    ToJs(#[from] ToJSError),
    // PORT NOTE: `JsError` does not impl `std::error::Error` in the stub surface,
    // so `#[error(transparent)]` / `#[from]` (which generates a `source()` requiring
    // `Error`) are unavailable; format via Debug + manual `From` instead.
    #[error("{0:?}")]
    Js(JsError),
}

impl From<JsError> for MacroError {
    fn from(e: JsError) -> Self {
        MacroError::Js(e)
    }
}

bun_core::oom_from_alloc!(MacroError);

impl From<MacroError> for Error {
    fn from(e: MacroError) -> Self {
        match e {
            MacroError::MacroFailed => err!("MacroFailed"),
            MacroError::OutOfMemory => err!("OutOfMemory"),
            MacroError::ToJs(e) => e.into(),
            MacroError::Js(JsError::OutOfMemory) => err!("OutOfMemory"),
            MacroError::Js(JsError::Terminated) => err!("JSTerminated"),
            MacroError::Js(JsError::Thrown) => err!("JSError"),
        }
    }
}

pub struct Run<'a> {
    pub caller: Expr,
    pub function_name: &'a [u8],
    pub macro_: &'a Macro,
    pub global: &'a JSGlobalObject,
    // PORT NOTE: Zig carried `std.mem.Allocator param` (always
    // `default_allocator`, mimalloc, process-lifetime — slices backing
    // `E.String` data / property keys are never freed). The Rust AST uses
    // arena-owned slices (`EString::init` lifetime-erases its borrow), so
    // `coerce` needs a bump arena to back property keys / UTF-16 string data /
    // `from_blob` JSON sub-parsing. The arena is *borrowed* from
    // `MacroContext` (stored long-term in the `Transpiler`) so the slices
    // outlive `run_async` — the returned `Expr` is spliced into the AST and
    // printed long after this frame returns.
    pub bump: &'a bun_alloc::Arena,
    pub id: i32,
    pub log: &'a mut Log,
    pub source: &'a Source,
    pub visited: VisitMap,
    pub is_top_level: bool,
}

impl<'a> Run<'a> {
    pub fn run_async(
        macro_: &Macro,
        log: &mut Log,
        bump: &bun_alloc::Arena,
        function_name: &[u8],
        caller: Expr,
        args: &[JSValue],
        source: &Source,
        id: i32,
    ) -> Result<Expr, MacroError> {
        let _ = macro_.vm();
        let vm = VirtualMachine::get();
        let Some(&macro_callback) = vm.macros.get(&id) else {
            return Ok(caller);
        };

        // SAFETY: `vm.global` is the live per-thread global; `macro_callback`
        // was obtained from the VM's macro table; `args` is a stack slice of
        // `#[repr(transparent)] i64` JSValues whose pointer is reinterpreted to
        // the C-API `JSObjectRef` (same encoded value).
        let result = unsafe {
            js::JSObjectCallAsFunctionReturnValueHoldingAPILock(
                vm.global,
                macro_callback,
                core::ptr::null_mut(),
                args.len(),
                args.as_ptr().cast::<js::JSValueRef>(),
            )
        };

        let mut runner = Run {
            caller,
            function_name,
            macro_,
            global: VirtualMachine::get().global(),
            bump,
            id,
            log,
            source,
            visited: VisitMap::default(),
            is_top_level: false,
        };

        // `runner.visited` dropped at scope exit (was `defer runner.visited.deinit(allocator)`)

        runner.run(result)
    }

    pub fn run(&mut self, value: JSValue) -> Result<Expr, MacroError> {
        use ConsoleObject::formatter::Tag as T;
        // PORT NOTE: `Tag::get` returns `TagResult { tag: TagPayload, .. }`;
        // collapse the payload to its discriminant via `.tag()`.
        match T::get(value, self.global)?.tag.tag() {
            T::Error => self.coerce(T::Error, value),
            T::Undefined => self.coerce(T::Undefined, value),
            T::Null => self.coerce(T::Null, value),
            T::Private => self.coerce(T::Private, value),
            T::Boolean => self.coerce(T::Boolean, value),
            T::Array => self.coerce(T::Array, value),
            T::Object => self.coerce(T::Object, value),
            T::ToJSON | T::JSON => self.coerce(T::JSON, value),
            T::Integer => self.coerce(T::Integer, value),
            T::Double => self.coerce(T::Double, value),
            T::String => self.coerce(T::String, value),
            T::Promise => self.coerce(T::Promise, value),
            _ => {
                let name = value.get_class_info_name().unwrap_or(b"unknown");

                self.log.add_error_fmt(
                    Some(self.source),
                    self.caller.loc,
                    // PORT NOTE: `JSType` derives `Debug` (not `IntoStaticStr`);
                    // Zig's `@tagName` ≈ `{:?}` here.
                    format_args!(
                        "cannot coerce {} ({:?}) to Bun's AST. Please return a simpler type",
                        bstr::BStr::new(name),
                        value.js_type(),
                    ),
                );
                Err(MacroError::MacroFailed)
            }
        }
    }

    // PORT NOTE: Zig dispatched on `comptime tag`; that requires
    // `Tag: core::marker::ConstParamTy`, which the upstream enum does not
    // derive. Reshaped to a runtime `tag` param — every call site in `run`
    // already matches once, so the comptime monomorphization was redundant.
    // PERF(port): was comptime monomorphization — profile in Phase B.
    pub fn coerce(
        &mut self,
        tag: ConsoleObject::formatter::Tag,
        value: JSValue,
    ) -> Result<Expr, MacroError> {
        use ConsoleObject::formatter::Tag as T;
        match tag {
            T::Error => {
                // SAFETY: `vm()` is the per-thread VM; uniquely accessed here.
                let _ =
                    unsafe { (*self.macro_.vm()).uncaught_exception(self.global, value, false) };
                return Ok(self.caller);
            }
            T::Undefined => {
                if self.is_top_level {
                    return Ok(self.caller);
                } else {
                    return Ok(Expr::init(E::Undefined {}, self.caller.loc));
                }
            }
            T::Null => return Ok(Expr::init(E::Null {}, self.caller.loc)),
            T::Private => {
                self.is_top_level = false;
                if let Some(cached) = self.visited.get(&value) {
                    return Ok(*cached);
                }

                let mut blob_: Option<*const WebCore::Blob> = None;
                let mime_type: Option<&[u8]> = None;

                if value.js_type() == jsc::JSType::DOMWrapper {
                    // LAYERING: `Response`/`Request` (and their `BodyMixin::
                    // get_blob_without_call_frame`) live in `bun_runtime::
                    // webcore`, which depends on this crate. The downcast +
                    // body-extract is dispatched through `RuntimeHooks` (the
                    // established §Dispatch cycle-break) so the data shapes
                    // stay in the high tier.
                    let hooks = runtime_hooks().expect("RuntimeHooks not installed");
                    if let Some(body_blob) = (hooks.body_mixin_get_blob)(value, self.global)? {
                        return self.run(body_blob);
                    } else if let Some(resp) = value.as_::<WebCore::Blob>() {
                        blob_ = Some(resp);
                    } else if value.as_::<ResolveMessage>().is_some()
                        || value.as_::<BuildMessage>().is_some()
                    {
                        // SAFETY: `vm()` is the per-thread VM; uniquely accessed here.
                        let _ = unsafe {
                            (*self.macro_.vm()).uncaught_exception(self.global, value, false)
                        };
                        return Err(MacroError::MacroFailed);
                    }
                }

                if let Some(blob) = blob_ {
                    // SAFETY: `blob` (a JS cell) is pinned for the call; the
                    // shared-view/content-type slices borrow its store.
                    let (bytes, ct) =
                        unsafe { ((*blob).shared_view(), (*blob).content_type_slice()) };
                    return expr_from_blob(
                        bytes,
                        self.bump,
                        mime_type.unwrap_or(ct),
                        self.log,
                        self.caller.loc,
                    )
                    .map_err(|_| MacroError::MacroFailed);
                }

                return Ok(Expr::init(E::EString::EMPTY, self.caller.loc));
            }

            T::Boolean => {
                return Ok(Expr {
                    data: ExprData::EBoolean(E::Boolean {
                        value: value.to_boolean(),
                    }),
                    loc: self.caller.loc,
                });
            }
            T::Array => {
                self.is_top_level = false;

                let _entry = self.visited.get_or_put(value).expect("unreachable");
                if _entry.found_existing {
                    return Ok(*_entry.value_ptr);
                }

                let mut iter = JSArrayIterator::init(value, self.global)?;

                // Process all array items
                // PERF(port): was allocator.alloc(Expr, iter.len) — profile in Phase B
                let mut array = ExprNodeList::init_capacity(iter.len as usize);
                // (errdefer free deleted — drops on `?`)
                let expr = Expr::init(
                    E::Array {
                        items: bun_alloc::AstAlloc::vec(),
                        was_originally_macro: true,
                        ..Default::default()
                    },
                    self.caller.loc,
                );
                *_entry.value_ptr = expr;
                let mut i: usize = 0;
                while let Some(item) = iter.next()? {
                    let elem = self.run(item)?;
                    if elem.is_missing() {
                        continue;
                    }
                    VecExt::append(&mut array, elem);
                    i += 1;
                }

                // PORT NOTE: reshaped for borrowck — `Expr.data.e_array` is a
                // `StoreRef` (raw arena ptr) so re-borrow it after the `run`
                // recursion releases `self`.
                if let ExprData::EArray(mut e_array) = expr.data {
                    e_array.items = array;
                    e_array.items.truncate((i) as usize);
                }
                return Ok(expr);
            }
            // TODO: optimize this
            T::Object => {
                self.is_top_level = false;
                let _entry = self.visited.get_or_put(value).expect("unreachable");
                if _entry.found_existing {
                    return Ok(*_entry.value_ptr);
                }

                // Reserve a placeholder to break cycles.
                let expr = Expr::init(
                    E::Object {
                        properties: bun_alloc::AstAlloc::vec(),
                        was_originally_macro: true,
                        ..Default::default()
                    },
                    self.caller.loc,
                );
                *_entry.value_ptr = expr;

                // SAFETY: tag ensures `value` is an object.
                let obj = value.get_object().expect("unreachable");
                // SAFETY: `obj` is a live JSC heap cell; `'a` is bounded by the
                // surrounding stack frame.
                let obj_ref = unsafe { &*obj };
                let mut object_iter = JSPropertyIterator::init(
                    self.global,
                    obj_ref,
                    JSPropertyIteratorOptions::new(false, true),
                )?;
                // `object_iter` dropped at scope exit (was `defer object_iter.deinit()`)

                // Build properties list
                let mut properties = G::PropertyList::init_capacity(object_iter.len);
                // (errdefer clearAndFree deleted — drops on `?`)

                while let Some(prop) = object_iter.next()? {
                    let object_value = self.run(object_iter.value)?;

                    // PORT NOTE: `EString::init` lifetime-erases its borrow
                    // (arena-owned per the Phase-A `Str` convention). Copy the
                    // key into the `MacroContext` bump arena so it outlives the
                    // temporary `to_owned_slice()` Vec and the returned `Expr`.
                    let key_bytes: &[u8] = self.bump.alloc_slice_copy(&prop.to_owned_slice());
                    VecExt::append(
                        &mut properties,
                        G::Property {
                            key: Some(Expr::init(E::EString::init(key_bytes), self.caller.loc)),
                            value: Some(object_value),
                            ..Default::default()
                        },
                    );
                }

                if let ExprData::EObject(mut e_object) = expr.data {
                    e_object.properties = properties;
                }

                return Ok(expr);
            }

            T::JSON => {
                self.is_top_level = false;
                // if (console_tag.cell == .JSDate) {
                //     // in the code for printing dates, it never exceeds this amount
                //     var iso_string_buf = this.allocator.alloc(u8, 36) catch unreachable;
                //     var str = jsc.ZigString.init("");
                //     value.jsonStringify(this.global, 0, &str);
                //     var out_buf: []const u8 = std.fmt.bufPrint(iso_string_buf, "{}", .{str}) catch "";
                //     if (out_buf.len > 2) {
                //         // trim the quotes
                //         out_buf = out_buf[1 .. out_buf.len - 1];
                //     }
                //     return Expr.init(E.New, E.New{.target = Expr.init(E.Dot{.target = E}) })
                // }
            }

            T::Integer => {
                return Ok(Expr::init(
                    E::Number {
                        value: value.to_int32() as f64,
                    },
                    self.caller.loc,
                ));
            }
            T::Double => {
                return Ok(Expr::init(
                    E::Number {
                        value: value.as_number(),
                    },
                    self.caller.loc,
                ));
            }
            T::String => {
                let bun_str = value.to_bun_string(self.global)?;
                // `bun_str.deref()` on Drop

                // encode into utf16 so the printer escapes the string correctly
                // PERF(port): was allocator.alloc(u16, len) — profile in Phase B
                //
                // Zig went through `bun.String.encodeInto(out, .utf16le)`
                // (string.zig:630), which lives in `bun_runtime::webcore::
                // encoding` (forward dep from here). For the fixed
                // `.utf16le` target the body is just: UTF-16 → memcpy,
                // Latin-1 → byte-widen. JS-sourced WTF strings are never
                // UTF-8-tagged (the Zig path `@panic`ed on that anyway),
                // so inline the two arms.
                let utf16_bytes: Vec<u16> = if bun_str.is_utf16() {
                    bun_str.utf16().to_vec()
                } else {
                    bun_str.latin1().iter().map(|&b| b as u16).collect()
                };
                // PORT NOTE: `E::EString::init_utf16` lifetime-erases the slice
                // (arena-owned per the Phase-A `Str` convention). Copy into
                // the `MacroContext` bump arena — Zig used `this.allocator`
                // (`default_allocator`, process-lifetime).
                let arena_slice: &[u16] = self.bump.alloc_slice_copy(&utf16_bytes);
                return Ok(Expr::init(
                    E::EString::init_utf16(arena_slice),
                    self.caller.loc,
                ));
            }
            T::Promise => {
                if let Some(cached) = self.visited.get(&value) {
                    return Ok(*cached);
                }

                let promise = value.as_any_promise().expect("Unexpected promise type");

                let _ = self.macro_.vm();
                let vm = VirtualMachine::get();
                vm.as_mut().wait_for_promise(promise);

                let promise_result = promise.result(vm.jsc_vm());
                let rejected = promise.status() == jsc::js_promise::Status::Rejected;

                if promise_result.is_undefined() && self.is_top_level {
                    self.is_top_level = false;
                    return Ok(self.caller);
                }

                if rejected
                    || promise_result.is_error()
                    || promise_result.is_aggregate_error(self.global)
                    // PORT NOTE: `JSGlobalObject::vm()` returns `&VM`;
                    // `is_exception` takes `*mut VM` (FFI passthrough). The
                    // C++ side never writes through it.
                    || promise_result
                        .is_exception(std::ptr::from_ref::<jsc::VM>(self.global.vm()).cast_mut())
                {
                    vm.as_mut().unhandled_rejection(
                        self.global,
                        promise_result,
                        promise.as_value(),
                    );
                    return Err(MacroError::MacroFailed);
                }
                self.is_top_level = false;
                let result = self.run(promise_result)?;

                self.visited.insert(value, result);
                return Ok(result);
            }
            _ => {}
        }

        self.log.add_error_fmt(
            Some(self.source),
            self.caller.loc,
            // PORT NOTE: `JSType` derives `Debug` (not `IntoStaticStr`).
            format_args!(
                "cannot coerce {:?} to Bun's AST. Please return a simpler type",
                value.js_type(),
            ),
        );
        Err(MacroError::MacroFailed)
    }
}

impl Runner {
    pub fn run(
        macro_: &Macro,
        log: &mut Log,
        bump: &bun_alloc::Arena,
        function_name: &[u8],
        caller: Expr,
        source: &Source,
        id: i32,
        javascript_object: JSValue,
    ) -> Result<Expr, MacroError> {
        if cfg!(debug_assertions) {
            Output::prettyln(format_args!(
                "<r><d>[macro]<r> call <d><b>{}<r>",
                bstr::BStr::new(function_name)
            ));
        }

        // PORT NOTE: Zig `exception_holder = jsc.ZigException.Holder.init();` —
        // the holder is never read in this body (legacy from an earlier
        // exception-reporting path); a thread-local sentinel suffices.
        EXCEPTION_HOLDER.with(|h| h.set(true));

        // PORT NOTE: Zig's `defer { for js_args[..n] |a| a.unprotect();
        // allocator.free(js_args); }` becomes an RAII guard that *owns* the
        // `Vec<JSValue>` + processed count. All mutation goes through the
        // guard's fields so there is no aliasing of a raw pointer with later
        // direct writes (the previous `*mut Vec` capture popped its
        // Stacked-Borrows tag on reassignment).
        struct JsArgs {
            args: Vec<JSValue>,
            processed_len: usize,
            has_js_object: bool,
        }
        impl Drop for JsArgs {
            fn drop(&mut self) {
                let n = self
                    .processed_len
                    .saturating_sub(usize::from(self.has_js_object));
                for arg in &self.args[0..n] {
                    arg.unprotect();
                }
                // `allocator.free(js_args)` — Vec drops with `self`.
            }
        }
        let mut js_args = JsArgs {
            args: Vec::new(),
            processed_len: 0,
            has_js_object: javascript_object != JSValue::ZERO,
        };

        // SAFETY: `Runner::run` is only reached via `MacroContext::call` after
        // `VirtualMachine::is_loaded()` / `Macro::init` guarantee a live VM.
        let global_object = VirtualMachine::get().global();

        match &caller.data {
            ExprData::ECall(call) => {
                let call_args: &[Expr] = call.args.slice();
                js_args.args = vec![
                    JSValue::ZERO;
                    call_args.len()
                        + usize::from(javascript_object != JSValue::ZERO)
                ];
                js_args.processed_len = js_args.args.len();

                for (i, in_) in call_args.iter().enumerate() {
                    let value = match in_.to_js(global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            // Keeping a separate variable instead of modifying js_args.len
                            // due to allocator.free call in defer
                            js_args.processed_len = i;
                            return Err(e.into());
                        }
                    };
                    value.protect();
                    js_args.args[i] = value;
                }
            }
            ExprData::ETemplate(_) => {
                log.add_error_fmt(
                    Some(source),
                    caller.loc,
                    format_args!("template literal macro invocations are not supported"),
                );
                return Err(MacroError::MacroFailed);
            }
            _ => {
                panic!("Unexpected caller type");
            }
        }

        if javascript_object != JSValue::ZERO {
            if js_args.args.is_empty() {
                js_args.args = vec![JSValue::ZERO; 1];
            }
            let last = js_args.args.len() - 1;
            js_args.args[last] = javascript_object;
        }

        // PORT NOTE: Zig stashes the call args + result in threadlocals so the
        // `extern "C" fn()` trampoline (no userdata) can reach them, then calls
        // `Bun__startMacro(&call, global)`. Rust round-trips through a
        // threadlocal `*mut c_void` to a stack `CallData` instead — `CallArgs`
        // is a tuple of borrowed refs that cannot live in a `thread_local!`.
        thread_local! {
            static CALL_STATE: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
        }

        struct CallData<'c> {
            macro_: &'c Macro,
            log: &'c mut Log,
            bump: &'c bun_alloc::Arena,
            function_name: &'c [u8],
            caller: Expr,
            js_args: &'c [JSValue],
            source: &'c Source,
            id: i32,
            result: Result<Expr, MacroError>,
        }

        extern "C" fn call() {
            CALL_STATE.with(|s| {
                // SAFETY: set immediately before Bun__startMacro below; cleared after.
                let state = unsafe { &mut *s.get().cast::<CallData<'_>>() };
                state.result = Run::run_async(
                    state.macro_,
                    state.log,
                    state.bump,
                    state.function_name,
                    state.caller,
                    state.js_args,
                    state.source,
                    state.id,
                );
            });
        }

        let mut data = CallData {
            macro_,
            log,
            bump,
            function_name,
            caller,
            js_args: &js_args.args,
            source,
            id,
            result: Err(MacroError::MacroFailed),
        };

        jsc::mark_binding();
        CALL_STATE.with(|s| s.set((&raw mut data).cast::<c_void>()));
        // SAFETY: `call` only reads CALL_STATE which we just set. Spec
        // Macro.zig:581 passes the raw `vm.global: *JSGlobalObject` field
        // directly — read it via raw-ptr field access (NOT the `&`-returning
        // `.global()` accessor) so the `*mut` provenance is preserved across
        // FFI.
        unsafe {
            Bun__startMacro(
                call as *const c_void,
                VirtualMachine::get().as_mut().global.cast::<c_void>(),
            );
        }
        CALL_STATE.with(|s| s.set(core::ptr::null_mut()));
        data.result
    }
}

unsafe extern "C" {
    fn Bun__startMacro(function: *const c_void, global: *mut c_void);
}

/// Zig: `Expr.fromBlob` (`src/js_parser/ast/Expr.zig`). Lives here, not on
/// `bun_ast::Expr`, because it parses JSON via `bun_parsers` — `bun_ast` is a
/// leaf below both. Only call site is the macro `Response`/`Blob` arm above.
fn expr_from_blob(
    bytes: &[u8],
    bump: &bun_alloc::Arena,
    mime_type: &[u8],
    log: &mut Log,
    loc: bun_ast::Loc,
) -> Result<Expr, bun_core::Error> {
    use bun_ast::{E, ExprData, StoreStr as Str};

    // MimeType::Category::Json — `application/json` or `+json`/`/json` suffix.
    let is_json = mime_type == b"application/json"
        || mime_type.ends_with(b"+json")
        || mime_type.ends_with(b"/json");

    if is_json {
        let source = &Source::init_path_string(b"fetch.json", bytes);
        let mut out_expr: Expr = match bun_parsers::json::parse_for_macro(source, log, bump) {
            Ok(e) => e,
            Err(_) => return Err(bun_core::err!("MacroFailed")),
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

// ported from: src/js_parser_jsc/Macro.zig
