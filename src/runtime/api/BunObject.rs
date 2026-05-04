use core::ffi::{c_char, c_int, c_void};
use std::io::Write as _;

use bun_core::{Environment, Output};
use bun_jsc::{
    self as jsc, host_fn, ArrayBuffer, CallFrame, ConsoleObject, ErrorableString, JSFunction,
    JSGlobalObject, JSObject, JSPromise, JSValue, JsRef, JsResult, VirtualMachine, WebCore,
    ZigString,
};
use bun_paths::{self as path, PathBuffer, WPathBuffer, MAX_PATH_BYTES};
use bun_str::{self, strings, String as BunString};
use bun_sys::{self as sys, Fd};
use bun_aio::{self as Async, KeepAlive};
use bun_threading::WorkPool;

use bun_shell_parser::braces as Braces;
use bun_which::Which;
use bun_zlib as zlib;
use bun_cli::open::Editor;
use bun_url::URL;
use bun_semver::SemverObject;
use bun_gen::bun_object as gen;

use bun_runtime::api::{
    self, FFIObject, HashObject, JSON5Object, JSONCObject, MarkdownObject, TOMLObject,
    UnsafeObject, YAMLObject,
};
use bun_runtime::node;
use bun_runtime::crypto::Crypto;
use bun_runtime::api::cron;
use bun_runtime::api::csrf_jsc;
use bun_runtime::valkey_jsc::js_valkey::SubscriptionCtx;
use bun_test_runner::jest::Jest;
use bun_bundler::api::JSBundler;

/// How to add a new function or property to the Bun global
///
/// - Add a callback or property to the below struct
/// - @export it in the appropriate place
/// - Update "@begin bunObjectTable" in BunObject.cpp
///     - Getters use a generated wrapper function `BunObject_getter_wrap_<name>`
/// - Update "BunObject+exports.h"
/// - Run `bun run build`
pub mod bun_object {
    use super::*;

    // TODO(port): proc-macro — Zig used `toJSCallback = jsc.toJSHostFn` and
    // `toJSLazyPropertyCallback` (comptime fn wrappers) plus comptime `@export`
    // to emit each callback under `BunObject_callback_<name>` /
    // `BunObject_lazyPropCb_<name>`. In Rust, the `#[bun_jsc::host_fn]`
    // attribute on the underlying fn emits the JSC-ABI shim; the export name
    // is set with `#[unsafe(no_mangle)]` on the shim. The two `macro_rules!`
    // below expand the static export tables; Phase B should verify the shim
    // ABI matches `LazyPropertyCallback` for the property variants.

    macro_rules! export_callbacks {
        ($( $name:ident => $target:path ),* $(,)?) => {
            $(
                #[unsafe(no_mangle)]
                pub extern "C" fn ${concat(BunObject_callback_, $name)}(
                    g: *mut JSGlobalObject,
                    f: *mut CallFrame,
                ) -> JSValue {
                    // SAFETY: JSC always passes valid pointers here.
                    bun_jsc::to_js_host_fn($target)(g, f)
                }
            )*
        };
    }

    macro_rules! export_lazy_prop_callbacks {
        ($( $name:ident => $target:path ),* $(,)?) => {
            $(
                #[unsafe(no_mangle)]
                pub extern "C" fn ${concat(BunObject_lazyPropCb_, $name)}(
                    this: *mut JSGlobalObject,
                    object: *mut JSObject,
                ) -> JSValue {
                    // SAFETY: JSC always passes valid pointers here.
                    unsafe {
                        bun_jsc::to_js_host_call(&*this, $target, (&*this, &*object))
                    }
                }
            )*
        };
    }

    // --- Callbacks ---
    export_callbacks! {
        allocUnsafe => super::alloc_unsafe,
        build => JSBundler::build_fn,
        color => bun_css::CssColor::js_function_color,
        connect => host_fn::wrap_static_method!(api::Listener, connect, false),
        createParsedShellScript => bun_shell::ParsedShellScript::create_parsed_shell_script,
        createShellInterpreter => bun_shell::Interpreter::create_shell_interpreter,
        deflateSync => JSZlib::deflate_sync,
        file => WebCore::Blob::construct_bun_file,
        gunzipSync => JSZlib::gunzip_sync,
        gzipSync => JSZlib::gzip_sync,
        indexOfLine => super::index_of_line,
        inflateSync => JSZlib::inflate_sync,
        jest => Jest::call,
        listen => host_fn::wrap_static_method!(api::Listener, listen, false),
        mmap => super::mmap_file,
        nanoseconds => super::nanoseconds,
        openInEditor => super::open_in_editor,
        registerMacro => super::register_macro,
        resolve => super::resolve,
        resolveSync => super::resolve_sync,
        serve => super::serve,
        sha => host_fn::wrap_static_method!(Crypto::SHA512_256, hash_, true),
        shellEscape => super::shell_escape,
        shrink => super::shrink,
        stringWidth => super::string_width,
        sleepSync => super::sleep_sync,
        spawn => host_fn::wrap_static_method!(api::Subprocess, spawn, false),
        spawnSync => host_fn::wrap_static_method!(api::Subprocess, spawn_sync, false),
        udpSocket => host_fn::wrap_static_method!(api::UDPSocket, udp_socket, false),
        which => super::which,
        write => WebCore::Blob::write_file,
        zstdCompressSync => JSZstd::compress_sync,
        zstdDecompressSync => JSZstd::decompress_sync,
        zstdCompress => JSZstd::compress,
        zstdDecompress => JSZstd::decompress,
    }
    // --- Callbacks ---

    // --- Lazy property callbacks ---
    export_lazy_prop_callbacks! {
        Archive => super::get_archive_constructor,
        CryptoHasher => Crypto::CryptoHasher::getter,
        CSRF => super::get_csrf_object,
        FFI => FFIObject::getter,
        FileSystemRouter => super::get_file_system_router,
        Glob => super::get_glob_constructor,
        Image => super::get_image_constructor,
        MD4 => Crypto::MD4::getter,
        MD5 => Crypto::MD5::getter,
        SHA1 => Crypto::SHA1::getter,
        SHA224 => Crypto::SHA224::getter,
        SHA256 => Crypto::SHA256::getter,
        SHA384 => Crypto::SHA384::getter,
        SHA512 => Crypto::SHA512::getter,
        SHA512_256 => Crypto::SHA512_256::getter,
        JSONC => super::get_jsonc_object,
        markdown => super::get_markdown_object,
        TOML => super::get_toml_object,
        JSON5 => super::get_json5_object,
        YAML => super::get_yaml_object,
        Transpiler => super::get_transpiler_constructor,
        argv => super::get_argv,
        cron => cron::get_cron_object,
        cwd => super::get_cwd,
        embeddedFiles => super::get_embedded_files,
        enableANSIColors => super::enable_ansi_colors,
        hash => super::get_hash_object,
        inspect => super::get_inspect,
        origin => super::get_origin,
        semver => super::get_semver,
        unsafe => super::get_unsafe,
        S3Client => super::get_s3_client_constructor,
        s3 => super::get_s3_default_client,
        ValkeyClient => super::get_valkey_client_constructor,
        valkey => super::get_valkey_default_client,
        Terminal => super::get_terminal_constructor,
    }
    // --- Lazy property callbacks ---

    // --- Getters ---
    pub use super::get_main as main;
    // --- Getters ---

    // --- Setters ---
    pub use super::set_main;
    // --- Setters ---

    pub const fn lazy_property_callback_name(base_name: &str) -> &'static str {
        // TODO(port): comptime string concat — replaced by macro `${concat(..)}` above.
        const_format::concatcp!("BunObject_lazyPropCb_", base_name)
    }

    pub const fn callback_name(base_name: &str) -> &'static str {
        // TODO(port): comptime string concat — replaced by macro `${concat(..)}` above.
        const_format::concatcp!("BunObject_callback_", base_name)
    }

    // type LazyPropertyCallback = extern "C" fn(*mut JSGlobalObject, *mut JSObject) -> JSValue
    // (the `callconv(jsc.conv)` ABI is emitted by `#[bun_jsc::host_fn]` / the macro above;
    // see PORTING.md §FFI — cannot write `extern jsc_conv!()` in Rust.)

    // --- LazyProperty initializers ---
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject__createBunStdin(g: *mut JSGlobalObject) -> JSValue {
        // SAFETY: JSC always passes a valid global.
        unsafe { super::create_bun_stdin(&*g) }
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject__createBunStderr(g: *mut JSGlobalObject) -> JSValue {
        unsafe { super::create_bun_stderr(&*g) }
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject__createBunStdout(g: *mut JSGlobalObject) -> JSValue {
        unsafe { super::create_bun_stdout(&*g) }
    }
    // --- LazyProperty initializers ---

    // --- Getters ---
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject_getter_main(g: *mut JSGlobalObject) -> JSValue {
        unsafe { super::get_main(&*g) }
    }
    // --- Getters ---

    // --- Setters ---
    #[unsafe(no_mangle)]
    pub extern "C" fn BunObject_setter_main(g: *mut JSGlobalObject, v: JSValue) -> bool {
        unsafe { super::set_main(&*g, v) }
    }
    // --- Setters ---
}

#[bun_jsc::host_fn]
pub fn shell_escape(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(1);
    if arguments.len() < 1 {
        return global_this.throw("shell escape expected at least 1 argument", format_args!());
    }

    let jsval = arguments.ptr[0];
    let bunstr = jsval.to_bun_string(global_this)?;
    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }
    // bunstr derefs on Drop

    let mut outbuf: Vec<u8> = Vec::new();

    if bun_shell::needs_escape_bunstr(&bunstr) {
        let result = bun_shell::escape_bun_str(&bunstr, &mut outbuf, true)?;
        if !result {
            return global_this.throw(
                "String has invalid utf-16: {s}",
                format_args!("{}", bstr::BStr::new(bunstr.byte_slice())),
            );
        }
        let mut str = BunString::clone_utf8(&outbuf[..]);
        return Ok(str.transfer_to_js(global_this));
    }

    Ok(jsval)
}

pub fn braces(
    global: &JSGlobalObject,
    brace_str: BunString,
    opts: gen::BracesOptions,
) -> JsResult<JSValue> {
    let brace_slice = brace_str.to_utf8();

    // PERF(port): was arena bulk-free — profile in Phase B
    let mut arena = bun_alloc::Arena::new();

    let lexer_output = 'lexer_output: {
        if strings::is_all_ascii(brace_slice.slice()) {
            break 'lexer_output match Braces::Lexer::tokenize(&arena, brace_slice.slice()) {
                Ok(v) => v,
                Err(err) => return global.throw_error(err, "failed to tokenize braces"),
            };
        }

        match Braces::NewLexer::<{ Braces::Encoding::Wtf8 }>::tokenize(&arena, brace_slice.slice())
        {
            Ok(v) => break 'lexer_output v,
            Err(err) => return global.throw_error(err, "failed to tokenize braces"),
        }
    };

    let expansion_count = Braces::calculate_expanded_amount(&lexer_output.tokens[..]);

    if opts.tokenize {
        let mut str: Vec<u8> = Vec::new();
        // TODO(port): std.json.fmt — need a JSON `Display` for the token list
        write!(&mut str, "{}", bun_json::fmt(&lexer_output.tokens[..])).expect("oom");
        let mut bun_str = BunString::from_bytes(&str);
        return Ok(bun_str.to_js(global));
    }
    if opts.parse {
        let mut parser = Braces::Parser::init(&lexer_output.tokens[..], &arena);
        let ast_node = match parser.parse() {
            Ok(v) => v,
            Err(err) => return global.throw_error(err, "failed to parse braces"),
        };
        let mut str: Vec<u8> = Vec::new();
        // TODO(port): std.json.fmt
        write!(&mut str, "{}", bun_json::fmt(&ast_node)).expect("oom");
        let mut bun_str = BunString::from_bytes(&str);
        return Ok(bun_str.to_js(global));
    }

    if expansion_count == 0 {
        return Ok(BunString::to_js_array(global, &[brace_str]));
    }

    // Non-AST crate: result containers use plain Vec (arena is only for Braces::* internals).
    let mut expanded_strings: Vec<Vec<u8>> = Vec::with_capacity(expansion_count);
    for _ in 0..expansion_count {
        expanded_strings.push(Vec::new());
    }

    match Braces::expand(
        &arena,
        &lexer_output.tokens[..],
        &mut expanded_strings,
        lexer_output.contains_nested,
    ) {
        Ok(()) => {}
        Err(e) if e == bun_core::err!("OutOfMemory") => return Err(e.into()),
        Err(_) => {
            return global.throw_pretty("Unexpected token while expanding braces", format_args!())
        }
    }

    let mut out_strings: Vec<BunString> = Vec::with_capacity(expansion_count);
    for i in 0..expansion_count {
        out_strings.push(BunString::from_bytes(&expanded_strings[i][..]));
    }

    Ok(BunString::to_js_array(global, &out_strings[..]))
}

#[bun_jsc::host_fn]
pub fn which(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(2);
    let path_buf = bun_paths::path_buffer_pool().get();
    let mut arguments = CallFrame::ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
    let Some(path_arg) = arguments.next_eat() else {
        return global_this.throw("which: expected 1 argument, got 0", format_args!());
    };

    let mut path_str = ZigString::Slice::empty();
    let mut bin_str = ZigString::Slice::empty();
    let mut cwd_str = ZigString::Slice::empty();
    // path_str / bin_str / cwd_str deinit on Drop

    if path_arg.is_empty_or_undefined_or_null() {
        return Ok(JSValue::NULL);
    }

    bin_str = path_arg.to_slice(global_this)?;
    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if bin_str.len() >= MAX_PATH_BYTES {
        return global_this.throw("bin path is too long", format_args!());
    }

    if bin_str.len() == 0 {
        return Ok(JSValue::NULL);
    }

    path_str = ZigString::Slice::from_utf8_never_free(
        global_this.bun_vm().transpiler.env.get(b"PATH").unwrap_or(b""),
    );
    cwd_str = ZigString::Slice::from_utf8_never_free(
        global_this.bun_vm().transpiler.fs.top_level_dir,
    );

    if let Some(arg) = arguments.next_eat() {
        if !arg.is_empty_or_undefined_or_null() && arg.is_object() {
            if let Some(str_) = arg.get(global_this, "PATH")? {
                path_str = str_.to_slice(global_this)?;
            }

            if let Some(str_) = arg.get(global_this, "cwd")? {
                cwd_str = str_.to_slice(global_this)?;
            }
        }
    }

    if let Some(bin_path) =
        Which::which(&path_buf, path_str.slice(), cwd_str.slice(), bin_str.slice())
    {
        return Ok(ZigString::init(bin_path).with_encoding().to_js(global_this));
    }

    Ok(JSValue::NULL)
}

#[bun_jsc::host_fn]
pub fn inspect_table(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut args_buf = callframe.arguments_undef(5);
    let all_arguments = args_buf.as_mut();
    if all_arguments[0].is_undefined_or_null() || !all_arguments[0].is_object() {
        return Ok(BunString::empty().to_js(global_this));
    }

    for arg in all_arguments.iter() {
        arg.protect();
    }
    let _unprotect = scopeguard::guard((), |_| {
        for arg in all_arguments.iter() {
            arg.unprotect();
        }
    });

    let arguments = &mut all_arguments[..];
    let value = arguments[0];

    if !arguments[1].is_array() {
        arguments[2] = arguments[1];
        arguments[1] = JSValue::UNDEFINED;
    }

    let mut format_options = ConsoleObject::FormatOptions {
        enable_colors: false,
        add_newline: false,
        flush: false,
        max_depth: 5,
        quote_strings: true,
        ordered_properties: false,
        single_line: true,
        ..Default::default()
    };
    if arguments[2].is_object() {
        format_options.from_js(global_this, &arguments[2..])?;
    }

    // very stable memory address
    let mut array: Vec<u8> = Vec::new();

    let properties: JSValue = if arguments[1].js_type().is_array() {
        arguments[1]
    } else {
        JSValue::UNDEFINED
    };
    let mut table_printer =
        ConsoleObject::TablePrinter::init(global_this, ConsoleObject::Kind::Log, value, properties)?;
    table_printer.value_formatter.depth = format_options.max_depth;
    table_printer.value_formatter.ordered_properties = format_options.ordered_properties;
    table_printer.value_formatter.single_line = format_options.single_line;

    let print_result = if format_options.enable_colors {
        table_printer.print_table::<_, true>(&mut array)
    } else {
        table_printer.print_table::<_, false>(&mut array)
    };
    if print_result.is_err() {
        if !global_this.has_exception() {
            return global_this.throw_out_of_memory();
        }
        return Ok(JSValue::ZERO);
    }

    // writer.flush(): Vec<u8> writer is unbuffered; nothing to flush.

    BunString::create_utf8_for_js(global_this, &array)
}

#[bun_jsc::host_fn]
pub fn inspect(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(4).slice();
    if arguments.is_empty() {
        return Ok(BunString::empty().to_js(global_this));
    }

    for arg in arguments {
        arg.protect();
    }
    let _unprotect = scopeguard::guard((), |_| {
        for arg in arguments {
            arg.unprotect();
        }
    });

    let mut format_options = ConsoleObject::FormatOptions {
        enable_colors: false,
        add_newline: false,
        flush: false,
        max_depth: 8,
        quote_strings: true,
        ordered_properties: false,
        ..Default::default()
    };
    if arguments.len() > 1 {
        format_options.from_js(global_this, &arguments[1..])?;
    }

    // very stable memory address
    let mut array: Vec<u8> = Vec::new();
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    ConsoleObject::format2(
        ConsoleObject::Kind::Debug,
        global_this,
        arguments.as_ptr(),
        1,
        &mut array,
        format_options,
    )?;
    if global_this.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    // writer.flush(): Vec<u8> is unbuffered.

    // we are going to always clone to keep things simple for now
    // the common case here will be stack-allocated, so it should be fine
    let out = ZigString::init(&array).with_encoding();
    let ret = out.to_js(global_this);

    Ok(ret)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__inspect(global_this: *mut JSGlobalObject, value: JSValue) -> BunString {
    // SAFETY: caller is C++ passing a live global.
    let global_this = unsafe { &*global_this };
    // very stable memory address
    let mut array: Vec<u8> = Vec::new();

    let mut formatter = ConsoleObject::Formatter {
        global_this,
        ..Default::default()
    };
    if write!(&mut array, "{}", value.to_fmt(&mut formatter)).is_err() {
        return BunString::empty();
    }
    BunString::clone_utf8(&array)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__inspect_singleline(
    global_this: *mut JSGlobalObject,
    value: JSValue,
) -> BunString {
    // SAFETY: caller is C++ passing a live global.
    let global_this = unsafe { &*global_this };
    let mut array: Vec<u8> = Vec::new();
    if ConsoleObject::format2(
        ConsoleObject::Kind::Debug,
        global_this,
        core::slice::from_ref(&value).as_ptr(),
        1,
        &mut array,
        ConsoleObject::FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            max_depth: u16::MAX,
            quote_strings: true,
            ordered_properties: false,
            single_line: true,
            ..Default::default()
        },
    )
    .is_err()
    {
        return BunString::empty();
    }
    if global_this.has_exception() {
        return BunString::empty();
    }
    BunString::clone_utf8(&array)
}

pub fn get_inspect(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    let fun = JSFunction::create(global_object, "inspect", inspect, 2, Default::default());
    let mut str = ZigString::init(b"nodejs.util.inspect.custom");
    fun.put(
        global_object,
        ZigString::static_(b"custom"),
        JSValue::symbol_for(global_object, &mut str),
    );
    fun.put(
        global_object,
        ZigString::static_(b"table"),
        JSFunction::create(global_object, "table", inspect_table, 3, Default::default()),
    );
    fun
}

#[bun_jsc::host_fn]
pub fn register_macro(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(2);
    let arguments = arguments_.slice();
    if arguments.len() != 2 || !arguments[0].is_number() {
        return global_object
            .throw_invalid_arguments("Internal error registering macros: invalid args", format_args!());
    }
    let id = arguments[0].to_int32();
    if id == -1 || id == 0 {
        return global_object
            .throw_invalid_arguments("Internal error registering macros: invalid id", format_args!());
    }

    if !arguments[1].is_cell() || !arguments[1].is_callable() {
        // TODO: add "toTypeOf" helper
        return global_object.throw("Macro must be a function", format_args!());
    }

    let get_or_put_result = VirtualMachine::get()
        .macros
        .get_or_put(id)
        .expect("unreachable");
    if get_or_put_result.found_existing {
        // SAFETY: value_ptr returned from get_or_put points to a live slot in the map for
        // the map's lifetime; found_existing implies the slot is initialized.
        unsafe { (*get_or_put_result.value_ptr).as_ref().unwrap() }
            .value()
            .unprotect();
    }

    arguments[1].protect();
    // SAFETY: value_ptr returned from get_or_put points to a live, writable slot in the map.
    unsafe { *get_or_put_result.value_ptr = arguments[1].as_object_ref() };

    Ok(JSValue::UNDEFINED)
}

pub fn get_cwd(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    ZigString::init(VirtualMachine::get().transpiler.fs.top_level_dir).to_js(global_this)
}

pub fn get_origin(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    ZigString::init(VirtualMachine::get().origin.origin).to_js(global_this)
}

pub fn enable_ansi_colors(_global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSValue::from(Output::enable_ansi_colors_stdout() || Output::enable_ansi_colors_stderr())
}

// callconv(jsc.conv) — emitted by #[bun_jsc::host_call]; see PORTING.md §FFI.
fn get_main(global_this: &JSGlobalObject) -> JSValue {
    let vm = global_this.bun_vm();
    // If JS has set it to a custom value, use that one
    if let Some(overridden_main) = vm.overridden_main.get() {
        return overridden_main;
    }

    // Attempt to use the resolved filesystem path
    // This makes `eval('require.main === module')` work when the main module is a symlink.
    // This behavior differs slightly from Node. Node sets the `id` to `.` when the main module is a symlink.
    'use_resolved_path: {
        if vm.main_resolved_path.is_empty() {
            // If it's from eval, don't try to resolve it.
            if strings::has_suffix(vm.main, b"[eval]") {
                break 'use_resolved_path;
            }
            if strings::has_suffix(vm.main, b"[stdin]") {
                break 'use_resolved_path;
            }

            let Ok(fd) = sys::openat_a(
                if cfg!(windows) { Fd::INVALID } else { Fd::cwd() },
                vm.main,
                // Open with the minimum permissions necessary for resolving the file path.
                if cfg!(target_os = "linux") {
                    sys::O::PATH
                } else {
                    sys::O::RDONLY
                },
                0,
            )
            .unwrap()
            else {
                break 'use_resolved_path;
            };

            let _close = scopeguard::guard(fd, |fd| fd.close());
            #[cfg(windows)]
            {
                let mut wpath = WPathBuffer::uninit();
                let Ok(fdpath) = bun_sys::get_fd_path_w(fd, &mut wpath) else {
                    break 'use_resolved_path;
                };
                vm.main_resolved_path = BunString::clone_utf16(fdpath);
            }
            #[cfg(not(windows))]
            {
                let mut path = PathBuffer::uninit();
                let Ok(fdpath) = bun_sys::get_fd_path(fd, &mut path) else {
                    break 'use_resolved_path;
                };

                // Bun.main === otherId will be compared many times, so let's try to create an atom string if we can.
                if let Some(atom) = BunString::try_create_atom(fdpath) {
                    vm.main_resolved_path = atom;
                } else {
                    vm.main_resolved_path = BunString::clone_utf8(fdpath);
                }
            }
        }

        return vm
            .main_resolved_path
            .to_js(global_this)
            .unwrap_or(JSValue::ZERO);
    }

    ZigString::init(vm.main).to_js(global_this)
}

fn set_main(global_this: &JSGlobalObject, new_value: JSValue) -> bool {
    global_this.bun_vm().overridden_main.set(global_this, new_value);
    true
}

pub fn get_argv(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    node::process::get_argv(global_this)
}

#[bun_jsc::host_fn]
pub fn open_in_editor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let edit = &mut VirtualMachine::get().rare_data().editor_context;
    let args = callframe.arguments_old(4);
    let mut arguments = CallFrame::ArgumentsSlice::init(global_this.bun_vm(), args.slice());
    let mut path: &[u8] = b"";
    let mut editor_choice: Option<Editor> = None;
    let mut line: Option<&[u8]> = None;
    let mut column: Option<&[u8]> = None;

    if let Some(file_path_) = arguments.next_eat() {
        path = file_path_.to_slice(global_this)?.slice();
        // TODO(port): lifetime — Zig kept the ZigString.Slice alive via arena.
    }

    if let Some(opts) = arguments.next_eat() {
        if !opts.is_undefined_or_null() {
            if let Some(editor_val) = opts.get_truthy(global_this, "editor")? {
                let sliced = editor_val.to_slice(global_this)?;
                let prev_name = edit.name;

                if !strings::eql_long(prev_name, sliced.slice(), true) {
                    let prev = *edit;
                    edit.name = sliced.slice();
                    edit.detect_editor(VirtualMachine::get().transpiler.env);
                    editor_choice = edit.editor;
                    if editor_choice.is_none() {
                        *edit = prev;
                        return global_this.throw(
                            "Could not find editor \"{s}\"",
                            format_args!("{}", bstr::BStr::new(sliced.slice())),
                        );
                    } else if edit.name.as_ptr() == edit.path.as_ptr() {
                        edit.name = arguments
                            .arena
                            .alloc_slice_copy(edit.path)
                            // PERF(port): was arena dupe
                            ;
                        edit.path = edit.path;
                    }
                }
            }

            if let Some(line_) = opts.get_truthy(global_this, "line")? {
                line = Some(line_.to_slice(global_this)?.slice());
            }

            if let Some(column_) = opts.get_truthy(global_this, "column")? {
                column = Some(column_.to_slice(global_this)?.slice());
            }
        }
    }

    let editor = match editor_choice.or(edit.editor) {
        Some(e) => e,
        None => 'brk: {
            edit.auto_detect_editor(VirtualMachine::get().transpiler.env);
            match edit.editor {
                Some(e) => break 'brk e,
                None => {
                    return global_this.throw("Failed to auto-detect editor", format_args!());
                }
            }
        }
    };

    if path.is_empty() {
        return global_this.throw("No file path specified", format_args!());
    }

    if let Err(err) = editor.open(edit.path, path, line, column, &arguments.arena) {
        return global_this.throw(
            "Opening editor failed {s}",
            format_args!("{}", err.name()),
        );
    }

    Ok(JSValue::UNDEFINED)
}

pub fn get_public_path(to: &[u8], origin: URL, writer: &mut impl bun_io::Write) {
    get_public_path_with_asset_prefix(
        to,
        VirtualMachine::get().transpiler.fs.top_level_dir,
        origin,
        b"",
        writer,
        path::Platform::Loose,
    )
}

pub fn get_public_path_with_asset_prefix(
    to: &[u8],
    dir: &[u8],
    origin: URL,
    asset_prefix: &[u8],
    writer: &mut impl bun_io::Write,
    platform: path::Platform,
) {
    // TODO(port): `comptime platform` was a const-generic in Zig; demoted to runtime arg.
    // PERF(port): was comptime monomorphization — profile in Phase B
    let relative_path = if strings::has_prefix(to, dir) {
        strings::without_trailing_slash(&to[dir.len()..])
    } else {
        VirtualMachine::get()
            .transpiler
            .fs
            .relative_platform(dir, to, platform)
    };
    if origin.is_absolute() {
        if strings::has_prefix(relative_path, b"..") || strings::has_prefix(relative_path, b"./") {
            if writer.write_all(origin.origin).is_err() {
                return;
            }
            if writer.write_all(b"/abs:").is_err() {
                return;
            }
            if bun_paths::is_absolute(to) {
                let _ = writer.write_all(to);
            } else {
                let _ = writer.write_all(VirtualMachine::get().transpiler.fs.abs(&[to]));
            }
        } else {
            let _ = origin.join_write(writer, asset_prefix, b"", relative_path, b"");
        }
    } else {
        let _ = writer.write_all(strings::trim_left(relative_path, b"/"));
    }
}

#[bun_jsc::host_fn]
pub fn sleep_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(1);

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if arguments.len() < 1 {
        return global_object.throw_not_enough_arguments("sleepSync", 1, 0);
    }
    let arg = arguments.slice()[0];

    // The argument must be a number
    if !arg.is_number() {
        return global_object.throw_invalid_argument_type("sleepSync", "milliseconds", "number");
    }

    //NOTE: if argument is > max(i32) then it will be truncated
    let milliseconds = arg.coerce::<i32>(global_object)?;
    if milliseconds < 0 {
        return global_object.throw_invalid_arguments(
            "argument to sleepSync must not be negative, got {d}",
            format_args!("{milliseconds}"),
        );
    }

    // TODO(port): std.Thread.sleep — bun owns its own sleep; using thread::sleep
    // here matches Zig's blocking semantics (this is a sync API).
    std::thread::sleep(core::time::Duration::from_millis(
        u64::try_from(milliseconds).unwrap(),
    ));
    Ok(JSValue::UNDEFINED)
}

pub use Bun__gc as gc;
#[unsafe(no_mangle)]
pub extern "C" fn Bun__gc(vm: *mut VirtualMachine, sync: bool) -> usize {
    // SAFETY: caller is C++ passing a live VM.
    unsafe { (*vm).garbage_collect(sync) }
}

#[bun_jsc::host_fn]
pub fn shrink(global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    global_object.vm().shrink_footprint();
    Ok(JSValue::UNDEFINED)
}

fn do_resolve(global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<JSValue> {
    let mut args = CallFrame::ArgumentsSlice::init(global_this.bun_vm(), arguments);
    let Some(specifier) = args.protect_eat_next() else {
        return global_this
            .throw_invalid_arguments("Expected a specifier and a from path", format_args!());
    };

    if specifier.is_undefined_or_null() {
        return global_this.throw_invalid_arguments("specifier must be a string", format_args!());
    }

    let Some(from) = args.protect_eat_next() else {
        return global_this.throw_invalid_arguments("Expected a from path", format_args!());
    };

    if from.is_undefined_or_null() {
        return global_this.throw_invalid_arguments("from must be a string", format_args!());
    }

    let mut is_esm = true;
    if let Some(next) = args.next_eat() {
        if next.is_boolean() {
            is_esm = next.to_boolean();
        } else {
            return global_this.throw_invalid_arguments("esm must be a boolean", format_args!());
        }
    }

    let specifier_str = specifier.to_bun_string(global_this)?;
    let from_str = from.to_bun_string(global_this)?;
    do_resolve_with_args::<false>(global_this, specifier_str, from_str, is_esm, false)
}

fn do_resolve_with_args<const IS_FILE_PATH: bool>(
    ctx: &JSGlobalObject,
    specifier: BunString,
    from: BunString,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JsResult<JSValue> {
    let mut errorable: ErrorableString = Default::default();
    let mut query_string = BunString::empty();
    // query_string derefs on Drop

    let specifier_decoded = if specifier.has_prefix_comptime(b"file://") {
        jsc::URL::path_from_file_url(specifier)
    } else {
        specifier.dupe_ref()
    };
    // specifier_decoded derefs on Drop

    VirtualMachine::resolve_maybe_needs_trailing_slash(
        &mut errorable,
        ctx,
        specifier_decoded,
        from,
        &mut query_string,
        is_esm,
        IS_FILE_PATH,
        is_user_require_resolve,
    )?;

    if !errorable.success {
        return ctx.throw_value(errorable.result.err.value);
    }
    // errorable.result.value derefs on Drop (TODO(port): confirm ErrorableString Drop semantics)

    if !query_string.is_empty() {
        // PERF(port): was stack-fallback
        let mut arraylist: Vec<u8> = Vec::with_capacity(1024);
        write!(
            &mut arraylist,
            "{}{}",
            errorable.result.value, query_string
        )?;

        return Ok(ZigString::init_utf8(&arraylist).to_js(ctx));
    }

    Ok(errorable.result.value.to_js(ctx))
}

#[bun_jsc::host_fn]
pub fn resolve_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    do_resolve(global_object, callframe.arguments())
}

#[bun_jsc::host_fn]
pub fn resolve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3);
    let value = match do_resolve(global_object, arguments.slice()) {
        Ok(v) => v,
        Err(e) => {
            let err = global_object.take_error(e);
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_object,
                    err,
                ),
            );
        }
    };
    Ok(JSPromise::resolved_promise_value(global_object, value))
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolve(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing a live global.
    let global = unsafe { &*global };
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    let value = match do_resolve_with_args::<true>(global, specifier_str, source_str, is_esm, false)
    {
        Ok(v) => v,
        Err(_) => {
            let err = global.try_take_exception().unwrap();
            return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global, err,
            );
        }
    };

    JSPromise::resolved_promise_value(global, value)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSync(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing a live global.
    let global = unsafe { &*global };
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    if specifier_str.length() == 0 {
        let _ = global
            .err(jsc::ErrCode::INVALID_ARG_VALUE, "The argument 'id' must be a non-empty string. Received ''", format_args!())
            .throw();
        return JSValue::ZERO;
    }

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>,
        (global, specifier_str, source_str, is_esm, is_user_require_resolve),
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSyncWithPaths(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
    paths_ptr: *const BunString,
    paths_len: usize,
) -> JSValue {
    // SAFETY: caller is C++ passing a live global; paths_ptr is valid for paths_len.
    let global = unsafe { &*global };
    let paths: &[BunString] = if paths_len == 0 {
        &[]
    } else {
        unsafe { core::slice::from_raw_parts(paths_ptr, paths_len) }
    };

    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    if specifier_str.length() == 0 {
        let _ = global
            .err(jsc::ErrCode::INVALID_ARG_VALUE, "The argument 'id' must be a non-empty string. Received ''", format_args!())
            .throw();
        return JSValue::ZERO;
    }

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };

    let bun_vm = global.bun_vm();
    debug_assert!(bun_vm.transpiler.resolver.custom_dir_paths.is_none());
    bun_vm.transpiler.resolver.custom_dir_paths = Some(paths);
    let _reset = scopeguard::guard((), |_| {
        bun_vm.transpiler.resolver.custom_dir_paths = None;
    });

    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>,
        (global, specifier_str, source_str, is_esm, is_user_require_resolve),
    )
}

bun_output::declare_scope!(importMetaResolve, visible);

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSyncWithStrings(
    global: *mut JSGlobalObject,
    specifier: *mut BunString,
    source: *mut BunString,
    is_esm: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing live pointers.
    let global = unsafe { &*global };
    let specifier = unsafe { &*specifier };
    let source = unsafe { &*source };
    bun_output::scoped_log!(importMetaResolve, "source: {}, specifier: {}", source, specifier);
    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>,
        (global, *specifier, *source, is_esm, false),
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveSyncWithSource(
    global: *mut JSGlobalObject,
    specifier: JSValue,
    source: *mut BunString,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JSValue {
    // SAFETY: caller is C++ passing live pointers.
    let global = unsafe { &*global };
    let source = unsafe { &*source };
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    if specifier_str.length() == 0 {
        let _ = global
            .err(jsc::ErrCode::INVALID_ARG_VALUE, "The argument 'id' must be a non-empty string. Received ''", format_args!())
            .throw();
        return JSValue::ZERO;
    }
    jsc::to_js_host_call(
        global,
        do_resolve_with_args::<true>,
        (global, specifier_str, *source, is_esm, is_user_require_resolve),
    )
}

#[bun_jsc::host_fn]
pub fn index_of_line(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(2);
    let arguments = arguments_.slice();
    if arguments.is_empty() {
        return Ok(JSValue::js_number_from_int32(-1));
    }

    let Some(buffer) = arguments[0].as_array_buffer(global_this) else {
        return Ok(JSValue::js_number_from_int32(-1));
    };

    let mut offset: usize = 0;
    if arguments.len() > 1 {
        let offset_value = arguments[1].coerce::<i64>(global_this)?;
        offset = usize::try_from(offset_value.max(0)).unwrap();
    }

    let bytes = buffer.byte_slice();
    let mut current_offset = offset;
    let end = bytes.len() as u32;

    while current_offset < end as usize {
        if let Some(i) = strings::index_of_newline_or_non_ascii(bytes, current_offset as u32) {
            let byte = bytes[i as usize];
            if byte > 0x7F {
                current_offset += (strings::wtf8_byte_sequence_length(byte) as usize).max(1);
                continue;
            }

            if byte == b'\n' {
                return Ok(JSValue::js_number(i));
            }

            current_offset = i as usize + 1;
        } else {
            break;
        }
    }

    Ok(JSValue::js_number_from_int32(-1))
}

pub use bun_runtime::crypto as crypto_mod;
// TODO(port): `pub const Crypto = @import("../crypto/crypto.zig");` re-exports
// the crypto module under this file's namespace; in Rust the canonical path is
// `bun_runtime::crypto`.

#[bun_jsc::host_fn]
pub fn nanoseconds(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    let ns = global_this.bun_vm().origin_timer.read();
    Ok(JSValue::js_number_from_uint64(ns))
}

#[bun_jsc::host_fn]
pub fn serve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(2).slice();
    let mut config: jsc::api::ServerConfig = 'brk: {
        let mut args = CallFrame::ArgumentsSlice::init(global_object.bun_vm(), arguments);
        let mut config = jsc::api::ServerConfig::default();

        jsc::api::ServerConfig::from_js(
            global_object,
            &mut config,
            &mut args,
            jsc::api::ServerConfigFromJSOptions {
                allow_bake_config: bun_core::FeatureFlags::bake(),
                is_fetch_required: true,
                has_user_routes: false,
            },
        )?;

        if global_object.has_exception() {
            drop(config);
            return Ok(JSValue::ZERO);
        }

        break 'brk config;
    };

    let vm = global_object.bun_vm();

    if config.allow_hot {
        if let Some(hot) = vm.hot_map() {
            if config.id.is_empty() {
                config.id = config.compute_id();
            }

            if let Some(entry) = hot.get_entry(&config.id) {
                // TODO(port): Zig used `@field(@TypeOf(entry.tag()), @typeName(Type))`
                // to dispatch on the TaggedPtrUnion tag — match on the enum here.
                match entry.tag() {
                    jsc::api::HotMapTag::HTTPServer => {
                        let server: &mut jsc::api::HTTPServer = entry.as_::<jsc::api::HTTPServer>();
                        server.on_reload_from_zig(&mut config, global_object);
                        return Ok(server.js_value.try_get().unwrap_or(JSValue::UNDEFINED));
                    }
                    jsc::api::HotMapTag::DebugHTTPServer => {
                        let server: &mut jsc::api::DebugHTTPServer =
                            entry.as_::<jsc::api::DebugHTTPServer>();
                        server.on_reload_from_zig(&mut config, global_object);
                        return Ok(server.js_value.try_get().unwrap_or(JSValue::UNDEFINED));
                    }
                    jsc::api::HotMapTag::DebugHTTPSServer => {
                        let server: &mut jsc::api::DebugHTTPSServer =
                            entry.as_::<jsc::api::DebugHTTPSServer>();
                        server.on_reload_from_zig(&mut config, global_object);
                        return Ok(server.js_value.try_get().unwrap_or(JSValue::UNDEFINED));
                    }
                    jsc::api::HotMapTag::HTTPSServer => {
                        let server: &mut jsc::api::HTTPSServer =
                            entry.as_::<jsc::api::HTTPSServer>();
                        server.on_reload_from_zig(&mut config, global_object);
                        return Ok(server.js_value.try_get().unwrap_or(JSValue::UNDEFINED));
                    }
                    _ => {}
                }
            }
        }
    }

    macro_rules! serve_with {
        ($ServerType:ty) => {{
            let server = <$ServerType>::init(&mut config, global_object)?;
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            let route_list_object = server.listen();
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            let obj = server.to_js(global_object);
            if !route_list_object.is_empty() {
                <$ServerType>::js::route_list_set_cached(obj, global_object, route_list_object);
            }
            server.js_value.set_strong(obj, global_object);

            if config.allow_hot {
                if let Some(hot) = global_object.bun_vm().hot_map() {
                    hot.insert(&config.id, server);
                }
            }

            if let Some(debugger) = vm.debugger.as_mut() {
                debugger
                    .http_server_agent
                    .notify_server_started(jsc::api::AnyServer::from(server));
                // bun.handleOom(err) — Rust aborts on OOM by default.
                debugger
                    .http_server_agent
                    .notify_server_routes_updated(jsc::api::AnyServer::from(server))
                    .expect("oom");
            }

            return Ok(obj);
        }};
    }

    // PORT NOTE: Zig used nested `switch (bool) { inline else => |c| ... }` to
    // monomorphize over (has_ssl_config, development). Expanded here.
    let has_ssl_config = config.ssl_config.is_some();
    let development = config.is_development();
    match (development, has_ssl_config) {
        (true, true) => serve_with!(jsc::api::DebugHTTPSServer),
        (true, false) => serve_with!(jsc::api::DebugHTTPServer),
        (false, true) => serve_with!(jsc::api::HTTPSServer),
        (false, false) => serve_with!(jsc::api::HTTPServer),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__escapeHTML16(
    global_object: *mut JSGlobalObject,
    input_value: JSValue,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    debug_assert!(len > 0);
    // SAFETY: caller passes a valid global and a valid [ptr, len) UTF-16 slice.
    let global_object = unsafe { &*global_object };
    let input_slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    let escaped = match strings::escape_html_for_utf16_input(input_slice) {
        Ok(v) => v,
        Err(_) => {
            let _ = global_object
                .throw_value(ZigString::init(b"Out of memory").to_error_instance(global_object));
            return JSValue::ZERO;
        }
    };

    match escaped {
        strings::EscapedHTML::Static(val) => ZigString::init(val).to_js(global_object),
        strings::EscapedHTML::Original => input_value,
        strings::EscapedHTML::Allocated(escaped_html) => {
            ZigString::from16(escaped_html.as_ptr(), escaped_html.len())
                .to_external_value(global_object)
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__escapeHTML8(
    global_object: *mut JSGlobalObject,
    input_value: JSValue,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    debug_assert!(len > 0);
    // SAFETY: caller passes a valid global and a valid [ptr, len) byte slice.
    let global_object = unsafe { &*global_object };
    let input_slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    // PERF(port): was stack-fallback (256 bytes) — profile in Phase B

    let escaped = match strings::escape_html_for_latin1_input(input_slice) {
        Ok(v) => v,
        Err(_) => {
            let _ = global_object
                .throw_value(ZigString::init(b"Out of memory").to_error_instance(global_object));
            return JSValue::ZERO;
        }
    };

    match escaped {
        strings::EscapedHTML::Static(val) => ZigString::init(val).to_js(global_object),
        strings::EscapedHTML::Original => input_value,
        strings::EscapedHTML::Allocated(escaped_html) => {
            if cfg!(debug_assertions) {
                // the output should always be longer than the input
                debug_assert!(escaped_html.len() > input_slice.len());

                // assert we do not allocate a new string unnecessarily
                debug_assert!(input_slice != escaped_html);
            }

            if input_slice.len() <= 32 {
                let zig_str = ZigString::init(&escaped_html);
                let out = zig_str.to_atomic_value(global_object);
                return out;
            }

            ZigString::init(&escaped_html).to_external_value(global_object)
        }
    }
}

#[bun_jsc::host_fn]
pub fn alloc_unsafe(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(1);
    let size = arguments.ptr[0];
    if !size.is_uint32_as_any_int() {
        return global_this.throw_invalid_arguments("Expected a positive number", format_args!());
    }
    Ok(JSValue::create_uninitialized_uint8_array(
        global_this,
        size.to_uint64_no_truncate(),
    ))
}

#[bun_jsc::host_fn]
pub fn mmap_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        return global_this.throw_todo("mmapFile is not supported on Windows");
    }

    #[cfg(not(windows))]
    {
        let arguments_ = callframe.arguments_old(2);
        let mut args = CallFrame::ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());

        let mut buf = PathBuffer::uninit();
        let path = 'brk: {
            if let Some(path) = args.next_eat() {
                if path.is_string() {
                    let path_str = path.to_slice(global_this)?;
                    if path_str.len() > MAX_PATH_BYTES {
                        return global_this
                            .throw_invalid_arguments("Path too long", format_args!());
                    }
                    let paths = &[path_str.slice()];
                    break 'brk bun_paths::join_abs_string_buf(
                        bun_fs::FileSystem::instance().top_level_dir,
                        &mut buf,
                        paths,
                        bun_paths::Platform::Auto,
                    );
                }
            }
            return global_this.throw_invalid_arguments("Expected a path", format_args!());
        };

        let path_len = path.len();
        buf[path_len] = 0;

        // SAFETY: buf[path_len] == 0 written above
        let buf_z = unsafe { bun_str::ZStr::from_raw(buf.as_ptr(), path_len) };

        let mut flags = sys::c::MAP {
            type_: sys::c::MapType::SHARED,
            ..Default::default()
        };

        // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
        let mut offset: usize = 0;
        let mut map_size: Option<usize> = None;

        if let Some(opts) = args.next_eat() {
            flags.type_ = if opts.get_boolean_loose(global_this, "shared")?.unwrap_or(true) {
                sys::c::MapType::SHARED
            } else {
                sys::c::MapType::PRIVATE
            };

            // TODO(port): @hasField(std.c.MAP, "SYNC") — gated by target_os in Rust.
            #[cfg(target_os = "linux")]
            if opts.get_boolean_loose(global_this, "sync")?.unwrap_or(false) {
                flags.type_ = sys::c::MapType::SHARED_VALIDATE;
                flags.sync = true;
            }

            if let Some(value) = opts.get(global_this, "size")? {
                let size_value = value.coerce_to_int64(global_this)?;
                if size_value < 0 {
                    return global_this.throw_invalid_arguments(
                        "size must be a non-negative integer",
                        format_args!(),
                    );
                }
                map_size = Some(usize::try_from(size_value).unwrap());
            }

            if let Some(value) = opts.get(global_this, "offset")? {
                let offset_value = value.coerce_to_int64(global_this)?;
                if offset_value < 0 {
                    return global_this.throw_invalid_arguments(
                        "offset must be a non-negative integer",
                        format_args!(),
                    );
                }
                offset = usize::try_from(offset_value).unwrap();
                offset = bun_core::mem::align_backward_any_align(offset, bun_sys::page_size());
            }
        }

        let map = match sys::mmap_file(buf_z, flags, map_size, offset) {
            sys::Result::Ok(map) => map,
            sys::Result::Err(err) => {
                return global_this.throw_value(err.to_js(global_this)?);
            }
        };

        extern "C" fn munmap_dealloc(ptr: *mut c_void, size: *mut c_void) {
            // SAFETY: ptr is the original mmap base, size is its length stuffed into a pointer.
            let _ = unsafe {
                sys::munmap(core::slice::from_raw_parts(
                    ptr as *const u8,
                    size as usize,
                ))
            };
        }

        Ok(jsc::array_buffer::make_typed_array_with_bytes_no_copy(
            global_this,
            jsc::TypedArrayType::TypeUint8,
            map.as_ptr() as *mut c_void,
            map.len(),
            munmap_dealloc,
            map.len() as *mut c_void,
        ))
    }
}

pub fn get_transpiler_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::api::JSTranspiler::js::get_constructor(global_this)
}

pub fn get_file_system_router(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::api::FileSystemRouter::js::get_constructor(global_this)
}

pub fn get_hash_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    HashObject::create(global_this)
}

pub fn get_jsonc_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSONCObject::create(global_this)
}
pub fn get_markdown_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    MarkdownObject::create(global_this)
}
pub fn get_toml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    TOMLObject::create(global_this)
}

pub fn get_json5_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSON5Object::create(global_this)
}

pub fn get_yaml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    YAMLObject::create(global_this)
}

pub fn get_archive_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::api::Archive::js::get_constructor(global_this)
}

pub fn get_glob_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::api::Glob::js::get_constructor(global_this)
}

pub fn get_image_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::api::Image::js::get_constructor(global_this)
}

pub fn get_s3_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    WebCore::S3Client::js::get_constructor(global_this)
}

pub fn get_s3_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    global_this.bun_vm().rare_data().s3_default_client(global_this)
}

pub fn get_tls_default_ciphers(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    global_this.bun_vm().rare_data().tls_default_ciphers()
}

pub fn set_tls_default_ciphers(
    global_this: &JSGlobalObject,
    _: &JSObject,
    ciphers: JSValue,
) -> JSValue {
    global_this.bun_vm().rare_data().set_tls_default_ciphers(ciphers);
    JSValue::UNDEFINED
}

pub fn get_valkey_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    let valkey = match jsc::api::Valkey::create_no_js_no_pubsub(global_this, &[JSValue::UNDEFINED])
    {
        Ok(v) => v,
        Err(err) => {
            if err != jsc::JsError::Thrown {
                let _ = global_this.throw_error(err.into(), "Failed to create Redis client");
            }
            return JSValue::ZERO;
        }
    };

    let as_js = valkey.to_js(global_this);

    valkey.this_value = JsRef::init_weak(as_js);
    valkey._subscription_ctx = match SubscriptionCtx::init(valkey) {
        Ok(v) => v,
        Err(err) => {
            if err != jsc::JsError::Thrown {
                let _ = global_this.throw_error(err.into(), "Failed to create Redis client");
            }
            return JSValue::ZERO;
        }
    };

    as_js
}

pub fn get_valkey_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::api::Valkey::js::get_constructor(global_this)
}

pub fn get_terminal_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    api::Terminal::js::get_constructor(global_this)
}

pub fn get_embedded_files(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    let vm = global_this.bun_vm();
    let Some(graph) = vm.standalone_module_graph else {
        return JSValue::create_empty_array(global_this, 0);
    };

    let unsorted_files = graph.files.values();
    let mut sort_indices: Vec<u32> = Vec::with_capacity(unsorted_files.len());
    for index in 0..unsorted_files.len() {
        // Some % of people using `bun build --compile` want to obscure the source code
        // We don't really do that right now, but exposing the output source
        // code here as an easily accessible Blob is even worse for them.
        // So let's omit any source code files from the list.
        if !unsorted_files[index].appears_in_embedded_files_array() {
            continue;
        }
        sort_indices.push(u32::try_from(index).unwrap());
        // PERF(port): was assume_capacity
    }

    let mut i: u32 = 0;
    let array = JSValue::create_empty_array(global_this, sort_indices.len())?;
    sort_indices.sort_by(|a, b| {
        bun_standalone::StandaloneModuleGraph::File::less_than_by_index(unsorted_files, *a, *b)
    });
    for index in &sort_indices {
        let file = &unsorted_files[*index as usize];
        // We call .dupe() on this to ensure that we don't return a blob that might get freed later.
        let input_blob = file.blob(global_this);
        let blob = WebCore::Blob::new(input_blob.dupe_with_content_type(true));
        blob.name = input_blob.name.dupe_ref();
        array.put_index(global_this, i, blob.to_js(global_this))?;
        i += 1;
    }

    Ok(array)
}

pub fn get_semver(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    SemverObject::create(global_this)
}

pub fn get_unsafe(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    UnsafeObject::create(global_this)
}

#[bun_jsc::host_fn]
pub fn string_width(global_object: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    BunString::js_get_string_width(global_object, call_frame)
}

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
pub fn get_csrf_object(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    CSRFObject::create(global_object)
}

pub struct CSRFObject;

impl CSRFObject {
    pub fn create(global_this: &JSGlobalObject) -> JSValue {
        let object = JSValue::create_empty_object(global_this, 2);

        object.put(
            global_this,
            ZigString::static_(b"generate"),
            JSFunction::create(global_this, "generate", csrf_jsc::csrf__generate, 1, Default::default()),
        );

        object.put(
            global_this,
            ZigString::static_(b"verify"),
            JSFunction::create(global_this, "verify", csrf_jsc::csrf__verify, 1, Default::default()),
        );

        object
    }
}

// This is aliased to Bun.env
pub mod environment_variables {
    use super::*;

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvCount(
        global_object: *mut JSGlobalObject,
        ptr: *mut *mut &[u8],
    ) -> usize {
        // SAFETY: caller is C++ with live global; ptr is a valid out-param.
        let bun_vm = unsafe { (*global_object).bun_vm() };
        // TODO(port): map.map.keys().ptr — exposes raw pointer to the env-map
        // key slice array. The Rust StringMap should expose a `.keys_ptr()`
        // accessor that returns `*mut &[u8]` for FFI compat.
        unsafe { *ptr = bun_vm.transpiler.env.map.map.keys_ptr() };
        bun_vm.transpiler.env.map.map.unmanaged_entries_len()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvKey(
        ptr: *mut &[u8],
        i: usize,
        data_ptr: *mut *const u8,
    ) -> usize {
        // SAFETY: ptr was returned from Bun__getEnvCount; i < count.
        let item = unsafe { *ptr.add(i) };
        unsafe { *data_ptr = item.as_ptr() };
        item.len()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvValue(
        global_object: *mut JSGlobalObject,
        name: *mut ZigString,
        value: *mut ZigString,
    ) -> bool {
        // SAFETY: caller is C++ with live global; name/value are valid pointers.
        let global_object = unsafe { &*global_object };
        if let Some(val) = get_env_value(global_object, unsafe { *name }) {
            unsafe { *value = val };
            return true;
        }

        false
    }

    /// BunString variant of Bun__getEnvValue. The returned value borrows from
    /// the env map; caller must copy before the map can mutate.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvValueBunString(
        global_object: *mut JSGlobalObject,
        name: *mut BunString,
        value: *mut BunString,
    ) -> bool {
        // SAFETY: caller is C++ with live pointers.
        let global_object = unsafe { &*global_object };
        let vm = global_object.bun_vm();
        let name_slice = unsafe { (*name).to_utf8() };
        let Some(val) = vm.transpiler.env.get(name_slice.slice()) else {
            return false;
        };
        unsafe { *value = BunString::borrow_utf8(val) };
        true
    }

    /// Sync a process.env write back to the Zig-side env map so that Zig
    /// consumers (e.g. fetch's proxy resolution via env.getHttpProxyFor)
    /// observe the updated value. Used by custom setters for proxy-related
    /// env vars (HTTP_PROXY, HTTPS_PROXY, NO_PROXY and lowercase variants).
    ///
    /// Values are ref-counted in RareData.proxy_env_storage so that
    /// worker_threads share the parent's strings (refcount bumped at spawn)
    /// rather than cloning. A worker only allocates its own value if it
    /// writes to that var. Parent deref'ing on overwrite won't free the
    /// bytes while a worker still holds a ref.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__setEnvValue(
        global_object: *mut JSGlobalObject,
        name: *mut BunString,
        value: *mut BunString,
    ) {
        // SAFETY: caller is C++ with live pointers.
        let global_object = unsafe { &*global_object };
        let vm = global_object.bun_vm();
        let name_slice = unsafe { (*name).to_utf8() };

        let storage = &mut vm.proxy_env_storage;

        // Synchronize the slot swap + env.map.put against a concurrently
        // spawning worker's cloneFrom + env.map.cloneWithAllocator. Without
        // this, the worker could load the slot pointer between our deref
        // (refcount → 0 → free) and the null write below, then call ref()
        // on freed memory.
        let _guard = storage.lock.lock();

        let Some(slot) = storage.slot(name_slice.slice()) else {
            return;
        };

        // Deref our previous value. If a worker still holds a ref, the
        // bytes stay alive; if not, they're freed now.
        if let Some(old) = slot.ptr.take() {
            old.deref();
        }

        if unsafe { (*value).is_empty() } {
            // Store a static empty string rather than removing, so that
            // process.env.X reads back as "" (Node.js semantics) instead
            // of undefined. isNoProxy treats empty strings the same as
            // absent — no bypass.
            vm.transpiler.env.map.put(slot.key, b"");
            return;
        }

        let value_slice = unsafe { (*value).to_utf8() };
        let new_val = jsc::RareData::RefCountedEnvValue::create(value_slice.slice());
        *slot.ptr = Some(new_val);
        // slot.key is a static-lifetime string literal (the struct field
        // name); value bytes live in the ref-counted wrapper. map.put
        // stores both slice headers without duping.
        vm.transpiler.env.map.put(slot.key, new_val.bytes);
    }

    pub fn get_env_names(global_object: &JSGlobalObject, names: &mut [ZigString]) -> usize {
        let vm = global_object.bun_vm();
        let keys = vm.transpiler.env.map.map.keys();
        let len = names.len().min(keys.len());
        debug_assert_eq!(keys[..len].len(), names[..len].len());
        for (key, name) in keys[..len].iter().zip(names[..len].iter_mut()) {
            *name = ZigString::init_utf8(key);
        }
        len
    }

    pub fn get_env_value(global_object: &JSGlobalObject, name: ZigString) -> Option<ZigString> {
        let vm = global_object.bun_vm();
        let sliced = name.to_slice();
        let value = vm.transpiler.env.get(sliced.slice())?;
        Some(ZigString::init_utf8(value))
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportError(global_object: *mut JSGlobalObject, err: JSValue) {
    // SAFETY: caller is C++ with a live global.
    let _ = VirtualMachine::get().uncaught_exception(unsafe { &*global_object }, err, false);
}

#[allow(non_snake_case)]
pub mod JSZlib {
    use super::*;

    #[unsafe(no_mangle)]
    pub extern "C" fn reader_deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx was created from Box<ZlibReaderArrayList>::into_raw.
        let reader: *mut zlib::ZlibReaderArrayList = ctx as *mut zlib::ZlibReaderArrayList;
        unsafe {
            drop(core::mem::take(&mut (*reader).list));
            drop(Box::from_raw(reader));
        }
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn global_deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx is a mimalloc-allocated pointer.
        unsafe { bun_alloc::free_without_size(ctx) };
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn compressor_deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx was created from Box<ZlibCompressorArrayList>::into_raw.
        let compressor: *mut zlib::ZlibCompressorArrayList = ctx as *mut zlib::ZlibCompressorArrayList;
        unsafe {
            drop(core::mem::take(&mut (*compressor).list));
            drop(Box::from_raw(compressor));
        }
    }

    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    #[strum(serialize_all = "lowercase")]
    pub enum Library {
        Zlib,
        Libdeflate,
    }

    impl Library {
        // bun.ComptimeEnumMap(Library)
        pub static MAP: phf::Map<&'static [u8], Library> = phf::phf_map! {
            b"zlib" => Library::Zlib,
            b"libdeflate" => Library::Libdeflate,
        };
    }

    // This has to be `inline` due to the callframe.
    #[inline]
    fn get_options(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<(jsc::node::StringOrBuffer, Option<JSValue>)> {
        let arguments = callframe.arguments_old(2).slice();
        let buffer_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
            Some(arguments[1])
        } else if arguments.len() > 1 && !arguments[1].is_undefined() {
            return global_this
                .throw_invalid_arguments("Expected options to be an object", format_args!());
        } else {
            None
        };

        if let Some(buffer) = jsc::node::StringOrBuffer::from_js(global_this, buffer_value)? {
            return Ok((buffer, options_val));
        }

        global_this
            .throw_invalid_arguments("Expected buffer to be a string or buffer", format_args!())
    }

    #[bun_jsc::host_fn]
    pub fn gzip_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer, options_val, true)
    }

    #[bun_jsc::host_fn]
    pub fn inflate_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub fn deflate_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub fn gunzip_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer, options_val, true)
    }

    pub fn gunzip_or_inflate_sync(
        global_this: &JSGlobalObject,
        buffer: jsc::node::StringOrBuffer,
        options_val_: Option<JSValue>,
        is_gzip: bool,
    ) -> JsResult<JSValue> {
        let mut opts = zlib::Options {
            gzip: is_gzip,
            window_bits: if is_gzip { 31 } else { -15 },
            ..Default::default()
        };

        let mut library = Library::Zlib;
        if let Some(options_val) = options_val_ {
            if let Some(window) = options_val.get(global_this, "windowBits")? {
                opts.window_bits = window.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(level) = options_val.get(global_this, "level")? {
                opts.level = level.coerce::<i32>(global_this)?;
            }

            if let Some(mem_level) = options_val.get(global_this, "memLevel")? {
                opts.mem_level = mem_level.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(strategy) = options_val.get(global_this, "strategy")? {
                opts.strategy = strategy.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(library_value) = options_val.get_truthy(global_this, "library")? {
                if !library_value.is_string() {
                    return global_this
                        .throw_invalid_arguments("Expected library to be a string", format_args!());
                }

                library = match Library::MAP.from_js(global_this, library_value)? {
                    Some(v) => v,
                    None => {
                        return global_this.throw_invalid_arguments(
                            "Expected library to be one of 'zlib' or 'libdeflate'",
                            format_args!(),
                        )
                    }
                };
            }
        }

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let compressed = buffer.slice();

        let mut list: Vec<u8> = 'brk: {
            if is_gzip && compressed.len() > 64 {
                //   0   1   2   3   4   5   6   7
                //  +---+---+---+---+---+---+---+---+
                //  |     CRC32     |     ISIZE     |
                //  +---+---+---+---+---+---+---+---+
                let estimated_size: u32 = u32::from_ne_bytes(
                    compressed[compressed.len() - 4..][..4].try_into().unwrap(),
                );
                // If it's > 256 MB, let's rely on dynamic allocation to minimize the risk of OOM.
                if estimated_size > 0 && estimated_size < 256 * 1024 * 1024 {
                    break 'brk Vec::with_capacity((estimated_size as usize).max(64));
                }
            }

            break 'brk Vec::with_capacity(if compressed.len() > 512 {
                compressed.len()
            } else {
                32
            });
        };

        match library {
            Library::Zlib => {
                let reader = match zlib::ZlibReaderArrayList::init_with_options(
                    compressed,
                    &mut list,
                    zlib::Options {
                        window_bits: opts.window_bits,
                        level: opts.level,
                        ..Default::default()
                    },
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        drop(list);
                        if err == bun_core::err!("InvalidArgument") {
                            return global_this
                                .throw("Zlib error: Invalid argument", format_args!());
                        }
                        return global_this.throw_error(err, "Zlib error");
                    }
                };

                if let Err(_) = reader.read_all(true) {
                    let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                    return global_this
                        .throw_value(ZigString::init(msg).to_error_instance(global_this));
                }
                // PORT NOTE: Zig juggled list ownership into the reader so the
                // ArrayBuffer's deallocator could free it. In Rust, leak the
                // Vec into a raw slice and free via reader_deallocator.
                reader.list = core::mem::take(&mut reader.list);
                reader.list.shrink_to_fit();
                // TODO(port): list_ptr self-reference is now redundant; verify
                // ZlibReaderArrayList's Rust shape.
                reader.list_ptr = &mut reader.list;

                let mut array_buffer =
                    ArrayBuffer::from_bytes(reader.list.as_slice(), jsc::TypedArrayType::Uint8Array);
                Ok(array_buffer.to_js_with_context(
                    global_this,
                    Box::into_raw(reader) as *mut c_void,
                    reader_deallocator,
                ))
            }
            Library::Libdeflate => {
                let Some(decompressor) = bun_libdeflate::Decompressor::alloc() else {
                    drop(list);
                    return global_this.throw_out_of_memory();
                };
                // decompressor drops on scope exit
                loop {
                    // Zig passes list.allocatedSlice() (= [0..capacity]) every iteration;
                    // libdeflate restarts decompression from scratch on each call. Reset len
                    // so spare_capacity_mut_as_slice() yields the full [0..capacity] window.
                    list.clear();
                    let result = decompressor.decompress(
                        compressed,
                        list.spare_capacity_mut_as_slice(), // allocatedSlice()
                        if is_gzip {
                            bun_libdeflate::Encoding::Gzip
                        } else {
                            bun_libdeflate::Encoding::Deflate
                        },
                    );

                    // SAFETY: result.written ≤ list.capacity()
                    unsafe { list.set_len(result.written) };

                    if result.status == bun_libdeflate::Status::InsufficientSpace {
                        if list.capacity() > 1024 * 1024 * 1024 {
                            drop(list);
                            return global_this.throw_out_of_memory();
                        }

                        let new_cap = list.capacity() * 2;
                        list.reserve(new_cap.saturating_sub(list.len()));
                        continue;
                    }

                    if result.status == bun_libdeflate::Status::Success {
                        // SAFETY: result.written ≤ list.capacity() and bytes [0..written] were
                        // initialized by libdeflate above.
                        unsafe { list.set_len(result.written) };
                        break;
                    }

                    drop(list);
                    return global_this.throw(
                        "libdeflate returned an error: {s}",
                        format_args!("{}", <&'static str>::from(result.status)),
                    );
                }

                let ptr = list.as_mut_ptr();
                let len = list.len();
                core::mem::forget(list);
                let mut array_buffer = ArrayBuffer::from_bytes(
                    // SAFETY: ptr/len leaked from Vec just above.
                    unsafe { core::slice::from_raw_parts(ptr, len) },
                    jsc::TypedArrayType::Uint8Array,
                );
                Ok(array_buffer.to_js_with_context(
                    global_this,
                    ptr as *mut c_void,
                    global_deallocator,
                ))
            }
        }
    }

    pub fn gzip_or_deflate_sync(
        global_this: &JSGlobalObject,
        buffer: jsc::node::StringOrBuffer,
        options_val_: Option<JSValue>,
        is_gzip: bool,
    ) -> JsResult<JSValue> {
        let mut level: Option<i32> = None;
        let mut library = Library::Zlib;
        let mut window_bits: i32 = 0;

        if let Some(options_val) = options_val_ {
            if let Some(window) = options_val.get(global_this, "windowBits")? {
                window_bits = window.coerce::<i32>(global_this)?;
                library = Library::Zlib;
            }

            if let Some(library_value) = options_val.get_truthy(global_this, "library")? {
                if !library_value.is_string() {
                    return global_this
                        .throw_invalid_arguments("Expected library to be a string", format_args!());
                }

                library = match Library::MAP.from_js(global_this, library_value)? {
                    Some(v) => v,
                    None => {
                        return global_this.throw_invalid_arguments(
                            "Expected library to be one of 'zlib' or 'libdeflate'",
                            format_args!(),
                        )
                    }
                };
            }

            if let Some(level_value) = options_val.get(global_this, "level")? {
                level = Some(level_value.coerce::<i32>(global_this)?);
                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let compressed = buffer.slice();
        let _ = window_bits; // unused in Zig too

        match library {
            Library::Zlib => {
                let mut list: Vec<u8> = Vec::with_capacity(if compressed.len() > 512 {
                    compressed.len()
                } else {
                    32
                });

                let reader = match zlib::ZlibCompressorArrayList::init(
                    compressed,
                    &mut list,
                    zlib::Options {
                        window_bits: 15,
                        gzip: is_gzip,
                        level: level.unwrap_or(6),
                        ..Default::default()
                    },
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        drop(list);
                        if err == bun_core::err!("InvalidArgument") {
                            return global_this
                                .throw("Zlib error: Invalid argument", format_args!());
                        }
                        return global_this.throw_error(err, "Zlib error");
                    }
                };

                if let Err(_) = reader.read_all() {
                    let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                    return global_this
                        .throw_value(ZigString::init(msg).to_error_instance(global_this));
                }
                reader.list = core::mem::take(&mut reader.list).into_boxed_slice().into_vec();
                // TODO(port): list_ptr self-reference; see note in gunzip path.
                reader.list_ptr = &mut reader.list;

                let mut array_buffer =
                    ArrayBuffer::from_bytes(reader.list.as_slice(), jsc::TypedArrayType::Uint8Array);
                Ok(array_buffer.to_js_with_context(
                    global_this,
                    Box::into_raw(reader) as *mut c_void,
                    reader_deallocator,
                ))
            }
            Library::Libdeflate => {
                let Some(compressor) = bun_libdeflate::Compressor::alloc(level.unwrap_or(6))
                else {
                    return global_this.throw_out_of_memory();
                };
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };

                let mut list: Vec<u8> = Vec::with_capacity(
                    // This allocation size is unfortunate, but it's not clear how to avoid it with libdeflate.
                    compressor.max_bytes_needed(compressed, encoding),
                );

                loop {
                    // list.len() == 0 here (no retry path), so spare == [0..capacity] == allocatedSlice().
                    let result =
                        compressor.compress(compressed, list.spare_capacity_mut_as_slice(), encoding);

                    // SAFETY: result.written ≤ list.capacity() and bytes [0..written] were
                    // initialized by libdeflate above.
                    unsafe { list.set_len(result.written) };

                    if result.status == bun_libdeflate::Status::Success {
                        // SAFETY: same invariant as above; redundant set_len mirrors Zig.
                        unsafe { list.set_len(result.written) };
                        break;
                    }

                    drop(list);
                    return global_this.throw(
                        "libdeflate error: {s}",
                        format_args!("{}", <&'static str>::from(result.status)),
                    );
                }

                let ptr = list.as_mut_ptr();
                let len = list.len();
                core::mem::forget(list);
                let mut array_buffer = ArrayBuffer::from_bytes(
                    // SAFETY: ptr/len leaked from the Vec just above; memory remains valid
                    // until global_deallocator frees it via the ArrayBuffer finalizer.
                    unsafe { core::slice::from_raw_parts(ptr, len) },
                    jsc::TypedArrayType::Uint8Array,
                );
                Ok(array_buffer.to_js_with_context(
                    global_this,
                    ptr as *mut c_void,
                    global_deallocator,
                ))
            }
        }
    }
}

#[allow(non_snake_case)]
pub mod JSZstd {
    use super::*;

    #[unsafe(no_mangle)]
    pub extern "C" fn deallocator(_: *mut c_void, ctx: *mut c_void) {
        // SAFETY: ctx is a mimalloc-allocated pointer.
        unsafe { bun_alloc::free_without_size(ctx) };
    }

    #[inline]
    fn get_options(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<(jsc::node::StringOrBuffer, Option<JSValue>)> {
        let arguments = callframe.arguments();
        let buffer_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
            Some(arguments[1])
        } else if arguments.len() > 1 && !arguments[1].is_undefined() {
            return global_this
                .throw_invalid_arguments("Expected options to be an object", format_args!());
        } else {
            None
        };

        if let Some(buffer) = jsc::node::StringOrBuffer::from_js(global_this, buffer_value)? {
            return Ok((buffer, options_val));
        }

        global_this
            .throw_invalid_arguments("Expected buffer to be a string or buffer", format_args!())
    }

    fn get_level(global_this: &JSGlobalObject, options_val: Option<JSValue>) -> JsResult<i32> {
        if let Some(option_obj) = options_val {
            if let Some(level_val) = option_obj.get(global_this, "level")? {
                let value = level_val.coerce::<i32>(global_this)?;
                if global_this.has_exception() {
                    return Err(jsc::JsError::Thrown);
                }

                if value < 1 || value > 22 {
                    return global_this.throw_invalid_arguments(
                        "Compression level must be between 1 and 22",
                        format_args!(),
                    );
                }

                return Ok(value);
            }
        }

        Ok(3)
    }

    #[inline]
    fn get_options_async(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<(jsc::node::StringOrBuffer, Option<JSValue>, i32)> {
        let arguments = callframe.arguments();
        let buffer_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
            Some(arguments[1])
        } else if arguments.len() > 1 && !arguments[1].is_undefined() {
            return global_this
                .throw_invalid_arguments("Expected options to be an object", format_args!());
        } else {
            None
        };

        let level = get_level(global_this, options_val)?;

        let allow_string_object = true;
        if let Some(buffer) = jsc::node::StringOrBuffer::from_js_maybe_async(
            global_this,
            buffer_value,
            true,
            allow_string_object,
        )? {
            return Ok((buffer, options_val, level));
        }

        global_this
            .throw_invalid_arguments("Expected buffer to be a string or buffer", format_args!())
    }

    #[bun_jsc::host_fn]
    pub fn compress_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = get_options(global_this, callframe)?;

        let level = get_level(global_this, options_val)?;

        let input = buffer.slice();

        // Calculate max compressed size
        let max_size = bun_zstd::compress_bound(input.len());
        let mut output = vec![0u8; max_size];
        // TODO(port): allocator.alloc(u8, n) — Zig left this uninitialized.
        // PERF(port): use Box::new_uninit_slice — profile in Phase B.

        // Perform compression with context
        let compressed_size = match bun_zstd::compress(&mut output, input, level) {
            bun_zstd::Result::Success(size) => size,
            bun_zstd::Result::Err(err) => {
                drop(output);
                return global_this
                    .err(jsc::ErrCode::ZSTD, "{s}", format_args!("{}", bstr::BStr::new(err)))
                    .throw();
            }
        };

        // Resize to actual compressed size
        if compressed_size < output.len() {
            output.truncate(compressed_size);
            output.shrink_to_fit();
        }

        Ok(JSValue::create_buffer(global_this, output))
    }

    #[bun_jsc::host_fn]
    pub fn decompress_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer, _) = get_options(global_this, callframe)?;

        let input = buffer.slice();

        let output = match bun_zstd::decompress_alloc(input) {
            Ok(v) => v,
            Err(err) => {
                return global_this
                    .err(
                        jsc::ErrCode::ZSTD,
                        "Decompression failed: {s}",
                        format_args!("{}", err.name()),
                    )
                    .throw();
            }
        };

        Ok(JSValue::create_buffer(global_this, output))
    }

    // --- Async versions ---

    pub struct ZstdJob {
        pub buffer: jsc::node::StringOrBuffer,
        pub is_compress: bool,
        pub level: i32,
        pub task: jsc::WorkPoolTask,
        pub promise: jsc::JSPromiseStrong,
        pub vm: &'static VirtualMachine,
        pub output: Vec<u8>,
        pub error_message: Option<&'static [u8]>,
        pub any_task: jsc::AnyTask,
        pub poll: KeepAlive,
    }

    impl ZstdJob {
        // bun.TrivialNew(@This())
        pub fn new(init: ZstdJob) -> *mut ZstdJob {
            Box::into_raw(Box::new(init))
        }

        pub fn run_task(task: *mut jsc::WorkPoolTask) {
            // SAFETY: task points to ZstdJob.task; recover parent via offset_of.
            let job: *mut ZstdJob = unsafe {
                (task as *mut u8)
                    .sub(core::mem::offset_of!(ZstdJob, task))
                    .cast::<ZstdJob>()
            };
            let job = unsafe { &mut *job };
            let _enqueue = scopeguard::guard((), |_| {
                job.vm.enqueue_task_concurrent(jsc::ConcurrentTask::create(
                    job.any_task.task(),
                ));
            });

            let input = job.buffer.slice();

            if job.is_compress {
                // Compression path
                // Calculate max compressed size
                let max_size = bun_zstd::compress_bound(input.len());
                job.output = match vec![0u8; max_size].try_into_ok() {
                    // TODO(port): allocator.alloc(u8, n) — Zig didn't zero;
                    // Rust Vec aborts on OOM. Preserve "Out of memory" path:
                    Some(v) => v,
                    None => {
                        job.error_message = Some(b"Out of memory");
                        return;
                    }
                };
                // PORT NOTE: above try_into_ok() is a placeholder — Phase B
                // should use a fallible alloc helper from bun_alloc.

                // Perform compression
                job.output = match bun_zstd::compress(&mut job.output, input, job.level) {
                    bun_zstd::Result::Success(size) => 'blk: {
                        // Resize to actual compressed size
                        if size < job.output.len() {
                            let mut out = core::mem::take(&mut job.output);
                            out.truncate(size);
                            out.shrink_to_fit();
                            break 'blk out;
                        }
                        break 'blk core::mem::take(&mut job.output);
                    }
                    bun_zstd::Result::Err(err) => {
                        job.output = Vec::new();
                        job.error_message = Some(err);
                        return;
                    }
                };
            } else {
                // Decompression path
                job.output = match bun_zstd::decompress_alloc(input) {
                    Ok(v) => v,
                    Err(_) => {
                        job.error_message = Some(b"Decompression failed");
                        return;
                    }
                };
            }
        }

        pub fn run_from_js(this: *mut ZstdJob) -> Result<(), jsc::JsTerminated> {
            // SAFETY: `this` was created via ZstdJob::new (Box::into_raw) and is exclusively
            // owned here; destroy() reclaims the Box at scope exit on every path.
            let _deinit = scopeguard::guard(this, |p| unsafe { ZstdJob::destroy(p) });
            // SAFETY: `this` is non-null and valid for the duration of this call (see above).
            let this = unsafe { &mut *this };

            if this.vm.is_shutting_down() {
                return Ok(());
            }

            let global_this = this.vm.global;
            let promise = this.promise.swap();

            if let Some(err_msg) = this.error_message {
                promise.reject_with_async_stack(
                    global_this,
                    global_this
                        .err(jsc::ErrCode::ZSTD, "{s}", format_args!("{}", bstr::BStr::new(err_msg)))
                        .to_js(),
                )?;
                return Ok(());
            }

            let output_slice = core::mem::take(&mut this.output);
            let buffer_value = JSValue::create_buffer(global_this, output_slice);
            promise.resolve(global_this, buffer_value)?;
            Ok(())
        }

        /// Tear down and free a heap-allocated job.
        ///
        /// SAFETY: `this` must have been produced by `ZstdJob::new` (i.e. `Box::into_raw`)
        /// and must not be used after this call. Invoked exactly once from `run_from_js`.
        pub unsafe fn destroy(this: *mut ZstdJob) {
            // SAFETY: caller contract — `this` is the unique raw Box pointer.
            let mut boxed = unsafe { Box::from_raw(this) };
            boxed.poll.unref(boxed.vm);
            boxed.buffer.deinit_and_unprotect();
            boxed.promise = Default::default();
            boxed.output = Vec::new();
            // `boxed` drops here, freeing the allocation.
        }

        pub fn create(
            vm: &'static VirtualMachine,
            global_this: &JSGlobalObject,
            buffer: jsc::node::StringOrBuffer,
            is_compress: bool,
            level: i32,
        ) -> *mut ZstdJob {
            let job = ZstdJob::new(ZstdJob {
                buffer,
                is_compress,
                level,
                task: jsc::WorkPoolTask {
                    callback: ZstdJob::run_task,
                },
                promise: Default::default(),
                vm,
                output: Vec::new(),
                error_message: None,
                any_task: Default::default(), // overwritten below
                poll: KeepAlive::default(),
            });

            // SAFETY: job is freshly allocated and exclusively owned here.
            let job_ref = unsafe { &mut *job };
            job_ref.promise = jsc::JSPromiseStrong::init(global_this);
            job_ref.any_task = jsc::AnyTask::new::<ZstdJob>(ZstdJob::run_from_js).init(job);
            job_ref.poll.ref_(vm);
            WorkPool::schedule(&mut job_ref.task);

            job
        }
    }

    #[bun_jsc::host_fn]
    pub fn compress(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, _, level) = get_options_async(global_this, callframe)?;

        let vm = global_this.bun_vm();
        let job = ZstdJob::create(vm, global_this, buffer, true, level);
        // SAFETY: job is live until run_from_js consumes it.
        Ok(unsafe { (*job).promise.value() })
    }

    #[bun_jsc::host_fn]
    pub fn decompress(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, _, _) = get_options_async(global_this, callframe)?;

        let vm = global_this.bun_vm();
        let job = ZstdJob::create(vm, global_this, buffer, false, 0); // level is ignored for decompression
        // SAFETY: job is live until run_from_js consumes it.
        Ok(unsafe { (*job).promise.value() })
    }
}

// const InternalTestingAPIs = struct {
//     pub fn BunInternalFunction__syntaxHighlighter(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
//         const args = callframe.arguments_old(1);
//         if (args.len < 1) {
//             globalThis.throwNotEnoughArguments("code", 1, 0);
//         }
//
//         const code = args.ptr[0].toSliceOrNull(globalThis) orelse return .zero;
//         defer code.deinit();
//         var buffer = MutableString.initEmpty(bun.default_allocator);
//         defer buffer.deinit();
//         var writer = buffer.bufferedWriter();
//         const formatter = bun.fmt.fmtJavaScript(code.slice(), .{
//             .enable_colors = true,
//             .check_for_unhighlighted_write = false,
//         });
//         writer.writer().print("{f}", .{formatter}) catch |err| {
//             return globalThis.throwError(err, "Error formatting code");
//         };
//
//         writer.flush() catch |err| {
//             return globalThis.throwError(err, "Error formatting code");
//         };
//
//         return bun.String.createUTF8ForJS(globalThis, buffer.list.items);
//     }
// };

// PORT NOTE: Zig `comptime { _ = ...; BunObject.exportAll(); }` block dropped —
// Rust links what's pub via the `#[unsafe(no_mangle)]` exports above.
// Referenced: Crypto::JSPasswordObject::JSPasswordObject__create,
// bun_jsc::btjs::dump_btjs_trace.

// LazyProperty initializers for stdin/stderr/stdout
pub fn create_bun_stdin(global_this: &JSGlobalObject) -> JSValue {
    let rare_data = global_this.bun_vm().rare_data();
    let store = rare_data.stdin();
    store.ref_();
    let blob = WebCore::Blob::new(WebCore::Blob::init_with_store(store, global_this));
    blob.to_js(global_this)
}

pub fn create_bun_stderr(global_this: &JSGlobalObject) -> JSValue {
    let rare_data = global_this.bun_vm().rare_data();
    let store = rare_data.stderr();
    store.ref_();
    let blob = WebCore::Blob::new(WebCore::Blob::init_with_store(store, global_this));
    blob.to_js(global_this)
}

pub fn create_bun_stdout(global_this: &JSGlobalObject) -> JSValue {
    let rare_data = global_this.bun_vm().rare_data();
    let store = rare_data.stdout();
    store.ref_();
    let blob = WebCore::Blob::new(WebCore::Blob::init_with_store(store, global_this));
    blob.to_js(global_this)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/BunObject.zig (2172 lines)
//   confidence: medium
//   todos:      17
//   notes:      Heavy comptime @export table replaced with macro_rules! shims (needs proc-macro in Phase B); ZlibReaderArrayList ownership/list_ptr self-ref needs Rust-side reshape; ZstdJob fallible alloc placeholder.
// ──────────────────────────────────────────────────────────────────────────
