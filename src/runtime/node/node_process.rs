//! Process information and control APIs (`globalThis.process` / `node:process`)

use core::ffi::{c_char, c_void};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::{self as bstr_, String as BunString, ZigString, strings};
use bun_sys as Syscall;
use bun_paths::{self, PathBuffer, MAX_PATH_BYTES, SEP};
use bun_core::{self, Environment, Global, env_var, feature_flag};

// TODO(port): move to <area>_sys — extern decls colocated for now
unsafe extern "C" {
    fn Bun__Process__getArgv(global: *const JSGlobalObject) -> JSValue;
    fn Bun__Process__getExecArgv(global: *const JSGlobalObject) -> JSValue;
    #[cfg(windows)]
    fn SetEnvironmentVariableW(name: *const u16, value: *const u16) -> i32;
}

// ───────────────────────────── title ─────────────────────────────

static TITLE_MUTEX: bun_threading::Mutex<()> = bun_threading::Mutex::new(());

#[unsafe(no_mangle)]
#[export_name = "Bun__Process__getTitle"]
pub extern "C" fn get_title(_global: *const JSGlobalObject, title: *mut BunString) {
    let _guard = TITLE_MUTEX.lock();
    // TODO(port): bun_cli::process_title is a mutable global Option<Box<[u8]>> guarded by TITLE_MUTEX
    // SAFETY: TITLE_MUTEX held; process_title reads a static guarded by it
    let str_ = unsafe { bun_cli::process_title() };
    // SAFETY: title is a valid out-param provided by C++ caller
    unsafe {
        *title = BunString::clone_utf8(str_.map(|s| s.as_ref()).unwrap_or(b"bun"));
    }
}

// TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
#[unsafe(no_mangle)]
#[export_name = "Bun__Process__setTitle"]
pub extern "C" fn set_title(global_object: *const JSGlobalObject, newvalue: *mut BunString) {
    // SAFETY: newvalue is a valid pointer from C++; we consume one ref before returning
    let newvalue = unsafe { &mut *newvalue };
    let _guard = TITLE_MUTEX.lock();

    // PORT NOTE: reshaped for borrowck — Zig `defer newvalue.deref()` inlined on each exit path
    let new_title = match newvalue.to_owned_slice() {
        Ok(s) => s,
        Err(_) => {
            newvalue.deref_();
            // SAFETY: global_object is valid for the duration of this call
            let _ = unsafe { &*global_object }.throw_out_of_memory();
            return;
        }
    };

    // TODO(port): bun_cli::set_process_title takes ownership; old value (if any) is dropped
    // SAFETY: TITLE_MUTEX held; set_process_title mutates the static guarded by it
    unsafe { bun_cli::set_process_title(Some(new_title)) };
    newvalue.deref_();
}

// ───────────────────────────── argv0 / execPath ─────────────────────────────

#[unsafe(no_mangle)]
#[export_name = "Bun__Process__createArgv0"]
pub extern "C" fn create_argv0(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global = unsafe { &*global_object };
    ZigString::from_utf8(bun_core::argv()[0]).to_js(global)
}

#[unsafe(no_mangle)]
#[export_name = "Bun__Process__getExecPath"]
pub extern "C" fn get_exec_path(global_object: *const JSGlobalObject) -> JSValue {
    let Ok(out) = bun_core::self_exe_path() else {
        // if for any reason we are unable to get the executable path, we just return argv[0]
        return create_argv0(global_object);
    };
    // SAFETY: global_object is valid for the duration of this call
    let global = unsafe { &*global_object };
    ZigString::from_utf8(out).to_js(global)
}

// ───────────────────────────── execArgv ─────────────────────────────

#[bun_jsc::host_fn]
#[export_name = "Bun__Process__createExecArgv"]
pub fn create_exec_argv(global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback alloc (4096 bytes) — profile in Phase B
    let vm = global_object.bun_vm();

    if let Some(worker) = vm.worker() {
        // was explicitly overridden for the worker?
        if let Some(exec_argv) = worker.exec_argv() {
            let array = JSValue::create_empty_array(global_object, exec_argv.len())?;
            for i in 0..exec_argv.len() {
                array.put_index(
                    global_object,
                    u32::try_from(i).unwrap(),
                    BunString::init(&exec_argv[i]).to_js(global_object)?,
                )?;
            }
            return Ok(array);
        }
    }

    // For compiled/standalone executables, execArgv should contain compile_exec_argv and BUN_OPTIONS.
    // Use append_options_env for BUN_OPTIONS to correctly handle quoted values.
    if let Some(graph) = vm.standalone_module_graph() {
        if !graph.compile_exec_argv().is_empty() || bun_core::bun_options_argc() > 0 {
            let mut args: Vec<BunString> = Vec::new();
            // `defer args.deinit()` + `defer for args |*a| a.deref()` → Drop on Vec<BunString>

            // Process BUN_OPTIONS first using append_options_env for proper quote handling.
            // append_options_env inserts starting at index 1, so we need a placeholder.
            if bun_core::bun_options_argc() > 0 {
                if let Some(opts) = env_var::BUN_OPTIONS.get() {
                    args.push(BunString::empty()); // placeholder for insert-at-1
                    bun_core::append_options_env(opts, &mut args)?;
                    let _ = args.remove(0); // remove placeholder
                }
            }

            if !graph.compile_exec_argv().is_empty() {
                for token in graph
                    .compile_exec_argv()
                    .split(|b| matches!(*b, b' ' | b'\t' | b'\n' | b'\r'))
                    .filter(|s| !s.is_empty())
                {
                    args.push(BunString::clone_utf8(token));
                }
            }

            let array = JSValue::create_empty_array(global_object, args.len())?;
            for idx in 0..args.len() {
                array.put_index(
                    global_object,
                    u32::try_from(idx).unwrap(),
                    args[idx].to_js(global_object)?,
                )?;
            }
            return Ok(array);
        }
        return JSValue::create_empty_array(global_object, 0);
    }

    let argv = bun_core::argv();
    let mut args: Vec<BunString> = Vec::with_capacity(argv.len().saturating_sub(1));
    // `defer args.deinit()` + `defer for args |*a| a.deref()` → Drop on Vec<BunString>

    let mut seen_run = false;
    let mut prev: Option<&[u8]> = None;

    // we re-parse the process argv to extract execArgv, since this is a very uncommon operation
    // it isn't worth doing this as a part of the CLI
    for arg in &argv[argv.len().min(1)..] {
        // emulate `defer prev = arg` by setting at end of each iteration body
        let arg: &[u8] = arg.as_ref();

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
        // TODO(port): the Zig builds this set at comptime by iterating
        // `bun.cli.Arguments.auto_params` and emitting `--long` / `-s` for every
        // param with `takes_value != .none`. Rust cannot reflect over that list
        // at compile time; Phase B should generate this phf::Set from the same
        // source via build.rs or a proc-macro.
        static MAP: phf::Set<&'static [u8]> = bun_cli::arguments::AUTO_PARAMS_TAKING_VALUE_SET;

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

    BunString::to_js_array(global_object, &args)
}

// ───────────────────────────── argv ─────────────────────────────

#[unsafe(no_mangle)]
#[export_name = "Bun__Process__createArgv"]
pub extern "C" fn create_argv(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    let vm = global_object.bun_vm();

    // PERF(port): was stack-fallback alloc (32 * sizeof(ZigString) + MAX_PATH_BYTES + 1 + 32) — profile in Phase B

    let mut args_count: usize = vm.argv().len();
    if let Some(worker) = vm.worker() {
        args_count = worker.argv().len();
    }

    // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
    // argv also omits the script name
    let mut args_list: Vec<BunString> = Vec::with_capacity(args_count + 2);

    if vm.standalone_module_graph().is_some() {
        // Don't break user's code because they did process.argv.slice(2)
        // Even if they didn't type "bun", we still want to add it as argv[0]
        args_list.push(BunString::static_(b"bun"));
        // PERF(port): was assume_capacity
    } else {
        let exe_path = bun_core::self_exe_path().ok();
        args_list.push(match exe_path {
            Some(str_) => BunString::borrow_utf8(str_),
            None => BunString::static_(b"bun"),
        });
        // PERF(port): was assume_capacity
    }

    if !vm.main().is_empty()
        && !strings::ends_with(vm.main(), bun_paths::path_literal!(b"/[eval]"))
        && !strings::ends_with(vm.main(), bun_paths::path_literal!(b"/[stdin]"))
    {
        if vm.worker().is_some() && vm.worker().unwrap().eval_mode() {
            args_list.push(BunString::static_(b"[worker eval]"));
            // PERF(port): was assume_capacity
        } else {
            args_list.push(BunString::borrow_utf8(vm.main()));
            // PERF(port): was assume_capacity
        }
    }

    if let Some(worker) = vm.worker() {
        for arg in worker.argv() {
            args_list.push(BunString::init(arg));
            // PERF(port): was assume_capacity
        }
    } else {
        for arg in vm.argv() {
            let str_ = BunString::borrow_utf8(arg);
            // https://github.com/yargs/yargs/blob/adb0d11e02c613af3d9427b3028cc192703a3869/lib/utils/process-argv.ts#L1
            args_list.push(str_);
            // PERF(port): was assume_capacity
        }
    }

    BunString::to_js_array(global_object, &args_list).unwrap_or(JSValue::ZERO)
}

pub extern "C" fn get_argv(global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into C++; global is valid
    unsafe { Bun__Process__getArgv(global) }
}

pub extern "C" fn get_exec_argv(global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into C++; global is valid
    unsafe { Bun__Process__getExecArgv(global) }
}

// ───────────────────────────── eval ─────────────────────────────

#[unsafe(no_mangle)]
#[export_name = "Bun__Process__getEval"]
pub extern "C" fn get_eval(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    let vm = global_object.bun_vm();
    if let Some(source) = vm.module_loader().eval_source() {
        return ZigString::init(source.contents()).to_js(global_object);
    }
    JSValue::UNDEFINED
}

// ───────────────────────────── cwd ─────────────────────────────

#[bun_jsc::host_fn]
#[export_name = "Bun__Process__getCwd"]
pub fn get_cwd(global_object: &JSGlobalObject) -> JsResult<JSValue> {
    let mut buf = PathBuffer::uninit();
    match super::path::get_cwd(&mut buf) {
        bun_sys::Result::Ok(r) => Ok(ZigString::init(r).with_encoding().to_js(global_object)),
        bun_sys::Result::Err(e) => global_object.throw_value(e.to_js(global_object)?),
    }
}

#[bun_jsc::host_fn]
#[export_name = "Bun__Process__setCwd"]
pub fn set_cwd(global_object: &JSGlobalObject, to: &ZigString) -> JsResult<JSValue> {
    if to.len() == 0 {
        return global_object
            .throw_invalid_arguments("Expected path to be a non-empty string", format_args!(""));
    }
    let vm = global_object.bun_vm();
    let fs = vm.transpiler().fs();

    let mut buf = PathBuffer::uninit();
    let Ok(slice) = to.slice_z_buf(&mut buf) else {
        return global_object.throw("Invalid path", format_args!(""));
    };

    match Syscall::chdir(fs.top_level_dir(), slice) {
        bun_sys::Result::Ok(()) => {
            // When we update the cwd from JS, we have to update the bundler's version as well
            // However, this might be called many times in a row, so we use a pre-allocated buffer
            // that way we don't have to worry about garbage collector
            let into_cwd_buf = match bun_sys::getcwd(&mut buf) {
                bun_sys::Result::Ok(r) => r,
                bun_sys::Result::Err(err) => {
                    let _ = Syscall::chdir(fs.top_level_dir(), fs.top_level_dir());
                    return global_object.throw_value(err.to_js(global_object)?);
                }
            };
            // PORT NOTE: reshaped for borrowck — capture len before re-borrowing fs.top_level_dir_buf
            let cwd_len = into_cwd_buf.len();
            fs.top_level_dir_buf_mut()[0..cwd_len].copy_from_slice(into_cwd_buf);
            fs.top_level_dir_buf_mut()[cwd_len] = 0;
            // SAFETY: buf[cwd_len] == 0 written above
            fs.set_top_level_dir(unsafe {
                bun_str::ZStr::from_raw(fs.top_level_dir_buf().as_ptr(), cwd_len)
            });

            let len = fs.top_level_dir().len();
            // Ensure the path ends with a slash
            if fs.top_level_dir_buf()[len - 1] != SEP {
                fs.top_level_dir_buf_mut()[len] = SEP;
                fs.top_level_dir_buf_mut()[len + 1] = 0;
                // SAFETY: buf[len + 1] == 0 written above
                fs.set_top_level_dir(unsafe {
                    bun_str::ZStr::from_raw(fs.top_level_dir_buf().as_ptr(), len + 1)
                });
            }
            #[cfg(windows)]
            let without_trailing_slash = strings::without_trailing_slash_windows_path;
            #[cfg(not(windows))]
            let without_trailing_slash = strings::without_trailing_slash;
            let mut str_ = BunString::clone_utf8(without_trailing_slash(fs.top_level_dir()));
            Ok(str_.transfer_to_js(global_object))
        }
        bun_sys::Result::Err(e) => global_object.throw_value(e.to_js(global_object)?),
    }
}

// ───────────────────────────── exit ─────────────────────────────

// TODO(@190n) this may need to be noreturn
#[unsafe(no_mangle)]
#[export_name = "Bun__Process__exit"]
pub extern "C" fn exit(global_object: *const JSGlobalObject, code: u8) {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    let vm = global_object.bun_vm();
    vm.exit_handler_mut().exit_code = code;
    if let Some(worker) = vm.worker() {
        // TODO(@190n) we may need to use requestTerminate or throwTerminationException
        // instead to terminate the worker sooner
        worker.exit();
    } else {
        vm.on_exit();
        vm.global_exit();
    }
}

// ───────────────────────────── Windows env var ─────────────────────────────

// TODO: switch this to using *bun.wtf.String when it is added
#[cfg(windows)]
#[unsafe(no_mangle)]
#[export_name = "Bun__Process__editWindowsEnvVar"]
pub extern "C" fn bun_process_edit_windows_env_var(k: BunString, v: BunString) {
    const _: () = assert!(cfg!(windows));
    if k.tag() == bun_str::Tag::Empty {
        return;
    }
    let wtf1 = k.value().wtf_string_impl();
    // PERF(port): was stack-fallback alloc (1025 bytes) — profile in Phase B
    let mut buf1: Vec<u16> = vec![0u16; k.utf16_byte_length() + 1];
    let mut buf2: Vec<u16> = vec![0u16; v.utf16_byte_length() + 1];
    let len1: usize = if wtf1.is_8bit() {
        strings::copy_latin1_into_utf16(&mut buf1, wtf1.latin1_slice()).written
    } else {
        buf1[0..wtf1.length()].copy_from_slice(wtf1.utf16_slice());
        wtf1.length()
    };
    buf1[len1] = 0;

    static EMPTY_W: [u16; 1] = [0];
    let str2: Option<*const u16> = if v.tag() != bun_str::Tag::Dead {
        Some('str_: {
            if v.tag() == bun_str::Tag::Empty {
                break 'str_ EMPTY_W.as_ptr();
            }
            let wtf2 = v.value().wtf_string_impl();
            let len2: usize = if wtf2.is_8bit() {
                strings::copy_latin1_into_utf16(&mut buf2, wtf2.latin1_slice()).written
            } else {
                buf2[0..wtf2.length()].copy_from_slice(wtf2.utf16_slice());
                wtf2.length()
            };
            buf2[len2] = 0;
            buf2.as_ptr()
        })
    } else {
        None
    };
    // SAFETY: buf1[len1] == 0; str2 is either null or NUL-terminated
    unsafe {
        let _ = SetEnvironmentVariableW(
            buf1.as_ptr(),
            str2.unwrap_or(core::ptr::null()),
        );
    }
}

// ───────────────────────────── misc exports ─────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NODE_NO_WARNINGS() -> bool {
    feature_flag::NODE_NO_WARNINGS.get()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__suppressCrashOnProcessKillSelfIfDesired() {
    if feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF.get() {
        bun_crash_handler::suppress_reporting();
    }
}

// TODO(port): exporting raw `*const c_char` statics — Rust statics of raw ptrs
// are `!Sync`; Phase B may need a `#[repr(transparent)]` Sync wrapper or to
// export these as `&'static CStr` and adjust the C++ side.
#[unsafe(no_mangle)]
pub static Bun__version: *const c_char =
    const_format::concatcp!("v", Global::PACKAGE_JSON_VERSION, "\0").as_ptr() as *const c_char;
#[unsafe(no_mangle)]
pub static Bun__version_with_sha: *const c_char =
    const_format::concatcp!("v", Global::PACKAGE_JSON_VERSION_WITH_SHA, "\0").as_ptr()
        as *const c_char;
// Version exports removed - now handled by build-generated header (bun_dependency_versions.h)
// The C++ code in BunProcess.cpp uses the generated header directly
#[unsafe(no_mangle)]
pub static Bun__versions_uws: *const c_char =
    const_format::concatcp!(Environment::GIT_SHA, "\0").as_ptr() as *const c_char;
#[unsafe(no_mangle)]
pub static Bun__versions_usockets: *const c_char =
    const_format::concatcp!(Environment::GIT_SHA, "\0").as_ptr() as *const c_char;
#[unsafe(no_mangle)]
pub static Bun__version_sha: *const c_char =
    const_format::concatcp!(Environment::GIT_SHA, "\0").as_ptr() as *const c_char;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_process.zig (381 lines)
//   confidence: medium
//   todos:      4
//   notes:      comptime-built ComptimeStringMap from cli auto_params needs build.rs/proc-macro; mutable global process_title accessed via bun_cli helpers; exported *const c_char statics need Sync wrapper; host_fn.wrapN exports mapped to #[bun_jsc::host_fn]+#[export_name]
// ──────────────────────────────────────────────────────────────────────────
