use bun_collections::ArrayHashMap;
use bun_core::strings;
use bun_js_parser::lexer as js_lexer;
use bun_parsers::json_parser;
use enumset::{EnumSet, EnumSetType};

// D042: `options::jsx::{Pragma, Runtime, ImportSource, RUNTIME_MAP, ...}` is
// the canonical `bun_options_types::jsx` module. `merge_jsx` uses
// `JsxFieldSet` (not emptiness) to track was-set.
pub mod options {
    pub use bun_options_types::jsx;
}

/// Selects strict JSON vs JSONC (comments + trailing commas) parsing in
/// `JsonCache::parse_json`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JsonMode {
    Json,
    Jsonc,
}

/// JSON parse cache. Lives below `bun_bundler::cache` so the resolver names it
/// directly — `bun_parsers::json_parser` is lower-tier than the resolver, so no
/// cycle exists.
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
    pub(crate) fn init() -> JsonCache {
        JsonCache { bump: None }
    }

    #[inline]
    fn parse(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        func: fn(
            &bun_ast::Source,
            &mut bun_ast::Log,
            &bun_alloc::Arena,
        ) -> Result<bun_ast::Expr, bun_parsers::Error>,
    ) -> Result<Option<bun_ast::Expr>, crate::Error> {
        let mut temp_log = bun_ast::Log::init();
        let bump = self.bump.get_or_insert_with(bun_alloc::Arena::new);
        let result = func(source, &mut temp_log, bump).ok();
        let _ = temp_log.append_to_maybe_recycled(log, source);
        Ok(result)
    }

    #[inline]
    fn parse_rows(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        func: fn(
            &bun_ast::Source,
            &mut bun_ast::Log,
        ) -> Result<json_parser::ParsedJson, bun_parsers::Error>,
    ) -> Result<Option<json_parser::ParsedJson>, crate::Error> {
        let mut temp_log = bun_ast::Log::init();
        let result = func(source, &mut temp_log).ok();
        let _ = temp_log.append_to_maybe_recycled(log, source);
        Ok(result)
    }

    /// Parses tsconfig.json/jsconfig.json source as JSONC into the immutable row AST.
    #[inline]
    pub(crate) fn parse_tsconfig(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
    ) -> Result<Option<json_parser::ParsedJson>, crate::Error> {
        self.parse_rows(log, source, json_parser::ParsedJson::parse_jsonc)
    }

    /// Parses package.json source into the immutable row AST.
    #[inline]
    pub(crate) fn parse_package_json(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
    ) -> Result<Option<json_parser::ParsedJson>, crate::Error> {
        self.parse_rows(log, source, json_parser::ParsedJson::parse_package_json)
    }

    /// Parses JSON source into the cache arena using `mode` to pick strict
    /// JSON vs JSONC.
    #[inline]
    pub fn parse_json(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        mode: JsonMode,
    ) -> Result<Option<bun_ast::Expr>, crate::Error> {
        // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
        // They are JSON files with comments and trailing commas.
        // Sometimes tooling expects this to work.
        self.parse(
            log,
            source,
            match mode {
                JsonMode::Jsonc => json_parser::parse_ts_config,
                JsonMode::Json => json_parser::parse_utf8,
            },
        )
    }
}

// Heuristic: you probably don't have 100 of these
// Probably like 5-10
// Array iteration is faster and deterministically ordered in that case.
// Both keys and values are owned (`Box`/`Vec`) and freed when the map drops.
pub(crate) type PathsMap = ArrayHashMap<Box<[u8]>, Vec<TSConfigPath>>;

/// One fallback entry of a `compilerOptions.paths` array.
pub(crate) struct TSConfigPath {
    pub(crate) text: Box<[u8]>,
    /// Position of the string in the file that declared it, for diagnostics after the merge.
    pub(crate) loc: bun_ast::Loc,
}

/// `compilerOptions.paths` and the file that declared it.
pub(crate) struct TSConfigPaths {
    pub(crate) map: PathsMap,
    /// Without a "baseUrl" anywhere in the chain, relative entries resolve against its directory.
    pub(crate) source_path: Box<[u8]>,
}

impl TSConfigPaths {
    pub(crate) fn source_dir(&self) -> &[u8] {
        bun_paths::dirname(&self.source_path).unwrap_or(&self.source_path)
    }
}

/// One entry of the top-level `extends` field (a string, or one item of a TypeScript 5.0 array).
pub(crate) struct TSConfigExtends {
    pub(crate) spec: Box<[u8]>,
    pub(crate) loc: bun_ast::Loc,
}

// Hand-listed Pragma fields actually used below.
#[derive(EnumSetType, Debug)]
pub(crate) enum JsxField {
    Factory,
    Fragment,
    ImportSource,
    Runtime,
    Development,
}

pub(crate) type JsxFieldSet = EnumSet<JsxField>;

/// Every field a base config can supply has an "unset" state (`None`, an empty `Box`,
/// a missing `jsx_flags` bit), so a file in an `extends` chain only overrides what it sets.
pub struct TSConfigJSON {
    pub(crate) abs_path: Box<[u8]>,

    /// The absolute path of "compilerOptions.baseUrl". Empty when unset.
    pub(crate) base_url: Box<[u8]>,

    /// Drained by `Resolver::parse_tsconfig`, so a merged config has none.
    pub(crate) extends: Vec<TSConfigExtends>,
    /// The verbatim values of "compilerOptions.paths". The keys are patterns to
    /// match and the values are arrays of fallback paths to search. Each key and
    /// each fallback path can optionally have a single "*" wildcard character.
    /// If both the key and the value have a wildcard, the substring matched by
    /// the wildcard is substituted into the fallback path. The keys represent
    /// module-style path names and the fallback paths are relative to the
    /// "baseUrl" value in the "tsconfig.json" file, or to the declaring file's
    /// directory without one (https://github.com/microsoft/TypeScript/issues/31869).
    /// `Some` whenever the key is present: `"paths": {}` clears inherited paths.
    pub(crate) paths: Option<TSConfigPaths>,

    pub jsx: options::jsx::Pragma,
    pub(crate) jsx_flags: JsxFieldSet,

    pub(crate) preserve_imports_not_used_as_values: Option<bool>,

    pub emit_decorator_metadata: Option<bool>,
    pub experimental_decorators: Option<bool>,
    /// `None` = unset (keeps native [[Define]] class-field semantics).
    pub use_define_for_class_fields: Option<bool>,
}

impl Default for TSConfigJSON {
    fn default() -> Self {
        Self {
            abs_path: Box::default(),
            base_url: Box::default(),
            extends: Vec::new(),
            paths: None,
            jsx: options::jsx::Pragma::default(),
            jsx_flags: JsxFieldSet::empty(),
            preserve_imports_not_used_as_values: None,
            emit_decorator_metadata: None,
            experimental_decorators: None,
            use_define_for_class_fields: None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImportsNotUsedAsValue {
    Preserve,
    Err,
    Remove,
    Invalid,
}

bun_core::comptime_string_map! {
    pub(crate) static IMPORTS_NOT_USED_AS_VALUE_LIST: ImportsNotUsedAsValue = {
        b"preserve" => ImportsNotUsedAsValue::Preserve,
        b"error" => ImportsNotUsedAsValue::Err,
        b"remove" => ImportsNotUsedAsValue::Remove,
    };
}

// Hidden by default, enabled via `BUN_DEBUG_alloc=1`. Tests count `new(TSConfigJSON)` /
// `destroy(TSConfigJSON)` lines to assert the extends-chain merge frees intermediates.
bun_core::declare_scope!(alloc, hidden);

impl TSConfigJSON {
    #[inline]
    pub(crate) fn new(v: Self) -> Box<Self> {
        let boxed = Box::new(v);
        if cfg!(debug_assertions) {
            bun_core::scoped_log!(alloc, "new(TSConfigJSON) = {:p}", boxed.as_ref());
        }
        boxed
    }

    // Logs under `.alloc` then frees.
    #[inline]
    pub(crate) fn destroy(boxed: Box<Self>) {
        if cfg!(debug_assertions) {
            bun_core::scoped_log!(alloc, "destroy(TSConfigJSON) = {:p}", boxed.as_ref());
        }
        drop(boxed);
    }

    pub(crate) fn has_base_url(&self) -> bool {
        !self.base_url.is_empty()
    }

    pub(crate) fn has_paths(&self) -> bool {
        self.paths.as_ref().is_some_and(|p| p.map.count() > 0)
    }

    /// What relative "paths" entries resolve against.
    pub(crate) fn paths_base_dir(&self) -> &[u8] {
        if self.has_base_url() {
            return &self.base_url;
        }
        match self.paths.as_ref() {
            Some(paths) => paths.source_dir(),
            None => b".",
        }
    }

    /// Copies every setting `other` has onto `self`.
    pub(crate) fn apply_extended_config(&mut self, mut other: Box<TSConfigJSON>) {
        if other.has_base_url() {
            self.base_url = core::mem::take(&mut other.base_url);
        }
        // tsc replaces "paths" across extends instead of merging the maps.
        if other.paths.is_some() {
            self.paths = other.paths.take();
        }
        self.jsx = other.merge_jsx(core::mem::take(&mut self.jsx));
        self.jsx_flags.insert_all(other.jsx_flags);
        if let Some(v) = other.preserve_imports_not_used_as_values {
            self.preserve_imports_not_used_as_values = Some(v);
        }
        if let Some(v) = other.emit_decorator_metadata {
            self.emit_decorator_metadata = Some(v);
        }
        if let Some(v) = other.experimental_decorators {
            self.experimental_decorators = Some(v);
        }
        if let Some(v) = other.use_define_for_class_fields {
            self.use_define_for_class_fields = Some(v);
        }
        TSConfigJSON::destroy(other);
    }

    /// Drops non-relative "paths" entries when no file in the merged chain set "baseUrl".
    /// `source` is the file that declared "paths".
    pub(crate) fn remove_paths_that_need_base_url(
        &mut self,
        log: &mut bun_ast::Log,
        source: Option<&bun_ast::Source>,
    ) {
        if self.has_base_url() {
            return;
        }
        let Some(paths) = self.paths.as_mut() else {
            return;
        };
        paths.map.retain(|_, values| {
            values.retain(|value| match source {
                Some(source) => Self::is_valid_tsconfig_path_no_base_url_pattern(
                    &value.text,
                    log,
                    source,
                    value.loc,
                ),
                None => Self::is_relative_or_absolute_path(&value.text),
            });
            !values.is_empty()
        });
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
            out.package_name.clone_from(&self.jsx.package_name);
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
    //
    // `config_dir` is the root config's directory: tsc substitutes after the merge.
    fn str_replacing_templates(
        input: Box<[u8]>,
        config_dir: &[u8],
    ) -> Result<Box<[u8]>, bun_alloc::AllocError> {
        const TEMPLATE: &[u8] = b"${configDir}";
        let mut remaining: &[u8] = &input;
        let mut string_builder = bun_core::StringBuilder {
            len: 0,
            cap: 0,
            ptr: None,
        };

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

        let len = string_builder.len - 1;
        let written = string_builder.allocated_slice();
        Ok(Box::from(&written[..len]))
    }

    /// Parses one file. `extends` is recorded, not followed.
    pub fn parse(
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        json_cache: &mut JsonCache,
        config_dir: &[u8],
    ) -> Result<Option<Box<TSConfigJSON>>, crate::Error> {
        // Unfortunately "tsconfig.json" isn't actually JSON. It's some other
        // format that appears to be defined by the implementation details of the
        // TypeScript compiler.
        //
        // Attempt to parse it anyway by modifying the JSON parser, but just for
        // these particular files. This is likely not a completely accurate
        // emulation of what the TypeScript compiler does (e.g. string escape
        // behavior may also be different).

        let parsed = match json_cache.parse_tsconfig(log, source).ok().flatten() {
            Some(p) => p,
            None => return Ok(None),
        };
        let json: bun_ast::Expr = parsed.root;

        bun_analytics::features::tsconfig.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        let mut result = TSConfigJSON {
            abs_path: Box::from(source.path.text),
            ..Default::default()
        };
        // PERF: avoid re-scanning each JSON object's
        // property vector once per field — `expr.asProperty(...)` is an O(n)
        // linear scan, and there are ~11 of them on `compilerOptions` plus 2 on
        // the top-level object, so a typical tsconfig walks `compilerOptions`
        // ~11×. Instead, do a single pass over each object's property list,
        // recording the *first* occurrence of each key we care about (matching
        // `asProperty`'s "first match wins" semantics via the `Option::is_none`
        // guards), then handle them below in the original fixed order so any
        // inter-field ordering (`baseUrl` before `paths`, `jsx` before
        // `jsxImportSource`) is preserved.
        let mut extends_value: Option<(&bun_ast::E::JsonValue, bun_ast::Loc)> = None;
        let mut compiler_opts: Option<&bun_ast::E::JsonValue> = None;
        if let bun_ast::ExprData::EObjectJSON(obj) = &json.data {
            for property in obj.get().properties() {
                match property.key.slice() {
                    b"extends" if extends_value.is_none() => {
                        extends_value = Some((&property.value, property.key_loc))
                    }
                    b"compilerOptions" if compiler_opts.is_none() => {
                        compiler_opts = Some(&property.value)
                    }
                    _ => {}
                }
            }
        }

        // Parse "extends": a string, or an array of strings (TypeScript 5.0).
        if let Some((extends_value, key_loc)) = extends_value {
            let value_loc =
                json_parser::property_value_loc(&source.contents, key_loc).unwrap_or(key_loc);
            if let Some(str) = extends_value.as_str() {
                result.extends.push(TSConfigExtends {
                    spec: Box::from(str),
                    loc: value_loc,
                });
            } else if let Some(array) = extends_value.as_array() {
                let mut item_cursor = json_parser::array_item_loc(&source.contents, value_loc, 0);
                for item in array.items() {
                    let item_loc = item_cursor.unwrap_or(value_loc);
                    item_cursor = item_cursor
                        .and_then(|cur| json_parser::array_next_item_loc(&source.contents, cur));
                    if let Some(str) = item.as_str() {
                        result.extends.push(TSConfigExtends {
                            spec: Box::from(str),
                            loc: item_loc,
                        });
                    }
                }
            }
        }

        // Parse "compilerOptions"
        if let Some(compiler_opts) = compiler_opts {
            // Single pass over `compilerOptions`' properties; first occurrence
            // of each key wins (matching `asProperty`).
            let mut base_url_v: Option<&bun_ast::E::JsonValue> = None;
            let mut emit_decorator_metadata_v: Option<&bun_ast::E::JsonValue> = None;
            let mut experimental_decorators_v: Option<&bun_ast::E::JsonValue> = None;
            let mut use_define_for_class_fields_v: Option<&bun_ast::E::JsonValue> = None;
            let mut jsx_factory_v: Option<(&bun_ast::E::JsonValue, bun_ast::Loc)> = None;
            let mut jsx_fragment_factory_v: Option<(&bun_ast::E::JsonValue, bun_ast::Loc)> = None;
            let mut jsx_v: Option<&bun_ast::E::JsonValue> = None;
            let mut jsx_import_source_v: Option<&bun_ast::E::JsonValue> = None;
            let mut imports_not_used_v: Option<(&bun_ast::E::JsonValue, bun_ast::Loc)> = None;
            let mut module_suffixes_v: Option<(&bun_ast::E::JsonValue, bun_ast::Loc)> = None;
            let mut paths_v: Option<&bun_ast::E::JsonValue> = None;

            if let Some(obj) = compiler_opts.as_object() {
                for property in obj.properties() {
                    let value = &property.value;
                    let loc = property.key_loc;
                    match property.key.slice() {
                        b"baseUrl" if base_url_v.is_none() => base_url_v = Some(value),
                        b"emitDecoratorMetadata" if emit_decorator_metadata_v.is_none() => {
                            emit_decorator_metadata_v = Some(value)
                        }
                        b"experimentalDecorators" if experimental_decorators_v.is_none() => {
                            experimental_decorators_v = Some(value)
                        }
                        b"useDefineForClassFields" if use_define_for_class_fields_v.is_none() => {
                            use_define_for_class_fields_v = Some(value)
                        }
                        b"jsxFactory" if jsx_factory_v.is_none() => {
                            jsx_factory_v = Some((value, loc))
                        }
                        b"jsxFragmentFactory" if jsx_fragment_factory_v.is_none() => {
                            jsx_fragment_factory_v = Some((value, loc))
                        }
                        b"jsx" if jsx_v.is_none() => jsx_v = Some(value),
                        b"jsxImportSource" if jsx_import_source_v.is_none() => {
                            jsx_import_source_v = Some(value)
                        }
                        b"importsNotUsedAsValues" if imports_not_used_v.is_none() => {
                            imports_not_used_v = Some((value, loc))
                        }
                        b"moduleSuffixes" if module_suffixes_v.is_none() => {
                            module_suffixes_v = Some((value, loc))
                        }
                        b"paths" if paths_v.is_none() => paths_v = Some(value),
                        _ => {}
                    }
                }
            }

            // Parse "baseUrl"
            if let Some(base_url_prop) = base_url_v {
                if let Some(base_url) = base_url_prop.as_str() {
                    // tsc resolves "" against the config directory, the same as ".".
                    let base_url: &[u8] = if base_url.is_empty() { b"." } else { base_url };
                    result.base_url =
                        match Self::str_replacing_templates(Box::from(base_url), config_dir) {
                            Ok(v) => v,
                            Err(_) => return Ok(None),
                        };
                }
            }

            // Parse "emitDecoratorMetadata"
            if let Some(&bun_ast::E::JsonValue::Boolean(val)) = emit_decorator_metadata_v {
                result.emit_decorator_metadata = Some(val);
            }

            // Parse "experimentalDecorators"
            if let Some(&bun_ast::E::JsonValue::Boolean(val)) = experimental_decorators_v {
                result.experimental_decorators = Some(val);
            }

            // Parse "useDefineForClassFields"
            if let Some(&bun_ast::E::JsonValue::Boolean(val)) = use_define_for_class_fields_v {
                result.use_define_for_class_fields = Some(val);
            }

            // Parse "jsxFactory"
            if let Some((jsx_prop, loc)) = jsx_factory_v {
                if let Some(factory) = jsx_prop
                    .as_str()
                    .and_then(|str| Self::parse_member_expression_for_jsx(log, source, loc, str))
                {
                    result.jsx.factory = factory.into();
                    result.jsx_flags.insert(JsxField::Factory);
                }
            }

            // Parse "jsxFragmentFactory"
            if let Some((jsx_prop, loc)) = jsx_fragment_factory_v {
                if let Some(fragment) = jsx_prop
                    .as_str()
                    .and_then(|str| Self::parse_member_expression_for_jsx(log, source, loc, str))
                {
                    result.jsx.fragment = fragment.into();
                    result.jsx_flags.insert(JsxField::Fragment);
                }
            }

            // https://www.typescriptlang.org/docs/handbook/jsx.html#basic-usages
            if let Some(jsx_prop) = jsx_v {
                if let Some(str) = jsx_prop.as_str() {
                    // PERF: lowercase into a fixed stack buffer instead of
                    // allocating before the map lookup. `RUNTIME_MAP`'s keys
                    // are all lowercase ASCII and the longest
                    // (`b"react-jsxdev"`) is 12 bytes, so a longer value can't
                    // match (`ascii_lowercase_buf` returns `None` when it
                    // can't fit).
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
                if let Some(str) = jsx_prop.as_str() {
                    if str.len() >= b"solid-js".len() && &str[..b"solid-js".len()] == b"solid-js" {
                        result.jsx.runtime = options::jsx::Runtime::Solid;
                        result.jsx_flags.insert(JsxField::Runtime);
                    }

                    result.jsx.package_name = str.to_vec().into();
                    result.jsx.set_import_source();
                    result.jsx_flags.insert(JsxField::ImportSource);
                }
            }

            // Parse "importsNotUsedAsValues"
            if let Some((jsx_prop, loc)) = imports_not_used_v {
                // This should never allocate since it will be utf8
                if let Some(str) = jsx_prop.as_str() {
                    match IMPORTS_NOT_USED_AS_VALUE_LIST
                        .get(str)
                        .copied()
                        .unwrap_or(ImportsNotUsedAsValue::Invalid)
                    {
                        ImportsNotUsedAsValue::Preserve | ImportsNotUsedAsValue::Err => {
                            result.preserve_imports_not_used_as_values = Some(true);
                        }
                        ImportsNotUsedAsValue::Remove => {
                            result.preserve_imports_not_used_as_values = Some(false);
                        }
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
                        let Some(array) = prefixes.as_array() else {
                            break 'handle_module_prefixes;
                        };
                        for element in array.items() {
                            if let Some(str) = element.as_str() {
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
                if let Some(paths) = paths_prop.as_object() {
                    bun_analytics::features::tsconfig_paths
                        .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

                    let mut paths_map = PathsMap::default();
                    for property in paths.properties() {
                        let key = property.key.slice();
                        let key_loc = property.key_loc;

                        if !Self::is_valid_tsconfig_path_pattern(key, log, source, key_loc) {
                            continue;
                        }

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
                        match &property.value {
                            bun_ast::E::JsonValue::Array(e_array) => {
                                let array = e_array.get().items();

                                if !array.is_empty() {
                                    let mut values: Vec<TSConfigPath> =
                                        Vec::with_capacity(array.len());
                                    let array_loc =
                                        json_parser::property_value_loc(&source.contents, key_loc)
                                            .unwrap_or(key_loc);
                                    let mut item_cursor =
                                        json_parser::array_item_loc(&source.contents, array_loc, 0);
                                    for item in array.iter() {
                                        let item_loc = item_cursor.unwrap_or(key_loc);
                                        item_cursor = item_cursor.and_then(|cur| {
                                            json_parser::array_next_item_loc(&source.contents, cur)
                                        });
                                        if let Some(str_) = item.as_str() {
                                            let str = match Self::str_replacing_templates(
                                                Box::from(str_),
                                                config_dir,
                                            ) {
                                                Ok(v) => v,
                                                Err(_) => return Ok(None),
                                            };
                                            // Another file of the chain can supply "baseUrl":
                                            // `remove_paths_that_need_base_url` checks later.
                                            if Self::is_valid_tsconfig_path_pattern(
                                                &str, log, source, item_loc,
                                            ) {
                                                values.push(TSConfigPath {
                                                    text: str,
                                                    loc: item_loc,
                                                });
                                            }
                                        }
                                    }
                                    if !values.is_empty() {
                                        values.shrink_to_fit();
                                        let _ = paths_map.put(Box::from(key), values);
                                    }
                                }
                            }
                            _ => {
                                let _ = log.add_range_warning_fmt(
                                    Some(source),
                                    source.range_of_string(key_loc),
                                    format_args!(
                                        "Substitutions for pattern \"{}\" should be an array",
                                        bstr::BStr::new(key)
                                    ),
                                );
                            }
                        }
                    }
                    result.paths = Some(TSConfigPaths {
                        map: paths_map,
                        source_path: Box::from(source.path.text),
                    });
                }
            }
        }

        Ok(Some(TSConfigJSON::new(result)))
    }

    pub(crate) fn is_valid_tsconfig_path_pattern(
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

    /// `"React.createElement"` => `["React", "createElement"]`. `None` (after
    /// a warning, unless `text` is empty) when `text` is not a dotted chain
    /// of identifiers.
    pub(crate) fn parse_member_expression_for_jsx(
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
        text: &[u8],
    ) -> Option<Box<[Box<[u8]>]>> {
        if text.is_empty() {
            return None;
        }

        let mut parts = strings::tokenize(text, b".").peekable();
        // Text made of dots only ("." or "..") has no parts; report the whole text.
        let invalid = if parts.peek().is_none() {
            Some(text)
        } else {
            parts.find(|part| !js_lexer::is_identifier(part))
        };

        if let Some(invalid) = invalid {
            let warn = source.range_of_string(loc);
            let _ = log.add_range_warning_fmt(
                Some(source),
                warn,
                format_args!(
                    "Invalid JSX member expression: \"{}\"",
                    bstr::BStr::new(invalid)
                ),
            );
            return None;
        }

        Some(strings::tokenize(text, b".").map(Box::from).collect())
    }

    fn is_relative_or_absolute_path(text: &[u8]) -> bool {
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
        bun_paths::is_sep_any(c0)
    }

    pub(crate) fn is_valid_tsconfig_path_no_base_url_pattern(
        text: &[u8],
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        loc: bun_ast::Loc,
    ) -> bool {
        if Self::is_relative_or_absolute_path(text) {
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

    // `Box<TSConfigJSON>` drop handles cleanup: PathsMap has Drop, and Box
    // frees the allocation. No explicit Drop needed.
}
