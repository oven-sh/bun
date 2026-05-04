use core::fmt;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_collections::{StringArrayHashMap, StringSet};
use bun_core::Output;
use bun_jsc::RuntimeTranspilerCache;
// TODO(port): confirm crate path for `bun.schema` (likely `bun_schema` or `bun_interchange::schema`)
use bun_schema as schema;
use bun_schema::api;
use bun_str::strings;
use bun_wyhash::{Wyhash, Wyhash11};

use crate::ast::{Expr, Ref};

fn embed_debug_fallback(msg: &'static [u8], code: &'static [u8]) -> &'static [u8] {
    static HAS_PRINTED: AtomicBool = AtomicBool::new(false);
    if !HAS_PRINTED.swap(true, Ordering::Relaxed) {
        // TODO(port): exact `bun.Output.debug` mapping in bun_core
        Output::debug(msg);
    }
    code
}

// ───────────────────────────── Fallback ─────────────────────────────

pub struct Fallback;

impl Fallback {
    pub const HTML_TEMPLATE: &'static [u8] = include_bytes!("../fallback.html");
    pub const HTML_BACKEND_TEMPLATE: &'static [u8] = include_bytes!("../fallback-backend.html");

    #[inline]
    pub fn error_js() -> &'static [u8] {
        // TODO(port): `Environment.codegen_embed` build option → cfg feature
        // NOTE: must use `#[cfg]` (not `if cfg!()`) so `include_bytes!`/`env!` in the
        // disabled branch are not evaluated when the file/env-var is absent.
        #[cfg(feature = "codegen_embed")]
        {
            return include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/bun-error/index.js"));
        }
        #[cfg(not(feature = "codegen_embed"))]
        {
            return bun_core::runtime_embed_file(bun_core::EmbedKind::Codegen, "bun-error/index.js");
        }
    }

    #[inline]
    pub fn error_css() -> &'static [u8] {
        #[cfg(feature = "codegen_embed")]
        {
            return include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/bun-error/bun-error.css"));
        }
        #[cfg(not(feature = "codegen_embed"))]
        {
            return bun_core::runtime_embed_file(bun_core::EmbedKind::Codegen, "bun-error/bun-error.css");
        }
    }

    #[inline]
    pub fn fallback_decoder_js() -> &'static [u8] {
        #[cfg(feature = "codegen_embed")]
        {
            return include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/fallback-decoder.js"));
        }
        #[cfg(not(feature = "codegen_embed"))]
        {
            return bun_core::runtime_embed_file(bun_core::EmbedKind::Codegen, "fallback-decoder.js");
        }
    }

    // TODO(port): `@import("build_options").fallback_html_version` — wire via build.rs
    pub const VERSION_HASH: &'static str = env!("BUN_FALLBACK_HTML_VERSION");

    pub fn version_hash() -> u32 {
        static CACHED: AtomicU32 = AtomicU32::new(0);
        let v = CACHED.load(Ordering::Relaxed);
        if v != 0 {
            return v;
        }
        let parsed =
            u64::from_str_radix(Self::version(), 16).expect("unreachable") as u32; // @truncate
        CACHED.store(parsed, Ordering::Relaxed);
        parsed
    }

    pub fn version() -> &'static str {
        Self::VERSION_HASH
    }

    // TODO(port): narrow error set
    pub fn render(
        msg: &api::FallbackMessageContainer,
        preload: &[u8],
        entry_point: &[u8],
        writer: &mut impl bun_io::Write,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used `writer.print(HTMLTemplate, struct{...})` with named-field
        // substitution. Rust's `write!` requires a literal format string and positional/
        // named args known at compile time. Phase B: either pre-process fallback.html into
        // a `format_args!`-compatible literal at build time, or implement a tiny runtime
        // template substitutor. For now, mirror argument construction only.
        let _blob = Base64FallbackMessage { msg };
        let _preload = preload;
        let _fallback = Self::fallback_decoder_js();
        let _entry_point = entry_point;
        let _ = writer;
        // TODO(port): emit HTML_TEMPLATE with substitutions
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn render_backend(
        msg: &api::FallbackMessageContainer,
        writer: &mut impl bun_io::Write,
    ) -> Result<(), bun_core::Error> {
        let _blob = Base64FallbackMessage { msg };
        let _bun_error_css = Self::error_css();
        let _bun_error = Self::error_js();
        let _bun_error_page_css: &[u8] = b"";
        let _fallback = Self::fallback_decoder_js();
        let _ = writer;
        // TODO(port): emit HTML_BACKEND_TEMPLATE with substitutions (see render())
        Ok(())
    }
}

/// Zig: `Fallback.Base64FallbackMessage`
pub struct Base64FallbackMessage<'a> {
    pub msg: &'a api::FallbackMessageContainer,
    // Zig had `allocator: std.mem.Allocator` — dropped (global mimalloc)
}

impl fmt::Display for Base64FallbackMessage<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut bb: Vec<u8> = Vec::new();
        // TODO(port): exact `schema::Writer` API over a `Vec<u8>` sink
        let mut encoder = schema::Writer::new(&mut bb);
        let _ = self.msg.encode(&mut encoder); // catch {}
        let _ = base64_encoder::encode(&bb, f); // catch {}
        Ok(())
    }
}

/// Zig: `Fallback.Base64FallbackMessage.Base64Encoder`
pub mod base64_encoder {
    use core::fmt;

    /// `std.base64.standard_alphabet_chars`
    const ALPHABET_CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn encode(source: &[u8], writer: &mut impl fmt::Write) -> fmt::Result {
        // Zig used u12/u4/u6 — Rust widens to u16/u8 with masking.
        let mut acc: u16 = 0;
        let mut acc_len: u8 = 0;
        for &v in source {
            acc = (acc << 8) + u16::from(v);
            acc_len += 8;
            while acc_len >= 6 {
                acc_len -= 6;
                let idx = ((acc >> acc_len) & 0x3F) as usize; // @truncate to u6
                writer.write_char(ALPHABET_CHARS[idx] as char)?;
            }
        }
        if acc_len > 0 {
            let idx = ((acc << (6 - acc_len)) & 0x3F) as usize; // @truncate to u6
            writer.write_char(ALPHABET_CHARS[idx] as char)?;
        }
        Ok(())
    }
}

// ───────────────────────────── Runtime ─────────────────────────────

pub struct Runtime;

impl Runtime {
    pub fn source_code() -> &'static [u8] {
        #[cfg(feature = "codegen_embed")]
        {
            return include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/runtime.out.js"));
        }
        #[cfg(not(feature = "codegen_embed"))]
        {
            return bun_core::runtime_embed_file(bun_core::EmbedKind::Codegen, "runtime.out.js");
        }
    }

    pub fn version_hash() -> u32 {
        let hash = Wyhash11::hash(0, Self::source_code());
        hash as u32 // @truncate
    }
}

// ─────────────────────────── Runtime.Features ───────────────────────────

pub static EMPTY_BUNDLER_FEATURE_FLAGS: StringSet = StringSet::EMPTY;
// TODO(port): `bun.StringSet.initComptime()` — needs a `const`-constructible empty StringSet.

pub struct Features<'a> {
    /// Enable the React Fast Refresh transform. What this does exactly
    /// is documented in js_parser, search for `const ReactRefresh`
    pub react_fast_refresh: bool,
    /// `hot_module_reloading` is specific to if we are using bun.bake.DevServer.
    /// It can be enabled on the command line with --format=internal_bake_dev
    ///
    /// Standalone usage of this flag / usage of this flag
    /// without '--format' set is an unsupported use case.
    pub hot_module_reloading: bool,
    /// Control how the parser handles server components and server functions.
    pub server_components: ServerComponentsMode,

    pub is_macro_runtime: bool,
    pub top_level_await: bool,
    pub auto_import_jsx: bool,
    pub allow_runtime: bool,
    pub inlining: bool,

    pub inject_jest_globals: bool,

    pub no_macros: bool,

    pub commonjs_named_exports: bool,

    pub minify_syntax: bool,
    pub minify_identifiers: bool,
    /// Preserve function/class names during minification (CLI: --keep-names)
    pub minify_keep_names: bool,
    pub minify_whitespace: bool,
    pub dead_code_elimination: bool,

    pub set_breakpoint_on_first_line: bool,

    pub trim_unused_imports: bool,

    /// Allow runtime usage of require(), converting `require` into `__require`
    pub auto_polyfill_require: bool,

    pub replace_exports: ReplaceableExportMap,

    /// Scan for '// @bun' at the top of this file, halting a parse if it is
    /// seen. This is used in `bun run` after a `bun build --target=bun`,
    /// and you know the contents is already correct.
    ///
    /// This comment must never be used manually.
    pub dont_bundle_twice: bool,

    /// This is a list of packages which even when require() is used, we will
    /// instead convert to ESM import statements.
    ///
    /// This is not normally a safe transformation.
    ///
    /// So we have a list of packages which we know are safe to do this with.
    pub unwrap_commonjs_packages: &'a [&'a [u8]],

    pub commonjs_at_runtime: bool,
    pub unwrap_commonjs_to_esm: bool,

    pub emit_decorator_metadata: bool,
    pub standard_decorators: bool,

    /// If true and if the source is transpiled as cjs, don't wrap the module.
    /// This is used for `--print` entry points so we can get the result.
    pub remove_cjs_module_wrapper: bool,

    pub runtime_transpiler_cache: Option<&'a mut RuntimeTranspilerCache>,

    // TODO: make this a bitset of all unsupported features
    pub lower_using: bool,

    /// Feature flags for dead-code elimination via `import { feature } from "bun:bundle"`
    /// When `feature("FLAG_NAME")` is called, it returns true if FLAG_NAME is in this set.
    pub bundler_feature_flags: &'a StringSet,

    /// REPL mode: transforms code for interactive evaluation
    /// - Wraps lone object literals `{...}` in parentheses
    /// - Hoists variable declarations for REPL persistence
    /// - Wraps last expression in { value: expr } for result capture
    /// - Assigns functions to context for persistence
    pub repl_mode: bool,
}

impl Default for Features<'_> {
    fn default() -> Self {
        Self {
            react_fast_refresh: false,
            hot_module_reloading: false,
            server_components: ServerComponentsMode::None,
            is_macro_runtime: false,
            top_level_await: false,
            auto_import_jsx: false,
            allow_runtime: true,
            inlining: false,
            inject_jest_globals: false,
            no_macros: false,
            commonjs_named_exports: true,
            minify_syntax: false,
            minify_identifiers: false,
            minify_keep_names: false,
            minify_whitespace: false,
            dead_code_elimination: true,
            set_breakpoint_on_first_line: false,
            trim_unused_imports: false,
            auto_polyfill_require: false,
            replace_exports: ReplaceableExportMap::default(),
            dont_bundle_twice: false,
            unwrap_commonjs_packages: &[],
            commonjs_at_runtime: false,
            unwrap_commonjs_to_esm: false,
            emit_decorator_metadata: false,
            standard_decorators: false,
            remove_cjs_module_wrapper: false,
            runtime_transpiler_cache: None,
            lower_using: true,
            bundler_feature_flags: &EMPTY_BUNDLER_FEATURE_FLAGS,
            repl_mode: false,
        }
    }
}

impl Features<'_> {
    /// Initialize bundler feature flags for dead-code elimination via `import { feature } from "bun:bundle"`.
    /// Returns a pointer to a StringSet containing the enabled flags, or the empty set if no flags are provided.
    /// Keys are kept sorted so iteration order is deterministic (for RuntimeTranspilerCache hashing).
    pub fn init_bundler_feature_flags(feature_flags: &[&[u8]]) -> *const StringSet {
        // TODO(port): caller (bun_bundler::options / BundleOptions) owns/frees this —
        // Zig returns `*const bun.StringSet` heap-allocated via `allocator.create`, and
        // the caller frees it. Do not leak; non-empty path uses Box::into_raw so the
        // caller can `Box::from_raw` on teardown. Empty path returns the static.
        if feature_flags.is_empty() {
            return &EMPTY_BUNDLER_FEATURE_FLAGS;
        }

        let mut set = StringSet::new();
        for flag in feature_flags {
            set.insert(flag);
        }
        // PORT NOTE: reshaped for borrowck — Zig sorted via `set.map.sort` with a
        // comparator closure that borrowed `set.map.keys()`. Here we sort the
        // backing ArrayHashMap by key bytes directly.
        // TODO(port): exact API on bun_collections::StringSet for in-place key sort
        set.sort_keys_by(|a, b| a.cmp(b));
        Box::into_raw(Box::new(set))
    }

    // Zig: `hash_fields_for_runtime_transpiler` — a comptime tuple of field-name enum
    // literals iterated with `inline for` + `@field`. Rust has no field reflection;
    // expanded by hand below. Keep this list in sync with the Zig tuple.
    pub fn hash_for_runtime_transpiler(&self, hasher: &mut Wyhash) {
        debug_assert!(self.runtime_transpiler_cache.is_some());

        let bools: [bool; 17] = [
            self.top_level_await,
            self.auto_import_jsx,
            self.allow_runtime,
            self.inlining,
            self.commonjs_named_exports,
            self.minify_syntax,
            self.minify_identifiers,
            self.minify_keep_names,
            self.dead_code_elimination,
            self.set_breakpoint_on_first_line,
            self.trim_unused_imports,
            self.dont_bundle_twice,
            self.commonjs_at_runtime,
            self.emit_decorator_metadata,
            self.standard_decorators,
            self.lower_using,
            self.repl_mode,
            // note that we do not include .inject_jest_globals, as we bail out of the cache entirely if this is true
        ];

        // SAFETY: `[bool; N]` is N bytes of 0x00/0x01; matches Zig `std.mem.asBytes(&bools)`.
        hasher.update(unsafe {
            core::slice::from_raw_parts(bools.as_ptr().cast::<u8>(), bools.len())
        });

        // Hash --feature flags. These directly affect transpiled output via
        // feature("NAME") replacement in visitExpr.zig. When empty, we add
        // nothing to the hash so existing cache entries remain valid.
        // Keys are sorted in init_bundler_feature_flags so flag order on the CLI doesn't matter.
        for flag in self.bundler_feature_flags.keys() {
            hasher.update(flag);
            hasher.update(b"\x00");
        }
    }

    pub fn should_unwrap_require(&self, package_name: &[u8]) -> bool {
        !package_name.is_empty()
            && strings::index_equal_any(self.unwrap_commonjs_packages, package_name).is_some()
    }
}

/// Zig: `Runtime.Features.ReplaceableExport`
pub enum ReplaceableExport {
    Delete,
    Replace(Expr),
    Inject { name: Box<[u8]>, value: Expr },
    // TODO(port): `name` was `string` (= []const u8). Ownership unclear; using Box<[u8]>.
}

/// Zig: `bun.StringArrayHashMapUnmanaged(ReplaceableExport)`
pub type ReplaceableExportMap = StringArrayHashMap<ReplaceableExport>;

/// Zig: `Runtime.Features.ServerComponentsMode`
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ServerComponentsMode {
    /// Server components is disabled, strings "use client" and "use server" mean nothing.
    #[default]
    None,
    /// This is a server-side file outside of the SSR graph, but not a "use server" file.
    /// - Handle functions with "use server", creating secret exports for them.
    WrapAnonServerFunctions,
    /// This is a "use client" file on the server, and separate_ssr_graph is off.
    /// - Wrap all exports in a call to `registerClientReference`
    /// - Ban "use server" functions???
    WrapExportsForClientReference,
    /// This is a "use server" file on the server
    /// - Wrap all exports in a call to `registerServerReference`
    /// - Ban "use server" functions, since this directive is already applied.
    WrapExportsForServerReference,
    /// This is a client side file.
    /// - Ban "use server" functions since it is on the client-side
    ClientSide,
}

impl ServerComponentsMode {
    pub fn is_server_side(self) -> bool {
        matches!(
            self,
            Self::WrapExportsForServerReference | Self::WrapAnonServerFunctions
        )
    }

    pub fn wraps_exports(self) -> bool {
        matches!(
            self,
            Self::WrapExportsForClientReference | Self::WrapExportsForServerReference
        )
    }
}

// ─────────────────────────── Runtime.Names ───────────────────────────

pub struct Names;
impl Names {
    pub const ACTIVATE_FUNCTION: &'static str = "activate";
}

// ─────────────────────────── Runtime.Imports ───────────────────────────

// If you change this, remember to update "runtime.js"
#[allow(non_snake_case)]
#[derive(Default)]
pub struct Imports {
    pub __name: Option<Ref>,
    pub __require: Option<Ref>,
    pub __export: Option<Ref>,
    pub __reExport: Option<Ref>,
    pub __exportValue: Option<Ref>,
    pub __exportDefault: Option<Ref>,
    // __refreshRuntime: ?GeneratedSymbol = null,
    // __refreshSig: ?GeneratedSymbol = null, // $RefreshSig$
    pub __merge: Option<Ref>,
    pub __legacyDecorateClassTS: Option<Ref>,
    pub __legacyDecorateParamTS: Option<Ref>,
    pub __legacyMetadataTS: Option<Ref>,
    pub __publicField: Option<Ref>,
    pub __privateIn: Option<Ref>,
    pub __privateGet: Option<Ref>,
    pub __privateAdd: Option<Ref>,
    pub __privateSet: Option<Ref>,
    pub __privateMethod: Option<Ref>,
    pub __decoratorStart: Option<Ref>,
    pub __decoratorMetadata: Option<Ref>,
    pub __runInitializers: Option<Ref>,
    pub __decorateElement: Option<Ref>,
    /// Zig field name: `@"$$typeof"` (not a valid Rust identifier).
    pub dollar_dollar_typeof: Option<Ref>,
    pub __using: Option<Ref>,
    pub __callDispose: Option<Ref>,
    pub __jsonParse: Option<Ref>,
    pub __promiseAll: Option<Ref>,
}

impl Imports {
    pub const ALL: [&'static str; 25] = [
        "__name",
        "__require",
        "__export",
        "__reExport",
        "__exportValue",
        "__exportDefault",
        "__merge",
        "__legacyDecorateClassTS",
        "__legacyDecorateParamTS",
        "__legacyMetadataTS",
        "__publicField",
        "__privateIn",
        "__privateGet",
        "__privateAdd",
        "__privateSet",
        "__privateMethod",
        "__decoratorStart",
        "__decoratorMetadata",
        "__runInitializers",
        "__decorateElement",
        "$$typeof",
        "__using",
        "__callDispose",
        "__jsonParse",
        "__promiseAll",
    ];

    /// Zig computed this at comptime via `std.sort.pdq`. Rust stable cannot sort in
    /// `const`; precomputed here. Phase B: add a `#[test]` that re-derives and asserts.
    // TODO(port): verify ALL_SORTED / ALL_SORTED_INDEX match Zig comptime output
    const ALL_SORTED: [&'static str; 25] = [
        "$$typeof",
        "__callDispose",
        "__decorateElement",
        "__decoratorMetadata",
        "__decoratorStart",
        "__export",
        "__exportDefault",
        "__exportValue",
        "__jsonParse",
        "__legacyDecorateClassTS",
        "__legacyDecorateParamTS",
        "__legacyMetadataTS",
        "__merge",
        "__name",
        "__privateAdd",
        "__privateGet",
        "__privateIn",
        "__privateMethod",
        "__privateSet",
        "__promiseAll",
        "__publicField",
        "__reExport",
        "__require",
        "__runInitializers",
        "__using",
    ];

    /// When generating the list of runtime imports, we sort it for determinism.
    /// This is a lookup table so we don't need to resort the strings each time
    pub const ALL_SORTED_INDEX: [usize; 25] = [
        13, // __name
        22, // __require
        5,  // __export
        21, // __reExport
        7,  // __exportValue
        6,  // __exportDefault
        12, // __merge
        9,  // __legacyDecorateClassTS
        10, // __legacyDecorateParamTS
        11, // __legacyMetadataTS
        20, // __publicField
        16, // __privateIn
        15, // __privateGet
        14, // __privateAdd
        18, // __privateSet
        17, // __privateMethod
        4,  // __decoratorStart
        3,  // __decoratorMetadata
        23, // __runInitializers
        2,  // __decorateElement
        0,  // $$typeof
        24, // __using
        1,  // __callDispose
        8,  // __jsonParse
        19, // __promiseAll
    ];

    pub const NAME: &'static str = "bun:wrap";
    pub const ALT_NAME: &'static str = "bun:wrap";

    /// Index → field. Expansion of Zig `@field(this, all[i])`.
    #[inline]
    fn field(&self, i: usize) -> Option<Ref> {
        match i {
            0 => self.__name,
            1 => self.__require,
            2 => self.__export,
            3 => self.__reExport,
            4 => self.__exportValue,
            5 => self.__exportDefault,
            6 => self.__merge,
            7 => self.__legacyDecorateClassTS,
            8 => self.__legacyDecorateParamTS,
            9 => self.__legacyMetadataTS,
            10 => self.__publicField,
            11 => self.__privateIn,
            12 => self.__privateGet,
            13 => self.__privateAdd,
            14 => self.__privateSet,
            15 => self.__privateMethod,
            16 => self.__decoratorStart,
            17 => self.__decoratorMetadata,
            18 => self.__runInitializers,
            19 => self.__decorateElement,
            20 => self.dollar_dollar_typeof,
            21 => self.__using,
            22 => self.__callDispose,
            23 => self.__jsonParse,
            24 => self.__promiseAll,
            _ => None,
        }
    }

    #[inline]
    fn field_mut(&mut self, i: usize) -> Option<&mut Option<Ref>> {
        match i {
            0 => Some(&mut self.__name),
            1 => Some(&mut self.__require),
            2 => Some(&mut self.__export),
            3 => Some(&mut self.__reExport),
            4 => Some(&mut self.__exportValue),
            5 => Some(&mut self.__exportDefault),
            6 => Some(&mut self.__merge),
            7 => Some(&mut self.__legacyDecorateClassTS),
            8 => Some(&mut self.__legacyDecorateParamTS),
            9 => Some(&mut self.__legacyMetadataTS),
            10 => Some(&mut self.__publicField),
            11 => Some(&mut self.__privateIn),
            12 => Some(&mut self.__privateGet),
            13 => Some(&mut self.__privateAdd),
            14 => Some(&mut self.__privateSet),
            15 => Some(&mut self.__privateMethod),
            16 => Some(&mut self.__decoratorStart),
            17 => Some(&mut self.__decoratorMetadata),
            18 => Some(&mut self.__runInitializers),
            19 => Some(&mut self.__decorateElement),
            20 => Some(&mut self.dollar_dollar_typeof),
            21 => Some(&mut self.__using),
            22 => Some(&mut self.__callDispose),
            23 => Some(&mut self.__jsonParse),
            24 => Some(&mut self.__promiseAll),
            _ => None,
        }
    }

    pub fn iter(&self) -> ImportsIterator<'_> {
        ImportsIterator {
            i: 0,
            runtime_imports: self,
        }
    }

    /// Zig: `contains(imports, comptime key: string)`.
    // TODO(port): comptime-string key — Rust callers should access the field directly
    // (`imports.__foo.is_some()`). Runtime fallback provided for parity.
    pub fn contains(&self, key: &str) -> bool {
        Self::ALL
            .iter()
            .position(|&k| k == key)
            .and_then(|i| self.field(i))
            .is_some()
    }

    pub fn has_any(&self) -> bool {
        for i in 0..Self::ALL.len() {
            if self.field(i).is_some() {
                return true;
            }
        }
        false
    }

    /// Zig: `put(imports, comptime key: string, ref: Ref)`.
    // TODO(port): comptime-string key — Rust callers should assign the field directly.
    pub fn put(&mut self, key: &str, ref_: Ref) {
        if let Some(i) = Self::ALL.iter().position(|&k| k == key) {
            if let Some(slot) = self.field_mut(i) {
                *slot = Some(ref_);
            }
        }
    }

    /// Zig: `at(imports, comptime key: string) ?Ref`.
    // TODO(port): comptime-string key — Rust callers should read the field directly.
    pub fn at(&self, key: &str) -> Option<Ref> {
        Self::ALL
            .iter()
            .position(|&k| k == key)
            .and_then(|i| self.field(i))
    }

    /// Zig: `get(imports, key: anytype) ?Ref` where `key` is a runtime index.
    pub fn get(&self, key: usize) -> Option<Ref> {
        if key < Self::ALL.len() {
            self.field(key)
        } else {
            None
        }
    }

    pub fn count(&self) -> usize {
        let mut n: usize = 0;
        for i in 0..Self::ALL.len() {
            if self.field(i).is_some() {
                n += 1;
            }
        }
        n
    }
}

/// Zig: `Runtime.Imports.Iterator`
pub struct ImportsIterator<'a> {
    pub i: usize,
    pub runtime_imports: &'a Imports,
}

#[derive(Clone, Copy)]
pub struct ImportsIteratorEntry {
    pub key: u16,
    pub value: Ref,
}

impl ImportsIterator<'_> {
    pub fn next(&mut self) -> Option<ImportsIteratorEntry> {
        while self.i < Imports::ALL.len() {
            let t = self.i;
            self.i += 1; // Zig: `defer this.i += 1;`
            if let Some(val) = self.runtime_imports.field(t) {
                return Some(ImportsIteratorEntry {
                    key: u16::try_from(t).unwrap(),
                    value: val,
                });
            }
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/runtime.zig (534 lines)
//   confidence: medium
//   todos:      18
//   notes:      render()/render_backend() template substitution + codegen_embed/build_options wiring deferred; ALL_SORTED hand-computed (add test); comptime-string-key Imports accessors became runtime lookups; init_bundler_feature_flags returns *const (caller-owned).
// ──────────────────────────────────────────────────────────────────────────
