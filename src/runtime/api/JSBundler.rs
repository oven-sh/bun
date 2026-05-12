//! `Bun.build()` plugin host + `BuildArtifact` JS wrapper.

use bun_options_types::{LoaderExt as _, TargetExt as _};
use core::ffi::c_void;

use crate::webcore::Blob;
use crate::webcore::blob::BlobExt;
use bun_ast::Index;
use bun_ast::{Loader, Target};
use bun_bundler::BundleV2;
use bun_bundler::options;
use bun_collections::{StringArrayHashMap, StringHashMap, StringMap, StringSet};
use bun_core::MutableString;
use bun_core::Output;
use bun_core::{String as BunString, ZigString, strings};
use bun_jsc::ConcurrentTask::ConcurrentTask;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult};
use bun_options_types::compile_target::CompileTarget;
use bun_options_types::schema::api; // bun.schema.api
use bun_paths as resolve_path;
use bun_resolver::{self as resolver, fs as Fs};
use bun_standalone_graph::StandaloneModuleGraph;

// `CompileTarget.fromJS` / `.fromSlice` are JSC-aware option parsers shared
// with the CLI build path; live in `bun_bundler_jsc::options_jsc`.
use bun_bundler_jsc::options_jsc::{compile_target_from_js, compile_target_from_slice};

pub mod js_bundler {
    use super::*;
    use bun_core::ZigStringSlice;
    use bun_jsc::JSObject;
    use bun_sys::FdExt;

    type OwnedString = MutableString;

    /// `options::JSX::Runtime` → `api::JsxRuntime` (only the reverse `From`
    /// exists upstream).
    fn jsx_runtime_to_api(r: options::JSX::Runtime) -> api::JsxRuntime {
        match r {
            options::JSX::Runtime::_None => api::JsxRuntime::_none,
            options::JSX::Runtime::Automatic => api::JsxRuntime::Automatic,
            options::JSX::Runtime::Classic => api::JsxRuntime::Classic,
            options::JSX::Runtime::Solid => api::JsxRuntime::Solid,
        }
    }

    /// A map of file paths to their in-memory contents.
    /// LAYERING: the data-only struct (`map: StringHashMap<Box<[u8]>>`) and
    /// `get`/`contains`/`resolve` live in `bun_bundler::bundle_v2` so the
    /// bundler thread can read it without depending on `bun_runtime`. Only
    /// the JS-aware `from_js` constructor lives here.
    pub use bun_bundler::bundle_v2::api::JSBundler::FileMap;

    /// Parse the `files` option from JavaScript.
    /// Expected format: `Record<string, string | Blob | File | TypedArray | ArrayBuffer>`.
    /// Uses async (`from_js_async`) parsing so the resulting bytes are owned —
    /// the bundler runs on a separate thread and must not borrow JS heap memory.
    pub fn file_map_from_js(
        global_this: &JSGlobalObject,
        files_value: JSValue,
    ) -> JsResult<FileMap> {
        let mut this = FileMap::default();
        // errdefer this.deinit() — `FileMap` (Box<[u8]> values) drops on `?`.

        let Some(files_obj) = files_value.get_object() else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("Expected files to be an object"))
            );
        };

        let mut files_iter = jsc::JSPropertyIterator::init(
            global_this,
            files_obj,
            jsc::JSPropertyIteratorOptions {
                skip_empty_name: true,
                include_value: true,
                ..Default::default()
            },
        )?;

        this.map.reserve(files_iter.len);

        while let Some(prop) = files_iter.next()? {
            let property_value = files_iter.value;

            // Parse the value as BlobOrStringOrBuffer using async mode for thread safety.
            // Async mode `protect()`s any JS-backed buffer; adopt into a
            // `ThreadSafe` so the guard unprotects + drops at end of iteration.
            let blob_or_string = match crate::node::BlobOrStringOrBuffer::from_js_async(
                global_this,
                property_value,
            )? {
                Some(v) => bun_jsc::ThreadSafe::adopt(v),
                None => {
                    return Err(global_this.throw_invalid_arguments(format_args!("Expected file content to be a string, Blob, File, TypedArray, or ArrayBuffer")));
                }
            };
            // Async mode guarantees `blob_or_string` owns its bytes (Blob data is
            // copied, JS strings are decoded). Extract them into the lower-tier
            // map and release the wrapper immediately so no JSC handle crosses
            // threads.
            // PERF(port): Zig stores the `BlobOrStringOrBuffer` directly; here we
            // make one extra owned copy to keep `bun_bundler` free of JSC types.
            let bytes: Box<[u8]> = blob_or_string.slice().to_vec().into_boxed_slice();
            drop(blob_or_string);

            // Clone the key since we need to own it.
            let mut key = prop.to_owned_slice();

            // Normalize backslashes to forward slashes for cross-platform consistency.
            // Use dangerouslyConvertPathToPosixInPlace which always converts \ to /
            // (uses sep_windows constant, not sep which varies by target).
            bun_paths::resolve_path::dangerously_convert_path_to_posix_in_place::<u8>(
                key.as_mut_slice(),
            );

            // PERF(port): was assume_capacity
            this.map.put_assume_capacity(&key, bytes);
        }

        Ok(this)
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
        pub force_node_env: options::ForceNodeEnv,
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
                define: StringMap::init(false),
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
                force_node_env: options::ForceNodeEnv::Unspecified,
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
                    this.compile_target = compile_target_from_js(global_this, compile_value)?;
                    return Ok(Some(this));
                } else if compile_value.is_object() {
                    break 'brk compile_value;
                } else {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected compile to be a boolean or string or options object"
                    )));
                }
            };

            if let Some(target) = object.get_own(global_this, &BunString::static_str("target"))? {
                this.compile_target = compile_target_from_js(global_this, target)?;
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

            if let Some(executable_path) =
                object.get_own(global_this, &BunString::static_str("executablePath"))?
            {
                let slice = executable_path.to_slice(global_this)?;
                let path_z = bun_core::ZBox::from_bytes(slice.slice());
                if bun_sys::exists_at_type(bun_sys::Fd::cwd(), path_z.as_zstr())
                    .unwrap_or(bun_sys::ExistsAtType::Directory)
                    != bun_sys::ExistsAtType::File
                {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "executablePath must be a valid path to a Bun executable"
                    )));
                }

                this.executable_path.append_slice_exact(slice.slice())?;
            }

            if let Some(windows) = object.get_own_truthy(global_this, "windows")? {
                if !windows.is_object() {
                    return Err(global_this
                        .throw_invalid_arguments(format_args!("windows must be an object")));
                }

                if let Some(hide_console) =
                    windows.get_own(global_this, &BunString::static_str("hideConsole"))?
                {
                    this.windows_hide_console = hide_console.to_boolean();
                }

                if let Some(windows_icon_path) =
                    windows.get_own(global_this, &BunString::static_str("icon"))?
                {
                    let slice = windows_icon_path.to_slice(global_this)?;
                    let path_z = bun_core::ZBox::from_bytes(slice.slice());
                    if bun_sys::exists_at_type(bun_sys::Fd::cwd(), path_z.as_zstr())
                        .unwrap_or(bun_sys::ExistsAtType::Directory)
                        != bun_sys::ExistsAtType::File
                    {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "windows.icon must be a valid path to an ico file"
                        )));
                    }

                    this.windows_icon_path.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_title) =
                    windows.get_own(global_this, &BunString::static_str("title"))?
                {
                    let slice = windows_title.to_slice(global_this)?;
                    this.windows_title.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_publisher) =
                    windows.get_own(global_this, &BunString::static_str("publisher"))?
                {
                    let slice = windows_publisher.to_slice(global_this)?;
                    this.windows_publisher.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_version) =
                    windows.get_own(global_this, &BunString::static_str("version"))?
                {
                    let slice = windows_version.to_slice(global_this)?;
                    this.windows_version.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_description) =
                    windows.get_own(global_this, &BunString::static_str("description"))?
                {
                    let slice = windows_description.to_slice(global_this)?;
                    this.windows_description.append_slice_exact(slice.slice())?;
                }

                if let Some(windows_copyright) =
                    windows.get_own(global_this, &BunString::static_str("copyright"))?
                {
                    let slice = windows_copyright.to_slice(global_this)?;
                    this.windows_copyright.append_slice_exact(slice.slice())?;
                }
            }

            if let Some(outfile) = object.get_own(global_this, &BunString::static_str("outfile"))? {
                let slice = outfile.to_slice(global_this)?;
                this.outfile.append_slice_exact(slice.slice())?;
            }

            if let Some(autoload_dotenv) =
                object.get_boolean_loose(global_this, "autoloadDotenv")?
            {
                this.autoload_dotenv = autoload_dotenv;
            }

            if let Some(autoload_bunfig) =
                object.get_boolean_loose(global_this, "autoloadBunfig")?
            {
                this.autoload_bunfig = autoload_bunfig;
            }

            if let Some(autoload_tsconfig) =
                object.get_boolean_loose(global_this, "autoloadTsconfig")?
            {
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
            // Config implements Drop, so functional-record-update from Default::default()
            // is rejected by rustc (E0509). Construct default then mutate instead.
            let mut this = Config::default();
            this.define = StringMap::init(true);
            // errdefer this.deinit(allocator) — handled by `impl Drop for Config` on `?` paths.
            // errdefer if (plugins.*) |plugin| plugin.deinit() — scopeguard below.
            let mut plugins = scopeguard::guard(plugins, |p| {
                if let Some(pl) = p.take() {
                    Plugin::destroy(pl);
                }
            });

            let mut did_set_target = false;
            if let Some(slice) = config.get_optional_slice(global_this, b"target")? {
                if slice.slice().starts_with(b"bun-") {
                    this.compile = Some(CompileOptions {
                        compile_target: compile_target_from_slice(global_this, slice.slice())?,
                        ..Default::default()
                    });
                    this.target = Target::Bun;
                    did_set_target = true;
                } else {
                    this.target = match options::TARGET_MAP.get(slice.slice()) {
                        Some(t) => *t,
                        None => {
                            return Err(global_this.throw_invalid_arguments(
                                format_args!(
                                    "Expected target to be one of 'browser', 'node', 'bun', 'macro', or 'bun-<target>', got {}",
                                    bstr::BStr::new(slice.slice())
                                ),
                            ));
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
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Expected plugin to be an object"
                        )));
                    }

                    if let Some(slice) = plugin.get_optional_slice(global_this, b"name")? {
                        if slice.slice().is_empty() {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "Expected plugin to have a non-empty name"
                            )));
                        }
                        drop(slice);
                    } else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Expected plugin to have a name"
                        )));
                    }

                    let Some(function) = plugin.get_function(global_this, b"setup")? else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Expected plugin to have a setup() function"
                        )));
                    };

                    let bun_plugins: *mut Plugin = match **plugins {
                        Some(p) => p,
                        None => {
                            let p = Plugin::create(
                                global_this,
                                match this.target {
                                    Target::Bun | Target::BunMacro => jsc::BunPluginTarget::Bun,
                                    Target::Node => jsc::BunPluginTarget::Node,
                                    _ => jsc::BunPluginTarget::Browser,
                                },
                            );
                            **plugins = Some(p);
                            p
                        }
                    };

                    let is_last = i == (length as usize).saturating_sub(1);
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
                            // SAFETY: bun_vm() returns the live process VirtualMachine pointer.
                            global_this.bun_vm().as_mut().wait_for_promise(promise);
                            match promise
                                .unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled)
                            {
                                jsc::PromiseResult::Pending => unreachable!(),
                                jsc::PromiseResult::Fulfilled(val) => {
                                    plugin_result = val;
                                }
                                jsc::PromiseResult::Rejected(err) => {
                                    return Err(global_this.throw_value(err));
                                }
                            }
                        }
                    }

                    if let Some(err) = plugin_result.to_error() {
                        return Err(global_this.throw_value(err));
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
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "target must be 'bun' when bytecode is true"
                        )));
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
            if let Some(slice) = config.get_optional_slice(global_this, b"outdir")? {
                this.outdir.append_slice_exact(slice.slice())?;
                has_out_dir = true;
                drop(slice);
            }

            if let Some(slice) = config.get_optional_slice(global_this, b"banner")? {
                this.banner.append_slice_exact(slice.slice())?;
                drop(slice);
            }

            if let Some(slice) = config.get_optional_slice(global_this, b"footer")? {
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
                    this.source_map = source_map_js.to_enum_from_map(
                        global_this,
                        "sourcemap",
                        &options::SOURCE_MAP_OPTION_MAP,
                        "\"none\", \"linked\", \"inline\", \"external\"",
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
                        match api::DotEnvBehavior::parse_str(slice.slice()) {
                            Ok((behavior, prefix)) => {
                                this.env_behavior = behavior;
                                if let Some(prefix) = prefix {
                                    this.env_prefix.append_slice_exact(prefix)?;
                                }
                            }
                            Err(()) => {
                                return Err(global_this.throw_invalid_arguments(format_args!("env must be 'inline', 'disable', or a string with a '*' character")));
                            }
                        }
                        drop(slice);
                    } else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "env must be 'inline', 'disable', or a string with a '*' character"
                        )));
                    }
                }
            }

            if let Some(packages) = config.get_optional_enum_from_map(
                global_this,
                "packages",
                &options::PACKAGES_OPTION_MAP,
                "\"bundle\", \"external\"",
            )? {
                this.packages = packages;
            }

            // Parse JSX configuration
            if let Some(jsx_value) = config.get_truthy(global_this, "jsx")? {
                if !jsx_value.is_object() {
                    return Err(
                        global_this.throw_invalid_arguments(format_args!("jsx must be an object"))
                    );
                }

                if let Some(slice) = jsx_value.get_optional_slice(global_this, b"runtime")? {
                    let mut str_lower = [0u8; 128];
                    let len = slice.slice().len().min(str_lower.len());
                    let _ =
                        bun_core::copy_lowercase(&slice.slice()[0..len], &mut str_lower[0..len]);
                    if let Some(runtime) = options::JSX::RUNTIME_MAP.get(&str_lower[0..len]) {
                        this.jsx.runtime = jsx_runtime_to_api(runtime.runtime);
                        if let Some(dev) = runtime.development {
                            this.jsx.development = dev;
                        }
                    } else {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Invalid jsx.runtime: '{}'. Must be one of: 'classic', 'automatic', 'react', 'react-jsx', or 'react-jsxdev'",
                            bstr::BStr::new(slice.slice())
                        )));
                    }
                    drop(slice);
                }

                if let Some(slice) = jsx_value.get_optional_slice(global_this, b"factory")? {
                    this.jsx.factory = Box::<[u8]>::from(slice.slice());
                    drop(slice);
                }

                if let Some(slice) = jsx_value.get_optional_slice(global_this, b"fragment")? {
                    this.jsx.fragment = Box::<[u8]>::from(slice.slice());
                    drop(slice);
                }

                if let Some(slice) = jsx_value.get_optional_slice(global_this, b"importSource")? {
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

            if let Some(format) = config.get_optional_enum_from_map(
                global_this,
                "format",
                &options::Format::MAP,
                "\"esm\", \"cjs\", \"iife\"",
            )? {
                this.format = format;

                if this.bytecode && format != options::Format::Cjs && format != options::Format::Esm
                {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "format must be 'cjs' or 'esm' when bytecode is true."
                    )));
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
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected minify to be a boolean or an object"
                    )));
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
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected entrypoints to be an array of strings"
                )));
            }

            // Parse the files option for in-memory files
            if let Some(files_obj) = config.get_own_object(global_this, "files")? {
                this.files = file_map_from_js(global_this, JSValue::from_cell(files_obj))?;
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
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected conditions to be an array of strings"
                    )));
                }
            }

            {
                let path: ZigStringSlice = 'brk: {
                    if let Some(slice) = config.get_optional_slice(global_this, b"root")? {
                        break 'brk slice;
                    }

                    let entry_points = this.entry_points.keys();

                    // Check if all entry points are in the FileMap - if so, use cwd
                    if !this.files.map.is_empty() {
                        let mut all_in_filemap = true;
                        for ep in entry_points {
                            if !this.files.contains(ep) {
                                all_in_filemap = false;
                                break;
                            }
                        }
                        if all_in_filemap {
                            break 'brk ZigStringSlice::from_utf8_never_free(b".");
                        }
                    }

                    if entry_points.len() == 1 {
                        // TODO(port): std.fs.path.dirname → bun_paths::dirname
                        let d = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                            &entry_points[0],
                        );
                        break 'brk ZigStringSlice::from_utf8_never_free(if d.is_empty() {
                            b"."
                        } else {
                            d
                        });
                    }

                    // PORT NOTE: `get_if_exists_longest_common_path` wants `&[&[u8]]`
                    // but `StringSet::keys()` yields `&[Box<[u8]>]`; build a borrow
                    // adapter on the stack.
                    let borrowed: Vec<&[u8]> = entry_points.iter().map(|b| b.as_ref()).collect();
                    break 'brk ZigStringSlice::from_utf8_never_free(
                        bun_paths::resolve_path::get_if_exists_longest_common_path(&borrowed)
                            .unwrap_or(b"."),
                    );
                };

                // TODO(port): std.fs.cwd().openDir — banned std::fs; use bun_sys
                let dir = match bun_sys::open_dir_at(bun_sys::Fd::cwd(), path.slice()) {
                    Ok(d) => d,
                    Err(err) => {
                        return Err(global_this.throw(format_args!(
                            "{}: failed to open root directory: {}",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(path.slice())
                        )));
                    }
                };
                let _close = scopeguard::guard(dir, |d| d.close());

                let mut rootdir_buf = bun_paths::PathBuffer::uninit();
                let rootdir = match bun_sys::get_fd_path(*_close, &mut rootdir_buf) {
                    Ok(p) => p,
                    Err(err) => {
                        return Err(global_this.throw(format_args!(
                            "{}: failed to get full root directory path: {}",
                            bstr::BStr::new(err.name()),
                            bstr::BStr::new(path.slice())
                        )));
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

            if let Some(allow_unresolved_val) =
                config.get_own(global_this, &BunString::static_str("allowUnresolved"))?
            {
                if !allow_unresolved_val.is_undefined() && !allow_unresolved_val.is_null() {
                    if !(allow_unresolved_val.is_cell()
                        && allow_unresolved_val.js_type().is_array())
                    {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "allowUnresolved must be an array"
                        )));
                    }
                    this.allow_unresolved = Some(StringSet::default());
                    if allow_unresolved_val.get_length(global_this)? > 0 {
                        let mut iter = allow_unresolved_val.array_iterator(global_this)?;
                        while let Some(entry) = iter.next()? {
                            let slice = entry.to_slice_or_null(global_this)?;
                            this.allow_unresolved
                                .as_mut()
                                .unwrap()
                                .insert(slice.slice())?;
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

            if let Some(slice) = config.get_optional_slice(global_this, b"publicPath")? {
                this.public_path.append_slice_exact(slice.slice())?;
                drop(slice);
            }

            if let Some(naming) = config.get_truthy(global_this, "naming")? {
                // Zig kept a separate `owned_*: OwnedString` buffer per template
                // and pointed `template.data` (a `[]const u8`) into it. Rust's
                // `PathTemplate.data` is already `Box<[u8]>` (owned), so build
                // straight into it — no self-referential borrow, no clone.
                let with_dot_slash = |s: &[u8]| -> Box<[u8]> {
                    if s.starts_with(b"./") {
                        Box::<[u8]>::from(s)
                    } else {
                        let mut buf = Vec::with_capacity(2 + s.len());
                        buf.extend_from_slice(b"./");
                        buf.extend_from_slice(s);
                        buf.into_boxed_slice()
                    }
                };
                if naming.is_string() {
                    if let Some(slice) = config.get_optional_slice(global_this, b"naming")? {
                        this.names.entry_point.data = with_dot_slash(slice.slice());
                        drop(slice);
                    }
                } else if naming.is_object() {
                    if let Some(slice) = naming.get_optional_slice(global_this, b"entry")? {
                        this.names.entry_point.data = with_dot_slash(slice.slice());
                        drop(slice);
                    }

                    if let Some(slice) = naming.get_optional_slice(global_this, b"chunk")? {
                        this.names.chunk.data = with_dot_slash(slice.slice());
                        drop(slice);
                    }

                    if let Some(slice) = naming.get_optional_slice(global_this, b"asset")? {
                        this.names.asset.data = with_dot_slash(slice.slice());
                        drop(slice);
                    }
                } else {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected naming to be a string or an object"
                    )));
                }
            }

            if let Some(define) = config.get_own_object(global_this, "define")? {
                // SAFETY: `get_own_object` only returns non-null live JSObject*.
                let define_ref = unsafe { &*define };
                let mut define_iter = jsc::JSPropertyIterator::init(
                    global_this,
                    define_ref,
                    jsc::JSPropertyIteratorOptions {
                        skip_empty_name: true,
                        include_value: true,
                        ..Default::default()
                    },
                )?;

                while let Some(prop) = define_iter.next()? {
                    let property_value = define_iter.value;
                    let value_type = property_value.js_type();

                    if !value_type.is_string_like() {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "define \"{}\" must be a JSON string",
                            prop
                        )));
                    }

                    let mut val = ZigString::init(b"");
                    property_value.to_zig_string(&mut val, global_this)?;
                    if val.len == 0 {
                        val = ZigString::from_utf8(b"\"\"");
                    }

                    let key = prop.to_owned_slice();

                    // value is always cloned
                    let value = val.to_slice();

                    // .insert clones the value, but not the key
                    this.define.insert(&key, value.slice())?;
                    drop(value);
                }
            }

            if let Some(loaders) = config.get_own_object(global_this, "loader")? {
                // SAFETY: `get_own_object` only returns non-null live JSObject*.
                let loaders_ref = unsafe { &*loaders };
                let mut loader_iter = jsc::JSPropertyIterator::init(
                    global_this,
                    loaders_ref,
                    jsc::JSPropertyIteratorOptions {
                        skip_empty_name: true,
                        include_value: true,
                        ..Default::default()
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

                loader_names.reserve_exact(loader_iter.len);
                loader_values.reserve_exact(loader_iter.len);

                while let Some(prop) = loader_iter.next()? {
                    let prop_slice = prop.to_utf8();
                    if !prop_slice.slice().starts_with(b".") || prop.length() < 2 {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "loader property names must be file extensions, such as '.txt'"
                        )));
                    }
                    drop(prop_slice);

                    // PERF(port): was assume_capacity
                    loader_values.push(loader_iter.value.to_enum_from_map(
                        global_this,
                        "loader",
                        &options::LOADER_API_NAMES,
                        "\"js\", \"jsx\", \"ts\", \"tsx\", \"css\", \"file\", \"json\", \"toml\", \"wasm\", \"napi\", \"base64\", \"dataurl\", \"text\", \"html\"",
                    )?);
                    loader_names.push(prop.to_owned_slice().into_boxed_slice());
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
            if let Some(metafile_value) =
                config.get_own(global_this, &BunString::static_str("metafile"))?
            {
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
                    if let Some(slice) = metafile_value.get_optional_slice(global_this, b"json")? {
                        this.metafile_json_path.append_slice_exact(slice.slice())?;
                        drop(slice);
                    }
                    if let Some(slice) =
                        metafile_value.get_optional_slice(global_this, b"markdown")?
                    {
                        this.metafile_markdown_path
                            .append_slice_exact(slice.slice())?;
                        drop(slice);
                    }
                } else if !metafile_value.is_undefined_or_null() {
                    return Err(global_this.throw_invalid_arguments(format_args!("Expected metafile to be a boolean, string, or object with json/markdown paths")));
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
                let is_standalone_html = this.target == Target::Browser && has_all_html_entrypoints;
                if !is_standalone_html {
                    this.target = Target::Bun;

                    let define_keys = compile.compile_target.define_keys();
                    let define_values = compile.compile_target.define_values();
                    debug_assert_eq!(define_keys.len(), define_values.len());
                    for (key, value) in define_keys.iter().zip(define_values) {
                        this.define.insert(key, value)?;
                    }

                    let base_public_path = StandaloneModuleGraph::target_base_public_path(
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
                        let entry_point: &[u8] = &this.entry_points.keys()[0];
                        let mut outfile = bun_paths::basename(entry_point);
                        let ext = bun_paths::extension(outfile);
                        if !ext.is_empty() {
                            outfile = &outfile[0..outfile.len() - ext.len()];
                        }

                        if outfile == b"index" {
                            let d = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                entry_point,
                            );
                            outfile = bun_paths::basename(if d.is_empty() { b"index" } else { d });
                        }

                        if outfile == b"bun" {
                            let d = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                                entry_point,
                            );
                            outfile = bun_paths::basename(if d.is_empty() { b"bun" } else { d });
                        }

                        // If argv[0] is "bun" or "bunx", we don't check if the binary is standalone
                        if outfile == b"bun" || outfile == b"bunx" {
                            return Err(global_this.throw_invalid_arguments(format_args!("cannot use compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for compile.outfile")));
                        }

                        // PORT NOTE (diverges from Zig spec — flake fix): when no
                        // `outdir`/`outfile` was given, the Zig path stores only
                        // the basename here and `doCompilation` later resolves it
                        // against the process-wide `top_level_dir`. Under the JS
                        // API that means every `Bun.build({compile: true,
                        // entrypoints: [tmp + "/app.js"]})` from any test process
                        // writes the *same* `<cwd>/app`, so concurrently-running
                        // test files race on the executable (observed flake in
                        // bun-build-compile-sourcemap.test.ts). Placing the
                        // auto-derived executable next to its entry point — the
                        // only path the caller actually supplied — keeps each
                        // build's output inside its own (temp) directory and is
                        // also the more intuitive default for a programmatic API.
                        // Explicit `outfile`/`outdir` are unaffected.
                        let entry_dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(
                            entry_point,
                        );
                        if this.outdir.is_empty()
                            && !entry_dir.is_empty()
                            && bun_paths::is_absolute(entry_dir)
                        {
                            compile.outfile.append_slice_exact(entry_dir)?;
                            compile
                                .outfile
                                .append_slice_exact(core::slice::from_ref(&bun_paths::SEP))?;
                        }
                        compile.outfile.append_slice_exact(outfile)?;
                    }
                }
            }

            // ESM bytecode requires compile because module_info (import/export metadata)
            // is only available in compiled binaries. Without it, JSC must parse the file
            // twice (once for module analysis, once for bytecode), which is a deopt.
            if this.bytecode && this.format == options::Format::Esm && this.compile.is_none() {
                return Err(global_this.throw_invalid_arguments(format_args!("ESM bytecode requires compile: true. Use format: 'cjs' for bytecode without compile.")));
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
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Cannot use compile with target 'browser' and splitting for standalone HTML"
                    )));
                }
            }

            scopeguard::ScopeGuard::into_inner(plugins);
            Ok(this)
        }
    }

    // `Config` owns only `Drop`-aware fields (`Box<[u8]>` map values, `Vec`s,
    // `MutableString`, `Strong`); no manual `Drop` needed.

    /// Zig kept a separate `owned_*: OwnedString` per template and pointed
    /// `template.data: []const u8` into it (self-referential). Rust's
    /// `PathTemplate.data` is `Box<[u8]>` (owned), so the indirection is gone.
    pub struct Names {
        pub entry_point: options::PathTemplate,
        pub chunk: options::PathTemplate,
        pub asset: options::PathTemplate,
    }

    impl Default for Names {
        fn default() -> Self {
            Self {
                entry_point: options::PathTemplate::FILE.into(),
                chunk: options::PathTemplate::CHUNK.into(),
                asset: options::PathTemplate::ASSET.into(),
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
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected a config object to be passed to Bun.build"
            )));
        }

        let vm = global_this.bun_vm();

        // Detect and prevent calling Bun.build from within a macro during bundling.
        // This would cause a deadlock because:
        // 1. The bundler thread (singleton) is processing the outer Bun.build
        // 2. During parsing, it encounters a macro and evaluates it
        // 3. The macro calls Bun.build, which tries to enqueue to the same singleton thread
        // 4. The singleton thread is blocked waiting for the macro to complete -> deadlock
        if vm.macro_mode {
            return Err(global_this.throw(format_args!("Bun.build cannot be called from within a macro during bundling.\n\n\
                 This would cause a deadlock because the bundler is waiting for the macro to complete,\n\
                 but the macro's Bun.build call is waiting for the bundler.\n\n\
                 To bundle code at compile time in a macro, use Bun.spawnSync to invoke the CLI:\n  \
                 const result = Bun.spawnSync([\"bun\", \"build\", entrypoint, \"--format=esm\"]);")));
        }

        let mut plugins: Option<*mut Plugin> = None;
        let config = Config::from_js(global_this, arguments[0], &mut plugins)?;

        // SAFETY: bun_vm() returns the live process VirtualMachine pointer.
        let event_loop = unsafe { (*vm).event_loop() };

        // `BundleV2.generateFromJavaScript` — the completion-task struct lives in
        // `crate::api::js_bundle_completion_task` (bun_runtime owns it because its
        // fields name `Config`/`Plugin`/`HTMLBundle::Route`; lower-tier crates
        // cannot depend on those).
        let completion =
            crate::api::js_bundle_completion_task::create_and_schedule_completion_task(
                config,
                plugins.and_then(core::ptr::NonNull::new),
                global_this,
                event_loop,
            )
            .map_err(|_| JsError::OutOfMemory)?;
        // SAFETY: `completion` is the freshly-boxed allocation returned above;
        // sole owner on the JS thread until enqueued task runs.
        unsafe {
            (*completion).promise = jsc::JSPromiseStrong::init(global_this);
            Ok((*completion).promise.value())
        }
    }

    /// `Bun.build(config)`
    #[bun_jsc::host_fn]
    pub fn build_fn(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        build(global_this, arguments.slice())
    }

    // PORT NOTE: `Resolve`/`Load`/`MiniImportRecord`/etc. are owned by
    // `bun_bundler::bundle_v2::api::JSBundler` so that `BundleV2` can operate
    // on them directly (`on_resolve_async`/`on_load_async`). `dispatch()` and
    // `run_on_js_thread()` are also inherent methods there — they only need
    // `bun_event_loop` types and the `Plugin` opaque, neither of which is a T6
    // dependency. Only the JSC-aware bits (`on_defer`, `JSBundlerPlugin__*`
    // C-ABI exports) live here.
    pub use bun_bundler::bundle_v2::api::JSBundler::{
        Load, LoadSuccess, LoadValue, MiniImportRecord, Resolve, ResolveSuccess, ResolveValue,
    };

    /// `&mut BundleV2` for the live backref stored on `Resolve`/`Load`.
    ///
    /// Centralises the `*mut BundleV2 → &mut` deref so the C++-called thunks
    /// (`JSBundlerPlugin__onResolveAsync`, `on_defer`, `…__onLoadAsync`,
    /// `…__addError`, `on_notify_defer_raw`) stay safe at the call site. `bv2`
    /// is the back-reference set in `Resolve::init`/`Load::init`; the
    /// `BundleV2` heap allocation outlives every plugin callback (owner-
    /// creates-child, single-JS-thread). The `BundleV2` storage is heap-
    /// disjoint from `Resolve`/`Load`, so the returned `&mut` does not alias
    /// the caller's `&mut Resolve`/`&mut Load`.
    #[inline]
    fn bv2_mut<'a>(bv2: *mut BundleV2<'static>) -> &'a mut BundleV2<'static> {
        // SAFETY: see fn doc — live backref (owner-creates-child), single
        // JS-thread, disjoint heap from the `Resolve`/`Load` callers borrow.
        unsafe { &mut *bv2 }
    }

    /// `&mut Plugin` for the live `BundleV2` backref stored on `Resolve`/`Load`.
    ///
    /// Centralises the `Option<NonNull> → &mut T` deref so the three callers
    /// (`JSBundlerPlugin__onResolveAsync`, `on_defer`,
    /// `JSBundlerPlugin__onLoadAsync`) stay safe at the call site. `plugins`
    /// is `Some` whenever the plugin chain is dispatched (asserted by
    /// `enqueue_on_js_loop_for_plugins`). The `Plugin` storage is heap-
    /// disjoint from `Resolve`/`Load`, so the returned `&mut` does not alias
    /// the caller's `&mut Resolve`/`&mut Load`.
    #[inline]
    fn bv2_plugin<'a>(bv2: *mut BundleV2<'static>) -> &'a mut Plugin {
        // SAFETY: see fn doc — `plugins.is_some()`, disjoint heap.
        unsafe { &mut *bv2_mut(bv2).plugins.unwrap().as_ptr() }
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
        if path_value.is_empty_or_undefined_or_null()
            || namespace_value.is_empty_or_undefined_or_null()
        {
            resolve.value = ResolveValue::NoMatch;
        } else {
            let global = bv2_plugin(resolve.bv2).global_object();
            // `to_slice_clone` already heap-allocates; `into_vec` moves that
            // buffer out instead of allocating a second copy.
            let path = path_value
                .to_slice_clone(global)
                .expect("Unexpected: path is not a string")
                .into_vec()
                .into_boxed_slice();
            let namespace = namespace_value
                .to_slice_clone(global)
                .expect("Unexpected: namespace is not a string")
                .into_vec()
                .into_boxed_slice();
            resolve.value = ResolveValue::Success(ResolveSuccess {
                path,
                namespace,
                external: external_value.to_boolean(),
            });
        }

        bv2_mut(resolve.bv2).on_resolve_async(resolve);
    }

    bun_output::declare_scope!(BUNDLER_DEFERRED, hidden);

    /// JSC-aware plumbing for `Load` (upstream owns `init`/`dispatch`/
    /// `run_on_js_thread`/`bake_graph`). Only `on_defer` lives here because it
    /// returns a `JSValue` and throws on the `JSGlobalObject`.
    pub trait LoadJsExt {
        fn on_defer(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue>;
    }

    impl LoadJsExt for Load {
        fn on_defer(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            if self.called_defer {
                return Err(global_object.throw(format_args!(
                    "Can't call .defer() more than once within an onLoad plugin"
                )));
            }
            self.called_defer = true;

            bun_output::scoped_log!(
                BUNDLER_DEFERRED,
                "JSBundlerPlugin__onDefer(0x{:x}, {})",
                std::ptr::from_ref(self) as usize,
                bstr::BStr::new(&self.path)
            );

            // Notify the *bundler thread* about the deferral. This will
            // decrement the pending item counter and increment the deferred
            // counter. Must land on `parse_task.ctx.loop()` (the loop running
            // BundleV2), which is distinct from `js_loop_for_plugins()` (the
            // plugin host's JS loop) when `Bun.build` runs the bundler on its
            // own Mini event loop.
            // SAFETY: parse_task.ctx and bv2 are valid backrefs; `r#loop()`
            // points at a live `AnyEventLoop` owned by the bundle thread /
            // runtime for the duration of the bundle.
            unsafe {
                let ctx = (*self.parse_task).ctx.expect("ParseTask.ctx unset");
                // SAFETY: write provenance from `ParseTask::init`; bundle outlives plugin.
                let any_loop = ctx
                    .assume_mut()
                    .r#loop()
                    .expect("BundleV2.linker.loop must be set before plugins run");
                match &mut *any_loop.as_ptr() {
                    bun_event_loop::AnyEventLoop::Js { owner } => {
                        owner.enqueue_task_concurrent(ConcurrentTask::from_callback(
                            ctx.as_mut_ptr(),
                            on_notify_defer_raw,
                        ));
                    }
                    bun_event_loop::AnyEventLoop::Mini(mini) => {
                        // `mini.enqueueTaskConcurrentWithExtraCtx(
                        //    Load, BundleV2, this, BundleV2.onNotifyDeferMini, .task)`
                        mini.enqueue_task_concurrent_with_extra_ctx::<Load, BundleV2<'static>>(
                            std::ptr::from_mut::<Load>(self),
                            on_notify_defer_mini_wrap,
                            core::mem::offset_of!(Load, task),
                        );
                    }
                }

                Ok(bv2_plugin(self.bv2).append_defer_promise())
            }
        }
    }

    fn on_notify_defer_raw(ctx: *mut BundleV2<'static>) -> bun_event_loop::JsResult<()> {
        bv2_mut(ctx).on_notify_defer();
        Ok(())
    }

    fn on_notify_defer_mini_wrap(load: *mut Load, ctx: *mut BundleV2<'static>) {
        // SAFETY: callback contract — `load` was passed as the `Context` arg to
        // `enqueue_task_concurrent_with_extra_ctx`; `ctx` is the bundle-thread
        // `BundleV2` backref the mini loop's tick supplies as `ParentContext`.
        BundleV2::on_notify_defer_mini(unsafe { &mut *load }, unsafe { &mut *ctx });
    }

    // TODO(port): move to runtime_sys
    #[unsafe(no_mangle)]
    pub extern "C" fn JSBundlerPlugin__onDefer(
        load: *mut Load,
        global: *mut JSGlobalObject,
    ) -> JSValue {
        // SAFETY: called from C++ with valid pointers
        unsafe { jsc::to_js_host_call(&*global, || (&mut *load).on_defer(&*global)) }
    }

    // TODO(port): move to runtime_sys
    #[unsafe(no_mangle)]
    pub extern "C" fn JSBundlerPlugin__onLoadAsync(
        this: &mut Load,
        _unused: *mut c_void,
        source_code_value: JSValue,
        loader_as_int: JSValue,
    ) {
        jsc::mark_binding();
        if source_code_value.is_empty_or_undefined_or_null()
            || loader_as_int.is_empty_or_undefined_or_null()
        {
            this.value = LoadValue::NoMatch;

            if this.was_file {
                // Faster path: skip the extra threadpool dispatch
                // SAFETY: bv2 backref is valid; pool/worker_pool are live for bundle.
                unsafe {
                    (*(*(*this.bv2).graph.pool.as_ptr()).worker_pool).schedule(
                        bun_threading::thread_pool::Batch::from(core::ptr::addr_of_mut!(
                            (*this.parse_task.as_ptr()).task
                        )),
                    );
                }
                // Zig: this.deinit() — explicit drop
                // TODO(port): Load is not Box-allocated here; Zig deinit only resets value
                this.value = LoadValue::Consumed;
                return;
            }
        } else {
            let loader = api::Loader::from_raw(loader_as_int.as_int32() as u8);
            let global = bv2_plugin(this.bv2).global_object();
            let source_code = match crate::node::StringOrBuffer::from_js_to_owned_slice(
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
            this.value = LoadValue::Success(LoadSuccess {
                loader: bun_ast::Loader::from_api(loader),
                source_code: source_code.into(),
            });
        }

        bv2_mut(this.bv2).on_load_async(this);
    }

    /// Opaque FFI handle for the C++ `JSBundlerPlugin`. The opaque type and
    /// `has_any_matches` (the one method `bun_bundler` needs) live in the
    /// lower-tier crate; JSC-aware methods are added here via `PluginJscExt`.
    pub use bun_bundler::bundle_v2::api::JSBundler::Plugin;

    // `Plugin` is an `opaque_ffi!` handle (`repr(C)` + `UnsafeCell` marker), so
    // `&mut Plugin`/`&Plugin` are ABI-identical to non-null pointers and the
    // validity proof lives in the type. `runSetupFunction` and `globalObject`
    // take `&Plugin` so `add_plugin` can hold a shared reborrow alongside the
    // returned `&JSGlobalObject` without an `unsafe` escape hatch.
    unsafe extern "C" {
        safe fn JSBundlerPlugin__create(
            global: &JSGlobalObject,
            target: jsc::BunPluginTarget,
        ) -> *mut Plugin;
        safe fn JSBundlerPlugin__tombstone(plugin: &Plugin);
        safe fn JSBundlerPlugin__runOnEndCallbacks(
            plugin: &mut Plugin,
            build_promise: JSValue,
            build_result: JSValue,
            rejection: JSValue,
        ) -> JSValue;
        // C++ returns the plugin's owning global (never null; plugin holds a
        // strong ref), so the elided lifetime — output borrows `plugin` — is
        // sound and discharges the deref obligation at the type level.
        safe fn JSBundlerPlugin__globalObject(plugin: &Plugin) -> &JSGlobalObject;
        safe fn JSBundlerPlugin__appendDeferPromise(plugin: &mut Plugin) -> JSValue;
        safe fn JSBundlerPlugin__setConfig(plugin: &mut Plugin, config: *mut c_void);
        safe fn JSBundlerPlugin__runSetupFunction(
            plugin: &Plugin,
            object: JSValue,
            config: JSValue,
            onstart_promises_array: JSValue,
            is_last: JSValue,
            is_bake: JSValue,
        ) -> JSValue;
        safe fn JSBundlerPlugin__loadAndResolvePluginsForServe(
            plugin: &Plugin,
            plugins: JSValue,
            bunfig_folder: JSValue,
        ) -> JSValue;
    }

    /// JSC-aware methods on the C++ `JSBundlerPlugin` opaque. The opaque type
    /// itself is owned by `bun_bundler` (lower tier, no JSC dep), so these are
    /// added as an extension trait rather than an inherent `impl`.
    pub trait PluginJscExt {
        fn create(global: &JSGlobalObject, target: jsc::BunPluginTarget) -> *mut Plugin;
        fn run_on_end_callbacks(
            &mut self,
            global_this: &JSGlobalObject,
            build_promise: &jsc::JSPromise,
            build_result: JSValue,
            rejection: JsResult<JSValue>,
        ) -> JsResult<JSValue>;
        /// `this` must be a live handle previously returned by `Plugin::create`;
        /// non-null is checked via `Plugin::opaque_ref` (panics on null).
        fn destroy(this: *mut Plugin);
        fn global_object(&self) -> &JSGlobalObject;
        fn append_defer_promise(&mut self) -> JSValue;
        fn add_plugin(
            &mut self,
            object: JSValue,
            config: JSValue,
            onstart_promises_array: JSValue,
            is_last: bool,
            is_bake: bool,
        ) -> JsResult<JSValue>;
        fn set_config(&mut self, config: *mut c_void);
        /// Thin FFI forward; the host-call wrapper / exception check is the
        /// caller's responsibility (`jsc::host_fn::from_js_host_call`).
        fn load_and_resolve_plugins_for_serve(
            &self,
            plugins: JSValue,
            bunfig_folder: JSValue,
        ) -> JSValue;
    }

    impl PluginJscExt for Plugin {
        fn create(global: &JSGlobalObject, target: jsc::BunPluginTarget) -> *mut Plugin {
            jsc::mark_binding();
            let plugin = JSBundlerPlugin__create(global, target);
            JSValue::from_cell(plugin).protect();
            plugin
        }

        fn run_on_end_callbacks(
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

            // Zig (JSBundler.zig:1572-1582) opens an explicit `TopExceptionScope`
            // before the FFI call and `returnIfException`s after; the C++ side has
            // a `DECLARE_THROW_SCOPE` whose dtor sets `m_needExceptionCheck` under
            // `BUN_JSC_validateExceptionChecks=1`, so a post-hoc `has_exception()`
            // (whose own scope ctor asserts) is wrong.
            bun_jsc::top_scope!(scope, global_this);
            let value = JSBundlerPlugin__runOnEndCallbacks(
                self,
                build_promise.as_value(global_this),
                build_result,
                rejection_value,
            );
            scope.return_if_exception()?;
            Ok(value)
        }

        fn destroy(this: *mut Plugin) {
            jsc::mark_binding();
            JSBundlerPlugin__tombstone(Plugin::opaque_ref(this));
            JSValue::from_cell(this).unprotect();
        }

        fn global_object(&self) -> &JSGlobalObject {
            JSBundlerPlugin__globalObject(self)
        }

        fn append_defer_promise(&mut self) -> JSValue {
            JSBundlerPlugin__appendDeferPromise(self)
        }

        fn add_plugin(
            &mut self,
            object: JSValue,
            config: JSValue,
            onstart_promises_array: JSValue,
            is_last: bool,
            is_bake: bool,
        ) -> JsResult<JSValue> {
            jsc::mark_binding();
            let _tracer = bun_core::perf::trace("JSBundler.addPlugin");
            // `global_object` and `runSetupFunction` both take `&Plugin`, so a
            // single shared reborrow of `*self` serves both the host-call guard
            // and the closure body — no raw-pointer escape hatch needed.
            let this: &Plugin = &*self;
            jsc::from_js_host_call(this.global_object(), || {
                JSBundlerPlugin__runSetupFunction(
                    this,
                    object,
                    config,
                    onstart_promises_array,
                    JSValue::from(is_last),
                    JSValue::from(is_bake),
                )
            })
        }

        fn set_config(&mut self, config: *mut c_void) {
            jsc::mark_binding();
            JSBundlerPlugin__setConfig(self, config);
        }

        fn load_and_resolve_plugins_for_serve(
            &self,
            plugins: JSValue,
            bunfig_folder: JSValue,
        ) -> JSValue {
            jsc::mark_binding();
            JSBundlerPlugin__loadAndResolvePluginsForServe(self, plugins, bunfig_folder)
        }
    }

    /// Convert a JS exception value into a `logger.Msg`. If the conversion itself
    /// throws (e.g. `Symbol.toPrimitive` on the thrown object throws), clear that
    /// secondary exception and return a generic fallback message so
    /// `onResolveAsync`/`onLoadAsync` is still called and the bundler's
    /// pending-item counter is decremented. Returning early here would cause
    /// `Bun.build` to hang forever waiting on the counter.
    ///
    /// Runs on the JS thread, so allocations go through the global heap (Zig
    /// passes `bun.default_allocator`); the bundler arena is owned by another
    /// thread.
    fn plugin_msg_from_js(plugin: &mut Plugin, file: &[u8], exception: JSValue) -> bun_ast::Msg {
        let global = plugin.global_object();
        match bun_ast_jsc::msg_from_js(global, file.to_vec(), exception) {
            Ok(msg) => msg,
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            Err(_) => {
                // We are already producing a build error for the original plugin
                // exception; the secondary exception from string conversion is not
                // useful to the user and should not be treated as unhandled.
                let _ = global.clear_exception_except_termination();
                bun_ast::Msg {
                    data: bun_ast::Data {
                        text: std::borrow::Cow::Owned(
                            b"A bundler plugin threw a value that could not be converted to a string"
                                .to_vec(),
                        ),
                        location: Some(bun_ast::Location {
                            file: std::borrow::Cow::Owned(file.to_vec()),
                            line: -1,
                            column: -1,
                            ..Default::default()
                        }),
                    },
                    ..Default::default()
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
        match which.as_int32() {
            0 => {
                let resolve = unsafe { bun_ptr::callback_ctx::<Resolve>(ctx) };
                let msg = plugin_msg_from_js(plugin, &resolve.import_record.source_file, exception);
                resolve.value = ResolveValue::Err(msg);
                bv2_mut(resolve.bv2).on_resolve_async(resolve);
            }
            1 => {
                let load = unsafe { bun_ptr::callback_ctx::<Load>(ctx) };
                let msg = plugin_msg_from_js(plugin, &load.path, exception);
                load.value = LoadValue::Err(msg);
                bv2_mut(load.bv2).on_load_async(load);
            }
            _ => panic!("invalid error type"),
        }
    }
}

pub use js_bundler as JSBundler;
pub use js_bundler::Config;
/// `jsc.API.JSBundler.Plugin` — re-exported for `crate::bake` (`SplitBundlerOptions.plugin`).
pub use js_bundler::Plugin;
pub use js_bundler::PluginJscExt;

/// Full `.classes.ts` payload — wraps a `webcore::Blob` plus
/// `loader/path/hash/output_kind/sourcemap`.
#[bun_jsc::JsClass(no_constructor)]
pub struct BuildArtifact {
    pub blob: Blob,
    pub loader: bun_ast::Loader,
    pub path: Box<[u8]>,
    pub hash: u64,
    pub output_kind: OutputKind,
    pub sourcemap: bun_jsc::StrongOptional,
}

/// `BuildArtifact.kind` — what role an output file plays. Single canonical
/// definition lives in `bun_bundler::options` (it backs
/// `OutputFile.output_kind`); re-exported so `crate::api::OutputKind`
/// callers stay unchanged.
pub use bun_bundler::options::OutputKind;

/// `JSValue::as(Blob)` BuildArtifact fallback (JSValue.zig:467) — declared
/// `extern "Rust"` in `bun_jsc::webcore_types`; link-time resolved.
#[unsafe(no_mangle)]
pub fn __bun_blob_from_build_artifact(value: JSValue) -> Option<*mut Blob> {
    <BuildArtifact as bun_jsc::JsClass>::from_js(value)
        .map(|b| unsafe { core::ptr::addr_of_mut!((*b).blob) })
}

impl BuildArtifact {
    /// `BuildArtifact` is not user-constructible (`noConstructor` in .classes.ts).
    pub fn constructor(
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut BuildArtifact> {
        Err(global_this.throw(format_args!("BuildArtifact is not constructable")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_text(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // PERF(port): was @call(bun.callmod_inline, ...)
        this.blob.get_text(global_this, callframe)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_json(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.blob.get_json(global_this, callframe)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_array_buffer(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.blob.get_array_buffer(global_this, callframe)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_slice(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.blob.get_slice(global_this, callframe)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_type(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        BlobExt::get_type(&this.blob, global_this)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_stream(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.blob.get_stream(global_this, callframe)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_path(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::bun_string_jsc::create_utf8_for_js(global_this, &this.path)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_loader(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::bun_string_jsc::create_utf8_for_js(
            global_this,
            <&'static str>::from(this.loader).as_bytes(),
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hash(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        use std::io::Write;
        let mut buf = [0u8; 512];
        let mut cursor = &mut buf[..];
        write!(cursor, "{}", bun_core::fmt::truncated_hash32(this.hash)).expect("Unexpected");
        let written = 512 - cursor.len();
        jsc::bun_string_jsc::create_utf8_for_js(global_this, &buf[..written])
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_size(this: &Self, global_object: &JSGlobalObject) -> JSValue {
        // `Blob::get_size` is `&self` post-R-2 (lazy size caches are
        // Cell-backed inside `Blob`), so a shared borrow is sound here.
        this.blob.get_size(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_mime_type(this: &Self, global_object: &JSGlobalObject) -> JSValue {
        BlobExt::get_type(&this.blob, global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_output_kind(this: &Self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::bun_string_jsc::create_utf8_for_js(
            global_object,
            <&'static str>::from(this.output_kind).as_bytes(),
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_source_map(this: &Self, _global: &JSGlobalObject) -> JSValue {
        this.sourcemap.get().unwrap_or(JSValue::NULL)
    }

    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        write!(
            writer,
            "{}",
            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>BuildArtifact "),
        )?;

        write!(
            writer,
            "{}",
            Output::pretty_fmt_args(
                "(<blue>{}<r>) {{\n",
                ENABLE_ANSI_COLORS,
                (<&'static str>::from(self.output_kind),),
            ),
        )?;

        {
            formatter.indent_inc();
            // PORT NOTE: reshaped for borrowck — scopeguard cannot reborrow
            // `formatter` while it is also borrowed for the body; decrement
            // after the block instead.

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt_args(
                    "<r>path<r>: <green>\"{}\"<r>",
                    ENABLE_ANSI_COLORS,
                    (bstr::BStr::new(&self.path),),
                ),
            )?;
            formatter
                .print_comma::<W, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt_args(
                    "<r>loader<r>: <green>\"{}\"<r>",
                    ENABLE_ANSI_COLORS,
                    (<&'static str>::from(self.loader),),
                ),
            )?;

            formatter
                .print_comma::<W, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;

            write!(
                writer,
                "{}",
                Output::pretty_fmt_args(
                    "<r>kind<r>: <green>\"{}\"<r>",
                    ENABLE_ANSI_COLORS,
                    (<&'static str>::from(self.output_kind),),
                ),
            )?;

            if self.hash != 0 {
                formatter
                    .print_comma::<W, ENABLE_ANSI_COLORS>(writer)
                    .expect("unreachable");
                writer.write_str("\n")?;

                formatter.write_indent(writer)?;
                write!(
                    writer,
                    "{}",
                    Output::pretty_fmt_args(
                        "<r>hash<r>: <green>\"{}\"<r>",
                        ENABLE_ANSI_COLORS,
                        (bun_core::fmt::truncated_hash32(self.hash),),
                    ),
                )?;
            }

            formatter
                .print_comma::<W, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            formatter.reset_line();
            self.blob
                .write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;

            if self.output_kind != OutputKind::Sourcemap {
                formatter
                    .print_comma::<W, ENABLE_ANSI_COLORS>(writer)
                    .expect("unreachable");
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                write!(
                    writer,
                    "{}",
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>sourcemap<r>: "),
                )?;

                if let Some(sourcemap) = self.sourcemap.get().and_then(|v| v.as_::<BuildArtifact>())
                {
                    // SAFETY: `as_` returned a non-null wrapper-owned pointer;
                    // `write_format` is `&self` so a shared borrow is sound
                    // even if `sourcemap` aliases `self`.
                    unsafe { &*sourcemap }
                        .write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
                } else {
                    write!(
                        writer,
                        "{}",
                        Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<yellow>null<r>"),
                    )?;
                }
            }

            formatter.indent_dec();
        }
        writer.write_str("\n")?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        formatter.reset_line();
        Ok(())
    }
}

// ported from: src/runtime/api/JSBundler.zig
