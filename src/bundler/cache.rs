use bun_alloc::Arena as Bump;
use bun_core::MutableString;
use bun_core::{self, Global, Output, ZStr, feature_flags};
use bun_resolver::fs as fs_mod;
// `cache::Json` lives in `bun_resolver::tsconfig_json::JsonCache`.
use bun_resolver::tsconfig_json::JsonCache as Json;
use bun_sys::{self, Fd};

pub struct Set {
    pub js: JavaScript,
    pub fs: Fs,
    pub json: Json,
}

impl Set {
    /// `arena` is unused — `MutableString::init`/`JavaScript::init` source
    /// from the global heap; param kept for caller compatibility
    /// (`crate::cache::Set::init(alloc)`).
    pub fn init(_arena: &Bump) -> Set {
        Set {
            js: JavaScript::init(),
            fs: Fs {
                shared_buffer: MutableString::init(0).expect("unreachable"),
                macro_shared_buffer: MutableString::init(0).expect("unreachable"),
                use_alternate_source_cache: false,
                stream: false,
            },
            json: Json::init(),
        }
    }
}

bun_core::declare_scope!(fs, visible);

pub struct Fs {
    pub shared_buffer: MutableString,
    pub macro_shared_buffer: MutableString,

    pub use_alternate_source_cache: bool,
    pub stream: bool,
}

impl Default for Fs {
    fn default() -> Self {
        Self {
            shared_buffer: MutableString::init(0).expect("unreachable"),
            macro_shared_buffer: MutableString::init(0).expect("unreachable"),
            use_alternate_source_cache: false,
            stream: false,
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// `Entry`/`Contents`/`ExternalFreeFunction` are defined
// canonically in `bun_resolver::cache` (lower tier) because `Resolver.caches`
// is typed by them and the resolver crate cannot depend on the bundler.
// Re-export here so `crate::cache::Entry` and `bun_resolver::cache::Entry`
// are the SAME nominal type — `ParseTask::get_code_for_parse_task_*` receives
// a resolver-produced `Entry` and hands it to bundler-typed consumers without
// a structural shim. See src/resolver/lib.rs `pub mod cache`.
// ══════════════════════════════════════════════════════════════════════════
pub use bun_resolver::cache::{Contents, Entry, ExternalFreeFunction, JavaScript};

impl Fs {
    // When we are in a macro, the shared buffer may be in use by the in-progress macro.
    // so we have to dynamically switch it out.
    #[inline]
    pub fn shared_buffer(&mut self) -> &mut MutableString {
        if !self.use_alternate_source_cache {
            &mut self.shared_buffer
        } else {
            &mut self.macro_shared_buffer
        }
    }

    /// When we need to suspend/resume something that has pointers into the shared buffer, we need to
    /// switch out the shared buffer so that it is not in use.
    ///
    /// Ownership transfer: the old buffer must NOT be freed here, because the
    /// suspended parse keeps pointers into it (the shared buffer becomes owned
    /// by the AsyncModule struct in the module loader). Plain
    /// field assignment would drop+free the old buffer → use-after-free on resume. So we return
    /// the detached buffer; the caller MUST take ownership of it and keep it alive for as long as
    /// `parse_result.source.contents` may be read.
    pub fn reset_shared_buffer(&mut self, buffer: *const MutableString) -> MutableString {
        if core::ptr::eq(buffer, &raw const self.shared_buffer) {
            core::mem::replace(&mut self.shared_buffer, MutableString::init_empty())
        } else if core::ptr::eq(buffer, &raw const self.macro_shared_buffer) {
            core::mem::replace(&mut self.macro_shared_buffer, MutableString::init_empty())
        } else {
            unreachable!("resetSharedBuffer: invalid buffer");
        }
    }

    // No Drop impl needed beyond the auto-drop of `shared_buffer` /
    // `macro_shared_buffer`.
}

// File reads route through the canonical `bun_resolver::fs::read_file_contents`
// (one body for the stat→grow→pread-loop→BOM-strip path); these methods only
// handle open/seek/close around it.
impl Fs {
    /// Read `path` into the caller's `shared` buffer (HMR / dev-server path).
    pub fn read_file_shared(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &ZStr,
        cached_file_descriptor: Option<Fd>,
        shared: &mut MutableString,
    ) -> Result<Entry, bun_core::Error> {
        let rfs = &_fs.fs;

        let mut owned: Option<bun_sys::File> = None;
        let fd: Fd = if let Some(fd) = cached_file_descriptor {
            // `try handle.seekTo(0)` — rewind a cached fd before re-reading.
            bun_sys::File::borrow(&fd)
                .seek_to(0)
                .map_err(bun_core::Error::from)?;
            fd
        } else {
            let f = bun_sys::open_file_absolute_z(path, bun_sys::OpenFlags::READ_ONLY)
                .map_err(bun_core::Error::from)?;
            let raw = f.handle();
            owned = Some(f);
            raw
        };
        let file_handle = bun_sys::File::borrow(&fd);

        let contents = match fs_mod::read_file_contents(
            file_handle,
            path.as_bytes(),
            true,
            shared,
            self.stream,
        )
        .map(Contents::from)
        {
            Ok(c) => c,
            Err(err) => {
                if cfg!(debug_assertions) {
                    Output::print_error(format_args!(
                        "{}: readFile error -- {}",
                        bstr::BStr::new(path.as_bytes()),
                        bstr::BStr::new(err.name()),
                    ));
                }
                return Err(err);
            }
        };

        let will_close = cached_file_descriptor.is_none() && rfs.need_to_close_files();
        let publish_fd = feature_flags::STORE_FILE_DESCRIPTORS && !will_close;
        if publish_fd {
            if let Some(f) = owned.take() {
                let _ = f.into_raw();
            }
        }
        Ok(Entry {
            contents,
            fd: if publish_fd { fd } else { Fd::INVALID },
        })
    }

    pub fn read_file(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        use_shared_buffer: bool,
        _file_handle: Option<Fd>,
    ) -> Result<Entry, bun_core::Error> {
        self.read_file_with_allocator(_fs, path, dirname_fd, use_shared_buffer, _file_handle, None)
    }

    /// `use_shared_buffer` is taken at runtime — the live
    /// callers (`ParseTask::get_code_for_parse_task_without_plugins`,
    /// `Transpiler::parse`) pass a value computed from runtime state, and the
    /// resolver's `FsCache` forward-decl already pinned this shape.
    /// PERF: re-monomorphize once both callers stabilize.
    ///
    /// `arena`: when
    /// `!use_shared_buffer && arena.is_some()` the file body is read straight
    /// into `arena` (`Contents::Arena`), so the bytes are bulk-freed by
    /// `mi_heap_destroy` when the per-call `MimallocArena` (the per-job arena
    /// from `RuntimeTranspilerStore` / `ParseTask`) drops — instead of round-
    /// tripping through the worker thread's *default* mimalloc heap, which is
    /// never destroyed and retains the fresh page for the process lifetime.
    /// `None` keeps the global-heap `Contents::Owned(Vec<u8>)` path.
    pub fn read_file_with_allocator(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        use_shared_buffer: bool,
        _file_handle: Option<Fd>,
        arena: Option<&bun_alloc::Arena>,
    ) -> Result<Entry, bun_core::Error> {
        let rfs = &_fs.fs;

        // Single let-expression assigning `file_handle` on each branch, avoiding
        // `mem::zeroed()` on a type that may have niche (NonZero) fields.
        let mut _owned: Option<bun_sys::File> = None;
        let will_close: bool;
        let fd: Fd = if let Some(f) = _file_handle {
            bun_sys::File::borrow(&f)
                .seek_to(0)
                .map_err(bun_core::Error::from)?;
            _owned = None;
            will_close = false;
            f
        } else {
            let opened = if feature_flags::STORE_FILE_DESCRIPTORS && dirname_fd.is_valid() {
                match bun_sys::File::openat(
                    dirname_fd,
                    bun_paths::basename(path),
                    bun_sys::O::RDONLY,
                    0,
                ) {
                    Ok(f) => f,
                    Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                        let handle = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                            .map_err(bun_core::Error::from)?;
                        bun_core::pretty_errorln!(
                            "<r><d>Internal error: directory mismatch for directory \"{}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                            bstr::BStr::new(path),
                            dirname_fd,
                        );
                        handle
                    }
                    Err(err) => return Err(err.into()),
                }
            } else {
                bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(bun_core::Error::from)?
            };
            let raw = opened.handle();
            will_close = rfs.need_to_close_files();
            _owned = Some(opened);
            raw
        };
        let file_handle = bun_sys::File::borrow(&fd);

        #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
        bun_core::scoped_log!(
            fs,
            "openat({}, {}) = {}",
            dirname_fd,
            bstr::BStr::new(path),
            fd
        );

        // Borrowck: capture `stream` scalar before borrowing
        // the shared buffer.
        let stream = self.stream;

        let contents = match (use_shared_buffer, arena) {
            // Read straight into the per-call arena so the source bytes are
            // reclaimed by `mi_heap_destroy` instead of pinning a fresh page in
            // the worker thread's default heap (one `mi_malloc` + `munmap` pair
            // per transpiled module → one bump allocation in a wholesale-reset
            // heap).
            (false, Some(arena)) => {
                match fs_mod::read_file_contents_in_arena(file_handle, path, arena) {
                    Ok((_, 0)) => Contents::Empty,
                    Ok((ptr, len)) => Contents::Arena { ptr, len },
                    Err(err) => {
                        if cfg!(debug_assertions) {
                            Output::print_error(format_args!(
                                "{}: readFile error -- {}",
                                bstr::BStr::new(path),
                                bstr::BStr::new(err.name()),
                            ));
                        }
                        return Err(err);
                    }
                }
            }
            _ => {
                let shared = self.shared_buffer();
                match fs_mod::read_file_contents(
                    file_handle,
                    path,
                    use_shared_buffer,
                    shared,
                    stream,
                )
                .map(Contents::from)
                {
                    Ok(c) => c,
                    Err(err) => {
                        if cfg!(debug_assertions) {
                            Output::print_error(format_args!(
                                "{}: readFile error -- {}",
                                bstr::BStr::new(path),
                                bstr::BStr::new(err.name()),
                            ));
                        }
                        return Err(err);
                    }
                }
            }
        };

        let publish_fd = feature_flags::STORE_FILE_DESCRIPTORS && !will_close;
        if publish_fd {
            if let Some(f) = _owned.take() {
                let _ = f.into_raw();
            }
        }
        Ok(Entry {
            contents,
            fd: if publish_fd { fd } else { Fd::INVALID },
        })
    }
}

pub struct Css {}

pub struct CssEntry {}

pub struct CssResult {
    pub ok: bool,
    pub value: (),
}

impl Css {
    pub fn parse(
        &mut self,
        _log: &mut bun_ast::Log,
        _source: bun_ast::Source,
    ) -> Result<CssResult, bun_core::Error> {
        Global::notimpl();
    }
}
