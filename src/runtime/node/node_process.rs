//! Process information and control APIs (`globalThis.process` / `node:process`)

use core::ffi::c_char;

use bun_core::EncodedSlice;
use bun_core::env_var;
use bun_core::{self, Environment, Global};
use bun_jsc::{EncodedSliceJsc as _, JSGlobalObject, JSValue, JsResult};

// Both materialize the array on first access through `Bun__Process__createArgv`
// / `createExecArgv` below, which return zero with the exception pending.
unsafe extern "C" {
    safe fn Bun__Process__getArgv(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Process__getExecArgv(global: &JSGlobalObject) -> JSValue;
}

// ───────────────────────────── argv0 / execPath ─────────────────────────────

// `&JSGlobalObject` is ABI-identical to `*const JSGlobalObject` (non-null) in
// `extern "C"`; the C++ caller guarantees a live pointer, so the reference
// param discharges the non-null obligation at the type level.
#[unsafe(export_name = "Bun__Process__createArgv0")]
extern "C" fn create_argv0(global_object: &JSGlobalObject) -> JSValue {
    let argv0 = bun_core::argv()
        .get(0)
        .map(|z| z.as_bytes())
        .unwrap_or(b"bun");
    EncodedSlice::from_bytes(argv0).to_js(global_object)
}

#[unsafe(export_name = "Bun__Process__getExecPath")]
extern "C" fn get_exec_path(global_object: &JSGlobalObject) -> JSValue {
    let Ok(out) = bun_core::self_exe_path() else {
        // if for any reason we are unable to get the executable path, we just return argv[0]
        return create_argv0(global_object);
    };
    EncodedSlice::from_bytes(out.as_bytes()).to_js(global_object)
}

/// A worker's `argv`/`execArgv` strings live in its parent-thread
/// `WorkerOptions`; the worker thread gets its own copy (the parent may
/// atomize its impls), and an empty one is spelled as `BunString::EMPTY`.
pub(crate) fn worker_option_string(wtf: bun_core::WTFStringImpl) -> bun_core::String {
    // SAFETY: non-null impl borrowed from the live `WorkerOptions`.
    let imp = unsafe { &*wtf };
    if imp.length() == 0 {
        bun_core::String::EMPTY
    } else if imp.is_8bit() {
        bun_core::String::clone_latin1(imp.latin1_slice())
    } else {
        bun_core::String::clone_utf16(imp.utf16_slice())
    }
}

// ───────────────────────────── argv (C++ accessor wrappers) ─────────────────

pub(crate) fn get_argv(global: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::call_zero_is_throw(global, || Bun__Process__getArgv(global))
}

pub(crate) fn get_exec_argv(global: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::call_zero_is_throw(global, || Bun__Process__getExecArgv(global))
}

// ───────────────────────────── exit ─────────────────────────────

// @190n: this may need to be noreturn
#[unsafe(export_name = "Bun__Process__exit")]
pub(crate) extern "C" fn exit(global_object: &JSGlobalObject, code: u8) {
    let vm = global_object.bun_vm().as_mut();
    vm.exit_handler.exit_code = code;
    if let Some(worker) = vm.worker_ref() {
        // @190n: we may need to use requestTerminate or throwTerminationException
        // instead to terminate the worker sooner
        worker.exit();
    } else {
        // A watch-reload kill-signal handler may call process.exit; node restarts the child
        // regardless. `process.exit()` must never return control to JS, so replace the process
        // here instead of unwinding — the 'exit' event has already been dispatched by the caller.
        if bun_jsc::posix_signal_handle::is_emitting_watch_kill_signal() {
            let should_clear_terminal =
                !vm.env_loader().has_set_no_clear_terminal_on_reload(
                    !bun_core::Output::enable_ansi_colors_stdout(),
                );
            bun_jsc::node_compile_cache::persist_now();
            bun_core::Output::flush();
            bun_core::reload_process(should_clear_terminal, false);
        }
        vm.exit_handler.requested = true;
        vm.on_exit();
        vm.global_exit();
    }
}

// ───────────────────────────── misc exports ─────────────────────────────

#[unsafe(no_mangle)]
extern "C" fn Bun__NODE_NO_WARNINGS() -> bool {
    env_var::NODE_NO_WARNINGS.get() == Some(b"1")
}

/// `--redirect-warnings=<path>` value; `Dead` when unset.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Node__getRedirectWarnings() -> bun_core::String {
    match crate::cli::Bun__Node__RedirectWarnings.get() {
        Some(path) => bun_core::String::clone_utf8(path),
        None => bun_core::String::DEAD,
    }
}

/// `--disable-warning` entries as `[ptr, len]` pairs into caller-provided buffers; returns
/// the count. `bufs`/`lens` may be null when `cap == 0` to query the count. Entries
/// borrow the CLI-owned Vec (never mutated after argument parsing).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Node__getDisabledWarnings(
    bufs: *mut *const u8,
    lens: *mut usize,
    cap: usize,
) -> usize {
    let Some(disabled) = crate::cli::Bun__Node__DisabledWarnings.get() else {
        return 0;
    };
    let n = disabled.len().min(cap);
    for (i, entry) in disabled.iter().take(n).enumerate() {
        // SAFETY: caller provides `cap`-sized arrays; entries live for the
        // process (write-once at CLI parse, never freed).
        unsafe {
            *bufs.add(i) = entry.as_ptr();
            *lens.add(i) = entry.len();
        }
    }
    disabled.len()
}

// Raw-pointer statics are `!Sync`; wrap in a
// `#[repr(transparent)]` newtype so the C++ side still sees a single
// `const char*`-sized symbol.
#[repr(transparent)]
struct CStrPtr(*const c_char);
// SAFETY: the wrapped pointer always targets a `'static` NUL-terminated
// rodata literal produced by `concatcp!`; it is never written through.
unsafe impl Sync for CStrPtr {}

#[unsafe(no_mangle)]
static Bun__version: CStrPtr = CStrPtr(
    const_format::concatcp!("v", Global::package_json_version, "\0")
        .as_ptr()
        .cast::<c_char>(),
);
#[unsafe(no_mangle)]
static Bun__version_with_sha: CStrPtr = CStrPtr(
    const_format::concatcp!("v", Global::package_json_version_with_sha, "\0")
        .as_ptr()
        .cast::<c_char>(),
);
#[unsafe(no_mangle)]
static Bun__version_sha: CStrPtr = CStrPtr(
    const_format::concatcp!(Environment::GIT_SHA, "\0")
        .as_ptr()
        .cast::<c_char>(),
);

mod _impl {
    use bun_core::env_var;
    use bun_core::{EncodedSlice, String as BunString, strings};
    use bun_jsc::bun_string_jsc;
    use bun_jsc::{
        EncodedSliceJsc as _, JSGlobalObject, JSValue, JsResult, StringJsc, SysErrorJsc, WebWorker,
    };
    use bun_paths::PathBuffer;

    #[cfg(windows)]
    unsafe extern "C" {
        // SAFETY precondition: `name` must point to a NUL-terminated wide string;
        // `value` must be either null (delete) or a NUL-terminated wide string.
        // Raw-pointer contract — cannot be `safe fn`.
        fn SetEnvironmentVariableW(name: *const u16, value: *const u16) -> i32;
    }

    // ───────────────────────────── title ─────────────────────────────

    // Windows `process.title` getter support: the C++ getter needs to know
    // whether a title was explicitly set (CLI `--title` or assignment) so it
    // can prefer the store over `uv_get_process_title` without comparing
    // against the "bun" default string.
    #[unsafe(export_name = "Bun__Process__hasTitle")]
    extern "C" fn has_title() -> bool {
        crate::cli::Bun__Node__ProcessTitle.lock().is_some()
    }

    #[unsafe(export_name = "Bun__Process__getTitle")]
    extern "C" fn get_title(_global: *const JSGlobalObject) -> BunString {
        let guard = crate::cli::Bun__Node__ProcessTitle.lock();
        // Node's default process.title is argv[0] as invoked
        // (uv_setup_args/uv_get_process_title semantics), not a fixed name.
        let argv = bun_core::argv();
        BunString::clone_utf8(
            guard
                .as_deref()
                .or_else(|| argv.get(0).map(|z| z.as_bytes()))
                .unwrap_or(b"bun"),
        )
    }

    // TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
    #[unsafe(export_name = "Bun__Process__setTitle")]
    extern "C" fn set_title(_global_object: *const JSGlobalObject, newvalue: &BunString) {
        // `to_owned_slice` is infallible (Vec<u8>).
        let new_title: Box<[u8]> = newvalue.to_owned_slice().into_boxed_slice();

        // Assigning into the `Option<Box<[u8]>>` static drops the previous box.
        *crate::cli::Bun__Node__ProcessTitle.lock() = Some(new_title);
    }

    // ───────────────────────────── execArgv ─────────────────────────────

    // The C++ caller
    // (headers.h) declares `EncodedJSValue Bun__Process__createExecArgv(JSGlobalObject*)`,
    // not a `JSHostFunctionType`. Hand-roll the shim instead of `#[bun_jsc::host_fn]`.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__Process__createExecArgv(global_object: &JSGlobalObject) -> JSValue {
        bun_jsc::to_js_host_fn_result(global_object, create_exec_argv(global_object))
    }

    fn create_exec_argv(global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
        let vm = global_object.bun_vm();

        if let Some(worker) = vm.worker_ref() {
            // was explicitly overridden for the worker?
            if let Some(exec_argv) = worker.exec_argv() {
                return JSValue::create_array_from_iter(global_object, exec_argv.iter(), |&wtf| {
                    super::worker_option_string(wtf).into_js(global_object)
                });
            }
        }

        // For compiled/standalone executables, execArgv should contain compile_exec_argv and BUN_OPTIONS.
        // Use append_options_env for BUN_OPTIONS to correctly handle quoted values.
        if let Some(graph) = vm.standalone_module_graph {
            // `standalone_module_graph` is the lower-crate trait object
            // (`&'static dyn bun_resolver::StandaloneModuleGraph`); the field we
            // need is exposed via the trait so no downcast is required.
            let compile_exec_argv = graph.compile_exec_argv();
            let bun_options_argc = bun_core::bun_options_argc();
            if !compile_exec_argv.is_empty() || bun_options_argc > 0 {
                let mut args = Vec::<BunString>::new();

                // Process BUN_OPTIONS first using append_options_env for proper quote handling.
                // append_options_env inserts starting at index 1, so we need a placeholder.
                if bun_options_argc > 0 {
                    if let Some(opts) = env_var::BUN_OPTIONS.get() {
                        args.push(BunString::EMPTY); // placeholder for insert-at-1
                        bun_core::append_options_env::<BunString>(opts, &mut args);
                        let _ = args.remove(0); // remove placeholder
                    }
                }

                if !compile_exec_argv.is_empty() {
                    for token in strings::tokenize_any(compile_exec_argv, b" \t\n\r") {
                        args.push(BunString::clone_utf8(token));
                    }
                }

                return bun_string_jsc::to_js_array(global_object, &args);
            }
            return JSValue::create_empty_array(global_object, 0);
        }

        let argv = bun_core::argv();
        let mut args = Vec::<BunString>::with_capacity(argv.len().saturating_sub(1));

        let mut seen_run = false;
        let mut prev: Option<&[u8]> = None;

        // we re-parse the process argv to extract execArgv, since this is a very uncommon operation
        // it isn't worth doing this as a part of the CLI
        let mut iter = argv.iter();
        let _ = iter.next(); // skip argv[0]
        for arg in iter {
            // emulate `defer prev = arg` by setting at end of each iteration body
            let arg: &[u8] = arg;

            if arg.len() >= 1 && arg[0] == b'-' {
                args.push(BunString::clone_utf8(arg));
                prev = Some(arg);
                continue;
            }

            if !seen_run && arg == b"run" {
                seen_run = true;
                prev = Some(arg);
                continue;
            }

            // A set of execArgv args consume an extra argument, so we do not want to
            // confuse these with script names.
            // Build the set lazily at runtime from the `AUTO_PARAMS` table:
            // `--long` / `-s` for every param with a value.
            static MAP: std::sync::LazyLock<bun_collections::StringSet> =
                std::sync::LazyLock::new(|| {
                    let mut set = bun_collections::StringSet::new();
                    for param in crate::cli::arguments::AUTO_PARAMS.iter() {
                        if param.takes_value != bun_clap::Values::None {
                            if let Some(name) = param.names.long {
                                let mut k = Vec::with_capacity(2 + name.len());
                                k.extend_from_slice(b"--");
                                k.extend_from_slice(name);
                                bun_core::handle_oom(set.insert(&k));
                            }
                            if let Some(name) = param.names.short {
                                bun_core::handle_oom(set.insert(&[b'-', name]));
                            }
                        }
                    }
                    // Node's whole-token aliases are not params, so they never
                    // land above; an alias takes a value iff its target does.
                    for (from, to) in crate::cli::arguments::NODE_SHORT_ALIASES {
                        if set.contains(to) {
                            bun_core::handle_oom(set.insert(from));
                        }
                    }
                    set
                });

            if let Some(p) = prev {
                if MAP.contains(p) {
                    args.push(BunString::clone_utf8(arg));
                    prev = Some(arg);
                    continue;
                }
            }

            // we hit the script name
            break;
        }

        bun_string_jsc::to_js_array(global_object, &args)
    }

    // ───────────────────────────── argv ─────────────────────────────

    #[unsafe(export_name = "Bun__Process__createArgv")]
    extern "C" fn create_argv(global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
        let vm = global_object.bun_vm();

        let worker: Option<&WebWorker> = vm.worker_ref();

        let args_count: usize = match worker {
            Some(w) => w.argv().len(),
            None => vm.argv.len(),
        };

        // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
        // argv also omits the script name
        let mut args_list: Vec<BunString> = Vec::with_capacity(args_count + 2);

        if vm.standalone_module_graph.is_some() {
            // Don't break user's code because they did process.argv.slice(2)
            // Even if they didn't type "bun", we still want to add it as argv[0]
            args_list.push(BunString::static_("bun"));
        } else {
            let exe_path = bun_core::self_exe_path().ok();
            args_list.push(match exe_path {
                Some(str_) => BunString::borrow_utf8(str_.as_bytes()),
                None => BunString::static_("bun"),
            });
        }

        // Per-platform path-separator literal suffixes.
        const EVAL_SUFFIX: &[u8] = if cfg!(windows) {
            b"\\[eval]"
        } else {
            b"/[eval]"
        };
        const STDIN_SUFFIX: &[u8] = if cfg!(windows) {
            b"\\[stdin]"
        } else {
            b"/[stdin]"
        };
        if !vm.main().is_empty()
            && !strings::ends_with(vm.main(), EVAL_SUFFIX)
            && !strings::ends_with(vm.main(), STDIN_SUFFIX)
        {
            if worker.is_some_and(|w| w.eval_mode()) {
                args_list.push(BunString::static_("[worker eval]"));
            } else {
                args_list.push(BunString::borrow_utf8(vm.main()));
            }
        }

        if let Some(worker) = worker {
            args_list.extend(
                worker
                    .argv()
                    .iter()
                    .map(|&arg| super::worker_option_string(arg)),
            );
        } else {
            for arg in &vm.argv {
                let str_ = BunString::borrow_utf8(arg);
                // https://github.com/yargs/yargs/blob/adb0d11e02c613af3d9427b3028cc192703a3869/lib/utils/process-argv.ts#L1
                args_list.push(str_);
            }
        }

        let array = bun_string_jsc::to_js_array(global_object, &args_list);
        bun_jsc::HostReturn::or_pending_exception(array)
    }

    // ───────────────────────────── eval ─────────────────────────────

    #[unsafe(export_name = "Bun__Process__getEval")]
    extern "C" fn get_eval(global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
        let vm = global_object.bun_vm();
        // `--interactive` boots the bootstrap through `eval_source`, so read
        // the user's real `-e` bytes from `interactive_eval_script` instead
        // (`undefined` when empty, matching `node -i` without `-e`).
        if let Some(script) = vm.module_loader.interactive_eval_script.as_deref() {
            if script.is_empty() {
                return JSValue::UNDEFINED;
            }
            return EncodedSlice::from_bytes(script).to_js(global_object);
        }
        if let Some(source) = vm.module_loader.eval_source.as_deref() {
            return EncodedSlice::from_bytes(source.contents()).to_js(global_object);
        }
        JSValue::UNDEFINED
    }

    // ───────────────────────────── cwd ─────────────────────────────

    // C++ (headers.h) declares
    // `EncodedJSValue Bun__Process__getCwd(JSGlobalObject*)`. Hand-roll the
    // shim instead of `#[bun_jsc::host_fn]` (caller is not a JSHostFunction).
    #[unsafe(no_mangle)]
    extern "C" fn Bun__Process__getCwd(global_object: &JSGlobalObject) -> JSValue {
        bun_jsc::to_js_host_fn_result(global_object, get_cwd(global_object))
    }

    fn get_cwd(global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // Real syscall (not the resolver's cached top_level_dir): Node's
        // process.cwd() calls uv_cwd() so a deleted cwd must surface here.
        let mut buf = PathBuffer::uninit();
        // OHOS: use process_cwd(), which surfaces a rmdir'd cwd as ENOENT
        // (Node's uv_cwd() contract) instead of the ohos-compat-shim's $HOME
        // fallback. Other platforms use the plain getcwd().
        #[cfg(target_env = "ohos")]
        let result = bun_sys::process_cwd(&mut buf[..]);
        #[cfg(not(target_env = "ohos"))]
        let result = bun_sys::getcwd(&mut buf[..]);
        match result {
            bun_sys::Result::Ok(len) => {
                bun_string_jsc::create_utf8_for_js(global_object, &buf[..len])
            }
            bun_sys::Result::Err(e) => {
                // Node's UVException from `Cwd` (node_process_methods.cc):
                // "CODE: process.cwd failed with error <uv_strerror>[, hint], uv_cwd"
                let (code, label) = e.uv_code_label().unwrap_or(("UNKNOWN", "unknown error"));
                let hint = if e.get_errno() == bun_sys::E::ENOENT {
                    ", the current working directory was likely removed \
                     without changing the working directory"
                } else {
                    ""
                };
                let message =
                    format!("{code}: process.cwd failed with error {label}{hint}, uv_cwd");
                let err = bun_jsc::SystemError {
                    errno: core::ffi::c_int::from(e.errno).wrapping_neg(),
                    code: BunString::static_(code),
                    message: BunString::clone_utf8(message.as_bytes()),
                    syscall: BunString::static_("uv_cwd"),
                    ..Default::default()
                };
                Err(global_object.throw_value(err.to_error_instance(global_object)))
            }
        }
    }

    // C++ (headers.h) declares
    // `EncodedJSValue Bun__Process__setCwd(JSGlobalObject*, const EncodedSlice*)`. Hand-roll
    // the shim; the second arg is a `const EncodedSlice*`, not a CallFrame.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__Process__setCwd(
        global_object: &JSGlobalObject,
        to: &EncodedSlice,
    ) -> JSValue {
        bun_jsc::to_js_host_fn_result(global_object, set_cwd(global_object, to))
    }

    fn set_cwd(global_object: &JSGlobalObject, to: &EncodedSlice) -> JsResult<JSValue> {
        if to.is_empty() {
            return Err(global_object
                .throw_invalid_arguments(format_args!("Expected path to be a non-empty string")));
        }
        // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
        let vm = global_object.bun_vm().as_mut();
        // `Transpiler::fs_mut()` is the audited safe `&mut FileSystem` accessor for
        // the process-lifetime singleton (centralised single-unsafe deref).
        let fs = vm.transpiler.fs_mut();

        let mut buf = PathBuffer::uninit();
        let Ok(slice) = to.slice_z_buf(&mut buf) else {
            return Err(global_object.throw(format_args!("Invalid path")));
        };

        // path=cwd, dest=target so the
        // resulting Node SystemError carries `path: cwd`, `dest: target` and the
        // `chdir '<cwd>' -> '<target>'` message format (test-process-chdir-errormessage).
        let prev_cwd: Box<[u8]> = Box::from(fs.top_level_dir);
        match vm.set_process_cwd(slice) {
            bun_sys::Result::Ok(()) => {
                vm.test_isolation_scope(|state| {
                    state.saved_cwd.get_or_insert(prev_cwd);
                });
                let fs = vm.transpiler.fs_mut();
                #[cfg(windows)]
                let without_trailing_slash =
                    bun_paths::string_paths::without_trailing_slash_windows_path;
                #[cfg(not(windows))]
                let without_trailing_slash = strings::without_trailing_slash;
                bun_string_jsc::create_utf8_for_js(
                    global_object,
                    without_trailing_slash(fs.top_level_dir),
                )
            }
            bun_sys::Result::Err(e) => {
                let e = e.with_path_dest(&prev_cwd, slice.as_bytes());
                Err(global_object.throw_value(e.to_js(global_object)))
            }
        }
    }

    // ───────────────────────────── Windows env var ─────────────────────────────

    // TODO: switch this to a WTF::String-backed type when one is added
    #[cfg(windows)]
    #[unsafe(export_name = "Bun__Process__editWindowsEnvVar")]
    extern "C" fn bun_process_edit_windows_env_var(k: &BunString, v: &BunString) {
        const _: () = assert!(cfg!(windows));
        if k.tag() == bun_core::Tag::Empty {
            return;
        }
        // `String::{is_8bit,latin1,utf16,length}` dispatch to the WTF impl when
        // `tag == WTFStringImpl` (guaranteed here: C++ caller passes WTF-backed
        // strings and we've already returned on `Empty`).
        let mut buf1: Vec<u16> = vec![0u16; k.utf16_byte_length() + 1];
        let mut buf2: Vec<u16> = vec![0u16; v.utf16_byte_length() + 1];
        let len1: usize = if k.is_8bit() {
            strings::copy_latin1_into_utf16(&mut buf1, k.latin1()).written as usize
        } else {
            buf1[0..k.length()].copy_from_slice(k.utf16());
            k.length()
        };
        buf1[len1] = 0;

        static EMPTY_W: [u16; 1] = [0];
        let str2: Option<*const u16> = if v.tag() != bun_core::Tag::Dead {
            Some('str_: {
                if v.tag() == bun_core::Tag::Empty {
                    break 'str_ EMPTY_W.as_ptr();
                }
                let len2: usize = if v.is_8bit() {
                    strings::copy_latin1_into_utf16(&mut buf2, v.latin1()).written as usize
                } else {
                    buf2[0..v.length()].copy_from_slice(v.utf16());
                    v.length()
                };
                buf2[len2] = 0;
                buf2.as_ptr()
            })
        } else {
            None
        };
        // SAFETY: buf1[len1] == 0; str2 is either null or NUL-terminated
        unsafe {
            let _ = SetEnvironmentVariableW(buf1.as_ptr(), str2.unwrap_or(core::ptr::null()));
        }
    }
} // mod _impl
