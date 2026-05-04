use core::ffi::c_void;

use bun_core::Output;
use bun_str::{self as strings, String as BunString, ZigString};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, JsError};
use bun_logger as logger;
use bun_paths as resolve_path;
use bun_resolver::{self as resolver, fs as Fs};
use bun_bundler::options::{self, Loader, Target};
use bun_bundler::BundleV2;
use bun_options_types::{CompileTarget, ImportKind};
use bun_js_parser::ast::Index;
use bun_interchange::api; // bun.schema.api
use bun_runtime::webcore::Blob;
use bun_collections::{StringHashMap, StringSet, StringMap, StringArrayHashMap};
use bun_core::MutableString;

bun_output::declare_scope!(Transpiler, visible);

pub mod js_bundler {
    use super::*;

    type OwnedString = MutableString;

    /// A map of file paths to their in-memory contents.
    /// This allows bundling with virtual files that may not exist on disk.
    #[derive(Default)]
    pub struct FileMap {
        pub map: StringHashMap<jsc::node::BlobOrStringOrBuffer>,
    }

    impl FileMap {
        pub fn deinit_and_unprotect(&mut self) {
            for (key, value) in self.map.drain() {
                value.deinit_and_unprotect();
                drop(key);
            }
            // map dropped automatically
        }

        /// Resolve a specifier against the file map.
        /// Returns the contents if the specifier exactly matches a key in the map,
        /// or if the specifier is a relative path that, when joined with a source
        /// directory, matches a key in the map.
        pub fn get(&self, specifier: &[u8]) -> Option<&[u8]> {
            if self.map.len() == 0 {
                return None;
            }

            #[cfg(not(windows))]
            {
                let entry = self.map.get(specifier)?;
                return Some(entry.slice());
            }

            #[cfg(windows)]
            {
                // Normalize backslashes to forward slashes for consistent lookup
                // Map keys are stored with forward slashes (normalized in fromJS)
                let buf = bun_paths::path_buffer_pool().get();
                let normalized = bun_paths::path_to_posix_buf::<u8>(specifier, &mut buf);
                let entry = self.map.get(normalized)?;
                Some(entry.slice())
            }
        }

        /// Check if the file map contains a given specifier.
        pub fn contains(&self, specifier: &[u8]) -> bool {
            if self.map.len() == 0 {
                return false;
            }

            #[cfg(not(windows))]
            {
                return self.map.contains_key(specifier);
            }

            #[cfg(windows)]
            {
                // Normalize backslashes to forward slashes for consistent lookup
                let buf = bun_paths::path_buffer_pool().get();
                let normalized = bun_paths::path_to_posix_buf::<u8>(specifier, &mut buf);
                self.map.contains_key(normalized)
            }
        }

        /// Returns a resolver Result for a file in the map, or null if not found.
        /// This creates a minimal Result that can be used by the bundler.
        ///
        /// source_file: The path of the importing file (may be relative or absolute)
        /// specifier: The import specifier (e.g., "./utils.js" or "/lib.js")
        pub fn resolve(&self, source_file: &[u8], specifier: &[u8]) -> Option<resolver::Result> {
            // Fast path: if the map is empty, return immediately
            if self.map.len() == 0 {
                return None;
            }

            // Check if the specifier is directly in the map
            // Must use getKey to return the map's owned key, not the parameter
            #[cfg(not(windows))]
            {
                if let Some(key) = self.map.get_key(specifier) {
                    return Some(resolver::Result {
                        path_pair: resolver::PathPair {
                            primary: Fs::Path::init_with_namespace(key, b"file"),
                            ..Default::default()
                        },
                        module_type: resolver::ModuleType::Unknown,
                        ..Default::default()
                    });
                }
            }
            #[cfg(windows)]
            {
                let buf = bun_paths::path_buffer_pool().get();
                let normalized_specifier = bun_paths::path_to_posix_buf::<u8>(specifier, &mut buf);

                if let Some(key) = self.map.get_key(normalized_specifier) {
                    return Some(resolver::Result {
                        path_pair: resolver::PathPair {
                            primary: Fs::Path::init_with_namespace(key, b"file"),
                            ..Default::default()
                        },
                        module_type: resolver::ModuleType::Unknown,
                        ..Default::default()
                    });
                }
            }

            // Also try with source directory joined for relative specifiers
            // Check for relative specifiers (not starting with / and not Windows absolute like C:/)
            if !specifier.is_empty()
                && specifier[0] != b'/'
                && !(specifier.len() >= 3
                    && specifier[1] == b':'
                    && (specifier[2] == b'/' || specifier[2] == b'\\'))
            {
                // First, ensure source_file is absolute. It may be relative (e.g., "../../Windows/Temp/...")
                // on Windows when the bundler stores paths relative to cwd.
                let mut abs_source_buf = bun_paths::path_buffer_pool().get();
                let abs_source_file = if Self::is_absolute_path(source_file) {
                    source_file
                } else {
                    Fs::FileSystem::instance().abs_buf(&[source_file], &mut abs_source_buf)
                };

                // Normalize source_file to use forward slashes (for Windows compatibility)
                // On Windows, source_file may have backslashes from the real filesystem
                // Use pathToPosixBuf which always converts \ to / regardless of platform
                let mut source_file_buf = bun_paths::path_buffer_pool().get();
                let normalized_source_file =
                    bun_paths::path_to_posix_buf::<u8>(abs_source_file, &mut source_file_buf);

                // Extract directory from source_file using posix path handling
                // For "/entry.js", we want "/"; for "/src/index.js", we want "/src/"
                // For "C:/foo/bar.js", we want "C:/foo"
                let mut buf = bun_paths::path_buffer_pool().get();
                let source_dir = bun_paths::dirname(normalized_source_file, bun_paths::Platform::Posix);
                // If dirname returns empty but path starts with drive letter, extract the drive + root
                let effective_source_dir: &[u8] = if source_dir.is_empty() {
                    if normalized_source_file.len() >= 3
                        && normalized_source_file[1] == b':'
                        && normalized_source_file[2] == b'/'
                    {
                        &normalized_source_file[0..3] // "C:/"
                    } else if !normalized_source_file.is_empty() && normalized_source_file[0] == b'/' {
                        b"/"
                    } else {
                        Fs::FileSystem::instance().top_level_dir()
                    }
                } else {
                    source_dir
                };
                // Use .loose to preserve Windows drive letters, then normalize in-place on Windows
                let joined_len = bun_paths::join_abs_string_buf(
                    effective_source_dir,
                    &mut buf,
                    &[specifier],
                    bun_paths::Platform::Loose,
                )
                .len();
                if cfg!(windows) {
                    bun_paths::platform_to_posix_in_place::<u8>(&mut buf[0..joined_len]);
                }
                let joined = &buf[0..joined_len];
                // Must use getKey to return the map's owned key, not the temporary buffer
                if let Some(key) = self.map.get_key(joined) {
                    return Some(resolver::Result {
                        path_pair: resolver::PathPair {
                            primary: Fs::Path::init_with_namespace(key, b"file"),
                            ..Default::default()
                        },
                        module_type: resolver::ModuleType::Unknown,
                        ..Default::default()
                    });
                }
            }

            None
        }

        /// Check if a path is absolute (works for both posix and Windows paths)
        fn is_absolute_path(path: &[u8]) -> bool {
            if path.is_empty() {
                return false;
            }
            // Posix absolute path
            if path[0] == b'/' {
                return true;
            }
            // Windows absolute path with drive letter (e.g., "C:\..." or "C:/...")
            if path.len() >= 3 && path[1] == b':' && (path[2] == b'/' || path[2] == b'\\') {
                return matches!(path[0], b'a'..=b'z' | b'A'..=b'Z');
            }
            // Windows UNC path (e.g., "\\server\share")
            if path.len() >= 2 && path[0] == b'\\' && path[1] == b'\\' {
                return true;
            }
            false
        }

        /// Parse the files option from JavaScript.
        /// Expected format: Record<string, string | Blob | File | TypedArray | ArrayBuffer>
        /// Uses async parsing for cross-thread safety since bundler runs on a separate thread.
        pub fn from_js(global_this: &JSGlobalObject, files_value: JSValue) -> JsResult<FileMap> {
            let mut this = FileMap::default();
            // errdefer this.deinit_and_unprotect() — handled by Drop on error path
            // TODO(port): errdefer — FileMap doesn't impl Drop because deinit_and_unprotect
            // touches JS values; use scopeguard
            let guard = scopeguard::guard(&mut this, |s| s.deinit_and_unprotect());

            let Some(files_obj) = files_value.get_object() else {
                return global_this.throw_invalid_arguments("Expected files to be an object", &[]);
            };

            let mut files_iter = jsc::JSPropertyIterator::init(
                global_this,
                files_obj,
                jsc::JSPropertyIteratorOptions {
                    skip_empty_name: true,
                    include_value: true,
                },
            )?;

            // PORT NOTE: reshaped for borrowck — extract len before mutating through guard
            guard.map.reserve(usize::from(files_iter.len()));

            while let Some(prop) = files_iter.next()? {
                let property_value = files_iter.value;

                // Parse the value as BlobOrStringOrBuffer using async mode for thread safety
                let Some(blob_or_string) =
                    jsc::node::BlobOrStringOrBuffer::from_js_async(global_this, property_value)?
                else {
                    return global_this.throw_invalid_arguments(
                        "Expected file content to be a string, Blob, File, TypedArray, or ArrayBuffer",
                        &[],
                    );
                };
                // errdefer blob_or_string.deinitAndUnprotect() — handled below via scopeguard if needed
                // TODO(port): errdefer for blob_or_string

                // Clone the key since we need to own it
                let mut key = prop.to_owned_slice()?;

                // Normalize backslashes to forward slashes for cross-platform consistency
                // This ensures Windows paths like "C:\foo\bar.js" become "C:/foo/bar.js"
                // Use dangerouslyConvertPathToPosixInPlace which always converts \ to /
                // (uses sep_windows constant, not sep which varies by target)
                bun_paths::dangerously_convert_path_to_posix_in_place::<u8>(&mut key);

                // PERF(port): was assume_capacity
                guard.map.insert(key, blob_or_string);
            }

            drop(files_iter);
            let _ = scopeguard::ScopeGuard::into_inner(guard);
            Ok(this)
        }
    }

    pub struct Config {
        pub target: Target,
        pub entry_points: StringSet,
        pub hot: bool,
        pub react_fast_refresh: bool,
        pub define: StringMap,
        pub loaders: Option<api::LoaderMap>,
        pub dir: OwnedString,
        pub outdir: OwnedString,
        pub rootdir: OwnedString,
        pub serve: Serve,
        pub jsx: api::Jsx,
        pub force_node_env: options::bundle_options::ForceNodeEnv,
        pub code_splitting: bool,
        pub minify: Minify,
        pub no_macros: bool,
        pub ignore_dce_annotations: bool,
        pub emit_dce_annotations: Option<bool>,
        pub names: Names,
        pub external: StringSet,
        pub allow_unresolved: Option<StringSet>,
        pub source_map: options::SourceMapOption,
        pub public_path: OwnedString,
        pub conditions: StringSet,
        pub packages: options::PackagesOption,
        pub format: options::Format,
        pub bytecode: bool,
        pub banner: OwnedString,
        pub footer: OwnedString,
        /// Path to write JSON metafile (if specified via metafile object) - TEST: moved here
        pub metafile_json_path: OwnedString,
        /// Path to write markdown metafile (if specified via metafile object) - TEST: moved here
        pub metafile_markdown_path: OwnedString,
        pub css_chunking: bool,
        pub drop: StringSet,
        pub features: StringSet,
        pub has_any_on_before_parse: bool,
        pub throw_on_error: bool,
        pub env_behavior: api::DotEnvBehavior,
        pub env_prefix: OwnedString,
        pub tsconfig_override: OwnedString,
        pub compile: Option<CompileOptions>,
        /// In-memory files that can be used as entrypoints or imported.
        /// These files do not need to exist on disk.
        pub files: FileMap,
        /// Generate metafile (JSON module graph)
        pub metafile: bool,
        /// Package names whose barrel files should be optimized.
        /// Named imports from these packages will only load the submodules
        /// that are actually used instead of parsing all re-exported submodules.
        pub optimize_imports: StringSet,
    }

    impl Default for Config {
        fn default() -> Self {
            Self {
                target: Target::Browser,
                entry_points: StringSet::default(),
                hot: false,
                react_fast_refresh: false,
                define: StringMap::new(false),
                loaders: None,
                dir: OwnedString::default(),
                outdir: OwnedString::default(),
                rootdir: OwnedString::default(),
                serve: Serve::default(),
                jsx: api::Jsx {
                    factory: Box::default(),
                    fragment: Box::default(),
                    runtime: api::JsxRuntime::Automatic,
                    import_source: Box::default(),
                    development: true, // Default to development mode like old Pragma
                    ..Default::default()
                },
                force_node_env: options::bundle_options::ForceNodeEnv::Unspecified,
                code_splitting: false,
                minify: Minify::default(),
                no_macros: false,
                ignore_dce_annotations: false,
                emit_dce_annotations: None,
                names: Names::default(),
                external: StringSet::default(),
                allow_unresolved: None,
                source_map: options::SourceMapOption::None,
                public_path: OwnedString::default(),
                conditions: StringSet::default(),
                packages: options::PackagesOption::Bundle,
                format: options::Format::Esm,
                bytecode: false,
                banner: OwnedString::default(),
                footer: OwnedString::default(),
                metafile_json_path: OwnedString::default(),
                metafile_markdown_path: OwnedString::default(),
                css_chunking: false,
                drop: StringSet::default(),
                features: StringSet::default(),
                has_any_on_before_parse: false,
                throw_on_error: true,
                env_behavior: api::DotEnvBehavior::Disable,
                env_prefix: OwnedString::default(),
                tsconfig_override: OwnedString::default(),
                compile: None,
                files: FileMap::default(),
                metafile: false,
                optimize_imports: StringSet::default(),
            }
        }
    }

    pub struct CompileOptions {
        pub compile_target: CompileTarget,
        pub exec_argv: OwnedString,
        pub executable_path: OwnedString,
        pub windows_hide_console: bool,
        pub windows_icon_path: OwnedString,
        pub windows_title: OwnedString,
        pub windows_publisher: OwnedString,
        pub windows_version: OwnedString,
        pub windows_description: OwnedString,
        pub windows_copyright: OwnedString,
        pub outfile: OwnedString,
        pub autoload_dotenv: bool,
        pub autoload_bunfig: bool,
        pub autoload_tsconfig: bool,
        pub autoload_package_json: bool,
    }

    impl Default for CompileOptions {
        fn default() -> Self {
            Self {
                compile_target: CompileTarget::default(),
                exec_argv: OwnedString::default(),
                executable_path: OwnedString::default(),
                windows_hide_console: false,
                windows_icon_path: OwnedString::default(),
                windows_title: OwnedString::default(),
                windows_publisher: OwnedString::default(),
                windows_version: OwnedString::default(),
                windows_description: OwnedString::default(),
                windows_copyright: OwnedString::default(),
                outfile: OwnedString::default(),
                autoload_dotenv: true,
                autoload_bunfig: true,
                autoload_tsconfig: false,
                autoload_package_json: false,
            }
        }
    }

    impl CompileOptions {
        pub fn from_js(
            global_this: &JSGlobalObject,
            config: JSValue,
            compile_target: Option<CompileTarget>,
        ) -> JsResult<Option<CompileOptions>> {
            let mut this = CompileOptions {
                compile_target: compile_target.unwrap_or_default(),
                ..Default::default()
            };
            // errdefer this.deinit() — Drop handles owned fields

            let object = 'brk: {
                let Some(compile_value) = config.get_truthy(global_this, "compile")? else {
                    return Ok(None);
                };

                if compile_value.is_boolean() {
                    if compile_value == JSValue::FALSE {
                        return Ok(None);
                    }
                    return Ok(Some(this));
                } else if compile_value.is_string() {
                    this.compile_target = CompileTarget::from_js(global_this, compile_value)?;
                    return Ok(Some(this));
                } else if compile_value.is_object() {
                    break 'brk compile_value;
                } else {
                    return global_this.throw_invalid_arguments(
                        "Expected compile to be a boolean or string or options object",
                        &[],
                    );
                }
            };

            if let Some(target) = object.get_own(global_this, "target")? {
                this.compile_target = CompileTarget::from_js(global_this, target)?;
            }

            if let Some(exec_argv) = object.get_own_array(global_this, "execArgv")? {
                let mut iter = exec_argv.array_iterator(global_this)?;
                let mut is_first = true;
                while let Some(arg) = iter.next()? {
                    let slice = arg.to_slice(global_this)?;
                    if is_first {
                        is_first = false;
                        this.exec_argv.append_slice(slice.slice())?;
                    } else {
                        this.exec_argv.append_char(b' ')?;
                        this.exec_argv.append_slice(slice.slice())?;
                    }
                }
            }

            if let Some(executable_path) = object.get_own(global_this, "executablePath")? {
                let slice = executable_path.to_slice(global_this)?;
                if bun_sys::exists_at_type(bun_sys::Fd::cwd(), slice.slice())
                    .unwrap_or(bun_sys::FileType::Directory)
                    != bun_sys::FileType::File
                {
                    return global_this.throw_invalid_arguments(
                        "executablePath must be a valid path to a Bun executable",
                        &[],
                    );
                }

                this.executable_path.append_slice_exact(slice.slice())?;
            }

            if let Some(windows) = object.get_own_truthy(global_this, "windows")? {
                if !windows.is_object() {
                    return global_this.throw_invalid_arguments("windows must be an object", &[]);
                }

                if let Some(hide_console) = windows.get_own(global_this, "hideConsole")? {
                    this.windows_hide_console = hide_console.to_boolean();
                }

                if let Some(windows_icon_path) = windows.get_own(global_this, "icon")? {
                    let slice = windows_icon_path.to_slice(global_this)?;
                    if bun_sys::exists_at_type(bun_sys::Fd::cwd(), slice.slice())
                        .unwrap_or(bun_sys::FileType::Directory)
                        != bun_sys::FileType::File
                    {
                        return global_this.throw_invalid_arguments(
                            "windows.icon must be a valid path to an ico file",
                            &[],
                        );
                    }

                    this.windows_icon_path.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_title) = windows.get_own(global_this, "title")? {
                    let slice = windows_title.to_slice(global_this)?;
                    this.windows_title.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_publisher) = windows.get_own(global_this, "publisher")? {
                    let slice = windows_publisher.to_slice(global_this)?;
                    this.windows_publisher.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_version) = windows.get_own(global_this, "version")? {
                    let slice = windows_version.to_slice(global_this)?;
                    this.windows_version.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_description) = windows.get_own(global_this, "description")? {
                    let slice = windows_description.to_slice(global_this)?;
                    this.windows_description.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_copyright) = windows.get_own(global_this, "copyright")? {
                    let slice = windows_copyright.to_slice(global_this)?;
                    this.windows_copyright.append_slice_exact(slice.slice())?;
                }
            }

            if let Some(outfile) = object.get_own(global_this, "outfile")? {
                let slice = outfile.to_slice(global_this)?;
                this.outfile.append_slice_exact(slice.slice())?;
            }

            if let Some(autoload_dotenv) = object.get_boolean_loose(global_this, "autoloadDotenv")? {
                this.autoload_dotenv = autoload_dotenv;
            }

            if let Some(autoload_bunfig) = object.get_boolean_loose(global_this, "autoloadBunfig")? {
                this.autoload_bunfig = autoload_bunfig;
            }

            if let Some(autoload_tsconfig) = object.get_boolean_loose(global_this, "autoloadTsconfig")? {
                this.autoload_tsconfig = autoload_tsconfig;
            }

            if let Some(autoload_package_json) =
                object.get_boolean_loose(global_this, "autoloadPackageJson")?
            {
                this.autoload_package_json = autoload_package_json;
            }

            Ok(Some(this))
        }
    }

    pub type ConfigList = StringArrayHashMap<Config>;

    impl Config {
        pub fn from_js(
            global_this: &JSGlobalObject,
            config: JSValue,
            plugins: &mut Option<*mut Plugin>,
        ) -> JsResult<Config> {
            let mut this = Config {
                define: StringMap::new(true),
                ..Default::default()
            };
            // errdefer this.deinit(allocator) — handled by `impl Drop for Config` on `?` paths.
            // errdefer if (plugins.*) |plugin| plugin.deinit() — scopeguard below.
            let mut plugins = scopeguard::guard(plugins, |p| {
                if let Some(pl) = p.take() {
                    // SAFETY: pl was created via Plugin::create in this fn and not yet consumed
                    unsafe { Plugin::destroy(pl) };
                }
            });

            let mut did_set_target = false;
            if let Some(slice) = config.get_optional::<ZigString::Slice>(global_this, "target")? {
                if bun_str::strings::has_prefix(slice.slice(), b"bun-") {
                    this.compile = Some(CompileOptions {
                        compile_target: CompileTarget::from_slice(global_this, slice.slice())?,
                        ..Default::default()
                    });
                    this.target = Target::Bun;
                    did_set_target = true;
                } else {
                    this.target = match options::Target::MAP.get(slice.slice()) {
                        Some(t) => *t,
                        None => {
                            return global_this.throw_invalid_arguments(
                                &format!(
                                    "Expected target to be one of 'browser', 'node', 'bun', 'macro', or 'bun-<target>', got {}",
                                    bstr::BStr::new(slice.slice())
                                ),
                                &[],
                            );
                        }
                    };
                    did_set_target = true;
                }
                drop(slice);
            }

            // Plugins must be resolved first as they are allowed to mutate the config JSValue
            if let Some(array) = config.get_array(global_this, "plugins")? {
                let length = array.get_length(global_this)?;
                let mut iter = array.array_iterator(global_this)?;
                let mut onstart_promise_array = JSValue::UNDEFINED;
                let mut i: usize = 0;
                while let Some(plugin) = iter.next()? {
                    if !plugin.is_object() {
                        return global_this
                            .throw_invalid_arguments("Expected plugin to be an object", &[]);
                    }

                    if let Some(slice) =
                        plugin.get_optional::<ZigString::Slice>(global_this, "name")?
                    {
                        if slice.len() == 0 {
                            return global_this.throw_invalid_arguments(
                                "Expected plugin to have a non-empty name",
                                &[],
                            );
                        }
                        drop(slice);
                    } else {
                        return global_this
                            .throw_invalid_arguments("Expected plugin to have a name", &[]);
                    }

                    let Some(function) = plugin.get_function(global_this, "setup")? else {
                        return global_this.throw_invalid_arguments(
                            "Expected plugin to have a setup() function",
                            &[],
                        );
                    };

                    let bun_plugins: *mut Plugin = match **plugins {
                        Some(p) => p,
                        None => {
                            let p = Plugin::create(
                                global_this,
                                match this.target {
                                    Target::Bun | Target::BunMacro => {
                                        jsc::JSGlobalObject::BunPluginTarget::Bun
                                    }
                                    Target::Node => jsc::JSGlobalObject::BunPluginTarget::Node,
                                    _ => jsc::JSGlobalObject::BunPluginTarget::Browser,
                                },
                            );
                            **plugins = Some(p);
                            p
                        }
                    };

                    let is_last = i == length - 1;
                    // SAFETY: bun_plugins is a valid pointer created/stored above
                    let mut plugin_result = unsafe {
                        (*bun_plugins).add_plugin(
                            function,
                            config,
                            onstart_promise_array,
                            is_last,
                            false,
                        )?
                    };

                    if !plugin_result.is_empty_or_undefined_or_null() {
                        if let Some(promise) = plugin_result.as_any_promise() {
                            promise.set_handled(global_this.vm());
                            global_this.bun_vm().wait_for_promise(promise);
                            match promise.unwrap(global_this.vm(), jsc::PromiseUnwrap::MarkHandled) {
                                jsc::PromiseResult::Pending => unreachable!(),
                                jsc::PromiseResult::Fulfilled(val) => {
                                    plugin_result = val;
                                }
                                jsc::PromiseResult::Rejected(err) => {
                                    return global_this.throw_value(err);
                                }
                            }
                        }
                    }

                    if let Some(err) = plugin_result.to_error() {
                        return global_this.throw_value(err);
                    } else if global_this.has_exception() {
                        return Err(JsError::Thrown);
                    }

                    onstart_promise_array = plugin_result;
                    i += 1;
                }
            }

            if let Some(macros_flag) = config.get_boolean_loose(global_this, "macros")? {
                this.no_macros = !macros_flag;
            }

            if let Some(bytecode) = config.get_boolean_loose(global_this, "bytecode")? {
                this.bytecode = bytecode;

                if bytecode {
                    // Default to CJS for bytecode, since esm doesn't really work yet.
                    this.format = options::Format::Cjs;
                    if did_set_target && this.target != Target::Bun && this.bytecode {
                        return global_this.throw_invalid_arguments(
                            "target must be 'bun' when bytecode is true",
                            &[],
                        );
                    }
                    this.target = Target::Bun;
                }
            }

            if let Some(react_fast_refresh) =
                config.get_boolean_loose(global_this, "reactFastRefresh")?
            {
                this.react_fast_refresh = react_fast_refresh;
            }

            let mut has_out_dir = false;
            if let Some(slice) = config.get_optional::<ZigString::Slice>(global_this, "outdir")? {
                this.outdir.append_slice_exact(slice.slice())?;
                has_out_dir = true;
                drop(slice);
            }

            if let Some(slice) = config.get_optional::<ZigString::Slice>(global_this, "banner")? {
                this.banner.append_slice_exact(slice.slice())?;
                drop(slice);
            }

            if let Some(slice) = config.get_optional::<ZigString::Slice>(global_this, "footer")? {
                this.footer.append_slice_exact(slice.slice())?;
                drop(slice);
            }

            if let Some(source_map_js) = config.get_truthy(global_this, "sourcemap")? {
                if source_map_js.is_boolean() {
                    if source_map_js == JSValue::TRUE {
                        this.source_map = if has_out_dir {
                            options::SourceMapOption::Linked
                        } else {
                            options::SourceMapOption::Inline
                        };
                    }
                } else if !source_map_js.is_empty_or_undefined_or_null() {
                    this.source_map = source_map_js.to_enum::<options::SourceMapOption>(
                        global_this,
                        "sourcemap",
                    )?;
                }
            }

            if let Some(env) = config.get(global_this, "env")? {
                if !env.is_undefined() {
                    if env == JSValue::NULL
                        || env == JSValue::FALSE
                        || (env.is_number() && env.as_number() == 0.0)
                    {
                        this.env_behavior = api::DotEnvBehavior::Disable;
                    } else if env == JSValue::TRUE || (env.is_number() && env.as_number() == 1.0) {
                        this.env_behavior = api::DotEnvBehavior::LoadAll;
                    } else if env.is_string() {
                        let slice = env.to_slice(global_this)?;
                        if slice.slice() == b"inline" {
                            this.env_behavior = api::DotEnvBehavior::LoadAll;
                        } else if slice.slice() == b"disable" {
                            this.env_behavior = api::DotEnvBehavior::Disable;
                        } else if let Some(asterisk) =
                            bun_str::strings::index_of_char(slice.slice(), b'*')
                        {
                            if asterisk > 0 {
                                this.env_behavior = api::DotEnvBehavior::Prefix;
                                this.env_prefix
                                    .append_slice_exact(&slice.slice()[0..asterisk as usize])?;
                            } else {
                                this.env_behavior = api::DotEnvBehavior::LoadAll;
                            }
                        } else {
                            return global_this.throw_invalid_arguments(
                                "env must be 'inline', 'disable', or a string with a '*' character",
                                &[],
                            );
                        }
                        drop(slice);
                    } else {
                        return global_this.throw_invalid_arguments(
                            "env must be 'inline', 'disable', or a string with a '*' character",
                            &[],
                        );
                    }
                }
            }

            if let Some(packages) =
                config.get_optional_enum::<options::PackagesOption>(global_this, "packages")?
            {
                this.packages = packages;
            }

            // Parse JSX configuration
            if let Some(jsx_value) = config.get_truthy(global_this, "jsx")? {
                if !jsx_value.is_object() {
                    return global_this.throw_invalid_arguments("jsx must be an object", &[]);
                }

                if let Some(slice) =
                    jsx_value.get_optional::<ZigString::Slice>(global_this, "runtime")?
                {
                    let mut str_lower = [0u8; 128];
                    let len = (slice.len() as usize).min(str_lower.len());
                    let _ = bun_str::strings::copy_lowercase(
                        &slice.slice()[0..len],
                        &mut str_lower[0..len],
                    );
                    if let Some(runtime) = options::JSX::RUNTIME_MAP.get(&str_lower[0..len]) {
                        this.jsx.runtime = runtime.runtime;
                        if let Some(dev) = runtime.development {
                            this.jsx.development = dev;
                        }
                    } else {
                        return global_this.throw_invalid_arguments(
                            &format!(
                                "Invalid jsx.runtime: '{}'. Must be one of: 'classic', 'automatic', 'react', 'react-jsx', or 'react-jsxdev'",
                                bstr::BStr::new(slice.slice())
                            ),
                            &[],
                        );
                    }
                    drop(slice);
                }

                if let Some(slice) =
                    jsx_value.get_optional::<ZigString::Slice>(global_this, "factory")?
                {
                    this.jsx.factory = Box::<[u8]>::from(slice.slice());
                    drop(slice);
                }

                if let Some(slice) =
                    jsx_value.get_optional::<ZigString::Slice>(global_this, "fragment")?
                {
                    this.jsx.fragment = Box::<[u8]>::from(slice.slice());
                    drop(slice);
                }

                if let Some(slice) =
                    jsx_value.get_optional::<ZigString::Slice>(global_this, "importSource")?
                {
                    this.jsx.import_source = Box::<[u8]>::from(slice.slice());
                    drop(slice);
                }

                if let Some(dev) = jsx_value.get_boolean_loose(global_this, "development")? {
                    this.jsx.development = dev;
                }

                if let Some(val) = jsx_value.get_boolean_loose(global_this, "sideEffects")? {
                    this.jsx.side_effects = val;
                }
            }

            if let Some(format) =
                config.get_optional_enum::<options::Format>(global_this, "format")?
            {
                this.format = format;

                if this.bytecode && format != options::Format::Cjs && format != options::Format::Esm
                {
                    return global_this.throw_invalid_arguments(
                        "format must be 'cjs' or 'esm' when bytecode is true.",
                        &[],
                    );
                }
            }

            if let Some(hot) = config.get_boolean_loose(global_this, "splitting")? {
                this.code_splitting = hot;
            }

            if let Some(minify) = config.get_truthy(global_this, "minify")? {
                if minify.is_boolean() {
                    let value = minify.to_boolean();
                    this.minify.whitespace = value;
                    this.minify.syntax = value;
                    this.minify.identifiers = value;
                } else if minify.is_object() {
                    if let Some(whitespace) = minify.get_boolean_loose(global_this, "whitespace")? {
                        this.minify.whitespace = whitespace;
                    }
                    if let Some(syntax) = minify.get_boolean_loose(global_this, "syntax")? {
                        this.minify.syntax = syntax;
                    }
                    if let Some(syntax) = minify.get_boolean_loose(global_this, "identifiers")? {
                        this.minify.identifiers = syntax;
                    }
                    if let Some(keep_names) = minify.get_boolean_loose(global_this, "keepNames")? {
                        this.minify.keep_names = keep_names;
                    }
                } else {
                    return global_this.throw_invalid_arguments(
                        "Expected minify to be a boolean or an object",
                        &[],
                    );
                }
            }

            let entry_points_opt = match config.get_array(global_this, "entrypoints")? {
                Some(ep) => Some(ep),
                None => config.get_array(global_this, "entryPoints")?,
            };
            if let Some(entry_points) = entry_points_opt {
                let mut iter = entry_points.array_iterator(global_this)?;
                while let Some(entry_point) = iter.next()? {
                    let slice = entry_point.to_slice_or_null(global_this)?;
                    this.entry_points.insert(slice.slice())?;
                    drop(slice);
                }
            } else {
                return global_this
                    .throw_invalid_arguments("Expected entrypoints to be an array of strings", &[]);
            }

            // Parse the files option for in-memory files
            if let Some(files_obj) = config.get_own_object(global_this, "files")? {
                this.files = FileMap::from_js(global_this, files_obj.to_js())?;
            }

            if let Some(flag) = config.get_boolean_loose(global_this, "emitDCEAnnotations")? {
                this.emit_dce_annotations = Some(flag);
            }

            if let Some(flag) = config.get_boolean_loose(global_this, "ignoreDCEAnnotations")? {
                this.ignore_dce_annotations = flag;
            }

            if let Some(conditions_value) = config.get_truthy(global_this, "conditions")? {
                if conditions_value.is_string() {
                    let slice = conditions_value.to_slice_or_null(global_this)?;
                    this.conditions.insert(slice.slice())?;
                    drop(slice);
                } else if conditions_value.js_type().is_array() {
                    let mut iter = conditions_value.array_iterator(global_this)?;
                    while let Some(entry_point) = iter.next()? {
                        let slice = entry_point.to_slice_or_null(global_this)?;
                        this.conditions.insert(slice.slice())?;
                        drop(slice);
                    }
                } else {
                    return global_this.throw_invalid_arguments(
                        "Expected conditions to be an array of strings",
                        &[],
                    );
                }
            }

            {
                let path: ZigString::Slice = 'brk: {
                    if let Some(slice) =
                        config.get_optional::<ZigString::Slice>(global_this, "root")?
                    {
                        break 'brk slice;
                    }

                    let entry_points = this.entry_points.keys();

                    // Check if all entry points are in the FileMap - if so, use cwd
                    if this.files.map.len() > 0 {
                        let mut all_in_filemap = true;
                        for ep in entry_points {
                            if !this.files.contains(ep) {
                                all_in_filemap = false;
                                break;
                            }
                        }
                        if all_in_filemap {
                            break 'brk ZigString::Slice::from_utf8_never_free(b".");
                        }
                    }

                    if entry_points.len() == 1 {
                        // TODO(port): std.fs.path.dirname → bun_paths::dirname
                        break 'brk ZigString::Slice::from_utf8_never_free(
                            bun_paths::dirname(entry_points[0], bun_paths::Platform::Auto)
                                .filter(|d| !d.is_empty())
                                .unwrap_or(b"."),
                        );
                    }

                    break 'brk ZigString::Slice::from_utf8_never_free(
                        resolve_path::get_if_exists_longest_common_path(entry_points).unwrap_or(b"."),
                    );
                };

                // TODO(port): std.fs.cwd().openDir — banned std::fs; use bun_sys
                let dir = match bun_sys::open_dir_at(bun_sys::Fd::cwd(), path.slice()) {
                    Ok(d) => d,
                    Err(err) => {
                        return global_this.throw_pretty(&format!(
                            "{}: failed to open root directory: {}",
                            err.name(),
                            bstr::BStr::new(path.slice())
                        ));
                    }
                };
                let _close = scopeguard::guard(dir, |d| d.close());

                let mut rootdir_buf = bun_paths::PathBuffer::uninit();
                let rootdir = match (*_close).get_fd_path(&mut rootdir_buf) {
                    Ok(p) => p,
                    Err(err) => {
                        return global_this.throw_pretty(&format!(
                            "{}: failed to get full root directory path: {}",
                            err.name(),
                            bstr::BStr::new(path.slice())
                        ));
                    }
                };
                this.rootdir.append_slice_exact(rootdir)?;
                drop(path);
            }

            if let Some(externals) = config.get_own_array(global_this, "external")? {
                let mut iter = externals.array_iterator(global_this)?;
                while let Some(entry_point) = iter.next()? {
                    let slice = entry_point.to_slice_or_null(global_this)?;
                    this.external.insert(slice.slice())?;
                    drop(slice);
                }
            }

            if let Some(allow_unresolved_val) = config.get_own(global_this, "allowUnresolved")? {
                if !allow_unresolved_val.is_undefined() && !allow_unresolved_val.is_null() {
                    if !allow_unresolved_val.js_type_loose().is_array() {
                        return global_this
                            .throw_invalid_arguments("allowUnresolved must be an array", &[]);
                    }
                    this.allow_unresolved = Some(StringSet::default());
                    if allow_unresolved_val.get_length(global_this)? > 0 {
                        let mut iter = allow_unresolved_val.array_iterator(global_this)?;
                        while let Some(entry) = iter.next()? {
                            let slice = entry.to_slice_or_null(global_this)?;
                            this.allow_unresolved.as_mut().unwrap().insert(slice.slice())?;
                            drop(slice);
                        }
                    }
                }
            }

            if let Some(drops) = config.get_own_array(global_this, "drop")? {
                let mut iter = drops.array_iterator(global_this)?;
                while let Some(entry) = iter.next()? {
                    let slice = entry.to_slice_or_null(global_this)?;
                    this.drop.insert(slice.slice())?;
                    drop(slice);
                }
            }

            if let Some(features) = config.get_own_array(global_this, "features")? {
                let mut iter = features.array_iterator(global_this)?;
                while let Some(entry) = iter.next()? {
                    let slice = entry.to_slice_or_null(global_this)?;
                    this.features.insert(slice.slice())?;
                    drop(slice);
                }
            }

            if let Some(optimize_imports) = config.get_own_array(global_this, "optimizeImports")? {
                let mut iter = optimize_imports.array_iterator(global_this)?;
                while let Some(entry) = iter.next()? {
                    let slice = entry.to_slice_or_null(global_this)?;
                    this.optimize_imports.insert(slice.slice())?;
                    drop(slice);
                }
            }

            // if (try config.getOptional(globalThis, "dir", ZigString.Slice)) |slice| {
            //     defer slice.deinit();
            //     this.appendSliceExact(slice.slice()) catch unreachable;
            // } else {
            //     this.appendSliceExact(globalThis.bunVM().transpiler.fs.top_level_dir) catch unreachable;
            // }

            if let Some(slice) = config.get_optional::<ZigString::Slice>(global_this, "publicPath")? {
                this.public_path.append_slice_exact(slice.slice())?;
                drop(slice);
            }

            if let Some(naming) = config.get_truthy(global_this, "naming")? {
                if naming.is_string() {
                    if let Some(slice) =
                        config.get_optional::<ZigString::Slice>(global_this, "naming")?
                    {
                        if !slice.slice().starts_with(b"./") {
                            this.names.owned_entry_point.append_slice_exact(b"./")?;
                        }
                        this.names.owned_entry_point.append_slice_exact(slice.slice())?;
                        // TODO(port): self-referential slice — entry_point.data borrows owned_entry_point
                        this.names.entry_point.data = this.names.owned_entry_point.as_slice_ptr();
                        drop(slice);
                    }
                } else if naming.is_object() {
                    if let Some(slice) =
                        naming.get_optional::<ZigString::Slice>(global_this, "entry")?
                    {
                        if !slice.slice().starts_with(b"./") {
                            this.names.owned_entry_point.append_slice_exact(b"./")?;
                        }
                        this.names.owned_entry_point.append_slice_exact(slice.slice())?;
                        this.names.entry_point.data = this.names.owned_entry_point.as_slice_ptr();
                        drop(slice);
                    }

                    if let Some(slice) =
                        naming.get_optional::<ZigString::Slice>(global_this, "chunk")?
                    {
                        if !slice.slice().starts_with(b"./") {
                            this.names.owned_chunk.append_slice_exact(b"./")?;
                        }
                        this.names.owned_chunk.append_slice_exact(slice.slice())?;
                        this.names.chunk.data = this.names.owned_chunk.as_slice_ptr();
                        drop(slice);
                    }

                    if let Some(slice) =
                        naming.get_optional::<ZigString::Slice>(global_this, "asset")?
                    {
                        if !slice.slice().starts_with(b"./") {
                            this.names.owned_asset.append_slice_exact(b"./")?;
                        }
                        this.names.owned_asset.append_slice_exact(slice.slice())?;
                        this.names.asset.data = this.names.owned_asset.as_slice_ptr();
                        drop(slice);
                    }
                } else {
                    return global_this.throw_invalid_arguments(
                        "Expected naming to be a string or an object",
                        &[],
                    );
                }
            }

            if let Some(define) = config.get_own_object(global_this, "define")? {
                let mut define_iter = jsc::JSPropertyIterator::init(
                    global_this,
                    define,
                    jsc::JSPropertyIteratorOptions {
                        skip_empty_name: true,
                        include_value: true,
                    },
                )?;

                while let Some(prop) = define_iter.next()? {
                    let property_value = define_iter.value;
                    let value_type = property_value.js_type();

                    if !value_type.is_string_like() {
                        return global_this.throw_invalid_arguments(
                            &format!("define \"{}\" must be a JSON string", prop),
                            &[],
                        );
                    }

                    let mut val = ZigString::init(b"");
                    property_value.to_zig_string(&mut val, global_this)?;
                    if val.len() == 0 {
                        val = ZigString::from_utf8(b"\"\"");
                    }

                    let key = prop.to_owned_slice()?;

                    // value is always cloned
                    let value = val.to_slice();

                    // .insert clones the value, but not the key
                    this.define.insert(key, value.slice())?;
                    drop(value);
                }
            }

            if let Some(loaders) = config.get_own_object(global_this, "loader")? {
                let mut loader_iter = jsc::JSPropertyIterator::init(
                    global_this,
                    loaders,
                    jsc::JSPropertyIteratorOptions {
                        skip_empty_name: true,
                        include_value: true,
                    },
                )?;

                // `loader_iter.i` is the property position, not a dense index of yielded
                // entries. With `skip_empty_name = true` (or a skipped property getter),
                // writing at `loader_iter.i` would leave earlier slots uninitialized and
                // later freed as garbage. Use ArrayLists so the stored slice is always
                // exactly what was appended.
                let mut loader_names: Vec<Box<[u8]>> = Vec::new();
                // errdefer: Vec<Box<[u8]>> drops automatically
                let mut loader_values: Vec<api::Loader> = Vec::new();

                loader_names.reserve_exact(loader_iter.len() as usize);
                loader_values.reserve_exact(loader_iter.len() as usize);

                while let Some(prop) = loader_iter.next()? {
                    if !prop.has_prefix(b".") || prop.length() < 2 {
                        return global_this.throw_invalid_arguments(
                            "loader property names must be file extensions, such as '.txt'",
                            &[],
                        );
                    }

                    // PERF(port): was assume_capacity
                    loader_values.push(loader_iter.value.to_enum_from_map::<api::Loader>(
                        global_this,
                        "loader",
                        &options::Loader::API_NAMES,
                    )?);
                    loader_names.push(prop.to_owned_slice()?);
                }

                this.loaders = Some(api::LoaderMap {
                    extensions: loader_names,
                    loaders: loader_values,
                });
            }

            if let Some(flag) = config.get_boolean_strict(global_this, "throw")? {
                this.throw_on_error = flag;
            }

            // Parse metafile option: boolean | string | { json?: string, markdown?: string }
            if let Some(metafile_value) = config.get_own(global_this, "metafile")? {
                if metafile_value.is_boolean() {
                    this.metafile = metafile_value == JSValue::TRUE;
                } else if metafile_value.is_string() {
                    // metafile: "path/to/meta.json" - shorthand for { json: "..." }
                    this.metafile = true;
                    let slice = metafile_value.to_slice(global_this)?;
                    this.metafile_json_path.append_slice_exact(slice.slice())?;
                    drop(slice);
                } else if metafile_value.is_object() {
                    // metafile: { json?: string, markdown?: string }
                    this.metafile = true;
                    if let Some(slice) =
                        metafile_value.get_optional::<ZigString::Slice>(global_this, "json")?
                    {
                        this.metafile_json_path.append_slice_exact(slice.slice())?;
                        drop(slice);
                    }
                    if let Some(slice) =
                        metafile_value.get_optional::<ZigString::Slice>(global_this, "markdown")?
                    {
                        this.metafile_markdown_path.append_slice_exact(slice.slice())?;
                        drop(slice);
                    }
                } else if !metafile_value.is_undefined_or_null() {
                    return global_this.throw_invalid_arguments(
                        "Expected metafile to be a boolean, string, or object with json/markdown paths",
                        &[],
                    );
                }
            }

            if let Some(compile) = CompileOptions::from_js(
                global_this,
                config,
                this.compile.as_ref().map(|c| c.compile_target.clone()),
            )? {
                this.compile = Some(compile);
            }

            if let Some(compile) = this.compile.as_mut() {
                // When compile + target=browser + all HTML entrypoints, produce standalone HTML.
                // Otherwise, default to bun executable compile.
                let has_all_html_entrypoints = 'brk: {
                    if this.entry_points.count() == 0 {
                        break 'brk false;
                    }
                    for ep in this.entry_points.keys() {
                        if !ep.ends_with(b".html") {
                            break 'brk false;
                        }
                    }
                    true
                };
                let is_standalone_html =
                    this.target == Target::Browser && has_all_html_entrypoints;
                if !is_standalone_html {
                    this.target = Target::Bun;

                    let define_keys = compile.compile_target.define_keys();
                    let define_values = compile.compile_target.define_values();
                    debug_assert_eq!(define_keys.len(), define_values.len());
                    for (key, value) in define_keys.iter().zip(define_values) {
                        this.define.insert(key, value)?;
                    }

                    let base_public_path = bun_runtime::StandaloneModuleGraph::target_base_public_path(
                        compile.compile_target.os,
                        b"root/",
                    );
                    this.public_path.append(base_public_path)?;

                    // When using --compile, only `external` sourcemaps work, as we do not
                    // look at the source map comment. Override any other sourcemap type.
                    if this.source_map != options::SourceMapOption::None {
                        this.source_map = options::SourceMapOption::External;
                    }

                    if compile.outfile.is_empty() {
                        let entry_point = this.entry_points.keys()[0];
                        let mut outfile = bun_paths::basename(entry_point);
                        let ext = bun_paths::extension(outfile);
                        if !ext.is_empty() {
                            outfile = &outfile[0..outfile.len() - ext.len()];
                        }

                        if outfile == b"index" {
                            outfile = bun_paths::basename(
                                bun_paths::dirname(entry_point, bun_paths::Platform::Auto)
                                    .filter(|d| !d.is_empty())
                                    .unwrap_or(b"index"),
                            );
                        }

                        if outfile == b"bun" {
                            outfile = bun_paths::basename(
                                bun_paths::dirname(entry_point, bun_paths::Platform::Auto)
                                    .filter(|d| !d.is_empty())
                                    .unwrap_or(b"bun"),
                            );
                        }

                        // If argv[0] is "bun" or "bunx", we don't check if the binary is standalone
                        if outfile == b"bun" || outfile == b"bunx" {
                            return global_this.throw_invalid_arguments(
                                "cannot use compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for compile.outfile",
                                &[],
                            );
                        }

                        compile.outfile.append_slice_exact(outfile)?;
                    }
                }
            }

            // ESM bytecode requires compile because module_info (import/export metadata)
            // is only available in compiled binaries. Without it, JSC must parse the file
            // twice (once for module analysis, once for bytecode), which is a deopt.
            if this.bytecode && this.format == options::Format::Esm && this.compile.is_none() {
                return global_this.throw_invalid_arguments(
                    "ESM bytecode requires compile: true. Use format: 'cjs' for bytecode without compile.",
                    &[],
                );
            }

            // Validate standalone HTML mode: compile + browser target + all HTML entrypoints
            if this.compile.is_some() && this.target == Target::Browser {
                let has_all_html = 'brk: {
                    if this.entry_points.count() == 0 {
                        break 'brk false;
                    }
                    for ep in this.entry_points.keys() {
                        if !ep.ends_with(b".html") {
                            break 'brk false;
                        }
                    }
                    true
                };
                if has_all_html && this.code_splitting {
                    return global_this.throw_invalid_arguments(
                        "Cannot use compile with target 'browser' and splitting for standalone HTML",
                        &[],
                    );
                }
            }

            scopeguard::ScopeGuard::into_inner(plugins);
            Ok(this)
        }
    }

    impl Drop for Config {
        fn drop(&mut self) {
            // entry_points, external, define, jsx, compile, loaders etc. drop automatically.
            // TODO(port): FileMap::deinit_and_unprotect touches JS values; Config is !Send via
            // its Strong fields so Drop runs on the JS thread, but verify in Phase B.
            self.files.deinit_and_unprotect();
        }
    }

    pub struct Names {
        pub owned_entry_point: OwnedString,
        pub entry_point: options::PathTemplate,
        pub owned_chunk: OwnedString,
        pub chunk: options::PathTemplate,
        pub owned_asset: OwnedString,
        pub asset: options::PathTemplate,
    }

    impl Default for Names {
        fn default() -> Self {
            Self {
                owned_entry_point: OwnedString::default(),
                entry_point: options::PathTemplate::FILE,
                owned_chunk: OwnedString::default(),
                chunk: options::PathTemplate::CHUNK,
                owned_asset: OwnedString::default(),
                asset: options::PathTemplate::ASSET,
            }
        }
    }

    #[derive(Default)]
    pub struct Minify {
        pub whitespace: bool,
        pub identifiers: bool,
        pub syntax: bool,
        pub keep_names: bool,
    }

    #[derive(Default)]
    pub struct Serve {
        pub handler_path: OwnedString,
        pub prefix: OwnedString,
    }

    fn build(global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<JSValue> {
        if arguments.is_empty() || !arguments[0].is_object() {
            return global_this
                .throw_invalid_arguments("Expected a config object to be passed to Bun.build", &[]);
        }

        let vm = global_this.bun_vm();

        // Detect and prevent calling Bun.build from within a macro during bundling.
        // This would cause a deadlock because:
        // 1. The bundler thread (singleton) is processing the outer Bun.build
        // 2. During parsing, it encounters a macro and evaluates it
        // 3. The macro calls Bun.build, which tries to enqueue to the same singleton thread
        // 4. The singleton thread is blocked waiting for the macro to complete -> deadlock
        if vm.macro_mode {
            return global_this.throw(
                "Bun.build cannot be called from within a macro during bundling.\n\n\
                 This would cause a deadlock because the bundler is waiting for the macro to complete,\n\
                 but the macro's Bun.build call is waiting for the bundler.\n\n\
                 To bundle code at compile time in a macro, use Bun.spawnSync to invoke the CLI:\n  \
                 const result = Bun.spawnSync([\"bun\", \"build\", entrypoint, \"--format=esm\"]);",
                &[],
            );
        }

        let mut plugins: Option<*mut Plugin> = None;
        let config = Config::from_js(global_this, arguments[0], &mut plugins)?;

        BundleV2::generate_from_javascript(config, plugins, global_this, vm.event_loop())
    }

    /// `Bun.build(config)`
    #[bun_jsc::host_fn]
    pub fn build_fn(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1);
        build(global_this, arguments.slice())
    }

    pub struct Resolve {
        pub bv2: *mut BundleV2,
        pub import_record: MiniImportRecord,
        pub value: ResolveValue,

        pub js_task: jsc::AnyTask,
        pub task: jsc::AnyEventLoop::Task,
    }

    pub struct MiniImportRecord {
        pub kind: ImportKind,
        // TODO(port): lifetime — borrowed from BundleV2 (Zig deinit never frees these; defaults `""`)
        pub source_file: *const [u8],
        pub namespace: *const [u8],
        pub specifier: *const [u8],
        pub importer_source_index: u32,
        pub import_record_index: u32,
        pub range: logger::Range,
        pub original_target: Target,
        // pub inline fn loader(_: *const MiniImportRecord) ?options.Loader {
        //     return null;
        // }
    }

    #[derive(Default)]
    pub struct ResolveSuccess {
        pub path: Box<[u8]>,
        pub namespace: Box<[u8]>,
        pub external: bool,
    }

    pub enum ResolveValue {
        Err(logger::Msg),
        Success(ResolveSuccess),
        NoMatch,
        Pending,
        Consumed,
    }

    impl ResolveValue {
        pub fn consume(&mut self) -> ResolveValue {
            core::mem::replace(self, ResolveValue::Consumed)
        }
    }

    impl Resolve {
        pub fn init(bv2: *mut BundleV2, record: MiniImportRecord) -> Resolve {
            Resolve {
                bv2,
                import_record: record,
                value: ResolveValue::Pending,
                // TODO(port): task/js_task were `undefined` in Zig
                task: jsc::AnyEventLoop::Task::default(),
                js_task: jsc::AnyTask::default(),
            }
        }

        pub fn dispatch(this: &mut Self) {
            this.js_task = jsc::AnyTask::new::<Self>(this, Self::run_on_js_thread);
            // SAFETY: bv2 is a valid backref set by BundleV2
            unsafe {
                (*this.bv2)
                    .js_loop_for_plugins()
                    .enqueue_task_concurrent(jsc::ConcurrentTask::create(this.js_task.task()));
            }
        }

        pub fn run_on_js_thread(this: &mut Self) {
            // SAFETY: bv2 is a valid backref; plugins is Some when this runs
            unsafe {
                (*(*this.bv2).plugins.unwrap()).match_on_resolve(
                    &*this.import_record.specifier,
                    &*this.import_record.namespace,
                    &*this.import_record.source_file,
                    this as *mut _ as *mut c_void,
                    this.import_record.kind,
                );
            }
        }
    }

    // TODO(port): move to runtime_sys
    #[unsafe(no_mangle)]
    pub extern "C" fn JSBundlerPlugin__onResolveAsync(
        resolve: *mut Resolve,
        _unused: *mut c_void,
        path_value: JSValue,
        namespace_value: JSValue,
        external_value: JSValue,
    ) {
        // SAFETY: called from C++ with valid Resolve pointer
        let resolve = unsafe { &mut *resolve };
        if path_value.is_empty_or_undefined_or_null() || namespace_value.is_empty_or_undefined_or_null()
        {
            resolve.value = ResolveValue::NoMatch;
        } else {
            // SAFETY: bv2 backref is valid; plugins is Some
            let global = unsafe { (*(*resolve.bv2).plugins.unwrap()).global_object() };
            let path = path_value
                .to_slice_clone_with_allocator(global)
                .expect("Unexpected: path is not a string");
            let namespace = namespace_value
                .to_slice_clone_with_allocator(global)
                .expect("Unexpected: namespace is not a string");
            resolve.value = ResolveValue::Success(ResolveSuccess {
                path: path.into_owned(),
                namespace: namespace.into_owned(),
                external: external_value.to::<bool>(),
            });
        }

        // SAFETY: bv2 backref is valid
        unsafe { (*resolve.bv2).on_resolve_async(resolve) };
    }

    use bun_bundler::DeferredTask;

    pub struct Load<'a> {
        pub bv2: *mut BundleV2,

        pub source_index: Index,
        pub default_loader: options::Loader,
        pub path: Box<[u8]>,
        pub namespace: Box<[u8]>,

        pub value: LoadValue,
        pub js_task: jsc::AnyTask,
        pub task: jsc::AnyEventLoop::Task,
        pub parse_task: &'a mut bun_bundler::ParseTask,
        /// Faster path: skip the extra threadpool dispatch when the file is not found
        pub was_file: bool,
        /// Defer may only be called once
        pub called_defer: bool,
    }

    bun_output::declare_scope!(BUNDLER_DEFERRED, hidden);

    pub enum LoadValue {
        Err(logger::Msg),
        Success { source_code: Box<[u8]>, loader: options::Loader },
        Pending,
        NoMatch,
        /// The value has been de-initialized or left over from `consume()`
        Consumed,
    }

    impl LoadValue {
        /// Moves the value, replacing the original with `.consumed`. It is
        /// safe to `deinit()` the consumed value, but the memory in `err`
        /// and `success` must be freed by the caller.
        pub fn consume(&mut self) -> LoadValue {
            core::mem::replace(self, LoadValue::Consumed)
        }
    }

    impl<'a> Load<'a> {
        pub fn init(bv2: *mut BundleV2, parse: &'a mut bun_bundler::ParseTask) -> Load<'a> {
            // SAFETY: bv2 is a valid backref
            let default_loader = parse
                .path
                .loader(unsafe { &(*bv2).transpiler.options.loaders })
                .unwrap_or(options::Loader::Js);
            Load {
                bv2,
                source_index: parse.source_index,
                default_loader,
                value: LoadValue::Pending,
                // TODO(port): lifetime — Zig stored borrowed slices into parse.path; using owned copies
                path: Box::<[u8]>::from(parse.path.text.as_ref()),
                namespace: Box::<[u8]>::from(parse.path.namespace.as_ref()),
                parse_task: parse,
                was_file: false,
                called_defer: false,
                task: jsc::AnyEventLoop::Task::default(),
                js_task: jsc::AnyTask::default(),
            }
        }

        pub fn bake_graph(&self) -> bun_bake::Graph {
            self.parse_task.known_target.bake_graph()
        }

        pub fn run_on_js_thread(load: &mut Self) {
            // SAFETY: bv2 backref is valid; plugins is Some
            unsafe {
                (*(*load.bv2).plugins.unwrap()).match_on_load(
                    &load.path,
                    &load.namespace,
                    load as *mut _ as *mut c_void,
                    load.default_loader,
                    load.bake_graph() != bun_bake::Graph::Client,
                );
            }
        }

        pub fn dispatch(this: &mut Self) {
            this.js_task = jsc::AnyTask::new::<Self>(this, Self::run_on_js_thread);
            let concurrent_task = jsc::ConcurrentTask::create_from(&this.js_task);
            // SAFETY: bv2 backref is valid
            unsafe {
                (*this.bv2)
                    .js_loop_for_plugins()
                    .enqueue_task_concurrent(concurrent_task);
            }
        }

        fn on_defer(this: &mut Self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            if this.called_defer {
                return global_object
                    .throw("Can't call .defer() more than once within an onLoad plugin", &[]);
            }
            this.called_defer = true;

            bun_output::scoped_log!(
                BUNDLER_DEFERRED,
                "JSBundlerPlugin__onDefer(0x{:x}, {})",
                this as *const _ as usize,
                bstr::BStr::new(&this.path)
            );

            // Notify the bundler thread about the deferral. This will decrement
            // the pending item counter and increment the deferred counter.
            // SAFETY: parse_task.ctx and bv2 are valid backrefs
            unsafe {
                match &mut *this.parse_task.ctx.loop_() {
                    jsc::AnyEventLoop::Js(jsc_event_loop) => {
                        jsc_event_loop.enqueue_task_concurrent(jsc::ConcurrentTask::from_callback(
                            this.parse_task.ctx,
                            BundleV2::on_notify_defer,
                        ));
                    }
                    jsc::AnyEventLoop::Mini(mini) => {
                        mini.enqueue_task_concurrent_with_extra_ctx::<Load, BundleV2>(
                            this,
                            BundleV2::on_notify_defer_mini,
                            // TODO(port): .task field selector
                        );
                    }
                }

                Ok((*(*this.bv2).plugins.unwrap()).append_defer_promise())
            }
        }
    }

    impl<'a> Drop for Load<'a> {
        fn drop(&mut self) {
            bun_output::scoped_log!(
                Transpiler,
                "Deinit Load(0{:x}, {})",
                self as *const _ as usize,
                bstr::BStr::new(&self.path)
            );
            // value drops automatically
        }
    }

    // TODO(port): move to runtime_sys
    #[unsafe(no_mangle)]
    pub extern "C" fn JSBundlerPlugin__onDefer(
        load: *mut Load,
        global: *mut JSGlobalObject,
    ) -> JSValue {
        // SAFETY: called from C++ with valid pointers
        unsafe { jsc::to_js_host_call(&*global, || Load::on_defer(&mut *load, &*global)) }
    }

    // TODO(port): move to runtime_sys
    #[unsafe(no_mangle)]
    pub extern "C" fn JSBundlerPlugin__onLoadAsync(
        this: *mut Load,
        _unused: *mut c_void,
        source_code_value: JSValue,
        loader_as_int: JSValue,
    ) {
        jsc::mark_binding();
        // SAFETY: called from C++ with valid Load pointer
        let this = unsafe { &mut *this };
        if source_code_value.is_empty_or_undefined_or_null()
            || loader_as_int.is_empty_or_undefined_or_null()
        {
            this.value = LoadValue::NoMatch;

            if this.was_file {
                // Faster path: skip the extra threadpool dispatch
                // SAFETY: bv2 backref is valid
                unsafe {
                    (*this.bv2)
                        .graph
                        .pool
                        .worker_pool
                        .schedule(bun_threading::ThreadPool::Batch::from(&this.parse_task.task));
                }
                // Zig: this.deinit() — explicit drop
                // TODO(port): Load is not Box-allocated here; Zig deinit only resets value
                this.value = LoadValue::Consumed;
                return;
            }
        } else {
            // SAFETY: api::Loader is #[repr(u8)]
            let loader: api::Loader =
                unsafe { core::mem::transmute::<u8, api::Loader>(loader_as_int.to::<u8>()) };
            // SAFETY: bv2 backref is valid; plugins is Some
            let global = unsafe { (*(*this.bv2).plugins.unwrap()).global_object() };
            let source_code = match jsc::node::StringOrBuffer::from_js_to_owned_slice(
                global,
                source_code_value,
            ) {
                Ok(s) => s,
                Err(err) => {
                    match err {
                        JsError::OutOfMemory => bun_core::out_of_memory(),
                        JsError::Thrown => {}
                        JsError::Terminated => {}
                    }
                    panic!("Unexpected: source_code is not a string");
                }
            };
            this.value = LoadValue::Success {
                loader: options::Loader::from_api(loader),
                source_code,
            };
        }

        // SAFETY: bv2 backref is valid
        unsafe { (*this.bv2).on_load_async(this) };
    }

    /// Opaque FFI handle for the C++ JSBundlerPlugin.
    #[repr(C)]
    pub struct Plugin {
        _p: [u8; 0],
        _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
    }

    // TODO(port): move to runtime_sys
    unsafe extern "C" {
        fn JSBundlerPlugin__create(
            global: *mut JSGlobalObject,
            target: jsc::JSGlobalObject::BunPluginTarget,
        ) -> *mut Plugin;
        fn JSBundlerPlugin__callOnBeforeParsePlugins(
            plugin: *mut Plugin,
            bun_context: *mut c_void,
            namespace: *const BunString,
            path: *const BunString,
            on_before_parse_args: *mut c_void,
            on_before_parse_result: *mut c_void,
            should_continue: *mut i32,
        ) -> i32;
        fn JSBundlerPlugin__hasOnBeforeParsePlugins(plugin: *mut Plugin) -> i32;
        fn JSBundlerPlugin__tombstone(plugin: *mut Plugin);
        fn JSBundlerPlugin__runOnEndCallbacks(
            plugin: *mut Plugin,
            build_promise: JSValue,
            build_result: JSValue,
            rejection: JSValue,
        ) -> JSValue;
        fn JSBundlerPlugin__globalObject(plugin: *mut Plugin) -> *mut JSGlobalObject;
        fn JSBundlerPlugin__anyMatches(
            plugin: *mut Plugin,
            namespace_string: *const BunString,
            path: *const BunString,
            is_on_load: bool,
        ) -> bool;
        fn JSBundlerPlugin__matchOnLoad(
            plugin: *mut Plugin,
            namespace_string: *const BunString,
            path: *const BunString,
            context: *mut c_void,
            default_loader: u8,
            is_server_side: bool,
        );
        fn JSBundlerPlugin__matchOnResolve(
            plugin: *mut Plugin,
            namespace_string: *const BunString,
            path: *const BunString,
            importer: *const BunString,
            context: *mut c_void,
            kind: u8,
        );
        fn JSBundlerPlugin__drainDeferred(plugin: *mut Plugin, rejected: bool);
        fn JSBundlerPlugin__appendDeferPromise(plugin: *mut Plugin) -> JSValue;
        fn JSBundlerPlugin__setConfig(plugin: *mut Plugin, config: *mut c_void);
        fn JSBundlerPlugin__runSetupFunction(
            plugin: *mut Plugin,
            object: JSValue,
            config: JSValue,
            onstart_promises_array: JSValue,
            is_last: JSValue,
            is_bake: JSValue,
        ) -> JSValue;
    }

    impl Plugin {
        pub fn create(
            global: &JSGlobalObject,
            target: jsc::JSGlobalObject::BunPluginTarget,
        ) -> *mut Plugin {
            jsc::mark_binding();
            // SAFETY: FFI call with valid global
            let plugin = unsafe {
                JSBundlerPlugin__create(global as *const _ as *mut JSGlobalObject, target)
            };
            JSValue::from_cell(plugin).protect();
            plugin
        }

        pub fn call_on_before_parse_plugins(
            &mut self,
            ctx: *mut c_void,
            namespace: &BunString,
            path: &BunString,
            on_before_parse_args: Option<*mut c_void>,
            on_before_parse_result: Option<*mut c_void>,
            should_continue: &mut i32,
        ) -> i32 {
            // SAFETY: self is valid opaque FFI handle
            unsafe {
                JSBundlerPlugin__callOnBeforeParsePlugins(
                    self,
                    ctx,
                    namespace,
                    path,
                    on_before_parse_args.unwrap_or(core::ptr::null_mut()),
                    on_before_parse_result.unwrap_or(core::ptr::null_mut()),
                    should_continue,
                )
            }
        }

        pub fn has_on_before_parse_plugins(&mut self) -> bool {
            // SAFETY: self is valid opaque FFI handle
            unsafe { JSBundlerPlugin__hasOnBeforeParsePlugins(self) != 0 }
        }

        pub fn run_on_end_callbacks(
            &mut self,
            global_this: &JSGlobalObject,
            build_promise: &jsc::JSPromise,
            build_result: JSValue,
            rejection: JsResult<JSValue>,
        ) -> JsResult<JSValue> {
            jsc::mark_binding();

            let rejection_value = match rejection {
                Ok(v) => v,
                Err(JsError::OutOfMemory) => global_this.create_out_of_memory_error(),
                Err(JsError::Thrown) => global_this.take_error(JsError::Thrown),
                Err(JsError::Terminated) => return Err(JsError::Terminated),
            };

            let mut scope = jsc::TopExceptionScope::init(global_this);

            // SAFETY: self is valid opaque FFI handle
            let value = unsafe {
                JSBundlerPlugin__runOnEndCallbacks(
                    self,
                    build_promise.as_value(global_this),
                    build_result,
                    rejection_value,
                )
            };

            scope.return_if_exception()?;

            Ok(value)
        }

        /// FFI destroy — Plugin is an opaque JSCell handle created via JSBundlerPlugin__create.
        /// SAFETY: `this` must be a live handle previously returned by `Plugin::create`.
        pub unsafe fn destroy(this: *mut Self) {
            jsc::mark_binding();
            JSBundlerPlugin__tombstone(this);
            JSValue::from_cell(this).unprotect();
        }

        pub fn global_object(&mut self) -> &JSGlobalObject {
            // SAFETY: self is valid opaque FFI handle; returned global outlives self
            unsafe { &*JSBundlerPlugin__globalObject(self) }
        }

        pub fn append_defer_promise(&mut self) -> JSValue {
            // SAFETY: self is valid opaque FFI handle
            unsafe { JSBundlerPlugin__appendDeferPromise(self) }
        }

        pub fn has_any_matches(&mut self, path: &Fs::Path, is_on_load: bool) -> bool {
            jsc::mark_binding();
            let _tracer = bun_core::perf::trace("JSBundler.hasAnyMatches");

            let namespace_string = if path.is_file() {
                BunString::empty()
            } else {
                BunString::clone_utf8(path.namespace())
            };
            let path_string = BunString::clone_utf8(path.text());
            // namespace_string/path_string deref on Drop
            // SAFETY: self is valid opaque FFI handle
            unsafe {
                JSBundlerPlugin__anyMatches(self, &namespace_string, &path_string, is_on_load)
            }
        }

        pub fn match_on_load(
            &mut self,
            path: &[u8],
            namespace: &[u8],
            context: *mut c_void,
            default_loader: options::Loader,
            is_server_side: bool,
        ) {
            jsc::mark_binding();
            let _tracer = bun_core::perf::trace("JSBundler.matchOnLoad");
            bun_output::scoped_log!(
                Transpiler,
                "JSBundler.matchOnLoad(0x{:x}, {}, {})",
                self as *const _ as usize,
                bstr::BStr::new(namespace),
                bstr::BStr::new(path)
            );
            let namespace_string = if namespace.is_empty() {
                BunString::static_(b"file")
            } else {
                BunString::clone_utf8(namespace)
            };
            let path_string = BunString::clone_utf8(path);
            // SAFETY: self is valid opaque FFI handle
            unsafe {
                JSBundlerPlugin__matchOnLoad(
                    self,
                    &namespace_string,
                    &path_string,
                    context,
                    default_loader as u8,
                    is_server_side,
                );
            }
        }

        pub fn match_on_resolve(
            &mut self,
            path: &[u8],
            namespace: &[u8],
            importer: &[u8],
            context: *mut c_void,
            import_record_kind: ImportKind,
        ) {
            jsc::mark_binding();
            let _tracer = bun_core::perf::trace("JSBundler.matchOnResolve");
            let namespace_string = if namespace == b"file" {
                BunString::empty()
            } else {
                BunString::clone_utf8(namespace)
            };
            let path_string = BunString::clone_utf8(path);
            let importer_string = BunString::clone_utf8(importer);
            // SAFETY: self is valid opaque FFI handle
            unsafe {
                JSBundlerPlugin__matchOnResolve(
                    self,
                    &namespace_string,
                    &path_string,
                    &importer_string,
                    context,
                    import_record_kind as u8,
                );
            }
        }

        pub fn add_plugin(
            &mut self,
            object: JSValue,
            config: JSValue,
            onstart_promises_array: JSValue,
            is_last: bool,
            is_bake: bool,
        ) -> JsResult<JSValue> {
            jsc::mark_binding();
            let _tracer = bun_core::perf::trace("JSBundler.addPlugin");
            // SAFETY: self is valid opaque FFI handle
            jsc::from_js_host_call(self.global_object(), || unsafe {
                JSBundlerPlugin__runSetupFunction(
                    self,
                    object,
                    config,
                    onstart_promises_array,
                    JSValue::from(is_last),
                    JSValue::from(is_bake),
                )
            })
        }

        pub fn drain_deferred(&mut self, rejected: bool) -> JsResult<()> {
            // SAFETY: self is valid opaque FFI handle
            jsc::from_js_host_call_generic(self.global_object(), || unsafe {
                JSBundlerPlugin__drainDeferred(self, rejected)
            })
        }

        pub fn set_config(&mut self, config: *mut c_void) {
            jsc::mark_binding();
            // SAFETY: self is valid opaque FFI handle
            unsafe { JSBundlerPlugin__setConfig(self, config) };
        }

        /// Convert a JS exception value into a `logger.Msg`. If the conversion itself throws
        /// (e.g. `Symbol.toPrimitive` on the thrown object throws), clear that secondary
        /// exception and return a generic fallback message so `onResolveAsync`/`onLoadAsync`
        /// is still called and the bundler's pending-item counter is decremented. Returning
        /// early here would cause `Bun.build` to hang forever waiting on the counter.
        fn msg_from_js(plugin: &mut Plugin, file: &[u8], exception: JSValue) -> logger::Msg {
            match logger::Msg::from_js(plugin.global_object(), file, exception) {
                Ok(msg) => msg,
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(JsError::Thrown) | Err(JsError::Terminated) => {
                    // We are already producing a build error for the original plugin
                    // exception; the secondary exception from string conversion is not
                    // useful to the user and should not be treated as unhandled.
                    let _ = plugin.global_object().clear_exception_except_termination();
                    logger::Msg {
                        data: logger::Data {
                            text: Box::<[u8]>::from(
                                &b"A bundler plugin threw a value that could not be converted to a string"[..],
                            ),
                            location: Some(logger::Location {
                                file: Box::<[u8]>::from(file),
                                line: -1,
                                column: -1,
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        ..Default::default()
                    }
                }
            }
        }
    }

    // TODO(port): move to runtime_sys
    #[unsafe(no_mangle)]
    pub extern "C" fn JSBundlerPlugin__addError(
        ctx: *mut c_void,
        plugin: *mut Plugin,
        exception: JSValue,
        which: JSValue,
    ) {
        // SAFETY: plugin is valid opaque FFI handle; ctx is *mut Resolve or *mut Load
        let plugin = unsafe { &mut *plugin };
        match which.to::<i32>() {
            0 => {
                let resolve = unsafe { &mut *(ctx as *mut Resolve) };
                let msg = Plugin::msg_from_js(plugin, &resolve.import_record.source_file, exception);
                resolve.value = ResolveValue::Err(msg);
                // SAFETY: bv2 backref is valid
                unsafe { (*resolve.bv2).on_resolve_async(resolve) };
            }
            1 => {
                let load = unsafe { &mut *(ctx as *mut Load) };
                let msg = Plugin::msg_from_js(plugin, &load.path, exception);
                load.value = LoadValue::Err(msg);
                // SAFETY: bv2 backref is valid
                unsafe { (*load.bv2).on_load_async(load) };
            }
            _ => panic!("invalid error type"),
        }
    }
}

pub use js_bundler as JSBundler;

#[bun_jsc::JsClass]
pub struct BuildArtifact {
    pub blob: Blob,
    pub loader: options::Loader,
    pub path: Box<[u8]>,
    pub hash: u64,
    pub output_kind: OutputKind,
    pub sourcemap: bun_jsc::Strong, // Strong.Optional
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum OutputKind {
    #[strum(serialize = "chunk")]
    Chunk,
    #[strum(serialize = "asset")]
    Asset,
    #[strum(serialize = "entry-point")]
    EntryPoint,
    #[strum(serialize = "sourcemap")]
    Sourcemap,
    #[strum(serialize = "bytecode")]
    Bytecode,
    #[strum(serialize = "module_info")]
    ModuleInfo,
    #[strum(serialize = "metafile-json")]
    MetafileJson,
    #[strum(serialize = "metafile-markdown")]
    MetafileMarkdown,
}

impl OutputKind {
    pub fn is_file_in_standalone_mode(self) -> bool {
        self != Self::Sourcemap
            && self != Self::Bytecode
            && self != Self::ModuleInfo
            && self != Self::MetafileJson
            && self != Self::MetafileMarkdown
    }
}

impl BuildArtifact {
    #[bun_jsc::host_fn(method)]
    pub fn get_text(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // PERF(port): was @call(bun.callmod_inline, ...)
        Blob::get_text(&mut this.blob, global_this, callframe)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_json(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Blob::get_json(&mut this.blob, global_this, callframe)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_array_buffer(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Blob::get_array_buffer(&mut this.blob, global_this, callframe)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_slice(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Blob::get_slice(&mut this.blob, global_this, callframe)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_type(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        Blob::get_type(&this.blob, global_this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_stream(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Blob::get_stream(&mut this.blob, global_this, callframe)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_path(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::from_utf8(&this.path).to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_loader(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::from_utf8(<&'static str>::from(this.loader).as_bytes()).to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hash(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        use std::io::Write;
        let mut buf = [0u8; 512];
        let mut cursor = &mut buf[..];
        write!(cursor, "{}", bun_core::fmt::truncated_hash32(this.hash)).expect("Unexpected");
        let written = 512 - cursor.len();
        ZigString::init(&buf[..written]).to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_size(this: &Self, global_object: &JSGlobalObject) -> JSValue {
        Blob::get_size(&this.blob, global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_mime_type(this: &Self, global_object: &JSGlobalObject) -> JSValue {
        Blob::get_type(&this.blob, global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_output_kind(this: &Self, global_object: &JSGlobalObject) -> JSValue {
        ZigString::init(<&'static str>::from(this.output_kind).as_bytes()).to_js(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_source_map(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if let Some(value) = this.sourcemap.get() {
            return value;
        }
        JSValue::NULL
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by JSC finalizer; this was Box::into_raw'd
        unsafe { drop(Box::from_raw(this)) };
    }

    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> Result<(), bun_core::Error>
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        // TODO(port): narrow error set
        writer.write_str(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>BuildArtifact "))?;

        write!(
            writer,
            "{}",
            Output::pretty_fmt_args::<ENABLE_ANSI_COLORS>(format_args!(
                "(<blue>{}<r>) {{\n",
                <&'static str>::from(self.output_kind)
            ))
        )?;

        {
            formatter.indent_inc();
            let _dedent = scopeguard::guard((), |_| formatter.indent_dec());
            // PORT NOTE: reshaped for borrowck — can't borrow formatter twice in scopeguard.
            // TODO(port): defer formatter.indent -= 1 — manual decrement after block instead

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt_args::<ENABLE_ANSI_COLORS>(format_args!(
                    "<r>path<r>: <green>\"{}\"<r>",
                    bstr::BStr::new(&self.path)
                ))
            )?;
            formatter.print_comma::<ENABLE_ANSI_COLORS>(writer).expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt_args::<ENABLE_ANSI_COLORS>(format_args!(
                    "<r>loader<r>: <green>\"{}\"<r>",
                    <&'static str>::from(self.loader)
                ))
            )?;

            formatter.print_comma::<ENABLE_ANSI_COLORS>(writer).expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;

            write!(
                writer,
                "{}",
                Output::pretty_fmt_args::<ENABLE_ANSI_COLORS>(format_args!(
                    "<r>kind<r>: <green>\"{}\"<r>",
                    <&'static str>::from(self.output_kind)
                ))
            )?;

            if self.hash != 0 {
                formatter.print_comma::<ENABLE_ANSI_COLORS>(writer).expect("unreachable");
                writer.write_str("\n")?;

                formatter.write_indent(writer)?;
                write!(
                    writer,
                    "{}",
                    Output::pretty_fmt_args::<ENABLE_ANSI_COLORS>(format_args!(
                        "<r>hash<r>: <green>\"{}\"<r>",
                        bun_core::fmt::truncated_hash32(self.hash)
                    ))
                )?;
            }

            formatter.print_comma::<ENABLE_ANSI_COLORS>(writer).expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            formatter.reset_line();
            self.blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;

            if self.output_kind != OutputKind::Sourcemap {
                formatter.print_comma::<ENABLE_ANSI_COLORS>(writer).expect("unreachable");
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                writer.write_str(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                    "<r>sourcemap<r>: ",
                ))?;

                if let Some(sourcemap_value) = self.sourcemap.get() {
                    if let Some(sourcemap) = sourcemap_value.as_::<BuildArtifact>() {
                        sourcemap.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
                    } else {
                        writer.write_str(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                            "<yellow>null<r>",
                        ))?;
                    }
                } else {
                    writer.write_str(&Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                        "<yellow>null<r>",
                    ))?;
                }
            }
        }
        writer.write_str("\n")?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        formatter.reset_line();
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/JSBundler.zig (2050 lines)
//   confidence: medium
//   todos:      18
//   notes:      Names self-referential slices need raw ptrs; MiniImportRecord slice fields are borrowed (raw *const [u8]); Load.path/namespace changed from borrowed to owned; std.fs.cwd().openDir replaced with bun_sys stub
// ──────────────────────────────────────────────────────────────────────────
