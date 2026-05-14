//! `globalThis.Bun` — top-level host functions and lazy-property getters.

/// Build a public-path string for `to` relative to `dir`, prefixed by `origin`
/// (and `asset_prefix` when `origin` is absolute). Called by both the bundler
/// dev-server and `Bun.FileSystemRouter`'s `scriptSrc` getter.
pub fn get_public_path_with_asset_prefix<W: core::fmt::Write>(
    to: &[u8],
    dir: &[u8],
    origin: &bun_url::URL,
    asset_prefix: &[u8],
    writer: &mut W,
    platform: bun_paths::Platform,
) {
    use bun_core::strings;
    use bun_paths::{Platform, resolve_path};

    // PERF(port): bun_url::URL::join_write wants a `bun_io::Write`; route all
    // byte output through a Vec<u8> then forward to the caller's fmt::Write.
    // Spec writes raw bytes — POSIX paths are arbitrary byte sequences — so use
    // a lossy conversion rather than silently dropping the whole component.
    #[inline]
    fn write_bytes<W: core::fmt::Write>(w: &mut W, bytes: &[u8]) -> core::fmt::Result {
        // `bstr::BStr` Display lossily substitutes U+FFFD per invalid sequence
        // (no allocation on the valid-UTF-8 fast path).
        write!(w, "{}", bstr::BStr::new(bytes))
    }

    let relative_path: &[u8] = if strings::has_prefix(to, dir) {
        strings::without_trailing_slash(&to[dir.len()..])
    } else {
        // PORT NOTE: spec is `VirtualMachine.get().transpiler.fs.relativePlatform(dir, to, platform)`;
        // that wrapper is stateless and forwards to bun_paths — dispatch on runtime `platform`
        // here to keep this fn callable without const-generic plumbing through `transpiler.fs`.
        match platform {
            Platform::Posix => {
                resolve_path::relative_platform::<resolve_path::platform::Posix, false>(dir, to)
            }
            Platform::Windows => {
                resolve_path::relative_platform::<resolve_path::platform::Windows, false>(dir, to)
            }
            Platform::Loose => {
                resolve_path::relative_platform::<resolve_path::platform::Loose, false>(dir, to)
            }
            Platform::Nt => {
                resolve_path::relative_platform::<resolve_path::platform::Nt, false>(dir, to)
            }
        }
    };
    if origin.is_absolute() {
        if strings::has_prefix(relative_path, b"..") || strings::has_prefix(relative_path, b"./") {
            if write_bytes(writer, origin.origin).is_err() {
                return;
            }
            if write_bytes(writer, b"/abs:").is_err() {
                return;
            }
            if bun_paths::is_absolute(to) {
                let _ = write_bytes(writer, to);
            } else {
                let fs = VirtualMachine::get().fs();
                let _ = write_bytes(writer, fs.abs(&[to]));
            }
        } else {
            let mut buf: Vec<u8> = Vec::new();
            let _ = origin.join_write(&mut buf, asset_prefix, b"", relative_path, b"");
            let _ = write_bytes(writer, &buf);
        }
    } else {
        let _ = write_bytes(writer, strings::trim_left(relative_path, b"/"));
    }
}

/// `Bun.getPublicPath` — wrapper over [`get_public_path_with_asset_prefix`]
/// using the VM's top-level dir, no asset prefix, and loose path platform.
pub fn get_public_path<W: core::fmt::Write>(to: &[u8], origin: &bun_url::URL, writer: &mut W) {
    get_public_path_with_asset_prefix(
        to,
        VirtualMachine::get().top_level_dir(),
        origin,
        b"",
        writer,
        bun_paths::Platform::Loose,
    )
}

use core::ffi::{c_char, c_int, c_void};
use std::io::Write as _;

use bun_core::{Environment, Output};
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, ConsoleObject, ErrorableString, JSFunction,
    JSGlobalObject, JSObject, JSPromise, JSValue, JsRef, JsResult, WebCore, host_fn,
};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use crate::cli::open::Editor;
use bun_core::{String as BunString, ZigString, strings};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_paths::{self as path, MAX_PATH_BYTES, PathBuffer, WPathBuffer};
use bun_shell_parser::braces as Braces;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_url::URL;
use bun_zlib as zlib;

use crate::api::JSBundler;
use crate::api::cron;
use crate::api::csrf_jsc;
use crate::api::{
    self, FFIObject, HashObject, JSON5Object, JSONCObject, MarkdownObject, TOMLObject,
    UnsafeObject, YAMLObject,
};
use crate::crypto as Crypto;
use crate::node;
use crate::test_runner::expect::{JSGlobalObjectTestExt as _, JSValueTestExt as _};
use crate::test_runner::jest::Jest;
use crate::valkey_jsc::js_valkey::SubscriptionCtx;
use bun_core::zig_string::Slice as ZigStringSlice;
use bun_jsc::ZigStringJsc as _; // to_error_instance / to_type_error_instance
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::{StringJsc as _, bun_string_jsc};

/// Bindgen-generated option-structs for this module (`BunObject.bind.ts`).
pub mod r#gen {
    pub use bun_jsc::generated::bun_object::BracesOptions;
}

// ─── wrap_static_method adapters ───────────────────────────────────────────
// Zig's `host_fn.wrapStaticMethod(T, "name", auto_protect)` reflects on the
// target fn's parameter types and decodes each from the CallFrame. The Rust
// proc-macro replacement (`#[bun_jsc::host_fn(static)]`) is not yet emitted,
// so hand-roll the arg-extraction shims for the six call sites below.
mod static_adapters {
    use super::*;

    pub fn listener_connect(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<1>();
        let opts = if args.len >= 1 {
            args.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        crate::socket::Listener::connect(g, opts)
    }

    pub fn listener_listen(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<1>();
        let opts = if args.len >= 1 {
            args.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        crate::socket::Listener::listen(g, opts)
    }

    pub fn udp_socket(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<1>();
        let opts = if args.len >= 1 {
            args.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        crate::socket::udp_socket_draft::UDPSocket::udp_socket(g, opts)
    }

    pub fn subprocess_spawn(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<2>();
        let a0 = if args.len >= 1 {
            args.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        let a1 = if args.len >= 2 {
            Some(args.ptr[1])
        } else {
            None
        };
        crate::api::js_bun_spawn_bindings::spawn(g, a0, a1)
    }

    pub fn subprocess_spawn_sync(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments_old::<2>();
        let a0 = if args.len >= 1 {
            args.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        let a1 = if args.len >= 2 {
            Some(args.ptr[1])
        } else {
            None
        };
        crate::api::js_bun_spawn_bindings::spawn_sync(g, a0, a1)
    }

    pub fn js_bundler_build(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        crate::api::js_bundler::JSBundler::build_fn(g, cf)
    }
    /// `Bun.$` parsed-script constructor — wraps the marked-argument-buffer host fn.
    pub fn parsed_shell_script_create(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        // `CREATE_PARSED_SHELL_SCRIPT` is the safe `JSHostFnZig` produced by
        // `marked_argument_buffer_wrap!` (the C-ABI shim is exported separately
        // by the macro); call it directly.
        crate::shell::parsed_shell_script::CREATE_PARSED_SHELL_SCRIPT(g, cf)
    }
    pub fn shell_interpreter_create(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        crate::shell::interpreter::create_shell_interpreter(g, cf)
    }

    /// `Bun.sha(input, output?)` — wrapStaticMethod(Crypto.SHA512_256, "hash_", true).
    /// Hand-roll the (BlobOrStringOrBuffer, ?StringOrBuffer) decode that
    /// `wrapStaticMethod` would emit, with auto-protect on each argument.
    pub fn sha(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        use crate::node::types::{BlobOrStringOrBuffer, StringOrBuffer};
        let args = cf.arguments_old::<2>();
        let a0 = if args.len >= 1 {
            args.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        let a1 = if args.len >= 2 {
            args.ptr[1]
        } else {
            JSValue::UNDEFINED
        };
        // auto_protect = true: protect each arg across the call (Zig side
        // re-enters the VM for Blob materialization).
        let _a0_guard = a0.protected();
        let _a1_guard = a1.protected();
        let Some(input) = BlobOrStringOrBuffer::from_js(g, a0)? else {
            return Err(g.throw_invalid_arguments(format_args!(
                "expected string, buffer, TypedArray, or Blob",
            )));
        };
        let output = if a1.is_undefined_or_null() {
            None
        } else {
            StringOrBuffer::from_js(g, a1)?
        };
        Crypto::SHA512_256::hash_(g, input, output)
    }
}

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

    // Ident concat via `${concat()}` is unstable (`macro_metavar_expr_concat`),
    // so the full `BunObject_callback_<name>` / `BunObject_lazyPropCb_<name>`
    // export symbol is supplied verbatim by the caller (same pattern as
    // `lazy_prop!` above).
    macro_rules! export_callbacks {
        ($( $(#[$attr:meta])* $sym:ident => $target:expr ),* $(,)?) => {
            $(
                // Zig spec (BunObject.zig) — `callconv(jsc.conv)`. C++ declares
                // these via `BUN_DECLARE_HOST_FUNCTION` → `JSC_HOST_CALL_ATTRIBUTES`
                // = SysV on Windows-x64. Mismatching `extern "C"` here puts
                // `globalObject` in RCX vs C++'s RDI → garbage deref.
                bun_jsc::jsc_host_abi! {
                    $(#[$attr])*
                    #[unsafe(no_mangle)]
                    pub unsafe fn $sym(
                        g: *mut JSGlobalObject,
                        f: *mut CallFrame,
                    ) -> JSValue {
                        // SAFETY: JSC always passes valid pointers here.
                        let (g, f) = unsafe { (&*g, &*f) };
                        bun_jsc::to_js_host_call(g, || $target(g, f))
                    }
                }
            )*
        };
    }

    /// Adapter so `export_lazy_prop_callbacks!` accepts targets returning either
    /// a bare `JSValue` (most getters) or a `JsResult<JSValue>` (e.g.
    /// `get_embedded_files`, which can OOM allocating the result array).
    trait IntoLazyPropResult {
        fn into_lazy_prop_result(self) -> JsResult<JSValue>;
    }
    impl IntoLazyPropResult for JSValue {
        #[inline]
        fn into_lazy_prop_result(self) -> JsResult<JSValue> {
            Ok(self)
        }
    }
    impl IntoLazyPropResult for JsResult<JSValue> {
        #[inline]
        fn into_lazy_prop_result(self) -> JsResult<JSValue> {
            self
        }
    }

    macro_rules! export_lazy_prop_callbacks {
        ($( $sym:ident => $target:path ),* $(,)?) => {
            $(
                // Zig spec (BunObject.zig:108-112) — `LazyPropertyCallback` is
                // `callconv(jsc.conv)`. C++ declares the extern as `SYSV_ABI`
                // (`BunObject+exports.h:91`); on Windows-x64 that's RDI/RSI,
                // not RCX/RDX, so `extern "C"` reads garbage for both args.
                bun_jsc::jsc_host_abi! {
                    #[unsafe(no_mangle)]
                    pub unsafe fn $sym(
                        this: *mut JSGlobalObject,
                        object: *mut JSObject,
                    ) -> JSValue {
                        // SAFETY: JSC always passes valid pointers here.
                        let (g, o) = unsafe { (&*this, &*object) };
                        bun_jsc::to_js_host_call(g, || {
                            IntoLazyPropResult::into_lazy_prop_result($target(g, o))
                        })
                    }
                }
            )*
        };
    }

    // --- Callbacks ---
    export_callbacks! {
        BunObject_callback_allocUnsafe => super::alloc_unsafe,
        BunObject_callback_build => super::static_adapters::js_bundler_build,
        BunObject_callback_color => bun_css_jsc::js_function_color,
        BunObject_callback_connect => super::static_adapters::listener_connect,
        BunObject_callback_deflateSync => JSZlib::deflate_sync,
        BunObject_callback_file => crate::webcore::blob::construct_bun_file,
        BunObject_callback_gunzipSync => JSZlib::gunzip_sync,
        BunObject_callback_gzipSync => JSZlib::gzip_sync,
        BunObject_callback_indexOfLine => super::index_of_line,
        BunObject_callback_inflateSync => JSZlib::inflate_sync,
        BunObject_callback_jest => Jest::call,
        BunObject_callback_listen => super::static_adapters::listener_listen,
        BunObject_callback_mmap => super::mmap_file,
        BunObject_callback_nanoseconds => super::nanoseconds,
        BunObject_callback_openInEditor => super::open_in_editor,
        BunObject_callback_registerMacro => super::register_macro,
        BunObject_callback_resolve => super::resolve,
        BunObject_callback_resolveSync => super::resolve_sync,
        BunObject_callback_serve => super::serve,
        BunObject_callback_sha => super::static_adapters::sha,
        BunObject_callback_shellEscape => super::shell_escape,
        BunObject_callback_shrink => super::shrink,
        BunObject_callback_stringWidth => super::string_width,
        BunObject_callback_sleepSync => super::sleep_sync,
        BunObject_callback_spawn => super::static_adapters::subprocess_spawn,
        BunObject_callback_spawnSync => super::static_adapters::subprocess_spawn_sync,
        BunObject_callback_udpSocket => super::static_adapters::udp_socket,
        BunObject_callback_which => super::which,
        BunObject_callback_write => crate::webcore::blob::write_file,
        BunObject_callback_zstdCompressSync => JSZstd::compress_sync,
        BunObject_callback_zstdDecompressSync => JSZstd::decompress_sync,
        BunObject_callback_zstdCompress => JSZstd::compress,
        BunObject_callback_zstdDecompress => JSZstd::decompress,
    }
    // `createParsedShellScript` / `createShellInterpreter` go through the same
    // `to_js_host_call` thunk as the macro-generated callbacks (their bodies
    // are already `JSHostFnZig`-shaped).
    export_callbacks! {
        BunObject_callback_createParsedShellScript => super::static_adapters::parsed_shell_script_create,
        BunObject_callback_createShellInterpreter => super::static_adapters::shell_interpreter_create,
    }
    // --- Callbacks ---

    // --- Lazy property callbacks ---
    export_lazy_prop_callbacks! {
        BunObject_lazyPropCb_Archive => super::get_archive_constructor,
        BunObject_lazyPropCb_CryptoHasher => Crypto::CryptoHasher::getter,
        BunObject_lazyPropCb_CSRF => super::get_csrf_object,
        BunObject_lazyPropCb_FFI => crate::ffi::ffi_object_draft::getter,
        BunObject_lazyPropCb_FileSystemRouter => super::get_file_system_router,
        BunObject_lazyPropCb_Glob => super::get_glob_constructor,
        BunObject_lazyPropCb_Image => super::get_image_constructor,
        BunObject_lazyPropCb_MD4 => Crypto::MD4::getter,
        BunObject_lazyPropCb_MD5 => Crypto::MD5::getter,
        BunObject_lazyPropCb_SHA1 => Crypto::SHA1::getter,
        BunObject_lazyPropCb_SHA224 => Crypto::SHA224::getter,
        BunObject_lazyPropCb_SHA256 => Crypto::SHA256::getter,
        BunObject_lazyPropCb_SHA384 => Crypto::SHA384::getter,
        BunObject_lazyPropCb_SHA512 => Crypto::SHA512::getter,
        BunObject_lazyPropCb_SHA512_256 => Crypto::SHA512_256::getter,
        BunObject_lazyPropCb_JSONC => super::get_jsonc_object,
        BunObject_lazyPropCb_markdown => super::get_markdown_object,
        BunObject_lazyPropCb_TOML => super::get_toml_object,
        BunObject_lazyPropCb_JSON5 => super::get_json5_object,
        BunObject_lazyPropCb_YAML => super::get_yaml_object,
        BunObject_lazyPropCb_Transpiler => super::get_transpiler_constructor,
        BunObject_lazyPropCb_argv => super::get_argv,
        BunObject_lazyPropCb_cron => super::get_cron_object,
        BunObject_lazyPropCb_cwd => super::get_cwd,
        BunObject_lazyPropCb_embeddedFiles => super::get_embedded_files,
        BunObject_lazyPropCb_enableANSIColors => super::enable_ansi_colors,
        BunObject_lazyPropCb_hash => super::get_hash_object,
        BunObject_lazyPropCb_inspect => super::get_inspect,
        BunObject_lazyPropCb_origin => super::get_origin,
        BunObject_lazyPropCb_semver => super::get_semver,
        BunObject_lazyPropCb_unsafe => super::get_unsafe,
        BunObject_lazyPropCb_S3Client => super::get_s3_client_constructor,
        BunObject_lazyPropCb_s3 => super::get_s3_default_client,
        BunObject_lazyPropCb_ValkeyClient => super::get_valkey_client_constructor,
        BunObject_lazyPropCb_valkey => super::get_valkey_default_client,
        BunObject_lazyPropCb_Terminal => super::get_terminal_constructor,
    }
    // --- Lazy property callbacks ---

    // --- Getters ---
    pub use super::get_main as main;
    // --- Getters ---

    // --- Setters ---
    pub use super::set_main;
    // --- Setters ---

    // PORT NOTE: Zig's `lazyPropertyCallbackName`/`callbackName` were comptime
    // string concats used only at `comptime @export` sites. The export names
    // are now spelled out verbatim in the `export_*!` macro invocations above,
    // so the comptime-only helpers are dropped (no runtime callers).

    // type LazyPropertyCallback = extern "C" fn(*mut JSGlobalObject, *mut JSObject) -> JSValue
    // (the `callconv(jsc.conv)` ABI is emitted by `#[bun_jsc::host_fn]` / the macro above;
    // see PORTING.md §FFI — cannot write `extern jsc_conv!()` in Rust.)

    // --- LazyProperty initializers ---
    // (BunObject__createBunStdin / Stderr / Stdout exported at file scope below.)
    // --- LazyProperty initializers ---

    // --- Getters / Setters ---
    // `BunObject_getter_main` / `BunObject_setter_main` thunks are emitted by
    // `generate-host-exports.ts` from the `// HOST_EXPORT` markers on
    // `super::{get_main, set_main}` below (SYSV_ABI on win-x64 — matches the
    // `extern "C" SYSV_ABI` decl in BunObject.cpp:1103).
    // --- Getters / Setters ---
}

pub fn get_cron_object(global_this: &JSGlobalObject, obj: &JSObject) -> JSValue {
    crate::api::cron::get_cron_object(global_this, obj)
}

#[bun_jsc::host_fn]
pub fn shell_escape(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    use bun_jsc::StringJsc as _;
    let arguments = callframe.arguments_old::<1>();
    if arguments.len < 1 {
        return Err(global_this.throw(format_args!("shell escape expected at least 1 argument")));
    }

    let jsval = arguments.ptr[0];
    let bunstr = jsval.to_bun_string(global_this)?;
    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }
    let bunstr = scopeguard::guard(bunstr, |s| s.deref());

    let mut outbuf: Vec<u8> = Vec::new();

    if bun_shell_parser::needs_escape_bunstr(*bunstr) {
        let result = bun_shell_parser::escape_bun_str::<true>(*bunstr, &mut outbuf)?;
        if !result {
            return Err(global_this.throw(format_args!(
                "String has invalid utf-16: {}",
                bstr::BStr::new(bunstr.byte_slice()),
            )));
        }
        let mut str = BunString::clone_utf8(&outbuf[..]);
        return str.transfer_to_js(global_this);
    }

    Ok(jsval)
}

pub fn braces(
    global: &JSGlobalObject,
    brace_str: BunString,
    opts: r#gen::BracesOptions,
) -> JsResult<JSValue> {
    let brace_slice = brace_str.to_utf8();

    // PERF(port): was arena bulk-free — profile in Phase B
    let mut arena = bun_alloc::Arena::new();
    let _ = &mut arena;

    let mut lexer_output = 'lexer_output: {
        if strings::is_all_ascii(brace_slice.slice()) {
            break 'lexer_output match Braces::Lexer::tokenize(brace_slice.slice()) {
                Ok(v) => v,
                Err(err) => return Err(global.throw_error(err.into(), "failed to tokenize braces")),
            };
        }

        match Braces::NewLexer::<{ Braces::StringEncoding::Wtf8 }>::tokenize(brace_slice.slice()) {
            Ok(v) => break 'lexer_output v,
            Err(err) => return Err(global.throw_error(err.into(), "failed to tokenize braces")),
        }
    };

    let expansion_count = Braces::calculate_expanded_amount(&lexer_output.tokens[..]);

    if opts.tokenize {
        // PORT NOTE: Zig's `std.json.fmt` reflects over the tagged-union token
        // list. The Rust `Braces::Token` enum has no `serde::Serialize`; emit
        // the same shape (`[{"<tag>": <payload>|{}} , …]`) by hand so the
        // debug-only `Bun.braces(str, {tokenize:true})` round-trips.
        let str = Braces::tokens_to_json(&lexer_output.tokens[..]);
        let bun_str = BunString::from_bytes(&str);
        return bun_str.to_js(global);
    }
    if opts.parse {
        let mut parser = Braces::Parser::init(&lexer_output.tokens[..], &arena);
        let ast_node = match parser.parse() {
            Ok(v) => v,
            Err(err) => return Err(global.throw_error(err.into(), "failed to parse braces")),
        };
        // PORT NOTE: see `tokenize` arm — manual JSON encoder for the AST.
        let str = Braces::ast_to_json(ast_node);
        let bun_str = BunString::from_bytes(&str);
        return bun_str.to_js(global);
    }

    if expansion_count == 0 {
        return bun_string_jsc::to_js_array(global, &[brace_str]);
    }

    // Non-AST crate: result containers use plain Vec (arena is only for Braces::* internals).
    let expansion_count = expansion_count as usize;
    let mut expanded_strings: Vec<Vec<u8>> = Vec::with_capacity(expansion_count);
    for _ in 0..expansion_count {
        expanded_strings.push(Vec::new());
    }

    match Braces::expand(
        &arena,
        &mut lexer_output.tokens[..],
        &mut expanded_strings,
        lexer_output.contains_nested,
    ) {
        Ok(()) => {}
        Err(Braces::ParserError::OutOfMemory) => return Err(jsc::JsError::OutOfMemory),
        Err(Braces::ParserError::UnexpectedToken) => {
            return Err(global.throw_pretty(format_args!("Unexpected token while expanding braces")));
        }
    }

    let mut out_strings: Vec<BunString> = Vec::with_capacity(expansion_count);
    for i in 0..expansion_count {
        out_strings.push(BunString::from_bytes(&expanded_strings[i][..]));
    }

    bun_string_jsc::to_js_array(global, &out_strings[..])
}

#[bun_jsc::host_fn]
pub fn which(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let mut path_buf = bun_paths::path_buffer_pool::get();
    // SAFETY: bun_vm() returns the live per-thread singleton VM for a Bun-owned global.
    let vm = global_this.bun_vm();
    let mut arguments = ArgumentsSlice::init(vm, arguments_.slice());
    let Some(path_arg) = arguments.next_eat() else {
        return Err(global_this.throw(format_args!("which: expected 1 argument, got 0")));
    };

    let mut path_str = ZigStringSlice::EMPTY;
    let mut bin_str = ZigStringSlice::EMPTY;
    let mut cwd_str = ZigStringSlice::EMPTY;
    // path_str / bin_str / cwd_str deinit on Drop

    if path_arg.is_empty_or_undefined_or_null() {
        return Ok(JSValue::NULL);
    }

    bin_str = path_arg.to_slice(global_this)?;
    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if bin_str.slice().len() >= MAX_PATH_BYTES {
        return Err(global_this.throw(format_args!("bin path is too long")));
    }

    if bin_str.slice().is_empty() {
        return Ok(JSValue::NULL);
    }

    // SAFETY: `transpiler.env` / `.fs` are process-lifetime singletons set during VM init.
    path_str = ZigStringSlice::from_utf8_never_free(vm.env_loader().get(b"PATH").unwrap_or(b""));
    cwd_str = ZigStringSlice::from_utf8_never_free(vm.top_level_dir());

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

    if let Some(bin_path) = bun_which::which(
        &mut *path_buf,
        path_str.slice(),
        cwd_str.slice(),
        bin_str.slice(),
    ) {
        return Ok(ZigString::init(bin_path).with_encoding().to_js(global_this));
    }

    Ok(JSValue::NULL)
}

#[bun_jsc::host_fn]
pub fn inspect_table(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut args_buf = callframe.arguments_undef::<5>();
    let all_arguments = args_buf.mut_();
    if all_arguments[0].is_undefined_or_null() || !all_arguments[0].is_object() {
        return BunString::empty().to_js(global_this);
    }

    // PORT NOTE: protect/unprotect over a copied [JSValue; 5]; the borrow of
    // `all_arguments` cannot escape into a guard closure, so copy out into an
    // array of RAII guards.
    let _prot: [bun_jsc::ProtectedJSValue; 5] =
        core::array::from_fn(|i| all_arguments[i].protected());

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
    let mut table_printer = ConsoleObject::TablePrinter::init(
        global_this,
        ConsoleObject::MessageLevel::Log,
        value,
        properties,
    )?;
    table_printer.value_formatter.depth = format_options.max_depth;
    table_printer.value_formatter.ordered_properties = format_options.ordered_properties;
    table_printer.value_formatter.single_line = format_options.single_line;

    let print_result = if format_options.enable_colors {
        table_printer.print_table::<true>(&mut array)
    } else {
        table_printer.print_table::<false>(&mut array)
    };
    if print_result.is_err() {
        if !global_this.has_exception() {
            return Err(global_this.throw_out_of_memory());
        }
        return Ok(JSValue::ZERO);
    }

    // writer.flush(): Vec<u8> writer is unbuffered; nothing to flush.

    bun_string_jsc::create_utf8_for_js(global_this, &array)
}

#[bun_jsc::host_fn]
pub fn inspect(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let args_buf = callframe.arguments_old::<4>();
    if args_buf.len == 0 {
        return BunString::empty().to_js(global_this);
    }

    for arg in args_buf.slice() {
        arg.protect();
    }
    // Spec BunObject.zig:450 — `defer { for (arguments) |a| a.unprotect(); }`.
    // `arguments_old::<4>` is a stack `[JSValue; 4]`; move it into the guard
    // and re-slice instead of heap-allocating a `Vec` per call.
    //
    // NOTE: this is *not* the fix for error-gc-test.test.js timing out under
    // debug+ASAN — that test does 100k `Bun.inspect(new Error)` and the cost
    // is spread across ASAN-instrumented memcpy/memset, mimalloc zero-checks
    // and the source-file re-read in `remap_zig_exception`, none of which a
    // 32-byte alloc elision can recover. The test is classified `[TIMEOUT]`
    // for ASAN in test/expectations.txt instead.
    let args_buf = scopeguard::guard(args_buf, |buf| {
        for arg in buf.slice() {
            arg.unprotect();
        }
    });
    let arguments = args_buf.slice();

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
        ConsoleObject::MessageLevel::Debug,
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

// HOST_EXPORT(Bun__inspect, c)
pub fn bun_inspect(global_this: &JSGlobalObject, value: JSValue) -> BunString {
    // very stable memory address
    let mut array: Vec<u8> = Vec::new();

    let mut formatter = ConsoleObject::Formatter::new(global_this);
    if write!(&mut array, "{}", value.to_fmt(&mut formatter)).is_err() {
        return BunString::empty();
    }
    BunString::clone_utf8(&array)
}

// HOST_EXPORT(Bun__inspect_singleline, c)
pub fn bun_inspect_singleline(global_this: &JSGlobalObject, value: JSValue) -> BunString {
    let mut array: Vec<u8> = Vec::new();
    if ConsoleObject::format2(
        ConsoleObject::MessageLevel::Debug,
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
    let fun = JSFunction::create(
        global_object,
        "inspect",
        __jsc_host_inspect,
        2,
        Default::default(),
    );
    let mut str = bun_core::ZigString::init(b"nodejs.util.inspect.custom");
    fun.put(
        global_object,
        b"custom",
        JSValue::symbol_for(global_object, &mut str),
    );
    fun.put(
        global_object,
        b"table",
        JSFunction::create(
            global_object,
            "table",
            __jsc_host_inspect_table,
            3,
            Default::default(),
        ),
    );
    fun
}

#[bun_jsc::host_fn]
pub fn register_macro(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let arguments = arguments_.slice();
    if arguments.len() != 2 || !arguments[0].is_number() {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "Internal error registering macros: invalid args"
        )));
    }
    let id = arguments[0].to_int32();
    if id == -1 || id == 0 {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "Internal error registering macros: invalid id"
        )));
    }

    if !arguments[1].is_cell() || !arguments[1].is_callable() {
        // TODO: add "toTypeOf" helper
        return Err(global_object.throw(format_args!("Macro must be a function")));
    }

    // SAFETY: VirtualMachine::get() returns the live per-thread singleton.
    let get_or_put_result = VirtualMachine::get()
        .as_mut()
        .macros
        .get_or_put(id)
        .expect("unreachable");
    if get_or_put_result.found_existing {
        // `value_ptr` is `&mut JSObjectRef` (`*mut OpaqueJSValue`); recover the
        // protected JSValue and unprotect it before overwriting.
        JSValue::c(*get_or_put_result.value_ptr).unprotect();
    }

    arguments[1].protect();
    *get_or_put_result.value_ptr = arguments[1].as_object_ref();

    Ok(JSValue::UNDEFINED)
}

pub fn get_cwd(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    ZigString::init(bun_resolver::fs::FileSystem::get().top_level_dir).to_js(global_this)
}

pub fn get_origin(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // SAFETY: VirtualMachine::get() returns the live per-thread singleton.
    ZigString::init(VirtualMachine::get().origin.origin).to_js(global_this)
}

pub fn enable_ansi_colors(_global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSValue::from(Output::enable_ansi_colors_stdout() || Output::enable_ansi_colors_stderr())
}

// callconv(jsc.conv) — `SYSV_ABI` on win-x64 (BunObject.cpp:1103). Returns
// plain `JSValue` so the generated thunk is a bare deref+call (no
// `ExceptionValidationScope`), matching the .zig spec's bare body.
// HOST_EXPORT(BunObject_getter_main, jsc)
pub fn get_main(global_this: &JSGlobalObject) -> JSValue {
    // SAFETY: bun_vm() returns the live singleton VirtualMachine for a Bun-owned global.
    let vm = global_this.bun_vm().as_mut();
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
            if strings::ends_with(vm.main(), b"[eval]") {
                break 'use_resolved_path;
            }
            if strings::ends_with(vm.main(), b"[stdin]") {
                break 'use_resolved_path;
            }

            let Ok(fd) = sys::openat_a(
                if cfg!(windows) {
                    Fd::INVALID
                } else {
                    Fd::cwd()
                },
                vm.main(),
                // Open with the minimum permissions necessary for resolving the file path.
                if cfg!(target_os = "linux") {
                    sys::O::PATH
                } else {
                    sys::O::RDONLY
                },
                0,
            ) else {
                break 'use_resolved_path;
            };

            let _close = scopeguard::guard(fd, |fd: Fd| fd.close());
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

    ZigString::init(vm.main()).to_js(global_this)
}

// HOST_EXPORT(BunObject_setter_main, jsc)
pub fn set_main(global_this: &JSGlobalObject, new_value: JSValue) -> bool {
    // SAFETY: bun_vm() returns the live per-thread singleton.
    global_this
        .bun_vm()
        .as_mut()
        .overridden_main
        .set(global_this, new_value);
    true
}

pub fn get_argv(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    node::process::get_argv(global_this)
}

// PORT NOTE (layering): `RareData.editor_context` in `bun_jsc` is an opaque ZST
// stub — the real `EditorContext` lives in this crate (`cli::open`) and depends
// on `bun_dotenv` / `bun_spawn`, so it can't move down without dragging those
// into `bun_jsc`'s graph. Zig stored it on `rareData()`; semantically it is
// per-JS-thread state (one VM per thread), so a `thread_local` here is
// equivalent and breaks the cycle without type erasure.
//
// `name_storage` owns the user-supplied editor name so `EditorContext.name`
// (typed `&'static [u8]` to match the Zig dirname-store backing) can borrow it
// without leaking; the borrow lives as long as the thread.
struct EditorContextSlot {
    ctx: crate::cli::open::EditorContext,
    name_storage: Vec<u8>,
}
thread_local! {
    static EDITOR_CONTEXT: core::cell::RefCell<EditorContextSlot> =
        const { core::cell::RefCell::new(EditorContextSlot {
            ctx: crate::cli::open::EditorContext {
                editor: None,
                name: b"",
                path: b"",
            },
            name_storage: Vec::new(),
        }) };
}

#[bun_jsc::host_fn]
pub fn open_in_editor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let args = callframe.arguments_old::<4>();
    // SAFETY: bun_vm() returns the live per-thread singleton.
    let vm = global_this.bun_vm();
    let mut arguments = ArgumentsSlice::init(vm, args.slice());
    let mut path = ZigStringSlice::EMPTY;
    let mut editor_choice: Option<Editor> = None;
    let mut line: Option<ZigStringSlice> = None;
    let mut column: Option<ZigStringSlice> = None;

    if let Some(file_path_) = arguments.next_eat() {
        path = file_path_.to_slice(global_this)?;
    }

    EDITOR_CONTEXT.with(|cell| -> JsResult<JSValue> {
        let mut slot = cell.borrow_mut();
        let slot = &mut *slot;
        let edit = &mut slot.ctx;
        let env = vm.transpiler.env_mut();

        if let Some(opts) = arguments.next_eat() {
            if !opts.is_undefined_or_null() {
                if let Some(editor_val) = opts.get_truthy(global_this, "editor")? {
                    let sliced = editor_val.to_slice(global_this)?;
                    let prev_name = edit.name;

                    if !strings::eql_long(prev_name, sliced.slice(), true) {
                        let prev = core::mem::take(edit);
                        // PORT NOTE: Zig stashed the arena-backed slice
                        // directly into the persistent EditorContext (latent
                        // UAF in spec). Own the bytes in `name_storage` and
                        // hand back a thread-lifetime borrow.
                        slot.name_storage = sliced.slice().to_vec();
                        // SAFETY: `name_storage` lives in a thread_local that
                        // outlives any caller; we never reallocate it while
                        // `edit.name` is observed (single-threaded JS VM).
                        edit.name =
                            unsafe { bun_ptr::detach_lifetime(slot.name_storage.as_slice()) };
                        edit.detect_editor(env);
                        editor_choice = edit.editor;
                        if editor_choice.is_none() {
                            *edit = prev;
                            return Err(global_this.throw(format_args!(
                                "Could not find editor \"{}\"",
                                bstr::BStr::new(sliced.slice()),
                            )));
                        } else if edit.name.as_ptr() == edit.path.as_ptr() {
                            // detect_editor pointed `name` at `path`'s storage
                            // (process-lifetime dirname_store); dupe into our
                            // owned buffer so a later `path` overwrite doesn't
                            // dangling-alias it.
                            slot.name_storage = edit.path.to_vec();
                            // SAFETY: see above.
                            edit.name =
                                unsafe { bun_ptr::detach_lifetime(slot.name_storage.as_slice()) };
                        }
                    }
                }

                if let Some(line_) = opts.get_truthy(global_this, "line")? {
                    line = Some(line_.to_slice(global_this)?);
                }

                if let Some(column_) = opts.get_truthy(global_this, "column")? {
                    column = Some(column_.to_slice(global_this)?);
                }
            }
        }

        let editor = match editor_choice.or(edit.editor) {
            Some(e) => e,
            None => {
                edit.auto_detect_editor(env);
                match edit.editor {
                    Some(e) => e,
                    None => {
                        return Err(global_this.throw(format_args!("Failed to auto-detect editor")));
                    }
                }
            }
        };

        if path.slice().is_empty() {
            return Err(global_this.throw(format_args!("No file path specified")));
        }

        if let Err(err) = editor.open(
            edit.path,
            path.slice(),
            line.as_ref().map(|s| s.slice()),
            column.as_ref().map(|s| s.slice()),
        ) {
            return Err(global_this.throw(format_args!("Opening editor failed {}", err.name(),)));
        }

        Ok(JSValue::UNDEFINED)
    })
}

#[bun_jsc::host_fn]
pub fn sleep_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if arguments.len < 1 {
        return Err(global_object.throw_not_enough_arguments("sleepSync", 1, 0));
    }
    let arg = arguments.slice()[0];

    // The argument must be a number
    if !arg.is_number() {
        return Err(global_object.throw_invalid_argument_type(
            "sleepSync",
            "milliseconds",
            "number",
        ));
    }

    //NOTE: if argument is > max(i32) then it will be truncated
    let milliseconds = arg.coerce::<i32>(global_object)?;
    if milliseconds < 0 {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "argument to sleepSync must not be negative, got {milliseconds}"
        )));
    }

    // TODO(port): std.Thread.sleep — bun owns its own sleep; using thread::sleep
    // here matches Zig's blocking semantics (this is a sync API).
    std::thread::sleep(core::time::Duration::from_millis(
        u64::try_from(milliseconds).expect("int cast"),
    ));
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__gc, c)
pub fn gc(vm: &mut VirtualMachine, sync: bool) -> usize {
    vm.garbage_collect(sync)
}

#[bun_jsc::host_fn]
pub fn shrink(global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    global_object.vm().shrink_footprint();
    Ok(JSValue::UNDEFINED)
}

fn do_resolve(global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live per-thread singleton.
    let vm = global_this.bun_vm();
    let mut args = ArgumentsSlice::init(vm, arguments);
    let Some(specifier) = args.protect_eat_next() else {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a specifier and a from path")));
    };

    if specifier.is_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(format_args!("specifier must be a string")));
    }

    let Some(from) = args.protect_eat_next() else {
        return Err(global_this.throw_invalid_arguments(format_args!("Expected a from path")));
    };

    if from.is_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(format_args!("from must be a string")));
    }

    let mut is_esm = true;
    if let Some(next) = args.next_eat() {
        if next.is_boolean() {
            is_esm = next.to_boolean();
        } else {
            return Err(global_this.throw_invalid_arguments(format_args!("esm must be a boolean")));
        }
    }

    let specifier_str = specifier.to_bun_string(global_this)?;
    let specifier_str = scopeguard::guard(specifier_str, |s| s.deref());
    let from_str = from.to_bun_string(global_this)?;
    let from_str = scopeguard::guard(from_str, |s| s.deref());
    do_resolve_with_args::<false>(global_this, *specifier_str, *from_str, is_esm, false)
}

/// Single Drop point for the three `BunString`s `do_resolve_with_args` may own.
/// Replaces three separate `scopeguard::guard(_, |s| s.deref())` closures —
/// each of which generated its own drop frame and landing pad — with one
/// contiguous cleanup. Fields default to `BunString::empty()`, whose `deref()`
/// is a single tag-compare no-op, so unused slots cost effectively nothing.
struct ResolveDerefOnDrop {
    query_string: BunString,
    /// Only set when the specifier had a `file://` prefix and we allocated a
    /// decoded copy. On the fast path the caller's `specifier` is borrowed
    /// directly and this stays empty (no refcount traffic).
    decoded_specifier: BunString,
    result_value: BunString,
}
impl Drop for ResolveDerefOnDrop {
    #[inline]
    fn drop(&mut self) {
        // LIFO relative to original declaration order.
        self.result_value.deref();
        self.decoded_specifier.deref();
        self.query_string.deref();
    }
}

fn do_resolve_with_args<const IS_FILE_PATH: bool>(
    ctx: &JSGlobalObject,
    specifier: BunString,
    from: BunString,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JsResult<JSValue> {
    let mut errorable: ErrorableString = ErrorableString::ok(BunString::empty());
    let mut owned = ResolveDerefOnDrop {
        query_string: BunString::empty(),
        decoded_specifier: BunString::empty(),
        result_value: BunString::empty(),
    };

    // Fast path: no `file://` prefix → forward the caller-owned `specifier`
    // by value without `dupe_ref()`/`deref()` refcount churn. Only the
    // URL-decoded branch produces a string we must release.
    let specifier_for_resolve = if specifier.has_prefix_comptime(b"file://") {
        owned.decoded_specifier = jsc::URL::path_from_file_url(specifier);
        owned.decoded_specifier
    } else {
        specifier
    };

    VirtualMachine::resolve_maybe_needs_trailing_slash::<IS_FILE_PATH>(
        &mut errorable,
        ctx,
        specifier_for_resolve,
        from,
        Some(&mut owned.query_string),
        is_esm,
        is_user_require_resolve,
    )?;

    if !errorable.success {
        // SAFETY: !success → `err` arm of the #[repr(C)] union is active.
        return Err(ctx.throw_value(unsafe { errorable.result.err }.value));
    }
    // SAFETY: success → `value` arm of the #[repr(C)] union is active.
    owned.result_value = unsafe { errorable.result.value };

    if !owned.query_string.is_empty() {
        // PERF(port): was stack-fallback
        let mut arraylist: Vec<u8> = Vec::with_capacity(1024);
        // Vec<u8> writes are infallible.
        let _ = write!(
            &mut arraylist,
            "{}{}",
            owned.result_value, owned.query_string
        );

        return Ok(ZigString::init_utf8(&arraylist).to_js(ctx));
    }

    owned.result_value.to_js(ctx)
}

#[bun_jsc::host_fn]
pub fn resolve_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    do_resolve(global_object, callframe.arguments())
}

#[bun_jsc::host_fn]
pub fn resolve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
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

// HOST_EXPORT(Bun__resolve, c)
pub fn bun_resolve(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
) -> JSValue {
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let specifier_str = scopeguard::guard(specifier_str, |s| s.deref());

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let source_str = scopeguard::guard(source_str, |s| s.deref());

    let value =
        match do_resolve_with_args::<true>(global, *specifier_str, *source_str, is_esm, false) {
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

// HOST_EXPORT(Bun__resolveSync, c)
pub fn bun_resolve_sync(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JSValue {
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let specifier_str = scopeguard::guard(specifier_str, |s| s.deref());

    if specifier_str.length() == 0 {
        let _ = global
            .err(
                jsc::ErrCode::INVALID_ARG_VALUE,
                format_args!("The argument 'id' must be a non-empty string. Received ''"),
            )
            .throw();
        return JSValue::ZERO;
    }

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let source_str = scopeguard::guard(source_str, |s| s.deref());

    jsc::to_js_host_call(global, || {
        do_resolve_with_args::<true>(
            global,
            *specifier_str,
            *source_str,
            is_esm,
            is_user_require_resolve,
        )
    })
}

// HOST_EXPORT(Bun__resolveSyncWithPaths, c)
pub fn bun_resolve_sync_with_paths(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
    paths_ptr: *const BunString,
    paths_len: usize,
) -> JSValue {
    // SAFETY: caller is C++; paths_ptr is valid for paths_len.
    let paths: &[BunString] = if paths_len == 0 {
        &[]
    } else {
        unsafe { core::slice::from_raw_parts(paths_ptr, paths_len) }
    };

    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let specifier_str = scopeguard::guard(specifier_str, |s| s.deref());

    if specifier_str.length() == 0 {
        let _ = global
            .err(
                jsc::ErrCode::INVALID_ARG_VALUE,
                format_args!("The argument 'id' must be a non-empty string. Received ''"),
            )
            .throw();
        return JSValue::ZERO;
    }

    let Ok(source_str) = source.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let source_str = scopeguard::guard(source_str, |s| s.deref());

    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let bun_vm = global.bun_vm().as_mut();
    debug_assert!(bun_vm.transpiler.resolver.custom_dir_paths.is_none());
    // SAFETY: `paths` borrows C++-owned BunStrings valid for the duration of
    // this synchronous resolve call; lifetime is erased for the resolver slot.
    bun_vm.transpiler.resolver.custom_dir_paths = Some(unsafe { bun_ptr::detach_lifetime(paths) });
    scopeguard::defer! {
        // SAFETY: same VM pointer; called before returning to C++.
        global.bun_vm().as_mut().transpiler.resolver.custom_dir_paths = None;
    }

    jsc::to_js_host_call(global, || {
        do_resolve_with_args::<true>(
            global,
            *specifier_str,
            *source_str,
            is_esm,
            is_user_require_resolve,
        )
    })
}

bun_output::declare_scope!(importMetaResolve, visible);

// HOST_EXPORT(Bun__resolveSyncWithStrings, c)
pub fn bun_resolve_sync_with_strings(
    global: &JSGlobalObject,
    specifier: &BunString,
    source: &BunString,
    is_esm: bool,
) -> JSValue {
    bun_output::scoped_log!(
        importMetaResolve,
        "source: {}, specifier: {}",
        source,
        specifier
    );
    jsc::to_js_host_call(global, || {
        do_resolve_with_args::<true>(global, *specifier, *source, is_esm, false)
    })
}

// HOST_EXPORT(Bun__resolveSyncWithSource, c)
pub fn bun_resolve_sync_with_source(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: &BunString,
    is_esm: bool,
    is_user_require_resolve: bool,
) -> JSValue {
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    let specifier_str = scopeguard::guard(specifier_str, |s| s.deref());
    if specifier_str.length() == 0 {
        let _ = global
            .err(
                jsc::ErrCode::INVALID_ARG_VALUE,
                format_args!("The argument 'id' must be a non-empty string. Received ''"),
            )
            .throw();
        return JSValue::ZERO;
    }
    jsc::to_js_host_call(global, || {
        do_resolve_with_args::<true>(
            global,
            *specifier_str,
            *source,
            is_esm,
            is_user_require_resolve,
        )
    })
}

#[bun_jsc::host_fn]
pub fn index_of_line(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old::<2>();
    let arguments = arguments_.slice();
    if arguments.is_empty() {
        return Ok(JSValue::js_number_from_int32(-1));
    }

    let Some(buffer) = arguments[0].as_array_buffer(global_this) else {
        return Ok(JSValue::js_number_from_int32(-1));
    };

    let mut offset: usize = 0;
    if arguments.len() > 1 {
        let offset_value = arguments[1].coerce_to_int64(global_this)?;
        offset = offset_value.max(0) as usize;
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
                return Ok(JSValue::js_number(i as f64));
            }

            current_offset = i as usize + 1;
        } else {
            break;
        }
    }

    Ok(JSValue::js_number_from_int32(-1))
}

pub use crate::crypto as crypto_mod;
// TODO(port): `pub const Crypto = @import("../crypto/crypto.zig");` re-exports
// the crypto module under this file's namespace; in Rust the canonical path is
// `crate::crypto`.

#[bun_jsc::host_fn]
pub fn nanoseconds(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let ns = global_this
        .bun_vm()
        .as_mut()
        .origin_timer
        .elapsed()
        .as_nanos() as u64;
    Ok(JSValue::js_number_from_uint64(ns))
}

#[bun_jsc::host_fn]
pub fn serve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<2>();
    let arguments = arguments.slice();
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global_object.bun_vm().as_mut();
    let mut config: crate::server::ServerConfig = 'brk: {
        let mut args = ArgumentsSlice::init(vm, arguments);

        let config = crate::server::ServerConfig::from_js(
            global_object,
            &mut args,
            crate::server::server_config::FromJSOptions {
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

    // SAFETY: same VM pointer; re-borrow after `args` is dropped.
    let vm = global_object.bun_vm().as_mut();

    // PORT NOTE (layering): Zig's `HotMap` is a `TaggedPtrUnion` over the four
    // `NewServer` monomorphizations + sockets. `bun_jsc::rare_data::HotMapEntry`
    // is the erased `(tag: u8, ptr: *mut ())` lowering of that union; the tag
    // values for servers are pinned here to match `crate::server::AnyServerTag`
    // (= the runtime-side discriminant) so a HotMap entry produced by `serve`
    // is round-trippable through `serve` again on hot-reload.
    use crate::server::{AnyServer, AnyServerTag};
    use bun_jsc::rare_data::HotMapEntry;

    if config.allow_hot {
        if let Some(hot) = vm.hot_map() {
            if config.id.is_empty() {
                config.id = config.compute_id().into();
            }

            if let Some(entry) = hot.get_entry(&config.id) {
                macro_rules! reload {
                    ($T:ty) => {{
                        // SAFETY: tag was matched; ptr was inserted as `*mut $T` below.
                        let server: &mut $T = unsafe { &mut *entry.ptr.cast::<$T>() };
                        server.on_reload_from_zig(&mut config, global_object);
                        return Ok(server.js_value.try_get().unwrap_or(JSValue::UNDEFINED));
                    }};
                }
                match entry.tag {
                    t if t == AnyServerTag::HTTPServer as u8 => reload!(crate::api::HTTPServer),
                    t if t == AnyServerTag::DebugHTTPServer as u8 => {
                        reload!(crate::api::DebugHTTPServer)
                    }
                    t if t == AnyServerTag::DebugHTTPSServer as u8 => {
                        reload!(crate::api::DebugHTTPSServer)
                    }
                    t if t == AnyServerTag::HTTPSServer as u8 => reload!(crate::api::HTTPSServer),
                    _ => {}
                }
            }
        }
    }

    macro_rules! serve_with {
        ($ServerType:ty, $tag:expr) => {{
            let server = <$ServerType>::init(&mut config, global_object)?;
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            // SAFETY: `init` returned a live heap-allocated server pointer.
            let server_ref: &mut $ServerType = unsafe { &mut *server };
            let route_list_object = <$ServerType>::listen(server);
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            let obj = <$ServerType>::ptr_to_js(server, global_object);
            if route_list_object != JSValue::ZERO {
                // PORT NOTE: `ServerType.js.routeListSetCached` (codegen
                // `.classes.ts`) — routed through the typed helper in
                // `server_body` until per-type codegen externs land.
                <$ServerType>::js_gc_route_list_set(obj, global_object, route_list_object);
            }
            server_ref.js_value.set_strong(obj, global_object);

            if config.allow_hot {
                // SAFETY: same VM pointer; re-borrow after the earlier `vm` mut
                // borrow was released by the `hot_map()` arm above.
                if let Some(hot) = global_object.bun_vm().as_mut().hot_map() {
                    hot.insert_raw(
                        &config.id,
                        HotMapEntry {
                            tag: $tag as u8,
                            ptr: server.cast::<()>(),
                        },
                    );
                }
            }

            // SAFETY: bun_vm() returns the live thread-local VM.
            if let Some(debugger) = global_object.bun_vm().as_mut().debugger.as_deref_mut() {
                let any = AnyServer::from(server.cast_const());
                crate::server::http_server_agent::notify_server_started(
                    &mut debugger.http_server_agent,
                    any,
                );
                bun_core::handle_oom(
                    crate::server::http_server_agent::notify_server_routes_updated(
                        &mut debugger.http_server_agent,
                        any,
                    ),
                );
            }

            Ok(obj)
        }};
    }

    // PORT NOTE: Zig used nested `switch (bool) { inline else => |c| ... }` to
    // monomorphize over (has_ssl_config, development). Expanded here.
    let has_ssl_config = config.ssl_config.is_some();
    let development = config.is_development();
    match (development, has_ssl_config) {
        (true, true) => serve_with!(crate::api::DebugHTTPSServer, AnyServerTag::DebugHTTPSServer),
        (true, false) => serve_with!(crate::api::DebugHTTPServer, AnyServerTag::DebugHTTPServer),
        (false, true) => serve_with!(crate::api::HTTPSServer, AnyServerTag::HTTPSServer),
        (false, false) => serve_with!(crate::api::HTTPServer, AnyServerTag::HTTPServer),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__escapeHTML16(
    global_object: &JSGlobalObject,
    input_value: JSValue,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    debug_assert!(len > 0);
    // SAFETY: caller passes a valid [ptr, len) UTF-16 slice.
    let input_slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    use bun_core::immutable::escape_html::{Escaped, escape_html_for_utf16_input};
    let escaped = match escape_html_for_utf16_input(input_slice) {
        Ok(v) => v,
        Err(_) => {
            let _ = global_object
                .throw_value(ZigString::init(b"Out of memory").to_error_instance(global_object));
            return JSValue::ZERO;
        }
    };

    match escaped {
        Escaped::Static(val) => ZigString::init(val).to_js(global_object),
        Escaped::Original => input_value,
        Escaped::Allocated(escaped_html) => {
            // SAFETY: ownership of `escaped_html`'s buffer transfers to JSC via
            // the external-string finalizer; do not drop it here.
            let (ptr, len) = (escaped_html.as_ptr(), escaped_html.len());
            core::mem::forget(escaped_html);
            jsc::zig_string_to_external_u16(ptr, len, global_object)
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__escapeHTML8(
    global_object: &JSGlobalObject,
    input_value: JSValue,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    debug_assert!(len > 0);
    // SAFETY: caller passes a valid [ptr, len) byte slice.
    let input_slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    // PERF(port): was stack-fallback (256 bytes) — profile in Phase B

    use bun_core::immutable::escape_html::{Escaped, escape_html_for_latin1_input};
    let escaped = match escape_html_for_latin1_input(input_slice) {
        Ok(v) => v,
        Err(_) => {
            let _ = global_object
                .throw_value(ZigString::init(b"Out of memory").to_error_instance(global_object));
            return JSValue::ZERO;
        }
    };

    match escaped {
        Escaped::Static(val) => ZigString::init(val).to_js(global_object),
        Escaped::Original => input_value,
        Escaped::Allocated(escaped_html) => {
            if cfg!(debug_assertions) {
                // the output should always be longer than the input
                debug_assert!(escaped_html.len() > input_slice.len());

                // assert we do not allocate a new string unnecessarily
                debug_assert!(input_slice != &escaped_html[..]);
            }

            if input_slice.len() <= 32 {
                let zig_str = ZigString::init(&escaped_html);
                let out = zig_str.to_atomic_value(global_object);
                return out;
            }

            // Ownership of the buffer transfers to JSC's external-string
            // finalizer (mimalloc-backed) via `to_external_value`; release
            // the Box without dropping so JSC frees it on GC.
            let raw: *mut [u8] = bun_core::heap::into_raw(escaped_html);
            // SAFETY: `raw` is a freshly-leaked Box<[u8]> allocation, valid for
            // the duration of this call; the resulting JSC external string
            // adopts and later frees it.
            ZigString::init(unsafe { &*raw }).to_external_value(global_object)
        }
    }
}

#[bun_jsc::host_fn]
pub fn alloc_unsafe(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    let size = arguments.ptr[0];
    if !size.is_uint32_as_any_int() {
        return Err(global_this.throw_invalid_arguments(format_args!("Expected a positive number")));
    }
    JSValue::create_uninitialized_uint8_array(global_this, size.to_uint64_no_truncate() as usize)
}

#[bun_jsc::host_fn]
pub fn mmap_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        return Err(global_this.throw_todo(b"mmapFile is not supported on Windows"));
    }

    #[cfg(not(windows))]
    {
        let arguments_ = callframe.arguments_old::<2>();
        // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
        let vm = global_this.bun_vm();
        let mut args = ArgumentsSlice::init(vm, arguments_.slice());

        let mut buf = PathBuffer::uninit();
        let path = 'brk: {
            if let Some(path) = args.next_eat() {
                if path.is_string() {
                    let path_str = path.to_slice(global_this)?;
                    if path_str.slice().len() > MAX_PATH_BYTES {
                        return Err(
                            global_this.throw_invalid_arguments(format_args!("Path too long"))
                        );
                    }
                    let paths = &[path_str.slice()];
                    break 'brk bun_paths::resolve_path::join_abs_string_buf::<
                        bun_paths::resolve_path::platform::Auto,
                    >(
                        bun_paths::fs::FileSystem::instance().top_level_dir(),
                        &mut buf,
                        paths,
                    );
                }
            }
            return Err(global_this.throw_invalid_arguments(format_args!("Expected a path")));
        };

        let path_len = path.len();
        buf[path_len] = 0;

        // SAFETY: buf[path_len] == 0 written above
        let buf_z = bun_core::ZStr::from_buf(&buf[..], path_len);

        // PORT NOTE: Zig used `std.c.MAP{ .TYPE = .SHARED }` (a packed bitfield
        // struct). Rust libc exposes raw `MAP_*` ints; build the flag word
        // directly.
        let mut flags: libc::c_int = libc::MAP_SHARED;

        // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
        let mut offset: usize = 0;
        let mut map_size: Option<usize> = None;

        if let Some(opts) = args.next_eat() {
            if opts.is_object() {
                flags = if opts
                    .get_boolean_loose(global_this, "shared")?
                    .unwrap_or(true)
                {
                    libc::MAP_SHARED
                } else {
                    libc::MAP_PRIVATE
                };

                // TODO(port): @hasField(std.c.MAP, "SYNC") — gated by target_os in Rust.
                #[cfg(target_os = "linux")]
                if opts
                    .get_boolean_loose(global_this, "sync")?
                    .unwrap_or(false)
                {
                    flags = libc::MAP_SHARED_VALIDATE | libc::MAP_SYNC;
                }

                if let Some(value) = opts.get(global_this, "size")? {
                    let size_value = value.coerce_to_int64(global_this)?;
                    if size_value < 0 {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "size must be a non-negative integer",
                        )));
                    }
                    map_size = Some(usize::try_from(size_value).expect("int cast"));
                }

                if let Some(value) = opts.get(global_this, "offset")? {
                    let offset_value = value.coerce_to_int64(global_this)?;
                    if offset_value < 0 {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "offset must be a non-negative integer",
                        )));
                    }
                    offset = usize::try_from(offset_value).expect("int cast");
                    // std.mem.alignBackwardAnyAlign(usize, offset, pageSize())
                    let page = bun_sys::page_size();
                    offset -= offset % page;
                }
            } else if !opts.is_undefined_or_null() {
                return Err(global_this
                    .throw_invalid_arguments(format_args!("Expected options to be an object")));
            }
        }

        let map = match bun_sys::mmap_file(buf_z, flags, map_size, offset) {
            Ok(map) => map,
            Err(err) => {
                use bun_jsc::SysErrorJsc as _;
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
        };

        extern "C" fn munmap_dealloc(ptr: *mut c_void, size: *mut c_void) {
            // SAFETY: ptr is the original mmap base, size is its length stuffed into a pointer.
            let _ = sys::munmap(ptr.cast::<u8>(), size as usize);
        }

        jsc::array_buffer::make_typed_array_with_bytes_no_copy(
            global_this,
            jsc::TypedArrayType::TypeUint8,
            map.as_ptr().cast_mut().cast::<c_void>(),
            map.len(),
            Some(munmap_dealloc),
            map.len() as *mut c_void,
        )
    }
}

pub fn get_transpiler_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::js_transpiler::JSTranspiler>(global_this)
}

pub fn get_file_system_router(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::filesystem_router::FileSystemRouter>(
        global_this,
    )
}

pub fn get_hash_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    HashObject::create(global_this)
}

pub fn get_jsonc_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::jsonc_object::create(global_this)
}
pub fn get_markdown_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::markdown_object::create(global_this)
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
    jsc::codegen::js::get_constructor::<crate::api::archive::Archive>(global_this)
}

pub fn get_glob_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::glob::Glob>(global_this)
}

pub fn get_image_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::image::Image>(global_this)
}

pub fn get_s3_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::webcore::s3_client::S3Client>(global_this)
}

pub fn get_s3_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // PORT NOTE (layering): `RareData::s3_default_client` body lives in
    // `bun_jsc::rare_data::_accessor_body` and names `bun_runtime::s3` types.
    // That can't compile in `bun_jsc`, so port the body here where the S3
    // types are in scope and store the cached value through the public
    // `RareData.s3_default_client: Strong` field.
    use crate::webcore::s3_client::S3Client;
    use bun_jsc::StrongOptional;
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global_this.bun_vm().as_mut();
    // PORT NOTE: reshaped for borrowck — capture the raw env loader pointer
    // before `rare_data()` takes the long-lived `&mut` of `vm`.
    let env_ptr = vm.transpiler.env;
    let rare = vm.rare_data();
    if let Some(v) = rare.s3_default_client.get() {
        return v;
    }
    // PORT NOTE (layering): `bun_dotenv::Loader::get_s3_credentials` returns the
    // T2 POD mirror; lift it into the refcounted `bun_s3_signing::S3Credentials`
    // here at the high-tier call site (dotenv ≤T2 may not name s3_signing T5).
    // SAFETY: `transpiler.env` is the process-lifetime dotenv loader; disjoint
    // from `rare_data` storage.
    let env_creds =
        crate::webcore::fetch::s3_credentials_from_env(unsafe { (*env_ptr).get_s3_credentials() });
    let aws_options = match crate::webcore::s3::credentials_jsc::get_credentials_with_options(
        &env_creds,
        Default::default(),
        None,
        None,
        None,
        false,
        global_this,
    ) {
        Ok(v) => v,
        Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
        Err(err) => {
            global_this.report_active_exception_as_unhandled(err);
            return JSValue::UNDEFINED;
        }
    };
    let client = S3Client {
        credentials: aws_options.credentials.dupe(),
        options: aws_options.options,
        acl: aws_options.acl,
        storage_class: aws_options.storage_class,
        request_payer: aws_options.request_payer,
    };
    let js_client = <S3Client as bun_jsc::JsClass>::to_js(client, global_this);
    js_client.ensure_still_alive();
    rare.s3_default_client = StrongOptional::create(js_client, global_this);
    js_client
}

pub fn get_tls_default_ciphers(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    // PORT NOTE: BunObject.zig forwards to `rareData().tlsDefaultCiphers()`
    // which (per rare_data.zig) returns `?[:0]const u8`; coerce to a JS string
    // here, falling back to the compiled-in uWS default cipher list.
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global_this.bun_vm().as_mut();
    let bytes: &[u8] = match vm.rare_data().tls_default_ciphers() {
        Some(c) => c,
        None => bun_uws::get_default_ciphers().as_bytes(),
    };
    bun_string_jsc::create_utf8_for_js(global_this, bytes).unwrap_or(JSValue::ZERO)
}

pub fn set_tls_default_ciphers(
    global_this: &JSGlobalObject,
    _: &JSObject,
    ciphers: JSValue,
) -> JSValue {
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global_this.bun_vm().as_mut();
    let Ok(sliced) = ciphers.to_slice(global_this) else {
        return JSValue::ZERO;
    };
    vm.rare_data().set_tls_default_ciphers(sliced.slice());
    JSValue::UNDEFINED
}

pub fn get_valkey_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    use crate::valkey_jsc::JSValkeyClient;

    let valkey = match JSValkeyClient::create_no_js_no_pubsub(global_this, &[JSValue::UNDEFINED]) {
        Ok(p) => p,
        Err(jsc::JsError::Thrown) | Err(jsc::JsError::Terminated) => return JSValue::ZERO,
        Err(err) => {
            let _ = global_this.throw_error(err.into(), "Failed to create Redis client");
            return JSValue::ZERO;
        }
    };

    let as_js = JSValkeyClient::ptr_to_js(valkey, global_this);

    // SAFETY: `valkey` is a fresh heap allocation owned by the JS wrapper; we
    // hold the only reference for field init below.
    let valkey_ref = unsafe { &*valkey };
    valkey_ref.this_value.set(jsc::JsRef::init_weak(as_js));
    match SubscriptionCtx::init(valkey_ref) {
        Ok(ctx) => valkey_ref._subscription_ctx.set(ctx),
        Err(jsc::JsError::Thrown) | Err(jsc::JsError::Terminated) => return JSValue::ZERO,
        Err(err) => {
            let _ = global_this.throw_error(err.into(), "Failed to create Redis client");
            return JSValue::ZERO;
        }
    }

    as_js
}

pub fn get_valkey_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::valkey_jsc::JSValkeyClient>(global_this)
}

pub fn get_terminal_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::bun_terminal_body::js::get_constructor(global_this)
}

pub fn get_embedded_files(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    use crate::webcore::blob::{Blob, BlobExt as _};
    use bun_standalone_graph::{File as GraphFile, Graph as StandaloneModuleGraph};
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global_this.bun_vm();
    if vm.standalone_module_graph.is_none() {
        return JSValue::create_empty_array(global_this, 0);
    }
    // PORT NOTE (layering): `VirtualMachine.standalone_module_graph` is
    // type-erased to `&dyn bun_resolver::StandaloneModuleGraph` so `bun_jsc`
    // doesn't depend on `bun_standalone_graph`. The concrete graph is the
    // process singleton — `Graph::get()` returns the same instance the trait
    // object was built from (`vm.standalone_module_graph.is_some()` ⇔
    // `Graph::get().is_some()`).
    let graph: &mut StandaloneModuleGraph = unsafe {
        &mut *StandaloneModuleGraph::get()
            .expect("vm.standalone_module_graph set ⇔ Graph singleton populated")
    };

    let unsorted_files = graph.files.values_mut();
    let mut sort_indices: Vec<u32> = Vec::with_capacity(unsorted_files.len());
    for (index, file) in unsorted_files.iter().enumerate() {
        // Some % of people using `bun build --compile` want to obscure the source code
        // We don't really do that right now, but exposing the output source
        // code here as an easily accessible Blob is even worse for them.
        // So let's omit any source code files from the list.
        if !file.appears_in_embedded_files_array() {
            continue;
        }
        sort_indices.push(index as u32);
    }

    let array = JSValue::create_empty_array(global_this, sort_indices.len())?;
    sort_indices.sort_by(|a, b| {
        if GraphFile::less_than_by_index(unsorted_files, *a, *b) {
            core::cmp::Ordering::Less
        } else if GraphFile::less_than_by_index(unsorted_files, *b, *a) {
            core::cmp::Ordering::Greater
        } else {
            core::cmp::Ordering::Equal
        }
    });
    for (i, index) in sort_indices.iter().enumerate() {
        let file: &mut GraphFile = &mut unsorted_files[*index as usize];
        // PORT NOTE (layering): `File::blob()` lives in the Zig spec's
        // `StandaloneModuleGraph.File`; that crate can't depend on
        // `bun_runtime::webcore::Blob`, so build the blob here from the
        // file's `cached_blob` slot / contents.
        let input_blob: *mut Blob = standalone_file_blob(file, global_this);
        // We call .dupe() on this to ensure that we don't return a blob that might get freed later.
        // SAFETY: `standalone_file_blob` returns a non-null heap allocation.
        let blob = Blob::new(unsafe { (*input_blob).dupe_with_content_type(true) });
        // SAFETY: `Blob::new` returned a fresh heap allocation.
        unsafe { (*blob).name.set((*input_blob).name.get().dupe_ref()) };
        // SAFETY: `blob` is heap-allocated and lives until JS owns it via to_js.
        array.put_index(global_this, i as u32, unsafe { (*blob).to_js(global_this) })?;
    }

    Ok(array)
}

/// `StandaloneModuleGraph.File.blob()` — ported here (rather than upstream in
/// `bun_standalone_graph`) because `Blob`/`Store` live in `bun_runtime::webcore`
/// and would otherwise create a crate cycle.
fn standalone_file_blob(
    file: &mut bun_standalone_graph::File,
    global: &JSGlobalObject,
) -> *mut crate::webcore::blob::Blob {
    use crate::webcore::blob::{Blob, Store, StoreRef};
    if let Some(cached) = file.cached_blob {
        return cached.as_ptr().cast::<Blob>();
    }
    let store: StoreRef = Store::init(file.contents.as_bytes().to_vec());
    let mut blob_body = Blob::init_with_store(store, global);
    // PORT NOTE (cyclebreak): `MimeType::by_loader` takes the `#[repr(u8)]`
    // discriminant and an extension; matches Zig spec
    // `MimeType.byLoader(file.loader, std.fs.path.extension(file.name))`.
    let mime =
        bun_http_types::MimeType::by_loader(file.loader as u8, bun_paths::extension(file.name));
    // SAFETY: `mime.value` is `Cow<'static, [u8]>`; the slice pointer is
    // stable for the life of `mime` (`'static` for the table-backed loaders).
    blob_body
        .content_type
        .set(std::ptr::from_ref::<[u8]>(mime.value.as_ref()));
    // Hold the (potentially owned) `Cow` for the lifetime of the cached blob.
    // The `by_loader` table only returns `Borrowed(&'static ..)`, so leaking
    // is a no-op for the static case and correct for the owned `OTHER` case.
    core::mem::forget(mime);
    blob_body
        .name
        .set(BunString::clone_utf8(bun_paths::basename(file.name)));
    let blob = Blob::new(blob_body);
    // SAFETY: `Blob::new` heap-allocates; never null.
    file.cached_blob = core::ptr::NonNull::new(blob.cast());
    blob
}

pub fn get_semver(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    bun_semver_jsc::SemverObject::create(global_this)
}

pub fn get_unsafe(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    UnsafeObject::create(global_this)
}

#[bun_jsc::host_fn]
pub fn string_width(global_object: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    bun_jsc::bun_string_jsc::js_get_string_width(global_object, call_frame)
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

        // PORT NOTE: `JSFunction::create` takes the raw JSC-ABI host fn pointer,
        // so wrap the safe Rust-style `JsResult` fns via `to_js_host_call`.
        bun_jsc::jsc_host_abi! {
            unsafe fn csrf_generate_shim(
                g: *mut JSGlobalObject,
                f: *mut CallFrame,
            ) -> JSValue {
                // SAFETY: JSC always passes valid pointers here.
                let (g, f) = unsafe { (&*g, &*f) };
                bun_jsc::to_js_host_call(g, || csrf_jsc::csrf__generate(g, f))
            }
        }
        bun_jsc::jsc_host_abi! {
            unsafe fn csrf_verify_shim(
                g: *mut JSGlobalObject,
                f: *mut CallFrame,
            ) -> JSValue {
                // SAFETY: JSC always passes valid pointers here.
                let (g, f) = unsafe { (&*g, &*f) };
                bun_jsc::to_js_host_call(g, || csrf_jsc::csrf__verify(g, f))
            }
        }

        object.put(
            global_this,
            b"generate",
            JSFunction::create(
                global_this,
                "generate",
                csrf_generate_shim,
                1,
                Default::default(),
            ),
        );

        object.put(
            global_this,
            b"verify",
            JSFunction::create(
                global_this,
                "verify",
                csrf_verify_shim,
                1,
                Default::default(),
            ),
        );

        object
    }
}

// This is aliased to Bun.env
pub mod environment_variables {
    use super::*;

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvCount(
        global_object: &JSGlobalObject,
        ptr: &mut core::mem::MaybeUninit<*const Box<[u8]>>,
    ) -> usize {
        let bun_vm = global_object.bun_vm().as_mut();
        let env = bun_vm.env_loader();
        let keys: &[Box<[u8]>] = env.map.map.keys();
        // C++ declares this out-param as `void**` and only ever round-trips it
        // back into `Bun__getEnvKey` below; the element layout is opaque to it.
        // The backing Vec lives for the VM lifetime and is not reallocated
        // between this call and `Bun__getEnvKey`.
        ptr.write(keys.as_ptr());
        keys.len()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvKey(
        ptr: *const Box<[u8]>,
        i: usize,
        data_ptr: &mut core::mem::MaybeUninit<*const u8>,
    ) -> usize {
        // SAFETY: ptr was returned from Bun__getEnvCount; i < count.
        let item: &[u8] = unsafe { &**ptr.add(i) };
        data_ptr.write(item.as_ptr());
        item.len()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvValue(
        global_object: &JSGlobalObject,
        name: &ZigString,
        value: &mut core::mem::MaybeUninit<ZigString>,
    ) -> bool {
        if let Some(val) = get_env_value(global_object, *name) {
            value.write(val);
            return true;
        }

        false
    }

    /// BunString variant of Bun__getEnvValue. The returned value borrows from
    /// the env map; caller must copy before the map can mutate.
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getEnvValueBunString(
        global_object: &JSGlobalObject,
        name: &BunString,
        value: &mut core::mem::MaybeUninit<BunString>,
    ) -> bool {
        let vm = global_object.bun_vm();
        let name_slice = name.to_utf8();
        let Some(val) = vm.env_loader().get(name_slice.slice()) else {
            return false;
        };
        value.write(BunString::borrow_utf8(val));
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
        global_object: &JSGlobalObject,
        name: &BunString,
        value: &BunString,
    ) {
        let vm = global_object.bun_vm().as_mut();
        let name_slice = name.to_utf8();

        // Synchronize the slot swap + env.map.put against a concurrently
        // spawning worker's cloneFrom + env.map.cloneWithAllocator. Without
        // this, the worker could clone the slot `Arc` between our drop
        // (refcount → 0 → free) and the `None` write below.
        let mut slots = vm.proxy_env_storage.lock();

        let Some(slot) = slots.slot(name_slice.slice()) else {
            return;
        };

        // Deref our previous value. If a worker still holds a ref, the
        // bytes stay alive; if not, they're freed now.
        *slot.ptr = None;

        // PORT NOTE: `Loader.map` is `&'a mut Map` (a mutable reference field);
        // re-borrow as `&mut *` to avoid moving the reference out of the loader.
        let env_map = &mut *vm.transpiler.env_mut().map;

        if value.is_empty() {
            // Store a static empty string rather than removing, so that
            // process.env.X reads back as "" (Node.js semantics) instead
            // of undefined. isNoProxy treats empty strings the same as
            // absent — no bypass.
            bun_core::handle_oom(env_map.put(slot.key, b""));
            return;
        }

        let value_slice = value.to_utf8();
        let new_val = bun_jsc::rare_data::RefCountedEnvValue::create(value_slice.slice());
        let stored = slot.ptr.insert(new_val);
        // slot.key is a static-lifetime string literal (the struct field name).
        // PORT NOTE: Zig's `map.put` stored the slice header without duping,
        // so the slot write had to precede `put` for the map to borrow live
        // bytes. Rust's `Map::put` boxes its own copy — the Arc wrapper now
        // only backs `proxy_env_storage` for worker `cloneFrom`; ordering is
        // kept for spec parity.
        bun_core::handle_oom(env_map.put(slot.key, &stored.bytes));
    }

    pub fn get_env_names(global_object: &JSGlobalObject, names: &mut [ZigString]) -> usize {
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = global_object.bun_vm();
        let keys = vm.env_loader().map.map.keys();
        let len = names.len().min(keys.len());
        for (key, name) in keys[..len].iter().zip(names[..len].iter_mut()) {
            *name = ZigString::init_utf8(key);
        }
        len
    }

    pub fn get_env_value(global_object: &JSGlobalObject, name: ZigString) -> Option<ZigString> {
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = global_object.bun_vm();
        let sliced = name.to_slice();
        let value = vm.env_loader().get(sliced.slice())?;
        Some(ZigString::init_utf8(value))
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportError(global_object: &JSGlobalObject, err: JSValue) {
    // SAFETY: VirtualMachine::get() returns the thread-local VM raw pointer.
    let vm = jsc::virtual_machine::VirtualMachine::get().as_mut();
    let _ = vm.uncaught_exception(global_object, err, false);
}

/// Shared argument prefix for `Bun.{gzip,gunzip,deflate,inflate}Sync` and
/// `Bun.zstd{Compress,Decompress}{,Sync}`: returns `(arguments[0] ?? undefined,
/// arguments[1] if object)`. Throws if `arguments[1]` is present but neither an
/// object nor `undefined`.
///
/// Kept separate from [`parse_compress_buffer_and_options`] so async callers
/// (e.g. `JSZstd::get_options_async`) can read `options` *before* GC-protecting
/// the buffer — preserving error precedence and avoiding a protect leak on the
/// early-throw path.
#[inline]
pub(crate) fn parse_compress_args(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<(JSValue, Option<JSValue>)> {
    let arguments = callframe.arguments();
    let buffer_value: JSValue = if arguments.len() > 0 {
        arguments[0]
    } else {
        JSValue::UNDEFINED
    };
    let options_val: Option<JSValue> = if arguments.len() > 1 && arguments[1].is_object() {
        Some(arguments[1])
    } else if arguments.len() > 1 && !arguments[1].is_undefined() {
        return Err(
            global.throw_invalid_arguments(format_args!("Expected options to be an object"))
        );
    } else {
        None
    };
    Ok((buffer_value, options_val))
}

/// [`parse_compress_args`] + sync `StringOrBuffer` coercion of `arguments[0]`.
/// Shared by `JSZlib::{gzip,gunzip,deflate,inflate}_sync` and
/// `JSZstd::{compress,decompress}_sync`.
#[inline]
pub(crate) fn parse_compress_buffer_and_options(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<(node::StringOrBuffer, Option<JSValue>)> {
    let (buffer_value, options_val) = parse_compress_args(global, callframe)?;
    if let Some(buffer) = node::StringOrBuffer::from_js(global, buffer_value)? {
        return Ok((buffer, options_val));
    }
    Err(global.throw_invalid_arguments(format_args!("Expected buffer to be a string or buffer")))
}

#[allow(non_snake_case)]
pub mod JSZlib {
    use super::*;
    use bun_jsc::{ComptimeStringMapExt as _, ZigStringJsc as _};
    use bun_libdeflate_sys::libdeflate as bun_libdeflate;

    /// Local shim: libdeflate's `Status` has no `Into<&str>` upstream.
    #[inline]
    fn libdeflate_status_str(s: bun_libdeflate::Status) -> &'static str {
        match s {
            bun_libdeflate::Status::Success => "success",
            bun_libdeflate::Status::BadData => "bad data",
            bun_libdeflate::Status::ShortOutput => "short output",
            bun_libdeflate::Status::InsufficientSpace => "insufficient space",
        }
    }

    // PORT NOTE: Zig's `list.allocatedSlice()` (the full `[0..capacity)` window)
    // was previously shimmed here as `&mut [u8]`, but materializing `&mut [u8]`
    // over uninitialized bytes is UB in Rust regardless of later `set_len`.
    // Callers now use `Vec::spare_capacity_mut()` (-> `&mut [MaybeUninit<u8>]`)
    // with `compress_into` / `decompress_into`, which is the sound equivalent.

    // PORT NOTE: Zig exported `reader_deallocator` / `compressor_deallocator`
    // to free a heap-allocated reader/compressor (and its owned `ArrayList`)
    // from the ArrayBuffer finalizer. The Rust port keeps the reader on-stack
    // borrowing a local `Vec<u8>`, then leaks only the Vec's allocation into
    // the ArrayBuffer — so both zlib paths converge on `global_deallocator`
    // and the per-type callbacks are gone. (`no_mangle` dropped: 0 C++ refs.)
    pub use bun_alloc::c_thunks::mi_free_ctx as global_deallocator;

    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    #[strum(serialize_all = "lowercase")]
    pub enum Library {
        Zlib,
        Libdeflate,
    }

    // bun.ComptimeEnumMap(Library)
    pub static LIBRARY_MAP: phf::Map<&'static [u8], Library> = phf::phf_map! {
        b"zlib" => Library::Zlib,
        b"libdeflate" => Library::Libdeflate,
    };

    #[bun_jsc::host_fn]
    pub fn gzip_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = parse_compress_buffer_and_options(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer, options_val, true)
    }

    #[bun_jsc::host_fn]
    pub fn inflate_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = parse_compress_buffer_and_options(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub fn deflate_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = parse_compress_buffer_and_options(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub fn gunzip_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = parse_compress_buffer_and_options(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer, options_val, true)
    }

    pub fn gunzip_or_inflate_sync(
        global_this: &JSGlobalObject,
        buffer: node::StringOrBuffer,
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
                    return Err(global_this
                        .throw_invalid_arguments(format_args!("Expected library to be a string")));
                }

                library = match LIBRARY_MAP.from_js(global_this, library_value)? {
                    Some(v) => v,
                    None => {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Expected library to be one of 'zlib' or 'libdeflate'",
                        )));
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
                    compressed[compressed.len() - 4..][..4]
                        .try_into()
                        .expect("infallible: size matches"),
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
                let mut reader = match zlib::ZlibReaderArrayList::init_with_options(
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
                        // `list` is still mutably borrowed by the match
                        // scrutinee's temporary; it drops on `return` anyway.
                        if err == zlib::ZlibError::InvalidArgument {
                            return Err(
                                global_this.throw(format_args!("Zlib error: Invalid argument"))
                            );
                        }
                        return Err(global_this.throw_error(err.into(), "Zlib error"));
                    }
                };

                if let Err(_) = reader.read_all(true) {
                    let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                    return Err(global_this
                        .throw_value(ZigString::init(msg).to_error_instance(global_this)));
                }
                // PORT NOTE: Zig moved `list` into the reader and freed via a
                // dedicated finalizer. In Rust the reader *borrows* `list_ptr`,
                // so drop the reader to release the borrow, then leak the owned
                // `list` directly into the ArrayBuffer (freed by
                // `global_deallocator`).
                drop(reader);
                list.shrink_to_fit();
                // Ownership of the allocation transfers to JSC; freed via
                // `global_deallocator` once the ArrayBuffer is finalized.
                let leaked: &'static mut [u8] = list.leak();
                let ptr = leaked.as_mut_ptr();
                let array_buffer = ArrayBuffer::from_bytes(leaked, jsc::JSType::Uint8Array);
                array_buffer.to_js_with_context(
                    global_this,
                    ptr.cast::<c_void>(),
                    Some(global_deallocator),
                )
            }
            Library::Libdeflate => {
                let decompressor_ptr = bun_libdeflate::Decompressor::alloc();
                if decompressor_ptr.is_null() {
                    drop(list);
                    return Err(global_this.throw_out_of_memory());
                }
                // SAFETY: non-null per check above; freed via the scopeguard below.
                let decompressor = unsafe { &mut *decompressor_ptr };
                let _decompressor_guard = scopeguard::guard(decompressor_ptr, |p| unsafe {
                    bun_libdeflate::Decompressor::destroy(p)
                });
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };
                let result = decompressor.decompress_to_vec_grow(
                    compressed,
                    &mut list,
                    encoding,
                    1024 * 1024 * 1024,
                );
                match result.status {
                    bun_libdeflate::Status::Success => {}
                    bun_libdeflate::Status::InsufficientSpace => {
                        drop(list);
                        return Err(global_this.throw_out_of_memory());
                    }
                    _ => {
                        drop(list);
                        return Err(global_this.throw(format_args!(
                            "libdeflate returned an error: {}",
                            libdeflate_status_str(result.status),
                        )));
                    }
                }

                // Ownership of the allocation transfers to JSC; freed via
                // `global_deallocator` once the ArrayBuffer is finalized.
                let leaked: &'static mut [u8] = list.leak();
                let ptr = leaked.as_mut_ptr();
                let array_buffer = ArrayBuffer::from_bytes(leaked, jsc::JSType::Uint8Array);
                array_buffer.to_js_with_context(
                    global_this,
                    ptr.cast::<c_void>(),
                    Some(global_deallocator),
                )
            }
        }
    }

    pub fn gzip_or_deflate_sync(
        global_this: &JSGlobalObject,
        buffer: node::StringOrBuffer,
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
                    return Err(global_this
                        .throw_invalid_arguments(format_args!("Expected library to be a string")));
                }

                library = match LIBRARY_MAP.from_js(global_this, library_value)? {
                    Some(v) => v,
                    None => {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Expected library to be one of 'zlib' or 'libdeflate'",
                        )));
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

                let mut reader = match zlib::ZlibCompressorArrayList::init(
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
                        // `list` is still mutably borrowed by the match
                        // scrutinee's temporary; it drops on `return` anyway.
                        if err == zlib::ZlibError::InvalidArgument {
                            return Err(
                                global_this.throw(format_args!("Zlib error: Invalid argument"))
                            );
                        }
                        return Err(global_this.throw_error(err.into(), "Zlib error"));
                    }
                };

                if let Err(_) = reader.read_all() {
                    let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                    return Err(global_this
                        .throw_value(ZigString::init(msg).to_error_instance(global_this)));
                }
                // PORT NOTE: see gunzip path — reader borrows `list`, so drop
                // it before leaking `list` into the ArrayBuffer.
                drop(reader);
                list.shrink_to_fit();
                // Ownership of the allocation transfers to JSC; freed via
                // `global_deallocator` once the ArrayBuffer is finalized.
                let leaked: &'static mut [u8] = list.leak();
                let ptr = leaked.as_mut_ptr();
                let array_buffer = ArrayBuffer::from_bytes(leaked, jsc::JSType::Uint8Array);
                array_buffer.to_js_with_context(
                    global_this,
                    ptr.cast::<c_void>(),
                    Some(global_deallocator),
                )
            }
            Library::Libdeflate => {
                let compressor_ptr = bun_libdeflate::Compressor::alloc(level.unwrap_or(6));
                if compressor_ptr.is_null() {
                    return Err(global_this.throw_out_of_memory());
                }
                // SAFETY: non-null per check above; freed via the scopeguard below.
                let compressor = unsafe { &mut *compressor_ptr };
                let _compressor_guard = scopeguard::guard(compressor_ptr, |p| unsafe {
                    bun_libdeflate::Compressor::destroy(p)
                });
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };

                let mut list: Vec<u8> = Vec::with_capacity(
                    // This allocation size is unfortunate, but it's not clear how to avoid it with libdeflate.
                    compressor.max_bytes_needed(compressed, encoding),
                );

                let result = compressor.compress_to_vec(compressed, &mut list, encoding);
                if result.status != bun_libdeflate::Status::Success {
                    drop(list);
                    return Err(global_this.throw(format_args!(
                        "libdeflate error: {}",
                        libdeflate_status_str(result.status),
                    )));
                }

                // Ownership of the allocation transfers to JSC; freed via
                // `global_deallocator` once the ArrayBuffer is finalized.
                let leaked: &'static mut [u8] = list.leak();
                let ptr = leaked.as_mut_ptr();
                let array_buffer = ArrayBuffer::from_bytes(leaked, jsc::JSType::Uint8Array);
                array_buffer.to_js_with_context(
                    global_this,
                    ptr.cast::<c_void>(),
                    Some(global_deallocator),
                )
            }
        }
    }
}

#[allow(non_snake_case)]
pub mod JSZstd {
    use super::*;
    use bun_jsc::virtual_machine::VirtualMachine;

    // `no_mangle` dropped: 0 C++ refs, 0 Rust refs (kept for parity with Zig export).
    #[allow(unused_imports)]
    pub use bun_alloc::c_thunks::mi_free_ctx as deallocator;

    fn get_level(global_this: &JSGlobalObject, options_val: Option<JSValue>) -> JsResult<i32> {
        if let Some(option_obj) = options_val {
            if let Some(level_val) = option_obj.get(global_this, "level")? {
                let value = level_val.coerce::<i32>(global_this)?;
                if global_this.has_exception() {
                    return Err(jsc::JsError::Thrown);
                }

                if value < 1 || value > 22 {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Compression level must be between 1 and 22",
                    )));
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
    ) -> JsResult<(node::StringOrBuffer, Option<JSValue>, i32)> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;

        let level = get_level(global_this, options_val)?;

        let allow_string_object = true;
        if let Some(buffer) = node::StringOrBuffer::from_js_maybe_async(
            global_this,
            buffer_value,
            true,
            allow_string_object,
        )? {
            return Ok((buffer, options_val, level));
        }

        Err(global_this
            .throw_invalid_arguments(format_args!("Expected buffer to be a string or buffer")))
    }

    #[bun_jsc::host_fn]
    pub fn compress_sync(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, options_val) = parse_compress_buffer_and_options(global_this, callframe)?;

        let level = get_level(global_this, options_val)?;

        let input = buffer.slice();

        // Calculate max compressed size
        let max_size = bun_zstd::compress_bound(input.len());
        let mut output = vec![0u8; max_size];
        // TODO(port): allocator.alloc(u8, n) — Zig left this uninitialized.
        // PERF(port): use Box::new_uninit_slice — profile in Phase B.

        // Perform compression with context
        let compressed_size = match bun_zstd::compress(&mut output, input, Some(level)) {
            bun_zstd::Result::Success(size) => size,
            bun_zstd::Result::Err(err) => {
                drop(output);
                return Err(global_this
                    .err(jsc::ErrCode::ZSTD, format_args!("{}", bstr::BStr::new(err)))
                    .throw());
            }
        };

        // Resize to actual compressed size
        if compressed_size < output.len() {
            output.truncate(compressed_size);
            output.shrink_to_fit();
        }

        Ok(JSValue::create_buffer(global_this, output.leak()))
    }

    #[bun_jsc::host_fn]
    pub fn decompress_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer, _) = parse_compress_buffer_and_options(global_this, callframe)?;

        let input = buffer.slice();

        let output = match bun_zstd::decompress_alloc(input) {
            Ok(v) => v,
            Err(err) => {
                return Err(global_this
                    .err(
                        jsc::ErrCode::ZSTD,
                        format_args!("Decompression failed: {}", err),
                    )
                    .throw());
            }
        };

        Ok(JSValue::create_buffer(global_this, output.leak()))
    }

    // --- Async versions ---

    pub struct ZstdCtx {
        /// Created with `is_async=true` (JS-backed buffer protected); the
        /// [`bun_jsc::ThreadSafe`] guard unprotects on drop.
        pub buffer: bun_jsc::ThreadSafe<node::StringOrBuffer>,
        pub is_compress: bool,
        pub level: i32,
        pub output: Vec<u8>,
        pub error_message: Option<&'static [u8]>,
        pub promise: jsc::JSPromiseStrong,
    }

    impl jsc::AnyTaskJobCtx for ZstdCtx {
        fn run(&mut self, _global: *mut JSGlobalObject) {
            let input = self.buffer.slice();

            if self.is_compress {
                // Compression path
                // Calculate max compressed size
                let max_size = bun_zstd::compress_bound(input.len());
                // TODO(port): allocator.alloc(u8, n) — Zig left this uninitialized
                // and surfaced OOM as an error. Rust's global allocator aborts on
                // OOM, so the explicit "Out of memory" path is unreachable here.
                // Phase B: route through a fallible bun_alloc helper.
                self.output = vec![0u8; max_size];

                // Perform compression
                self.output = match bun_zstd::compress(&mut self.output, input, Some(self.level)) {
                    bun_zstd::Result::Success(size) => 'blk: {
                        // Resize to actual compressed size
                        if size < self.output.len() {
                            let mut out = core::mem::take(&mut self.output);
                            out.truncate(size);
                            out.shrink_to_fit();
                            break 'blk out;
                        }
                        break 'blk core::mem::take(&mut self.output);
                    }
                    bun_zstd::Result::Err(err) => {
                        self.output = Vec::new();
                        self.error_message = Some(err);
                        return;
                    }
                };
            } else {
                // Decompression path
                self.output = match bun_zstd::decompress_alloc(input) {
                    Ok(v) => v,
                    Err(_) => {
                        self.error_message = Some(b"Decompression failed");
                        return;
                    }
                };
            }
        }

        fn then(&mut self, global_this: &JSGlobalObject) -> JsResult<()> {
            let promise = self.promise.swap();

            if let Some(err_msg) = self.error_message {
                promise.reject_with_async_stack(
                    global_this,
                    Ok(global_this
                        .err(
                            jsc::ErrCode::ZSTD,
                            format_args!("{}", bstr::BStr::new(err_msg)),
                        )
                        .to_js()),
                )?;
                return Ok(());
            }

            let output_slice = core::mem::take(&mut self.output);
            let buffer_value = JSValue::create_buffer(global_this, output_slice.leak());
            promise.resolve(global_this, buffer_value)?;
            Ok(())
        }
    }

    pub type ZstdJob = jsc::AnyTaskJob<ZstdCtx>;

    /// Zig `ZstdJob.create` — free fn (not `impl ZstdJob`) because
    /// `AnyTaskJob<_>` is a foreign type. Returns the promise `JSValue`
    /// directly so callers stay safe (the only state read back from the heap
    /// job is `ctx.promise.value()`; capture it before moving the strong into
    /// the ctx so no post-schedule raw deref is needed).
    fn create_job(
        global_this: &JSGlobalObject,
        buffer: node::StringOrBuffer,
        is_compress: bool,
        level: i32,
    ) -> JSValue {
        let promise = jsc::JSPromiseStrong::init(global_this);
        let promise_value = promise.value();
        let job = jsc::AnyTaskJob::create(
            global_this,
            ZstdCtx {
                // Caller passed `from_js_maybe_async(.., is_async=true)`; adopt
                // so the protect ref is paired with drop.
                buffer: bun_jsc::ThreadSafe::adopt(buffer),
                is_compress,
                level,
                output: Vec::new(),
                error_message: None,
                promise,
            },
        )
        .expect("ZstdCtx::init is infallible");
        // SAFETY: `job` is a freshly-created live pointer.
        unsafe { jsc::AnyTaskJob::schedule(job) };
        promise_value
    }

    #[bun_jsc::host_fn]
    pub fn compress(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, _, level) = get_options_async(global_this, callframe)?;
        Ok(create_job(global_this, buffer, true, level))
    }

    #[bun_jsc::host_fn]
    pub fn decompress(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let (buffer, _, _) = get_options_async(global_this, callframe)?;
        Ok(create_job(global_this, buffer, false, 0)) // level is ignored for decompression
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
//
// PORT NOTE (layering): `RareData.{stdin,stdout,stderr}_store` are typed as
// `Option<Arc<high_tier::BlobStore>>` opaque stubs in `bun_jsc`. The real
// `Blob::Store` (intrusively refcounted, with `File` payload) lives in this
// crate and can't move down without dragging `node::PathLike`/S3/aio. The Zig
// spec stores them on RareData purely for per-VM lazy init; that is per-thread
// in practice (`VirtualMachine::get()` is thread-local), so cache the
// `StoreRef`s here.
mod stdio_stores {
    use super::*;
    use crate::node::types::PathOrFileDescriptor;
    use crate::webcore::blob::store::{Data, File as FileStore};
    use crate::webcore::blob::{Blob, BlobExt as _, Store, StoreRef};
    use core::sync::atomic::AtomicU32;

    thread_local! {
        static STDIN: core::cell::RefCell<Option<StoreRef>> = const { core::cell::RefCell::new(None) };
        static STDOUT: core::cell::RefCell<Option<StoreRef>> = const { core::cell::RefCell::new(None) };
        static STDERR: core::cell::RefCell<Option<StoreRef>> = const { core::cell::RefCell::new(None) };
    }

    fn build_store(uv_fd: i32, is_atty: bool) -> StoreRef {
        let fd = bun_sys::Fd::from_uv(uv_fd);
        let mode: bun_sys::Mode = match bun_sys::fstat(fd) {
            Ok(stat) => bun_sys::Mode::try_from(stat.st_mode).unwrap_or(0),
            Err(_) => 0,
        };
        // PORT NOTE: Zig set `ref_count = 2` to account for the RareData slot
        // plus the Blob; with `StoreRef` (intrusive RAII) the slot is +1 and
        // the Blob takes its own +1 via `clone()`.
        let store = Store::new(Store {
            data: Data::File(FileStore {
                pathlike: PathOrFileDescriptor::Fd(fd),
                is_atty: Some(is_atty),
                mode,
                ..Default::default()
            }),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: None,
        });
        StoreRef::from(store)
    }

    fn make_blob(
        global_this: &JSGlobalObject,
        slot: &'static std::thread::LocalKey<core::cell::RefCell<Option<StoreRef>>>,
        uv_fd: i32,
        is_atty: bool,
        feature: &'static core::sync::atomic::AtomicUsize,
    ) -> JSValue {
        // Zig: `bun.analytics.Features.@"Bun.std…" += 1` (rare_data.zig).
        feature.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        let store = slot.with(|cell| {
            let mut s = cell.borrow_mut();
            if s.is_none() {
                *s = Some(build_store(uv_fd, is_atty));
            }
            // store.ref() — extra +1 for the new Blob.
            s.as_ref().unwrap().clone()
        });
        let blob = Blob::new(Blob::init_with_store(store, global_this));
        // SAFETY: `Blob::new` heap-allocates; the JS wrapper takes ownership.
        unsafe { (&mut *blob).to_js(global_this) }
    }

    pub fn stdin(global_this: &JSGlobalObject) -> JSValue {
        let is_atty = bun_sys::isatty(bun_sys::Fd::from_uv(0));
        make_blob(
            global_this,
            &STDIN,
            0,
            is_atty,
            &bun_core::analytics::Features::BUN_STDIN,
        )
    }
    pub fn stdout(global_this: &JSGlobalObject) -> JSValue {
        let is_atty = matches!(
            bun_core::output::stdout_descriptor_type(),
            bun_core::output::OutputStreamDescriptor::Terminal
        );
        make_blob(
            global_this,
            &STDOUT,
            1,
            is_atty,
            &bun_core::analytics::Features::BUN_STDOUT,
        )
    }
    pub fn stderr(global_this: &JSGlobalObject) -> JSValue {
        let is_atty = matches!(
            bun_core::output::stderr_descriptor_type(),
            bun_core::output::OutputStreamDescriptor::Terminal
        );
        make_blob(
            global_this,
            &STDERR,
            2,
            is_atty,
            &bun_core::analytics::Features::BUN_STDERR,
        )
    }
}

// HOST_EXPORT(BunObject__createBunStdin)
pub fn create_bun_stdin(global_this: &JSGlobalObject) -> JSValue {
    stdio_stores::stdin(global_this)
}

// HOST_EXPORT(BunObject__createBunStderr)
pub fn create_bun_stderr(global_this: &JSGlobalObject) -> JSValue {
    stdio_stores::stderr(global_this)
}

// HOST_EXPORT(BunObject__createBunStdout)
pub fn create_bun_stdout(global_this: &JSGlobalObject) -> JSValue {
    stdio_stores::stdout(global_this)
}

// ported from: src/runtime/api/BunObject.zig
