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
use std::io::Write as _;

use bun_core::Output;
use bun_jsc::{
    self as jsc, ArrayBuffer, ConsoleObject, ErrorCode, JSArray, JSFunction, JSGlobalObject,
    JSObject, JSPromise, JSString, JSValue, JsResult,
};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use crate::cli::open::Editor;
use bun_core::{EncodedSlice, String as BunString, StringView, strings};
use bun_jsc::virtual_machine::{ResolveMode, VirtualMachine};
use bun_paths::MAX_PATH_BYTES;
use bun_shell_parser::braces as Braces;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_zlib as zlib;

use crate::node;
use crate::valkey_jsc::js_valkey::{SubscriptionCtx, js as js_RedisClient};
use bun_collections::index_sort;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::{StringJsc as _, bun_string_jsc};

use crate::generated_bindgen::bun_object::{
    BracesOptions, Bun__BunObject__inspect, Bun__BunObject__table, EditorOptions, InspectOptions,
    InspectOptionsOrDepth, MMapOptions, WhichOptions, ZlibCompressionOptions,
    ZlibDecompressionOptions, ZstdCompressionOptions,
};
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsScope, PinnedBytes};

/// How to add a new property to the Bun global (a function goes in `BunObject.bind.ts`)
///
/// - Add a property to `export_lazy_prop_callbacks!` below
/// - Update "@begin bunObjectTable" in BunObject.cpp
///     - Getters use a generated wrapper function `BunObject_lazyPropCb_wrap_<name>`
/// - Update "BunObject+exports.h"
/// - Run `bun run build`
pub(crate) mod bun_object {
    use super::*;

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
                // (`BunObject+exports.h`); on Windows-x64 that's RDI/RSI,
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

    // --- Lazy property callbacks ---
    export_lazy_prop_callbacks! {
        BunObject_lazyPropCb_FFI => crate::ffi::ffi_object_draft::getter,
        BunObject_lazyPropCb_argv => super::get_argv,
        BunObject_lazyPropCb_cron => super::get_cron_object,
        BunObject_lazyPropCb_cwd => super::get_cwd,
        BunObject_lazyPropCb_embeddedFiles => super::get_embedded_files,
        BunObject_lazyPropCb_enableANSIColors => super::enable_ansi_colors,
        BunObject_lazyPropCb_isStandaloneExecutable => super::get_is_standalone_executable,
        BunObject_lazyPropCb_inspect => super::get_inspect,
        BunObject_lazyPropCb_origin => super::get_origin,
        BunObject_lazyPropCb_s3 => super::get_s3_default_client,
        BunObject_lazyPropCb_valkey => super::get_valkey_default_client,
    }
    // --- Lazy property callbacks ---

    // --- Getters ---
    // --- Getters ---

    // --- Setters ---
    // --- Setters ---

    // The export names
    // are spelled out verbatim in the `export_*!` macro invocations above.

    // type LazyPropertyCallback = extern "C" fn(*mut JSGlobalObject, *mut JSObject) -> JSValue
    // (the `callconv(jsc.conv)` ABI is emitted by the macro above;
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

pub(crate) fn shell_escape<'a>(
    heap: &JsHeap<'a>,
    input: &BunString,
) -> bindgen::Result<'a, BunString> {
    if !bun_shell_parser::needs_escape_bunstr(input) {
        return Ok(input.clone());
    }

    let mut outbuf: Vec<u8> = Vec::new();
    if !bun_shell_parser::escape_bun_str::<true>(input, &mut outbuf)? {
        return Err(heap.error(format_args!(
            "String has invalid utf-16: {}",
            bstr::BStr::new(input.byte_slice()),
        )));
    }
    Ok(BunString::clone_utf8(&outbuf))
}

/// `Bun.gc(force)`: heap size after the collection.
pub(crate) fn gc_from_js(cx: &mut JsScope<'_>, force: bool) -> usize {
    cx.global().bun_vm().as_mut().garbage_collect_from_js(force)
}

pub(crate) fn braces(
    cx: &mut JsScope<'_>,
    brace_str: &BunString,
    opts: &BracesOptions,
) -> JsResult<JSValue> {
    let global = cx.global();
    let brace_utf8 = brace_str.to_utf8();
    let brace_slice = brace_utf8.slice();

    let mut arena = bun_alloc::Arena::new();
    let _ = &mut arena;

    let mut lexer_output = 'lexer_output: {
        if strings::is_all_ascii(brace_slice) {
            break 'lexer_output match Braces::Lexer::tokenize(brace_slice) {
                Ok(v) => v,
                Err(err) => {
                    return Err(
                        global.throw_error(crate::Error::from(err), "failed to tokenize braces")
                    );
                }
            };
        }

        match Braces::NewLexer::<{ Braces::StringEncoding::Wtf8 }>::tokenize(brace_slice) {
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
        let bun_str = StringView::from_bytes(&str);
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
        let bun_str = StringView::from_bytes(&str);
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

    let mut out_strings: Vec<StringView<'_>> = Vec::with_capacity(expansion_count);
    for i in 0..expansion_count {
        out_strings.push(StringView::from_bytes(&expanded_strings[i][..]));
    }

    bun_string_jsc::to_js_array(global, StringView::as_strings(&out_strings))
}

pub(crate) fn which<'a>(
    heap: &JsHeap<'a>,
    command: &'a [u8],
    options: &WhichOptions<'a>,
) -> bindgen::Result<'a, Option<JsLocal<'a, JSString>>> {
    if command.len() >= MAX_PATH_BYTES {
        return Err(heap.error(format_args!("bin path is too long")));
    }

    let vm = VirtualMachine::get();
    let path = options
        .path
        .unwrap_or_else(|| vm.env_loader().get(b"PATH").unwrap_or(b""));
    let cwd = options.cwd.unwrap_or_else(|| vm.top_level_dir());

    let mut path_buf = bun_paths::path_buffer_pool::get();
    bun_which::which(&mut *path_buf, path, cwd, command)
        .map(|bin_path| heap.create_utf8_string(bin_path))
        .transpose()
}

fn apply_inspect_options(
    format_options: &mut ConsoleObject::FormatOptions,
    global_this: &JSGlobalObject,
    options: &InspectOptions,
) -> JsResult<()> {
    if let Some(depth) = options.depth {
        format_options.set_depth(global_this, depth)?;
    }
    if let Some(colors) = options.colors {
        format_options.enable_colors = colors;
    }
    if let Some(sorted) = options.sorted {
        format_options.ordered_properties = sorted;
    }
    if let Some(compact) = options.compact {
        format_options.single_line = compact;
    }
    Ok(())
}

/// `Bun.inspect.table(tabularData, options)`
pub(crate) fn table<'a>(
    cx: &mut JsScope<'a>,
    tabular_data: Option<JsLocal<'a, JSObject>>,
    options: Option<&InspectOptions>,
) -> JsResult<Vec<u8>> {
    print_table(cx, tabular_data, JSValue::UNDEFINED, options)
}

/// `Bun.inspect.table(tabularData, properties, options)`
pub(crate) fn table_with_properties<'a>(
    cx: &mut JsScope<'a>,
    tabular_data: Option<JsLocal<'a, JSObject>>,
    properties: JsLocal<'a, JSArray>,
    options: Option<&InspectOptions>,
) -> JsResult<Vec<u8>> {
    print_table(cx, tabular_data, properties.to_js(), options)
}

fn print_table(
    cx: &mut JsScope<'_>,
    tabular_data: Option<JsLocal<'_, JSObject>>,
    properties: JSValue,
    options: Option<&InspectOptions>,
) -> JsResult<Vec<u8>> {
    let global_this = cx.global();
    let Some(value) = tabular_data else {
        return Ok(Vec::new());
    };
    let value = value.to_js();

    let mut format_options = ConsoleObject::FormatOptions {
        enable_colors: false,
        add_newline: false,
        max_depth: 5,
        quote_strings: true,
        ordered_properties: false,
        single_line: true,
        ..Default::default()
    };
    if let Some(options) = options {
        apply_inspect_options(&mut format_options, global_this, options)?;
    }

    // very stable memory address
    let mut array: Vec<u8> = Vec::new();

    let mut table_printer = ConsoleObject::TablePrinter::init(
        global_this,
        ConsoleObject::MessageLevel::Log,
        value,
        properties,
    )?;
    table_printer.set_start_depth(format_options.max_depth);
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

    Ok(array)
}

pub(crate) fn inspect<'a>(
    cx: &mut JsScope<'a>,
    arg: Option<JsLocal<'a>>,
    options: InspectOptionsOrDepth<'a>,
    colors: Option<bool>,
) -> JsResult<Vec<u8>> {
    let global_this = cx.global();
    let Some(value) = arg else {
        return Ok(Vec::new());
    };
    let value = value.to_js();

    let mut format_options = ConsoleObject::FormatOptions {
        enable_colors: false,
        add_newline: false,
        max_depth: 8,
        quote_strings: true,
        ordered_properties: false,
        ..Default::default()
    };
    match options {
        InspectOptionsOrDepth::Options(options) => {
            apply_inspect_options(&mut format_options, global_this, &options)?;
        }
        InspectOptionsOrDepth::Depth(depth) => {
            format_options.set_depth(global_this, depth)?;
            format_options.enable_colors = colors.unwrap_or(false);
        }
        InspectOptionsOrDepth::Ignored(_) => format_options.enable_colors = colors.unwrap_or(false),
    }

    // very stable memory address
    let mut array: Vec<u8> = Vec::new();
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    ConsoleObject::format2(
        ConsoleObject::MessageLevel::Debug,
        global_this,
        core::slice::from_ref(&value),
        &mut array,
        format_options,
    )?;
    // format2() swallows JS throws from nested formatting and returns Ok; see ConsoleObject::Formatter::format
    if global_this.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    // writer.flush(): Vec<u8> is unbuffered.

    Ok(array)
}

// HOST_EXPORT(Bun__inspect_singleline, c)
pub(crate) fn bun_inspect_singleline(global_this: &JSGlobalObject, value: JSValue) -> BunString {
    let mut array: Vec<u8> = Vec::new();
    if ConsoleObject::format2(
        ConsoleObject::MessageLevel::Debug,
        global_this,
        core::slice::from_ref(&value),
        &mut array,
        ConsoleObject::FormatOptions {
            enable_colors: false,
            add_newline: false,
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
        Bun__BunObject__inspect,
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
            Bun__BunObject__table,
            3,
            Default::default(),
        ),
    );
    fun
}

pub(crate) fn register_macro<'a>(
    heap: &JsHeap<'a>,
    id: f64,
    callback: JsLocal<'a>,
) -> bindgen::Result<'a, ()> {
    let id = id as i32;
    if id == -1 || id == 0 {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_TYPE,
            format_args!("Internal error registering macros: invalid id"),
        ));
    }

    if callback.as_callable().is_none() {
        return Err(heap.error(format_args!("Macro must be a function")));
    }
    let callback = callback.to_js();

    // SAFETY: VirtualMachine::get() returns the live per-thread singleton.
    let get_or_put_result = VirtualMachine::get()
        .as_mut()
        .macros
        .get_or_put(id)
        .expect("unreachable");
    if get_or_put_result.found_existing {
        get_or_put_result.value_ptr.unprotect();
    }

    callback.protect();
    *get_or_put_result.value_ptr = callback;

    Ok(())
}

fn get_cwd(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    EncodedSlice::from_bytes(bun_resolver::fs::FileSystem::get().top_level_dir()).to_js(global_this)
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
pub(crate) fn get_main(global_this: &JSGlobalObject) -> JSValue {
    // SAFETY: bun_vm() returns the live singleton VirtualMachine for a Bun-owned global.
    let vm = global_this.bun_vm().as_mut();
    // If JS has set it to a custom value, use that one
    if let Some(overridden_main) = vm.overridden_main.get() {
        return overridden_main;
    }
    // No entry module (`bun bake`): an empty string, as `Bun.main` is always a string.
    let Some(main) = vm.main() else {
        return EncodedSlice::from_bytes(b"").to_js(global_this);
    };

    // Attempt to use the resolved filesystem path
    // This makes `eval('require.main === module')` work when the main module is a symlink.
    // This behavior differs slightly from Node. Node sets the `id` to `.` when the main module is a symlink.
    'use_resolved_path: {
        if vm.main_resolved_path.is_empty() {
            // If it's from eval, don't try to resolve it.
            if strings::ends_with(main, b"[eval]") {
                break 'use_resolved_path;
            }
            if strings::ends_with(main, b"[stdin]") {
                break 'use_resolved_path;
            }

            let Ok(fd) = sys::openat_a(
                if cfg!(windows) {
                    Fd::INVALID
                } else {
                    Fd::cwd()
                },
                main,
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
                let mut wpath = bun_paths::w_path_buffer_pool::get();
                let Ok(fdpath) = bun_sys::get_fd_path_w(fd, &mut wpath) else {
                    break 'use_resolved_path;
                };
                vm.main_resolved_path = BunString::clone_utf16(fdpath);
            }
            #[cfg(not(windows))]
            {
                let mut path = bun_paths::path_buffer_pool::get();
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

    EncodedSlice::from_bytes(main).to_js(global_this)
}

// HOST_EXPORT(BunObject_setter_main, jsc)
pub(crate) fn set_main(global_this: &JSGlobalObject, new_value: JSValue) -> bool {
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

pub(crate) fn open_in_editor<'a>(
    heap: &JsHeap<'a>,
    path: &'a [u8],
    options: &EditorOptions<'a>,
) -> bindgen::Result<'a, ()> {
    let vm = VirtualMachine::get();
    let editor_name = options.editor.filter(|name| !name.is_empty());

    EDITOR_CONTEXT.with(|cell| {
        let mut slot = cell.borrow_mut();
        let slot = &mut *slot;
        let edit = &mut slot.ctx;
        let env = vm.transpiler.env_mut();
        let mut editor_choice: Option<Editor> = None;

        if let Some(name) = editor_name {
            let prev_name = edit.name;

            if !strings::eql_long(prev_name, name, true) {
                let prev = core::mem::take(edit);
                // Own the bytes in `name_storage` and
                // hand back a thread-lifetime borrow.
                let prev_storage = core::mem::replace(&mut slot.name_storage, name.to_vec());
                // SAFETY: `name_storage` lives in a thread_local that
                // outlives any caller; we never reallocate it while
                // `edit.name` is observed (single-threaded JS VM).
                edit.name = unsafe { bun_ptr::detach_lifetime(slot.name_storage.as_slice()) };
                edit.detect_editor(env);
                editor_choice = edit.found();
                if editor_choice.is_none() {
                    slot.name_storage = prev_storage;
                    *edit = prev;
                    return Err(heap.error(format_args!(
                        "Could not find editor \"{}\"",
                        bstr::BStr::new(name),
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
                        return Err(heap.error(format_args!("Failed to auto-detect editor")));
                    }
                }
            }
        };

        if path.is_empty() {
            return Err(heap.error(format_args!("No file path specified")));
        }

        if let Err(err) = editor.open(edit.path, path, options.line, options.column) {
            return Err(heap.error(format_args!("Opening editor failed {}", err.name())));
        }

        Ok(())
    })
}

pub(crate) fn sleep_sync<'a>(heap: &JsHeap<'a>, milliseconds: f64) -> bindgen::Result<'a, ()> {
    // Beyond `i32::MAX` it is `i32::MAX`.
    let milliseconds = milliseconds as i32;
    let Ok(duration) = u64::try_from(milliseconds) else {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_TYPE,
            format_args!("argument to sleepSync must not be negative, got {milliseconds}"),
        ));
    };

    // mimalloc's scavenger sweeps this thread's heaps while it sleeps, as it does across the event loop's poll.
    // SAFETY: nothing allocates or frees on this thread until `mi_on_thread_idle_end` below.
    let handed_off = unsafe { bun_alloc::mimalloc::mi_on_thread_idle_start() };
    std::thread::sleep(core::time::Duration::from_millis(duration));
    if handed_off {
        bun_alloc::mimalloc::mi_on_thread_idle_end();
    }
    Ok(())
}

// HOST_EXPORT(Bun__gc, c)
pub(crate) fn gc(vm: &mut VirtualMachine, sync: bool) -> usize {
    vm.garbage_collect_from_js(sync)
}

pub(crate) fn shrink(cx: &mut JsScope<'_>) {
    cx.global().vm().shrink_footprint();
}

enum Resolved {
    Found(BunString),
    /// The resolver's `ResolveMessage` for a specifier it could not resolve; not thrown yet.
    NotFound(JSValue),
}

fn do_resolve_with_args<const IS_FILE_PATH: bool>(
    ctx: &JSGlobalObject,
    specifier: &BunString,
    from: &BunString,
    mode: ResolveMode,
) -> JsResult<BunString> {
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
        decoded_specifier = bun_url::path_from_file_url(specifier);
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

        return Ok(Resolved::Found(BunString::clone_utf8(&arraylist)));
    }

    Ok(Resolved::Found(result_value))
}

pub(crate) fn resolve_sync(
    cx: &mut JsScope<'_>,
    module_id: Option<BunString>,
    parent: Option<BunString>,
    esm: bool,
) -> JsResult<BunString> {
    let global_this = cx.global();
    let Some(module_id) = module_id else {
        return Err(global_this.throw_invalid_arguments(format_args!("moduleId must be a string")));
    };
    let Some(parent) = parent else {
        return Err(global_this.throw_invalid_arguments(format_args!("parent must be a string")));
    };
    let mode = if esm {
        ResolveMode::Esm
    } else {
        ResolveMode::Require
    };
    do_resolve_with_args::<false>(global_this, &module_id, &parent, mode)
}

pub(crate) fn resolve(
    cx: &mut JsScope<'_>,
    module_id: Option<BunString>,
    parent: Option<BunString>,
    esm: bool,
) -> JsResult<JSValue> {
    let resolved = resolve_sync(cx, module_id, parent, esm)?;
    let global_object = cx.global();
    Ok(JSPromise::resolved_promise_value(
        global_object,
        resolved.into_js(global_object)?,
    ))
}

// HOST_EXPORT(Bun__resolveSync, c)
pub(crate) fn bun_resolve_sync(
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
        )?
        .into_js(global)
    })
}

// HOST_EXPORT(Bun__resolveSyncWithPaths, c)
/// # Safety
/// `paths_ptr` must be null or point to `paths_len` initialized `BunString`s
/// that remain valid for the duration of this call.
// FFI entry point exported via HOST_EXPORT and called only from C++
// (ImportMetaObject.cpp / NodeModuleModule.cpp), which upholds the contract
// above.
pub(crate) fn bun_resolve_sync_with_paths(
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
        )?
        .into_js(global)
    })
}

bun_output::declare_scope!(importMetaResolve, visible);

// HOST_EXPORT(Bun__resolveSyncWithStrings, c)
pub(crate) fn bun_resolve_sync_with_strings(
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
        )?
        .into_js(global)
    })
}

/// Resolves `specifier` relative to `source`. A specifier the resolver cannot resolve (the
/// `ResolveMessage` case, e.g. "Cannot find module") yields `undefined` instead of throwing;
/// everything else — an `onResolve` plugin throwing or returning an invalid result, a specifier
/// that is not a string — is thrown.
// HOST_EXPORT(Bun__resolveSyncWithSourceIfExists, c)
pub(crate) fn bun_resolve_sync_with_source_if_exists(
    global: &JSGlobalObject,
    specifier: JSValue,
    source: &BunString,
    is_esm: bool,
) -> JSValue {
    let Ok(specifier_str) = specifier.to_bun_string(global) else {
        return JSValue::ZERO;
    };
    jsc::to_js_host_call(global, || {
        match resolve_with_args::<true>(
            global,
            &specifier_str,
            source,
            ResolveMode::from_ffi_bools(is_esm, false),
        )? {
            Resolved::Found(value) => value.into_js(global),
            Resolved::NotFound(_) => Ok(JSValue::UNDEFINED),
        }
    })
}

pub(crate) fn index_of_line(buffer: &[u8], offset: f64) -> f64 {
    // The cast saturates: NaN and a negative offset are 0.
    let offset = offset as usize;
    // 0x0A never appears inside a multi-byte UTF-8 sequence.
    // SAFETY: readable. `index_of_char` asserts that the byte it found is still there, and another thread can write a shared buffer.
    match buffer.get(offset..).and_then(|rest| unsafe {
        bun_highway::index_of_char_raw(rest.as_ptr(), rest.len(), b'\n')
    }) {
        Some(i) => (offset + i) as f64,
        None => -1.0,
    }
}

pub(crate) fn serve(cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<JSValue> {
    let global_object = cx.global();
    // The server is the calling script's.
    let context = global_object.bun_vm().context_of_caller();
    let mut config = crate::server::ServerConfig::from_js(
        global_object,
        options.to_js(),
        crate::server::server_config::FromJSOptions {
            allow_bake_config: bun_core::FeatureFlags::bake(),
            may_start_development_server: true,
            is_fetch_required: true,
            previous_fetch: false,
            previous_routes: false,
        },
    )?;

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

    let vm = global_object.bun_vm().as_mut();

    // NOTE (layering): `HotMap` is a tagged union over the four
    // `NewServer` monomorphizations + sockets. `bun_jsc::rare_data::HotMapEntry`
    // is the erased `(tag: u8, ptr: *mut ())` lowering of that union; the tag
    // values for servers are pinned here to match `crate::server::AnyServerTag`
    // (= the runtime-side discriminant) so a HotMap entry produced by `serve`
    // is round-trippable through `serve` again on hot-reload.
    use crate::server::{AnyServer, AnyServerTag};
    use bun_jsc::JsCellRefExt as _;
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
                        let server: &$T = unsafe { &*entry.ptr.cast::<$T>() };
                        server.on_reload_from_zig(&mut config, global_object);
                        // Its handlers are the calling script's now, and so is the server: it goes
                        // with that script's context, not with the one that first listened.
                        server.abort_handle.leave();
                        server.context.set(context.id());
                        // SAFETY: heap-allocated; leaves its context in `stop_listening` / `deinit`.
                        unsafe { bun_jsc::AbortHandle::arm_owner(entry.ptr.cast::<$T>(), context) };
                        return Ok(server.js_value.try_get().unwrap_or(JSValue::UNDEFINED));
                    }};
                }
                match entry.tag {
                    t if t == AnyServerTag::HTTPServer as u8 => reload!(crate::api::HTTPServer),
                    t if t == AnyServerTag::DebugHTTPServer as u8 => {
                        reload!(crate::api::DebugHTTPServer)
                    }
                    t if t == AnyServerTag::DebugHTTPSServer as u8 => {
                        return bun_removable_features::removable_body!(TlsSockets, Abort, {
                            reload!(crate::api::DebugHTTPSServer)
                        });
                    }
                    t if t == AnyServerTag::HTTPSServer as u8 => {
                        return bun_removable_features::removable_body!(TlsSockets, Abort, {
                            reload!(crate::api::HTTPSServer)
                        });
                    }
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
            // SAFETY: `server` is the live heap-allocated server returned by `init`.
            let route_list_object = <$ServerType>::listen(server);
            if global_object.has_exception() {
                return Ok(JSValue::ZERO);
            }
            // SAFETY: `listen` frees the server only when it throws.
            let server_ref: &$ServerType = unsafe { &*server };
            let obj = <$ServerType>::ptr_to_js(server, global_object);
            if route_list_object != JSValue::ZERO {
                <$ServerType>::js_gc_route_list_set(obj, global_object, route_list_object);
            }
            // Mirror the handler callbacks into the wrapper's WriteBarrier
            // slots — the wrapper is the sole GC root for these; `ServerConfig`
            // / `Handler` only hold raw `JSValue` shadows for hot-path dispatch.
            // The async-context wrap is applied here (not in `from_js`) so the
            // freshly-allocated wrapper fn is rooted by the slot immediately.
            server_ref.config.with_mut(|config| {
                crate::server::wrap_handler_slot(
                    &mut config.on_request,
                    obj,
                    global_object,
                    <$ServerType>::js_gc_on_request_set,
                );
                crate::server::wrap_handler_slot(
                    &mut config.on_error,
                    obj,
                    global_object,
                    <$ServerType>::js_gc_on_error_set,
                );
                crate::server::wrap_handler_slot(
                    &mut config.on_node_http_request,
                    obj,
                    global_object,
                    <$ServerType>::js_gc_on_node_http_request_set,
                );
            });
            // Skip the 7-slot write when there's no websocket config: the
            // slots default ZERO so `write_ws_handler_slots`'s clear path
            // would be 7 wasted FFI calls.
            if server_ref.config.get().websocket.is_some() {
                server_ref.write_ws_handler_slots(obj, global_object);
            }
            server_ref
                .js_value
                .with_mut(|js_value| js_value.set_strong(obj, global_object));
            // Slots are rooted; release the scoped gcProtects and run the
            // "server just started" GC nudge split out of `listen()`.
            drop(_handler_pins);
            server_ref.gc_hint_after_listen();

            // SAFETY: `server` is heap-allocated and leaves its context in
            // `stop_listening` / `deinit`.
            unsafe {
                (*server).context.set(context.id());
                bun_jsc::AbortHandle::arm_owner(server, context)
            };

            // `init` moved `config` into the server (`mem::take`), so the
            // local `config` is defaulted from here on — read `allow_hot`
            // and `id` from the server's own config or the registration is
            // keyed on the wrong (empty) id.
            if server_ref.config.get().allow_hot {
                // SAFETY: same VM pointer; re-borrow after the earlier `vm` mut
                // borrow was released by the `hot_map()` arm above.
                if let Some(hot) = global_object.bun_vm().as_mut().hot_map() {
                    hot.insert_raw(
                        &server_ref.config.get().id,
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
        (true, true) => bun_removable_features::removable_body!(TlsSockets, Abort, {
            serve_with!(crate::api::DebugHTTPSServer, AnyServerTag::DebugHTTPSServer)
        }),
        (true, false) => serve_with!(crate::api::DebugHTTPServer, AnyServerTag::DebugHTTPServer),
        (false, true) => bun_removable_features::removable_body!(TlsSockets, Abort, {
            serve_with!(crate::api::HTTPSServer, AnyServerTag::HTTPSServer)
        }),
        (false, false) => serve_with!(crate::api::HTTPServer, AnyServerTag::HTTPServer),
    }
}

pub(crate) fn alloc_unsafe<'a>(
    heap: &JsHeap<'a>,
    size: u32,
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    heap.create_uninitialized_uint8_array(size as usize)
}

pub(crate) fn mmap(cx: &mut JsScope<'_>, path: &[u8], options: &MMapOptions) -> JsResult<JSValue> {
    let global_this = cx.global();

    #[cfg(windows)]
    {
        let _ = (path, options);
        return Err(global_this.throw_todo(b"mmapFile is not supported on Windows"));
    }

    #[cfg(not(windows))]
    {
        use core::ffi::c_void;

        if path.len() > MAX_PATH_BYTES {
            return Err(global_this.throw_invalid_arguments(format_args!("Path too long")));
        }
        node::types::Valid::path_null_bytes(path, global_this)?;
        let mut buf = bun_paths::path_buffer_pool::get();
        let buf_len = buf.len();
        let Some(joined) = bun_paths::resolve_path::join_abs_string_buf_checked::<
            bun_paths::resolve_path::platform::Auto,
        >(
            bun_core::working_directory_in_executable()
                .unwrap_or_else(|| bun_paths::fs::FileSystem::instance().top_level_dir()),
            &mut buf[..buf_len - 1],
            &[path],
        ) else {
            return Err(global_this.throw_invalid_arguments(format_args!("Path too long")));
        };
        let graph = bun_standalone_graph::Graph::get_ref()
            .filter(|_| bun_standalone_graph::is_bun_standalone_file_path(joined));
        let embedded = graph.and_then(|graph| graph.find_ref(joined));
        if graph.is_some_and(|graph| graph.find_dir(joined)) {
            use bun_jsc::SysErrorJsc as _;
            let err = sys::Error::from_code(bun_sys::E::EISDIR, sys::Tag::open).with_path(joined);
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        let path_len = joined.len();
        buf[path_len] = 0;

        // SAFETY: buf[path_len] == 0 written above
        let buf_z = bun_core::ZStr::from_buf(&buf[..], path_len);

        // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
        let flags = if options.shared {
            libc::MAP_SHARED
        } else {
            libc::MAP_PRIVATE
        };
        #[cfg(target_os = "linux")]
        let flags = if options.sync {
            libc::MAP_SHARED_VALIDATE | libc::MAP_SYNC
        } else {
            flags
        };

        let non_negative = |value: f64, name: &str| {
            usize::try_from(value as i64).map_err(|_| {
                global_this
                    .throw_invalid_arguments(format_args!("{name} must be a non-negative integer"))
            })
        };
        let map_size = options
            .size
            .map(|size| non_negative(size, "size"))
            .transpose()?;
        let offset = non_negative(options.offset, "offset")?;

        // An embedded file is read-only: the caller gets bytes of its own, as from a private mapping.
        if let Some(file) = embedded {
            let rest = file.utf8_contents().get(offset..).unwrap_or_default();
            let view = &rest[..map_size.map_or(rest.len(), |size| size.min(rest.len()))];
            if view.is_empty() {
                use bun_jsc::SysErrorJsc as _;
                let err = sys::Error::from_code(bun_sys::E::EINVAL, sys::Tag::mmap);
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
            return jsc::ArrayBuffer::create_uint8_array(global_this, view);
        }

        let (map, delta) = match bun_sys::mmap_file(buf_z, flags, map_size, offset) {
            Ok(result) => result,
            Err(err) => {
                use bun_jsc::SysErrorJsc as _;
                let err = node::fs::error_for_caller([None, None], err);
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

    if bun_removable_features::is_removed(bun_removable_features::Feature::Valkey) {
        let constructor = crate::valkey_jsc::js_valkey::js::get_constructor(global_this);
        return crate::removed_feature::stand_in_for_removed_instance(global_this, constructor);
    }

    // `Bun.redis` is the realm's: not owned (and closed at dispose()) by whichever
    // Bun.ModuleGraph reads the property first.
    let vm = global_this.bun_vm();
    let valkey = match JSValkeyClient::create_no_js_no_pubsub(
        &global_this.js_thread(vm.root_context()),
        JSValue::UNDEFINED,
        JSValue::UNDEFINED,
    ) {
        Ok(p) => p,
        Err(jsc::JsError::Thrown) => return JSValue::ZERO,
        Err(err) => {
            let _ =
                global_this.throw_error(crate::Error::from(err), "Failed to create Redis client");
            return JSValue::ZERO;
        }
    };

    let valkey = valkey.into_raw();
    let as_js = js_RedisClient::to_js(valkey, global_this);

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

fn get_is_standalone_executable(global_this: &JSGlobalObject, _: &JSObject) -> JSValue {
    JSValue::js_boolean(global_this.bun_vm().standalone_module_graph.is_some())
}

fn get_embedded_files(global_this: &JSGlobalObject, _: &JSObject) -> JsResult<JSValue> {
    use crate::webcore::blob::{Blob, BlobExt as _};
    use bun_standalone_graph::{File as GraphFile, Graph as StandaloneModuleGraph};
    let Some(graph) =
        StandaloneModuleGraph::get_ref().filter(|_| !bun_jsc::compiled_program::runs_in_place())
    else {
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

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
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
    extern "C" fn Bun__getEnvValueAt<'a>(
        global_object: &'a JSGlobalObject,
        i: usize,
        value: &mut core::mem::MaybeUninit<EncodedSlice<'a>>,
    ) {
        let env = global_object.bun_vm().env_loader();
        value.write(EncodedSlice::from_bytes(&env.map.map.values()[i].value));
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

    /// Sync a process.env write back to the native env map so that native
    /// consumers (e.g. fetch's proxy resolution via env.getHttpProxyFor)
    /// observe the updated value. Used by process.env's write and delete paths for proxy-related
    /// env vars (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY and lowercase variants).
    /// A `Dead` value removes the variable.
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

        // `delete process.env.X`
        if value.tag() == bun_core::Tag::Dead {
            env_map.remove(slot.key);
            return;
        }

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

#[allow(non_snake_case)]
pub(crate) mod JSZlib {
    use super::*;
    use bun_libdeflate_sys::libdeflate as bun_libdeflate;

    type BufferResult<'a> = bindgen::Result<'a, JsLocal<'a, BufferSource>>;

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

    enum Library {
        Zlib,
        Libdeflate,
    }

    impl Library {
        fn from_option<'a>(heap: &JsHeap<'a>, name: Option<&[u8]>) -> bindgen::Result<'a, Self> {
            match name {
                None | Some(b"" | b"zlib") => Ok(Library::Zlib),
                Some(b"libdeflate") => Ok(Library::Libdeflate),
                Some(_) => Err(heap.invalid_arguments(format_args!(
                    "Expected library to be one of 'zlib' or 'libdeflate'"
                ))),
            }
        }
    }

    fn init_error<'a>(heap: &JsHeap<'a>, err: zlib::ZlibError) -> bindgen::Error<'a> {
        match err {
            zlib::ZlibError::OutOfMemory => bun_alloc::AllocError.into(),
            zlib::ZlibError::InvalidArgument => {
                heap.error(format_args!("Zlib error: Invalid argument"))
            }
            err => heap.error(format_args!("{} Zlib error", <&'static str>::from(err))),
        }
    }

    fn read_error<'a>(
        heap: &JsHeap<'a>,
        err: zlib::ZlibError,
        message: Option<&[u8]>,
    ) -> bindgen::Error<'a> {
        if err == zlib::ZlibError::OutOfMemory {
            return bun_alloc::AllocError.into();
        }
        let message = message.unwrap_or(b"Zlib returned an error");
        heap.error(format_args!("{}", bstr::BStr::new(message)))
    }

    pub(crate) fn gzip_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
        options: &ZlibCompressionOptions<'a>,
    ) -> BufferResult<'a> {
        gzip_or_deflate_sync(heap, data, options, true)
    }

    pub(crate) fn inflate_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
        options: &ZlibDecompressionOptions<'a>,
    ) -> BufferResult<'a> {
        gunzip_or_inflate_sync(heap, data, options, false)
    }

    pub(crate) fn deflate_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
        options: &ZlibCompressionOptions<'a>,
    ) -> BufferResult<'a> {
        gzip_or_deflate_sync(heap, data, options, false)
    }

    pub(crate) fn gunzip_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
        options: &ZlibDecompressionOptions<'a>,
    ) -> BufferResult<'a> {
        gunzip_or_inflate_sync(heap, data, options, true)
    }

    fn gunzip_or_inflate_sync<'a>(
        heap: &JsHeap<'a>,
        compressed: &[u8],
        options: &ZlibDecompressionOptions<'a>,
        is_gzip: bool,
    ) -> BufferResult<'a> {
        let library = Library::from_option(heap, options.library)?;

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
            .map_err(|_| bun_alloc::AllocError)?;
        }

        match library {
            Library::Zlib => {
                let mut reader = zlib::ZlibReaderArrayList::init_with_options(
                    compressed,
                    &mut list,
                    zlib::Options {
                        window_bits: options
                            .window_bits
                            .map_or(if is_gzip { 31 } else { -15 }, |bits| bits as i32),
                        ..Default::default()
                    },
                )
                .map_err(|err| init_error(heap, err))?;

                if let Err(err) = reader.read_all(true) {
                    return Err(read_error(heap, err, reader.error_message()));
                }
                drop(reader);
                heap.create_uint8_array_from_box(list.into_boxed_slice())
            }
            Library::Libdeflate => {
                let Some(mut decompressor) = bun_libdeflate::OwnedDecompressor::new() else {
                    return Err(bun_alloc::AllocError.into());
                };
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };
                let max_output = ArrayBuffer::MAX_SIZE as usize;
                let result = decompressor
                    .decompress_to_vec_grow(compressed, &mut list, encoding, max_output)
                    .map_err(|_| bun_alloc::AllocError)?;
                match result.status {
                    bun_libdeflate::Status::Success if list.len() <= max_output => {}
                    bun_libdeflate::Status::Success | bun_libdeflate::Status::InsufficientSpace => {
                        return Err(heap.error_with_code(
                            jsc::ErrorCode::BUFFER_TOO_LARGE,
                            format_args!("Cannot create a Buffer larger than {max_output} bytes"),
                        ));
                    }
                    _ => {
                        return Err(heap.error(format_args!(
                            "libdeflate returned an error: {}",
                            libdeflate_status_str(result.status),
                        )));
                    }
                }
                heap.create_uint8_array_from_box(list.into_boxed_slice())
            }
        }
    }

    fn gzip_or_deflate_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
        options: &ZlibCompressionOptions<'a>,
        is_gzip: bool,
    ) -> BufferResult<'a> {
        let level = options.level.map_or(6, |level| level as i32);

        match Library::from_option(heap, options.library)? {
            Library::Zlib => {
                // `init` reserves `deflateBound` of the input.
                let mut list: Vec<u8> = Vec::new();

                let mut reader = zlib::ZlibCompressorArrayList::init(
                    data,
                    &mut list,
                    zlib::Options {
                        window_bits: 15,
                        gzip: is_gzip,
                        level,
                        mem_level: options.mem_level,
                        strategy: options.strategy,
                        ..Default::default()
                    },
                )
                .map_err(|err| init_error(heap, err))?;

                if let Err(err) = reader.read_all() {
                    return Err(read_error(heap, err, reader.error_message()));
                }
                drop(reader);
                heap.create_uint8_array_from_box(list.into_boxed_slice())
            }
            Library::Libdeflate => {
                if !(bun_libdeflate::MIN_COMPRESSION_LEVEL..=bun_libdeflate::MAX_COMPRESSION_LEVEL)
                    .contains(&level)
                {
                    return Err(heap.invalid_arguments(format_args!(
                        "Compression level must be between {} and {} for libdeflate",
                        bun_libdeflate::MIN_COMPRESSION_LEVEL,
                        bun_libdeflate::MAX_COMPRESSION_LEVEL,
                    )));
                }
                let Some(mut compressor) = bun_libdeflate::OwnedCompressor::new(level) else {
                    return Err(bun_alloc::AllocError.into());
                };
                let encoding = if is_gzip {
                    bun_libdeflate::Encoding::Gzip
                } else {
                    bun_libdeflate::Encoding::Deflate
                };

                let mut list: Vec<u8> = Vec::new();
                let result = compressor
                    .compress_to_vec(data, &mut list, encoding)
                    .map_err(|_| bun_alloc::AllocError)?;
                if result.status != bun_libdeflate::Status::Success {
                    return Err(heap.error(format_args!(
                        "libdeflate error: {}",
                        libdeflate_status_str(result.status),
                    )));
                }
                heap.create_uint8_array_from_box(list.into_boxed_slice())
            }
        }
    }
}

#[allow(non_snake_case)]
pub(crate) mod JSZstd {
    use super::*;
    use bun_jsc::bindgen::IntoError as _;

    fn level_of<'a>(
        heap: &JsHeap<'a>,
        options: &ZstdCompressionOptions,
    ) -> bindgen::Result<'a, i32> {
        let level = options.level.map_or(3, |level| level as i32);
        if !(1..=22).contains(&level) {
            return Err(
                heap.invalid_arguments(format_args!("Compression level must be between 1 and 22"))
            );
        }
        Ok(level)
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

    /// The message of the `ERR_ZSTD`.
    impl core::fmt::Display for Failure {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            match self {
                Failure::OutOfMemory => f.write_str("Out of memory"),
                Failure::Compression(message) => write!(f, "{}", bstr::BStr::new(message)),
                Failure::Decompression(err) => write!(f, "Decompression failed: {err}"),
            }
        }
    }

    impl<'a> bindgen::IntoError<'a> for Failure {
        #[cold]
        fn into_error(self, heap: &JsHeap<'a>) -> bindgen::Error<'a> {
            match self {
                Failure::OutOfMemory => bun_alloc::AllocError.into(),
                failure => heap.error_with_code(jsc::ErrorCode::ZSTD, format_args!("{failure}")),
            }
        }
    }

    impl Failure {
        fn to_js(self, global_this: &JSGlobalObject) -> JSValue {
            match self {
                Failure::OutOfMemory => global_this.create_out_of_memory_error(),
                failure => global_this
                    .err(jsc::ErrorCode::ZSTD, format_args!("{failure}"))
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

    pub(crate) fn compress_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
        options: &ZstdCompressionOptions,
    ) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
        let level = level_of(heap, options)?;
        let output = compress_to_box(data, level).map_err(|failure| failure.into_error(heap))?;
        heap.create_buffer_from_box(output)
    }

    pub(crate) fn decompress_sync<'a>(
        heap: &JsHeap<'a>,
        data: &[u8],
    ) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
        let output = decompress_to_box(data).map_err(|failure| failure.into_error(heap))?;
        heap.create_buffer_from_box(output)
    }

    // --- Async versions ---

    /// `Bun.zstdCompress` / `Bun.zstdDecompress` off the JS thread.
    pub(crate) struct ZstdJob {
        pub buffer: PinnedBytes,
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
            let input = &this.buffer[..];

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

    fn schedule<'a>(
        cx: &mut JsScope<'a>,
        buffer: PinnedBytes,
        is_compress: bool,
        level: i32,
    ) -> JSValue {
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let promise_value = promise.value();
        jsc::Job::<ZstdJob>::schedule(
            &cx.js_thread(),
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

    pub(crate) fn compress<'a>(
        cx: &mut JsScope<'a>,
        data: PinnedBytes,
        options: &ZstdCompressionOptions,
    ) -> bindgen::Result<'a, JSValue> {
        let level = level_of(&cx.heap, options)?;
        Ok(schedule(cx, data, true, level))
    }

    pub(crate) fn decompress(cx: &mut JsScope<'_>, data: PinnedBytes) -> JSValue {
        schedule(cx, data, false, 0)
    }
}

// NOTE: symbols are linked via the `#[unsafe(no_mangle)]` exports above.
// Referenced: bun_jsc::btjs::dump_btjs_trace.

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
pub(crate) fn create_bun_stdin(global_this: &JSGlobalObject) -> JSValue {
    stdio_stores::stdin(global_this)
}

// HOST_EXPORT(BunObject__createBunStderr)
pub(crate) fn create_bun_stderr(global_this: &JSGlobalObject) -> JSValue {
    stdio_stores::stderr(global_this)
}

// HOST_EXPORT(BunObject__createBunStdout)
pub(crate) fn create_bun_stdout(global_this: &JSGlobalObject) -> JSValue {
    stdio_stores::stdout(global_this)
}
