use bun_collections::VecExt;
use core::cell::Cell;
use core::ffi::c_void;

use bun_ast::DisableStoreReset;
use bun_ast::{E, Expr, ExprData, ExprNodeList, G, ToJSError};
use bun_ast::{Log, Range, Source};
use bun_bundler::options::TransformOptions;
use bun_bundler::{Transpiler, entry_points::MacroEntryPoint};
use bun_collections::HashMap;
use bun_core::Output;
use bun_core::strings;
use bun_dotenv::Loader as DotEnvLoader;

use crate::Error;
use bun_js_parser::Macro::{MacroContext, MacroLoadState};
use bun_ptr::AliasableBox;

use crate::expr_jsc::ExprJsc;
use bun_jsc::js_property_iterator::JSPropertyIteratorOptions;
use bun_jsc::virtual_machine::{
    InitOptions as VirtualMachineInitOptions, MacroModeGuard, VirtualMachine, runtime_hooks,
};
use bun_jsc::{
    self as jsc, ConsoleObject, JSArrayIterator, JSGlobalObject, JSPropertyIterator, JSValue,
    JsError, MarkedArgumentBuffer, ModuleLoader, WebCore,
};
use bun_jsc::{BuildMessage, ResolveMessage};

const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

fn is_macro_path(str: &[u8]) -> bool {
    strings::has_prefix(str, NAMESPACE_WITH_COLON)
}

fn call_macro(
    ctx: MacroContext<'_>,
    bump: &bun_alloc::Arena,
    import_record_path: &[u8],
    source_dir: &[u8],
    log: &mut Log,
    source: &Source,
    import_range: Range,
    caller: Expr,
    function_name: &[u8],
) -> crate::Result<Expr> {
    if bun_jsc::compiled_program::compiled_program()
        .is_some_and(|program| !bun_jsc::compiled_program::admits_unknown_javascript(program))
    {
        log.add_range_error(
            Some(source),
            import_range,
            b"Macros cannot be used in this executable, which only runs code that was compiled into it",
        );
        return Err(crate::Error::MacroFailed);
    }
    // A macro's entry point is text made here, with names in it from the source that imports the macro, which may be a
    // string. The engine would refuse it, but nothing catches that rejection.
    if bun_core::code_generation_from_strings() == bun_core::CodeGenerationFromStrings::Strict {
        log.add_range_error(
            Some(source),
            import_range,
            b"Macros cannot be used with --disallow-code-generation-from-strings=strict",
        );
        return Err(crate::Error::MacroFailed);
    }
    let _store_guard = DisableStoreReset::new();
    let import_record_path_without_macro_prefix = if is_macro_path(import_record_path) {
        &import_record_path[NAMESPACE_WITH_COLON.len()..]
    } else {
        import_record_path
    };

    debug_assert!(!is_macro_path(import_record_path_without_macro_prefix));

    let transpiler = ctx.transpiler().cast::<Transpiler<'_>>();

    let input_specifier: &[u8] = 'brk: {
        if let Some(replacement) = ModuleLoader::HardcodedModule::Alias::get(
            import_record_path,
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            break 'brk replacement.path.as_bytes();
        }

        // SAFETY: the contract of `MacroContext::new`. Resolving runs no script.
        let resolver = unsafe { &mut (*transpiler).resolver };
        let resolve_result = match resolver.resolve(
            source_dir,
            import_record_path_without_macro_prefix,
            bun_ast::ImportKind::Stmt,
        ) {
            Ok(r) => r,
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
        };
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

    let vm = match ctx.macro_load_states.get(hash) {
        Some(MacroLoadState::Loaded) => VirtualMachine::get(),
        Some(MacroLoadState::Disabled) => return Ok(caller),
        None => {
            ctx.macro_load_states.set(hash, MacroLoadState::Disabled);
            let is_new_vm = !VirtualMachine::is_loaded();
            let vm = if is_new_vm {
                // SAFETY: the contract of `MacroContext::new`. `env` is the build's loader: it
                // outlives the build and nothing writes to it while parse tasks run.
                let (options, env) = unsafe {
                    (
                        &*(*transpiler).options.transform_options,
                        (*transpiler).env.as_ref(),
                    )
                };
                init_macro_vm(log, env, options)?
            } else {
                VirtualMachine::get()
            };
            load_macro(
                vm,
                is_new_vm,
                input_specifier,
                function_name,
                &specifier_buf[0..specifier_buf_len as usize],
                hash,
            )?;
            ctx.macro_load_states.set(hash, MacroLoadState::Loaded);
            Output::flush();
            vm
        }
    };
    let _flush_guard = Output::flush_guard();

    // Enables macro mode now; disables on scope exit.
    let _mode_guard = MacroModeGuard::new(vm);
    vm.event_loop().ensure_waker();

    let ret = vm.run_with_api_lock(|| {
        Runner::run(
            vm,
            log,
            bump,
            function_name,
            caller,
            source,
            hash,
            JSValue::from_encoded(ctx.javascript_object.0 as usize),
        )
    });
    Ok(ret?)
}

// `bun_js_parser` cannot name `Transpiler` or JSC types, so it calls these, which are resolved at link time.

#[unsafe(no_mangle)]
fn __bun_macro_drop_source_code_printer() {
    bun_jsc::virtual_machine::drop_source_code_printer_if_macro_owned();
}

/// Exposed for `bun_bundler::ThreadPool::Worker::drop` (which has no
/// `bun_jsc` dependency) to sweep the per-worker macro VM. See [`collect_macro_vm_garbage`].
///
/// [`collect_macro_vm_garbage`]: bun_jsc::virtual_machine::collect_macro_vm_garbage
#[unsafe(no_mangle)]
fn __bun_macro_collect_vm_garbage() {
    bun_jsc::virtual_machine::collect_macro_vm_garbage();
}

#[unsafe(no_mangle)]
fn __bun_macro_context_call(
    ctx: MacroContext<'_>,
    bump: &bun_alloc::Arena,
    import_record_path: &[u8],
    source_dir: &[u8],
    log: &mut Log,
    source: &Source,
    import_range: Range,
    caller: Expr,
    function_name: &[u8],
) -> Result<Expr, bun_js_parser::Error> {
    // ABI: the `extern "Rust"` declaration in bun_js_parser names
    // `bun_js_parser::Error`; keep both sides byte-identical.
    let caller_loc = caller.loc;
    call_macro(
        ctx,
        bump,
        import_record_path,
        source_dir,
        log,
        source,
        import_range,
        caller,
        function_name,
    )
    .map_err(|e| {
        // visit_expr only prints a fallback "macro threw exception" when
        // nothing was added to the log; record the specific cause here so
        // errors like ToJSError's "Cannot convert argument type to JS"
        // reach the user (03830.test.ts snapshot asserts on this).
        if e.name() != "MacroFailed" {
            log.add_error_fmt(
                Some(source),
                caller_loc,
                format_args!("\"{}\" error in macro", e.name()),
            );
        }
        bun_js_parser::Error::MacroFailed
    })
}

fn init_macro_vm(
    log: &mut Log,
    env: Option<&DotEnvLoader>,
    transform_options: &TransformOptions,
) -> crate::Result<&'static VirtualMachine> {
    let mut transform_options = transform_options.clone();
    // Build-only flags about the output bundle. The macro module's own
    // imports must still resolve.
    transform_options.external = Vec::new();
    transform_options.packages = None;

    // JSC needs to be initialized if building from CLI
    jsc::initialize(jsc::InitializeOptions::default());

    // `env` is shared by every parse thread, and this VM's transpiler loads `.env` files
    // into its loader, so give the VM its own copy.
    let env_loader = match env {
        Some(env) => Some(AliasableBox::new(env.clone_loaded()?)),
        None => None,
    };

    let options = VirtualMachineInitOptions {
        transform_options,
        env_loader: env_loader.as_ref().map(AliasableBox::as_non_null),
        is_main_thread: false,
        ..Default::default()
    };
    let vm = VirtualMachine::init(log, options)?;
    // This VM stays until the process exits.
    let _ = env_loader.map(AliasableBox::into_raw);
    Ok(vm)
}

fn load_macro(
    vm: &VirtualMachine,
    is_new_vm: bool,
    input_specifier: &[u8],
    function_name: &[u8],
    specifier: &[u8],
    hash: i32,
) -> crate::Result<()> {
    // Covers `configure_defines` (new-VM path) and `load_macro_entry_point`
    // (which runs the macro module's top-level JS via `wait_for_promise`) so
    // a top-level `Bun.Transpiler#transformSync` doesn't see
    // `macro_guard_depth == 0` and free the printer mid-load. Drops on every
    // exit (success, `?`, Rejected) so depth/state can't leak; the caller's
    // own `MacroModeGuard` re-enables for the actual macro call.
    let _mode_guard = MacroModeGuard::new(vm);
    vm.event_loop().ensure_waker();
    if is_new_vm {
        vm.transpiler.with_mut(|t| t.configure_defines())?;
    }

    let loaded_result =
        vm.load_macro_entry_point(input_specifier, function_name, specifier, hash)?;

    // SAFETY: `loaded_result` is a live heap-allocated `JSInternalPromise`
    // returned by `loadAndEvaluateModule`.
    let unwrapped =
        unsafe { (*loaded_result).unwrap(vm.jsc_vm(), jsc::PromiseUnwrapMode::LeaveUnhandled) };
    if let jsc::PromiseResult::Rejected(result) = unwrapped {
        vm.run_with_api_lock(|| {
            // SAFETY: `vm.global` is the live per-thread global; `loaded_result`
            // is a live promise cell.
            let (global, promise) = unsafe { (&*vm.global.get(), (*loaded_result).to_js()) };
            vm.unhandled_rejection(global, result, promise);
        });
        return Err(crate::Error::MacroLoadError);
    }

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════
// Runner / Run
// ══════════════════════════════════════════════════════════════════════════

struct Runner;

mod visit_map {
    use super::*;
    use bun_collections::hash_map::GetOrPutResult;

    /// Keyed by cell address. `roots` keeps every key alive so the GC can't reuse an address.
    pub(crate) struct VisitMap<'a> {
        exprs: HashMap<JSValue, Expr>,
        roots: &'a mut MarkedArgumentBuffer,
    }

    impl<'a> VisitMap<'a> {
        pub(crate) fn new(roots: &'a mut MarkedArgumentBuffer) -> Self {
            Self {
                exprs: HashMap::default(),
                roots,
            }
        }

        pub(crate) fn get(&self, value: JSValue) -> Option<&Expr> {
            self.exprs.get(&value)
        }

        pub(crate) fn get_or_put(
            &mut self,
            value: JSValue,
        ) -> Result<GetOrPutResult<'_, Expr>, bun_alloc::AllocError> {
            let entry = self.exprs.get_or_put(value)?;
            if !entry.found_existing {
                self.roots.append(value);
            }
            Ok(entry)
        }

        pub(crate) fn insert(&mut self, value: JSValue, expr: Expr) {
            if self.exprs.insert(value, expr).is_none() {
                self.roots.append(value);
            }
        }
    }
}
use visit_map::VisitMap;

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
    // `JsError` does not impl `std::error::Error` in the stub surface,
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
            MacroError::MacroFailed => crate::Error::MacroFailed,
            MacroError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
            MacroError::ToJs(e) => e.into(),
            MacroError::Js(JsError::OutOfMemory) => crate::Error::Alloc(bun_alloc::AllocError),
            MacroError::Js(JsError::Thrown | JsError::Terminated) => crate::Error::JSError,
        }
    }
}

pub(crate) struct Run<'a> {
    pub(crate) caller: Expr,
    pub(crate) vm: &'a VirtualMachine,
    pub(crate) global: &'a JSGlobalObject,
    /// The parser's arena: the returned `Expr` joins its AST.
    pub(crate) bump: &'a bun_alloc::Arena,
    pub(crate) log: &'a mut Log,
    pub(crate) source: &'a Source<'a>,
    pub(crate) visited: VisitMap<'a>,
    pub(crate) is_top_level: bool,
    pub(crate) stack_check: bun_core::StackCheck,
}

impl<'a> Run<'a> {
    pub(crate) fn run_async(
        vm: &VirtualMachine,
        log: &mut Log,
        bump: &bun_alloc::Arena,
        caller: Expr,
        args: &[JSValue],
        source: &Source,
        id: i32,
    ) -> Result<Expr, MacroError> {
        let Some(macro_callback) = vm.macros.get().get(&id).map(jsc::Strong::get) else {
            return Ok(caller);
        };

        let global = vm.global();
        let result = vm.run_with_api_lock(|| {
            macro_callback
                .call(global, JSValue::ZERO, args)
                .unwrap_or_else(|_| global.try_take_exception().unwrap_or_default())
        });

        MarkedArgumentBuffer::new(|roots| {
            let mut runner = Run {
                caller,
                vm,
                global,
                bump,
                log,
                source,
                visited: VisitMap::new(roots),
                is_top_level: false,
                stack_check: bun_core::StackCheck::init(),
            };

            runner.run(result)
        })
    }

    pub(crate) fn run(&mut self, value: JSValue) -> Result<Expr, MacroError> {
        use ConsoleObject::formatter::Tag as T;
        if !self.stack_check.is_safe_to_recurse() {
            self.log.add_error(
                Some(self.source),
                self.caller.loc,
                b"The value returned by this macro is nested too deeply",
            );
            return Err(MacroError::MacroFailed);
        }
        // `Tag::get` returns `TagResult { tag: TagPayload, .. }`;
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
                    // `JSType` derives `Debug` (not `IntoStaticStr`).
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

    // Runtime `tag` param — every call site in `run` already matches once.
    pub(crate) fn coerce(
        &mut self,
        tag: ConsoleObject::formatter::Tag,
        value: JSValue,
    ) -> Result<Expr, MacroError> {
        use ConsoleObject::formatter::Tag as T;
        match tag {
            T::Error => {
                let _ = self.vm.uncaught_exception(self.global, value, false);
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

                let mut blob_ = None;

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
                    } else if let Some(resp) = value.as_class_ref::<WebCore::Blob>() {
                        blob_ = Some(resp);
                    } else if value.is::<ResolveMessage>() || value.is::<BuildMessage>() {
                        let _ = self.vm.uncaught_exception(self.global, value, false);
                        return Err(MacroError::MacroFailed);
                    }
                }

                if let Some(blob) = blob_ {
                    let (bytes, ct) = (blob.shared_view(), blob.content_type_slice());
                    return expr_from_blob(bytes, self.bump, ct, self.log, self.caller.loc)
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

                // reshaped for borrowck — `Expr.data.e_array` is a
                // `StoreRef` (raw arena ptr) so re-borrow it after the `run`
                // recursion releases `self`.
                if let ExprData::EArray(mut e_array) = expr.data {
                    e_array.items = array;
                    e_array.items.truncate(i);
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
                let object_iter = JSPropertyIterator::init(
                    self.global,
                    obj_ref,
                    JSPropertyIteratorOptions::new(false, true),
                )?;
                // `object_iter` dropped at scope exit (was `defer object_iter.deinit()`)

                // Build properties list
                let mut properties = G::PropertyList::init_capacity(object_iter.len);
                // (errdefer clearAndFree deleted — drops on `?`)

                while let Some((prop, prop_value)) = object_iter.next()? {
                    let object_value = self.run(prop_value)?;

                    // `EString::init` lifetime-erases its borrow
                    // (arena-owned per the parser's `Str` convention). Copy the
                    // key into the arena so it outlives the temporary `to_owned_slice()` Vec.
                    let key_bytes: &[u8] = self.bump.alloc_slice_copy(&prop.to_owned_slice());
                    let key = Expr::init(E::EString::init(key_bytes), self.caller.loc);
                    VecExt::append(
                        &mut properties,
                        G::Property {
                            flags: E::own_key_property_flags(&key),
                            key: Some(key),
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
            }

            T::Integer => {
                return Ok(Expr::init(
                    E::Number::new(value.to_int32() as f64),
                    self.caller.loc,
                ));
            }
            T::Double => {
                return Ok(Expr::init(
                    E::Number::new(value.as_number()),
                    self.caller.loc,
                ));
            }
            T::String => {
                let bun_str = value.to_bun_string(self.global)?;

                // encode into utf16 so the printer escapes the string correctly
                // UTF-16 → memcpy, Latin-1 → byte-widen. JS-sourced WTF
                // strings are never UTF-8-tagged, so two arms suffice.
                let utf16_bytes: Vec<u16> = if bun_str.is_utf16() {
                    bun_str.utf16().to_vec()
                } else {
                    bun_str.latin1().iter().map(|&b| b as u16).collect()
                };
                // `E::EString::init_utf16` lifetime-erases the slice
                // (arena-owned per the parser's `Str` convention).
                let arena_slice: &[u16] = self.bump.alloc_slice_copy(&utf16_bytes);
                return Ok(Expr::init(
                    E::EString::init_utf16(arena_slice),
                    self.caller.loc,
                ));
            }
            T::Promise => {
                if let Some(cached) = self.visited.get(value) {
                    return Ok(*cached);
                }

                let promise = value.as_any_promise().expect("Unexpected promise type");

                let vm = self.vm;
                // The VM stopped before the macro's promise settled: throw its termination and unwind.
                vm.wait_for_promise(promise)
                    .map_err(|stopped| MacroError::Js(stopped.throw(self.global)))?;

                let promise_result = promise.result(vm.jsc_vm());
                let rejected = promise.status() == jsc::js_promise::Status::Rejected;

                if promise_result.is_undefined() && self.is_top_level {
                    self.is_top_level = false;
                    return Ok(self.caller);
                }

                if rejected
                    || promise_result.is_error()
                    || promise_result.is_aggregate_error(self.global)
                    // `JSGlobalObject::vm()` returns `&VM`;
                    // `is_exception` takes `*mut VM` (FFI passthrough). The
                    // C++ side never writes through it.
                    || promise_result
                        .is_exception(std::ptr::from_ref::<jsc::VM>(self.global.vm()).cast_mut())
                {
                    vm.unhandled_rejection(self.global, promise_result, promise.as_value());
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
            // `JSType` derives `Debug` (not `IntoStaticStr`).
            format_args!(
                "cannot coerce {:?} to Bun's AST. Please return a simpler type",
                value.js_type(),
            ),
        );
        Err(MacroError::MacroFailed)
    }
}

impl Runner {
    fn run(
        vm: &VirtualMachine,
        log: &mut Log,
        bump: &bun_alloc::Arena,
        function_name: &[u8],
        caller: Expr,
        source: &Source,
        id: i32,
        javascript_object: JSValue,
    ) -> Result<Expr, MacroError> {
        if bun_core::env::IS_DEBUG {
            bun_core::prettyln!(
                "<r><d>[macro]<r> call <d><b>{}<r>",
                bstr::BStr::new(function_name)
            );
        }

        // The exception holder is never read in this body (legacy from an earlier
        // exception-reporting path); a thread-local sentinel suffices.
        EXCEPTION_HOLDER.with(|h| h.set(true));

        // An RAII guard *owns* the
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

        let global_object = vm.global();

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

        // The `extern "C" fn()` trampoline (no userdata) reaches the call args +
        // result through a threadlocal `*mut c_void` pointing at a stack `CallData`
        // — `CallArgs` is a tuple of borrowed refs that cannot live in a `thread_local!`.
        thread_local! {
            static CALL_STATE: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
        }

        struct CallData<'c> {
            vm: &'c VirtualMachine,
            log: &'c mut Log,
            bump: &'c bun_alloc::Arena,
            caller: Expr,
            js_args: &'c [JSValue],
            source: &'c Source<'c>,
            id: i32,
            result: Result<Expr, MacroError>,
        }

        extern "C" fn call() {
            CALL_STATE.with(|s| {
                // SAFETY: set immediately before Bun__startMacro below; cleared after.
                let state = unsafe { &mut *s.get().cast::<CallData<'_>>() };
                state.result = Run::run_async(
                    state.vm,
                    state.log,
                    state.bump,
                    state.caller,
                    state.js_args,
                    state.source,
                    state.id,
                );
            });
        }

        let mut data = CallData {
            vm,
            log,
            bump,
            caller,
            js_args: &js_args.args,
            source,
            id,
            result: Err(MacroError::MacroFailed),
        };

        jsc::mark_binding();
        CALL_STATE.with(|s| s.set((&raw mut data).cast::<c_void>()));
        // SAFETY: `call` only reads CALL_STATE which we just set. The raw
        // `vm.global: *JSGlobalObject` field is read via raw-ptr field access
        // (NOT the `&`-returning `.global()` accessor) so the `*mut` provenance
        // is preserved across FFI.
        unsafe {
            Bun__startMacro(call as *const c_void, vm.global.get().cast::<c_void>());
        }
        CALL_STATE.with(|s| s.set(core::ptr::null_mut()));
        data.result
    }
}

unsafe extern "C" {
    fn Bun__startMacro(function: *const c_void, global: *mut c_void);
}

/// Lives here, not on `bun_ast::Expr`, because it parses JSON via `bun_parsers`
/// — `bun_ast` is a
/// leaf below both. Only call site is the macro `Response`/`Blob` arm above.
fn expr_from_blob(
    bytes: &[u8],
    bump: &bun_alloc::Arena,
    content_type: &[u8],
    log: &mut Log,
    loc: bun_ast::Loc,
) -> crate::Result<Expr> {
    use bun_ast::{E, ExprData, StoreStr as Str};

    // MIME essence: `type/subtype` with the parameters cut off.
    let essence: &[u8] = match strings::index_of_char_usize(content_type, b';') {
        Some(semicolon) => &content_type[..semicolon],
        None => content_type,
    }
    .trim_ascii();

    // `+json` is the RFC 6839 structured syntax suffix: `application/ld+json`.
    let is_json = essence.ends_with(b"/json") || essence.ends_with(b"+json");

    if is_json {
        let mut out_expr: Expr = match bun_parsers::json::parse_for_macro(bytes, log, bump) {
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

    let is_text_like = essence.starts_with(b"text/")
        || matches!(
            essence,
            b"application/javascript"
                | b"application/x-javascript"
                | b"application/ecmascript"
                | b"application/xml"
        );

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
    let total = prefix.len() + content_type.len() + mid.len() + encoded_len;
    let buf: &mut [u8] = bump.alloc_slice_fill_copy(total, 0u8);
    let mut i = 0usize;
    buf[i..i + prefix.len()].copy_from_slice(prefix);
    i += prefix.len();
    buf[i..i + content_type.len()].copy_from_slice(content_type);
    i += content_type.len();
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
