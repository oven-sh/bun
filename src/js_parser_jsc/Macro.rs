use core::cell::{Cell, RefCell};
use core::ffi::c_void;

use bun_collections::{ArrayHashMap, HashMap};
use bun_core::{err, Error, Output};
use bun_jsc::{
    self as jsc, c as js, ConsoleObject, JSArrayIterator, JSGlobalObject, JSPropertyIterator,
    JSValue, JsError, MarkedArgumentBuffer, ModuleLoader, VirtualMachine, WebCore, ZigException,
};
use bun_js_parser::{
    self as js_ast, Expr, ExprNodeList, Stmt, ToJSError, E, G, S,
};
use bun_logger::{self as logger, Log, Range, Source};
use bun_resolver::package_json::{MacroImportReplacementMap as MacroRemapEntry, MacroMap as MacroRemap};
use bun_resolver::resolver::{Resolver, Result as ResolveResult};
use bun_dotenv::Loader as DotEnvLoader;
use bun_bundler::{entry_points::MacroEntryPoint, Transpiler};
use bun_http::MimeType;
use bun_runtime::api::{BuildMessage, ResolveMessage};
use bun_str::strings;

pub const NAMESPACE: &[u8] = b"macro";
pub const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

pub fn is_macro_path(str: &[u8]) -> bool {
    strings::has_prefix(str, NAMESPACE_WITH_COLON)
}

pub struct MacroContext<'a> {
    pub resolver: &'a mut Resolver,
    pub env: &'a mut DotEnvLoader,
    pub macros: MacroMap<'a>,
    pub remap: MacroRemap,
    pub javascript_object: JSValue,
}

pub type MacroMap<'a> = ArrayHashMap<i32, Macro<'a>>;

impl<'a> MacroContext<'a> {
    pub fn get_remap(&self, path: &[u8]) -> Option<MacroRemapEntry> {
        if self.remap.entries.len() == 0 {
            return None;
        }
        self.remap.get(path)
    }

    pub fn init(transpiler: &'a mut Transpiler) -> MacroContext<'a> {
        MacroContext {
            macros: MacroMap::new(),
            resolver: &mut transpiler.resolver,
            env: transpiler.env,
            remap: transpiler.options.macro_remap,
            javascript_object: JSValue::ZERO,
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
        Expr::Data::Store::set_disable_reset(true);
        Stmt::Data::Store::set_disable_reset(true);
        let _reset_guard = scopeguard::guard((), |_| {
            Expr::Data::Store::set_disable_reset(false);
            Stmt::Data::Store::set_disable_reset(false);
        });
        // const is_package_path = isPackagePath(specifier);
        let import_record_path_without_macro_prefix = if is_macro_path(import_record_path) {
            &import_record_path[NAMESPACE_WITH_COLON.len()..]
        } else {
            import_record_path
        };

        debug_assert!(!is_macro_path(import_record_path_without_macro_prefix));

        let input_specifier: &[u8] = 'brk: {
            if let Some(replacement) =
                ModuleLoader::HardcodedModule::Alias::get(import_record_path, jsc::Target::Bun, Default::default())
            {
                break 'brk replacement.path;
            }

            let resolve_result = match self.resolver.resolve(
                source_dir,
                import_record_path_without_macro_prefix,
                bun_options_types::ImportKind::Stmt,
            ) {
                Ok(r) => r,
                Err(e) if e == err!("ModuleNotFound") => {
                    log.add_resolve_error(
                        source,
                        import_range,
                        format_args!("Macro \"{}\" not found", bstr::BStr::new(import_record_path)),
                        bun_options_types::ImportKind::Stmt,
                        e,
                    )
                    .expect("unreachable");
                    return Err(err!("MacroNotFound"));
                }
                Err(e) => {
                    log.add_range_error_fmt(
                        source,
                        import_range,
                        format_args!(
                            "{} resolving macro \"{}\"",
                            e.name(),
                            bstr::BStr::new(import_record_path)
                        ),
                    )
                    .expect("unreachable");
                    return Err(e);
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

        let macro_entry = self.macros.get_or_put(hash).expect("unreachable");
        if !macro_entry.found_existing {
            *macro_entry.value_ptr = match Macro::init(
                self.resolver,
                input_specifier,
                log,
                self.env,
                function_name,
                &specifier_buf[0..specifier_buf_len as usize],
                hash,
            ) {
                Ok(m) => m,
                Err(e) => {
                    // TODO(port): Zig stores `Macro{ .resolver = undefined, .disabled = true }`
                    // here as a sentinel; with `&'a mut Resolver` we cannot leave it undefined.
                    // Phase B should make resolver/vm Option<> or split into enum { Disabled, Loaded(..) }.
                    *macro_entry.value_ptr = Macro::disabled_sentinel();
                    return Err(e);
                }
            };
            Output::flush();
        }
        let _flush_guard = scopeguard::guard((), |_| Output::flush());

        // PORT NOTE: reshaped for borrowck — Zig copies the Macro by value out of the map.
        let macro_ = *macro_entry.value_ptr;
        if macro_.disabled {
            return Ok(caller);
        }
        macro_.vm.enable_macro_mode();
        let _mode_guard = scopeguard::guard((), |_| macro_.vm.disable_macro_mode());
        macro_.vm.event_loop().ensure_waker();

        // TODO(port): Zig builds a `Wrapper { args: ArgsTuple, ret }` and calls
        // `vm.runWithAPILock(Wrapper, &wrapper, Wrapper.call)`. Model this as a
        // closure passed to `run_with_api_lock` once that API is ported.
        struct Wrapper<'w> {
            macro_: Macro<'w>,
            log: &'w mut Log,
            function_name: &'w [u8],
            caller: Expr,
            source: &'w Source,
            hash: i32,
            javascript_object: JSValue,
            ret: Result<Expr, MacroError>,
        }
        impl<'w> Wrapper<'w> {
            fn call(&mut self) {
                self.ret = Runner::run(
                    self.macro_,
                    self.log,
                    self.function_name,
                    self.caller,
                    self.source,
                    self.hash,
                    self.javascript_object,
                );
            }
        }
        let mut wrapper = Wrapper {
            macro_,
            log,
            function_name,
            caller,
            source,
            hash,
            javascript_object: self.javascript_object,
            // TODO(port): Zig leaves `ret` undefined; using a placeholder Err here.
            ret: Err(MacroError::MacroFailed),
        };

        macro_.vm.run_with_api_lock(&mut wrapper, Wrapper::call);
        Ok(wrapper.ret?)
        // this.macros.getOrPut(key: K)
    }
}

#[derive(Default)]
pub struct MacroResult {
    pub import_statements: Box<[S::Import]>,
    pub replacement: Expr,
}

pub struct Macro<'a> {
    pub resolver: &'a mut Resolver,
    pub vm: &'static VirtualMachine,

    pub resolved: ResolveResult,
    pub disabled: bool,
}

impl<'a> Macro<'a> {
    // TODO(port): see note in MacroContext::call — Zig uses an undefined-resolver sentinel.
    fn disabled_sentinel() -> Self {
        // Null `&mut Resolver` / `&'static VirtualMachine` are immediate UB in Rust regardless
        // of whether they are dereferenced, so `core::mem::zeroed()` is not an option here.
        todo!("port: disabled sentinel — restructure resolver/vm as Option<NonNull<_>> or enum {{ Disabled, Loaded(..) }}")
    }

    pub fn init(
        // allocator param deleted — always default_allocator
        resolver: &'a mut Resolver,
        input_specifier: &[u8],
        log: &mut Log,
        env: &mut DotEnvLoader,
        function_name: &[u8],
        specifier: &[u8],
        hash: i32,
    ) -> Result<Macro<'a>, Error> {
        // TODO(port): narrow error set
        let vm: &'static VirtualMachine = if VirtualMachine::is_loaded() {
            VirtualMachine::get()
        } else {
            'brk: {
                let old_transform_options = resolver.opts.transform_options;
                let _restore = scopeguard::guard((), |_| {
                    resolver.opts.transform_options = old_transform_options;
                });

                // JSC needs to be initialized if building from CLI
                jsc::initialize(false);

                let _vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
                    args: resolver.opts.transform_options,
                    log,
                    is_main_thread: false,
                    env_loader: env,
                    ..Default::default()
                })?;

                _vm.enable_macro_mode();
                _vm.event_loop().ensure_waker();

                _vm.transpiler.configure_defines()?;
                break 'brk _vm;
            }
        };

        vm.enable_macro_mode();
        vm.event_loop().ensure_waker();

        let loaded_result = vm.load_macro_entry_point(input_specifier, function_name, specifier, hash)?;

        match loaded_result.unwrap(vm.jsc_vm, jsc::PromiseUnwrapMode::LeaveUnhandled) {
            jsc::PromiseResult::Rejected(result) => {
                vm.unhandled_rejection(vm.global, result, loaded_result.to_js());
                vm.disable_macro_mode();
                return Err(err!("MacroLoadError"));
            }
            _ => {}
        }

        Ok(Macro {
            vm,
            resolver,
            resolved: ResolveResult::default(), // TODO(port): Zig leaves `resolved` undefined
            disabled: false,
        })
    }
}

pub struct Runner;

type VisitMap = HashMap<JSValue, Expr>;

thread_local! {
    static ARGS_BUF: RefCell<[js::JSObjectRef; 3]> =
        const { RefCell::new([core::ptr::null_mut(); 3]) };
    static EXCEPTION_HOLDER: RefCell<ZigException::Holder> =
        const { RefCell::new(ZigException::Holder::ZEROED) };
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum MacroError {
    #[error("MacroFailed")]
    MacroFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error(transparent)]
    ToJs(#[from] ToJSError),
    #[error(transparent)]
    Js(#[from] JsError),
}

impl From<bun_alloc::AllocError> for MacroError {
    fn from(_: bun_alloc::AllocError) -> Self {
        MacroError::OutOfMemory
    }
}

impl From<MacroError> for Error {
    fn from(e: MacroError) -> Self {
        match e {
            MacroError::MacroFailed => err!("MacroFailed"),
            MacroError::OutOfMemory => err!("OutOfMemory"),
            MacroError::ToJs(e) => e.into(),
            MacroError::Js(e) => e.into(),
        }
    }
}

pub struct Run<'a> {
    pub caller: Expr,
    pub function_name: &'a [u8],
    pub macro_: &'a Macro<'a>,
    pub global: &'a JSGlobalObject,
    // allocator field deleted — always default_allocator
    pub id: i32,
    pub log: &'a mut Log,
    pub source: &'a Source,
    pub visited: VisitMap,
    pub is_top_level: bool,
}

impl<'a> Run<'a> {
    pub fn run_async(
        macro_: Macro<'a>,
        log: &'a mut Log,
        function_name: &'a [u8],
        caller: Expr,
        args: &mut MarkedArgumentBuffer,
        source: &'a Source,
        id: i32,
    ) -> Result<Expr, MacroError> {
        let Some(macro_callback) = macro_.vm.macros.get(id) else {
            return Ok(caller);
        };

        let result = unsafe {
            // SAFETY: MarkedArgumentBuffer stores contiguous JSValue (#[repr(transparent)] i64);
            // JSObjectRef is the C API handle for the same encoded value.
            js::JSObjectCallAsFunctionReturnValueHoldingAPILock(
                macro_.vm.global,
                macro_callback,
                core::ptr::null_mut(),
                args.len(),
                args.as_ptr().cast::<js::JSObjectRef>(),
            )
        };

        let mut runner = Run {
            caller,
            function_name,
            macro_: &macro_,
            global: macro_.vm.global,
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
        use ConsoleObject::Formatter::Tag as T;
        match ConsoleObject::Formatter::Tag::get(value, self.global)?.tag {
            T::Error => self.coerce::<{ T::Error }>(value),
            T::Undefined => self.coerce::<{ T::Undefined }>(value),
            T::Null => self.coerce::<{ T::Null }>(value),
            T::Private => self.coerce::<{ T::Private }>(value),
            T::Boolean => self.coerce::<{ T::Boolean }>(value),
            T::Array => self.coerce::<{ T::Array }>(value),
            T::Object => self.coerce::<{ T::Object }>(value),
            T::ToJSON | T::JSON => self.coerce::<{ T::JSON }>(value),
            T::Integer => self.coerce::<{ T::Integer }>(value),
            T::Double => self.coerce::<{ T::Double }>(value),
            T::String => self.coerce::<{ T::String }>(value),
            T::Promise => self.coerce::<{ T::Promise }>(value),
            _ => {
                let name = value.get_class_info_name().unwrap_or(b"unknown");

                self.log
                    .add_error_fmt(
                        self.source,
                        self.caller.loc,
                        format_args!(
                            "cannot coerce {} ({}) to Bun's AST. Please return a simpler type",
                            bstr::BStr::new(name),
                            <&'static str>::from(value.js_type()),
                        ),
                    )
                    .expect("unreachable");
                Err(MacroError::MacroFailed)
            }
        }
    }

    // TODO(port): `ConsoleObject::Formatter::Tag` must derive `core::marker::ConstParamTy`
    // for this const-generic dispatch to compile. Phase B may instead inline each arm
    // into `run` and drop the const generic.
    pub fn coerce<const TAG: ConsoleObject::Formatter::Tag>(
        &mut self,
        value: JSValue,
    ) -> Result<Expr, MacroError> {
        use ConsoleObject::Formatter::Tag as T;
        match TAG {
            T::Error => {
                let _ = self.macro_.vm.uncaught_exception(self.global, value, false);
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

                let mut blob_: Option<&WebCore::Blob> = None;
                let mime_type: Option<MimeType> = None;

                if value.js_type() == jsc::JSType::DOMWrapper {
                    if let Some(resp) = value.as_::<WebCore::Response>() {
                        return self.run(resp.get_blob_without_call_frame(self.global)?);
                    } else if let Some(resp) = value.as_::<WebCore::Request>() {
                        return self.run(resp.get_blob_without_call_frame(self.global)?);
                    } else if let Some(resp) = value.as_::<WebCore::Blob>() {
                        blob_ = Some(resp);
                    } else if value.as_::<ResolveMessage>().is_some()
                        || value.as_::<BuildMessage>().is_some()
                    {
                        let _ = self.macro_.vm.uncaught_exception(self.global, value, false);
                        return Err(MacroError::MacroFailed);
                    }
                }

                if let Some(blob) = blob_ {
                    return Expr::from_blob(blob, mime_type, self.log, self.caller.loc)
                        .map_err(|_| MacroError::MacroFailed);
                }

                return Ok(Expr::init(E::String::empty(), self.caller.loc));
            }

            T::Boolean => {
                return Ok(Expr {
                    data: js_ast::ExprData::EBoolean(E::Boolean { value: value.to_boolean() }),
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
                let mut array: Vec<Expr> = Vec::with_capacity(iter.len);
                // PERF(port): was allocator.alloc(Expr, iter.len) — profile in Phase B
                // (errdefer free deleted — Vec drops on `?`)
                let expr = Expr::init(
                    E::Array { items: ExprNodeList::empty(), was_originally_macro: true },
                    self.caller.loc,
                );
                *_entry.value_ptr = expr;
                let mut i: usize = 0;
                while let Some(item) = iter.next()? {
                    let elem = self.run(item)?;
                    if elem.is_missing() {
                        continue;
                    }
                    array.push(elem);
                    i += 1;
                }

                expr.data.e_array().items = ExprNodeList::from_owned_slice(array.into_boxed_slice());
                expr.data.e_array().items.len = i as u32;
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
                    E::Object { properties: G::Property::List::default(), was_originally_macro: true },
                    self.caller.loc,
                );
                *_entry.value_ptr = expr;

                // SAFETY: tag ensures `value` is an object.
                let obj = value.get_object().expect("unreachable");
                let mut object_iter = JSPropertyIterator::<{ jsc::PropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                } }>::init(self.global, obj)?;
                // `object_iter` dropped at scope exit (was `defer object_iter.deinit()`)

                // Build properties list
                let mut properties = G::Property::List::with_capacity(object_iter.len);
                // (errdefer clearAndFree deleted — drops on `?`)

                while let Some(prop) = object_iter.next()? {
                    let object_value = self.run(object_iter.value)?;

                    properties.push(G::Property {
                        key: Some(Expr::init(
                            E::String::init(prop.to_owned_slice().expect("unreachable")),
                            self.caller.loc,
                        )),
                        value: Some(object_value),
                        ..Default::default()
                    });
                }

                expr.data.e_object().properties = properties;

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
                    E::Number { value: value.to_int32() as f64 },
                    self.caller.loc,
                ));
            }
            T::Double => {
                return Ok(Expr::init(
                    E::Number { value: value.as_number() },
                    self.caller.loc,
                ));
            }
            T::String => {
                let bun_str = value.to_bun_string(self.global)?;
                // `bun_str.deref()` on Drop

                // encode into utf16 so the printer escapes the string correctly
                let mut utf16_bytes: Vec<u16> = vec![0u16; bun_str.length()];
                // PERF(port): was allocator.alloc(u16, len) — profile in Phase B
                let encoded_bytes = bun_str
                    .encode_into(bytemuck::cast_slice_mut(&mut utf16_bytes), bun_str::Encoding::Utf16Le)
                    .unwrap_or(0);
                utf16_bytes.truncate(encoded_bytes / 2);
                return Ok(Expr::init(
                    E::String::init_utf16(utf16_bytes.into_boxed_slice()),
                    self.caller.loc,
                ));
            }
            T::Promise => {
                if let Some(cached) = self.visited.get(&value) {
                    return Ok(*cached);
                }

                let promise = value
                    .as_any_promise()
                    .expect("Unexpected promise type");

                self.macro_.vm.wait_for_promise(promise);

                let promise_result = promise.result(self.macro_.vm.jsc_vm);
                let rejected = promise.status() == jsc::PromiseStatus::Rejected;

                if promise_result.is_undefined() && self.is_top_level {
                    self.is_top_level = false;
                    return Ok(self.caller);
                }

                if rejected
                    || promise_result.is_error()
                    || promise_result.is_aggregate_error(self.global)
                    || promise_result.is_exception(self.global.vm())
                {
                    self.macro_
                        .vm
                        .unhandled_rejection(self.global, promise_result, promise.as_value());
                    return Err(MacroError::MacroFailed);
                }
                self.is_top_level = false;
                let result = self.run(promise_result)?;

                self.visited.insert(value, result);
                return Ok(result);
            }
            _ => {}
        }

        self.log
            .add_error_fmt(
                self.source,
                self.caller.loc,
                format_args!(
                    "cannot coerce {} to Bun's AST. Please return a simpler type",
                    <&'static str>::from(value.js_type()),
                ),
            )
            .expect("unreachable");
        Err(MacroError::MacroFailed)
    }
}

impl Runner {
    pub fn run(
        macro_: Macro<'_>,
        log: &mut Log,
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

        EXCEPTION_HOLDER.with_borrow_mut(|h| *h = ZigException::Holder::init());
        // PORT NOTE: Zig used a heap `[]JSValue` + manual protect()/unprotect() to keep
        // arguments alive across `to_js` calls. In Rust we use MarkedArgumentBuffer, which
        // is registered with the VM as a GC root, so the protect/unprotect/free dance is
        // subsumed by its Drop. Do NOT use Vec<JSValue> here — heap storage is not stack-scanned.
        let mut js_args = MarkedArgumentBuffer::new();

        let global_object = VirtualMachine::get().global;

        match &caller.data {
            js_ast::ExprData::ECall(call) => {
                let call_args: &[Expr] = call.args.slice();
                for in_ in call_args {
                    let value = in_.to_js(global_object)?;
                    js_args.append(value);
                }
            }
            js_ast::ExprData::ETemplate(_) => {
                todo!("support template literals in macros");
            }
            _ => {
                panic!("Unexpected caller type");
            }
        }

        if !javascript_object.is_empty() {
            js_args.append(javascript_object);
        }

        // TODO(port): Zig stashes the call args + result in threadlocals so the
        // `extern "C" fn()` trampoline (no userdata) can reach them, then calls
        // `Bun__startMacro(&call, global)`. Threadlocal `Result<Expr, MacroError>`
        // and borrowed args don't fit `Cell`/`RefCell` cleanly; Phase B should
        // either (a) change Bun__startMacro to take a `*mut c_void` userdata, or
        // (b) box the state and round-trip through a threadlocal `*mut c_void`.
        thread_local! {
            static CALL_STATE: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
        }

        struct CallData<'c> {
            macro_: Macro<'c>,
            log: &'c mut Log,
            function_name: &'c [u8],
            caller: Expr,
            js_args: &'c mut MarkedArgumentBuffer,
            source: &'c Source,
            id: i32,
            result: Result<Expr, MacroError>,
        }

        extern "C" fn call() {
            CALL_STATE.with(|s| {
                let state = unsafe {
                    // SAFETY: set immediately before Bun__startMacro below; cleared after.
                    &mut *(s.get() as *mut CallData<'_>)
                };
                state.result = Run::run_async(
                    state.macro_,
                    state.log,
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
            function_name,
            caller,
            js_args: &mut js_args,
            source,
            id,
            result: Err(MacroError::MacroFailed),
        };

        jsc::mark_binding(core::panic::Location::caller());
        CALL_STATE.with(|s| s.set(&mut data as *mut _ as *mut c_void));
        unsafe {
            // SAFETY: `call` only reads CALL_STATE which we just set; global is valid.
            Bun__startMacro(
                call as *const c_void,
                VirtualMachine::get().global as *const _ as *mut c_void,
            );
        }
        CALL_STATE.with(|s| s.set(core::ptr::null_mut()));
        data.result
    }
}

// TODO(port): move to js_parser_jsc_sys
unsafe extern "C" {
    fn Bun__startMacro(function: *const c_void, global: *mut c_void);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser_jsc/Macro.zig (642 lines)
//   confidence: low
//   todos:      9
//   notes:      Macro disabled-sentinel needs Option<>/enum restructure (currently todo!()); CallData threadlocal trampoline reshaped to *mut c_void; const-generic Tag needs ConstParamTy; heavy borrowck reshaping expected in Phase B.
// ──────────────────────────────────────────────────────────────────────────
