// This file is the old linker, used by Bun.Transpiler.

use std::io::Write as _;

use bun_collections::HashMap;
use bun_logger::Log;
use bun_options_types::ImportRecord;
use bun_paths::{self, SEP};
use bun_fs as Fs;
use bun_resolver::{self as resolver, Resolver};
use bun_str::strings;
use bun_sys::Fd;
use bun_url::URL;

use crate::options::{self, BundleOptions, ImportPathFormat};
use crate::transpiler::{self, ParseResult, PluginRunner, ResolveQueue, ResolveResults, Transpiler};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum CSSResolveError {
    #[error("ResolveMessage")]
    ResolveMessage,
}
impl From<CSSResolveError> for bun_core::Error {
    fn from(e: CSSResolveError) -> Self {
        bun_core::err!(e)
    }
}

pub type OnImportCallback = fn(resolve_result: &resolver::Result, import_record: &mut ImportRecord, origin: URL);

type HashedFileNameMap = HashMap<u64, Box<[u8]>>;

pub struct Linker<'a> {
    // allocator field dropped — global mimalloc (callers pass bun.default_allocator)
    pub options: &'a mut BundleOptions,
    pub fs: &'static Fs::FileSystem,
    pub log: &'a mut Log,
    pub resolve_queue: &'a mut ResolveQueue,
    pub resolver: &'a mut Resolver,
    pub resolve_results: &'a mut ResolveResults,
    pub any_needs_runtime: bool,
    pub runtime_import_record: Option<ImportRecord>,
    pub hashed_filenames: HashedFileNameMap,
    pub import_counter: usize,
    pub tagged_resolutions: TaggedResolution,

    pub plugin_runner: Option<&'a mut PluginRunner>,
}

pub const RUNTIME_SOURCE_PATH: &[u8] = b"bun:wrap";

#[derive(Default)]
pub struct TaggedResolution {
    pub react_refresh: Option<resolver::Result>,
    // These tags cannot safely be used
    // Projects may use different JSX runtimes across folders
    // jsx_import: Option<resolver::Result>,
    // jsx_classic: Option<resolver::Result>,
}

// TODO(port): BSSStringList is a static BSS-backed string list from bun_alloc; verify generics shape
type ImportPathsList = bun_alloc::BSSStringList<512, 128>;
// TODO(port): Zig used `pub var ... = undefined` initialized in init(); model as Option for now
pub static mut RELATIVE_PATHS_LIST: Option<&'static mut ImportPathsList> = None;

impl<'a> Linker<'a> {
    pub fn init(
        log: &'a mut Log,
        resolve_queue: &'a mut ResolveQueue,
        options: &'a mut BundleOptions,
        resolver: &'a mut Resolver,
        resolve_results: &'a mut ResolveResults,
        fs: &'static Fs::FileSystem,
    ) -> Self {
        // SAFETY: single-threaded init at Transpiler construction; mirrors Zig `pub var` write
        unsafe {
            RELATIVE_PATHS_LIST = Some(ImportPathsList::init());
        }

        Self {
            options,
            fs,
            log,
            resolve_queue,
            resolver,
            resolve_results,
            any_needs_runtime: false,
            runtime_import_record: None,
            hashed_filenames: HashedFileNameMap::default(),
            import_counter: 0,
            tagged_resolutions: TaggedResolution::default(),
            plugin_runner: None,
        }
    }

    pub fn get_mod_key(
        &mut self,
        file_path: Fs::Path,
        fd: Option<Fd>,
    ) -> Result<Fs::RealFS::ModKey, bun_core::Error> {
        // TODO(port): Zig used std.fs.File / std.fs.cwd().openFile here. Replace with bun_sys::File
        // open in read-only mode. The std::fs ban applies; this is a placeholder shape.
        let file: bun_sys::File = if let Some(f) = fd {
            f.into_file()
        } else {
            bun_sys::File::open(file_path.text, bun_sys::O::RDONLY, 0)?
        };
        Fs::FileSystem::set_max_fd(file.handle());
        let modkey = Fs::RealFS::ModKey::generate(&self.fs.fs, file_path.text, &file)?;

        if fd.is_none() {
            file.close();
        }
        Ok(modkey)
    }

    pub fn get_hashed_filename(
        &mut self,
        file_path: Fs::Path,
        fd: Option<Fd>,
    ) -> Result<&[u8], bun_core::Error> {
        // TODO(port): narrow error set
        if Transpiler::IS_CACHE_ENABLED {
            let hashed = bun_wyhash::hash(file_path.text);
            // PORT NOTE: reshaped for borrowck — Zig did getOrPut then early-return on found_existing
            if let Some(v) = self.hashed_filenames.get(&hashed) {
                return Ok(v);
            }
        }

        let modkey = self.get_mod_key(file_path, fd)?;
        let hash_name = modkey.hash_name(file_path.text);

        if Transpiler::IS_CACHE_ENABLED {
            let hashed = bun_wyhash::hash(file_path.text);
            self.hashed_filenames
                .insert(hashed, Box::<[u8]>::from(hash_name));
        }

        Ok(hash_name)
    }

    /// This modifies the Ast in-place! It resolves import records and generates paths.
    pub fn link<
        const IMPORT_PATH_FORMAT: ImportPathFormat,
        const IGNORE_RUNTIME: bool,
        const IS_BUN: bool,
    >(
        &mut self,
        file_path: Fs::Path,
        result: &mut ParseResult,
        origin: URL,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let source_dir = file_path.source_dir();
        let mut externals: Vec<u32> = Vec::new();
        let mut had_resolve_errors = false;

        let is_deferred = result.pending_imports.len() > 0;

        // Step 1. Resolve imports & requires
        match result.loader {
            options::Loader::Jsx
            | options::Loader::Js
            | options::Loader::Ts
            | options::Loader::Tsx => {
                for (record_i, import_record) in
                    result.ast.import_records.slice_mut().iter_mut().enumerate()
                {
                    if import_record.flags.is_unused
                        || (IS_BUN
                            && is_deferred
                            && !result.is_pending_import(u32::try_from(record_i).unwrap()))
                    {
                        continue;
                    }

                    let record_index = record_i;
                    if !IGNORE_RUNTIME {
                        if import_record.path.namespace == b"runtime" {
                            if IMPORT_PATH_FORMAT == ImportPathFormat::AbsoluteUrl {
                                import_record.path = Fs::Path::init_with_namespace(
                                    origin.join_alloc(b"", b"", b"bun:wrap", b"", b"")?,
                                    b"bun",
                                );
                            } else {
                                import_record.path = self.generate_import_path::<IMPORT_PATH_FORMAT>(
                                    source_dir,
                                    RUNTIME_SOURCE_PATH,
                                    false,
                                    b"bun",
                                    origin,
                                )?;
                            }

                            result.ast.runtime_import_record_id =
                                u32::try_from(record_index).unwrap();
                            result.ast.needs_runtime = true;
                            continue;
                        }
                    }

                    if IS_BUN {
                        // TODO(port): jsc::ModuleLoader lives in the runtime crate; verify path
                        if let Some(replacement) =
                            bun_resolve_builtins::HardcodedModule::HardcodedModule::Alias::get(
                                import_record.path.text,
                                self.options.target,
                                bun_resolve_builtins::HardcodedModule::AliasOptions {
                                    rewrite_jest_for_tests: self.options.rewrite_jest_for_tests,
                                },
                            )
                        {
                            if replacement.tag == bun_options_types::ImportRecordTag::Builtin
                                && import_record.kind.is_common_js()
                            {
                                continue;
                            }
                            import_record.path.text = replacement.path;
                            import_record.tag = replacement.tag;
                            import_record.flags.is_external_without_side_effects = true;
                            continue;
                        }
                        if strings::starts_with(import_record.path.text, b"node:") {
                            // if a module is not found here, it is not found at all
                            // so we can just disable it
                            had_resolve_errors =
                                self.when_module_not_found::<IS_BUN>(import_record, result)?;

                            if had_resolve_errors {
                                return Err(bun_core::err!("ResolveMessage"));
                            }
                            continue;
                        }

                        if strings::has_prefix(import_record.path.text, b"bun:") {
                            import_record.path =
                                Fs::Path::init(&import_record.path.text[b"bun:".len()..]);
                            import_record.path.namespace = b"bun";

                            // don't link bun
                            continue;
                        }

                        // Resolve dynamic imports lazily for perf
                        if import_record.kind == bun_options_types::ImportKind::Dynamic {
                            continue;
                        }
                    }

                    if let Some(runner) = self.plugin_runner.as_deref_mut() {
                        if PluginRunner::could_be_plugin(import_record.path.text) {
                            if let Some(path) = runner.on_resolve(
                                import_record.path.text,
                                file_path.text,
                                self.log,
                                import_record.range.loc,
                                if IS_BUN {
                                    transpiler::PluginTarget::Bun
                                } else if self.options.target == options::Target::Browser {
                                    transpiler::PluginTarget::Browser
                                } else {
                                    transpiler::PluginTarget::Node
                                },
                            )? {
                                import_record.path = self
                                    .generate_import_path::<IMPORT_PATH_FORMAT>(
                                        source_dir,
                                        path.text,
                                        false,
                                        path.namespace,
                                        origin,
                                    )?;
                                import_record.flags.print_namespace_in_path = true;
                                continue;
                            }
                        }
                    }
                }
            }

            _ => {}
        }
        if had_resolve_errors {
            return Err(bun_core::err!("ResolveMessage"));
        }
        externals.clear();
        // PERF(port): Zig clearAndFree; Vec drop at scope end frees — profile in Phase B
        Ok(())
    }

    fn when_module_not_found<const IS_BUN: bool>(
        &mut self,
        import_record: &mut ImportRecord,
        result: &mut ParseResult,
    ) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        if import_record.flags.handles_import_errors {
            import_record.path.is_disabled = true;
            return Ok(false);
        }

        if IS_BUN {
            // make these happen at runtime
            if import_record.kind == bun_options_types::ImportKind::Require
                || import_record.kind == bun_options_types::ImportKind::RequireResolve
                || import_record.kind == bun_options_types::ImportKind::Dynamic
            {
                return Ok(false);
            }
        }

        if !import_record.path.text.is_empty()
            && resolver::is_package_path(import_record.path.text)
        {
            if self.options.target == options::Target::Browser
                && options::ExternalModules::is_node_builtin(import_record.path.text)
            {
                self.log.add_resolve_error(
                    &result.source,
                    import_record.range,
                    format_args!(
                        "Could not resolve: \"{}\". Try setting --target=\"node\"",
                        bstr::BStr::new(import_record.path.text)
                    ),
                    import_record.kind,
                    bun_core::err!("ModuleNotFound"),
                )?;
            } else {
                self.log.add_resolve_error(
                    &result.source,
                    import_record.range,
                    format_args!(
                        "Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                        bstr::BStr::new(import_record.path.text)
                    ),
                    import_record.kind,
                    bun_core::err!("ModuleNotFound"),
                )?;
            }
        } else {
            self.log.add_resolve_error(
                &result.source,
                import_record.range,
                format_args!(
                    "Could not resolve: \"{}\"",
                    bstr::BStr::new(import_record.path.text)
                ),
                import_record.kind,
                bun_core::err!("ModuleNotFound"),
            )?;
        }
        Ok(true)
    }

    pub fn generate_import_path<const IMPORT_PATH_FORMAT: ImportPathFormat>(
        &mut self,
        source_dir: &[u8],
        source_path: &[u8],
        use_hashed_name: bool,
        namespace: &[u8],
        origin: URL,
    ) -> Result<Fs::Path, bun_core::Error> {
        // TODO(port): narrow error set
        match IMPORT_PATH_FORMAT {
            ImportPathFormat::AbsolutePath => {
                if namespace == b"node" {
                    return Ok(Fs::Path::init_with_namespace(source_path, b"node"));
                }

                if namespace == b"bun" || namespace == b"file" || namespace.is_empty() {
                    let relative_name = self.fs.relative(source_dir, source_path);
                    Ok(Fs::Path::init_with_pretty(source_path, relative_name))
                } else {
                    Ok(Fs::Path::init_with_namespace(source_path, namespace))
                }
            }
            ImportPathFormat::Relative => {
                let mut relative_name = self.fs.relative(source_dir, source_path);

                let pretty: Box<[u8]>;
                if use_hashed_name {
                    let basepath = Fs::Path::init(source_path);
                    let basename = self.get_hashed_filename(basepath, None)?;
                    let dir = basepath.name.dir_with_trailing_slash();
                    let mut _pretty: Vec<u8> =
                        Vec::with_capacity(dir.len() + basename.len() + basepath.name.ext.len());
                    _pretty.extend_from_slice(dir);
                    _pretty.extend_from_slice(basename);
                    _pretty.extend_from_slice(basepath.name.ext);
                    pretty = _pretty.into_boxed_slice();
                    relative_name = Box::<[u8]>::from(relative_name);
                    // TODO(port): lifetime — Zig dup'd relative_name into linker.allocator; ownership of
                    // these slices inside Fs::Path needs to be settled in Phase B
                } else {
                    if relative_name.len() > 1
                        && !(relative_name[0] == SEP || relative_name[0] == b'.')
                    {
                        pretty = strings::concat(&[b"./", relative_name])?;
                    } else {
                        pretty = Box::<[u8]>::from(relative_name);
                    }

                    relative_name = &pretty;
                }

                Ok(Fs::Path::init_with_pretty(pretty, relative_name))
            }

            ImportPathFormat::AbsoluteUrl => {
                if namespace == b"node" {
                    if cfg!(debug_assertions) {
                        debug_assert!(&source_path[0..5] == b"node:");
                    }

                    let mut buf: Vec<u8> = Vec::new();
                    // assumption: already starts with "node:"
                    write!(
                        &mut buf,
                        "{}/{}",
                        bstr::BStr::new(strings::without_trailing_slash(origin.href)),
                        bstr::BStr::new(strings::without_leading_slash(source_path)),
                    )
                    .map_err(|_| bun_core::err!("OutOfMemory"))?;
                    Ok(Fs::Path::init(buf.into_boxed_slice()))
                } else {
                    let mut absolute_pathname = Fs::PathName::init(source_path);

                    if !self.options.preserve_extensions {
                        if let Some(ext) =
                            self.options.out_extensions.get(absolute_pathname.ext)
                        {
                            absolute_pathname.ext = ext;
                        }
                    }

                    let mut base = self.fs.relative_to(source_path);
                    if let Some(dot) = strings::last_index_of_char(base, b'.') {
                        base = &base[0..dot];
                    }

                    let dirname = bun_paths::dirname(base).unwrap_or(b"");

                    let mut basename = bun_paths::basename(base);

                    if use_hashed_name {
                        let basepath = Fs::Path::init(source_path);

                        basename = self.get_hashed_filename(basepath, None)?;
                    }

                    Ok(Fs::Path::init(origin.join_alloc(
                        b"",
                        dirname,
                        basename,
                        absolute_pathname.ext,
                        source_path,
                    )?))
                }
            }

            _ => unreachable!(),
        }
    }

    pub fn resolve_result_hash_key(&self, resolve_result: &resolver::Result) -> u64 {
        let path = resolve_result.path_const().expect("unreachable");
        let mut hash_key = path.text;

        // Shorter hash key is faster to hash
        if strings::starts_with(path.text, self.fs.top_level_dir) {
            hash_key = &path.text[self.fs.top_level_dir.len()..];
        }

        bun_wyhash::hash(hash_key)
    }

    pub fn enqueue_resolve_result(
        &mut self,
        resolve_result: &resolver::Result,
    ) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        let hash_key = self.resolve_result_hash_key(resolve_result);

        let get_or_put_entry = self.resolve_results.get_or_put(hash_key)?;

        if !get_or_put_entry.found_existing {
            self.resolve_queue.write_item(resolve_result.clone())?;
        }

        Ok(!get_or_put_entry.found_existing)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker.zig (421 lines)
//   confidence: medium
//   todos:      8
//   notes:      Fs::Path string ownership unresolved; const-generic enum ImportPathFormat needs ConstParamTy; HardcodedModule::Alias crate path needs verification
// ──────────────────────────────────────────────────────────────────────────
