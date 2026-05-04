use core::mem::size_of;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, MarkedArgumentBuffer};
use bun_str::String as BunString;

use crate::interpreter::ShellArgs;
use crate::{EnvMap, EnvStr, Interpreter, LexResult, ParseError, Parser};

// NOTE: `pub const js = jsc.Codegen.JSParsedShellScript;` and the
// `toJS`/`fromJS`/`fromJSDirect` re-exports are provided by the
// `#[bun_jsc::JsClass]` derive in Rust — do not hand-port them.

#[bun_jsc::JsClass]
pub struct ParsedShellScript {
    pub args: Option<Box<ShellArgs>>,
    /// allocated with arena in jsobjs
    // TODO(port): in Zig this Vec's backing storage lives in `args.arena` (self-referential
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
        // SAFETY: `this` was produced by `Box::into_raw` in `create_parsed_shell_script_impl`
        // and is uniquely owned by the JS wrapper that is now being finalized.
        let mut this = unsafe { Box::from_raw(this) };
        // Per PORTING.md §JSC: flip the self-wrapper ref to `.Finalized` first; other
        // cells may already be swept so the weak JSValue must not be touched again.
        this.this_jsvalue.finalize();
        // `export_env`, `cwd`, `args` are Option<_> with Drop impls; dropping `this`
        // handles `env.deinit()`, `cwd.deref()`, `a.deinit()` from the Zig.
        drop(this);
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_cwd(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2);
        let mut arguments = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());
        let Some(str_js) = arguments.next_eat() else {
            return global.throw("$`...`.cwd(): expected a string argument", format_args!(""));
        };
        let str = BunString::from_js(str_js, global)?;
        // Dropping the previous Option<BunString> derefs it.
        self.cwd = Some(str);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_quiet(&mut self, _global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arg = callframe.argument(0);
        self.quiet = arg.to_boolean();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_env(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let Some(value1) = callframe.argument(0).get_object() else {
            return global.throw_invalid_arguments("env must be an object", format_args!(""));
        };

        // TODO(port): JSPropertyIterator config (skip_empty_name=false, include_value=true)
        // — encode as const generics or a builder on bun_jsc::JSPropertyIterator.
        let mut object_iter = bun_jsc::JSPropertyIterator::init(
            global,
            value1,
            bun_jsc::JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
            },
        )?;
        // `defer object_iter.deinit()` — handled by Drop.

        let mut env = EnvMap::init();
        // errdefer env.deinit() — Drop on early-return handles this.
        env.ensure_total_capacity(object_iter.len());

        // If the env object does not include a $PATH, it must disable path lookup for argv[0]
        // PATH = "";

        while let Some(key) = object_iter.next(global)? {
            let value = object_iter.value();
            if value.is_undefined() {
                continue;
            }

            let keyslice = key.to_owned_slice();
            // errdefer free(keyslice) — Drop on early-return handles this.
            let value_str = value.get_zig_string(global)?;
            let slice = value_str.to_owned_slice();
            let keyref = EnvStr::init_ref_counted(keyslice);
            // defer keyref.deref() — Drop handles this.
            let valueref = EnvStr::init_ref_counted(slice);
            // defer valueref.deref() — Drop handles this.

            env.insert(&keyref, &valueref);
        }
        // Dropping the previous Option<EnvMap> deinits it.
        self.export_env = Some(env);
        Ok(JSValue::UNDEFINED)
    }
}

// TODO(port): `jsc.MarkedArgumentBuffer.wrap` generates a host-fn shim that allocates a
// MarkedArgumentBuffer and forwards to the impl. Model this as an attribute macro
// `#[bun_jsc::host_fn(with_marked_argument_buffer)]` in Phase B.
pub const CREATE_PARSED_SHELL_SCRIPT: bun_jsc::JSHostFn =
    bun_jsc::MarkedArgumentBuffer::wrap(create_parsed_shell_script_impl);

fn create_parsed_shell_script_impl(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<JSValue> {
    // Zig: `defer if (needs_to_free_shargs) shargs.deinit()` — semantically `errdefer` on an
    // owned local. Box<ShellArgs> drops automatically on every early `return`/`?` below, so
    // no scopeguard is needed (PORTING.md: errdefer-on-owned-local → delete).
    let mut shargs: Box<ShellArgs> = ShellArgs::init();

    let arguments_ = callframe.arguments_old(2);
    let arguments = arguments_.slice();
    if arguments.len() < 2 {
        return global.throw_not_enough_arguments("Bun.$", 2, arguments.len());
    }
    let string_args = arguments[0];
    let template_args_js = arguments[1];
    let mut template_args = template_args_js.array_iterator(global)?;

    // PERF(port): was std.heap.stackFallback(@sizeOf(bun.String) * 4, arena) — profile in Phase B
    let mut jsstrings: Vec<BunString> = Vec::with_capacity(4);
    // defer { for bunstr in jsstrings { bunstr.deref() }; jsstrings.deinit() } — Drop handles both.

    // TODO(port): in Zig `jsobjs` and `script` are allocated from `shargs.arena_allocator()`.
    // Shell is an AST crate (arena-backed); Phase A uses global Vec to sidestep the
    // self-referential borrow against `shargs` (it later moves into `ParsedShellScript`).
    let mut jsobjs: Vec<JSValue> = Vec::new();
    let mut script: Vec<u8> = Vec::new();
    crate::shell_cmd_from_js(
        global,
        string_args,
        &mut template_args,
        &mut jsobjs,
        &mut jsstrings,
        &mut script,
        marked_argument_buffer,
    )?;

    let mut parser: Option<Parser> = None;
    let mut lex_result: Option<LexResult> = None;
    let script_ast = match Interpreter::parse(
        shargs.arena(),
        &script[..],
        &jsobjs[..],
        &jsstrings[..],
        &mut parser,
        &mut lex_result,
    ) {
        Ok(ast) => ast,
        Err(err) => {
            if matches!(err, ParseError::Lex) {
                debug_assert!(lex_result.is_some());
                let str = lex_result.as_ref().unwrap().combine_errors(shargs.arena());
                return global.throw_pretty(format_args!("{}", bstr::BStr::new(str)));
            }

            if let Some(p) = parser.as_mut() {
                if cfg!(debug_assertions) {
                    debug_assert!(!p.errors.is_empty());
                }
                let errstr = p.combine_errors();
                return global.throw_pretty(format_args!("{}", bstr::BStr::new(errstr)));
            }

            return global.throw_error(err.into(), "failed to lex/parse shell");
        }
    };

    shargs.script_ast = script_ast;

    let mut parsed_shell_script = Box::new(ParsedShellScript {
        args: Some(shargs),
        jsobjs,
        ..Default::default()
    });
    parsed_shell_script.estimated_size_for_gc = parsed_shell_script.compute_estimated_size_for_gc();
    // TODO(port): `jsc.Codegen.JSParsedShellScript.toJSWithValues` — generated by .classes.ts
    // codegen; takes ownership of the Box (via Box::into_raw) and roots `marked_argument_buffer`
    // values on the C++ wrapper.
    let parsed_shell_script_ptr = Box::into_raw(parsed_shell_script);
    let this_jsvalue = bun_jsc::codegen::JSParsedShellScript::to_js_with_values(
        parsed_shell_script_ptr,
        global,
        marked_argument_buffer,
    );
    // SAFETY: pointer just created above; wrapper now owns it but we need one more field write.
    unsafe { (*parsed_shell_script_ptr).this_jsvalue = JsRef::init_weak(this_jsvalue) };

    bun_analytics::features::shell_inc(1);
    Ok(this_jsvalue)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/ParsedShellScript.zig (218 lines)
//   confidence: medium
//   todos:      5
//   notes:      jsobjs/script were arena-backed (self-ref with args.arena) — Phase A uses global Vec; MarkedArgumentBuffer.wrap needs attr-macro; codegen to_js_with_values stubbed
// ──────────────────────────────────────────────────────────────────────────
