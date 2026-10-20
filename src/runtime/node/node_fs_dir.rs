//! The native directory stream behind `fs.Dir`: the directories that one `fs.opendir` holds open, read a bounded batch at a time.

use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use bun_core::String as BunString;
use bun_event_loop::{ContextId, Task, Taskable, task_tag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_paths::resolve_path::{self, platform};
use bun_sys::FdExt as _;
use bun_sys::{self as sys, E, Fd, Maybe};
use bun_threading::Guarded;

use super::dir_iterator as DirIterator;
use super::fs::{NodeFS, ReaddirEntry, ret};
use super::types::{Buffer, Dirent, Encoding};

/// The JS wrapper of a [`Stream`]. It has no methods: `fs.Dir` hands it to the `node:fs` binding.
#[bun_jsc::JsClass(no_constructor)]
pub(crate) struct DirStream {
    stream: Arc<Stream>,
}

impl DirStream {
    pub(crate) fn create(stream: Arc<Stream>, global: &JSGlobalObject) -> JSValue {
        Self::to_js_boxed(Box::new(DirStream { stream }), global)
    }

    /// The stream of a `DirStream` wrapper, or `None` for any other value.
    pub(crate) fn stream_from_js(value: JSValue) -> Option<Arc<Stream>> {
        let this = <Self as bun_jsc::JsClass>::from_js(value)?;
        // SAFETY: `from_js` returned the live payload of a `DirStream` cell,
        // which `value` keeps alive for this call.
        Some(Arc::clone(unsafe { &(*this).stream }))
    }

    /// Codegen `finalize: true`. The directories close with the last reference: this one, unless a read is on the work pool.
    #[allow(clippy::boxed_local)] // codegen's signature
    pub(crate) fn finalize(self: Box<Self>) {
        if !self.stream.close_requested.load(Ordering::SeqCst) {
            DirStreamCollected::schedule();
        }
    }

    /// Codegen `estimatedSize: true` entry point. Any thread.
    pub(crate) fn estimated_size(&self) -> usize {
        size_of::<Self>() + size_of::<Stream>() + self.stream.native_bytes.load(Ordering::SeqCst)
    }
}

/// node's warning for a `DirStream` that was collected while open. `Task::ptr` is unused.
pub(crate) struct DirStreamCollected;

impl Taskable for DirStreamCollected {
    const TAG: bun_event_loop::TaskTag = task_tag::DirStreamCollected;
    /// Nothing is owned.
    unsafe fn release_unrun(_: *mut Self) {}
    /// A warning of the process, for the listeners of the realm.
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

impl DirStreamCollected {
    /// GC sweep, JS thread: script cannot run here, so the warning is a task.
    fn schedule() {
        let vm = VirtualMachine::get();
        if vm.event_loop_ref().is_closed_for_tasks() {
            return;
        }
        vm.event_loop_ref()
            .enqueue_task(Task::init(core::ptr::null_mut::<DirStreamCollected>()));
    }

    pub(crate) fn run(global: &JSGlobalObject) -> JsResult<()> {
        let warning =
            BunString::static_("Closing directory handle on garbage collection").to_js(global)?;
        global.emit_warning(
            warning,
            JSValue::UNDEFINED,
            JSValue::UNDEFINED,
            JSValue::UNDEFINED,
        )
    }
}

/// One open directory stream, shared by its JS wrapper and by the reads and closes on the work pool.
pub(crate) struct Stream {
    walk: Guarded<Walk>,
    /// What the walk holds besides `size_of::<Stream>()`, for the GC.
    native_bytes: AtomicUsize,
    /// `Dir` asked for the close. A stream collected without that warns.
    close_requested: AtomicBool,
}

// SAFETY: a `Stream` holds no VM or JS state: descriptors, iterator buffers
// and owned bytes (the Windows iterator's raw name filter is never set). The
// walk is reached only through its lock.
unsafe impl Send for Stream {}
// SAFETY: see `Send`.
unsafe impl Sync for Stream {}

struct Walk {
    /// The entry type, as `readdir` chooses it.
    tag: ret::ReaddirTag,
    encoding: Encoding,
    recursive: bool,
    /// `None` once closed.
    root: Option<Level>,
    root_ended: bool,
    /// The open child directories of a recursive walk. The newest is the last one, and the next one to read.
    children: Vec<Level>,
    /// The result of the next read: a child that could not be opened, or a failure of the OS after the read had entries.
    pending: Option<sys::Error>,
    bytes: usize,
}

/// One directory of the walk.
struct Level {
    source: Source,
    /// `Dirent.parentPath` of its entries.
    path: Box<[u8]>,
    /// Its path from the root, for entries that are not Dirents: their name is their path from the root, as in a recursive `readdir`.
    relative: Box<[u8]>,
}

enum Source {
    Os {
        fd: Fd,
        /// Made at the first read.
        iter: Option<LevelIter>,
    },
    /// A `/$bunfs/` directory of a compiled binary. There is no descriptor.
    Graph {
        /// The path that the graph looks up.
        lookup: Box<[u8]>,
        /// `Graph::readdir` of `lookup`, made at the first read. A recursive listing has the whole tree.
        list: Option<std::vec::IntoIter<(Box<[u8]>, bool)>>,
    },
}

impl Drop for Source {
    fn drop(&mut self) {
        if let Source::Os { fd, .. } = self {
            fd.close();
        }
    }
}

enum LevelIter {
    Narrow(Box<DirIterator::WrappedIterator>),
    /// String names come from the UTF-16 iterator, as in `fs.readdir`.
    #[cfg(windows)]
    Wide(Box<DirIterator::WrappedIteratorW>),
}

impl LevelIter {
    fn new<T: ReaddirEntry>(fd: Fd) -> Self {
        #[cfg(windows)]
        if T::IS_U16 {
            return LevelIter::Wide(Box::new(DirIterator::WrappedIteratorW::init(fd)));
        }
        LevelIter::Narrow(Box::new(DirIterator::WrappedIterator::init(fd)))
    }

    fn bytes(&self) -> usize {
        match self {
            LevelIter::Narrow(_) => size_of::<DirIterator::WrappedIterator>(),
            #[cfg(windows)]
            LevelIter::Wide(_) => size_of::<DirIterator::WrappedIteratorW>(),
        }
    }
}

/// How a level's read stopped.
enum Stop {
    /// It gave the entries that were asked for.
    Filled,
    /// The directory has no more entries.
    Ended,
    /// A child directory could not be opened. Its entry is not reported, as in node.
    ChildFailed(sys::Error),
}

/// What a level's read needs from the walk.
struct TakeCx<'a> {
    encoding: Encoding,
    recursive: bool,
    /// How many more directories this read opens.
    may_open: &'a mut u32,
    /// Children this read opened.
    opened: &'a mut Vec<Level>,
}

/// The entries of one read.
pub(crate) struct DirBatch {
    entries: ret::Readdir,
    len: u32,
    /// The stream has no more entries after these.
    ended: bool,
}

impl DirBatch {
    /// The array that `readdir` makes of the entries. A trailing `null` says that the stream ended.
    pub(crate) fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = self.entries.to_js(global)?;
        if self.ended {
            // An own element. `push` would call an index setter that a script put on `Array.prototype`.
            array.put_index(global, self.len, JSValue::NULL)?;
        }
        Ok(array)
    }
}

impl Stream {
    /// `path` is the caller's: the errors and `Dirent.parentPath` report it as given, as node does. `path_z` is the one the OS opens.
    pub(crate) fn open(
        path: &[u8],
        path_z: &bun_core::ZStr,
        tag: ret::ReaddirTag,
        encoding: Encoding,
        recursive: bool,
    ) -> Maybe<Arc<Stream>> {
        let source = match Source::open_root(path_z) {
            Ok(source) => source,
            Err(err) => return Err(open_error(&err, path)),
        };
        let root = Level {
            source,
            path: Box::from(path),
            relative: Box::default(),
        };
        let bytes = root.bytes();
        Ok(Arc::new(Stream {
            walk: Guarded::new(Walk {
                tag,
                encoding,
                recursive,
                root: Some(root),
                root_ended: false,
                children: Vec::new(),
                pending: None,
                bytes,
            }),
            native_bytes: AtomicUsize::new(bytes),
            close_requested: AtomicBool::new(false),
        }))
    }

    /// At most `limit` entries. A recursive walk gives up to `Walk::READ_AHEAD`, and opens at most `Walk::OPEN_AHEAD` directories.
    pub(crate) fn read(&self, limit: u32) -> Maybe<DirBatch> {
        let mut walk = self.walk.lock();
        let result = match walk.tag {
            ret::ReaddirTag::WithFileTypes => walk.read_batch::<Dirent>(limit),
            ret::ReaddirTag::Buffers => walk.read_batch::<Buffer>(limit),
            ret::ReaddirTag::Files => unreachable!("`fs.opendir` asks for file types"),
        };
        self.native_bytes.store(walk.bytes, Ordering::SeqCst);
        result
    }

    /// JS thread, when `Dir` asks for the close. `close` can run later, on the work pool.
    pub(crate) fn close_requested(&self) {
        self.close_requested.store(true, Ordering::SeqCst);
    }

    /// Closes every directory of the walk.
    pub(crate) fn close(&self) {
        let mut walk = self.walk.lock();
        walk.root = None;
        walk.children.clear();
        walk.pending = None;
        walk.bytes = 0;
        self.native_bytes.store(0, Ordering::SeqCst);
    }
}

impl Walk {
    /// The most entries that one read of a recursive walk lists: about what one 8 KB read of the OS holds.
    const READ_AHEAD: u32 = 256;
    /// The most directories that one read opens: the walk then holds about depth x 32 descriptors for any `bufferSize`.
    const OPEN_AHEAD: u32 = 32;

    fn read_batch<T: ReaddirEntry>(&mut self, limit: u32) -> Maybe<DirBatch> {
        if self.root.is_none() {
            return Err(sys::Error::from_code(E::EBADF, sys::Tag::scandir));
        }
        if let Some(err) = self.pending.take() {
            return Err(err);
        }

        let limit = limit.max(1);
        // A walk that lists `limit` entries in each read is one work-pool round trip for each of them.
        let most = if self.recursive {
            limit.max(Self::READ_AHEAD)
        } else {
            limit
        } as usize;
        let mut out: Vec<T> = Vec::with_capacity((limit as usize).min(64));
        let mut opened: Vec<Level> = Vec::new();
        // Depth first, and few directories opened in one read: the open directories follow the depth of the tree, not its width.
        let mut may_open = limit.min(Self::OPEN_AHEAD);
        // `children[..older]` are from earlier reads. This read does not read a child that it opens: node returns a child's entry before it reads the child.
        let mut older = self.children.len();

        while out.len() < most && may_open > 0 {
            let level = match older.checked_sub(1) {
                Some(newest) => &mut self.children[newest],
                None if self.root_ended => break,
                None => self.root.as_mut().expect("checked above"),
            };
            let bytes_before = level.bytes();
            let room = most - out.len();
            let stop = level.take::<T>(
                &mut out,
                room,
                &mut TakeCx {
                    encoding: self.encoding,
                    recursive: self.recursive,
                    may_open: &mut may_open,
                    opened: &mut opened,
                },
            );
            self.bytes = self.bytes - bytes_before + level.bytes();
            // A read that failed ends its directory: the next read must not fail the same way forever.
            if matches!(stop, Err(_) | Ok(Stop::Ended)) {
                if older > 0 {
                    older -= 1;
                    self.bytes -= self.children.remove(older).bytes();
                } else {
                    self.root_ended = true;
                }
            }
            for child in opened.drain(..) {
                self.bytes += child.bytes();
                self.children.push(child);
            }

            match stop {
                Ok(Stop::Filled | Stop::Ended) => {}
                Ok(Stop::ChildFailed(err)) | Err(err) => {
                    if out.is_empty() {
                        return Err(err);
                    }
                    self.pending = Some(err);
                    break;
                }
            }
        }

        Ok(DirBatch {
            len: out.len() as u32,
            entries: T::into_readdir(out),
            ended: self.pending.is_none() && self.root_ended && self.children.is_empty(),
        })
    }
}

impl Level {
    fn bytes(&self) -> usize {
        size_of::<Self>()
            + self.path.len()
            + self.relative.len()
            + match &self.source {
                Source::Os { iter, .. } => iter.as_ref().map_or(0, LevelIter::bytes),
                Source::Graph { lookup, list } => {
                    lookup.len() + list.as_ref().map_or(0, |list| size_of_val(list.as_slice()))
                }
            }
    }

    /// Appends at most `want` entries of this directory to `out`, with the listing loop of `readdir`.
    fn take<T: ReaddirEntry>(
        &mut self,
        out: &mut Vec<T>,
        want: usize,
        cx: &mut TakeCx<'_>,
    ) -> Maybe<Stop> {
        let path: &[u8] = &self.path;
        let relative: &[u8] = &self.relative;
        let (encoding, recursive) = (cx.encoding, cx.recursive);
        match &mut self.source {
            Source::Os { fd, iter } => {
                let fd = *fd;
                let end = out.len() + want;
                let mut failed = None;
                // node reports the path as it was given, in every encoding of the names.
                let mut parent_path = BunString::DEAD;
                let mut scratch: Vec<u8> = Vec::new();
                let ended = match iter.get_or_insert_with(|| LevelIter::new::<T>(fd)) {
                    LevelIter::Narrow(iter) => {
                        NodeFS::list_entries(iter, fd, T::IS_DIRENT || recursive, |name, kind| {
                            let name_bytes = name.as_bytes();
                            if recursive && kind == sys::FileKind::Directory {
                                let child = open_child(fd, name);
                                if let Err(err) =
                                    cx.queue_child::<T>(path, relative, name_bytes, child)
                                {
                                    failed = Some(err);
                                    return false;
                                }
                            }
                            if T::IS_DIRENT {
                                if parent_path.is_empty() {
                                    parent_path = BunString::clone_utf8(path);
                                }
                                T::append_entry(out, name_bytes, &parent_path, kind, encoding);
                            } else {
                                let name_from_root =
                                    join_relative(&mut scratch, relative, name_bytes);
                                T::append_entry_recursive(
                                    out,
                                    name_bytes,
                                    name_from_root,
                                    &parent_path,
                                    kind,
                                    encoding,
                                    true,
                                );
                            }
                            out.len() < end && *cx.may_open > 0
                        })
                    }
                    #[cfg(windows)]
                    LevelIter::Wide(iter) => {
                        let mut re_encoding_buffer =
                            (encoding != Encoding::Utf8).then(bun_paths::path_buffer_pool::get);
                        NodeFS::list_entries_u16(iter, |name, kind| {
                            if recursive && kind == sys::FileKind::Directory {
                                let child = sys::open_dir_at_windows(fd, name, CHILD_OPEN_OPTIONS);
                                // The child's path has the name as UTF-8, which is what libuv gives.
                                let mut utf8 = bun_paths::path_buffer_pool::get();
                                let utf8 =
                                    bun_paths::string_paths::from_w_path(&mut utf8[..], name);
                                if let Err(err) =
                                    cx.queue_child::<T>(path, relative, utf8.as_bytes(), child)
                                {
                                    failed = Some(err);
                                    return false;
                                }
                            }
                            if parent_path.is_empty() {
                                parent_path = BunString::clone_utf8(path);
                            }
                            T::append_entry_w(
                                out,
                                name,
                                &parent_path,
                                kind,
                                encoding,
                                re_encoding_buffer.as_deref_mut(),
                            );
                            out.len() < end && *cx.may_open > 0
                        })
                    }
                };
                match ended {
                    // The directory was removed. `readdir(3)`, and so node's `Dir`, reports the end.
                    Err(err) if err.get_errno() == E::ENOENT => Ok(Stop::Ended),
                    Err(err) => Err(sys::Error {
                        errno: err.errno,
                        syscall: sys::Tag::scandir,
                        path: Box::from(path),
                        ..Default::default()
                    }),
                    Ok(true) => Ok(Stop::Ended),
                    Ok(false) => Ok(failed.map_or(Stop::Filled, Stop::ChildFailed)),
                }
            }
            Source::Graph { lookup, list } => {
                let list = list.get_or_insert_with(|| {
                    bun_standalone_graph::Graph::get_ref()
                        .and_then(|graph| graph.readdir(lookup, recursive))
                        .unwrap_or_default()
                        .into_iter()
                });
                NodeFS::append_standalone_entries::<T>(
                    list.by_ref().take(want),
                    path,
                    recursive,
                    encoding,
                    true,
                    out,
                );
                Ok(if list.as_slice().is_empty() {
                    Stop::Ended
                } else {
                    Stop::Filled
                })
            }
        }
    }
}

impl TakeCx<'_> {
    /// Queues `name`, a child directory of `parent`, for a later read. `Err`: `opened` says that it cannot be read.
    fn queue_child<T: ReaddirEntry>(
        &mut self,
        parent: &[u8],
        parent_relative: &[u8],
        name: &[u8],
        opened: Maybe<Fd>,
    ) -> Result<(), sys::Error> {
        // The path is what node's `path.join(dirent.parentPath, dirent.name)` gives.
        let mut spill = Vec::new();
        let path: Box<[u8]> = Box::from(resolve_path::join_spill::<platform::Auto>(
            &mut spill,
            &[parent, name],
        ));
        match opened {
            Ok(fd) => {
                let relative = if T::IS_DIRENT {
                    Box::default()
                } else {
                    Box::from(join_relative(&mut Vec::new(), parent_relative, name))
                };
                self.opened.push(Level {
                    source: Source::Os { fd, iter: None },
                    path,
                    relative,
                });
                *self.may_open -= 1;
                Ok(())
            }
            Err(err) => Err(open_error(&err, &path)),
        }
    }
}

/// `name` under `relative`, a path from the root of the walk: what a recursive `readdir` reports as the name.
fn join_relative<'a>(scratch: &'a mut Vec<u8>, relative: &[u8], name: &'a [u8]) -> &'a [u8] {
    if relative.is_empty() {
        return name;
    }
    scratch.clear();
    scratch.extend_from_slice(relative);
    scratch.push(bun_paths::SEP);
    scratch.extend_from_slice(name);
    scratch
}

impl Source {
    fn open_root(path_z: &bun_core::ZStr) -> Maybe<Source> {
        if let Some(graph) = bun_standalone_graph::Graph::get_ref() {
            if bun_standalone_graph::is_bun_standalone_file_path(path_z.as_bytes()) {
                return match graph.dir_key(path_z.as_bytes()) {
                    Ok(_) => Ok(Source::Graph {
                        lookup: Box::from(path_z.as_bytes()),
                        list: None,
                    }),
                    Err(errno) => Err(sys::Error::from_code(errno, sys::Tag::opendir)),
                };
            }
        }
        #[cfg(not(windows))]
        let fd = sys::open(
            path_z,
            sys::O::DIRECTORY | sys::O::RDONLY | sys::O::CLOEXEC,
            0,
        )?;
        #[cfg(windows)]
        let fd = sys::open_dir_at_windows_a(
            Fd::cwd(),
            path_z.as_bytes(),
            sys::WindowsOpenDirOptions {
                iterable: true,
                ..Default::default()
            },
        )?;
        Ok(Source::Os { fd, iter: None })
    }
}

/// Opens child `name` of the open directory `parent`, never through a symbolic link. node opens it by path: a renamed ancestor or a name that is not UTF-8 is ENOENT there.
#[cfg(not(windows))]
fn open_child(parent: Fd, name: &bun_core::ZStr) -> Maybe<Fd> {
    sys::openat(
        parent,
        name,
        sys::O::DIRECTORY | sys::O::RDONLY | sys::O::CLOEXEC | sys::O::NOFOLLOW,
        0,
    )
}

#[cfg(windows)]
fn open_child(parent: Fd, name: &bun_core::ZStr) -> Maybe<Fd> {
    sys::open_dir_at_windows_a(parent, name.as_bytes(), CHILD_OPEN_OPTIONS)
}

#[cfg(windows)]
const CHILD_OPEN_OPTIONS: sys::WindowsOpenDirOptions = sys::WindowsOpenDirOptions {
    iterable: true,
    no_follow: true,
    can_rename_or_delete: false,
    op: sys::WindowsOpenDirOp::OnlyOpen,
};

/// An `opendir` error with its path. The error of node's `opendirSync` has no path.
fn open_error(err: &sys::Error, path: &[u8]) -> sys::Error {
    sys::Error {
        errno: err.errno,
        syscall: sys::Tag::opendir,
        path: Box::from(path),
        ..Default::default()
    }
}
