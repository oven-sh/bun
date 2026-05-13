use bun_collections::ArrayHashMap;
use bun_collections::VecExt;
use bun_core::strings;
use bun_js_parser as js_ast;
use bun_js_parser::lexer as js_lexer;
use bun_parsers::json_parser;
use enumset::{EnumSet, EnumSetType};

// D042: `options::jsx::{Pragma, Runtime, ImportSource, RUNTIME_MAP, ...}` is
// the canonical `bun_options_types::jsx` module. The previous local `Pragma`
// (with `Vec` factory/fragment + empty defaults) diverged from spec — Zig
// `JSX.Pragma{}` defaults to `["React","createElement"]`/`["React","Fragment"]`.
// Unification corrects that; `merge_jsx` already uses `JsxFieldSet` (not
// emptiness) to track was-set, so behavior is preserved.
pub mod options {
    pub use bun_options_types::jsx;
}

/// Port of the anonymous `enum { json, jsonc }` parameter to
/// `cache::Json.parseJSON` (cache.zig:296).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JsonMode {
    Json,
    Jsonc,
}

/// Port of `cache::Json` (cache.zig:283). Moved down from `bun_bundler::cache`
/// so the resolver names it directly — `bun_parsers::json_parser` is
/// lower-tier than the resolver, so no cycle exists.
///
/// Zig's `Json` is stateless and threads `bun.default_allocator` through every
/// call; the Rust `json_parser` arena-allocates into a `&bun_alloc::Arena`, so
/// this struct owns one. The arena is **never reset** — package.json/tsconfig
/// ASTs are cached process-long ("DirInfo cache is reused globally / so we
/// cannot free these", package_json.zig).
///
/// The arena is lazy-initialized on first `parse()`. `Resolver::for_worker`
/// creates one `CacheSet` (and thus one `JsonCache`) per bundler worker thread,
/// but those workers share the global `DirInfo` cache and almost never call
/// `parse_*` themselves — eagerly constructing `Arena::new()` here costs one
/// `mi_heap_new` per worker (≈11 empty heaps on a typical build/elysia run).
pub struct JsonCache {
    bump: Option<bun_alloc::Arena>,
}

impl JsonCache {
    pub fn init() -> JsonCache {
        JsonCache { bump: None }
    }

    /// Port of `cache::Json::parse` (cache.zig:287).
    #[inline]
    fn parse(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        func: fn(
            &bun_ast::Source,
            &mut bun_ast::Log,
            &bun_alloc::Arena,
        ) -> Result<bun_ast::Expr, bun_core::Error>,
    ) -> Result<Option<bun_ast::Expr>, bun_core::Error> {
        let mut temp_log = bun_ast::Log::init();
        let bump = self.bump.get_or_insert_with(bun_alloc::Arena::new);
        // PORT NOTE: reshaped for borrowck — Zig `defer temp_log.appendToMaybeRecycled(log, source) catch {}`
        // runs after the `func() catch null` body; here the append is hoisted past the match.
        let result = match func(source, &mut temp_log, bump) {
            // Lift the T2 value-subset `bun_ast::Expr` into the full
            // `bun_ast::Expr` (src/js_parser/ast/Expr.rs `From` impl).
            Ok(expr) => Some(bun_ast::Expr::from(expr)),
            Err(_) => None,
        };
        let _ = temp_log.append_to_maybe_recycled(log, source);
        Ok(result)
    }

    /// Port of `cache::Json.parseTSConfig` (cache.zig:311).
    #[inline]
    pub fn parse_tsconfig(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
    ) -> Result<Option<bun_ast::Expr>, bun_core::Error> {
        self.parse(log, source, json_parser::parse_ts_config::<true>)
    }

    /// Port of `cache::Json.parsePackageJSON` (cache.zig:307).
    #[inline]
    pub fn parse_package_json(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        force_utf8: bool,
    ) -> Result<Option<bun_ast::Expr>, bun_core::Error> {
        if force_utf8 {
            self.parse(log, source, json_parser::parse_ts_config::<true>)
        } else {
            self.parse(log, source, json_parser::parse_ts_config::<false>)
        }
    }

    /// Port of `cache::Json.parseJSON` (cache.zig:296).
    #[inline]
    pub fn parse_json(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        mode: JsonMode,
        force_utf8: bool,
    ) -> Result<Option<bun_ast::Expr>, bun_core::Error> {
        // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
        // They are JSON files with comments and trailing commas.
        // Sometimes tooling expects this to work.
        let f: fn(
            &bun_ast::Source,
            &mut bun_ast::Log,
            &bun_alloc::Arena,
        ) -> Result<bun_ast::Expr, bun_core::Error> = match (mode, force_utf8) {
            (JsonMode::Jsonc, true) => json_parser::parse_ts_config::<true>,
            (JsonMode::Jsonc, false) => json_parser::parse_ts_config::<false>,
            (JsonMode::Json, true) => json_parser::parse::<true>,
            (JsonMode::Json, false) => json_parser::parse::<false>,
        };
        self.parse(log, source, f)
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

// Zig: `Output.scoped(.alloc, .visibleIf(hasDecl(T, "log_allocations")))` — hidden by
// default, enabled via `BUN_DEBUG_alloc=1`. Tests count `new(TSConfigJSON)` /
// `destroy(TSConfigJSON)` lines to assert the extends-chain merge frees intermediates.
bun_core::declare_scope!(alloc, hidden);

impl TSConfigJSON {
    // Zig: `pub const new = bun.TrivialNew(@This());` → `bun.new` logs under `.alloc`.
    #[inline]
    pub fn new(v: Self) -> Box<Self> {
        let boxed = Box::new(v);
        if cfg!(debug_assertions) {
            bun_core::scoped_log!(alloc, "new(TSConfigJSON) = {:p}", boxed.as_ref());
        }
        boxed
    }

    // Zig: `bun.destroy(this)` — logs under `.alloc` then frees.
    #[inline]
    pub fn destroy(boxed: Box<Self>) {
        if cfg!(debug_assertions) {
            bun_core::scoped_log!(alloc, "destroy(TSConfigJSON) = {:p}", boxed.as_ref());
        }
        drop(boxed);
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
        source: &bun_ast::Source,
    ) -> Result<Box<[u8]>, bun_alloc::AllocError> {
        const TEMPLATE: &[u8] = b"${configDir}";
        let mut remaining: &[u8] = &input;
        let mut string_builder = bun_core::StringBuilder {
            len: 0,
            cap: 0,
            ptr: None,
        };
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

    // PORT NOTE: Zig `Expr.asString(allocator)` allocates and never frees (the
    // resolver owns the JSON AST for its lifetime). The live Rust `Expr` query
    // API exposes `as_utf8_string_literal() -> Option<&[u8]>` instead — the
    // tsconfig parser forces UTF-8 (cache.zig:313 `force_utf8=true`), so every
    // `EString` is already a flat UTF-8 slice and we can copy at the boundary.
    pub fn parse(
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
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
        let json: bun_ast::Expr = match json_cache.parse_tsconfig(log, source).ok().flatten() {
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
        //
        // PERF(port): Zig (and the first Rust port) re-scans each JSON object's
        // property vector once per field — `expr.asProperty(...)` is an O(n)
        // linear scan, and there are ~11 of them on `compilerOptions` plus 2 on
        // the top-level object, so a typical tsconfig walks `compilerOptions`
        // ~11×. Instead, do a single pass over each object's property list,
        // recording the *first* occurrence of each key we care about (matching
        // `asProperty`'s "first match wins" semantics via the `Option::is_none`
        // guards), then handle them below in the original fixed order so any
        // inter-field ordering (`baseUrl` before `paths`, `jsx` before
        // `jsxImportSource`) is preserved.
        let mut extends_value: Option<bun_ast::Expr> = None;
        let mut compiler_opts: Option<bun_ast::Expr> = None;
        if let bun_ast::ExprData::EObject(obj) = &json.data {
            for property in obj.properties.slice() {
                let (Some(key_expr), Some(value)) = (property.key.as_ref(), property.value.as_ref())
                else {
                    continue;
                };
                let Some(key) = key_expr.as_utf8_string_literal() else {
                    continue;
                };
                match key {
                    b"extends" if extends_value.is_none() => extends_value = Some(*value),
                    b"compilerOptions" if compiler_opts.is_none() => compiler_opts = Some(*value),
                    _ => {}
                }
            }
        }

        if let Some(extends_value) = extends_value {
            if !source.path.is_node_module() {
                if let Some(str) = extends_value.as_utf8_string_literal() {
                    result.extends = Box::from(str);
                }
            }
        }
        let mut has_base_url = false;

        // Parse "compilerOptions"
        if let Some(compiler_opts) = compiler_opts {
            // Single pass over `compilerOptions`' properties; first occurrence
            // of each key wins (matching `asProperty`).
            let mut base_url_v: Option<bun_ast::Expr> = None;
            let mut emit_decorator_metadata_v: Option<bun_ast::Expr> = None;
            let mut experimental_decorators_v: Option<bun_ast::Expr> = None;
            let mut jsx_factory_v: Option<(bun_ast::Expr, bun_ast::Loc)> = None;
            let mut jsx_fragment_factory_v: Option<(bun_ast::Expr, bun_ast::Loc)> = None;
            let mut jsx_v: Option<bun_ast::Expr> = None;
            let mut jsx_import_source_v: Option<bun_ast::Expr> = None;
            let mut use_define_v: Option<bun_ast::Expr> = None;
            let mut imports_not_used_v: Option<(bun_ast::Expr, bun_ast::Loc)> = None;
            let mut module_suffixes_v: Option<(bun_ast::Expr, bun_ast::Loc)> = None;
            let mut paths_v: Option<bun_ast::Expr> = None;

            if let bun_ast::ExprData::EObject(obj) = &compiler_opts.data {
                for property in obj.properties.slice() {
                    let (Some(key_expr), Some(value)) =
                        (property.key.as_ref(), property.value.as_ref())
                    else {
                        continue;
                    };
                    let Some(key) = key_expr.as_utf8_string_literal() else {
                        continue;
                    };
                    let loc = key_expr.loc;
                    match key {
                        b"baseUrl" if base_url_v.is_none() => base_url_v = Some(*value),
                        b"emitDecoratorMetadata" if emit_decorator_metadata_v.is_none() => {
                            emit_decorator_metadata_v = Some(*value)
                        }
                        b"experimentalDecorators" if experimental_decorators_v.is_none() => {
                            experimental_decorators_v = Some(*value)
                        }
                        b"jsxFactory" if jsx_factory_v.is_none() => {
                            jsx_factory_v = Some((*value, loc))
                        }
                        b"jsxFragmentFactory" if jsx_fragment_factory_v.is_none() => {
                            jsx_fragment_factory_v = Some((*value, loc))
                        }
                        b"jsx" if jsx_v.is_none() => jsx_v = Some(*value),
                        b"jsxImportSource" if jsx_import_source_v.is_none() => {
                            jsx_import_source_v = Some(*value)
                        }
                        b"useDefineForClassFields" if use_define_v.is_none() => {
                            use_define_v = Some(*value)
                        }
                        b"importsNotUsedAsValues" if imports_not_used_v.is_none() => {
                            imports_not_used_v = Some((*value, loc))
                        }
                        b"moduleSuffixes" if module_suffixes_v.is_none() => {
                            module_suffixes_v = Some((*value, loc))
                        }
                        b"paths" if paths_v.is_none() => paths_v = Some(*value),
                        _ => {}
                    }
                }
            }

            // Parse "baseUrl"
            if let Some(base_url_prop) = base_url_v {
                if let Some(base_url) = base_url_prop.as_utf8_string_literal() {
                    result.base_url =
                        match Self::str_replacing_templates(Box::from(base_url), source) {
                            Ok(v) => v,
                            Err(_) => return Ok(None),
                        };
                    has_base_url = true;
                }
            }

            // Parse "emitDecoratorMetadata"
            if let Some(emit_decorator_metadata_prop) = emit_decorator_metadata_v {
                if let Some(val) = emit_decorator_metadata_prop.as_bool() {
                    result.emit_decorator_metadata = val;
                }
            }

            // Parse "experimentalDecorators"
            if let Some(experimental_decorators_prop) = experimental_decorators_v {
                if let Some(val) = experimental_decorators_prop.as_bool() {
                    result.experimental_decorators = val;
                }
            }

            // Parse "jsxFactory"
            if let Some((jsx_prop, loc)) = jsx_factory_v {
                if let Some(str) = jsx_prop.as_utf8_string_literal() {
                    result.jsx.factory =
                        Self::parse_member_expression_for_jsx(log, source, loc, str)?.into();
                    result.jsx_flags.insert(JsxField::Factory);
                }
            }

            // Parse "jsxFragmentFactory"
            if let Some((jsx_prop, loc)) = jsx_fragment_factory_v {
                if let Some(str) = jsx_prop.as_utf8_string_literal() {
                    result.jsx.fragment =
                        Self::parse_member_expression_for_jsx(log, source, loc, str)?.into();
                    result.jsx_flags.insert(JsxField::Fragment);
                }
            }

            // https://www.typescriptlang.org/docs/handbook/jsx.html#basic-usages
            if let Some(jsx_prop) = jsx_v {
                if let Some(str) = jsx_prop.as_utf8_string_literal() {
                    // PERF(port): Zig allocs `vec![0u8; str.len()]` to lowercase
                    // before the map lookup. `RUNTIME_MAP`'s keys are all
                    // lowercase ASCII and the longest (`b"react-jsxdev"`) is 12
                    // bytes, so a longer value can't match — lowercase into a
                    // fixed stack buffer (returns `None` when it can't fit).
                    if let Some((str_lower, len)) = strings::ascii_lowercase_buf::<12>(str) {
                        // - We don't support "preserve" yet
                        if let Some(runtime) = options::jsx::RUNTIME_MAP.get(&str_lower[..len]) {
                            result.jsx.runtime = runtime.runtime;
                            result.jsx_flags.insert(JsxField::Runtime);

                            if let Some(dev) = runtime.development {
                                result.jsx.development = dev;
                                result.jsx_flags.insert(JsxField::Development);
                            }
                        }
                    }
                }
            }

            // Parse "jsxImportSource"
            if let Some(jsx_prop) = jsx_import_source_v {
                if let Some(str) = jsx_prop.as_utf8_string_literal() {
                    if str.len() >= b"solid-js".len() && &str[..b"solid-js".len()] == b"solid-js" {
                        result.jsx.runtime = options::jsx::Runtime::Solid;
                        result.jsx_flags.insert(JsxField::Runtime);
                    }

                    result.jsx.package_name = str.to_vec().into();
                    result.jsx.set_import_source();
                    result.jsx_flags.insert(JsxField::ImportSource);
                }
            }

            // Parse "useDefineForClassFields"
            if let Some(use_define_value_prop) = use_define_v {
                if let Some(val) = use_define_value_prop.as_bool() {
                    result.use_define_for_class_fields = Some(val);
                }
            }

            // Parse "importsNotUsedAsValues"
            if let Some((jsx_prop, loc)) = imports_not_used_v {
                // This should never allocate since it will be utf8
                if let Some(str) = jsx_prop.as_utf8_string_literal() {
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
                                source.range_of_string(loc),
                                format_args!(
                                    "Invalid value \"{}\" for \"importsNotUsedAsValues\"",
                                    bstr::BStr::new(str)
                                ),
                            );
                        }
                    }
                }
            }

            if let Some((prefixes, loc)) = module_suffixes_v {
                if !source.path.is_node_module() {
                    'handle_module_prefixes: {
                        let Some(mut array) = prefixes.as_array() else {
                            break 'handle_module_prefixes;
                        };
                        while let Some(element) = array.next() {
                            if let Some(str) = element.as_utf8_string_literal() {
                                if !str.is_empty() {
                                    // Only warn when there is actually content
                                    // Sometimes, people do "moduleSuffixes": [""]
                                    let _ = log.add_warning(
                                        Some(source),
                                        loc,
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
            if let Some(paths_prop) = paths_v {
                if let bun_ast::ExprData::EObject(paths) = &paths_prop.data {
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
                            bun_ast::ExprData::EArray(e_array) => {
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
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
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
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
        text: &[u8],
    ) -> Result<Box<[Box<[u8]>]>, bun_core::Error> {
        // TODO(port): narrow error set
        if text.is_empty() {
            return Ok(Box::default());
        }
        // foo.bar == 2
        // foo.bar. == 2
        // foo == 1
        // foo.bar.baz == 3
        // foo.bar.baz.bun == 4
        let parts_count =
            text.iter().filter(|&&b| b == b'.').count() + usize::from(text[text.len() - 1] != b'.');
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
                return Ok(Box::default());
            }

            // PERF(port): was appendAssumeCapacity
            // PERF(port): Zig stored a borrowed slice into `text`; Rust clones into Box<[u8]>.
            parts.push(Box::from(text));
            return Ok(parts.into_boxed_slice());
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
                return Ok(Box::default());
            }
            // PERF(port): was appendAssumeCapacity
            parts.push(Box::from(part));
        }

        Ok(parts.into_boxed_slice())
    }

    pub fn is_valid_tsconfig_path_no_base_url_pattern(
        text: &[u8],
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
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
                return text[0] == b'.' && (text[1] == b'.' || text[1] == b'\\' || text[1] == b'/');
            }
            _ => {
                c0 = text[0];
                c1 = text[1];
                c2 = text[2];
            }
        }

        // Relative "./" or "../" or ".\\" or "..\\"
        if c0 == b'.' && (bun_paths::is_sep_any(c1) || (c1 == b'.' && bun_paths::is_sep_any(c2))) {
            return true;
        }

        // Absolute DOS "c:/" or "c:\\"
        if c1 == b':' && bun_paths::is_sep_any(c2) {
            match c0 {
                b'a'..=b'z' | b'A'..=b'Z' => {
                    return true;
                }
                _ => {}
            }
        }

        // Absolute unix "/"
        if bun_paths::is_sep_any(c0) {
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

// ported from: src/resolver/tsconfig_json.zig
