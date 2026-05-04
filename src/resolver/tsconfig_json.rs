use bun_bundler::cache;
use bun_bundler::options;
use bun_collections::ArrayHashMap;
use bun_js_parser as js_ast;
use bun_js_parser::lexer as js_lexer;
use bun_logger as logger;
use bun_str::strings;
use enumset::{EnumSet, EnumSetType};

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
        // TODO(port): bun.StringBuilder — confirm crate path (count/allocate/append two-pass builder)
        let mut string_builder = bun_str::StringBuilder::default();
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

        let len = string_builder.len() - 1;
        Ok(Box::from(&string_builder.allocated_slice()[..len]))
        // PERF(port): Zig returned a sub-slice into the builder's single allocation; Rust copies once.
    }

    pub fn parse(
        log: &mut logger::Log,
        source: &logger::Source,
        json_cache: &mut cache::Json,
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

        bun_analytics::Features::tsconfig_inc();

        let mut result = TSConfigJSON {
            abs_path: Box::from(source.path.text.as_ref()),
            paths: PathsMap::default(),
            ..Default::default()
        };
        // errdefer allocator.free(result.paths) — handled by Drop on `result`.
        if let Some(extends_value) = json.as_property(b"extends") {
            if !source.path.is_node_module() {
                if let Some(str) = extends_value.expr.as_string() {
                    result.extends = str;
                }
            }
        }
        let mut has_base_url = false;

        // Parse "compilerOptions"
        if let Some(compiler_opts) = json.as_property(b"compilerOptions") {
            // Parse "baseUrl"
            if let Some(base_url_prop) = compiler_opts.expr.as_property(b"baseUrl") {
                if let Some(base_url) = base_url_prop.expr.as_string() {
                    result.base_url = match Self::str_replacing_templates(base_url, source) {
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
                if let Some(str) = jsx_prop.expr.as_string() {
                    result.jsx.factory =
                        Self::parse_member_expression_for_jsx(log, source, jsx_prop.loc, &str)?;
                    result.jsx_flags.insert(JsxField::Factory);
                }
            }

            // Parse "jsxFragmentFactory"
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"jsxFragmentFactory") {
                if let Some(str) = jsx_prop.expr.as_string() {
                    result.jsx.fragment =
                        Self::parse_member_expression_for_jsx(log, source, jsx_prop.loc, &str)?;
                    result.jsx_flags.insert(JsxField::Fragment);
                }
            }

            // https://www.typescriptlang.org/docs/handbook/jsx.html#basic-usages
            if let Some(jsx_prop) = compiler_opts.expr.as_property(b"jsx") {
                if let Some(str) = jsx_prop.expr.as_string() {
                    let mut str_lower = vec![0u8; str.len()];
                    let _ = strings::copy_lowercase(&str, &mut str_lower);
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
                if let Some(str) = jsx_prop.expr.as_string() {
                    if str.len() >= b"solid-js".len() && &str[..b"solid-js".len()] == b"solid-js" {
                        result.jsx.runtime = options::jsx::Runtime::Solid;
                        result.jsx_flags.insert(JsxField::Runtime);
                    }

                    result.jsx.package_name = str;
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
                if let Some(str) = jsx_prop.expr.as_string() {
                    match IMPORTS_NOT_USED_AS_VALUE_LIST
                        .get(str.as_ref())
                        .copied()
                        .unwrap_or(ImportsNotUsedAsValue::Invalid)
                    {
                        ImportsNotUsedAsValue::Preserve | ImportsNotUsedAsValue::Err => {
                            result.preserve_imports_not_used_as_values = Some(true);
                        }
                        ImportsNotUsedAsValue::Remove => {}
                        _ => {
                            let _ = log.add_range_warning_fmt(
                                source,
                                source.range_of_string(jsx_prop.loc),
                                format_args!(
                                    "Invalid value \"{}\" for \"importsNotUsedAsValues\"",
                                    bstr::BStr::new(&str)
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
                            if let Some(str) = element.as_string() {
                                if !str.is_empty() {
                                    // Only warn when there is actually content
                                    // Sometimes, people do "moduleSuffixes": [""]
                                    let _ = log.add_warning(
                                        source,
                                        prefixes.loc,
                                        "moduleSuffixes is not supported yet",
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
                    bun_analytics::Features::tsconfig_paths_inc();

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
                        let Some(key) = key_prop.as_string() else {
                            continue;
                        };

                        if !Self::is_valid_tsconfig_path_pattern(&key, log, source, key_prop.loc) {
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
                                let array = e_array.slice();

                                if !array.is_empty() {
                                    let mut values: Vec<Box<[u8]>> =
                                        Vec::with_capacity(array.len());
                                    // errdefer allocator.free(values) — handled by Drop.
                                    for expr in array {
                                        if let Some(str_) = expr.as_string() {
                                            let str = match Self::str_replacing_templates(
                                                str_, source,
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
                                        result.paths.put(key, values);
                                    }
                                    // else: Every entry was invalid; nothing to store. `values` drops here.
                                }
                            }
                            _ => {
                                let _ = log.add_range_warning_fmt(
                                    source,
                                    source.range_of_string(key_prop.loc),
                                    format_args!(
                                        "Substitutions for pattern \"{}\" should be an array",
                                        bstr::BStr::new(&key)
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
                        source,
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
                    source,
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
                    source,
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
            source,
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
//   todos:      3
//   notes:      String fields modeled as Box<[u8]> (Zig never freed them — resolver-lifetime); JsxField enum hand-listed (no FieldEnum reflection); Expr.as_string/as_property/ExprData shapes assumed from bun_js_parser; ImportsNotUsedAsValue::List moved to module-level static (no associated statics in Rust).
// ──────────────────────────────────────────────────────────────────────────
