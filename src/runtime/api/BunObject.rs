//! `globalThis.Bun` — top-level host functions and lazy-property getters.

/// Append the public path of `to` relative to `dir` to `out`, prefixed by
/// `origin` (and `asset_prefix` when `origin` is absolute). Called by both the
/// bundler dev-server and `Bun.FileSystemRouter`'s `scriptSrc` getter.
///
/// The output is raw path bytes. POSIX paths are arbitrary byte sequences;
/// `bun_string_jsc::create_utf8_for_js` replaces invalid UTF-8 with U+FFFD.
pub(crate) fn get_public_path_with_asset_prefix(
    to: &[u8],
    dir: &[u8],
    origin: &bun_url::URL,
    asset_prefix: &[u8],
    out: &mut Vec<u8>,
    platform: bun_paths::Platform,
) {
    use bun_core::strings;
    use bun_paths::{Platform, resolve_path};

    let relative_path: &[u8] = if strings::has_prefix(to, dir) {
        strings::without_trailing_slash(&to[dir.len()..])
    } else {
        // NOTE: spec is `VirtualMachine.get().transpiler.fs.relativePlatform(dir, to, platform)`;
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
    if !origin.is_absolute() {
        out.extend_from_slice(strings::trim_left(relative_path, b"/"));
        return;
    }
    if strings::has_prefix(relative_path, b"..") || strings::has_prefix(relative_path, b"./") {
        let abs_path = if bun_paths::is_absolute(to) {
            to
        } else {
            VirtualMachine::get().fs().abs(&[to])
        };
        out.reserve(origin.origin.len() + b"/abs:".len() + abs_path.len());
        out.extend_from_slice(origin.origin);
        out.extend_from_slice(b"/abs:");
        out.extend_from_slice(abs_path);
        return;
    }
    // Upper bound of what `join_write` emits: `origin`, "/", and a normalized
    // path at most two separators longer than `asset_prefix` + `relative_path`.
    out.reserve(origin.origin.len() + asset_prefix.len() + relative_path.len() + 3);
    origin
        .join_write(out, asset_prefix, b"", relative_path, b"")
        .expect("infallible: in-memory write");
}

use bun_jsc::HostReturn as _;
use core::ffi::c_void;
use std::io::Write as _;

use bun_core::Output;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, ConsoleObject, JSFunction, JSGlobalObject, JSObject,
    JSPromise, JSValue, JsResult,
};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use crate::cli::open::Editor;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_jsc::virtual_machine::{ResolveMode, VirtualMachine};
use bun_paths::MAX_PATH_BYTES;
#[cfg(not(windows))]
use bun_paths::PathBuffer;
#[cfg(windows)]
use bun_paths::WPathBuffer;
use bun_shell_parser::braces as Braces;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_zlib as zlib;

use crate::api::csrf_jsc;
use crate::api::{HashObject, JSON5Object, TOMLObject, UnsafeObject, XMLObject, YAMLObject};
use crate::crypto as Crypto;
use crate::node;
use crate::test_runner::jest::Jest;
use crate::valkey_jsc::js_valkey::SubscriptionCtx;
use bun_collections::index_sort;
use bun_core::Utf8Bytes;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::{StringJsc as _, bun_string_jsc};

/// Bindgen-generated option-structs for this module (`BunObject.bind.ts`).
pub mod r#gen {
    pub use bun_jsc::generated::bun_object::BracesOptions;
}

// ─── wrap_static_method adapters ───────────────────────────────────────────
// `#[bun_jsc::host_fn(static)]` is not yet emitted,
// so hand-roll the arg-extraction shims for the six call sites below.
mod static_adapters {
    use super::*;

    pub(super) fn listener_connect(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let [opts] = cf.arguments_as_array::<1>();
        crate::socket::Listener::connect(g, opts)
    }

    pub(super) fn listener_listen(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let [opts] = cf.arguments_as_array::<1>();
        crate::socket::Listener::listen(g, opts)
    }

    pub(super) fn udp_socket(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let [opts] = cf.arguments_as_array::<1>();
        crate::socket::udp_socket_draft::UDPSocket::udp_socket(g, opts)
    }

    pub(super) fn subprocess_spawn(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let [a0] = cf.arguments_as_array::<1>();
        let a1 = cf.arguments().get(1).copied();
        crate::api::js_bun_spawn_bindings::spawn(g, a0, a1)
    }

    pub(super) fn subprocess_spawn_sync(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let [a0] = cf.arguments_as_array::<1>();
        let a1 = cf.arguments().get(1).copied();
        crate::api::js_bun_spawn_bindings::spawn_sync(g, a0, a1)
    }

    pub(super) fn js_bundler_build(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        crate::api::js_bundler::JSBundler::build_fn(g, cf)
    }
    /// `Bun.$` parsed-script constructor — wraps the marked-argument-buffer host fn.
    pub(super) fn parsed_shell_script_create(
        g: &JSGlobalObject,
        cf: &CallFrame,
    ) -> JsResult<JSValue> {
        // `CREATE_PARSED_SHELL_SCRIPT` is the safe `JSHostFnZig` produced by
        // `marked_argument_buffer_wrap!` (the C-ABI shim is exported separately
        // by the macro); call it directly.
        crate::shell::parsed_shell_script::CREATE_PARSED_SHELL_SCRIPT(g, cf)
    }
    pub(super) fn shell_interpreter_create(
        g: &JSGlobalObject,
        cf: &CallFrame,
    ) -> JsResult<JSValue> {
        crate::shell::interpreter::create_shell_interpreter(g, cf)
    }

    /// `Bun.sha(input, output?)` is `Bun.SHA512_256.hash` under another name,
    /// so it shares that method's argument decode and errors.
    pub(super) fn sha(g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        Crypto::SHA512_256::hash(g, cf)
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

    // Each callback is exported under
    // `BunObject_callback_<name>` / `BunObject_lazyPropCb_<name>`. The
    // two `macro_rules!` below expand the static export tables.
    // ABI check vs the C++ declarations (BunObject+exports.h:90):
    // `extern "C" EncodedJSValue SYSV_ABI (JSGlobalObject*, JSObject*)` for the
    // property variants — matched here by `jsc_host_abi!` (`extern "sysv64"`
    // on Windows-x64, `extern "C"` elsewhere) returning `JSValue`, which is
    // `#[repr(transparent)]` over `EncodedJSValue`.

    // Ident concat via `${concat()}` is unstable (`macro_metavar_expr_concat`),
    // so the full `BunObject_callback_<name>` / `BunObject_lazyPropCb_<name>`
    // export symbol is supplied verbatim by the caller (same pattern as
    // `lazy_prop!` above).
    macro_rules! export_callbacks {
        ($( $(#[$attr:meta])* $sym:ident => $target:expr ),* $(,)?) => {
            $(
                // C++ declares
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
                // C++ declares the extern as `SYSV_ABI`
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
        BunObject_callback_openInEditor => super::open_in_editor,
        BunObject_callback_registerMacro => super::register_macro,
        BunObject_callback_resolve => super::resolve,
        BunObject_callback_resolveSync => super::resolve_sync,
        BunObject_callback_serve => super::serve,
        BunObject_callback_sha => super::static_adapters::sha,
        BunObject_callback_shellEscape => super::shell_escape,
        BunObject_callback_shrink => super::shrink,
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
        BunObject_lazyPropCb_XML => super::get_xml_object,
        BunObject_lazyPropCb_YAML => super::get_yaml_object,
        BunObject_lazyPropCb_Transpiler => super::get_transpiler_constructor,
        BunObject_lazyPropCb_argv => super::get_argv,
        BunObject_lazyPropCb_cron => super::get_cron_object,
        BunObject_lazyPropCb_cwd => super::get_cwd,
        BunObject_lazyPropCb_embeddedFiles => super::get_embedded_files,
        BunObject_lazyPropCb_enableANSIColors => super::enable_ansi_colors,
        BunObject_lazyPropCb_isStandaloneExecutable => super::get_is_standalone_executable,
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
    // --- Getters ---

    // --- Setters ---
    // --- Setters ---

    // The export names
    // are spelled out verbatim in the `export_*!` macro invocations above.

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

fn get_cron_object(global_this: &JSGlobalObject, obj: &JSObject) -> JSValue {
    crate::api::cron::get_cron_object(global_this, obj)
}

#[bun_jsc::host_fn]
fn shell_escape(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [jsval] = callframe.arguments_as_array::<1>();
    if callframe.arguments_count() < 1 {
        return Err(global_this.throw(format_args!("shell escape expected at least 1 argument")));
    }

    let bunstr = jsval.to_bun_string(global_this)?;

    let mut outbuf: Vec<u8> = Vec::new();

    if bun_shell_parser::needs_escape_bunstr(&bunstr) {
        let result = bun_shell_parser::escape_bun_str::<true>(&bunstr, &mut outbuf)?;
        if !result {
            return Err(global_this.throw(format_args!(
                "String has invalid utf-16: {}",
                bstr::BStr::new(bunstr.byte_slice()),
            )));
        }
        return bun_string_jsc::create_utf8_for_js(global_this, &outbuf);
    }

    Ok(jsval)
}

pub(crate) fn braces(
    global: &JSGlobalObject,
    brace_str: &BunString,
    opts: r#gen::BracesOptions,
) -> JsResult<JSValue> {
    let brace_slice = brace_str.to_utf8();

    let mut arena = bun_alloc::Arena::new();
    let _ = &mut arena;

    let mut lexer_output = 'lexer_output: {
        if strings::is_all_ascii(brace_slice.slice()) {
            break 'lexer_output match Braces::Lexer::tokenize(brace_slice.slice()) {
                Ok(v) => v,
                Err(err) => {
                    return Err(
                        global.throw_error(crate::Error::from(err), "failed to tokenize braces")
                    );
                }
            };
        }

        match Braces::NewLexer::<{ Braces::StringEncoding::Wtf8 }>::tokenize(brace_slice.slice()) {
            Ok(v) => break 'lexer_output v,
            Err(err) => {
                return Err(
                    global.throw_error(crate::Error::from(err), "failed to tokenize braces")
                );
            }
        }
    };

    let expansion_count = Braces::calculate_expanded_amount(&lexer_output.tokens[..]);

    if opts.tokenize {
        // NOTE: the `Braces::Token` enum has no `serde::Serialize`; emit
        // the JSON shape (`[{"<tag>": <payload>|{}} , …]`) by hand so the
        // debug-only `Bun.braces(str, {tokenize:true})` round-trips.
        let str = Braces::tokens_to_json(&lexer_output.tokens[..]);
        let bun_str = BunString::from_bytes(&str);
        return bun_str.to_js(global);
    }
    if opts.parse {
        let mut parser = Braces::Parser::init(&lexer_output.tokens[..], &arena);
        let ast_node = match parser.parse() {
            Ok(v) => v,
            Err(err) => {
                return Err(global.throw_error(crate::Error::from(err), "failed to parse braces"));
            }
        };
        // NOTE: see `tokenize` arm — manual JSON encoder for the AST.
        let str = Braces::ast_to_json(&ast_node);
        let bun_str = BunString::from_bytes(&str);
        return bun_str.to_js(global);
    }

    if expansion_count == 0 {
        return bun_string_jsc::to_js_array(global, core::slice::from_ref(brace_str));
    }

    // Hard cap before preallocation: `calculate_expanded_amount` saturates to
    // `u32::MAX`, so a tiny nested input can otherwise request a huge `Vec`.
    const MAX_BRACE_EXPANSIONS: u32 = 65536;
    if expansion_count > MAX_BRACE_EXPANSIONS {
        return Err(global.throw(format_args!(
            "Too many brace expansions ({} > {})",
            expansion_count, MAX_BRACE_EXPANSIONS
        )));
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
            return Err(global.throw(format_args!("Unexpected token while expanding braces")));
        }
        Err(Braces::ParserError::TooManyBraces) => {
            return Err(global.throw(format_args!("Too many braces in brace expansion")));
        }
    }

    let mut out_strings: Vec<BunString> = Vec::with_capacity(expansion_count);
    for i in 0..expansion_count {
        out_strings.push(BunString::from_bytes(&expanded_strings[i][..]));
    }

    bun_string_jsc::to_js_array(global, &out_strings[..])
}

#[bun_jsc::host_fn]
fn which(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut path_buf = bun_paths::path_buffer_pool::get();
    // SAFETY: bun_vm() returns the live per-thread singleton VM for a Bun-owned global.
    let vm = global_this.bun_vm();
    let mut arguments = ArgumentsSlice::init(vm, callframe.arguments());
    let Some(path_arg) = arguments.next_eat() else {
        return Err(global_this.throw(format_args!("which: expected 1 argument, got 0")));
    };

    if path_arg.is_empty_or_undefined_or_null() {
        return Ok(JSValue::NULL);
    }

    let bin_str = path_arg.to_utf8(global_this)?;

    if bin_str.slice().len() >= MAX_PATH_BYTES {
        return Err(global_this.throw(format_args!("bin path is too long")));
    }

    if bin_str.slice().is_empty() {
        return Ok(JSValue::NULL);
    }

    // SAFETY: `transpiler.env` / `.fs` are process-lifetime singletons set during VM init.
    let mut path_str = Utf8Bytes::Borrowed(vm.env_loader().get(b"PATH").unwrap_or(b""));
    let mut cwd_str = Utf8Bytes::Borrowed(vm.top_level_dir());

    if let Some(arg) = arguments.next_eat() {
        if !arg.is_empty_or_undefined_or_null() && arg.is_object() {
            if let Some(str_) = arg.get(global_this, "PATH")? {
                path_str = str_.to_utf8(global_this)?;
            }

            if let Some(str_) = arg.get(global_this, "cwd")? {
                cwd_str = str_.to_utf8(global_this)?;
            }
        }
    }

    if let Some(bin_path) = bun_which::which(
        &mut *path_buf,
        path_str.slice(),
        cwd_str.slice(),
        bin_str.slice(),
    ) {
        return bun_string_jsc::create_utf8_for_js(global_this, bin_path);
    }

    Ok(JSValue::NULL)
}

#[bun_jsc::host_fn]
fn inspect_table(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let mut args_buf = callframe.arguments_undef::<5>();
    let all_arguments = args_buf.mut_();
    if all_arguments[0].is_undefined_or_null() || !all_arguments[0].is_object() {
        return Ok(JSValue::js_empty_string(global_this));
    }

    // NOTE: protect/unprotect over a copied [JSValue; 5]; the borrow of
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

    if format_options.enable_colors {
        table_printer.print_table::<true>(&mut array)?;
    } else {
        table_printer.print_table::<false>(&mut array)?;
    }
    // print_table() swallows JS throws from nested formatting and returns Ok; see ConsoleObject::Formatter::format
    if global_this.has_exception() {
        return Err(jsc::JsError::Thrown);
    }

    // writer.flush(): Vec<u8> writer is unbuffered; nothing to flush.

    bun_string_jsc::create_utf8_for_js(global_this, &array)
}

#[bun_jsc::host_fn]
fn inspect(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
    if arguments.is_empty() {
        return Ok(JSValue::js_empty_string(global_this));
    }

    for arg in arguments {
        arg.protect();
    }
    // Each arg is unprotected on scope exit.
    // `arguments()` borrows the call-frame slot array; wrap the borrowed slice
    // in the guard instead of heap-allocating a `Vec` per call.
    //
    // NOTE: this is *not* the fix for error-gc-test.test.js timing out under
    // debug+ASAN — that test does 100k `Bun.inspect(new Error)` and the cost
    // is spread across ASAN-instrumented memcpy/memset, mimalloc zero-checks
    // and the source-file re-read in `remap_zig_exception`, none of which a
    // 32-byte alloc elision can recover. The test is classified `[TIMEOUT]`
    // for ASAN in test/expectations.txt instead.
    let args_buf = scopeguard::guard(arguments, |buf| {
        for arg in buf {
            arg.unprotect();
        }
    });
    let arguments = *args_buf;

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
        &arguments[..1],
        &mut array,
        format_options,
    )?;
    // format2() swallows JS throws from nested formatting and returns Ok; see ConsoleObject::Formatter::format
    if global_this.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    // writer.flush(): Vec<u8> is unbuffered.

    bun_string_jsc::create_utf8_for_js(global_this, &array)
}

// HOST_EXPORT(Bun__inspect_singleline, c)
pub fn bun_inspect_singleline(global_this: &JSGlobalObject, value: JSValue) -> BunString {
    let mut array: Vec<u8> = Vec::new();
    if ConsoleObject::format2(
        ConsoleObject::MessageLevel::Debug,
        global_this,
        core::slice::from_ref(&value),
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
        return BunString::EMPTY;
    }
    if global_this.has_exception() {
        return BunString::EMPTY;
    }
    BunString::clone_utf8(&array)
}

fn get_inspect(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    let fun = JSFunction::create(
        global_object,
        "inspect",
        __jsc_host_inspect,
        2,
        Default::default(),
    );
    fun.put(
        global_object,
        b"custom",
        JSValue::symbol_for(global_object, b"nodejs.util.inspect.custom"),
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
fn register_macro(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
    if arguments.len() < 2 || !arguments[0].is_number() {
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
        get_or_put_result.value_ptr.unprotect();
    }

    arguments[1].protect();
    *get_or_put_result.value_ptr = arguments[1];

    Ok(JSValue::UNDEFINED)
}

fn get_cwd(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    EncodedSlice::from_bytes(bun_resolver::fs::FileSystem::get().top_level_dir).to_js(global_this)
}

fn get_origin(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    EncodedSlice::from_bytes(VirtualMachine::get().origin.origin).to_js(global_this)
}

fn enable_ansi_colors(_global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSValue::from(Output::enable_ansi_colors_stdout() || Output::enable_ansi_colors_stderr())
}

// callconv(jsc.conv) — `SYSV_ABI` on win-x64 (BunObject.cpp:1103). Returns
// plain `JSValue` so the generated thunk is a bare deref+call (no
// `ExceptionValidationScope`).
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
                if cfg!(any(target_os = "linux", target_os = "android")) {
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
            .or_pending_exception();
    }

    EncodedSlice::from_bytes(vm.main()).to_js(global_this)
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

fn get_argv(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    node::process::get_argv(global_this)
}

// NOTE (layering): `RareData.editor_context` in `bun_jsc` is an opaque ZST
// stub — the real `EditorContext` lives in this crate (`cli::open`) and depends
// on `bun_dotenv` / `bun_spawn`, so it can't move down without dragging those
// into `bun_jsc`'s graph. Semantically it is
// per-JS-thread state (one VM per thread), so a `thread_local` here is
// equivalent and breaks the cycle without type erasure.
//
// `name_storage` owns the user-supplied editor name so `EditorContext.name`
// (typed `&'static [u8]`) can borrow it
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
fn open_in_editor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live per-thread singleton.
    let vm = global_this.bun_vm();
    let mut arguments = ArgumentsSlice::init(vm, callframe.arguments());
    let mut path = Utf8Bytes::EMPTY;
    let mut editor_name: Option<Utf8Bytes> = None;
    let mut line: Option<Utf8Bytes> = None;
    let mut column: Option<Utf8Bytes> = None;

    if let Some(file_path_) = arguments.next_eat() {
        path = file_path_.to_utf8(global_this)?;
    }

    // Option getters and `toString` run arbitrary user JS that may re-enter
    // this function, so every JS-visible coercion must finish before the
    // EDITOR_CONTEXT borrow below is taken (re-entry while borrowed panics).
    if let Some(opts) = arguments.next_eat() {
        if !opts.is_undefined_or_null() {
            if let Some(editor_val) = opts.get_truthy(global_this, "editor")? {
                editor_name = Some(editor_val.to_utf8(global_this)?);
            }

            if let Some(line_) = opts.get_truthy(global_this, "line")? {
                line = Some(line_.to_utf8(global_this)?);
            }

            if let Some(column_) = opts.get_truthy(global_this, "column")? {
                column = Some(column_.to_utf8(global_this)?);
            }
        }
    }

    EDITOR_CONTEXT.with(|cell| -> JsResult<JSValue> {
        let mut slot = cell.borrow_mut();
        let slot = &mut *slot;
        let edit = &mut slot.ctx;
        let env = vm.transpiler.env_mut();
        let mut editor_choice: Option<Editor> = None;

        if let Some(sliced) = &editor_name {
            let prev_name = edit.name;

            if !strings::eql_long(prev_name, sliced.slice(), true) {
                let prev = core::mem::take(edit);
                // Own the bytes in `name_storage` and
                // hand back a thread-lifetime borrow.
                let prev_storage =
                    core::mem::replace(&mut slot.name_storage, sliced.slice().to_vec());
                // SAFETY: `name_storage` lives in a thread_local that
                // outlives any caller; we never reallocate it while
                // `edit.name` is observed (single-threaded JS VM).
                edit.name = unsafe { bun_ptr::detach_lifetime(slot.name_storage.as_slice()) };
                edit.detect_editor(env);
                editor_choice = edit.found();
                if editor_choice.is_none() {
                    slot.name_storage = prev_storage;
                    *edit = prev;
                    return Err(global_this.throw(format_args!(
                        "Could not find editor \"{}\"",
                        bstr::BStr::new(sliced.slice()),
                    )));
                } else if edit.name.as_ptr() == edit.path.as_ptr() {
                    // `detect_editor` aliased `path` to `name` (absolute
                    // editor path). `name` is backed by `slot.name_storage`,
                    // which a later call may drop while the detached editor
                    // thread is still reading argv[0]. Give `path`
                    // process-lifetime storage, matching every other
                    // `detect_editor` branch.
                    edit.path = bun_resolver::fs::FileSystem::instance()
                        .dirname_store
                        .append_slice(edit.path)
                        .expect("unreachable");
                }
            }
        }

        let editor = match editor_choice.or_else(|| edit.found()) {
            Some(e) => e,
            None => {
                edit.auto_detect_editor(env);
                match edit.found() {
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
fn sleep_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [arg] = callframe.arguments_as_array::<1>();

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if callframe.arguments_count() < 1 {
        return Err(global_object.throw_not_enough_arguments("sleepSync", 1, 0));
    }

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
fn shrink(global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    global_object.vm().shrink_footprint();
    Ok(JSValue::UNDEFINED)
}

fn do_resolve(global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the live per-thread singleton.
    let vm = global_this.bun_vm();
    let mut args = ArgumentsSlice::init(vm, arguments);
    let Some(specifier) = args.next_eat() else {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a specifier and a from path")));
    };

    if specifier.is_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(format_args!("specifier must be a string")));
    }

    let Some(from) = args.next_eat() else {
        return Err(global_this.throw_invalid_arguments(format_args!("Expected a from path")));
    };

    if from.is_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(format_args!("from must be a string")));
    }

    let mut mode = ResolveMode::Esm;
    if let Some(next) = args.next_eat() {
        if next.is_boolean() {
            mode = if next.to_boolean() {
                ResolveMode::Esm
            } else {
                ResolveMode::Require
            };
        } else {
            return Err(global_this.throw_invalid_arguments(format_args!("esm must be a boolean")));
        }
    }

    let specifier_str = specifier.to_bun_string(global_this)?;
    let from_str = from.to_bun_string(global_this)?;
    do_resolve_with_args::<false>(global_this, &specifier_str, &from_str, mode)
}

enum Resolved {
    Found(JSValue),
    /// The resolver's `ResolveMessage` for a specifier it could not resolve; not thrown yet.
    NotFound(JSValue),
}

fn do_resolve_with_args<const IS_FILE_PATH: bool>(
    ctx: &JSGlobalObject,
    specifier: &BunString,
    from: &BunString,
    mode: ResolveMode,
) -> JsResult<JSValue> {
    match resolve_with_args::<IS_FILE_PATH>(ctx, specifier, from, mode)? {
        Resolved::Found(value) => Ok(value),
        Resolved::NotFound(err) => Err(ctx.throw_value(err)),
    }
}

fn resolve_with_args<const IS_FILE_PATH: bool>(
    ctx: &JSGlobalObject,
    specifier: &BunString,
    from: &BunString,
    mode: ResolveMode,
) -> JsResult<Resolved> {
    let mut query_string = BunString::EMPTY;

    let decoded_specifier;
    let specifier_for_resolve = if specifier.starts_with_ascii(b"file://") {
        decoded_specifier = bun_url::path_and_query_from_file_url(specifier);
        &decoded_specifier
    } else {
        specifier
    };

    let result_value = match VirtualMachine::resolve_maybe_needs_trailing_slash::<IS_FILE_PATH>(
        ctx,
        specifier_for_resolve,
        from,
        Some(&mut query_string),
        mode,
    )? {
        Ok(path) => path,
        Err(err) if err.as_class_ref::<jsc::ResolveMessage>().is_some() => {
            return Ok(Resolved::NotFound(err));
        }
        // e.g. an onResolve plugin returned an invalid result
        Err(err) => return Err(ctx.throw_value(err)),
    };

    if !query_string.is_empty() {
        let mut arraylist: Vec<u8> = Vec::with_capacity(1024);
        // Vec<u8> writes are infallible.
        let _ = write!(&mut arraylist, "{}{}", result_value, query_string);

        return Ok(Resolved::Found(bun_string_jsc::create_utf8_for_js(
            ctx, &arraylist,
        )?));
    }

    Ok(Resolved::Found(result_value.into_js(ctx)?))
}

#[bun_jsc::host_fn]
fn resolve_sync(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    do_resolve(global_object, callframe.arguments())
}

#[bun_jsc::host_fn]
fn resolve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let value = match do_resolve(global_object, callframe.arguments()) {
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

    jsc::to_js_host_call(global, || {
        do_resolve_with_args::<true>(
            global,
            &specifier_str,
            &source_str,
            ResolveMode::from_ffi_bools(is_esm, is_user_require_resolve),
        )
    })
}

// HOST_EXPORT(Bun__resolveSyncWithPaths, c)
/// # Safety
/// `paths_ptr` must be null or point to `paths_len` initialized `BunString`s
/// that remain valid for the duration of this call.
// FFI entry point exported via HOST_EXPORT and called only from C++
// (ImportMetaObject.cpp / NodeModuleModule.cpp), which upholds the contract
// above. clippy excludes `extern "C"` fns from this lint; the export wrapper
// lives in generated code, so allow it here.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bun_resolve_sync_with_paths(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
    paths_ptr: *const BunString,
    paths_len: usize,
) -> JSValue {
    let paths: &[BunString] = if paths_len == 0 {
        &[]
    } else {
        // SAFETY: C++ caller guarantees `paths_ptr` points to `paths_len`
        // initialized `BunString`s that outlive this call; `paths_len > 0` here.
        unsafe { core::slice::from_raw_parts(paths_ptr, paths_len) }
    };

    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };

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
            &specifier_str,
            &source_str,
            ResolveMode::from_ffi_bools(is_esm, is_user_require_resolve),
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
        do_resolve_with_args::<true>(
            global,
            specifier,
            source,
            ResolveMode::from_ffi_bools(is_esm, false),
        )
    })
}

/// Resolves `specifier` relative to `source`. A specifier the resolver cannot resolve (the
/// `ResolveMessage` case, e.g. "Cannot find module") yields `undefined` instead of throwing;
/// everything else — an `onResolve` plugin throwing or returning an invalid result, a specifier
/// that is not a string — is thrown.
// HOST_EXPORT(Bun__resolveSyncWithSourceIfExists, c)
pub fn bun_resolve_sync_with_source_if_exists(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: &BunString,
    is_esm: bool,
) -> JSValue {
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    jsc::to_js_host_call(global, || {
        resolve_with_args::<true>(
            global,
            &specifier_str,
            source,
            ResolveMode::from_ffi_bools(is_esm, false),
        )
        .map(|r| match r {
            Resolved::Found(value) => value,
            Resolved::NotFound(_) => JSValue::UNDEFINED,
        })
    })
}

#[bun_jsc::host_fn]
fn index_of_line(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
    if arguments.is_empty() {
        return Ok(JSValue::js_number_from_int32(-1));
    }

    let mut offset: usize = 0;
    if arguments.len() > 1 {
        let offset_value = arguments[1].coerce_to_int64(global_this)?;
        offset = offset_value.max(0) as usize;
    }

    let Some(buffer) = arguments[0].as_array_buffer(global_this) else {
        return Ok(JSValue::js_number_from_int32(-1));
    };

    let bytes = buffer.byte_slice();
    let mut current_offset = offset;
    let end = bytes.len() as u32;

    while current_offset < end as usize {
        if let Some(i) = strings::index_of_newline_or_non_ascii(bytes, current_offset as u32) {
            let byte = bytes[i as usize];
            if byte > 0x7F {
                current_offset =
                    i as usize + (strings::wtf8_byte_sequence_length(byte) as usize).max(1);
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

#[bun_jsc::host_fn]
fn serve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
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
                previous_fetch: false,
                previous_routes: false,
            },
        )?;

        break 'brk config;
    };

    // `init()` below `mem::take`s `config` into a heap-boxed `NewServer`, so
    // past that point the raw-`JSValue` handler shadows have no GC root until
    // `wrap_handler_slot` writes them into the wrapper's WriteBarrier slots.
    // For a data-property options object the user's `{ fetch: fn }` on this
    // stack still retains them, but a Proxy- or accessor-backed options
    // object returns a fresh fn that nothing else holds. `compute_id`,
    // `listen()`'s `set_routes`, and the `ptr_to_js` wrapper allocation can
    // all trigger a GC in that window, so gcProtect each handler for its
    // duration. `Protected`'s `Drop` unprotects on every exit path (including
    // a thrown `listen()` and the hot-reload early return).
    let _handler_pins: [bun_jsc::js_value::Protected; 10] =
        crate::server::protect_handler_shadows(&config);

    // SAFETY: same VM pointer; re-borrow after `args` is dropped.
    let vm = global_object.bun_vm().as_mut();

    // NOTE (layering): `HotMap` is a tagged union over the four
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
            // SAFETY: `server` is the live heap-allocated server returned by `init`.
            let route_list_object = <$ServerType>::listen(server);
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            let obj = <$ServerType>::ptr_to_js(server, global_object);
            if route_list_object != JSValue::ZERO {
                // NOTE: `ServerType.js.routeListSetCached` (codegen
                // `.classes.ts`) — routed through the typed helper in
                // `server_body` until per-type codegen externs land.
                <$ServerType>::js_gc_route_list_set(obj, global_object, route_list_object);
            }
            // Mirror the handler callbacks into the wrapper's WriteBarrier
            // slots — the wrapper is the sole GC root for these; `ServerConfig`
            // / `Handler` only hold raw `JSValue` shadows for hot-path dispatch.
            // The async-context wrap is applied here (not in `from_js`) so the
            // freshly-allocated wrapper fn is rooted by the slot immediately.
            crate::server::wrap_handler_slot(
                &mut server_ref.config.on_request,
                obj,
                global_object,
                <$ServerType>::js_gc_on_request_set,
            );
            crate::server::wrap_handler_slot(
                &mut server_ref.config.on_error,
                obj,
                global_object,
                <$ServerType>::js_gc_on_error_set,
            );
            crate::server::wrap_handler_slot(
                &mut server_ref.config.on_node_http_request,
                obj,
                global_object,
                <$ServerType>::js_gc_on_node_http_request_set,
            );
            // Skip the 7-slot write when there's no websocket config: the
            // slots default ZERO so `write_ws_handler_slots`'s clear path
            // would be 7 wasted FFI calls.
            if server_ref.config.websocket.is_some() {
                server_ref.write_ws_handler_slots(obj, global_object);
            }
            server_ref.js_value.set_strong(obj, global_object);
            // Slots are rooted; release the scoped gcProtects and run the
            // "server just started" GC nudge split out of `listen()`.
            drop(_handler_pins);
            server_ref.gc_hint_after_listen();

            if let Some(handles) = crate::jsc_hooks::active_handles() {
                bun_core::handle_oom(handles.put(
                    crate::jsc_hooks::ActiveHandle::Server(AnyServer::from(server.cast_const())),
                    (),
                ));
            }

            // `init` moved `config` into the server (`mem::take`), so the
            // local `config` is defaulted from here on — read `allow_hot`
            // and `id` from the server's own config or the registration is
            // keyed on the wrong (empty) id.
            if server_ref.config.allow_hot {
                // SAFETY: same VM pointer; re-borrow after the earlier `vm` mut
                // borrow was released by the `hot_map()` arm above.
                if let Some(hot) = global_object.bun_vm().as_mut().hot_map() {
                    hot.insert_raw(
                        &server_ref.config.id,
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

    // Monomorphized over (has_ssl_config, development), expanded here.
    let has_ssl_config = config.ssl_config.is_some();
    let development = config.is_development();
    match (development, has_ssl_config) {
        (true, true) => serve_with!(crate::api::DebugHTTPSServer, AnyServerTag::DebugHTTPSServer),
        (true, false) => serve_with!(crate::api::DebugHTTPServer, AnyServerTag::DebugHTTPServer),
        (false, true) => serve_with!(crate::api::HTTPSServer, AnyServerTag::HTTPSServer),
        (false, false) => serve_with!(crate::api::HTTPServer, AnyServerTag::HTTPServer),
    }
}

#[bun_jsc::host_fn]
fn alloc_unsafe(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [size] = callframe.arguments_as_array::<1>();
    if !size.is_uint32_as_any_int() {
        return Err(global_this.throw_invalid_arguments(format_args!("Expected a positive number")));
    }
    JSValue::create_uninitialized_uint8_array(global_this, size.to_uint64_no_truncate() as usize)
}

#[bun_jsc::host_fn]
fn mmap_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        let _ = callframe;
        return Err(global_this.throw_todo(b"mmapFile is not supported on Windows"));
    }

    #[cfg(not(windows))]
    {
        // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
        let vm = global_this.bun_vm();
        let mut args = ArgumentsSlice::init(vm, callframe.arguments());

        let mut buf = PathBuffer::uninit();
        let path = 'brk: {
            if let Some(path) = args.next_eat() {
                if path.is_string() {
                    let path_str = path.to_utf8(global_this)?;
                    if path_str.slice().len() > MAX_PATH_BYTES {
                        return Err(
                            global_this.throw_invalid_arguments(format_args!("Path too long"))
                        );
                    }
                    let paths = &[path_str.slice()];
                    let buf_len = buf.len();
                    let Some(joined) = bun_paths::resolve_path::join_abs_string_buf_checked::<
                        bun_paths::resolve_path::platform::Auto,
                    >(
                        bun_paths::fs::FileSystem::instance().top_level_dir(),
                        &mut buf[..buf_len - 1],
                        paths,
                    ) else {
                        return Err(
                            global_this.throw_invalid_arguments(format_args!("Path too long"))
                        );
                    };
                    break 'brk joined;
                }
            }
            return Err(global_this.throw_invalid_arguments(format_args!("Expected a path")));
        };

        let path_len = path.len();
        buf[path_len] = 0;

        // SAFETY: buf[path_len] == 0 written above
        let buf_z = bun_core::ZStr::from_buf(&buf[..], path_len);

        // libc exposes raw `MAP_*` ints; build the flag word directly.
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
                }
            } else if !opts.is_undefined_or_null() {
                return Err(global_this
                    .throw_invalid_arguments(format_args!("Expected options to be an object")));
            }
        }

        let (map, delta) = match bun_sys::mmap_file(buf_z, flags, map_size, offset) {
            Ok(result) => result,
            Err(err) => {
                use bun_jsc::SysErrorJsc as _;
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
        };

        extern "C" fn munmap_dealloc(ptr: *mut c_void, size: *mut c_void) {
            // `ptr` is `map_base + delta` where `map_base` is page-aligned and
            // `delta < page_size`, so rounding down recovers the mmap base.
            let page = bun_sys::page_size();
            let addr = ptr as usize;
            let _ = sys::munmap((addr - addr % page) as *mut u8, size as usize);
        }

        let map_len = map.len();
        // SAFETY: `mmap_file` guarantees `map_len == view_size + delta` with
        // `view_size > 0`, so `delta < map_len` and the add stays in-bounds.
        let view_ptr = unsafe { map.as_ptr().add(delta) };
        let view_len = map_len - delta;

        // SAFETY: `map` is the live mapping `bun_sys::mmap_file` just created
        // (`&'static mut [u8]`, no drop guard); ownership moves to JSC, which
        // unmaps it exactly once via `munmap_dealloc` with the full mapping
        // length stuffed into the ctx pointer.
        unsafe {
            jsc::array_buffer::make_typed_array_with_bytes_no_copy(
                global_this,
                jsc::TypedArrayType::TypeUint8,
                view_ptr.cast_mut().cast::<c_void>(),
                view_len,
                Some(munmap_dealloc),
                map_len as *mut c_void,
            )
        }
    }
}

fn get_transpiler_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::js_transpiler::JSTranspiler>(global_this)
}

fn get_file_system_router(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::filesystem_router::FileSystemRouter>(
        global_this,
    )
}

fn get_hash_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    HashObject::create(global_this)
}

fn get_jsonc_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::jsonc_object::create(global_this)
}
fn get_markdown_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::markdown_object::create(global_this)
}
fn get_toml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    TOMLObject::create(global_this)
}

fn get_json5_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSON5Object::create(global_this)
}

fn get_xml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    XMLObject::create(global_this)
}

fn get_yaml_object(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    YAMLObject::create(global_this)
}

fn get_archive_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::archive::Archive>(global_this)
}

fn get_glob_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::api::glob::Glob>(global_this)
}

fn get_image_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::image::Image>(global_this)
}

fn get_s3_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::webcore::s3_client::S3Client>(global_this)
}

fn get_s3_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    // NOTE (layering): `RareData::s3_default_client` body lives in
    // `bun_jsc::rare_data::_accessor_body` and names `bun_runtime::s3` types.
    // That can't compile in `bun_jsc`, so port the body here where the S3
    // types are in scope and store the cached value through the public
    // `RareData.s3_default_client: Strong` field.
    use crate::webcore::s3_client::S3Client;
    use bun_jsc::StrongOptional;
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global_this.bun_vm().as_mut();
    // NOTE: reshaped for borrowck — capture the raw env loader pointer
    // before `rare_data()` takes the long-lived `&mut` of `vm`.
    let env_ptr = vm.transpiler.env;
    let rare = vm.rare_data();
    if let Some(v) = rare.s3_default_client.get() {
        return Ok(v);
    }
    // NOTE (layering): `bun_dotenv::Loader::get_s3_credentials` returns the
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
        // Invalid S3 options in the environment throw from the `Bun.s3` getter.
        Err(err) => return Err(err),
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
    Ok(js_client)
}

fn get_valkey_default_client(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    use crate::valkey_jsc::JSValkeyClient;

    let valkey = match JSValkeyClient::create_no_js_no_pubsub(global_this, &[JSValue::UNDEFINED]) {
        Ok(p) => p,
        Err(jsc::JsError::Thrown) => return JSValue::ZERO,
        Err(err) => {
            let _ =
                global_this.throw_error(crate::Error::from(err), "Failed to create Redis client");
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
        Err(jsc::JsError::Thrown) => return JSValue::ZERO,
        Err(err) => {
            let _ =
                global_this.throw_error(crate::Error::from(err), "Failed to create Redis client");
            return JSValue::ZERO;
        }
    }

    as_js
}

fn get_valkey_client_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::valkey_jsc::JSValkeyClient>(global_this)
}

fn get_terminal_constructor(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    crate::api::bun_terminal_body::js::get_constructor(global_this)
}

fn get_is_standalone_executable(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSValue::js_boolean(global_this.bun_vm().standalone_module_graph.is_some())
}

fn get_embedded_files(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    use crate::webcore::blob::{Blob, BlobExt as _};
    use bun_standalone_graph::{File as GraphFile, Graph as StandaloneModuleGraph};
    let Some(graph) = StandaloneModuleGraph::get_ref() else {
        return JSValue::create_empty_array(global_this, 0);
    };

    let unsorted_files = graph.files.values();
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
    index_sort::sort_indices(&mut sort_indices, &mut |a, b| {
        if GraphFile::less_than_by_index(unsorted_files, a, b) {
            core::cmp::Ordering::Less
        } else if GraphFile::less_than_by_index(unsorted_files, b, a) {
            core::cmp::Ordering::Greater
        } else {
            core::cmp::Ordering::Equal
        }
    });
    for (i, index) in sort_indices.iter().enumerate() {
        let file: &GraphFile = &unsorted_files[*index as usize];
        // `file_blob` keeps the embedded path (minus the `/$bunfs/root/` prefix)
        // as the blob name, preserving any subdirectory from the asset template.
        let blob = Blob::new(crate::api::standalone_graph_jsc::file_blob(
            file,
            global_this,
        ));
        // SAFETY: `blob` is heap-allocated and lives until JS owns it via to_js.
        array.put_index(global_this, i as u32, unsafe { (*blob).to_js(global_this) })?;
    }

    Ok(array)
}

fn get_semver(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    bun_semver_jsc::SemverObject::create(global_this)
}

fn get_unsafe(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    UnsafeObject::create(global_this)
}

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
fn get_csrf_object(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    CSRFObject::create(global_object)
}

struct CSRFObject;

impl CSRFObject {
    fn create(global_this: &JSGlobalObject) -> JSValue {
        let object = JSValue::create_empty_object(global_this, 2);

        // NOTE: `JSFunction::create` takes the raw JSC-ABI host fn pointer,
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
pub(crate) mod environment_variables {
    use super::*;

    #[unsafe(no_mangle)]
    extern "C" fn Bun__getEnvCount(
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

    /// # Safety
    /// `ptr` must be the value written by `Bun__getEnvCount` and `i` must be
    /// less than the count it returned; the backing storage must not have been
    /// reallocated in between.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__getEnvKey(
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
    extern "C" fn Bun__getEnvValue<'a>(
        global_object: &'a JSGlobalObject,
        name: &EncodedSlice<'_>,
        value: &mut core::mem::MaybeUninit<EncodedSlice<'a>>,
    ) -> bool {
        if let Some(val) = get_env_value(global_object, *name) {
            value.write(val);
            return true;
        }

        false
    }

    /// The value borrows the env map; the caller copies before the map can
    /// mutate. `Dead` when absent.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__getEnvValueBunString<'a>(
        global_object: &'a JSGlobalObject,
        name: &BunString,
    ) -> bun_core::StringView<'a> {
        let vm = global_object.bun_vm();
        let name_slice = name.to_utf8();
        match vm.env_loader().get(name_slice.slice()) {
            Some(val) => bun_core::StringView::borrow_utf8(val),
            None => bun_core::StringView::DEAD,
        }
    }

    /// Sync a process.env write back to the native env map so that native
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
    extern "C" fn Bun__setEnvValue(
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

        let env_map = &mut vm.transpiler.env_mut().map;

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
        // NOTE: `Map::put` boxes its own copy — the Arc wrapper now
        // only backs `proxy_env_storage` for worker `cloneFrom`; ordering is
        // kept for spec parity.
        bun_core::handle_oom(env_map.put(slot.key, &stored.bytes));
    }

    fn get_env_value<'a>(
        global_object: &'a JSGlobalObject,
        name: EncodedSlice<'_>,
    ) -> Option<EncodedSlice<'a>> {
        // SAFETY: bun_vm() returns the live thread-local VM.
        let vm = global_object.bun_vm();
        let utf8 = name.to_utf8();
        let value = vm.env_loader().get(utf8.slice())?;
        Some(EncodedSlice::from_bytes(value))
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__reportError(global_object: &JSGlobalObject, err: JSValue) {
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
/// (e.g. `JSZstd::get_options_async`) can read `options` *before* pinning and
/// rooting the buffer, preserving error precedence.
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

/// Sync `StringOrBuffer` coercion of the buffer argument. Callers that read
/// option properties (which can run arbitrary JS) must do so *before* calling
/// this, so nothing runs between the coercion and the use of the slice.
#[inline]
pub(crate) fn coerce_compress_buffer(
    global: &JSGlobalObject,
    buffer_value: JSValue,
) -> JsResult<node::StringOrBuffer<'static>> {
    if let Some(buffer) = node::StringOrBuffer::from_js(global, buffer_value)? {
        return Ok(buffer);
    }
    Err(global.throw_invalid_arguments(format_args!("Expected buffer to be a string or buffer")))
}

/// [`parse_compress_args`] + [`coerce_compress_buffer`], for callers that read
/// no further option properties.
#[inline]
pub(crate) fn parse_compress_buffer_and_options(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<(node::StringOrBuffer<'static>, Option<JSValue>)> {
    let (buffer_value, options_val) = parse_compress_args(global, callframe)?;
    Ok((coerce_compress_buffer(global, buffer_value)?, options_val))
}

#[allow(non_snake_case)]
pub mod JSZlib {
    use super::*;
    use bun_jsc::ComptimeStringMapExt as _;
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

    // NOTE: a full `[0..capacity)` window
    // was previously shimmed here as `&mut [u8]`, but materializing `&mut [u8]`
    // over uninitialized bytes is UB regardless of later `set_len`.
    // Callers now use `Vec::spare_capacity_mut()` (-> `&mut [MaybeUninit<u8>]`)
    // with `compress_into` / `decompress_into`, which is the sound equivalent.

    // NOTE: no `reader_deallocator` / `compressor_deallocator` exports are
    // needed to free a heap-allocated reader/compressor from the ArrayBuffer
    // finalizer. The reader stays on-stack
    // borrowing a local `Vec<u8>`, then leaks only the Vec's allocation into
    // the ArrayBuffer — so both zlib paths converge on `global_deallocator`
    // and the per-type callbacks are gone. (`no_mangle` dropped: 0 C++ refs.)
    use bun_alloc::c_thunks::mi_free_ctx as global_deallocator;

    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    #[strum(serialize_all = "lowercase")]
    pub(crate) enum Library {
        Zlib,
        Libdeflate,
    }

    // bun.ComptimeEnumMap(Library)
    bun_core::comptime_string_map! {
        pub(crate) static LIBRARY_MAP: Library = {
            b"zlib" => Library::Zlib,
            b"libdeflate" => Library::Libdeflate,
        };
    }

    /// Move `list`'s allocation into a `Uint8Array` backing store without
    /// copying. After `shrink_to_fit`, an empty `Vec` owns no allocation (its
    /// pointer is dangling), so no deallocator is registered for it.
    fn leak_list_into_uint8array(
        global_this: &JSGlobalObject,
        mut list: Vec<u8>,
    ) -> JsResult<JSValue> {
        list.shrink_to_fit();
        let is_empty = list.is_empty();
        let leaked: &'static mut [u8] = list.leak();
        let ptr = leaked.as_mut_ptr();
        let array_buffer = ArrayBuffer::from_bytes(leaked, jsc::JSType::Uint8Array);
        // SAFETY: non-empty: `ptr` is the just-leaked `Vec` allocation, freed
        // exactly once at GC by `global_deallocator` (`mi_free_ctx`) via the ctx
        // pointer. Empty: no callback, and the dangling `ptr` is never read.
        unsafe {
            array_buffer.to_js_with_context(
                global_this,
                if is_empty {
                    core::ptr::null_mut()
                } else {
                    ptr.cast::<c_void>()
                },
                if is_empty {
                    None
                } else {
                    Some(global_deallocator)
                },
            )
        }
    }

    #[bun_jsc::host_fn]
    pub(crate) fn gzip_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer_value, options_val, true)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn inflate_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer_value, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn deflate_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;
        gzip_or_deflate_sync(global_this, buffer_value, options_val, false)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn gunzip_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;
        gunzip_or_inflate_sync(global_this, buffer_value, options_val, true)
    }

    fn gunzip_or_inflate_sync(
        global_this: &JSGlobalObject,
        buffer_value: JSValue,
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

        let buffer = coerce_compress_buffer(global_this, buffer_value)?;
        let compressed = buffer.slice();

        let mut list: Vec<u8> = Vec::new();
        let mut reserved = false;
        if is_gzip && compressed.len() > 64 {
            // The gzip trailer is CRC32 then ISIZE, the uncompressed size mod 2^32 (RFC 1952 2.3.1).
            let estimated_size: u32 = u32::from_le_bytes(
                compressed[compressed.len() - 4..][..4]
                    .try_into()
                    .expect("infallible: size matches"),
            );
            // If it's > 256 MB, let's rely on dynamic allocation to minimize the risk of OOM.
            if estimated_size > 0 && estimated_size < 256 * 1024 * 1024 {
                // The trailer is untrusted; if its size cannot be reserved, start small and grow.
                reserved = list
                    .try_reserve_exact((estimated_size as usize).max(64))
                    .is_ok();
            }
        }
        if !reserved {
            list.try_reserve_exact(if compressed.len() > 512 {
                compressed.len()
            } else {
                32
            })
            .map_err(|_| global_this.throw_out_of_memory())?;
        }

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
                        return Err(global_this.throw_error(crate::Error::from(err), "Zlib error"));
                    }
                };

                match reader.read_all(true) {
                    Ok(()) => {}
                    Err(zlib::ZlibError::OutOfMemory) => {
                        return Err(global_this.throw_out_of_memory());
                    }
                    Err(_) => {
                        let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                        return Err(global_this.throw(format_args!("{}", bstr::BStr::new(msg))));
                    }
                }
                // NOTE: the reader *borrows* `list_ptr`,
                // so drop the reader to release the borrow, then leak the owned
                // `list` directly into the ArrayBuffer (freed by
                // `global_deallocator`).
                drop(reader);
                leak_list_into_uint8array(global_this, list)
            }
            Library::Libdeflate => {
                let Some(mut decompressor) = bun_libdeflate::OwnedDecompressor::new() else {
                    drop(list);
                    return Err(global_this.throw_out_of_memory());
                };
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };
                let max_output = ArrayBuffer::MAX_SIZE as usize;
                let result = decompressor
                    .decompress_to_vec_grow(compressed, &mut list, encoding, max_output)
                    .map_err(|_| global_this.throw_out_of_memory())?;
                match result.status {
                    bun_libdeflate::Status::Success if list.len() <= max_output => {}
                    bun_libdeflate::Status::Success | bun_libdeflate::Status::InsufficientSpace => {
                        drop(list);
                        return Err(global_this
                            .err(
                                jsc::ErrCode::BUFFER_TOO_LARGE,
                                format_args!(
                                    "Cannot create a Buffer larger than {max_output} bytes",
                                ),
                            )
                            .throw());
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
                // SAFETY: `ptr` is the just-leaked `Vec` allocation, live until
                // `global_deallocator` (`mi_free_ctx`) frees it exactly once at
                // GC via the ctx pointer (the data pointer itself).
                unsafe {
                    array_buffer.to_js_with_context(
                        global_this,
                        ptr.cast::<c_void>(),
                        Some(global_deallocator),
                    )
                }
            }
        }
    }

    fn gzip_or_deflate_sync(
        global_this: &JSGlobalObject,
        buffer_value: JSValue,
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
            }
        }

        let buffer = coerce_compress_buffer(global_this, buffer_value)?;
        let compressed = buffer.slice();
        let _ = window_bits; // unused

        match library {
            Library::Zlib => {
                // `init` reserves `deflateBound` of the input.
                let mut list: Vec<u8> = Vec::new();

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
                        return Err(global_this.throw_error(crate::Error::from(err), "Zlib error"));
                    }
                };

                match reader.read_all() {
                    Ok(()) => {}
                    Err(zlib::ZlibError::OutOfMemory) => {
                        return Err(global_this.throw_out_of_memory());
                    }
                    Err(_) => {
                        let msg = reader.error_message().unwrap_or(b"Zlib returned an error");
                        return Err(global_this.throw(format_args!("{}", bstr::BStr::new(msg))));
                    }
                }
                // NOTE: see gunzip path — reader borrows `list`, so drop
                // it before leaking `list` into the ArrayBuffer.
                drop(reader);
                leak_list_into_uint8array(global_this, list)
            }
            Library::Libdeflate => {
                let level = level.unwrap_or(6);
                if !(bun_libdeflate::MIN_COMPRESSION_LEVEL..=bun_libdeflate::MAX_COMPRESSION_LEVEL)
                    .contains(&level)
                {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Compression level must be between {} and {} for libdeflate",
                        bun_libdeflate::MIN_COMPRESSION_LEVEL,
                        bun_libdeflate::MAX_COMPRESSION_LEVEL,
                    )));
                }
                let Some(mut compressor) = bun_libdeflate::OwnedCompressor::new(level) else {
                    return Err(global_this.throw_out_of_memory());
                };
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };

                let mut list: Vec<u8> = Vec::new();
                let result = compressor
                    .compress_to_vec(compressed, &mut list, encoding)
                    .map_err(|_| global_this.throw_out_of_memory())?;
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
                // SAFETY: `ptr` is the just-leaked `Vec` allocation, live until
                // `global_deallocator` (`mi_free_ctx`) frees it exactly once at
                // GC via the ctx pointer (the data pointer itself).
                unsafe {
                    array_buffer.to_js_with_context(
                        global_this,
                        ptr.cast::<c_void>(),
                        Some(global_deallocator),
                    )
                }
            }
        }
    }
}

#[allow(non_snake_case)]
pub mod JSZstd {
    use super::*;

    fn get_level(global_this: &JSGlobalObject, options_val: Option<JSValue>) -> JsResult<i32> {
        if let Some(option_obj) = options_val {
            if let Some(level_val) = option_obj.get(global_this, "level")? {
                let value = level_val.coerce::<i32>(global_this)?;

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
    ) -> JsResult<(
        node::ThreadIsolated<node::StringOrBuffer<'static>>,
        Option<JSValue>,
        i32,
    )> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;

        let level = get_level(global_this, options_val)?;

        if let Some(buffer) = node::StringOrBuffer::from_js_async(global_this, buffer_value)? {
            return Ok((buffer, options_val, level));
        }

        Err(global_this
            .throw_invalid_arguments(format_args!("Expected buffer to be a string or buffer")))
    }

    /// Error of a `Bun.zstd*` call: thrown by the sync functions, rejected by [`ZstdJob`].
    pub(crate) enum Failure {
        /// The output, whose size the input decides, or zstd's own state for it could not be allocated.
        OutOfMemory,
        /// An `ERR_ZSTD` with this message.
        Compression(&'static [u8]),
        /// An `ERR_ZSTD` naming the error.
        Decompression(bun_zstd::ZstdError),
    }

    impl Failure {
        fn throw(self, global_this: &JSGlobalObject) -> jsc::JsError {
            match self {
                Failure::OutOfMemory => global_this.throw_out_of_memory(),
                failure => global_this.throw_value(failure.to_js(global_this)),
            }
        }

        fn to_js(self, global_this: &JSGlobalObject) -> JSValue {
            match self {
                Failure::OutOfMemory => global_this.create_out_of_memory_error(),
                Failure::Compression(message) => global_this
                    .err(
                        jsc::ErrCode::ZSTD,
                        format_args!("{}", bstr::BStr::new(message)),
                    )
                    .to_js(),
                Failure::Decompression(err) => global_this
                    .err(
                        jsc::ErrCode::ZSTD,
                        format_args!("Decompression failed: {}", err),
                    )
                    .to_js(),
            }
        }
    }

    impl From<bun_zstd::ZstdError> for Failure {
        fn from(err: bun_zstd::ZstdError) -> Self {
            match err {
                bun_zstd::ZstdError::OutOfMemory => Failure::OutOfMemory,
                err => Failure::Decompression(err),
            }
        }
    }

    /// Boxed (trimmed to the bytes produced) so an empty result owns no memory, as `create_buffer_from_box` requires.
    fn compress_to_box(input: &[u8], level: i32) -> Result<Box<[u8]>, Failure> {
        let max_size = bun_zstd::compress_bound(input.len());
        // `ZSTD_compressBound` returns an error code for inputs over `ZSTD_MAX_INPUT_SIZE`.
        if bun_zstd::is_error(max_size) {
            return Err(Failure::Compression(b"Input is too large to compress"));
        }

        // Reserved, not zero-filled: zstd initializes exactly the bytes it reports.
        let mut output: Vec<u8> = Vec::new();
        output
            .try_reserve_exact(max_size)
            .map_err(|_| Failure::OutOfMemory)?;

        if let bun_zstd::Result::Err(err) =
            bun_zstd::compress_append(&mut output, input, Some(level))
        {
            return Err(Failure::Compression(err.as_bytes()));
        }

        Ok(output.into_boxed_slice())
    }

    fn decompress_to_box(input: &[u8]) -> Result<Box<[u8]>, Failure> {
        bun_zstd::decompress_alloc(input)
            .map(Vec::into_boxed_slice)
            .map_err(Failure::from)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn compress_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer_value, options_val) = parse_compress_args(global_this, callframe)?;

        let level = get_level(global_this, options_val)?;

        let buffer = coerce_compress_buffer(global_this, buffer_value)?;

        let output =
            compress_to_box(buffer.slice(), level).map_err(|failure| failure.throw(global_this))?;

        JSValue::create_buffer_from_box(global_this, output)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn decompress_sync(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer, _) = parse_compress_buffer_and_options(global_this, callframe)?;

        let output =
            decompress_to_box(buffer.slice()).map_err(|failure| failure.throw(global_this))?;

        JSValue::create_buffer_from_box(global_this, output)
    }

    // --- Async versions ---

    /// `Bun.zstdCompress` / `Bun.zstdDecompress` off the JS thread.
    pub(crate) struct ZstdJob {
        pub buffer: node::ThreadIsolated<node::StringOrBuffer<'static>>,
        pub is_compress: bool,
        pub level: i32,
        /// Filled in by `run`.
        pub result: Result<Box<[u8]>, Failure>,
    }

    impl jsc::JobContext for ZstdJob {
        type OffThread = Self;
        type Js = jsc::JSPromiseStrong;

        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
            let input = this.buffer.slice();

            this.result = if this.is_compress {
                compress_to_box(input, this.level)
            } else {
                decompress_to_box(input)
            };
            Some(done)
        }

        fn then(
            this: Self,
            mut promise: jsc::JSPromiseStrong,
            cx: &jsc::JsThread<'_>,
        ) -> JsResult<()> {
            let global_this = cx.global();
            let promise = promise.swap();

            match this.result {
                Ok(output) => promise.settle(
                    global_this,
                    JSValue::create_buffer_from_box(global_this, output),
                ),
                Err(failure) => {
                    promise.reject_with_async_stack(global_this, Ok(failure.to_js(global_this)))
                }
            }
        }
    }

    fn create_job(
        global_this: &JSGlobalObject,
        buffer: node::ThreadIsolated<node::StringOrBuffer<'static>>,
        is_compress: bool,
        level: i32,
    ) -> JSValue {
        let cx = global_this.js_thread();
        let promise = jsc::JSPromiseStrong::init(global_this);
        let promise_value = promise.value();
        jsc::Job::<ZstdJob>::schedule(
            &cx,
            ZstdJob {
                buffer,
                is_compress,
                level,
                result: Ok(Box::default()),
            },
            promise,
        );
        promise_value
    }

    #[bun_jsc::host_fn]
    pub(crate) fn compress(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer, _, level) = get_options_async(global_this, callframe)?;
        Ok(create_job(global_this, buffer, true, level))
    }

    #[bun_jsc::host_fn]
    pub(crate) fn decompress(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (buffer, _, _) = get_options_async(global_this, callframe)?;
        Ok(create_job(global_this, buffer, false, 0)) // level is ignored for decompression
    }
}

// NOTE: symbols are linked via the `#[unsafe(no_mangle)]` exports above.
// Referenced: Crypto::JSPasswordObject::JSPasswordObject__create,
// bun_jsc::btjs::dump_btjs_trace.

// LazyProperty initializers for stdin/stderr/stdout
//
// NOTE (layering): `RareData.{stdin,stdout,stderr}_store` are typed as
// `Option<Arc<high_tier::BlobStore>>` opaque stubs in `bun_jsc`. The real
// `Blob::Store` (intrusively refcounted, with `File` payload) lives in this
// crate and can't move down without dragging `node::PathLike`/S3/aio. The
// stores exist purely for per-VM lazy init; that is per-thread
// in practice (`VirtualMachine::get()` is thread-local), so cache the
// `RefPtr<Store>`s here.
mod stdio_stores {
    use super::*;
    use crate::node::types::PathOrFileDescriptor;
    use crate::webcore::blob::store::{Data, File as FileStore, IsAllAscii};
    use crate::webcore::blob::{Blob, BlobExt as _, Store};
    use bun_ptr::RefPtr;

    thread_local! {
        static STDIN: core::cell::RefCell<Option<RefPtr<Store>>> = const { core::cell::RefCell::new(None) };
        static STDOUT: core::cell::RefCell<Option<RefPtr<Store>>> = const { core::cell::RefCell::new(None) };
        static STDERR: core::cell::RefCell<Option<RefPtr<Store>>> = const { core::cell::RefCell::new(None) };
    }

    fn build_store(uv_fd: i32, is_atty: bool) -> RefPtr<Store> {
        let fd = bun_sys::Fd::from_uv(uv_fd);
        let mode: bun_sys::Mode = match bun_sys::fstat(fd) {
            Ok(stat) => stat.st_mode as bun_sys::Mode,
            Err(_) => 0,
        };
        RefPtr::new(Store {
            data: Data::File(FileStore {
                pathlike: PathOrFileDescriptor::Fd(fd),
                is_atty: Some(is_atty),
                mode,
                ..Default::default()
            }),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: IsAllAscii::default(),
        })
    }

    fn make_blob(
        global_this: &JSGlobalObject,
        slot: &'static std::thread::LocalKey<core::cell::RefCell<Option<RefPtr<Store>>>>,
        uv_fd: i32,
        is_atty: bool,
        feature: &'static core::sync::atomic::AtomicUsize,
    ) -> JSValue {
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
        unsafe { (&*blob).to_js(global_this) }
    }

    pub(super) fn stdin(global_this: &JSGlobalObject) -> JSValue {
        let is_atty = bun_sys::isatty(bun_sys::Fd::from_uv(0));
        make_blob(
            global_this,
            &STDIN,
            0,
            is_atty,
            &bun_core::analytics::Features::BUN_STDIN,
        )
    }
    pub(super) fn stdout(global_this: &JSGlobalObject) -> JSValue {
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
    pub(super) fn stderr(global_this: &JSGlobalObject) -> JSValue {
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
