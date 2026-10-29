use bun_glob::BunGlobWalker as GlobWalker;
use bun_glob::walk;
use bun_jsc::bindgen::{self, IntoError, JsHeap, JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    JSGlobalObject, JSPromiseStrong, JSValue, Job, JobContext, JsResult, JsThread, SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{self as resolve_path, MAX_PATH_BYTES, platform};
use bun_sys as syscall;

use crate::generated_bindgen::glob::{GlobScanArgument, GlobScanOptions};

/// `Bun.Glob`, declared in `Glob.bind.ts`.
pub(crate) struct Glob {
    /// An ASCII pattern is the JavaScript string's own buffer, not a copy.
    pattern: bun_core::Utf8Bytes<'static>,
    shape: bun_glob::matcher::Shape,
}

pub(crate) enum ScanError<'a> {
    Sys(syscall::Error),
    Runtime(crate::Error),
    CwdTooLong(&'static str),
    NullBytes(&'static str, Box<[u8]>),
    Js(bindgen::Error<'a>),
}
impl<'a> IntoError<'a> for ScanError<'a> {
    #[cold]
    fn into_error(self, heap: &JsHeap<'a>) -> bindgen::Error<'a> {
        match self {
            ScanError::Sys(err) => err.into_error(heap),
            ScanError::Runtime(err) => bun_jsc::JsError::from(err).into_error(heap),
            ScanError::CwdTooLong(fn_name) => heap.error(format_args!(
                "{fn_name}: invalid `cwd`, longer than {MAX_PATH_BYTES} bytes"
            )),
            ScanError::NullBytes(name, value) => heap.error_with_code(
                bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "The argument '{name}' must be a string without null bytes. Received {}",
                    bun_core::fmt::quote(&value)
                ),
            ),
            ScanError::Js(err) => err,
        }
    }
}

struct ScanOpts {
    cwd: Option<Box<[u8]>>,
    dot: bool,
    absolute: bool,
    only_files: bool,
    follow_symlinks: bool,
    error_on_broken_symlinks: bool,
}

impl ScanOpts {
    /// `None` for the empty string, which means "not given".
    fn parse_cwd<'a>(
        cwd: &[u8],
        absolute: bool,
        fn_name: &'static str,
    ) -> Result<Option<Box<[u8]>>, ScanError<'a>> {
        if cwd.is_empty() {
            return Ok(None);
        }
        if cwd.len() > MAX_PATH_BYTES {
            return Err(ScanError::CwdTooLong(fn_name));
        }
        if bun_core::strings::contains_char(cwd, 0) {
            return Err(ScanError::NullBytes("cwd", Box::from(cwd)));
        }
        if resolve_path::Platform::AUTO.is_absolute(cwd) {
            return Ok(Some(Box::from(cwd)));
        }

        let mut path_buf2 = [0u8; MAX_PATH_BYTES * 2];
        let in_executable = bun_core::working_directory_in_executable();
        let cwd_str: Box<[u8]> = if let Some(directory) = in_executable {
            Box::from(join_string_buf::<platform::Auto>(
                &mut path_buf2,
                &[directory, cwd],
            ))
        } else if !absolute {
            Box::from(join_string_buf::<platform::Auto>(&mut path_buf2, &[cwd]))
        } else {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let cwd_len = bun_sys::getcwd(&mut path_buf[..]).map_err(ScanError::Sys)?;
            Box::from(join_string_buf::<platform::Auto>(
                &mut path_buf2,
                &[&path_buf[..cwd_len], cwd],
            ))
        };
        if cwd_str.len() > MAX_PATH_BYTES {
            return Err(ScanError::CwdTooLong(fn_name));
        }
        Ok(Some(cwd_str).filter(|cwd| !cwd.is_empty()))
    }

    fn new<'a>(
        argument: Option<GlobScanArgument<'a>>,
        fn_name: &'static str,
    ) -> Result<ScanOpts, ScanError<'a>> {
        let options = match argument {
            Some(GlobScanArgument::Options(options)) => options,
            Some(GlobScanArgument::Cwd(cwd)) => GlobScanOptions {
                cwd: Some(cwd),
                ..Default::default()
            },
            None => Default::default(),
        };
        Ok(ScanOpts {
            cwd: match options.cwd {
                Some(cwd) => Self::parse_cwd(cwd, options.absolute, fn_name)?,
                None => None,
            }
            .or_else(|| bun_core::working_directory_in_executable().map(Box::from)),
            dot: options.dot,
            absolute: options.absolute,
            only_files: options.only_files,
            follow_symlinks: options.follow_symlinks,
            error_on_broken_symlinks: options.throw_error_on_broken_symlink,
        })
    }
}

/// `bun_glob::walk::Accessor` over the standalone module graph, so `Glob.scan`
/// can walk the embedded `/$bunfs/` tree. Up-tier from the trait on purpose,
/// like `bun_resolver::DirEntryAccessor`.
pub(crate) mod standalone_accessor {
    use bun_core::ZStr;
    use bun_glob::walk::{Accessor, AccessorDirEntry, AccessorDirIter, AccessorHandle};
    use bun_paths::{PathBuffer, Platform, platform, resolve_path};
    use bun_standalone_graph::Graph;
    use bun_sys::{E, Error as SysError, FileKind, Result as Maybe, Stat, Tag};

    pub(crate) struct StandaloneAccessor;

    #[derive(Clone, Copy)]
    pub(crate) struct StandaloneHandle {
        /// The opened directory's `Graph::dir_key` (`'static`: the graph is
        /// the immortal process singleton).
        dir: Option<&'static [u8]>,
    }

    impl AccessorHandle for StandaloneHandle {
        const EMPTY: Self = StandaloneHandle { dir: None };

        fn is_empty(self) -> bool {
            self.dir.is_none()
        }

        fn eql(self, other: Self) -> bool {
            match (self.dir, other.dir) {
                (Some(a), Some(b)) => a == b,
                (None, None) => true,
                _ => false,
            }
        }
    }

    /// `path` resolved against the handle's directory when relative.
    fn resolve<'a>(handle: StandaloneHandle, path: &'a [u8], buf: &'a mut PathBuffer) -> &'a [u8] {
        if Platform::AUTO.is_absolute(path) {
            return path;
        }
        let Some(dir) = handle.dir else { return path };
        resolve_path::join_string_buf::<platform::Auto>(buf, &[dir, path])
    }

    fn open_resolved(path: &[u8]) -> Maybe<StandaloneHandle> {
        let Some(graph) = Graph::get_ref() else {
            return Err(SysError::from_code(E::ENOENT, Tag::open));
        };
        match graph.dir_key(path) {
            Ok(key) => Ok(StandaloneHandle { dir: Some(key) }),
            Err(code) => Err(SysError::from_code(code, Tag::open)),
        }
    }

    pub(crate) struct StandaloneDirEntry {
        name: Box<[u8]>,
        is_dir: bool,
    }

    impl AccessorDirEntry for StandaloneDirEntry {
        fn name_slice(&self) -> &[u8] {
            &self.name
        }
        fn kind(&self) -> FileKind {
            if self.is_dir {
                FileKind::Directory
            } else {
                FileKind::File
            }
        }
    }

    pub(crate) struct StandaloneDirIter {
        entries: std::vec::IntoIter<(Box<[u8]>, bool)>,
    }

    impl AccessorDirIter for StandaloneDirIter {
        type Handle = StandaloneHandle;
        type Entry = StandaloneDirEntry;

        fn next(&mut self) -> Maybe<Option<StandaloneDirEntry>> {
            Ok(self
                .entries
                .next()
                .map(|(name, is_dir)| StandaloneDirEntry { name, is_dir }))
        }

        fn iterate(dir: StandaloneHandle) -> Self {
            // `readdir` only misses for the EMPTY handle: `open_resolved`
            // proved the directory.
            let entries = dir
                .dir
                .and_then(|key| Graph::get_ref()?.readdir(key, false))
                .unwrap_or_default();
            StandaloneDirIter {
                entries: entries.into_iter(),
            }
        }
    }

    impl Accessor for StandaloneAccessor {
        const COUNT_FDS: bool = false;
        type Handle = StandaloneHandle;
        type DirIter = StandaloneDirIter;

        fn open(path: &ZStr) -> Result<Maybe<StandaloneHandle>, bun_core::Error> {
            Ok(open_resolved(path.as_bytes()))
        }

        fn openat(
            handle: StandaloneHandle,
            path: &ZStr,
        ) -> Result<Maybe<StandaloneHandle>, bun_core::Error> {
            // Pooled: a stack `PathBuffer` is ~64 KB on Windows.
            let mut buf = bun_paths::path_buffer_pool::get();
            Ok(open_resolved(resolve(handle, path.as_bytes(), &mut buf)))
        }

        fn statat(handle: StandaloneHandle, path: &ZStr) -> Maybe<Stat> {
            let mut buf = bun_paths::path_buffer_pool::get();
            let resolved = resolve(handle, path.as_bytes(), &mut buf);
            Graph::get_ref()
                .and_then(|graph| {
                    graph
                        .stat(resolved)
                        .or_else(|| graph.source_path_stat(resolved))
                })
                .ok_or_else(|| SysError::from_code(E::ENOENT, Tag::fstatat))
        }

        fn lstatat(handle: StandaloneHandle, path: &ZStr) -> Maybe<Stat> {
            // The embedded graph has no symlinks, so lstat == stat.
            Self::statat(handle, path)
        }

        fn close(_handle: StandaloneHandle) -> Option<SysError> {
            None
        }
    }
}
use standalone_accessor::StandaloneAccessor;

type StandaloneGlobWalker = walk::GlobWalker<StandaloneAccessor, false>;

/// The accessor is picked at init time: embedded-graph walks for a cwd or
/// pattern under the standalone virtual path, syscalls for everything else.
pub(crate) enum AnyGlobWalker {
    Fs(Box<GlobWalker>),
    Standalone(Box<StandaloneGlobWalker>),
}

impl AnyGlobWalker {
    fn walk(&mut self) -> Result<bun_sys::Result<()>, bun_core::Error> {
        match self {
            AnyGlobWalker::Fs(walker) => walker.walk(),
            AnyGlobWalker::Standalone(walker) => walker.walk(),
        }
    }

    fn matched_paths_to_js<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        fn to_js<'a, A: walk::Accessor>(
            walker: &walk::GlobWalker<A, false>,
            heap: &JsHeap<'a>,
        ) -> bindgen::Result<'a, JsLocal<'a>> {
            bindgen::to_js::array(heap, walker.matched_paths.keys(), bindgen::to_js::utf8)
        }
        match self {
            AnyGlobWalker::Fs(walker) => to_js(walker, heap),
            AnyGlobWalker::Standalone(walker) => to_js(walker, heap),
        }
    }
}

/// `Glob.scan()` off the JS thread.
pub(crate) struct WalkTask {
    // Dropping the enum runs `GlobWalker::Drop` then frees the box.
    walker: AnyGlobWalker,
    err: Option<WalkTaskErr>,
}
// SAFETY: the walker owns its pattern/arena; nothing in it is thread-affine.
unsafe impl Send for WalkTask {}

#[derive(bun_jsc::JsAffine)]
pub(crate) struct WalkJs {
    promise: JSPromiseStrong,
}

pub(crate) enum WalkTaskErr {
    Syscall(syscall::Error),
    Unknown(crate::Error),
}

impl WalkTaskErr {
    fn to_js(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            WalkTaskErr::Syscall(err) => Ok(err.to_js(global_this)),
            WalkTaskErr::Unknown(err) => {
                bun_string_jsc::create_utf8_for_js(global_this, err.name().as_bytes())
            }
        }
    }
}

impl JobContext for WalkTask {
    type OffThread = Self;
    type Js = WalkJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        let result = match this.walker.walk() {
            Ok(r) => r,
            Err(err) => {
                this.err = Some(WalkTaskErr::Unknown(err.into()));
                return Some(done);
            }
        };
        if let bun_sys::Result::Err(err) = result {
            this.err = Some(WalkTaskErr::Syscall(err));
        }
        Some(done)
    }

    fn then(this: Self, mut js: WalkJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let promise = js.promise.swap();
        if let Some(err) = &this.err {
            promise.reject_with_async_stack(global, err.to_js(global))?;
            return Ok(());
        }
        let settle = |cx: &mut JsScope<'_>| match this.walker.matched_paths_to_js(&cx.heap) {
            Ok(paths) => promise.resolve(global, paths.to_js()),
            Err(err) => promise.reject(global, Err(err.into_js_error(global))),
        };
        // SAFETY: a job's completion, entered from the event loop with no `JsScope` borrowed.
        unsafe { JsScope::with(global.as_mut_ptr(), settle) }
    }
}

impl Glob {
    fn make_glob_walker<'a>(
        &self,
        argument: Option<GlobScanArgument<'a>>,
        fn_name: &'static str,
    ) -> Result<AnyGlobWalker, ScanError<'a>> {
        if bun_core::strings::contains_char(self.pattern.slice(), 0) {
            return Err(ScanError::NullBytes(
                "pattern",
                Box::from(self.pattern.slice()),
            ));
        }
        let match_opts = ScanOpts::new(argument, fn_name)?;

        fn init_walker<'a, A: walk::Accessor>(
            pattern: &[u8],
            opts: &ScanOpts,
        ) -> Result<Box<walk::GlobWalker<A, false>>, ScanError<'a>> {
            let result = match &opts.cwd {
                Some(cwd) => walk::GlobWalker::<A, false>::init_with_cwd(
                    pattern,
                    cwd,
                    opts.dot,
                    opts.absolute,
                    opts.follow_symlinks,
                    opts.error_on_broken_symlinks,
                    opts.only_files,
                    None,
                ),
                None => walk::GlobWalker::<A, false>::init(
                    pattern,
                    opts.dot,
                    opts.absolute,
                    opts.follow_symlinks,
                    opts.error_on_broken_symlinks,
                    opts.only_files,
                    None,
                ),
            };
            result
                .map_err(|err| ScanError::Runtime(err.into()))?
                .map(Box::new)
                .map_err(ScanError::Sys)
        }

        // Match the walker's root choice (`Iterator::init`): an absolute
        // pattern roots at its literal prefix and ignores the cwd, a relative
        // pattern roots at the cwd. A `/$bunfs/` root walks the graph, as does an embedded directory that is not on disk.
        let pattern_is_absolute = resolve_path::is_absolute(self.pattern.slice())
            || (cfg!(windows) && resolve_path::is_absolute_posix(self.pattern.slice()));
        let in_standalone_graph = bun_standalone_graph::Graph::get_ref().is_some_and(|graph| {
            if pattern_is_absolute {
                let pattern = self.pattern.slice();
                let literal = pattern
                    .iter()
                    .position(|c| b"*?[{".contains(c))
                    .unwrap_or(pattern.len());
                let folder = pattern[..literal]
                    .iter()
                    .rposition(|&c| resolve_path::is_sep_any(c))
                    .unwrap_or(0);
                bun_standalone_graph::is_bun_standalone_file_path(pattern)
                    || graph.owns_directory(&pattern[..folder])
            } else {
                match_opts
                    .cwd
                    .as_deref()
                    .is_some_and(|cwd| graph.owns_directory(cwd))
            }
        });

        if in_standalone_graph {
            return Ok(AnyGlobWalker::Standalone(
                init_walker::<StandaloneAccessor>(self.pattern.slice(), &match_opts)?,
            ));
        }
        Ok(AnyGlobWalker::Fs(init_walker::<walk::SyscallAccessor>(
            self.pattern.slice(),
            &match_opts,
        )?))
    }
}

impl Glob {
    pub(crate) fn constructor(pattern: bun_core::Utf8Bytes<'static>) -> Self {
        Glob {
            shape: bun_glob::matcher::Shape::of(pattern.slice()),
            pattern,
        }
    }

    pub(crate) fn r#match<'a>(&self, str: &'a [u8]) -> bool {
        bun_glob::matcher::match_prepared::<{ cfg!(windows) }>(
            self.pattern.slice(),
            &self.shape,
            str,
            bun_glob::Dots::Match,
        )
        .matches()
    }

    pub(crate) fn scan<'a>(
        &self,
        cx: &mut JsScope<'a>,
        options: Option<GlobScanArgument<'a>>,
    ) -> Result<JsLocal<'a>, ScanError<'a>> {
        let walker = self.make_glob_walker(options, "scan")?;
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        Job::<WalkTask>::schedule(
            &cx.js_thread(),
            WalkTask { walker, err: None },
            WalkJs { promise },
        );
        Ok(JsLocal::new(&cx.heap, value))
    }

    pub(crate) fn scan_sync<'a>(
        &self,
        heap: &JsHeap<'a>,
        options: Option<GlobScanArgument<'a>>,
    ) -> Result<JsLocal<'a>, ScanError<'a>> {
        let mut walker = self.make_glob_walker(options, "scanSync")?;
        walker
            .walk()
            .map_err(|err| ScanError::Runtime(err.into()))?
            .map_err(ScanError::Sys)?;
        walker.matched_paths_to_js(heap).map_err(ScanError::Js)
    }
}
