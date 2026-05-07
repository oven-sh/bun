// CYCLEBREAK: bun_bundler::cache → JsonCache vtable (see below).
// CYCLEBREAK: bun_bundler::options::jsx::Pragma → local structural def (see `options` mod).
use bun_collections::VecExt;
use bun_collections::ArrayHashMap;
use bun_interchange::json_parser;
use bun_js_parser as js_ast;
use bun_js_parser::lexer as js_lexer;
use bun_logger as logger;
use bun_string::strings;
use enumset::{EnumSet, EnumSetType};

// CYCLEBREAK: `bun_bundler::options::jsx::Pragma` is TYPE_ONLY but lives in a
// higher-tier crate. Per CYCLEBREAK.md the type def belongs in a lower tier;
// until the move-down lands, the resolver carries the structural definition it
// needs (the five fields read/written by `merge_jsx` + `parse`). bun_bundler
// re-exports this on its side once the move-in pass runs.
// TODO(b0): bun_bundler::options::jsx::Pragma arrives from move-in (or moves to bun_options_types).
pub mod options {
    pub mod jsx {
        /// Port of `options.JSX.Runtime` (= `api.JsxRuntime`).
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
        pub enum Runtime {
            #[default]
            Automatic = 0,
            Classic = 1,
            Solid = 2,
        }

        /// Port of `options.JSX.ImportSource`.
        #[derive(Clone)]
        pub struct ImportSource {
            pub development: Box<[u8]>,
            pub production: Box<[u8]>,
        }

        impl Default for ImportSource {
            fn default() -> Self {
                ImportSource {
                    development: Box::from(b"react/jsx-dev-runtime".as_slice()),
                    production: Box::from(b"react/jsx-runtime".as_slice()),
                }
            }
        }

        /// Port of `options.JSX.Pragma` — fields the resolver reads/writes.
        #[derive(Clone)]
        pub struct Pragma {
            pub factory: Vec<Box<[u8]>>,
            pub fragment: Vec<Box<[u8]>>,
            pub runtime: Runtime,
            pub import_source: ImportSource,
            /// Facilitates automatic JSX importing
            /// Set on a per file basis like this:
            /// /** @jsxImportSource @emotion/core */
            pub package_name: Box<[u8]>,
            pub development: bool,
        }

        impl Default for Pragma {
            fn default() -> Self {
                Pragma {
                    factory: Vec::new(),
                    fragment: Vec::new(),
                    runtime: Runtime::default(),
                    import_source: ImportSource::default(),
                    package_name: Box::from(b"react".as_slice()),
                    development: true,
                }
            }
        }

        impl Pragma {
            /// Port of `options.JSX.Pragma.setImportSource` (options.zig:1254).
            pub fn set_import_source(&mut self) {
                let _ = bun_string::strings::concat_if_needed(
                    &mut self.import_source.development,
                    &[&self.package_name, b"/jsx-dev-runtime"],
                    &[b"react/jsx-dev-runtime"],
                );
                let _ = bun_string::strings::concat_if_needed(
                    &mut self.import_source.production,
                    &[&self.package_name, b"/jsx-runtime"],
                    &[b"react/jsx-runtime"],
                );
            }
        }

        /// Port of `options.JSX.RuntimeDevelopmentPair`.
        #[derive(Clone, Copy)]
        pub struct RuntimeDevelopmentPair {
            pub runtime: Runtime,
            pub development: Option<bool>,
        }

        /// Port of `options.JSX.RuntimeMap` (`bun.ComptimeStringMap`, options.zig:1179).
        pub static RUNTIME_MAP: phf::Map<&'static [u8], RuntimeDevelopmentPair> = phf::phf_map! {
            b"classic" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
            b"automatic" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
            b"react" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
            b"react-jsx" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
            b"react-jsxdev" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
        };
    }
}

/// Port of the anonymous `enum { json, jsonc }` parameter to
/// `cache::Json.parseJSON` (cache.zig:296).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JsonMode {
    Json,
    Jsonc,
}

/// CYCLEBREAK (§Dispatch, cold-path manual vtable): replaces the
/// `bun_bundler::cache::Json` direct dep so `TSConfigJSON::parse` does not name
/// a higher-tier type. `bun_bundler` provides a static `JsonCacheVTable` that
/// forwards to `cache::Json::{parseJSON, parsePackageJSON, parseTSConfig}`; the
/// resolver only sees `(*mut (), &vtable)`.
///
/// All three slots mirror cache.zig:296-313 so the resolver can call any of
/// them without naming `bun_bundler` / `bun_json` directly.
pub struct JsonCacheVTable {
    /// Returns `Ok(Some(expr))` on a successful parse, `Ok(None)` when the
    /// source produced no AST (empty/comments-only), `Err` on hard failure.
    pub parse_tsconfig: unsafe fn(
        cache: *mut (),
        log: &mut logger::Log,
        source: &logger::Source,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error>,
    /// Port of `cache::Json.parsePackageJSON` (cache.zig:307).
    pub parse_package_json: unsafe fn(
        cache: *mut (),
        log: &mut logger::Log,
        source: &logger::Source,
        force_utf8: bool,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error>,
    /// Port of `cache::Json.parseJSON` (cache.zig:296).
    pub parse_json: unsafe fn(
        cache: *mut (),
        log: &mut logger::Log,
        source: &logger::Source,
        mode: JsonMode,
        force_utf8: bool,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error>,
}

/// Erased handle to a `bun_bundler::cache::Json` (or equivalent).
pub struct JsonCache {
    pub ptr: *mut (),
    pub vtable: &'static JsonCacheVTable,
}

thread_local! {
    /// Backing arena for the default (`unwired`) vtable. Zig's `Json{}` is an
    /// empty struct whose methods take `std.mem.Allocator param` — the
    /// resolver passes `bun.default_allocator`, which never frees. The Rust
    /// `bun_interchange::json` parser arena-allocates AST nodes into a `&Bump`;
    /// this thread-local is the `default_allocator` equivalent (never reset, so
    /// returned `Expr` `StoreRef`s stay valid for the thread's lifetime).
    ///
    /// The bundler swaps in its own per-`cache::Json` arena via
    /// `Json::as_resolver_cache` (src/bundler/cache.rs); this is the fallback
    /// so a bare `Resolver` works without that wiring, matching Zig semantics.
    static UNWIRED_JSON_ARENA: bun_alloc::Arena = bun_alloc::Arena::new();
}

/// Port of `cache::Json::parse` (cache.zig:287) for the default vtable.
/// `_: *@This()` is dropped — Zig's `Json` is stateless.
#[inline]
fn unwired_json_parse(
    log: &mut logger::Log,
    source: &logger::Source,
    func: fn(
        &logger::Source,
        &mut logger::Log,
        &bun_alloc::Arena,
    ) -> Result<json_parser::Expr, bun_core::Error>,
) -> Result<Option<js_ast::Expr>, bun_core::Error> {
    let mut temp_log = logger::Log::init();
    // PORT NOTE: reshaped for borrowck — Zig `defer temp_log.appendToMaybeRecycled(log, source) catch {}`
    // runs after the `func() catch null` body; here the append is hoisted past the match.
    let result = UNWIRED_JSON_ARENA.with(|bump| match func(source, &mut temp_log, bump) {
        // Lift the T2 value-subset `bun_logger::js_ast::Expr` into the full
        // `bun_js_parser::Expr` (src/js_parser/ast/Expr.rs `From` impl).
        Ok(expr) => Some(js_ast::Expr::from(expr)),
        Err(_) => None,
    });
    let _ = temp_log.append_to_maybe_recycled(log, source);
    Ok(result)
}

impl JsonCache {
    /// Default vtable for `cache::Set::init()` — port of Zig's `Json{}` empty
    /// struct (cache.zig:283), which is fully functional on first use because
    /// its methods statically forward to `json_parser`. The resolver crate
    /// reaches `json_parser` via `bun_interchange` (lower-tier; already a
    /// transitive dep through `bun_js_parser`), so no CYCLEBREAK is needed here
    /// — only the `bun_bundler::cache::Json` *type* sat in a higher tier, and
    /// that is what the vtable erasure replaces. The bundler may still install
    /// its own vtable (to share an arena), but it is no longer required for
    /// correctness.
    pub const fn unwired() -> JsonCache {
        /// Port of `cache::Json.parseTSConfig` (cache.zig:311).
        unsafe fn unwired_tsconfig(
            _cache: *mut (),
            log: &mut logger::Log,
            source: &logger::Source,
        ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
            unwired_json_parse(log, source, json_parser::parse_ts_config::<true>)
        }
        /// Port of `cache::Json.parsePackageJSON` (cache.zig:307).
        unsafe fn unwired_package_json(
            _cache: *mut (),
            log: &mut logger::Log,
            source: &logger::Source,
            force_utf8: bool,
        ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
            // PORT NOTE: `comptime force_utf8: bool` → runtime branch over the two
            // monomorphizations (vtable slot is a plain `fn`, not generic).
            let f: fn(
                &logger::Source,
                &mut logger::Log,
                &bun_alloc::Arena,
            ) -> Result<json_parser::Expr, bun_core::Error> = if force_utf8 {
                json_parser::parse_ts_config::<true>
            } else {
                json_parser::parse_ts_config::<false>
            };
            unwired_json_parse(log, source, f)
        }
        /// Port of `cache::Json.parseJSON` (cache.zig:296).
        unsafe fn unwired_json(
            _cache: *mut (),
            log: &mut logger::Log,
            source: &logger::Source,
            mode: JsonMode,
            force_utf8: bool,
        ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
            // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
            // They are JSON files with comments and trailing commas.
            // Sometimes tooling expects this to work.
            let f: fn(
                &logger::Source,
                &mut logger::Log,
                &bun_alloc::Arena,
            ) -> Result<json_parser::Expr, bun_core::Error> = match (mode, force_utf8) {
                (JsonMode::Jsonc, true) => json_parser::parse_ts_config::<true>,
                (JsonMode::Jsonc, false) => json_parser::parse_ts_config::<false>,
                (JsonMode::Json, true) => json_parser::parse::<true>,
                (JsonMode::Json, false) => json_parser::parse::<false>,
            };
            unwired_json_parse(log, source, f)
        }
        static UNWIRED_VTABLE: JsonCacheVTable = JsonCacheVTable {
            parse_tsconfig: unwired_tsconfig,
            parse_package_json: unwired_package_json,
            parse_json: unwired_json,
        };
        JsonCache { ptr: core::ptr::null_mut(), vtable: &UNWIRED_VTABLE }
    }

    /// Deprecated alias for [`JsonCache::unwired`]. Kept so out-of-crate
    /// callers compile while they migrate; new code must not use this.
    #[deprecated = "use JsonCache::unwired()"]
    pub const fn noop() -> JsonCache {
        Self::unwired()
    }

    #[inline]
    pub fn parse_tsconfig(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
        // SAFETY: `ptr` points to the cache instance the vtable was minted for;
        // caller (bun_bundler) guarantees they were paired.
        unsafe { (self.vtable.parse_tsconfig)(self.ptr, log, source) }
    }

    /// Port of `cache::Json.parsePackageJSON` (cache.zig:307).
    #[inline]
    pub fn parse_package_json(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        force_utf8: bool,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
        // SAFETY: see `parse_tsconfig`.
        unsafe { (self.vtable.parse_package_json)(self.ptr, log, source, force_utf8) }
    }

    /// Port of `cache::Json.parseJSON` (cache.zig:296).
    #[inline]
    pub fn parse_json(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        mode: JsonMode,
        force_utf8: bool,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
        // SAFETY: see `parse_tsconfig`.
        unsafe { (self.vtable.parse_json)(self.ptr, log, source, mode, force_utf8) }
    }
}

// Heuristic: you probably don't have 100 of these
// Probably like 5-10
// Array iteration is faster and deterministically ordered in that case.
// TODO(port): bun.StringArrayHashMap — confirm bun_collections key/value ownership for byte-slice keys
pub type PathsMap = ArrayHashMap<Box<[u8]>, Vec<Box<[u8]>>>;

// Zig: `fn FlagSet(comptime Type: type) type { return std.EnumSet(std.meta.FieldEnum(Type)); }`
// Rust has no `FieldEnum` reflection; we hand-list the Pragma fields actually used below.
#[derive(EnumSetType, Debug)]
pub enum JsxField {
    Factory,
    Fragment,
    ImportSource,
    Runtime,
    Development,
}

pub type JsxFieldSet = EnumSet<JsxField>;

pub struct TSConfigJSON {
    // TODO(port): lifetime — Zig never frees these string fields (resolver-lifetime arena);
    // Phase A models them as owned Box<[u8]>. Revisit if profiling shows churn.
    pub abs_path: Box<[u8]>,

    /// The absolute path of "compilerOptions.baseUrl"
    pub base_url: Box<[u8]>,

    /// This is used if "Paths" is non-nil. It's equal to "BaseURL" except if
    /// "BaseURL" is missing, in which case it is as if "BaseURL" was ".". This
    /// is to implement the "paths without baseUrl" feature from TypeScript 4.1.
    /// More info: https://github.com/microsoft/TypeScript/issues/31869
    pub base_url_for_paths: Box<[u8]>,

    pub extends: Box<[u8]>,
    /// The verbatim values of "compilerOptions.paths". The keys are patterns to
    /// match and the values are arrays of fallback paths to search. Each key and
    /// each fallback path can optionally have a single "*" wildcard character.
    /// If both the key and the value have a wildcard, the substring matched by
    /// the wildcard is substituted into the fallback path. The keys represent
    /// module-style path names and the fallback paths are relative to the
    /// "baseUrl" value in the "tsconfig.json" file.
    pub paths: PathsMap,

    pub jsx: options::jsx::Pragma,
    pub jsx_flags: JsxFieldSet,

    pub use_define_for_class_fields: Option<bool>,

    pub preserve_imports_not_used_as_values: Option<bool>,

    pub emit_decorator_metadata: bool,
    pub experimental_decorators: bool,
}

impl Default for TSConfigJSON {
    fn default() -> Self {
        Self {
            abs_path: Box::default(),
            base_url: Box::default(),
            base_url_for_paths: Box::default(),
            extends: Box::default(),
            paths: PathsMap::default(),
            jsx: options::jsx::Pragma::default(),
            jsx_flags: JsxFieldSet::empty(),
            use_define_for_class_fields: None,
            preserve_imports_not_used_as_values: Some(false),
            emit_decorator_metadata: false,
            experimental_decorators: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ImportsNotUsedAsValue {
    Preserve,
    Err,
    Remove,
    Invalid,
}

// Zig: `pub const List = bun.ComptimeStringMap(ImportsNotUsedAsValue, ...)`
pub static IMPORTS_NOT_USED_AS_VALUE_LIST: phf::Map<&'static [u8], ImportsNotUsedAsValue> = phf::phf_map! {
    b"preserve" => ImportsNotUsedAsValue::Preserve,
    b"error" => ImportsNotUsedAsValue::Err,
    b"remove" => ImportsNotUsedAsValue::Remove,
};

impl TSConfigJSON {
    // Zig: `pub const new = bun.TrivialNew(@This());`
    #[inline]
    pub fn new(v: Self) -> Box<Self> {
        Box::new(v)
    }

    pub fn has_base_url(&self) -> bool {
        !self.base_url.is_empty()
    }

    pub fn merge_jsx(&self, current: options::jsx::Pragma) -> options::jsx::Pragma {
        let mut out = current;

        if self.jsx_flags.contains(JsxField::Factory) {
            out.factory = self.jsx.factory.clone();
        }

        if self.jsx_flags.contains(JsxField::Fragment) {
            out.fragment = self.jsx.fragment.clone();
        }

        if self.jsx_flags.contains(JsxField::ImportSource) {
            out.import_source = self.jsx.import_source.clone();
        }

        if self.jsx_flags.contains(JsxField::Runtime) {
            out.runtime = self.jsx.runtime;
        }

        if self.jsx_flags.contains(JsxField::Development) {
            out.development = self.jsx.development;
        }

        out
    }

    /// Support ${configDir}, but avoid allocating when possible.
    ///
    /// https://github.com/microsoft/TypeScript/issues/57485
    ///
    /// https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#the-configdir-template-variable-for-configuration-files
    ///
    /// https://github.com/oven-sh/bun/issues/11752
    ///
    // Note that the way tsc does this is slightly different. They replace
    // "${configDir}" with "./" and then convert it to an absolute path sometimes.
    // We convert it to an absolute path during module resolution, so we shouldn't need to do that here.
    // https://github.com/microsoft/TypeScript/blob/ef802b1e4ddaf8d6e61d6005614dd796520448f8/src/compiler/commandLineParser.ts#L3243-L3245
    fn str_replacing_templates(
        input: Box<[u8]>,
        source: &logger::Source,
    ) -> Result<Box<[u8]>, bun_alloc::AllocError> {
        const TEMPLATE: &[u8] = b"${configDir}";
        let mut remaining: &[u8] = &input;
        let mut string_builder = bun_string::StringBuilder { len: 0, cap: 0, ptr: None };
        let config_dir = source.path.source_dir();

        // There's only one template variable we support, so we can keep this simple for now.
        while let Some(index) = strings::index_of(remaining, TEMPLATE) {
            string_builder.count(&remaining[..index]);
            string_builder.count(config_dir);
            remaining = &remaining[index + TEMPLATE.len()..];
        }

        // If we didn't find any template variables, return the original string without allocating.
        if remaining.len() == input.len() {
            return Ok(input);
        }

        string_builder.count_z(remaining);
        string_builder.allocate()?;

        remaining = &input;
        while let Some(index) = strings::index_of(remaining, TEMPLATE) {
            let _ = string_builder.append(&remaining[..index]);
            let _ = string_builder.append(config_dir);
            remaining = &remaining[index + TEMPLATE.len()..];
        }

        // The extra null-byte here is unnecessary. But it's kind of nice in the debugger sometimes.
        let _ = string_builder.append_z(remaining);

        // PERF(port): Zig returned a sub-slice into the builder's single allocation; Rust copies once.
        let len = string_builder.len - 1;
        let written = string_builder.allocated_slice();
        Ok(Box::from(&written[..len]))
    }

    // CYCLEBREAK: `json_cache` is the erased `JsonCache` vtable handle (was
    // `&mut bun_bundler::cache::Json`).
    // PORT NOTE: Zig `Expr.asString(allocator)` allocates and never frees (the
    // resolver owns the JSON AST for its lifetime). The live Rust `Expr` query
    // API exposes `as_utf8_string_literal() -> Option<&[u8]>` instead — the
    // tsconfig parser forces UTF-8 (cache.zig:313 `force_utf8=true`), so every
    // `EString` is already a flat UTF-8 slice and we can copy at the boundary.
    pub fn parse(
        log: &mut logger::Log,
        source: &logger::Source,
        json_cache: &mut JsonCache,
    ) -> Result<Option<Box<TSConfigJSON>>, bun_core::Error> {
        // Unfortunately "tsconfig.json" isn't actually JSON. It's some other
        // format that appears to be defined by the implementation details of the
        // TypeScript compiler.
        //
        // Attempt to parse it anyway by modifying the JSON parser, but just for
        // these particular files. This is likely not a completely accurate
        // emulation of what the TypeScript compiler does (e.g. string escape
        // behavior may also be different).
        let json: js_ast::Expr = match json_cache.parse_tsconfig(log, source).ok().flatten() {
            Some(e) => e,
            None => return Ok(None),
        };

        bun_analytics::features::tsconfig.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        let mut result = TSConfigJSON {
            abs_path: Box::from(source.path.text),
            paths: PathsMap::default(),
            ..Default::default()
        };
        // errdefer allocator.free(result.paths) — handled by Drop on `result`.
        if let Some(extends_value) = json.as_property(b"extends") {
            if !source.path.is_node_module() {
                if let Some(str) = extends_value.expr.as_utf8_string_literal() {
                    result.extends = Box::from(str);
                }
            }
        }
        let mut has_base_url = false;

        // Parse "compilerOptions"
        if let Some(compiler_opts) = json.as_property(b"compilerOptions") {
            // Parse "baseUrl"
            if let Some(base_url_prop) = compiler_opts.expr.as_property(b"baseUrl") {
                if let Some(base_url) = base_url_prop.expr.as_utf8_string_literal() {
                    result.base_url = match Self::str_replacing_templates(Box::from(base_url), source) {
                        Ok(v) => v,
                        Err(_) => return Ok(None),
                    };
                    has_base_url = true;
                }
            }

            // Parse "emitDecoratorMetadata"
            if let Some(emit_decorator_metadata_prop) =
                compiler_opts.expr.as_property(b"emitDecoratorMetadata")
            {
                if let Some(val) = emit_decorator_metadata_prop.expr.as_bool() {
                    result.emit_decorator_metadata = val;
                }
            }

            // Parse "experimentalDecorators"
            if let Some(experimental_decorators_prop) =
                compiler_opts.expr.as_property(b"experimentalDecorators")
            {
                if let Some(val) = experimental_decorators_prop.expr.as_bool() {
                    result.experimental_decorators = val;
                }
            }

            // Parse "jsxFactory"
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"jsxFactory") {
                if let Some(str) = jsx_prop.expr.as_utf8_string_literal() {
                    result.jsx.factory =
                        Self::parse_member_expression_for_jsx(log, source, jsx_prop.loc, str)?;
                    result.jsx_flags.insert(JsxField::Factory);
                }
            }

            // Parse "jsxFragmentFactory"
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"jsxFragmentFactory") {
                if let Some(str) = jsx_prop.expr.as_utf8_string_literal() {
                    result.jsx.fragment =
                        Self::parse_member_expression_for_jsx(log, source, jsx_prop.loc, str)?;
                    result.jsx_flags.insert(JsxField::Fragment);
                }
            }

            // https://www.typescriptlang.org/docs/handbook/jsx.html#basic-usages
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"jsx") {
                if let Some(str) = jsx_prop.expr.as_utf8_string_literal() {
                    let mut str_lower = vec![0u8; str.len()];
                    let _ = strings::copy_lowercase(str, &mut str_lower);
                    // - We don't support "preserve" yet
                    if let Some(runtime) = options::jsx::RUNTIME_MAP.get(str_lower.as_slice()) {
                        result.jsx.runtime = runtime.runtime;
                        result.jsx_flags.insert(JsxField::Runtime);

                        if let Some(dev) = runtime.development {
                            result.jsx.development = dev;
                            result.jsx_flags.insert(JsxField::Development);
                        }
                    }
                    // `str_lower` dropped here (Zig: defer allocator.free(str_lower))
                }
            }

            // Parse "jsxImportSource"
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"jsxImportSource") {
                if let Some(str) = jsx_prop.expr.as_utf8_string_literal() {
                    if str.len() >= b"solid-js".len() && &str[..b"solid-js".len()] == b"solid-js" {
                        result.jsx.runtime = options::jsx::Runtime::Solid;
                        result.jsx_flags.insert(JsxField::Runtime);
                    }

                    result.jsx.package_name = Box::from(str);
                    result.jsx.set_import_source();
                    result.jsx_flags.insert(JsxField::ImportSource);
                }
            }

            // Parse "useDefineForClassFields"
            if let Some(use_define_value_prop) =
                compiler_opts.expr.as_property(b"useDefineForClassFields")
            {
                if let Some(val) = use_define_value_prop.expr.as_bool() {
                    result.use_define_for_class_fields = Some(val);
                }
            }

            // Parse "importsNotUsedAsValues"
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"importsNotUsedAsValues") {
                // This should never allocate since it will be utf8
                if let Some(str) = jsx_prop.expr.as_utf8_string_literal() {
                    match IMPORTS_NOT_USED_AS_VALUE_LIST
                        .get(str)
                        .copied()
                        .unwrap_or(ImportsNotUsedAsValue::Invalid)
                    {
                        ImportsNotUsedAsValue::Preserve | ImportsNotUsedAsValue::Err => {
                            result.preserve_imports_not_used_as_values = Some(true);
                        }
                        ImportsNotUsedAsValue::Remove => {}
                        _ => {
                            let _ = log.add_range_warning_fmt(
                                Some(source),
                                source.range_of_string(jsx_prop.loc),
                                format_args!(
                                    "Invalid value \"{}\" for \"importsNotUsedAsValues\"",
                                    bstr::BStr::new(str)
                                ),
                            );
                        }
                    }
                }
            }

            if let Some(prefixes) = compiler_opts.expr.as_property(b"moduleSuffixes") {
                if !source.path.is_node_module() {
                    'handle_module_prefixes: {
                        let Some(mut array) = prefixes.expr.as_array() else {
                            break 'handle_module_prefixes;
                        };
                        while let Some(element) = array.next() {
                            if let Some(str) = element.as_utf8_string_literal() {
                                if !str.is_empty() {
                                    // Only warn when there is actually content
                                    // Sometimes, people do "moduleSuffixes": [""]
                                    let _ = log.add_warning(
                                        Some(source),
                                        prefixes.loc,
                                        b"moduleSuffixes is not supported yet",
                                    );
                                    break 'handle_module_prefixes;
                                }
                            }
                        }
                    }
                }
            }

            // Parse "paths"
            if let Some(paths_prop) = compiler_opts.expr.as_property(b"paths") {
                if let js_ast::ExprData::EObject(paths) = &paths_prop.expr.data {
                    // PORT NOTE: Zig `defer { Features.tsconfig_paths += 1 }` hoisted to top of block;
                    // it runs on every exit path either way.
                    bun_analytics::features::tsconfig_paths
                        .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

                    result.base_url_for_paths = if !result.base_url.is_empty() {
                        result.base_url.clone()
                    } else {
                        Box::from(b".".as_slice())
                    };
                    result.paths = PathsMap::default();
                    for property in paths.properties.slice() {
                        let Some(key_prop) = &property.key else {
                            continue;
                        };
                        let Some(key) = key_prop.as_utf8_string_literal() else {
                            continue;
                        };

                        if !Self::is_valid_tsconfig_path_pattern(key, log, source, key_prop.loc) {
                            continue;
                        }

                        let Some(value_prop) = &property.value else {
                            continue;
                        };

                        // The "paths" field is an object which maps a pattern to an
                        // array of remapping patterns to try, in priority order. See
                        // the documentation for examples of how this is used:
                        // https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping.
                        //
                        // One particular example:
                        //
                        //   {
                        //     "compilerOptions": {
                        //       "baseUrl": "projectRoot",
                        //       "paths": {
                        //         "*": [
                        //           "*",
                        //           "generated/*"
                        //         ]
                        //       }
                        //     }
                        //   }
                        //
                        // Matching "folder1/file2" should first check "projectRoot/folder1/file2"
                        // and then, if that didn't work, also check "projectRoot/generated/folder1/file2".
                        match &value_prop.data {
                            js_ast::ExprData::EArray(e_array) => {
                                let array = e_array.items.slice();

                                if !array.is_empty() {
                                    let mut values: Vec<Box<[u8]>> =
                                        Vec::with_capacity(array.len());
                                    // errdefer allocator.free(values) — handled by Drop.
                                    for expr in array {
                                        if let Some(str_) = expr.as_utf8_string_literal() {
                                            let str = match Self::str_replacing_templates(
                                                Box::from(str_),
                                                source,
                                            ) {
                                                Ok(v) => v,
                                                Err(_) => return Ok(None),
                                            };
                                            // errdefer allocator.free(str) — handled by Drop.
                                            if Self::is_valid_tsconfig_path_pattern(
                                                &str, log, source, expr.loc,
                                            ) && (has_base_url
                                                || Self::is_valid_tsconfig_path_no_base_url_pattern(
                                                    &str, log, source, expr.loc,
                                                ))
                                            {
                                                values.push(str);
                                            }
                                        }
                                    }
                                    if !values.is_empty() {
                                        // Invalid patterns are filtered out above, so count <= array.len.
                                        // Shrink the allocation so the slice stored in the map is exactly
                                        // what was allocated — callers that later free these values (the
                                        // extends-merge in resolver.zig) pass the stored slice to
                                        // Allocator.free, which requires the original length.
                                        values.shrink_to_fit();
                                        let _ = result.paths.put(Box::from(key), values);
                                    }
                                    // else: Every entry was invalid; nothing to store. `values` drops here.
                                }
                            }
                            _ => {
                                let _ = log.add_range_warning_fmt(
                                    Some(source),
                                    source.range_of_string(key_prop.loc),
                                    format_args!(
                                        "Substitutions for pattern \"{}\" should be an array",
                                        bstr::BStr::new(key)
                                    ),
                                );
                            }
                        }
                    }
                }
            }
        }

        if cfg!(debug_assertions) && has_base_url {
            debug_assert!(!result.base_url.is_empty());
        }

        Ok(Some(TSConfigJSON::new(result)))
    }

    pub fn is_valid_tsconfig_path_pattern(
        text: &[u8],
        log: &mut logger::Log,
        source: &logger::Source,
        loc: logger::Loc,
    ) -> bool {
        let mut found_asterisk = false;
        for &c in text {
            if c == b'*' {
                if found_asterisk {
                    let r = source.range_of_string(loc);
                    let _ = log.add_range_warning_fmt(
                        Some(source),
                        r,
                        format_args!(
                            "Invalid pattern \"{}\", must have at most one \"*\" character",
                            bstr::BStr::new(text)
                        ),
                    );
                    return false;
                }
                found_asterisk = true;
            }
        }

        true
    }

    pub fn parse_member_expression_for_jsx(
        log: &mut logger::Log,
        source: &logger::Source,
        loc: logger::Loc,
        text: &[u8],
    ) -> Result<Vec<Box<[u8]>>, bun_core::Error> {
        // TODO(port): narrow error set
        if text.is_empty() {
            return Ok(Vec::new());
        }
        // foo.bar == 2
        // foo.bar. == 2
        // foo == 1
        // foo.bar.baz == 3
        // foo.bar.baz.bun == 4
        let parts_count = text.iter().filter(|&&b| b == b'.').count()
            + usize::from(text[text.len() - 1] != b'.');
        let mut parts: Vec<Box<[u8]>> = Vec::with_capacity(parts_count);

        if parts_count == 1 {
            if !js_lexer::is_identifier(text) {
                let warn = source.range_of_string(loc);
                let _ = log.add_range_warning_fmt(
                    Some(source),
                    warn,
                    format_args!(
                        "Invalid JSX member expression: \"{}\"",
                        bstr::BStr::new(text)
                    ),
                );
                return Ok(Vec::new());
            }

            // PERF(port): was appendAssumeCapacity
            // PERF(port): Zig stored a borrowed slice into `text`; Rust clones into Box<[u8]>.
            parts.push(Box::from(text));
            return Ok(parts);
        }

        let iter = text.split(|b| *b == b'.').filter(|s| !s.is_empty());

        for part in iter {
            if !js_lexer::is_identifier(part) {
                let warn = source.range_of_string(loc);
                let _ = log.add_range_warning_fmt(
                    Some(source),
                    warn,
                    format_args!(
                        "Invalid JSX member expression: \"{}\"",
                        bstr::BStr::new(part)
                    ),
                );
                return Ok(Vec::new());
            }
            // PERF(port): was appendAssumeCapacity
            parts.push(Box::from(part));
        }

        Ok(parts)
    }

    #[inline]
    pub fn is_slash(c: u8) -> bool {
        c == b'/' || c == b'\\'
    }

    pub fn is_valid_tsconfig_path_no_base_url_pattern(
        text: &[u8],
        log: &mut logger::Log,
        source: &logger::Source,
        loc: logger::Loc,
    ) -> bool {
        let c0: u8;
        let c1: u8;
        let c2: u8;
        let n = text.len();

        match n {
            0 => {
                return false;
            }
            // Relative "." or ".."
            1 => {
                return text[0] == b'.';
            }
            // "..", ".\", "./"
            2 => {
                return text[0] == b'.'
                    && (text[1] == b'.' || text[1] == b'\\' || text[1] == b'/');
            }
            _ => {
                c0 = text[0];
                c1 = text[1];
                c2 = text[2];
            }
        }

        // Relative "./" or "../" or ".\\" or "..\\"
        if c0 == b'.' && (Self::is_slash(c1) || (c1 == b'.' && Self::is_slash(c2))) {
            return true;
        }

        // Absolute DOS "c:/" or "c:\\"
        if c1 == b':' && Self::is_slash(c2) {
            match c0 {
                b'a'..=b'z' | b'A'..=b'Z' => {
                    return true;
                }
                _ => {}
            }
        }

        // Absolute unix "/"
        if Self::is_slash(c0) {
            return true;
        }

        let r = source.range_of_string(loc);
        let _ = log.add_range_warning_fmt(
            Some(source),
            r,
            format_args!(
                "Non-relative path \"{}\" is not allowed when \"baseUrl\" is not set (did you forget a leading \"./\"?)",
                bstr::BStr::new(text)
            ),
        );
        false
    }

    // Zig `deinit` only freed `paths` and `bun.destroy(this)`. In Rust, `Box<TSConfigJSON>`
    // drop handles both: PathsMap has Drop, and Box frees the allocation. No explicit Drop needed.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/tsconfig_json.zig (522 lines)
//   confidence: medium
//   todos:      0
//   notes:      String fields modeled as Box<[u8]> (Zig never freed them — resolver-lifetime); JsxField enum hand-listed (no FieldEnum reflection); Expr.as_string/as_property/ExprData shapes assumed from bun_js_parser; ImportsNotUsedAsValue::List moved to module-level static (no associated statics in Rust).
// ──────────────────────────────────────────────────────────────────────────
