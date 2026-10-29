use core::cell::Cell;
use core::sync::atomic::Ordering;

use bun_core::String as BunString;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{
    JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsCell, JsClass as _,
    JsResult, MarkedArgumentBuffer,
};

use super::env_map::EnvMap;
use super::interpreter::ShellArgs;
use super::shell_body::shell_cmd_from_js;
use super::{EnvStr, Interpreter};

pub(crate) use crate::generated_bindgen::parsed_shell_script::js_ParsedShellScript as js;

pub(crate) struct ParsedShellScript {
    pub args: JsCell<Option<Box<ShellArgs>>>,
    pub(crate) export_env: JsCell<Option<EnvMap>>,
    pub(crate) quiet: Cell<bool>,
    pub(crate) cwd: JsCell<Option<BunString>>,
    /// Read-only after construction (set once before the JS wrapper exists).
    pub(crate) estimated_size_for_gc: usize,
}

impl Default for ParsedShellScript {
    fn default() -> Self {
        Self {
            args: JsCell::new(None),
            export_env: JsCell::new(None),
            quiet: Cell::new(false),
            cwd: JsCell::new(None),
            estimated_size_for_gc: 0,
        }
    }
}

impl ParsedShellScript {
    pub(crate) fn memory_cost(&self) -> usize {
        let mut size: usize = 0;
        if let Some(args) = self.args.get() {
            size += args.memory_cost();
        }
        if let Some(env) = self.export_env.get() {
            size += env.memory_cost();
        }
        if let Some(cwd) = self.cwd.get() {
            size += cwd.estimated_size();
        }
        size
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.estimated_size_for_gc
    }

    // Returns a tuple; callers destructure it.
    pub(crate) fn take(&self) -> (Box<ShellArgs>, bool, Option<BunString>, Option<EnvMap>) {
        let args = self.args.replace(None).expect("args already taken");
        let quiet = self.quiet.get();
        let cwd = self.cwd.replace(None);
        let export_env = self.export_env.replace(None);
        (args, quiet, cwd, export_env)
    }

    pub(crate) fn set_cwd(&self, cx: &mut JsScope<'_>, cwd: &BunString) -> JsResult<()> {
        throw_if_nul(cx.global(), "cwd", &cwd.to_utf8())?;
        self.cwd.set(Some(cwd.clone()));
        Ok(())
    }

    pub(crate) fn set_quiet(&self, quiet: bool) {
        self.quiet.set(quiet);
    }

    pub(crate) fn set_env(&self, cx: &mut JsScope<'_>, env: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let Some(value1) = env.to_js().get_object() else {
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

            let keyslice = env_bytes(global, "env key", &key)?;
            // errdefer free(keyslice) — Drop on early-return handles this.
            let slice = env_bytes(global, "env value", &value.to_bun_string(global)?)?;
            let keyref = EnvStr::init_ref_counted(keyslice);
            let valueref = EnvStr::init_ref_counted(slice);

            env.insert(keyref, valueref);
            keyref.deref();
            valueref.deref();
        }
        // Dropping the previous Option<EnvMap> deinits it.
        self.export_env.set(Some(env));
        Ok(())
    }
}

/// Throws if `bytes` contains a NUL. The OS reads the cwd and env as C strings, which end at the first NUL.
fn throw_if_nul(global: &JSGlobalObject, name: &str, bytes: &[u8]) -> JsResult<()> {
    if bun_core::strings::contains_char(bytes, 0) {
        return Err(global
            .err(
                bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "The shell {name} must be a string without null bytes. Received {}",
                    bun_core::fmt::quote(bytes)
                ),
            )
            .throw());
    }
    Ok(())
}

/// Returns an env name's or value's UTF-8 bytes. Throws like [`throw_if_nul`].
fn env_bytes(global: &JSGlobalObject, name: &str, str: &BunString) -> JsResult<Box<[u8]>> {
    // Fast path, because this runs for every variable of every command. The scan stops at
    // any byte below 0x20 or above 0x7F, so `None` proves the bytes are ASCII without a NUL.
    if !str.is_utf16() {
        let bytes = str.latin1();
        if bun_core::strings::index_of_newline_or_non_ascii(bytes, 0).is_none() {
            return Ok(Box::from(bytes));
        }
    }
    let bytes = str.to_owned_slice();
    throw_if_nul(global, name, &bytes)?;
    Ok(bytes.into_boxed_slice())
}

pub(crate) fn create_parsed_shell_script<'a>(
    cx: &mut JsScope<'a>,
    strings: JsLocal<'a>,
    template_args: JsLocal<'a>,
) -> JsResult<JSValue> {
    let global = cx.global();
    MarkedArgumentBuffer::new(|buf| {
        create_parsed_shell_script_impl(global, strings.to_js(), template_args.to_js(), buf)
    })
}

fn create_parsed_shell_script_impl(
    global: &JSGlobalObject,
    string_args: JSValue,
    template_args_js: JSValue,
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<JSValue> {
    // Box<ShellArgs> drops automatically on every early `return`/`?` below,
    // so no scopeguard is needed.
    let mut shargs: Box<ShellArgs> = ShellArgs::init();

    let mut template_args = template_args_js.array_iterator(global)?;

    // PERF: a stack-fallback allocation may be worth it — profile if hot.
    let mut jsstrings: Vec<BunString> = Vec::with_capacity(4);

    // Uses a global Vec here to sidestep a self-referential borrow against
    // `shargs`'s arena (it later moves into `ParsedShellScript`).
    let mut script: Vec<u8> = Vec::new();
    shell_cmd_from_js(
        global,
        string_args,
        &mut template_args,
        &mut jsstrings,
        &mut script,
        marked_argument_buffer,
    )?;
    let jsobjs_len = u32::try_from(marked_argument_buffer.size()).expect("int cast");

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
            jsobjs_len,
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

    let mut parsed_shell_script = ParsedShellScript {
        args: JsCell::new(Some(shargs)),
        ..Default::default()
    };
    parsed_shell_script.estimated_size_for_gc = parsed_shell_script.memory_cost();
    let this_jsvalue = parsed_shell_script.to_js(global);
    if jsobjs_len > 0 {
        let jsobjs = marked_argument_buffer.construct_array(global)?;
        js::jsobjs_set_cached(this_jsvalue, global, jsobjs);
    }

    bun_analytics::features::shell.fetch_add(1, Ordering::Relaxed);
    Ok(this_jsvalue)
}
