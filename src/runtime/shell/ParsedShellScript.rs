use core::mem::size_of;
use core::sync::atomic::Ordering;

use bun_jsc::{
    CallFrame, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsRef,
    JsResult, MarkedArgumentBuffer, StringJsc as _,
};
use bun_str::String as BunString;

use super::interpreter::ShellArgs;
use super::shell_body::{shell_cmd_from_js, JsStrings};
use super::{EnvMap, EnvStr, Interpreter};

// NOTE: `pub const js = jsc.Codegen.JSParsedShellScript;` and the
// `toJS`/`fromJS`/`fromJSDirect` re-exports are provided by the
// `#[bun_jsc::JsClass]` derive in Rust — do not hand-port them.

#[bun_jsc::JsClass(no_constructor)]
pub struct ParsedShellScript {
    pub args: Option<Box<ShellArgs>>,
    /// allocated with arena in jsobjs
    // PORT NOTE: in Zig this Vec's backing storage lives in `args.arena` (self-referential
    // with the `args` field). Phase A uses a global-alloc Vec; revisit if profiling shows
    // the extra alloc matters. JSValues here are GC-rooted via `toJSWithValues` codegen
    // (own: array on the C++ wrapper), so storing them on the Rust heap is sound.
    pub jsobjs: Vec<JSValue>,
    pub export_env: Option<EnvMap>,
    pub quiet: bool,
    pub cwd: Option<BunString>,
    /// Self-wrapper backref. `.classes.ts` has `finalize: true`, so the weak arm is
    /// sound: codegen calls `finalize()` which flips this to `.Finalized` before sweep.
    pub this_jsvalue: JsRef,
    pub estimated_size_for_gc: usize,
}

impl Default for ParsedShellScript {
    fn default() -> Self {
        Self {
            args: None,
            jsobjs: Vec::new(),
            export_env: None,
            quiet: false,
            cwd: None,
            this_jsvalue: JsRef::empty(),
            estimated_size_for_gc: 0,
        }
    }
}

impl ParsedShellScript {
    fn compute_estimated_size_for_gc(&self) -> usize {
        let mut size: usize = size_of::<ParsedShellScript>();
        if let Some(args) = &self.args {
            size += args.memory_cost();
        }
        if let Some(env) = &self.export_env {
            size += env.memory_cost();
        }
        if let Some(cwd) = &self.cwd {
            size += cwd.estimated_size();
        }
        size += self.jsobjs.capacity() * size_of::<JSValue>();
        size
    }

    pub fn memory_cost(&self) -> usize {
        self.compute_estimated_size_for_gc()
    }

    pub fn estimated_size(&self) -> usize {
        self.estimated_size_for_gc
    }

    // PORT NOTE: reshaped from 5 out-params to a returned tuple; Zig used out-params
    // because the caller pre-declares slots. Rust callers destructure the tuple.
    pub fn take(
        &mut self,
        _global: &JSGlobalObject,
    ) -> (
        Box<ShellArgs>,
        Vec<JSValue>,
        bool,
        Option<BunString>,
        Option<EnvMap>,
    ) {
        let args = self.args.take().expect("args already taken");
        let jsobjs = core::mem::take(&mut self.jsobjs);
        let quiet = self.quiet;
        let cwd = self.cwd.take();
        let export_env = self.export_env.take();
        (args, jsobjs, quiet, cwd, export_env)
    }

    /// Called from the generated C++ wrapper's `finalize()`. Runs on the mutator
    /// thread during lazy sweep — must not touch live JS cells.
    pub fn finalize(this: *mut ParsedShellScript) {
        // SAFETY: `this` was produced by `heap::alloc` in `create_parsed_shell_script_impl`
        // and is uniquely owned by the JS wrapper that is now being finalized.
        let mut this = unsafe { bun_core::heap::take(this) };
        // Per PORTING.md §JSC: flip the self-wrapper ref to `.Finalized` first; other
        // cells may already be swept so the weak JSValue must not be touched again.
        this.this_jsvalue.finalize();
        // `export_env`/`args` have `Drop` impls; `cwd: Option<BunString>` does not
        // (`bun.String` is `Copy` for FFI), so deref it explicitly.
        if let Some(cwd) = this.cwd.as_ref() {
            cwd.deref();
        }
        drop(this);
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_cwd(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` is non-null for a Bun-owned global.
        let vm = global.bun_vm();
        let mut arguments = bun_jsc::ArgumentsSlice::init(vm, arguments.slice());
        let Some(str_js) = arguments.next_eat() else {
            return Err(global.throw(format_args!("$`...`.cwd(): expected a string argument")));
        };
        let str = BunString::from_js(str_js, global)?;
        if let Some(prev) = self.cwd.as_ref() {
            prev.deref();
        }
        self.cwd = Some(str);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_quiet(
        &mut self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arg = callframe.argument(0);
        self.quiet = arg.to_boolean();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_env(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let Some(value1) = callframe.argument(0).get_object() else {
            return Err(global.throw_invalid_arguments(format_args!("env must be an object")));
        };

        let mut object_iter = JSPropertyIterator::init(
            global,
            value1,
            JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
                ..Default::default()
            },
        )?;
        // `defer object_iter.deinit()` — handled by Drop.

        let mut env = EnvMap::init();
        // errdefer env.deinit() — Drop on early-return handles this.
        env.ensure_total_capacity(object_iter.len);

        // If the env object does not include a $PATH, it must disable path lookup for argv[0]
        // PATH = "";

        while let Some(key) = object_iter.next()? {
            let value = object_iter.value;
            if value.is_undefined() {
                continue;
            }

            let keyslice = key.to_owned_slice();
            // errdefer free(keyslice) — Drop on early-return handles this.
            let value_str = value.get_zig_string(global)?;
            // `ZigString::to_owned_slice` is infallible in the Rust port (global alloc
            // aborts on OOM); Zig wrapped in `bun.handleOom`.
            let slice = value_str.to_owned_slice();
            let keyref = EnvStr::init_ref_counted(&keyslice);
            // defer keyref.deref() — done below (insert refs again).
            let valueref = EnvStr::init_ref_counted(&slice);
            // defer valueref.deref() — done below.

            env.insert(keyref, valueref);
            keyref.deref();
            valueref.deref();
        }
        // Dropping the previous Option<EnvMap> deinits it.
        self.export_env = Some(env);
        Ok(JSValue::UNDEFINED)
    }
}

/// `jsc.MarkedArgumentBuffer.wrap` generates a host-fn shim that allocates a
/// `MarkedArgumentBuffer` on the C++ stack and forwards to the impl.
pub const CREATE_PARSED_SHELL_SCRIPT: bun_jsc::JSHostFnZig =
    bun_jsc::marked_argument_buffer_wrap!(create_parsed_shell_script_impl);

// `jsc.Codegen.JSParsedShellScript.toJSWithValues` — generated by
// `generate-classes.ts` (`${T}__createWithValues`). Takes ownership of the
// boxed payload (via `heap::alloc`) and roots `marked_argument_buffer` values
// on the C++ wrapper's `m_values` array.
//
// `ptr` is `void*` on the C++ side; declaring it as such here (rather than
// `*mut ParsedShellScript`) matches the ABI exactly and avoids the
// `improper_ctypes` lint on a non-`#[repr(C)]` payload struct.
#[cfg(all(windows, target_arch = "x86_64"))]
unsafe extern "sysv64" {
    #[link_name = "ParsedShellScript__createWithValues"]
    fn ParsedShellScript__createWithValues(
        global: *mut JSGlobalObject,
        ptr: *mut core::ffi::c_void,
        marked_argument_buffer: *mut core::ffi::c_void,
    ) -> JSValue;
}
#[cfg(not(all(windows, target_arch = "x86_64")))]
unsafe extern "C" {
    #[link_name = "ParsedShellScript__createWithValues"]
    fn ParsedShellScript__createWithValues(
        global: *mut JSGlobalObject,
        ptr: *mut core::ffi::c_void,
        marked_argument_buffer: *mut core::ffi::c_void,
    ) -> JSValue;
}

fn create_parsed_shell_script_impl(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<JSValue> {
    // Zig: `defer if (needs_to_free_shargs) shargs.deinit()` — semantically `errdefer` on an
    // owned local. Box<ShellArgs> drops automatically on every early `return`/`?` below, so
    // no scopeguard is needed (PORTING.md: errdefer-on-owned-local → delete).
    let mut shargs: Box<ShellArgs> = ShellArgs::init();

    let arguments_ = callframe.arguments_old::<2>();
    let arguments = arguments_.slice();
    if arguments.len() < 2 {
        return Err(global.throw_not_enough_arguments("Bun.$", 2, arguments.len()));
    }
    let string_args = arguments[0];
    let template_args_js = arguments[1];
    let mut template_args = template_args_js.array_iterator(global)?;

    // PERF(port): was std.heap.stackFallback(@sizeOf(bun.String) * 4, arena) — profile in Phase B
    // Zig: `defer { for jsstrings |s| s.deref(); jsstrings.deinit() }` — handled by
    // `JsStrings`'s `Drop` (per-element `bun.String::deref()` then Vec free).
    let mut jsstrings = JsStrings::with_capacity(4);

    // PORT NOTE: in Zig `jsobjs` and `script` are allocated from `shargs.arena_allocator()`.
    // Shell is an AST crate (arena-backed); Phase A uses global Vec to sidestep the
    // self-referential borrow against `shargs` (it later moves into `ParsedShellScript`).
    let mut jsobjs: Vec<JSValue> = Vec::new();
    let mut script: Vec<u8> = Vec::new();
    shell_cmd_from_js(
        global,
        string_args,
        &mut template_args,
        &mut jsobjs,
        &mut jsstrings,
        &mut script,
        marked_argument_buffer,
    )?;

    // PORT NOTE: reshaped for borrowck — `out_parser`/`out_lex_result` borrow
    // `shargs.__arena`, so they're scoped to a block that ends before
    // `shargs.script_ast = script` below. The arena reference is taken via raw
    // pointer so the `&shargs` borrow doesn't outlive the call (the returned
    // `ast::Script` is lifetime-erased).
    let arena_ptr: *const bun_alloc::Arena = shargs.arena();
    let script_ast = {
        // SAFETY: `shargs` lives on this stack frame for the whole block; arena
        // is not moved/dropped while `out_parser`/`out_lex_result` borrow it.
        let arena = unsafe { &*arena_ptr };
        let mut out_parser: Option<bun_shell_parser::Parser<'_>> = None;
        let mut out_lex_result: Option<bun_shell_parser::LexResult<'_>> = None;
        match Interpreter::parse(
            arena,
            &script[..],
            &mut jsobjs[..],
            &mut jsstrings[..],
            &mut out_parser,
            &mut out_lex_result,
        ) {
            Ok(ast) => ast,
            Err(err) => {
                // `out_lex_result.is_some()` ⇔ `err == ParseError::Lex` — `Interpreter::parse`
                // only populates `out_lex_result` on the Lex error path.
                if let Some(lex) = out_lex_result.as_ref() {
                    debug_assert!(!lex.errors.is_empty());
                    let str = lex.combine_errors(arena);
                    return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(str))));
                }

                if let Some(p) = out_parser.as_mut() {
                    debug_assert!(!p.errors.is_empty());
                    let errstr = p.combine_errors();
                    return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(errstr))));
                }

                return Err(global.throw_error(err, "failed to lex/parse shell"));
            }
        }
    };

    shargs.set_script_ast(script_ast);

    let mut parsed_shell_script = Box::new(ParsedShellScript {
        args: Some(shargs),
        jsobjs,
        ..Default::default()
    });
    parsed_shell_script.estimated_size_for_gc = parsed_shell_script.compute_estimated_size_for_gc();
    let parsed_shell_script_ptr = bun_core::heap::leak(parsed_shell_script);
    // SAFETY: `parsed_shell_script_ptr` is a fresh `heap::alloc`; ownership
    // transfers to the C++ wrapper. `marked_argument_buffer` is the live
    // stack-allocated buffer C++ handed us via `MarkedArgumentBuffer::run`.
    let this_jsvalue = unsafe {
        ParsedShellScript__createWithValues(
            global.as_mut_ptr(),
            parsed_shell_script_ptr.cast::<core::ffi::c_void>(),
            std::ptr::from_mut::<MarkedArgumentBuffer>(marked_argument_buffer).cast::<core::ffi::c_void>(),
        )
    };
    // SAFETY: pointer just created above; wrapper now owns it but we need one more field write.
    unsafe { (*parsed_shell_script_ptr).this_jsvalue = JsRef::init_weak(this_jsvalue) };

    bun_analytics::features::shell.fetch_add(1, Ordering::Relaxed);
    Ok(this_jsvalue)
}

// ported from: src/shell/ParsedShellScript.zig
