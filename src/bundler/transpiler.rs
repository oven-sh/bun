use bun_alloc::Arena;
use bun_collections::{HashMap, LinearFifo, StringHashMap};
use bun_core::{Error, FeatureFlags, Global, Output};
use bun_dotenv as dot_env;
use bun_http_types::MimeType;

use bun_interchange::{json5::JSON5Parser as JSON5, toml::TOML, yaml::YAML};
use bun_js_parser::{self as js_ast, js_parser, runtime, Ref};
use bun_js_printer as js_printer;
use bun_json as JSON;
use bun_logger as logger;
use bun_paths::{self, PathBuffer};
use bun_perf::system_timer::Timer as SystemTimer;
use bun_resolver::data_url::DataURL;
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks as NodeFallbackModules;
use bun_resolver::package_json::MacroMap as MacroRemap;
use bun_resolver::{self as resolver, DebugLogs, Resolver};
use bun_router::Router;
use bun_schema::api;
use bun_str::{strings, MutableString};
use bun_sys::Fd as FD;

use crate::analyze_transpiled_module;
use crate::entry_points as EntryPoints;
use crate::linker::Linker;
pub use crate::options;

// TODO(port): move to *_jsc — `MacroJSCtx`/`default_macro_js_value` are jsc-crate types
// used as a field type/value in `ParseOptions`. Base crate should not depend on bundler_jsc;
// Phase B should invert this (extension trait or generic ctx param). Not re-exported.
use bun_bundler_jsc::plugin_runner::{default_macro_js_value, MacroJSCtx};

pub use crate::entry_points;

pub struct ParseResult<'a> {
    pub source: logger::Source,
    pub loader: options::Loader,
    pub ast: js_ast::Ast,
    pub already_bundled: AlreadyBundled,
    pub input_fd: Option<FD>,
    pub empty: bool,
    pub pending_imports: resolver::PendingResolution::List,

    pub runtime_transpiler_cache: Option<&'a mut bun_jsc::RuntimeTranspilerCache>,
}

pub enum AlreadyBundled {
    None,
    SourceCode,
    SourceCodeCjs,
    Bytecode(Box<[u8]>),
    BytecodeCjs(Box<[u8]>),
}

impl Default for AlreadyBundled {
    fn default() -> Self {
        AlreadyBundled::None
    }
}

impl AlreadyBundled {
    pub fn bytecode_slice(&self) -> &[u8] {
        match self {
            AlreadyBundled::Bytecode(slice) | AlreadyBundled::BytecodeCjs(slice) => slice,
            _ => &[],
        }
    }

    pub fn is_bytecode(&self) -> bool {
        matches!(self, AlreadyBundled::Bytecode(_) | AlreadyBundled::BytecodeCjs(_))
    }

    pub fn is_common_js(&self) -> bool {
        matches!(self, AlreadyBundled::SourceCodeCjs | AlreadyBundled::BytecodeCjs(_))
    }
}

impl<'a> ParseResult<'a> {
    pub fn is_pending_import(&self, id: u32) -> bool {
        let import_record_ids = self.pending_imports.items().import_record_id;
        import_record_ids.iter().position(|&x| x == id).is_some()
    }

    /// **DO NOT CALL THIS UNDER NORMAL CIRCUMSTANCES**
    /// Normally, we allocate each AST in an arena and free all at once
    /// So this function only should be used when we globally allocate an AST
    // PORT NOTE: intentionally NOT `impl Drop` — the Zig docstring forbids calling
    // this in the normal arena-backed path. Making it Drop would free on every
    // scope exit and double-free arena-owned data.
    pub fn deinit_globally_allocated(mut self) {
        resolver::PendingResolution::deinit_list_items(&mut self.pending_imports);
        // self.pending_imports drops here (Vec-backed MultiArrayList)
        // self.ast drops here
        // self.source.contents: Box<[u8]> drops here
        // TODO(port): verify field ownership matches the above; Zig freed source.contents explicitly.
    }
}

/// This structure was the JavaScript transpiler before bundle_v2 was written. It now
/// acts mostly as a configuration object, but it also contains stateful logic around
/// logging errors (.log) and module resolution (.resolve_queue)
///
/// This object is not exclusive to bundle_v2/Bun.build, one of these is stored
/// on every VM so that the options can be used for transpilation.
pub struct Transpiler<'a> {
    pub options: options::BundleOptions,
    pub log: &'a mut logger::Log,
    // TODO(port): allocator — bundler is an AST crate per PORTING.md so we thread an
    // arena, but callers usually pass `bun.default_allocator`. Phase B: confirm whether
    // this should be removed (global mimalloc) or kept as `&'a Arena`.
    pub allocator: &'a Arena,
    pub result: options::TransformResult,
    pub resolver: Resolver,
    pub fs: &'static mut Fs::FileSystem,
    pub output_files: Vec<options::OutputFile>,
    pub resolve_results: Box<ResolveResults>,
    pub resolve_queue: ResolveQueue,
    pub elapsed: u64,
    pub needs_runtime: bool,
    pub router: Option<Router>,
    pub source_map: options::SourceMapOption,

    pub linker: Linker,
    pub timer: SystemTimer,
    pub env: &'static mut dot_env::Loader,

    pub macro_context: Option<js_ast::Macro::MacroContext>,
}

impl<'a> Transpiler<'a> {
    pub const IS_CACHE_ENABLED: bool = false;

    #[inline]
    pub fn get_package_manager(&mut self) -> &mut PackageManager {
        self.resolver.get_package_manager()
    }

    pub fn set_log(&mut self, log: &'a mut logger::Log) {
        // PORT NOTE: reshaped for borrowck — Zig assigned the same *Log to three places.
        // TODO(port): linker.log / resolver.log aliasing — raw ptr or restructure in Phase B.
        self.log = log;
        self.linker.log = log as *mut _;
        self.resolver.log = log as *mut _;
    }

    // TODO: remove this method. it does not make sense
    pub fn set_allocator(&mut self, allocator: &'a Arena) {
        self.allocator = allocator;
        // TODO(port): linker.allocator / resolver.allocator threading
        self.linker.allocator = allocator;
        self.resolver.allocator = allocator;
    }

    fn _resolve_entry_point(&mut self, entry_point: &[u8]) -> Result<resolver::Result, Error> {
        // TODO(port): narrow error set
        match self
            .resolver
            .resolve_with_framework(self.fs.top_level_dir, entry_point, resolver::Kind::EntryPointBuild)
        {
            Ok(r) => Ok(r),
            Err(err) => {
                // Relative entry points that were not resolved to a node_modules package are
                // interpreted as relative to the current working directory.
                if !bun_paths::is_absolute(entry_point)
                    && !(entry_point.starts_with(b"./") || entry_point.starts_with(b".\\"))
                {
                    'brk: {
                        let prefixed = strings::append(self.allocator, b"./", entry_point)?;
                        match self.resolver.resolve(
                            self.fs.top_level_dir,
                            prefixed,
                            resolver::Kind::EntryPointBuild,
                        ) {
                            Ok(r) => return Ok(r),
                            Err(_) => {
                                // return the original error
                                break 'brk;
                            }
                        }
                    }
                }
                Err(err)
            }
        }
    }

    pub fn resolve_entry_point(&mut self, entry_point: &[u8]) -> Result<resolver::Result, Error> {
        // TODO(port): narrow error set
        match self._resolve_entry_point(entry_point) {
            Ok(r) => Ok(r),
            Err(err) => {
                let mut cache_bust_buf = PathBuffer::uninit();

                // Bust directory cache and try again
                let buster_name: &[u8] = 'name: {
                    if bun_paths::is_absolute(entry_point) {
                        if let Some(dir) = bun_paths::dirname(entry_point) {
                            // Normalized with trailing slash
                            break 'name strings::normalize_slashes_only(
                                &mut cache_bust_buf,
                                dir,
                                bun_paths::SEP,
                            );
                        }
                    }

                    let parts: [&[u8]; 2] = [entry_point, bun_paths::path_literal(b"..")];

                    break 'name bun_paths::join_abs_string_buf_z(
                        self.fs.top_level_dir,
                        &mut cache_bust_buf,
                        &parts,
                        bun_paths::Platform::Auto,
                    );
                };

                // Only re-query if we previously had something cached.
                if self
                    .resolver
                    .bust_dir_cache(strings::without_trailing_slash_windows_path(buster_name))
                {
                    match self._resolve_entry_point(entry_point) {
                        Ok(result) => return Ok(result),
                        Err(_) => {
                            // ignore this error, we will print the original error
                        }
                    }
                }

                self.log.add_error_fmt(
                    None,
                    logger::Loc::EMPTY,
                    format_args!(
                        "{} resolving \"{}\" (entry point)",
                        err.name(),
                        bstr::BStr::new(entry_point)
                    ),
                );
                Err(err)
            }
        }
    }

    pub fn init(
        allocator: &'a Arena,
        log: &'a mut logger::Log,
        opts: api::TransformOptions,
        env_loader_: Option<&'static mut dot_env::Loader>,
    ) -> Result<Transpiler<'a>, Error> {
        // TODO(port): narrow error set
        js_ast::Expr::Data::Store::create();
        js_ast::Stmt::Data::Store::create();

        let fs = Fs::FileSystem::init(opts.absolute_working_dir.as_deref())?;
        let bundle_options = options::BundleOptions::from_api(allocator, fs, log, opts)?;

        let env_loader: &'static mut dot_env::Loader = match env_loader_ {
            Some(l) => l,
            None => match dot_env::instance() {
                Some(l) => l,
                None => {
                    // TODO(port): Box::leak for &'static — Zig used allocator.create; classified STATIC.
                    let map = Box::leak(Box::new(dot_env::Map::init()));
                    let loader = Box::leak(Box::new(dot_env::Loader::init(map)));
                    loader
                }
            },
        };

        if dot_env::instance().is_none() {
            dot_env::set_instance(env_loader);
        }

        // hide elapsed time when loglevel is warn or error
        env_loader.quiet = !log.level.at_least(logger::Level::Info);

        // var pool = try allocator.create(ThreadPool);
        // try pool.init(ThreadPool.InitConfig{
        //     .allocator = allocator,
        // });
        let resolve_results = Box::new(ResolveResults::default());
        Ok(Transpiler {
            options: bundle_options,
            fs,
            allocator,
            timer: SystemTimer::start().expect("Timer fail"),
            resolver: Resolver::init1(allocator, log, fs, bundle_options),
            log,
            // .thread_pool = pool,
            linker: Linker::default(), // TODO(port): Zig used `undefined`; configureLinker assigns later
            result: options::TransformResult {
                outbase: bundle_options.output_dir,
                ..Default::default()
            },
            resolve_results,
            resolve_queue: ResolveQueue::default(),
            output_files: Vec::new(),
            env: env_loader,
            elapsed: 0,
            needs_runtime: false,
            router: None,
            source_map: options::SourceMapOption::None,
            macro_context: None,
        })
    }

    pub fn configure_linker_with_auto_jsx(&mut self, auto_jsx: bool) {
        self.linker = Linker::init(
            self.allocator,
            self.log,
            &mut self.resolve_queue,
            &mut self.options,
            &mut self.resolver,
            &mut *self.resolve_results,
            self.fs,
        );

        if auto_jsx {
            // Most of the time, this will already be cached
            if let Ok(Some(root_dir)) = self.resolver.read_dir_info(self.fs.top_level_dir) {
                if let Some(tsconfig) = root_dir.tsconfig_json {
                    // If we don't explicitly pass JSX, try to get it from the root tsconfig
                    if self.options.transform_options.jsx.is_none() {
                        self.options.jsx = tsconfig.jsx;
                    }
                    self.options.emit_decorator_metadata = tsconfig.emit_decorator_metadata;
                    self.options.experimental_decorators = tsconfig.experimental_decorators;
                }
            }
        }
    }

    pub fn configure_linker(&mut self) {
        self.configure_linker_with_auto_jsx(true);
    }

    pub fn run_env_loader(&mut self, skip_default_env: bool) -> Result<(), Error> {
        // TODO(port): narrow error set
        match self.options.env.behavior {
            options::EnvBehavior::Prefix
            | options::EnvBehavior::LoadAll
            | options::EnvBehavior::LoadAllWithoutInlining => {
                // Process always has highest priority. Load process env vars
                // unconditionally before attempting directory traversal, so
                // that inherited environment variables are always available
                // even when a parent directory is not readable.
                let was_production = self.options.production;
                self.env.load_process()?;
                let has_production_env = self.env.is_production();
                if !was_production && has_production_env {
                    self.options.set_production(true);
                    self.resolver.opts.set_production(true);
                }

                // Load the project root for .env file discovery. If the cwd
                // (or a parent) is unreadable, readDirInfo may return null;
                // bail out of .env file loading in that case, but process
                // env vars were already loaded above.
                let dir_info = match self.resolver.read_dir_info(self.fs.top_level_dir) {
                    Ok(Some(d)) => d,
                    _ => return Ok(()),
                };

                if let Some(tsconfig) = dir_info.tsconfig_json {
                    self.options.jsx = tsconfig.merge_jsx(self.options.jsx);
                }

                let Some(dir) = dir_info.get_entries(self.resolver.generation) else {
                    return Ok(());
                };

                if self.options.is_test() || self.env.is_test() {
                    self.env
                        .load(dir, &self.options.env.files, dot_env::Kind::Test, skip_default_env)?;
                } else if self.options.production {
                    self.env.load(
                        dir,
                        &self.options.env.files,
                        dot_env::Kind::Production,
                        skip_default_env,
                    )?;
                } else {
                    self.env.load(
                        dir,
                        &self.options.env.files,
                        dot_env::Kind::Development,
                        skip_default_env,
                    )?;
                }
            }
            options::EnvBehavior::Disable => {
                self.env.load_process()?;
                if self.env.is_production() {
                    self.options.set_production(true);
                    self.resolver.opts.set_production(true);
                }
            }
            _ => {}
        }

        if self.env.get(b"BUN_DISABLE_TRANSPILER").unwrap_or(b"0") == b"1" {
            self.options.disable_transpilation = true;
        }
        Ok(())
    }

    // This must be run after a framework is configured, if a framework is enabled
    pub fn configure_defines(&mut self) -> Result<(), Error> {
        // TODO(port): narrow error set
        if self.options.defines_loaded {
            return Ok(());
        }

        if self.options.target == options::Target::BunMacro {
            self.options.env.behavior = options::EnvBehavior::Prefix;
            self.options.env.prefix = b"BUN_".as_slice().into();
        }

        self.run_env_loader(self.options.env.disable_default_env_files)?;

        let mut is_production = self.env.is_production();

        js_ast::Expr::Data::Store::create();
        js_ast::Stmt::Data::Store::create();

        // PORT NOTE: `defer Store.reset()` → scopeguard; resets run at scope exit regardless of path.
        let _reset = scopeguard::guard((), |_| {
            js_ast::Expr::Data::Store::reset();
            js_ast::Stmt::Data::Store::reset();
        });

        self.options
            .load_defines(self.allocator, self.env, &self.options.env)?;

        let mut is_development = false;
        if let Some(node_env) = self.options.define.dots.get(b"NODE_ENV".as_slice()) {
            if !node_env.is_empty() {
                if let js_ast::ExprData::EString(s) = &node_env[0].data.value {
                    if s.eql_comptime(b"production") {
                        is_production = true;
                    } else if s.eql_comptime(b"development") {
                        is_development = true;
                    }
                }
            }
        }

        if is_development {
            self.options.set_production(false);
            self.resolver.opts.set_production(false);
            self.options.force_node_env = options::ForceNodeEnv::Development;
            self.resolver.opts.force_node_env = options::ForceNodeEnv::Development;
        } else if is_production {
            self.options.set_production(true);
            self.resolver.opts.set_production(true);
        }
        Ok(())
    }

    pub fn reset_store(&self) {
        js_ast::Expr::Data::Store::reset();
        js_ast::Stmt::Data::Store::reset();
    }

    #[cold]
    #[inline(never)]
    pub fn dump_environment_variables(&self) {
        // TODO(port): std.json.Stringify — pick a JSON writer (serde_json or hand-rolled).
        Output::flush();
        let mut w = Output::writer();
        let _ = bun_json::stringify_pretty(&mut w, &*self.env.map, 2);
        Output::flush();
    }
}

pub struct BuildResolveResultPair {
    pub written: usize,
    pub input_fd: Option<FD>,
    pub empty: bool,
}

impl Default for BuildResolveResultPair {
    fn default() -> Self {
        Self { written: 0, input_fd: None, empty: false }
    }
}

impl<'a> Transpiler<'a> {
    fn build_with_resolve_result_eager<
        const IMPORT_PATH_FORMAT: options::BundleOptions::ImportPathFormat,
        Outstream,
    >(
        &mut self,
        resolve_result: resolver::Result,
        outstream: Outstream,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Result<Option<options::OutputFile>, Error> {
        // TODO(port): narrow error set
        let _ = outstream;

        if resolve_result.flags.is_external {
            return Ok(None);
        }

        let Some(p) = resolve_result.path_const() else {
            return Ok(None);
        };
        let mut file_path = p.clone();

        // Step 1. Parse & scan
        let loader = self.options.loader(file_path.name.ext);

        if let Some(client_entry_point) = client_entry_point_.as_ref() {
            file_path = client_entry_point.source.path.clone();
        }

        file_path.pretty = Linker::relative_paths_list()
            .append(self.fs.relative_to(file_path.text))
            .expect("unreachable");

        let mut output_file = options::OutputFile {
            src_path: file_path.clone(),
            loader,
            value: options::OutputFileValue::default(), // TODO(port): Zig used `undefined`
            side: None,
            entry_point_index: None,
            output_kind: options::OutputKind::Chunk,
            ..Default::default()
        };

        match loader {
            options::Loader::Jsx
            | options::Loader::Tsx
            | options::Loader::Js
            | options::Loader::Ts
            | options::Loader::Json
            | options::Loader::Jsonc
            | options::Loader::Toml
            | options::Loader::Yaml
            | options::Loader::Json5
            | options::Loader::Text
            | options::Loader::Md => {
                let Some(mut result) = self.parse(
                    ParseOptions {
                        allocator: self.allocator,
                        path: file_path.clone(),
                        loader,
                        dirname_fd: resolve_result.dirname_fd,
                        file_descriptor: None,
                        file_hash: None,
                        macro_remappings: self.options.macro_remap.clone(),
                        jsx: resolve_result.jsx,
                        emit_decorator_metadata: resolve_result.flags.emit_decorator_metadata,
                        experimental_decorators: resolve_result.flags.experimental_decorators,
                        file_fd_ptr: None,
                        macro_js_ctx: default_macro_js_value,
                        virtual_source: None,
                        replace_exports: Default::default(),
                        inject_jest_globals: false,
                        set_breakpoint_on_first_line: false,
                        remove_cjs_module_wrapper: false,
                        dont_bundle_twice: false,
                        allow_commonjs: false,
                        module_type: options::ModuleType::Unknown,
                        runtime_transpiler_cache: None,
                        keep_json_and_toml_as_one_statement: false,
                        allow_bytecode_cache: false,
                    },
                    client_entry_point_,
                ) else {
                    return Ok(None);
                };
                if !self.options.transform_only {
                    if !self.options.target.is_bun() {
                        self.linker.link(
                            &file_path,
                            &mut result,
                            &self.options.origin,
                            IMPORT_PATH_FORMAT,
                            false,
                            false,
                        )?;
                    } else {
                        self.linker.link(
                            &file_path,
                            &mut result,
                            &self.options.origin,
                            IMPORT_PATH_FORMAT,
                            false,
                            true,
                        )?;
                    }
                }

                let buffer_writer = js_printer::BufferWriter::init(self.allocator);
                let mut writer = js_printer::BufferPrinter::init(buffer_writer);

                output_file.size = match self.options.target {
                    options::Target::Browser | options::Target::Node => self
                        .print::<_, { js_printer::Format::Esm }>(result, &mut writer)?,
                    options::Target::Bun
                    | options::Target::BunMacro
                    | options::Target::BakeServerComponentsSsr => self
                        .print::<_, { js_printer::Format::EsmAscii }>(result, &mut writer)?,
                };
                output_file.value = options::OutputFileValue::Buffer {
                    // TODO(port): allocator field on buffer value — likely drops in Rust
                    bytes: writer.ctx.written,
                };
            }
            options::Loader::Dataurl | options::Loader::Base64 => {
                Output::panic("TODO: dataurl, base64", format_args!("")); // TODO
            }
            options::Loader::Css => {
                let alloc = self.allocator;

                let entry = match self.resolver.caches.fs.read_file_with_allocator(
                    self.allocator,
                    self.fs,
                    file_path.text,
                    resolve_result.dirname_fd,
                    false,
                    None,
                ) {
                    Ok(e) => e,
                    Err(err) => {
                        let _ = self.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} reading \"{}\"",
                                err.name(),
                                bstr::BStr::new(file_path.pretty)
                            ),
                        );
                        return Ok(None);
                    }
                };
                let mut opts = bun_css::ParserOptions::default(alloc, self.log);
                const CSS_MODULE_SUFFIX: &[u8] = b".module.css";
                let enable_css_modules = file_path.text.len() > CSS_MODULE_SUFFIX.len()
                    && &file_path.text[file_path.text.len() - CSS_MODULE_SUFFIX.len()..]
                        == CSS_MODULE_SUFFIX;
                if enable_css_modules {
                    opts.filename = bun_paths::basename(file_path.text);
                    opts.css_modules = Some(bun_css::CssModuleConfig::default());
                }
                let (mut sheet, mut extra) =
                    match bun_css::StyleSheet::<bun_css::DefaultAtRule>::parse(
                        alloc,
                        entry.contents,
                        opts,
                        None,
                        // TODO: DO WE EVEN HAVE SOURCE INDEX IN THIS TRANSPILER.ZIG file??
                        crate::bundle_v2::Index::INVALID,
                    ) {
                        bun_css::Result::Result(v) => v,
                        bun_css::Result::Err(e) => {
                            self.log
                                .add_error_fmt(None, logger::Loc::EMPTY, format_args!("{e} parsing"))
                                .expect("unreachable");
                            return Ok(None);
                        }
                    };
                if let Some(e) = sheet
                    .minify(alloc, bun_css::MinifyOptions::default(), &mut extra)
                    .as_err()
                {
                    self.log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!("{} while minifying", e.kind),
                    );
                    return Ok(None);
                }
                let symbols = js_ast::Symbol::Map::default();
                let result = match sheet.to_css(
                    alloc,
                    bun_css::PrinterOptions {
                        targets: bun_css::Targets::for_bundler_target(self.options.target),
                        minify: self.options.minify_whitespace,
                        ..Default::default()
                    },
                    None,
                    None,
                    &symbols,
                ) {
                    bun_css::Result::Result(v) => v,
                    bun_css::Result::Err(e) => {
                        self.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!("{e} while printing"),
                        );
                        return Ok(None);
                    }
                };
                output_file.value = options::OutputFileValue::Buffer { bytes: result.code };
            }

            options::Loader::Html
            | options::Loader::Bunsh
            | options::Loader::SqliteEmbedded
            | options::Loader::Sqlite
            | options::Loader::Wasm
            | options::Loader::File
            | options::Loader::Napi => {
                let hashed_name = self.linker.get_hashed_filename(&file_path, None)?;
                let mut pathname =
                    vec![0u8; hashed_name.len() + file_path.name.ext.len()].into_boxed_slice();
                pathname[..hashed_name.len()].copy_from_slice(hashed_name);
                pathname[hashed_name.len()..].copy_from_slice(file_path.name.ext);

                output_file.value = options::OutputFileValue::Copy(options::OutputFile::FileOperation {
                    pathname,
                    dir: match self.options.output_dir_handle {
                        Some(output_handle) => FD::from_std_dir(output_handle),
                        None => FD::INVALID,
                    },
                    is_outdir: true,
                    ..Default::default()
                });
            }
        }

        Ok(Some(output_file))
    }

    fn print_with_source_map_maybe<W, const FORMAT: js_printer::Format, const ENABLE_SOURCE_MAP: bool>(
        &mut self,
        ast: js_ast::Ast,
        source: &logger::Source,
        writer: W,
        source_map_context: Option<js_printer::SourceMapHandler>,
        runtime_transpiler_cache: Option<&mut bun_jsc::RuntimeTranspilerCache>,
        module_info: Option<&mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, Error> {
        // TODO(port): narrow error set
        let _tracer = if ENABLE_SOURCE_MAP {
            bun_perf::trace("JSPrinter.printWithSourceMap")
        } else {
            bun_perf::trace("JSPrinter.print")
        };
        // PORT NOTE: `defer tracer.end()` → guard Drop ends the trace.

        let symbols =
            js_ast::Symbol::NestedList::from_borrowed_slice_dangerous(core::slice::from_ref(&ast.symbols));

        match FORMAT {
            js_printer::Format::Cjs => js_printer::print_common_js::<W, ENABLE_SOURCE_MAP>(
                writer,
                ast,
                js_ast::Symbol::Map::init_list(symbols),
                source,
                false,
                js_printer::Options {
                    bundling: false,
                    runtime_imports: ast.runtime_imports,
                    require_ref: ast.require_ref,
                    css_import_behavior: self.options.css_import_behavior(),
                    source_map_handler: source_map_context,
                    minify_whitespace: self.options.minify_whitespace,
                    minify_syntax: self.options.minify_syntax,
                    minify_identifiers: self.options.minify_identifiers,
                    transform_only: self.options.transform_only,
                    runtime_transpiler_cache,
                    print_dce_annotations: self.options.emit_dce_annotations,
                    hmr_ref: ast.wrapper_ref,
                    mangled_props: None,
                    ..Default::default()
                },
            ),

            js_printer::Format::Esm => js_printer::print_ast::<W, ENABLE_SOURCE_MAP>(
                writer,
                ast,
                js_ast::Symbol::Map::init_list(symbols),
                source,
                false,
                js_printer::Options {
                    bundling: false,
                    runtime_imports: ast.runtime_imports,
                    require_ref: ast.require_ref,
                    source_map_handler: source_map_context,
                    css_import_behavior: self.options.css_import_behavior(),
                    minify_whitespace: self.options.minify_whitespace,
                    minify_syntax: self.options.minify_syntax,
                    minify_identifiers: self.options.minify_identifiers,
                    transform_only: self.options.transform_only,
                    import_meta_ref: ast.import_meta_ref,
                    runtime_transpiler_cache,
                    print_dce_annotations: self.options.emit_dce_annotations,
                    hmr_ref: ast.wrapper_ref,
                    mangled_props: None,
                    ..Default::default()
                },
            ),
            js_printer::Format::EsmAscii => {
                // PORT NOTE: `switch (target.isBun()) { inline else => |is_bun| ... }` — runtime bool → comptime dispatch.
                if self.options.target.is_bun() {
                    self.print_ast_esm_ascii::<W, ENABLE_SOURCE_MAP, true>(
                        writer,
                        ast,
                        symbols,
                        source,
                        source_map_context,
                        runtime_transpiler_cache,
                        module_info,
                    )
                } else {
                    self.print_ast_esm_ascii::<W, ENABLE_SOURCE_MAP, false>(
                        writer,
                        ast,
                        symbols,
                        source,
                        source_map_context,
                        runtime_transpiler_cache,
                        module_info,
                    )
                }
            }
            _ => unreachable!(),
        }
    }

    // PORT NOTE: hoisted from `inline else => |is_bun|` arm of print_with_source_map_maybe
    // to express the comptime bool dispatch as a const generic.
    fn print_ast_esm_ascii<W, const ENABLE_SOURCE_MAP: bool, const IS_BUN: bool>(
        &mut self,
        writer: W,
        ast: js_ast::Ast,
        symbols: js_ast::Symbol::NestedList,
        source: &logger::Source,
        source_map_context: Option<js_printer::SourceMapHandler>,
        runtime_transpiler_cache: Option<&mut bun_jsc::RuntimeTranspilerCache>,
        module_info: Option<&mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, Error> {
        js_printer::print_ast::<W, ENABLE_SOURCE_MAP>(
            writer,
            ast,
            js_ast::Symbol::Map::init_list(symbols),
            source,
            IS_BUN,
            js_printer::Options {
                bundling: false,
                runtime_imports: ast.runtime_imports,
                require_ref: ast.require_ref,
                css_import_behavior: self.options.css_import_behavior(),
                source_map_handler: source_map_context,
                minify_whitespace: self.options.minify_whitespace,
                minify_syntax: self.options.minify_syntax,
                minify_identifiers: self.options.minify_identifiers,
                transform_only: self.options.transform_only,
                module_type: if IS_BUN && self.options.transform_only {
                    // this is for when using `bun build --no-bundle`
                    // it should copy what was passed for the cli
                    self.options.output_format
                } else if ast.exports_kind == js_ast::ExportsKind::Cjs {
                    options::OutputFormat::Cjs
                } else {
                    options::OutputFormat::Esm
                },
                inline_require_and_import_errors: false,
                import_meta_ref: ast.import_meta_ref,
                runtime_transpiler_cache,
                module_info,
                target: self.options.target,
                print_dce_annotations: self.options.emit_dce_annotations,
                hmr_ref: ast.wrapper_ref,
                mangled_props: None,
                ..Default::default()
            },
        )
    }

    pub fn print<W, const FORMAT: js_printer::Format>(
        &mut self,
        result: ParseResult,
        writer: W,
    ) -> Result<usize, Error> {
        self.print_with_source_map_maybe::<W, FORMAT, false>(
            result.ast,
            &result.source,
            writer,
            None,
            None,
            None,
        )
    }

    pub fn print_with_source_map<W, const FORMAT: js_printer::Format>(
        &mut self,
        result: ParseResult,
        writer: W,
        handler: js_printer::SourceMapHandler,
        module_info: Option<&mut analyze_transpiled_module::ModuleInfo>,
    ) -> Result<usize, Error> {
        if bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS.get() {
            return self.print_with_source_map_maybe::<W, FORMAT, false>(
                result.ast,
                &result.source,
                writer,
                Some(handler),
                result.runtime_transpiler_cache,
                module_info,
            );
        }
        self.print_with_source_map_maybe::<W, FORMAT, true>(
            result.ast,
            &result.source,
            writer,
            Some(handler),
            result.runtime_transpiler_cache,
            module_info,
        )
    }
}

pub struct ParseOptions<'a> {
    pub allocator: &'a Arena,
    pub dirname_fd: FD,
    pub file_descriptor: Option<FD>,
    pub file_hash: Option<u32>,

    /// On exception, we might still want to watch the file.
    pub file_fd_ptr: Option<&'a mut FD>,

    pub path: Fs::Path,
    pub loader: options::Loader,
    pub jsx: options::JSX::Pragma,
    pub macro_remappings: MacroRemap,
    pub macro_js_ctx: MacroJSCtx,
    pub virtual_source: Option<&'a logger::Source>,
    pub replace_exports: runtime::Runtime::Features::ReplaceableExport::Map,
    pub inject_jest_globals: bool,
    pub set_breakpoint_on_first_line: bool,
    pub emit_decorator_metadata: bool,
    pub experimental_decorators: bool,
    pub remove_cjs_module_wrapper: bool,

    pub dont_bundle_twice: bool,
    pub allow_commonjs: bool,
    /// `"type"` from `package.json`. Used to make sure the parser defaults
    /// to CommonJS or ESM based on what the package.json says, when it
    /// doesn't otherwise know from reading the source code.
    ///
    /// See: https://nodejs.org/api/packages.html#type
    pub module_type: options::ModuleType,

    pub runtime_transpiler_cache: Option<&'a mut bun_jsc::RuntimeTranspilerCache>,

    pub keep_json_and_toml_as_one_statement: bool,
    pub allow_bytecode_cache: bool,
}

impl<'a> Transpiler<'a> {
    pub fn parse(
        &mut self,
        this_parse: ParseOptions<'a>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult<'a>> {
        self.parse_maybe_return_file_only::<false>(this_parse, client_entry_point_)
    }

    pub fn parse_maybe_return_file_only<const RETURN_FILE_ONLY: bool>(
        &mut self,
        this_parse: ParseOptions<'a>,
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult<'a>> {
        self.parse_maybe_return_file_only_allow_shared_buffer::<RETURN_FILE_ONLY, false>(
            this_parse,
            client_entry_point_,
        )
    }

    pub fn parse_maybe_return_file_only_allow_shared_buffer<
        const RETURN_FILE_ONLY: bool,
        const USE_SHARED_BUFFER: bool,
    >(
        &mut self,
        this_parse: ParseOptions<'a>,
        // TODO(port): Zig `anytype` + `@hasField(.., "source")` — only ever called with
        // `?*EntryPoints.ClientEntryPoint` in this file. If other callers pass a different
        // type, introduce a `ClientEntryPointLike` trait with `fn source() -> Option<&Source>`.
        client_entry_point_: Option<&mut EntryPoints::ClientEntryPoint>,
    ) -> Option<ParseResult<'a>> {
        let allocator = this_parse.allocator;
        let dirname_fd = this_parse.dirname_fd;
        let file_descriptor = this_parse.file_descriptor;
        let file_hash = this_parse.file_hash;
        let path = this_parse.path;
        let loader = this_parse.loader;

        let mut input_fd: Option<FD> = None;

        // PORT NOTE: Zig `&brk: { ... }` took the address of a temporary; Rust owns the
        // value and borrows it after the block.
        let source_owned: logger::Source = 'brk: {
            if let Some(virtual_source) = this_parse.virtual_source {
                break 'brk virtual_source.clone();
            }

            if let Some(client_entry_point) = client_entry_point_ {
                // Zig: if (@hasField(Child, "source")) — ClientEntryPoint always has it.
                break 'brk client_entry_point.source.clone();
            }

            if path.namespace == b"node" {
                if let Some(code) = NodeFallbackModules::contents_from_path(path.text) {
                    break 'brk logger::Source::init_path_string(path.text, code);
                }

                break 'brk logger::Source::init_path_string(path.text, b"");
            }

            if path.text.starts_with(b"data:") {
                let data_url = match DataURL::parse_without_check(path.text) {
                    Ok(u) => u,
                    Err(err) => {
                        let _ = self.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} parsing data url \"{}\"",
                                err.name(),
                                bstr::BStr::new(path.text)
                            ),
                        );
                        return None;
                    }
                };
                let body = match data_url.decode_data(this_parse.allocator) {
                    Ok(b) => b,
                    Err(err) => {
                        let _ = self.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} decoding data \"{}\"",
                                err.name(),
                                bstr::BStr::new(path.text)
                            ),
                        );
                        return None;
                    }
                };
                break 'brk logger::Source::init_path_string(path.text, body);
            }

            let entry = match self.resolver.caches.fs.read_file_with_allocator(
                // PERF(port): USE_SHARED_BUFFER selected default_allocator vs this_parse.allocator
                this_parse.allocator,
                self.fs,
                path.text,
                dirname_fd,
                USE_SHARED_BUFFER,
                file_descriptor,
            ) {
                Ok(e) => e,
                Err(err) => {
                    let _ = self.log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "{} reading \"{}\"",
                            err.name(),
                            bstr::BStr::new(path.text)
                        ),
                    );
                    return None;
                }
            };
            input_fd = Some(entry.fd);
            if let Some(file_fd_ptr) = this_parse.file_fd_ptr {
                *file_fd_ptr = entry.fd;
            }
            match logger::Source::init_recycled_file(
                logger::RecycledFile { path: path.clone(), contents: entry.contents },
                self.allocator,
            ) {
                Ok(s) => break 'brk s,
                Err(_) => return None,
            }
        };
        let source: &logger::Source = &source_owned;

        if RETURN_FILE_ONLY {
            return Some(ParseResult {
                source: source.clone(),
                input_fd,
                loader,
                empty: true,
                ast: js_ast::Ast::empty(),
                already_bundled: AlreadyBundled::None,
                pending_imports: Default::default(),
                runtime_transpiler_cache: None,
            });
        }

        if source.contents.is_empty()
            || (source.contents.len() < 33
                && strings::trim(source.contents, b"\n\r ").is_empty())
        {
            if !loader.handles_empty_file() {
                return Some(ParseResult {
                    source: source.clone(),
                    input_fd,
                    loader,
                    empty: true,
                    ast: js_ast::Ast::empty(),
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                });
            }
        }

        match loader {
            options::Loader::Js
            | options::Loader::Jsx
            | options::Loader::Ts
            | options::Loader::Tsx => {
                // wasm magic number
                if source.is_web_assembly() {
                    return Some(ParseResult {
                        source: source.clone(),
                        input_fd,
                        loader: options::Loader::Wasm,
                        empty: true,
                        ast: js_ast::Ast::empty(),
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        runtime_transpiler_cache: None,
                    });
                }

                let target = self.options.target;

                let mut jsx = this_parse.jsx;
                jsx.parse = loader.is_jsx();

                let mut opts = js_parser::Parser::Options::init(jsx, loader);

                opts.features.emit_decorator_metadata = this_parse.emit_decorator_metadata;
                // emitDecoratorMetadata implies legacy/experimental decorators, as it only
                // makes sense with TypeScript's legacy decorator system (reflect-metadata).
                // TC39 standard decorators have their own metadata mechanism.
                opts.features.standard_decorators = !loader.is_type_script()
                    || !(this_parse.experimental_decorators || this_parse.emit_decorator_metadata);
                opts.features.allow_runtime = self.options.allow_runtime;
                opts.features.set_breakpoint_on_first_line =
                    this_parse.set_breakpoint_on_first_line;
                opts.features.trim_unused_imports =
                    self.options.trim_unused_imports.unwrap_or(loader.is_type_script());
                opts.features.no_macros = self.options.no_macros;
                opts.features.runtime_transpiler_cache = this_parse.runtime_transpiler_cache;
                opts.transform_only = self.options.transform_only;

                opts.ignore_dce_annotations = self.options.ignore_dce_annotations;

                // @bun annotation
                opts.features.dont_bundle_twice = this_parse.dont_bundle_twice;

                opts.features.commonjs_at_runtime = this_parse.allow_commonjs;
                opts.module_type = this_parse.module_type;

                opts.tree_shaking = self.options.tree_shaking;
                opts.features.inlining = self.options.inlining;

                opts.filepath_hash_for_hmr = file_hash.unwrap_or(0);
                opts.features.auto_import_jsx = self.options.auto_import_jsx;
                opts.warn_about_unbundled_modules = !target.is_bun();
                // JavaScriptCore implements `using` / `await using` natively, so
                // when targeting Bun there is no need to lower them.
                opts.features.lower_using = !target.is_bun();

                opts.features.inject_jest_globals = this_parse.inject_jest_globals;
                opts.features.minify_syntax = self.options.minify_syntax;
                opts.features.minify_identifiers = self.options.minify_identifiers;
                opts.features.dead_code_elimination = self.options.dead_code_elimination;
                opts.features.remove_cjs_module_wrapper = this_parse.remove_cjs_module_wrapper;
                opts.features.bundler_feature_flags = self.options.bundler_feature_flags;
                opts.features.repl_mode = self.options.repl_mode;
                opts.repl_mode = self.options.repl_mode;

                if self.macro_context.is_none() {
                    self.macro_context = Some(js_ast::Macro::MacroContext::init(self));
                }

                // we'll just always enable top-level await
                // this is incorrect for Node.js files which are CommonJS modules
                opts.features.top_level_await = true;

                opts.macro_context = self.macro_context.as_mut().unwrap();
                if target != options::Target::BunMacro {
                    opts.macro_context.javascript_object = this_parse.macro_js_ctx;
                }

                opts.features.is_macro_runtime = target == options::Target::BunMacro;
                opts.features.replace_exports = this_parse.replace_exports;

                let parsed = self
                    .resolver
                    .caches
                    .js
                    .parse(allocator, opts, self.options.define, self.log, source)
                    .ok()??;
                return Some(match parsed {
                    js_parser::ParseResult::Ast(value) => ParseResult {
                        ast: value,
                        source: source.clone(),
                        loader,
                        input_fd,
                        runtime_transpiler_cache: this_parse.runtime_transpiler_cache,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        empty: false,
                    },
                    js_parser::ParseResult::Cached => ParseResult {
                        // TODO(port): Zig used `undefined` for ast here.
                        ast: js_ast::Ast::empty(),
                        runtime_transpiler_cache: this_parse.runtime_transpiler_cache,
                        source: source.clone(),
                        loader,
                        input_fd,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        empty: false,
                    },
                    js_parser::ParseResult::AlreadyBundled(already_bundled) => ParseResult {
                        // TODO(port): Zig used `undefined` for ast here.
                        ast: js_ast::Ast::empty(),
                        already_bundled: match already_bundled {
                            js_parser::AlreadyBundled::Bun => AlreadyBundled::SourceCode,
                            js_parser::AlreadyBundled::BunCjs => AlreadyBundled::SourceCodeCjs,
                            js_parser::AlreadyBundled::BytecodeCjs
                            | js_parser::AlreadyBundled::Bytecode => 'brk: {
                                let default_value = if matches!(
                                    already_bundled,
                                    js_parser::AlreadyBundled::BytecodeCjs
                                ) {
                                    AlreadyBundled::SourceCodeCjs
                                } else {
                                    AlreadyBundled::SourceCode
                                };
                                if this_parse.virtual_source.is_none()
                                    && this_parse.allow_bytecode_cache
                                {
                                    let mut path_buf2 = PathBuffer::uninit();
                                    path_buf2[..path.text.len()].copy_from_slice(path.text);
                                    path_buf2[path.text.len()..]
                                        [..bun_core::BYTECODE_EXTENSION.len()]
                                        .copy_from_slice(bun_core::BYTECODE_EXTENSION);
                                    let Some(bytecode) = bun_sys::File::to_source_at(
                                        dirname_fd.unwrap_valid().unwrap_or(FD::cwd()),
                                        &path_buf2
                                            [..path.text.len() + bun_core::BYTECODE_EXTENSION.len()],
                                        Default::default(),
                                    )
                                    .as_value() else {
                                        break 'brk default_value;
                                    };
                                    if bytecode.contents.is_empty() {
                                        break 'brk default_value;
                                    }
                                    break 'brk if matches!(
                                        already_bundled,
                                        js_parser::AlreadyBundled::BytecodeCjs
                                    ) {
                                        AlreadyBundled::BytecodeCjs(bytecode.contents.into())
                                    } else {
                                        AlreadyBundled::Bytecode(bytecode.contents.into())
                                    };
                                }
                                break 'brk default_value;
                            }
                        },
                        source: source.clone(),
                        loader,
                        input_fd,
                        pending_imports: Default::default(),
                        runtime_transpiler_cache: None,
                        empty: false,
                    },
                });
            }
            // TODO: use lazy export AST
            options::Loader::Toml
            | options::Loader::Yaml
            | options::Loader::Json
            | options::Loader::Jsonc
            | options::Loader::Json5 => {
                // PERF(port): was `inline .toml, .yaml, .json, .jsonc, .json5 => |kind|` —
                // comptime monomorphization per loader; profile in Phase B.
                let mut expr = match loader {
                    options::Loader::Jsonc => {
                        // We allow importing tsconfig.*.json or jsconfig.*.json with comments
                        // These files implicitly become JSONC files, which aligns with the behavior of text editors.
                        match JSON::parse_ts_config(source, self.log, allocator, false) {
                            Ok(e) => e,
                            Err(_) => return None,
                        }
                    }
                    options::Loader::Json => match JSON::parse(source, self.log, allocator, false) {
                        Ok(e) => e,
                        Err(_) => return None,
                    },
                    options::Loader::Toml => match TOML::parse(source, self.log, allocator, false) {
                        Ok(e) => e,
                        Err(_) => return None,
                    },
                    options::Loader::Yaml => match YAML::parse(source, self.log, allocator) {
                        Ok(e) => e,
                        Err(_) => return None,
                    },
                    options::Loader::Json5 => match JSON5::parse(source, self.log, allocator) {
                        Ok(e) => e,
                        Err(_) => return None,
                    },
                    _ => unreachable!(),
                };

                let mut symbols: &mut [js_ast::Symbol] = &mut [];

                let parts: &mut [js_ast::Part] = 'brk: {
                    if this_parse.keep_json_and_toml_as_one_statement {
                        let stmts = allocator
                            .alloc_slice_fill_default::<js_ast::Stmt>(1);
                        // PERF(port): was assume_capacity / alloc(..., 1) catch unreachable
                        stmts[0] = js_ast::Stmt::allocate(
                            allocator,
                            js_ast::S::SExpr { value: expr },
                            logger::Loc { start: 0 },
                        );
                        let parts_ = allocator.alloc_slice_fill_default::<js_ast::Part>(1);
                        parts_[0] = js_ast::Part { stmts, ..Default::default() };
                        break 'brk parts_;
                    }

                    if let js_ast::ExprData::EObject(obj) = &mut expr.data {
                        let properties: &mut [js_ast::G::Property] = obj.properties.slice_mut();
                        if !properties.is_empty() {
                            let Ok(stmts) =
                                allocator.try_alloc_slice_fill_default::<js_ast::Stmt>(3)
                            else {
                                return None;
                            };
                            let mut decls: Vec<js_ast::G::Decl> =
                                Vec::with_capacity(properties.len());
                            // SAFETY: capacity reserved; elements written below before read.
                            unsafe { decls.set_len(properties.len()) };
                            // PERF(port): was ArrayListUnmanaged.initCapacity + expandToCapacity

                            let Ok(syms) =
                                allocator.try_alloc_slice_fill_default::<js_ast::Symbol>(properties.len())
                            else {
                                return None;
                            };
                            symbols = syms;
                            let Ok(export_clauses) = allocator
                                .try_alloc_slice_fill_default::<js_ast::ClauseItem>(properties.len())
                            else {
                                return None;
                            };
                            let mut duplicate_key_checker: StringHashMap<u32> =
                                StringHashMap::default();
                            // duplicate_key_checker drops at end of scope (defer .deinit())
                            let mut count: usize = 0;
                            // PORT NOTE: reshaped for borrowck — cannot zip 4 slices with one
                            // mutable borrow into `decls` and also random-access `decls[prev]`.
                            for i in 0..properties.len() {
                                let prop = &mut properties[i];
                                let name = prop
                                    .key
                                    .as_ref()
                                    .unwrap()
                                    .data
                                    .as_e_string()
                                    .unwrap()
                                    .slice(allocator);
                                // Do not make named exports for "default" exports
                                if name == b"default" {
                                    continue;
                                }

                                let visited = match duplicate_key_checker.get_or_put(name) {
                                    Ok(v) => v,
                                    Err(_) => continue,
                                };
                                if visited.found_existing {
                                    decls[*visited.value_ptr as usize].value =
                                        Some(prop.value.clone().unwrap());
                                    continue;
                                }
                                *visited.value_ptr = i as u32;

                                symbols[i] = js_ast::Symbol {
                                    original_name: match MutableString::ensure_valid_identifier(
                                        name, allocator,
                                    ) {
                                        Ok(n) => n,
                                        Err(_) => return None,
                                    },
                                    ..Default::default()
                                };

                                let r#ref = Ref::init(i as u32, 0, false);
                                decls[i] = js_ast::G::Decl {
                                    binding: js_ast::Binding::alloc(
                                        allocator,
                                        js_ast::B::Identifier { r#ref },
                                        prop.key.as_ref().unwrap().loc,
                                    ),
                                    value: Some(prop.value.clone().unwrap()),
                                };
                                export_clauses[i] = js_ast::ClauseItem {
                                    name: js_ast::LocRef {
                                        r#ref,
                                        loc: prop.key.as_ref().unwrap().loc,
                                    },
                                    alias: name,
                                    alias_loc: prop.key.as_ref().unwrap().loc,
                                    ..Default::default()
                                };
                                prop.value = Some(js_ast::Expr::init_identifier(
                                    r#ref,
                                    prop.value.as_ref().unwrap().loc,
                                ));
                                count += 1;
                            }

                            decls.truncate(count);
                            stmts[0] = js_ast::Stmt::alloc(
                                js_ast::S::Local {
                                    decls: js_ast::G::Decl::List::move_from_list(&mut decls),
                                    kind: js_ast::S::LocalKind::KVar,
                                    ..Default::default()
                                },
                                logger::Loc { start: 0 },
                            );
                            stmts[1] = js_ast::Stmt::alloc(
                                js_ast::S::ExportClause {
                                    items: &mut export_clauses[..count],
                                    is_single_line: false,
                                },
                                logger::Loc { start: 0 },
                            );
                            stmts[2] = js_ast::Stmt::alloc(
                                js_ast::S::ExportDefault {
                                    value: js_ast::StmtOrExpr::Expr(expr),
                                    default_name: js_ast::LocRef {
                                        loc: logger::Loc::default(),
                                        r#ref: Ref::NONE,
                                    },
                                },
                                logger::Loc { start: 0 },
                            );

                            let parts_ = allocator.alloc_slice_fill_default::<js_ast::Part>(1);
                            parts_[0] = js_ast::Part { stmts, ..Default::default() };
                            break 'brk parts_;
                        }
                    }

                    {
                        let stmts = allocator.alloc_slice_fill_default::<js_ast::Stmt>(1);
                        stmts[0] = js_ast::Stmt::alloc(
                            js_ast::S::ExportDefault {
                                value: js_ast::StmtOrExpr::Expr(expr),
                                default_name: js_ast::LocRef {
                                    loc: logger::Loc::default(),
                                    r#ref: Ref::NONE,
                                },
                            },
                            logger::Loc { start: 0 },
                        );

                        let parts_ = allocator.alloc_slice_fill_default::<js_ast::Part>(1);
                        parts_[0] = js_ast::Part { stmts, ..Default::default() };
                        break 'brk parts_;
                    }
                };
                let mut ast = js_ast::Ast::from_parts(parts);
                ast.symbols = js_ast::Symbol::List::from_owned_slice(symbols);

                return Some(ParseResult {
                    ast,
                    source: source.clone(),
                    loader,
                    input_fd,
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                    empty: false,
                });
            }
            // TODO: use lazy export AST
            options::Loader::Text => {
                let expr = js_ast::Expr::init(
                    js_ast::E::String { data: source.contents, ..Default::default() },
                    logger::Loc::EMPTY,
                );
                let stmt = js_ast::Stmt::alloc(
                    js_ast::S::ExportDefault {
                        value: js_ast::StmtOrExpr::Expr(expr),
                        default_name: js_ast::LocRef {
                            loc: logger::Loc::default(),
                            r#ref: Ref::NONE,
                        },
                    },
                    logger::Loc { start: 0 },
                );
                let stmts = allocator.alloc_slice_fill_default::<js_ast::Stmt>(1);
                stmts[0] = stmt;
                let parts = allocator.alloc_slice_fill_default::<js_ast::Part>(1);
                parts[0] = js_ast::Part { stmts, ..Default::default() };

                return Some(ParseResult {
                    ast: js_ast::Ast::from_parts(parts),
                    source: source.clone(),
                    loader,
                    input_fd,
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                    empty: false,
                });
            }
            options::Loader::Md => {
                let html = match bun_md::render_to_html(source.contents, allocator) {
                    Ok(h) => h,
                    Err(_) => {
                        let _ = self.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!("Failed to render markdown to HTML"),
                        );
                        return None;
                    }
                };
                let expr = js_ast::Expr::init(
                    js_ast::E::String { data: html, ..Default::default() },
                    logger::Loc::EMPTY,
                );
                let stmt = js_ast::Stmt::alloc(
                    js_ast::S::ExportDefault {
                        value: js_ast::StmtOrExpr::Expr(expr),
                        default_name: js_ast::LocRef {
                            loc: logger::Loc::default(),
                            r#ref: Ref::NONE,
                        },
                    },
                    logger::Loc { start: 0 },
                );
                let stmts = allocator.alloc_slice_fill_default::<js_ast::Stmt>(1);
                stmts[0] = stmt;
                let parts = allocator.alloc_slice_fill_default::<js_ast::Part>(1);
                parts[0] = js_ast::Part { stmts, ..Default::default() };

                return Some(ParseResult {
                    ast: js_ast::Ast::from_parts(parts),
                    source: source.clone(),
                    loader,
                    input_fd,
                    already_bundled: AlreadyBundled::None,
                    pending_imports: Default::default(),
                    runtime_transpiler_cache: None,
                    empty: false,
                });
            }
            options::Loader::Wasm => {
                if self.options.target.is_bun() {
                    if !source.is_web_assembly() {
                        let _ = self.log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "Invalid wasm file \"{}\" (missing magic header)",
                                bstr::BStr::new(path.text)
                            ),
                        );
                        return None;
                    }

                    return Some(ParseResult {
                        ast: js_ast::Ast::empty(),
                        source: source.clone(),
                        loader,
                        input_fd,
                        already_bundled: AlreadyBundled::None,
                        pending_imports: Default::default(),
                        runtime_transpiler_cache: None,
                        empty: false,
                    });
                }
            }
            options::Loader::Css => {}
            _ => Output::panic(
                "Unsupported loader {} for path: {}",
                format_args!(
                    "{} {}",
                    <&'static str>::from(loader),
                    bstr::BStr::new(source.path.text)
                ),
            ),
        }

        None
    }

    fn normalize_entry_point_path(&mut self, _entry: &[u8]) -> &[u8] {
        let paths: [&[u8]; 1] = [_entry];
        let mut entry = self.fs.abs(&paths);

        // TODO(port): std.fs.accessAbsolute — replace with bun_sys access; std::fs banned.
        if bun_sys::access_absolute(entry).is_err() {
            return _entry;
        }

        entry = self.fs.relative_to(entry);

        if !entry.starts_with(b"./") {
            // Entry point paths without a leading "./" are interpreted as package
            // paths. This happens because they go through general path resolution
            // like all other import paths so that plugins can run on them. Requiring
            // a leading "./" for a relative path simplifies writing plugins because
            // entry points aren't a special case.
            //
            // However, requiring a leading "./" also breaks backward compatibility
            // and makes working with the CLI more difficult. So attempt to insert
            // "./" automatically when needed. We don't want to unconditionally insert
            // a leading "./" because the path may not be a file system path. For
            // example, it may be a URL. So only insert a leading "./" when the path
            // is an exact match for an existing file.
            let __entry = self
                .allocator
                .alloc_slice_fill_default::<u8>(b"./".len() + entry.len());
            __entry[0] = b'.';
            __entry[1] = b'/';
            __entry[2..].copy_from_slice(entry);
            entry = __entry;
        }

        entry
    }

    fn enqueue_entry_points<const NORMALIZE_ENTRY_POINT: bool>(
        &mut self,
        entry_points: &mut [resolver::Result],
    ) -> usize {
        let mut entry_point_i: usize = 0;

        for _entry in self.options.entry_points.iter() {
            let entry: &[u8] = if NORMALIZE_ENTRY_POINT {
                self.normalize_entry_point_path(_entry)
            } else {
                _entry
            };

            // PORT NOTE: `defer { Store.reset() }` → scopeguard at top of loop body.
            let _reset = scopeguard::guard((), |_| {
                js_ast::Expr::Data::Store::reset();
                js_ast::Stmt::Data::Store::reset();
            });

            let result = match self.resolver.resolve(
                self.fs.top_level_dir,
                entry,
                resolver::Kind::EntryPointBuild,
            ) {
                Ok(r) => r,
                Err(err) => {
                    Output::pretty_error(format_args!(
                        "Error resolving \"{}\": {}\n",
                        bstr::BStr::new(entry),
                        err.name()
                    ));
                    continue;
                }
            };

            if result.path_const().is_none() {
                Output::pretty_error(format_args!(
                    "\"{}\" is disabled due to \"browser\" field in package.json.\n",
                    bstr::BStr::new(entry)
                ));
                continue;
            }

            if self
                .linker
                .enqueue_resolve_result(&result)
                .expect("unreachable")
            {
                entry_points[entry_point_i] = result;
                entry_point_i += 1;
            }
        }

        entry_point_i
    }

    pub fn transform(
        &mut self,
        allocator: &'a Arena,
        log: &mut logger::Log,
        opts: api::TransformOptions,
    ) -> Result<options::TransformResult, Error> {
        // TODO(port): narrow error set
        let _ = opts;
        let mut entry_points = allocator
            .alloc_slice_fill_default::<resolver::Result>(self.options.entry_points.len());
        let n = self.enqueue_entry_points::<true>(entry_points);
        let entry_points = &mut entry_points[..n];
        let _ = entry_points;

        if log.level.at_least(logger::Level::Debug) {
            self.resolver.debug_logs = Some(DebugLogs::init(allocator)?);
        }
        self.options.transform_only = true;
        let did_start = false;

        if self.options.output_dir_handle.is_none() {
            // TODO(port): bun.sys.File.from(std.fs.File.stdout()) — std::fs banned; use bun_sys stdout.
            let outstream = bun_sys::File::stdout();

            if !did_start {
                match self.options.import_path_format {
                    options::BundleOptions::ImportPathFormat::Relative => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::Relative }, false, _>(
                            outstream,
                        )?,
                    options::BundleOptions::ImportPathFormat::AbsoluteUrl => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::AbsoluteUrl }, false, _>(
                            outstream,
                        )?,
                    options::BundleOptions::ImportPathFormat::AbsolutePath => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::AbsolutePath }, false, _>(
                            outstream,
                        )?,
                    options::BundleOptions::ImportPathFormat::PackagePath => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::PackagePath }, false, _>(
                            outstream,
                        )?,
                }
            }
        } else {
            let Some(output_dir) = self.options.output_dir_handle else {
                Output::print_error(format_args!("Invalid or missing output directory."));
                Global::crash();
            };

            if !did_start {
                match self.options.import_path_format {
                    options::BundleOptions::ImportPathFormat::Relative => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::Relative }, false, _>(
                            output_dir,
                        )?,
                    options::BundleOptions::ImportPathFormat::AbsoluteUrl => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::AbsoluteUrl }, false, _>(
                            output_dir,
                        )?,
                    options::BundleOptions::ImportPathFormat::AbsolutePath => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::AbsolutePath }, false, _>(
                            output_dir,
                        )?,
                    options::BundleOptions::ImportPathFormat::PackagePath => self
                        .process_resolve_queue::<{ options::BundleOptions::ImportPathFormat::PackagePath }, false, _>(
                            output_dir,
                        )?,
                }
            }
        }

        if FeatureFlags::TRACING && self.options.log.level.at_least(logger::Level::Info) {
            Output::pretty_errorln(format_args!(
                "<r><d>\n---Tracing---\nResolve time:      {}\nParsing time:      {}\n---Tracing--\n\n<r>",
                self.resolver.elapsed, self.elapsed,
            ));
        }

        let mut final_result = options::TransformResult::init(
            allocator.alloc_slice_copy(&self.result.outbase),
            core::mem::take(&mut self.output_files).into_boxed_slice(),
            log,
            allocator,
        )?;
        final_result.root_dir = self.options.output_dir_handle;
        Ok(final_result)
    }

    fn process_resolve_queue<
        const IMPORT_PATH_FORMAT: options::BundleOptions::ImportPathFormat,
        const WRAP_ENTRY_POINT: bool,
        Outstream,
    >(
        &mut self,
        outstream: Outstream,
    ) -> Result<(), Error> {
        // TODO(port): narrow error set
        while let Some(item) = self.resolve_queue.read_item() {
            js_ast::Expr::Data::Store::reset();
            js_ast::Stmt::Data::Store::reset();

            if WRAP_ENTRY_POINT {
                let path = item.path_const().expect("unreachable");
                let loader = self.options.loader(path.name.ext);

                if item.import_kind == bun_options_types::ImportKind::EntryPoint
                    && loader.supports_client_entry_point()
                {
                    let client_entry_point =
                        self.allocator.alloc(EntryPoints::ClientEntryPoint::default());
                    client_entry_point.generate(
                        self,
                        path.name,
                        &self.options.framework.as_ref().unwrap().client.path,
                    )?;

                    let entry_point_output_file = match self
                        .build_with_resolve_result_eager::<IMPORT_PATH_FORMAT, _>(
                            item.clone(),
                            &outstream,
                            Some(client_entry_point),
                        ) {
                        Ok(Some(f)) => f,
                        _ => continue,
                    };
                    self.output_files.push(entry_point_output_file);
                    // PERF(port): was assume_capacity (catch unreachable)

                    js_ast::Expr::Data::Store::reset();
                    js_ast::Stmt::Data::Store::reset();

                    // At this point, the entry point will be de-duped.
                    // So we just immediately build it.
                    let mut item_not_entrypointed = item.clone();
                    item_not_entrypointed.import_kind = bun_options_types::ImportKind::Stmt;
                    let original_output_file = match self
                        .build_with_resolve_result_eager::<IMPORT_PATH_FORMAT, _>(
                            item_not_entrypointed,
                            &outstream,
                            None,
                        ) {
                        Ok(Some(f)) => f,
                        _ => continue,
                    };
                    self.output_files.push(original_output_file);

                    continue;
                }
            }

            let output_file = match self
                .build_with_resolve_result_eager::<IMPORT_PATH_FORMAT, _>(item, &outstream, None)
            {
                Ok(Some(f)) => f,
                _ => continue,
            };
            self.output_files.push(output_file);
        }
        Ok(())
    }
}

impl<'a> Drop for Transpiler<'a> {
    fn drop(&mut self) {
        // TODO(port): Zig `deinit` called .deinit() on borrowed `log` and `fs` — those are
        // `&'a mut` / `&'static mut` here, not owned. Phase B: decide whether Transpiler
        // truly owns teardown of those or callers do. `options` and `resolver` drop
        // automatically.
    }
}

pub struct ServeResult {
    pub file: options::OutputFile,
    pub mime_type: MimeType,
}

pub type ResolveResults = HashMap<u64, ()>;
pub type ResolveQueue = LinearFifo<resolver::Result>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/transpiler.zig (1461 lines)
//   confidence: medium
//   todos:      25
//   notes:      allocator threading ambiguous (AST crate vs default_allocator); set_log/Drop borrow aliasing; client_entry_point anytype collapsed to concrete type; MacroJSCtx pulled from bundler_jsc (invert in Phase B)
// ──────────────────────────────────────────────────────────────────────────
