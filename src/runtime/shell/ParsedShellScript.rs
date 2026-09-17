use core::cell::Cell;
use core::mem::size_of;
use core::sync::atomic::Ordering;

use bun_core::String as BunString;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsCell,
    JsRef, JsResult, MarkedArgumentBuffer, StringJsc as _,
};

use super::env_map::EnvMap;
use super::interpreter::ShellArgs;
use super::shell_body::shell_cmd_from_js;
use super::{EnvStr, Interpreter};

// NOTE: `pub const js = jsc.Codegen.JSParsedShellScript;` and the
// `toJS`/`fromJS`/`fromJSDirect` re-exports are provided by the
// `#[bun_jsc::JsClass]` derive in Rust — do not hand-port them.

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
#[bun_jsc::JsClass(no_constructor)]
pub struct ParsedShellScript {
    pub args: JsCell<Option<Box<ShellArgs>>>,
    // Uses a global-alloc Vec; revisit if profiling shows
    // the extra alloc matters. JSValues here are GC-rooted via `toJSWithValues` codegen
    // (own: array on the C++ wrapper), so storing them on the Rust heap is sound.
    pub(crate) jsobjs: JsCell<Vec<JSValue>>,
    pub(crate) export_env: JsCell<Option<EnvMap>>,
    pub(crate) quiet: Cell<bool>,
    pub(crate) cwd: JsCell<Option<BunString>>,
    /// Self-wrapper backref. `.classes.ts` has `finalize: true`, so the weak arm is
    /// sound: the codegen finalizer drops this Box (and the `JsRef`) at sweep.
    /// Read-only after construction.
    pub(crate) this_jsvalue: JsRef,
    /// Read-only after construction (set once before the JS wrapper exists).
    pub(crate) estimated_size_for_gc: usize,
}

impl Default for ParsedShellScript {
    fn default() -> Self {
        Self {
            args: JsCell::new(None),
            jsobjs: JsCell::new(Vec::new()),
            export_env: JsCell::new(None),
            quiet: Cell::new(false),
            cwd: JsCell::new(None),
            this_jsvalue: JsRef::empty(),
            estimated_size_for_gc: 0,
        }
    }
}

impl ParsedShellScript {
    fn compute_estimated_size_for_gc(&self) -> usize {
        let mut size: usize = size_of::<ParsedShellScript>();
        if let Some(args) = self.args.get() {
            size += args.memory_cost();
        }
        if let Some(env) = self.export_env.get() {
            size += env.memory_cost();
        }
        if let Some(cwd) = self.cwd.get() {
            size += cwd.estimated_size();
        }
        size += self.jsobjs.get().capacity() * size_of::<JSValue>();
        size
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.compute_estimated_size_for_gc()
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.estimated_size_for_gc
    }

    // Returns a tuple; callers destructure it.
    pub(crate) fn take(
        &self,
        _global: &JSGlobalObject,
    ) -> (
        Box<ShellArgs>,
        Vec<JSValue>,
        bool,
        Option<BunString>,
        Option<EnvMap>,
    ) {
        let args = self.args.replace(None).expect("args already taken");
        let jsobjs = self.jsobjs.replace(Vec::new());
        let quiet = self.quiet.get();
        let cwd = self.cwd.replace(None);
        let export_env = self.export_env.replace(None);
        (args, jsobjs, quiet, cwd, export_env)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_cwd(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: `bun_vm()` is non-null for a Bun-owned global.
        let vm = global.bun_vm();
        let mut arguments = bun_jsc::ArgumentsSlice::init(vm, callframe.arguments());
        let Some(str_js) = arguments.next_eat() else {
            return Err(global.throw(format_args!("$`...`.cwd(): expected a string argument")));
        };
        let str = BunString::from_js(str_js, global)?;
        self.cwd.set(Some(str));
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_quiet(
        &self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arg = callframe.argument(0);
        self.quiet.set(arg.to_boolean());
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_env(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(value1) = callframe.argument(0).get_object() else {
            return Err(global.throw_invalid_arguments(format_args!("env must be an object")));
        };

        let object_iter = JSPropertyIterator::init(
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

        while let Some((key, value)) = object_iter.next()? {
            if value.is_undefined() {
                continue;
            }

            let keyslice = key.to_owned_slice();
            // errdefer free(keyslice) — Drop on early-return handles this.
            let slice = value.to_bun_string(global)?.to_owned_slice();
            let keyref = EnvStr::init_ref_counted(keyslice.into_boxed_slice());
            let valueref = EnvStr::init_ref_counted(slice.into_boxed_slice());

            env.insert(keyref, valueref);
            keyref.deref();
            valueref.deref();
        }
        // Dropping the previous Option<EnvMap> deinits it.
        self.export_env.set(Some(env));
        Ok(JSValue::UNDEFINED)
    }
}

/// `jsc.MarkedArgumentBuffer.wrap` generates a host-fn shim that allocates a
/// `MarkedArgumentBuffer` on the C++ stack and forwards to the impl.
pub(crate) const CREATE_PARSED_SHELL_SCRIPT: bun_jsc::JSHostFnZig =
    bun_jsc::marked_argument_buffer_wrap!(create_parsed_shell_script_impl);

// `jsc.Codegen.JSParsedShellScript.toJSWithValues` — generated by
// `generate-classes.ts` (`${T}__createWithValues`). Takes ownership of the
// boxed payload (via `heap::alloc`) and roots `marked_argument_buffer` values
// on the C++ wrapper's `m_values` array.
//
// `ptr` is `void*` on the C++ side; declaring it as such here (rather than
// `*mut ParsedShellScript`) matches the ABI exactly and avoids the
// `improper_ctypes` lint on a non-`#[repr(C)]` payload struct.
//
// ffi-safe-fn: `&JSGlobalObject`/`&MarkedArgumentBuffer` are `opaque_ffi!`
// ZSTs (UnsafeCell body, zero-byte deref, no `noalias`); `ptr` is stored
// opaquely on the JS wrapper (never dereferenced C++-side — same shape as
// `BakeGlobalObject__attachPerThreadData`). No caller-side precondition for
// the call itself ⇒ declare `safe fn`.
bun_jsc::jsc_abi_extern! {
    #[link_name = "ParsedShellScript__createWithValues"]
    safe fn ParsedShellScript__createWithValues(
        global: &JSGlobalObject,
        ptr: *mut core::ffi::c_void,
        marked_argument_buffer: &MarkedArgumentBuffer,
    ) -> JSValue;
}

fn create_parsed_shell_script_impl(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<JSValue> {
    // Box<ShellArgs> drops automatically on every early `return`/`?` below,
    // so no scopeguard is needed.
    let mut shargs: Box<ShellArgs> = ShellArgs::init();

    let arguments = callframe.arguments();
    if arguments.len() < 2 {
        return Err(global.throw_not_enough_arguments("Bun.$", 2, arguments.len()));
    }
    let string_args = arguments[0];
    let template_args_js = arguments[1];
    let mut template_args = template_args_js.array_iterator(global)?;

    // PERF: a stack-fallback allocation may be worth it — profile if hot.
    let mut jsstrings: Vec<BunString> = Vec::with_capacity(4);

    // Uses global Vecs here to sidestep a self-referential borrow against
    // `shargs`'s arena (it later moves into `ParsedShellScript`).
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

    // Reshaped for borrowck — `out_parser`/`out_lex_result` borrow
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
            &jsstrings[..],
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
                    return Err(global.throw(format_args!("{}", bstr::BStr::new(str))));
                }

                if let Some(p) = out_parser.as_mut() {
                    debug_assert!(!p.errors.is_empty());
                    let errstr = p.combine_errors();
                    return Err(global.throw(format_args!("{}", bstr::BStr::new(errstr))));
                }

                return Err(global.throw_error(err, "failed to lex/parse shell"));
            }
        }
    };

    shargs.set_script_ast(script_ast);

    let mut parsed_shell_script = Box::new(ParsedShellScript {
        args: JsCell::new(Some(shargs)),
        jsobjs: JsCell::new(jsobjs),
        ..Default::default()
    });
    parsed_shell_script.estimated_size_for_gc = parsed_shell_script.compute_estimated_size_for_gc();
    let parsed_shell_script_ptr = bun_core::heap::into_raw(parsed_shell_script);
    // `parsed_shell_script_ptr` is a fresh `heap::alloc`; ownership transfers
    // to the C++ wrapper (stored opaquely, freed via the generated finalize
    // callback).
    let this_jsvalue = ParsedShellScript__createWithValues(
        global,
        parsed_shell_script_ptr.cast::<core::ffi::c_void>(),
        marked_argument_buffer,
    );
    // SAFETY: pointer just created above; wrapper now owns it but we need one more field write.
    unsafe { (*parsed_shell_script_ptr).this_jsvalue = JsRef::init_weak(this_jsvalue) };

    bun_analytics::features::shell.fetch_add(1, Ordering::Relaxed);
    Ok(this_jsvalue)
}
