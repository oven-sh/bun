// This file is the old linker, used by Bun.Transpiler.

use std::io::Write as _;

use bun_ast::Log;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag};
use bun_collections::HashMap;
use bun_paths::{self, SEP};
// two `fs` shapes are in play here. `bun_resolver::fs` (`Fs`) holds
// the singleton `FileSystem` / `DirnameStore`; `bun_paths::fs` (`PFs`) defines
// the `Path`/`PathName` value types that `ImportRecord.path` is typed against.
// B-3 collapses them. Until then, construct
// `import_record.path` via `PFs::Path` so the field assignment unifies.
use bun_core::strings;
use bun_paths::fs as PFs;
use bun_resolver::fs as Fs;
use bun_resolver::{self as resolver, Resolver};
use bun_sys::Fd;
use bun_url::URL;

use crate::options::{self, BundleOptions, ImportPathFormat};
use crate::options_impl::Target as BundleTarget;
use crate::transpiler::{
    BunPluginTarget, ParseResult, PluginResolver, PluginRunner, ResolveQueue, ResolveResults,
};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum CSSResolveError {
    #[error("ResolveMessage")]
    ResolveMessage,
}

type HashedFileNameMap = HashMap<u64, &'static [u8]>;

// Matches `Transpiler::IS_CACHE_ENABLED`; inlined so `get_hashed_filename`
// doesn't need a `Transpiler` handle.
const IS_CACHE_ENABLED: bool = false;

pub struct Linker {
    // arena field dropped — global mimalloc (callers pass `bun.default_allocator`)
    // `Transpiler` owns these values directly and also owns `linker:
    // crate::Linker` by value, so storing references here would alias
    // `&mut self` on every `transpiler.linker.link(...)` call. Use raw
    // pointers and dereference at use-site; same
    // contract as `transpiler::set_log`'s `linker.log = log as *mut _`.
    pub options: *mut BundleOptions<'static>,
    pub fs: *mut Fs::FileSystem,
    pub log: *mut Log,
    pub resolve_queue: *mut ResolveQueue,
    pub resolver: *mut Resolver<'static>,
    pub resolve_results: *mut ResolveResults,
    pub any_needs_runtime: bool,
    pub runtime_import_record: Option<ImportRecord>,
    pub hashed_filenames: HashedFileNameMap,
    pub import_counter: usize,
    pub tagged_resolutions: TaggedResolution,

    pub plugin_runner: Option<*mut dyn PluginResolver>,
}

pub(crate) const RUNTIME_SOURCE_PATH: &[u8] = b"bun:wrap";

#[derive(Default)]
pub struct TaggedResolution {
    pub react_refresh: Option<resolver::Result>,
    // These tags cannot safely be used
    // Projects may use different JSX runtimes across folders
    // jsx_import: Option<resolver::Result>,
    // jsx_classic: Option<resolver::Result>,
}

// ── relative_paths_list singleton ────────────────────────────────────────
// `bun_alloc::BSSStringList<COUNT, ITEM_LENGTH>` encodes the parameters as
// `COUNT = _COUNT * 2`, `ITEM_LENGTH = _ITEM_LENGTH + 1` (see `bun_alloc/lib.rs`).
// `bss_string_list!` would be the canonical declare-site macro but
// expands to `core::cell::SyncUnsafeCell`, and `bun_bundler` does not (yet)
// enable `#![feature(sync_unsafe_cell)]`. Use the heap-allocating `init()`
// fallback under a `LazyLock` instead — same lifetime semantics
// (process-static, never freed), just not BSS-backed. Swap to the macro once
// the crate-level feature flag lands.
pub(crate) type ImportPathsList = bun_alloc::BSSStringList<{ 512 * 2 }, { 128 + 1 }>;

/// `Send + Sync` newtype around the leaked `BSSStringList` heap allocation so
/// it can sit inside a `LazyLock`. The underlying list serializes its own
/// mutation through an internal `Mutex` (see `BSSStringList::append`), so
/// sharing the raw pointer across threads is sound; the `&mut self` receiver
/// on `append` is not an exclusivity requirement.
struct ImportPathsListPtr(core::ptr::NonNull<ImportPathsList>);
// SAFETY: `BSSStringList` guards every mutating method with `self.mutex`, and
// the allocation is process-lifetime (never freed). The pointer is therefore
// safe to publish and dereference from any thread.
unsafe impl Send for ImportPathsListPtr {}
// SAFETY: same invariant as `Send` — internal mutex serializes mutation and the
// allocation is process-lifetime, so shared `&` access from any thread is sound.
unsafe impl Sync for ImportPathsListPtr {}

static RELATIVE_PATHS_LIST: std::sync::LazyLock<ImportPathsListPtr> =
    std::sync::LazyLock::new(|| ImportPathsListPtr(ImportPathsList::init()));

#[inline]
fn relative_paths_list_ptr() -> *mut ImportPathsList {
    RELATIVE_PATHS_LIST.0.as_ptr()
}

// ── HardcodedModule alias lookup ────────────────────────────────────────
// Thin adapter over `bun_resolve_builtins::Alias::get` so the call site keeps
// `&'static [u8]` for `import_record.path.text` (the table stores `&'static
// ZStr`). `BundleTarget` and `bun_resolve_builtins::Target` are the same
// `bun_ast::Target`; ditto `ImportRecordTag` /
// `import_record::Tag`, so no bridge is needed.
mod hardcoded_module {
    use super::*;
    #[derive(Default, Clone, Copy)]
    pub(super) struct AliasOptions {
        pub rewrite_jest_for_tests: bool,
    }
    pub(super) struct Alias {
        pub path: &'static [u8],
        pub tag: ImportRecordTag,
    }
    pub(super) fn get(name: &[u8], target: BundleTarget, opts: AliasOptions) -> Option<Alias> {
        bun_resolve_builtins::Alias::get(
            name,
            target,
            bun_resolve_builtins::Cfg {
                rewrite_jest_for_tests: opts.rewrite_jest_for_tests,
            },
        )
        .map(|a| Alias {
            path: a.path.as_bytes(),
            tag: a.tag,
        })
    }
}

/// Intern a byte buffer into the process-lifetime `relative_paths_list`
/// `BSSStringList` singleton.
///
/// The linker is a
/// per-transpile singleton whose output paths flow into `ImportRecord.path:
/// Path<'static>`. PORTING.md §Forbidden bans `Vec::leak`/`Box::leak` for
/// fabricating `&'static [u8]`; route through the `relative_paths_list`
/// interner instead so the bytes are owned by a true process-lifetime
/// singleton (the `OnceLock`-style exception PORTING.md carves out).
#[inline]
pub(crate) fn dupe(src: &[u8]) -> &'static [u8] {
    // SAFETY: `relative_paths_list_ptr()` is Once-initialized and never freed
    // (process-lifetime singleton). `append` takes `*mut Self`, serializes on
    // the inner mutex, copies `src` into its owned backing buffer and returns
    // a slice borrowing that storage; the returned borrow is `'static`-valid
    // by construction.
    unsafe { ImportPathsList::append(relative_paths_list_ptr(), &src).expect("OOM") }
}
#[inline]
fn intern(buf: Vec<u8>) -> &'static [u8] {
    let r = dupe(buf.as_slice());
    drop(buf);
    r
}
impl Linker {
    // ── raw-pointer field accessors ──────────────────────────────────────
    // The pointer fields are self-referential backrefs into the owning
    // `Transpiler` (sibling fields), wired in `configure_linker*`. They are
    // briefly null between `Transpiler::init` and `configure_linker`, but the
    // contract is that no `link()`/`generate_import_path()`/`enqueue_*` call
    // happens before `configure_linker` runs. Centralize the deref + invariant
    // here so call sites are safe-Rust.

    /// Shared borrow of the owning `Transpiler.options`.
    ///
    /// SAFETY: `self.options` points at the sibling `Transpiler.options` field
    /// (set via `addr_of_mut!` in `configure_linker*`). The `Transpiler`
    /// outlives all `Linker` method calls, and `options` is not mutated for
    /// the duration of any borrow returned here (callers only read scalar
    /// config like `target` / `preserve_extensions`). Never null once
    /// `configure_linker` has run.
    #[inline]
    pub fn options(&self) -> &BundleOptions<'static> {
        debug_assert!(
            !self.options.is_null(),
            "Linker.options used before configure_linker"
        );
        // SAFETY: non-null sibling backref into the owning `Transpiler` set in
        // `configure_linker*`; the `Transpiler` outlives every `Linker` call and
        // `options` is not mutated while this borrow is live.
        unsafe { &*self.options }
    }

    /// Shared borrow of the process-lifetime `Fs::FileSystem` singleton.
    ///
    /// SAFETY: `self.fs` is the `FileSystem::instance()` singleton, set at
    /// `Transpiler::init` time and never freed. Never null. Only scalar
    /// fields (`top_level_dir`) are read.
    #[inline]
    pub fn fs(&self) -> &Fs::FileSystem {
        debug_assert!(!self.fs.is_null());
        // SAFETY: `self.fs` is the process-lifetime `FileSystem::instance()`
        // singleton, set at `Transpiler::init` and never freed or mutated.
        unsafe { &*self.fs }
    }

    /// Exclusive borrow of the owning `Transpiler.log`.
    ///
    /// SAFETY: `self.log` is the `*mut Log` copied from `Transpiler.log` in
    /// `configure_linker*` / `set_log`. Callers borrow `&mut self.linker`
    /// field-disjointly from `Transpiler.log`, and no callee reached from a
    /// `Linker` method re-derives a borrow of `*self.log`, so the `&mut`
    /// returned here is exclusive for its lifetime. Never null.
    #[inline]
    pub fn log_mut(&mut self) -> &mut Log {
        debug_assert!(!self.log.is_null());
        // SAFETY: non-null backref to `Transpiler.log` set in `configure_linker*`;
        // callers borrow `&mut self.linker` field-disjointly so no other live
        // borrow of `*self.log` exists for the returned lifetime.
        unsafe { &mut *self.log }
    }

    /// Exclusive borrow of the owning `Transpiler.resolve_results`.
    ///
    /// SAFETY: sibling-field backref wired via `addr_of_mut!` in
    /// `configure_linker*`. The only caller (`enqueue_resolve_result`) is
    /// reached via `Transpiler::enqueue_entry_points`, which holds no other
    /// borrow of `self.resolve_results` across the call. Never null after
    /// `configure_linker`.
    #[inline]
    pub fn resolve_results_mut(&mut self) -> &mut ResolveResults {
        debug_assert!(
            !self.resolve_results.is_null(),
            "Linker.resolve_results used before configure_linker"
        );
        // SAFETY: non-null sibling backref wired in `configure_linker*`; the sole
        // caller holds no other borrow of `Transpiler.resolve_results` across the
        // call, so the `&mut` is exclusive.
        unsafe { &mut *self.resolve_results }
    }

    /// Exclusive borrow of the owning `Transpiler.resolve_queue`.
    ///
    /// SAFETY: sibling-field backref wired via `addr_of_mut!` in
    /// `configure_linker*`. Disjoint from `resolve_results`; the only caller
    /// holds no other borrow of `self.resolve_queue` across the call. Never
    /// null after `configure_linker`.
    #[inline]
    pub fn resolve_queue_mut(&mut self) -> &mut ResolveQueue {
        debug_assert!(
            !self.resolve_queue.is_null(),
            "Linker.resolve_queue used before configure_linker"
        );
        // SAFETY: non-null sibling backref wired in `configure_linker*`; disjoint
        // from `resolve_results` and the sole caller holds no other borrow of
        // `Transpiler.resolve_queue`, so the `&mut` is exclusive.
        unsafe { &mut *self.resolve_queue }
    }

    pub fn init(
        log: *mut Log,
        resolve_queue: *mut ResolveQueue,
        options: *mut BundleOptions<'static>,
        resolver: *mut Resolver<'static>,
        resolve_results: *mut ResolveResults,
        fs: *mut Fs::FileSystem,
    ) -> Self {
        // The `LazyLock` accessor initializes `relative_paths_list` lazily on
        // first `intern_path()` / `relative_paths_list()` call, so no eager
        // poke is needed (it would be startup overhead for non-bundling code paths).
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

    /// Re-seat the self-referential back-pointers after the owning
    /// `Transpiler` has been moved to its final address. Only re-assigns the
    /// pointer fields; does NOT reset
    /// `import_counter` / `plugin_runner` / `tagged_resolutions` /
    /// `any_needs_runtime`. Use instead of `init` from
    /// `Transpiler::wire_after_move`.
    pub fn reseat_self_refs(
        &mut self,
        log: *mut Log,
        resolve_queue: *mut ResolveQueue,
        options: *mut BundleOptions<'static>,
        resolver: *mut Resolver<'static>,
        resolve_results: *mut ResolveResults,
        fs: *mut Fs::FileSystem,
    ) {
        self.log = log;
        self.resolve_queue = resolve_queue;
        self.options = options;
        self.resolver = resolver;
        self.resolve_results = resolve_results;
        self.fs = fs;
    }

    /// Accessor for the `relative_paths_list` singleton. Returns `*mut`
    /// because the contract is a global pointer — fabricating `&'static mut`
    /// here would alias on every call.
    #[inline]
    pub fn relative_paths_list() -> *mut ImportPathsList {
        relative_paths_list_ptr()
    }

    // ── getModKey / getHashedFilename ────────────────────────────────────
    // `ModKey` lives at module scope (`bun_resolver::fs::ModKey`)
    // alongside `RealFS`. `file_path` is typed `PFs::Path` (not `Fs::Path`)
    // so `get_hashed_filename` — whose callers all build `PFs::Path` — can
    // forward directly; only `.text` (a `&[u8]`) is read.
    pub fn get_mod_key(
        &mut self,
        file_path: &PFs::Path<'_>,
        fd: Option<Fd>,
    ) -> crate::Result<Fs::ModKey> {
        // Borrow the cached fd; own the freshly-opened one.
        let _owned: Option<bun_sys::File>;
        let raw_fd = match fd {
            Some(f) => {
                _owned = None;
                f
            }
            None => {
                let f = bun_sys::open_file(file_path.text, bun_sys::OpenFlags::READ_ONLY)?;
                let raw = f.handle();
                _owned = Some(f);
                raw
            }
        };
        let file = bun_sys::File::borrow(&raw_fd);
        Fs::FileSystem::set_max_fd(file.handle().native());
        // spec called `Fs.FileSystem.RealFS.ModKey.generate(&this.fs.fs,
        // path, file)`; both leading args are unread (fs.rs:1386). The inline
        // `bun_resolver::fs::RealFS` (which `self.fs.fs` is) and the full-port
        // `fs_full::RealFS` are distinct types, so route through the
        // RealFS-agnostic `from_file` wrapper added alongside the `ModKey`
        // re-export.
        Ok(Fs::ModKey::from_file(file)?)
    }

    pub fn get_hashed_filename(
        &mut self,
        file_path: &PFs::Path<'_>,
        fd: Option<Fd>,
    ) -> crate::Result<&'static [u8]> {
        if IS_CACHE_ENABLED {
            let hashed = bun_wyhash::hash(file_path.text);
            if let Some(v) = self.hashed_filenames.get(&hashed) {
                return Ok(*v);
            }
        }

        let modkey = self.get_mod_key(file_path, fd)?;
        // `ModKey::hash_name` writes into a caller-supplied buffer (1 KiB)
        // and returns a borrow of it; `dupe` copies the bytes into the
        // process-lifetime interner to satisfy this fn's `'static` return.
        // Note: `IS_CACHE_ENABLED` is a hard `const false` (see above), so
        // the `hashed_filenames` cache never dedups — every call interns a
        // fresh copy for the life of the process. Accepted: the `'static`
        // return contract forces a copy anyway, and the alternative (the old
        // threadlocal slice return) was unsound. `dupe` also aborts on OOM
        // where the old path propagated `?` — consistent with the
        // `bun.handleOom` idiom for interner allocations.
        // Spec passes `file_path.text` even though the param is named
        // `basename`; preserved verbatim.
        let mut hash_name_buf = [0u8; 1024];
        let hash_name = dupe(modkey.hash_name(file_path.text, &mut hash_name_buf)?);

        if IS_CACHE_ENABLED {
            let hashed = bun_wyhash::hash(file_path.text);
            self.hashed_filenames.insert(hashed, hash_name);
        }

        Ok(hash_name)
    }

    /// This modifies the Ast in-place! It resolves import records and
    /// generates paths.
    ///
    /// `import_path_format` is a runtime arg rather than a const generic —
    /// `options::ImportPathFormat` doesn't derive `ConstParamTy`, and the
    /// crate doesn't enable `adt_const_params`. All callers pass a literal,
    /// and the inner `generate_import_path` body is a single `match` either
    /// way, so codegen is equivalent.
    pub fn link<const IGNORE_RUNTIME: bool, const IS_BUN: bool>(
        &mut self,
        file_path: &Fs::Path<'_>,
        result: &mut ParseResult,
        origin: &URL<'_>,
        import_path_format: ImportPathFormat,
    ) -> crate::Result<()> {
        // Copy out the two scalar config values we read so the `&self` borrow
        // from `options()` doesn't overlap later `&mut self` calls
        // (`generate_import_path`, `log_mut`).
        let (target, rewrite_jest_for_tests) = {
            let opts = self.options();
            (opts.target, opts.rewrite_jest_for_tests)
        };

        let source_dir = file_path.source_dir();
        let mut externals: Vec<u32> = Vec::new();
        let mut had_resolve_errors = false;

        let is_deferred = !result.pending_imports.is_empty();

        // Step 1. Resolve imports & requires
        match result.loader {
            options::Loader::Jsx
            | options::Loader::Js
            | options::Loader::Ts
            | options::Loader::Tsx => {
                // Iterate by index, take field-disjoint
                // borrows (`&result.source` + `&mut result.ast.*`) where
                // needed, and hoist `is_pending_import` (which borrows the
                // whole `result`) before any `ast` mut borrow.
                let len = result.ast.import_records.as_slice().len();
                for record_i in 0..len {
                    let record_index = u32::try_from(record_i).expect("int cast");

                    let skip_deferred =
                        IS_BUN && is_deferred && !result.is_pending_import(record_index);

                    // Field-split borrow: `source` ⟂ `ast`.
                    let source = &result.source;
                    let ast = &mut result.ast;
                    let import_record = &mut ast.import_records.as_mut_slice()[record_i];

                    if import_record.flags.contains(ImportRecordFlags::IS_UNUSED) || skip_deferred {
                        continue;
                    }

                    if !IGNORE_RUNTIME {
                        if import_record.path.namespace == b"runtime" {
                            if import_path_format == ImportPathFormat::AbsoluteUrl {
                                import_record.path = PFs::Path::init_with_namespace(
                                    dupe(&origin.join_alloc(b"", b"", b"bun:wrap", b"", b"")?),
                                    b"bun",
                                );
                            } else {
                                import_record.path = self.generate_import_path(
                                    source_dir,
                                    RUNTIME_SOURCE_PATH,
                                    false,
                                    b"bun",
                                    origin,
                                    import_path_format,
                                )?;
                            }

                            ast.runtime_import_record_id = Some(record_index);
                            ast.needs_runtime = true;
                            continue;
                        }
                    }

                    if IS_BUN {
                        if let Some(replacement) = hardcoded_module::get(
                            import_record.path.text,
                            target,
                            hardcoded_module::AliasOptions {
                                rewrite_jest_for_tests,
                            },
                        ) {
                            if replacement.tag == ImportRecordTag::Builtin
                                && import_record.kind.is_common_js()
                            {
                                continue;
                            }
                            import_record.path.text = replacement.path;
                            import_record.tag = replacement.tag;
                            import_record
                                .flags
                                .insert(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS);
                            continue;
                        }
                        if strings::starts_with(import_record.path.text, b"node:") {
                            // if a module is not found here, it is not found at
                            // all so we can just disable it
                            had_resolve_errors = Self::when_module_not_found::<IS_BUN>(
                                self.log_mut(),
                                target,
                                import_record,
                                source,
                            )?;

                            if had_resolve_errors {
                                return Err(crate::Error::ResolveMessage);
                            }
                            continue;
                        }

                        if strings::has_prefix_comptime(import_record.path.text, b"bun:") {
                            import_record.path =
                                PFs::Path::init(&import_record.path.text[b"bun:".len()..]);
                            import_record.path.namespace = b"bun";

                            // don't link bun
                            continue;
                        }

                        // Resolve dynamic imports lazily for perf
                        if import_record.kind == ImportKind::Dynamic {
                            continue;
                        }
                    }

                    if let Some(runner) = self.plugin_runner {
                        let import_record = &mut result.ast.import_records.as_mut_slice()[record_i];
                        if PluginRunner::could_be_plugin(import_record.path.text) {
                            // SAFETY: `plugin_runner` is `Some` only when set
                            // by the owning `Transpiler` to a live JSC-heap
                            // `PluginRunner`; the transpiler is single-threaded
                            // and holds no other borrow of it for the duration
                            // of `on_resolve`, so shared access is sound.
                            let runner = unsafe { &*runner };
                            if let Some(path) = runner.on_resolve(
                                import_record.path.text,
                                file_path.text,
                                self.log_mut(),
                                import_record.range.loc,
                                if IS_BUN {
                                    BunPluginTarget::Bun
                                } else if target == options::Target::Browser {
                                    BunPluginTarget::Browser
                                } else {
                                    BunPluginTarget::Node
                                },
                            )? {
                                import_record.path = self.generate_import_path(
                                    source_dir,
                                    path.text,
                                    false,
                                    path.namespace,
                                    origin,
                                    import_path_format,
                                )?;
                                import_record
                                    .flags
                                    .insert(ImportRecordFlags::PRINT_NAMESPACE_IN_PATH);
                                continue;
                            }
                        }
                    }
                }
            }

            _ => {}
        }
        if had_resolve_errors {
            return Err(crate::Error::ResolveMessage);
        }
        // Vec drop at scope end frees.
        externals.clear();
        let _ = externals;
        Ok(())
    }

    // Takes the disjoint pieces explicitly rather than `&mut self` plus
    // overlapping sub-borrows of `result`.
    fn when_module_not_found<const IS_BUN: bool>(
        log: &mut Log,
        target: BundleTarget,
        import_record: &mut ImportRecord,
        source: &bun_ast::Source,
    ) -> crate::Result<bool> {
        if import_record
            .flags
            .contains(ImportRecordFlags::HANDLES_IMPORT_ERRORS)
        {
            import_record.path.is_disabled = true;
            return Ok(false);
        }

        if IS_BUN {
            // make these happen at runtime
            if import_record.kind == ImportKind::Require
                || import_record.kind == ImportKind::RequireResolve
                || import_record.kind == ImportKind::Dynamic
            {
                return Ok(false);
            }
        }

        if !import_record.path.text.is_empty() && resolver::is_package_path(import_record.path.text)
        {
            if target == BundleTarget::Browser && options::is_node_builtin(import_record.path.text)
            {
                log.add_resolve_error(
                    Some(source),
                    import_record.range,
                    format_args!(
                        "Could not resolve: \"{}\". Try setting --target=\"node\"",
                        bstr::BStr::new(import_record.path.text)
                    ),
                    import_record.path.text,
                    import_record.kind,
                    bun_ast::Error::ModuleNotFound,
                );
            } else {
                log.add_resolve_error(
                    Some(source),
                    import_record.range,
                    format_args!(
                        "Could not resolve: \"{}\". Maybe you need to \"bun install\"?",
                        bstr::BStr::new(import_record.path.text)
                    ),
                    import_record.path.text,
                    import_record.kind,
                    bun_ast::Error::ModuleNotFound,
                );
            }
        } else {
            log.add_resolve_error(
                Some(source),
                import_record.range,
                format_args!(
                    "Could not resolve: \"{}\"",
                    bstr::BStr::new(import_record.path.text)
                ),
                import_record.path.text,
                import_record.kind,
                bun_ast::Error::ModuleNotFound,
            );
        }
        Ok(true)
    }

    pub fn generate_import_path(
        &mut self,
        source_dir: &[u8],
        source_path: &'static [u8],
        use_hashed_name: bool,
        namespace: &'static [u8],
        origin: &URL<'_>,
        import_path_format: ImportPathFormat,
    ) -> crate::Result<PFs::Path<'static>> {
        match import_path_format {
            ImportPathFormat::AbsolutePath => {
                if namespace == b"node" {
                    return Ok(PFs::Path::init_with_namespace(source_path, b"node"));
                }

                if namespace == b"bun" || namespace == b"file" || namespace.is_empty() {
                    // `linker.fs.relative` is a thin wrapper over
                    // `bun.path.relative`; the inline `bun_resolver::fs`
                    // module doesn't expose it yet, so call the path layer
                    // directly. The threadlocal-buffer result must be
                    // dup'd to outlive this call.
                    let relative_name =
                        dupe(bun_paths::resolve_path::relative(source_dir, source_path));
                    Ok(PFs::Path::init_with_pretty(source_path, relative_name))
                } else {
                    Ok(PFs::Path::init_with_namespace(source_path, namespace))
                }
            }
            ImportPathFormat::Relative => {
                let relative_name = bun_paths::resolve_path::relative(source_dir, source_path);

                let pretty: &'static [u8];
                let relative_name_out: &'static [u8];
                if use_hashed_name {
                    let basepath = PFs::Path::init(source_path);
                    let basename = self.get_hashed_filename(&basepath, None)?;
                    let name = basepath.name();
                    let dir = name.dir_with_trailing_slash();
                    let mut _pretty: Vec<u8> =
                        Vec::with_capacity(dir.len() + basename.len() + name.ext.len());
                    _pretty.extend_from_slice(dir);
                    _pretty.extend_from_slice(basename);
                    _pretty.extend_from_slice(name.ext);
                    pretty = intern(_pretty);
                    relative_name_out = dupe(relative_name);
                } else {
                    if relative_name.len() > 1
                        && !(relative_name[0] == SEP || relative_name[0] == b'.')
                    {
                        pretty = dupe(&strings::concat(&[b"./", relative_name]));
                    } else {
                        pretty = dupe(relative_name);
                    }
                    relative_name_out = pretty;
                }

                Ok(PFs::Path::init_with_pretty(pretty, relative_name_out))
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
                        bstr::BStr::new(bun_paths::strings::without_leading_slash(source_path)),
                    )
                    .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
                    Ok(PFs::Path::init(dupe(&buf)))
                } else {
                    let mut absolute_pathname = PFs::PathName::init(source_path);

                    let opts = self.options();
                    if !opts.preserve_extensions {
                        if let Some(ext) = opts.out_extensions.get(absolute_pathname.ext) {
                            absolute_pathname.ext = *ext;
                        }
                    }

                    let top_level_dir = self.fs().top_level_dir;
                    let mut base: &[u8] =
                        bun_paths::resolve_path::relative(top_level_dir, source_path);
                    if let Some(dot) = strings::last_index_of_char(base, b'.') {
                        base = &base[0..dot];
                    }

                    let dirname = bun_core::dirname(base).unwrap_or(b"");

                    let mut basename: &[u8] = bun_paths::basename(base);

                    if use_hashed_name {
                        let basepath = PFs::Path::init(source_path);
                        basename = self.get_hashed_filename(&basepath, None)?;
                    }

                    Ok(PFs::Path::init(dupe(&origin.join_alloc(
                        b"",
                        dirname,
                        basename,
                        absolute_pathname.ext,
                        source_path,
                    )?)))
                }
            }

            ImportPathFormat::PackagePath => unreachable!(),
        }
    }

    pub fn resolve_result_hash_key(&self, resolve_result: &resolver::Result) -> u64 {
        let path = resolve_result.path_const().expect("unreachable");
        let fs = self.fs();
        let mut hash_key = path.text;

        // Shorter hash key is faster to hash
        if strings::starts_with(path.text, fs.top_level_dir) {
            hash_key = &path.text[fs.top_level_dir.len()..];
        }

        bun_wyhash::hash(hash_key)
    }

    pub fn enqueue_resolve_result(
        &mut self,
        resolve_result: resolver::Result,
    ) -> crate::Result<bool> {
        let hash_key = self.resolve_result_hash_key(&resolve_result);

        // `found_existing` is whether the key was already present.
        let found_existing = self.resolve_results_mut().contains_key(&hash_key);
        if !found_existing {
            self.resolve_results_mut().insert(hash_key, ());
            self.resolve_queue_mut().push_back(resolve_result);
        }

        Ok(!found_existing)
    }
}
