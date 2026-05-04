// Portions of this file are derived from works under the MIT License:
//
// Copyright (c) 2023 Devon Govett
// Copyright (c) 2023 Stephen Gregoratto
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

use core::ffi::c_int;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, AutoBitSet};
use bun_core::Error;
use bun_fs::FileSystem as FS;
use bun_fs::file_system::DirEntry;
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self as resolve_path, PathBuffer, MAX_PATH_BYTES};
use bun_runtime::node::dir_iterator as DirIterator;
use bun_str::strings::{self, UnsignedCodepointIterator as CodepointIterator};
use bun_str::{String as BunString, ZStr};
use bun_sys::{self as Syscall, Fd, Result as Maybe, Stat, SysError, E, O, S};

#[cfg(windows)]
const IS_WINDOWS: bool = true;
#[cfg(not(windows))]
const IS_WINDOWS: bool = false;

// const Codepoint = u32;

declare_scope!(Glob, visible);
macro_rules! log {
    ($($arg:tt)*) => { scoped_log!(Glob, $($arg)*) };
}

type Cursor = <CodepointIterator as strings::CodepointIteratorTrait>::Cursor;
type Codepoint = u32; // CodepointIterator::Cursor::CodePointType

#[derive(Clone, Copy, Default)]
struct CursorState {
    cursor: Cursor,
    // The index in terms of codepoints
    // cp_idx: usize,
}

impl CursorState {
    fn init(iterator: &CodepointIterator) -> CursorState {
        let mut this_cursor = Cursor::default();
        let _ = iterator.next(&mut this_cursor);
        CursorState {
            // cp_idx: 0,
            cursor: this_cursor,
        }
    }

    /// Return cursor pos of next codepoint without modifying the current.
    ///
    /// NOTE: If there is no next codepoint (cursor is at the last one), then
    /// the returned cursor will have `c` as zero value and `i` will be >=
    /// sourceBytes.len
    fn peek(&self, iterator: &CodepointIterator) -> CursorState {
        let mut cpy = *self;
        // If outside of bounds
        if !iterator.next(&mut cpy.cursor) {
            // This will make `i >= sourceBytes.len`
            cpy.cursor.i += u32::from(cpy.cursor.width);
            cpy.cursor.width = 1;
            cpy.cursor.c = CodepointIterator::ZERO_VALUE;
        }
        // cpy.cp_idx += 1;
        cpy
    }

    fn bump(&mut self, iterator: &CodepointIterator) {
        if !iterator.next(&mut self.cursor) {
            self.cursor.i += u32::from(self.cursor.width);
            self.cursor.width = 1;
            self.cursor.c = CodepointIterator::ZERO_VALUE;
        }
        // self.cp_idx += 1;
    }

    #[inline]
    fn manual_bump_ascii(&mut self, i: u32, next_cp: Codepoint) {
        self.cursor.i += i;
        self.cursor.c = next_cp;
        self.cursor.width = 1;
    }

    #[inline]
    fn manual_peek_ascii(&self, i: u32, next_cp: Codepoint) -> CursorState {
        CursorState {
            cursor: Cursor {
                i: self.cursor.i + i,
                c: next_cp as _, // @truncate
                width: 1,
            },
        }
    }
}

fn dummy_filter_true(_val: &[u8]) -> bool {
    true
}

fn dummy_filter_false(_val: &[u8]) -> bool {
    false
}

#[cfg(windows)]
pub fn statat_windows(fd: Fd, path: &ZStr) -> Maybe<Stat> {
    let mut buf = PathBuffer::uninit();
    let dir = match Syscall::get_fd_path(fd, &mut buf) {
        Maybe::Err(e) => return Maybe::Err(e),
        Maybe::Ok(s) => s,
    };
    let parts: &[&[u8]] = &[&dir[0..dir.len()], path.as_bytes()];
    let statpath = resolve_path::join_z_buf(&mut buf, parts, resolve_path::Platform::Auto);
    Syscall::stat(statpath)
}

#[cfg(not(windows))]
pub fn statat_windows(_fd: Fd, _path: &ZStr) -> Maybe<Stat> {
    unreachable!("oi don't use this");
}

// ─────────────────────────────────────────────────────────────────────────────
// Accessor trait — Zig passed `comptime Accessor: type` and duck-typed on it.
// ─────────────────────────────────────────────────────────────────────────────

pub trait AccessorHandle: Copy {
    const EMPTY: Self;
    fn is_empty(self) -> bool;
    fn eql(self, other: Self) -> bool;
}

pub trait Accessor {
    const COUNT_FDS: bool;
    type Handle: AccessorHandle;
    type DirIter: AccessorDirIter<Handle = Self::Handle>;

    fn open(path: &ZStr) -> Result<Maybe<Self::Handle>, Error>;
    fn openat(handle: Self::Handle, path: &ZStr) -> Result<Maybe<Self::Handle>, Error>;
    fn statat(handle: Self::Handle, path: &ZStr) -> Maybe<Stat>;
    /// Like statat but does not follow symlinks.
    fn lstatat(handle: Self::Handle, path: &ZStr) -> Maybe<Stat>;
    fn close(handle: Self::Handle) -> Option<SysError>;
    fn getcwd(path_buf: &mut PathBuffer) -> Maybe<&[u8]>;
}

pub trait AccessorDirIter {
    type Handle;
    type Entry: AccessorDirEntry;
    fn next(&mut self) -> Maybe<Option<Self::Entry>>;
    fn iterate(dir: Self::Handle) -> Self;
    #[allow(unused_variables)]
    fn set_name_filter(&mut self, filter: Option<&[u16]>) {
        // default: no-op (only SyscallAccessor on Windows uses this)
    }
}

pub trait AccessorDirEntry {
    fn name_slice(&self) -> &[u8];
    fn kind(&self) -> bun_sys::FileKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// SyscallAccessor
// ─────────────────────────────────────────────────────────────────────────────

pub struct SyscallAccessor;

#[derive(Clone, Copy)]
pub struct SyscallHandle {
    pub value: Fd,
}

impl AccessorHandle for SyscallHandle {
    const EMPTY: Self = SyscallHandle { value: Fd::INVALID };

    fn is_empty(self) -> bool {
        !self.value.is_valid()
    }

    fn eql(self, other: Self) -> bool {
        self.value == other.value
    }
}

pub struct SyscallDirIter {
    value: DirIterator::WrappedIterator,
}

impl AccessorDirIter for SyscallDirIter {
    type Handle = SyscallHandle;
    type Entry = DirIterator::IteratorResult;

    #[inline]
    fn next(&mut self) -> Maybe<Option<DirIterator::IteratorResult>> {
        self.value.next()
    }

    #[inline]
    fn iterate(dir: SyscallHandle) -> Self {
        SyscallDirIter {
            value: DirIterator::WrappedIterator::init(dir.value),
        }
    }

    #[inline]
    fn set_name_filter(&mut self, filter: Option<&[u16]>) {
        self.value.set_name_filter(filter);
    }
}

impl Accessor for SyscallAccessor {
    const COUNT_FDS: bool = true;
    type Handle = SyscallHandle;
    type DirIter = SyscallDirIter;

    fn open(path: &ZStr) -> Result<Maybe<SyscallHandle>, Error> {
        Ok(match Syscall::open(path, O::DIRECTORY | O::RDONLY, 0) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(fd) => Maybe::Ok(SyscallHandle { value: fd }),
        })
    }

    fn statat(handle: SyscallHandle, path: &ZStr) -> Maybe<Stat> {
        #[cfg(windows)]
        {
            return statat_windows(handle.value, path);
        }
        #[cfg(not(windows))]
        match Syscall::fstatat(handle.value, path) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(s) => Maybe::Ok(s),
        }
    }

    /// Like statat but does not follow symlinks.
    fn lstatat(handle: SyscallHandle, path: &ZStr) -> Maybe<Stat> {
        #[cfg(windows)]
        {
            return statat_windows(handle.value, path);
        }
        #[cfg(not(windows))]
        Syscall::lstatat(handle.value, path)
    }

    fn openat(handle: SyscallHandle, path: &ZStr) -> Result<Maybe<SyscallHandle>, Error> {
        Ok(
            match Syscall::openat(handle.value, path, O::DIRECTORY | O::RDONLY, 0) {
                Maybe::Err(err) => Maybe::Err(err),
                Maybe::Ok(fd) => Maybe::Ok(SyscallHandle { value: fd }),
            },
        )
    }

    fn close(handle: SyscallHandle) -> Option<SysError> {
        // TODO(port): @returnAddress() — Rust has no stable equivalent; pass 0.
        handle.value.close_allowing_bad_file_descriptor(0)
    }

    fn getcwd(path_buf: &mut PathBuffer) -> Maybe<&[u8]> {
        Syscall::getcwd(path_buf)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DirEntryAccessor
// ─────────────────────────────────────────────────────────────────────────────

pub struct DirEntryAccessor;

#[derive(Clone, Copy)]
pub struct DirEntryHandle {
    pub value: Option<&'static DirEntry>,
}

impl AccessorHandle for DirEntryHandle {
    const EMPTY: Self = DirEntryHandle { value: None };

    fn is_empty(self) -> bool {
        self.value.is_none()
    }

    fn eql(self, other: Self) -> bool {
        // TODO this might not be quite right, we're comparing pointers, not the underlying directory
        // On the other hand, DirEntries are only ever created once (per generation), so this should be fine?
        // Realistically, as closing the handle is a no-op, this should be fine either way.
        match (self.value, other.value) {
            (Some(a), Some(b)) => core::ptr::eq(a, b),
            (None, None) => true,
            _ => false,
        }
    }
}

pub struct DirEntryDirIter {
    // TODO(port): FS.DirEntry.EntryMap.Iterator — concrete type from bun_fs
    value: Option<bun_fs::file_system::EntryMapIterator<'static>>,
}

pub struct DirEntryIterResult {
    pub name: DirEntryNameWrapper,
    pub kind: bun_sys::FileKind,
}

pub struct DirEntryNameWrapper {
    pub value: &'static [u8],
}

impl DirEntryNameWrapper {
    pub fn slice(&self) -> &[u8] {
        self.value
    }
}

impl AccessorDirEntry for DirEntryIterResult {
    fn name_slice(&self) -> &[u8] {
        self.name.slice()
    }
    fn kind(&self) -> bun_sys::FileKind {
        self.kind
    }
}

impl AccessorDirIter for DirEntryDirIter {
    type Handle = DirEntryHandle;
    type Entry = DirEntryIterResult;

    #[inline]
    fn next(&mut self) -> Maybe<Option<DirEntryIterResult>> {
        if let Some(value) = &mut self.value {
            let Some(nextval) = value.next() else {
                return Maybe::Ok(None);
            };
            let name = *nextval.key_ptr;
            let kind = nextval.value_ptr.kind(&FS::instance().fs, true);
            let fskind = match kind {
                bun_fs::EntryKind::File => bun_sys::FileKind::File,
                bun_fs::EntryKind::Dir => bun_sys::FileKind::Directory,
            };
            Maybe::Ok(Some(DirEntryIterResult {
                name: DirEntryNameWrapper { value: name },
                kind: fskind,
            }))
        } else {
            Maybe::Ok(None)
        }
    }

    #[inline]
    fn iterate(dir: DirEntryHandle) -> Self {
        let Some(entry) = dir.value else {
            return DirEntryDirIter { value: None };
        };
        DirEntryDirIter {
            value: Some(entry.data.iterator()),
        }
    }
}

impl Accessor for DirEntryAccessor {
    const COUNT_FDS: bool = false;
    type Handle = DirEntryHandle;
    type DirIter = DirEntryDirIter;

    fn statat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
        let mut buf = PathBuffer::uninit();
        let path: &ZStr = if !bun_paths::Platform::Auto.is_absolute(path_.as_bytes()) {
            if let Some(entry) = handle.value {
                let slice = bun_paths::join_string_buf(
                    &mut buf,
                    &[entry.dir.as_ref(), path_.as_bytes()],
                    bun_paths::Platform::Auto,
                );
                let len = slice.len();
                buf[len] = 0;
                // SAFETY: buf[len] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), len) }
            } else {
                path_
            }
        } else {
            path_
        };
        Syscall::stat(path)
    }

    /// Like statat but does not follow symlinks.
    fn lstatat(handle: DirEntryHandle, path_: &ZStr) -> Maybe<Stat> {
        let mut buf = PathBuffer::uninit();
        if let Some(entry) = handle.value {
            return Syscall::lstatat(entry.fd, path_);
        }

        let path: &ZStr = if !bun_paths::Platform::Auto.is_absolute(path_.as_bytes()) {
            if let Some(entry) = handle.value {
                let slice = bun_paths::join_string_buf(
                    &mut buf,
                    &[entry.dir.as_ref(), path_.as_bytes()],
                    bun_paths::Platform::Auto,
                );
                let len = slice.len();
                buf[len] = 0;
                // SAFETY: buf[len] == 0 written above
                unsafe { ZStr::from_raw(buf.as_ptr(), len) }
            } else {
                path_
            }
        } else {
            path_
        };
        Syscall::lstat(path)
    }

    fn open(path: &ZStr) -> Result<Maybe<DirEntryHandle>, Error> {
        Self::openat(DirEntryHandle::EMPTY, path)
    }

    fn openat(handle: DirEntryHandle, path_: &ZStr) -> Result<Maybe<DirEntryHandle>, Error> {
        let mut buf = PathBuffer::uninit();
        let mut path: &[u8] = path_.as_bytes();

        if !bun_paths::Platform::Auto.is_absolute(path) {
            if let Some(entry) = handle.value {
                path = bun_paths::join_string_buf(
                    &mut buf,
                    &[entry.dir.as_ref(), path],
                    bun_paths::Platform::Auto,
                );
            }
        }
        // TODO do we want to propagate ENOTDIR through the 'Maybe' to match the SyscallAccessor?
        // The glob implementation specifically checks for this error when dealing with symlinks
        // return Maybe::Err(SysError::from_code(E::NOTDIR, Syscall::Tag::Open));
        let res = FS::instance().fs.read_directory(path, None, 0, false)?;
        match &*res {
            bun_fs::ReadDirResult::Entries(entry) => {
                Ok(Maybe::Ok(DirEntryHandle { value: Some(entry) }))
            }
            bun_fs::ReadDirResult::Err(err) => Err(err.original_err),
        }
    }

    #[inline]
    fn close(_handle: DirEntryHandle) -> Option<SysError> {
        // TODO is this a noop?
        None
    }

    fn getcwd(path_buf: &mut PathBuffer) -> Maybe<&[u8]> {
        let cwd = FS::instance().fs.cwd();
        path_buf[..cwd.len()].copy_from_slice(cwd);
        // TODO(port): Zig version has no return; assuming it should return the copied slice
        Maybe::Ok(&path_buf[..cwd.len()])
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GlobWalker_
// ─────────────────────────────────────────────────────────────────────────────

// Zig: fn GlobWalker_(comptime ignore_filter_fn, comptime Accessor: type, comptime sentinel: bool) type
//
// `ignore_filter_fn` is lowered to a runtime fn-pointer field because Rust
// const-generic fn pointers are unstable.
// PERF(port): was comptime monomorphization (ignore_filter_fn) — profile in Phase B
//
// `MatchedPath` was `[]const u8` or `[:0]const u8` depending on `sentinel`.
// Without the arena, matched paths are heap-owned; we use `Box<[u8]>` and
// include a trailing NUL byte when `SENTINEL == true`.
// TODO(port): MatchedPath sentinel typing — Phase B may want a dedicated owned ZStr type.
pub type MatchedPath = Box<[u8]>;

pub type IgnoreFilterFn = fn(&[u8]) -> bool;

/// Set of active component indices during traversal. At `**/X`
/// boundaries the walker needs to both advance past X and keep the
/// outer `**` alive; rather than visiting the directory twice, both
/// states are tracked in one set and evaluated in a single readdir.
///
/// Uses AutoBitSet (inline up to 127 bits, heap-backed beyond) so any
/// component count works.
pub type ComponentSet = AutoBitSet;

pub struct GlobWalker<A: Accessor, const SENTINEL: bool> {
    // PERF(port): was arena bulk-free — Zig used std.heap.ArenaAllocator for all
    // per-walk allocations (paths, workbuf, matchedPaths). Phase A uses the
    // global allocator; profile in Phase B.

    /// not owned by this struct
    pub pattern: Box<[u8]>,

    /// If the pattern contains "./" or "../"
    pub has_relative_components: bool,

    pub end_byte_of_basename_excluding_special_syntax: u32,
    pub basename_excluding_special_syntax_component_idx: u32,

    pub pattern_components: Vec<Component>,
    pub matched_paths: MatchedMap,
    pub i: u32,

    pub dot: bool,
    pub absolute: bool,

    pub cwd: Box<[u8]>,
    pub follow_symlinks: bool,
    pub error_on_broken_symlinks: bool,
    pub only_files: bool,

    pub path_buf: PathBuffer,
    // iteration state
    pub workbuf: Vec<WorkItem<A>>,

    is_ignored: IgnoreFilterFn,

    _accessor: core::marker::PhantomData<A>,
}

pub type Result_ = Maybe<()>;

/// Array hashmap used as a set (values are the keys)
/// to store matched paths and prevent duplicates
///
/// BunString is used so that we can call BunString.toJSArray()
/// on the result of `.keys()` to give the result back to JS
///
/// The only type of string impl we use is ZigString since
/// all matched paths are UTF-8 (DirIterator converts them on
/// windows) and allocated on the arena
///
/// Multiple patterns are not supported so right now this is
/// only possible when running a pattern like:
///
/// `foo/**/*`
///
/// Use `.keys()` to get the matched paths
pub type MatchedMap = ArrayHashMap<BunString, (), MatchedMapContext, true>;

pub struct MatchedMapContext;
// TODO(port): ArrayHashMap context trait shape — Phase B wires the actual trait.
impl MatchedMapContext {
    pub fn hash(&self, this: &BunString) -> u32 {
        debug_assert!(this.tag() == bun_str::Tag::ZigString);
        let slice = this.byte_slice();
        // For SENTINEL the slice includes trailing NUL; hash excludes it.
        // TODO(port): const-generic SENTINEL not reachable here; Zig branched at comptime.
        bun_collections::array_hash_map::hash_string(slice)
    }

    pub fn eql(&self, this: &BunString, other: &BunString, _idx: usize) -> bool {
        this.eql(other)
    }
}

/// The glob walker references the .directory.path so its not safe to
/// copy/move this
pub enum IterState<A: Accessor> {
    /// Pops the next item off the work stack
    GetNext,

    /// Currently iterating over a directory
    Directory(Directory<A>),

    /// Two particular cases where this is used:
    ///
    /// 1. A pattern with no special glob syntax was supplied, for example: `/Users/zackradisic/foo/bar`
    ///
    ///    In that case, the mere existence of the file/dir counts as a match, so we can eschew directory
    ///    iterating and walking for a simple stat call to the path.
    ///
    /// 2. Pattern ending in literal optimization
    ///
    ///    With a pattern like: `packages/**/package.json`, once the iteration component index reaches
    ///    the final component, which is a literal string ("package.json"), we can similarly make a
    ///    single stat call to complete the pattern.
    Matched(MatchedPath),
}

pub struct Directory<A: Accessor> {
    pub fd: A::Handle,
    pub iter: A::DirIter,
    pub path: PathBuffer,
    // Zig: `dir_path: [:0]const u8` is a slice into `path` (self-referential).
    // Store the length and reconstruct on demand.
    // TODO(port): self-referential dir_path; Phase B may need Pin or raw-ptr slice.
    pub dir_path_len: usize,

    /// Active component indices. Multiple indices mean one readdir
    /// evaluates all of them instead of revisiting the directory.
    pub active: ComponentSet,

    pub iter_closed: bool,
    pub at_cwd: bool,
}

impl<A: Accessor> Directory<A> {
    #[inline]
    fn dir_path(&self) -> &ZStr {
        // SAFETY: path[dir_path_len] == 0 was written by transition_to_dir_iter_state
        unsafe { ZStr::from_raw(self.path.as_ptr(), self.dir_path_len) }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Iterator
// ─────────────────────────────────────────────────────────────────────────────

pub struct Iterator<'a, A: Accessor, const SENTINEL: bool> {
    pub walker: &'a mut GlobWalker<A, SENTINEL>,
    pub iter_state: IterState<A>,
    pub cwd_fd: A::Handle,
    pub empty_dir_path: [u8; 1], // [0:0]u8 — single NUL byte
    /// This is to make sure in debug/tests that we are closing file descriptors
    /// We should only have max 2 open at a time. One for the cwd, and one for the
    /// directory being iterated on.
    #[cfg(debug_assertions)]
    pub fds_open: usize,
    #[cfg(not(debug_assertions))]
    pub fds_open: u8, // u0 in Zig; smallest Rust int

    #[cfg(windows)]
    pub nt_filter_buf: [u16; 256],
}

#[inline]
fn count_fds<A: Accessor>() -> bool {
    A::COUNT_FDS && cfg!(debug_assertions)
}

impl<'a, A: Accessor, const SENTINEL: bool> Iterator<'a, A, SENTINEL> {
    pub fn new(walker: &'a mut GlobWalker<A, SENTINEL>) -> Self {
        Self {
            walker,
            iter_state: IterState::GetNext,
            cwd_fd: A::Handle::EMPTY,
            empty_dir_path: [0],
            #[cfg(debug_assertions)]
            fds_open: 0,
            #[cfg(not(debug_assertions))]
            fds_open: 0,
            #[cfg(windows)]
            nt_filter_buf: [0; 256],
        }
    }

    pub fn init(&mut self) -> Result<Maybe<()>, Error> {
        log!("Iterator init pattern={}", bstr::BStr::new(&self.walker.pattern));
        let mut was_absolute = false;
        let root_work_item: WorkItem<A> = 'brk: {
            let mut use_posix = cfg!(unix);
            let is_absolute = if cfg!(unix) {
                bun_paths::is_absolute(&self.walker.pattern)
            } else {
                bun_paths::is_absolute(&self.walker.pattern) || {
                    use_posix = true;
                    bun_paths::is_absolute_posix(&self.walker.pattern)
                }
            };
            let _ = use_posix;

            if !is_absolute {
                break 'brk WorkItem::new(
                    self.walker.cwd.clone(),
                    self.walker.single_set(0),
                    WorkItemKind::Directory,
                );
            }

            was_absolute = true;

            let mut path_without_special_syntax: &[u8] = &self.walker.pattern
                [0..self.walker.end_byte_of_basename_excluding_special_syntax as usize];
            let mut starting_component_idx =
                self.walker.basename_excluding_special_syntax_component_idx;

            if path_without_special_syntax.is_empty() {
                path_without_special_syntax = if !IS_WINDOWS {
                    b"/"
                } else {
                    resolve_path::windows_filesystem_root(&self.walker.cwd)
                };
            } else {
                // Skip the components associated with the literal path
                starting_component_idx += 1;

                // This means we got a pattern without any special glob syntax, for example:
                // `/Users/zackradisic/foo/bar`
                //
                // In that case we don't need to do any walking and can just open up the FS entry
                if starting_component_idx as usize >= self.walker.pattern_components.len() {
                    let path = dupe_z(path_without_special_syntax);
                    // SAFETY: dupe_z appends NUL at path[path.len()-1]; ZStr len excludes it
                    let pathz =
                        unsafe { ZStr::from_raw(path.as_ptr(), path.len() - 1) };
                    let fd = match A::open(pathz)? {
                        Maybe::Err(e) => {
                            if e.errno() == E::NOTDIR {
                                self.iter_state = IterState::Matched(path);
                                return Ok(Maybe::Ok(()));
                            }
                            // Doesn't exist
                            if e.errno() == E::NOENT {
                                self.iter_state = IterState::GetNext;
                                return Ok(Maybe::Ok(()));
                            }
                            return Ok(Maybe::Err(e.with_path(&path)));
                        }
                        Maybe::Ok(fd) => fd,
                    };
                    let _ = A::close(fd);
                    self.iter_state = IterState::Matched(path);
                    return Ok(Maybe::Ok(()));
                }

                // In the above branch, if `starting_component_idx >= pattern_components.len` then
                // it should also mean that `end_byte_of_basename_excluding_special_syntax >= pattern.len`
                //
                // So if we see that `end_byte_of_basename_excluding_special_syntax < self.walker.pattern.len` we
                // miscalculated the values
                debug_assert!(
                    (self.walker.end_byte_of_basename_excluding_special_syntax as usize)
                        < self.walker.pattern.len()
                );
            }

            WorkItem::new(
                Box::from(path_without_special_syntax),
                self.walker.single_set(starting_component_idx),
                WorkItemKind::Directory,
            )
        };

        let path_buf: &mut PathBuffer = &mut self.walker.path_buf;
        let root_path = &root_work_item.path;
        if root_path.len() >= path_buf.len() {
            return Ok(Maybe::Err(
                SysError::from_code(E::NAMETOOLONG, Syscall::Tag::Open).with_path(root_path),
            ));
        }
        path_buf[0..root_path.len()].copy_from_slice(&root_path[0..root_path.len()]);
        path_buf[root_path.len()] = 0;
        // SAFETY: path_buf[root_path.len()] == 0 written above
        let root_path_z = unsafe { ZStr::from_raw(path_buf.as_ptr(), root_path.len()) };
        let cwd_fd = match A::open(root_path_z)? {
            Maybe::Err(err) => {
                let len = root_path.len() + 1;
                return Ok(Maybe::Err(self.walker.handle_sys_err_with_path(
                    err,
                    // SAFETY: NUL at index len-1 written above
                    unsafe { ZStr::from_raw(path_buf.as_ptr(), len) },
                )));
            }
            Maybe::Ok(fd) => fd,
        };

        if count_fds::<A>() {
            #[cfg(debug_assertions)]
            {
                self.fds_open += 1;
            }
        }

        self.cwd_fd = cwd_fd;

        let trans = if was_absolute {
            self.transition_to_dir_iter_state::<false>(root_work_item)?
        } else {
            self.transition_to_dir_iter_state::<true>(root_work_item)?
        };
        if let Maybe::Err(err) = trans {
            return Ok(Maybe::Err(err));
        }

        Ok(Maybe::Ok(()))
    }

    pub fn close_cwd_fd(&mut self) {
        if self.cwd_fd.is_empty() {
            return;
        }
        let _ = A::close(self.cwd_fd);
        if count_fds::<A>() {
            #[cfg(debug_assertions)]
            {
                self.fds_open -= 1;
            }
        }
    }

    pub fn close_disallowing_cwd(&mut self, fd: A::Handle) {
        if fd.is_empty() || fd.eql(self.cwd_fd) {
            return;
        }
        let _ = A::close(fd);
        if count_fds::<A>() {
            #[cfg(debug_assertions)]
            {
                self.fds_open -= 1;
            }
        }
    }

    pub fn bump_open_fds(&mut self) {
        if count_fds::<A>() {
            #[cfg(debug_assertions)]
            {
                self.fds_open += 1;
                // If this is over 2 then this means that there is a bug in the iterator code
                debug_assert!(self.fds_open <= 2);
            }
        }
    }

    fn transition_to_dir_iter_state<const ROOT: bool>(
        &mut self,
        work_item: WorkItem<A>,
    ) -> Result<Maybe<()>, Error> {
        log!("transition => {}", bstr::BStr::new(&work_item.path));
        // PORT NOTE: reshaped for borrowck — Zig set `iter_state = .{ .directory = .{...} }`
        // up front and then mutated `this.iter_state.directory.*` while also borrowing
        // `this.walker`. Build the Directory in a local and assign at the end.
        let mut dir_path_buf = PathBuffer::uninit();
        let mut dir_path_len: usize = 'dir_path: {
            if ROOT {
                if !self.walker.absolute {
                    dir_path_buf[0] = 0;
                    break 'dir_path 0;
                }
            }
            // TODO Optimization: On posix systems filepaths are already null byte terminated so we can skip this if thats the case
            if work_item.path.len() >= dir_path_buf.len() {
                if let Some(fd) = work_item.fd {
                    self.close_disallowing_cwd(fd);
                }
                return Ok(Maybe::Err(
                    SysError::from_code(E::NAMETOOLONG, Syscall::Tag::Open)
                        .with_path(&work_item.path),
                ));
            }
            dir_path_buf[0..work_item.path.len()].copy_from_slice(&work_item.path);
            dir_path_buf[work_item.path.len()] = 0;
            work_item.path.len()
        };

        let mut had_dot_dot = false;
        // Single-index sets (the initial WorkItem) may point to Dot/DotBack
        // or collapsible `**` runs. Multi-index sets only arise mid-traversal
        // after `**/X` boundaries and are already past any Dots.
        let active: ComponentSet = 'set: {
            if work_item.active.count() == 1 {
                let single: u32 =
                    u32::try_from(work_item.active.find_first_set().unwrap()).unwrap();
                let norm = match self.walker.skip_special_components(
                    single,
                    &mut dir_path_len,
                    &mut dir_path_buf,
                    &mut had_dot_dot,
                ) {
                    Maybe::Err(e) => {
                        if let Some(fd) = work_item.fd {
                            self.close_disallowing_cwd(fd);
                        }
                        return Ok(Maybe::Err(e));
                    }
                    Maybe::Ok(i) => i,
                };
                if norm as usize >= self.walker.pattern_components.len() {
                    if let Some(fd) = work_item.fd {
                        self.close_disallowing_cwd(fd);
                    }
                    self.iter_state = IterState::GetNext;
                    return Ok(Maybe::Ok(()));
                }
                break 'set self.walker.single_set(norm);
            }
            // Multi-index sets are already normalized by eval_dir.
            work_item.active
        };

        // SAFETY: dir_path_buf[dir_path_len] == 0 written above (or by collapse_dots)
        let dir_path = unsafe { ZStr::from_raw(dir_path_buf.as_ptr(), dir_path_len) };

        let mut at_cwd = false;
        let fd: A::Handle = 'fd: {
            if let Some(fd) = work_item.fd {
                break 'fd fd;
            }
            if ROOT {
                if had_dot_dot {
                    break 'fd match A::openat(self.cwd_fd, dir_path)? {
                        Maybe::Err(err) => {
                            return Ok(Maybe::Err(
                                self.walker.handle_sys_err_with_path(err, dir_path),
                            ));
                        }
                        Maybe::Ok(fd_) => {
                            self.bump_open_fds();
                            fd_
                        }
                    };
                }

                at_cwd = true;
                break 'fd self.cwd_fd;
            }

            match A::openat(self.cwd_fd, dir_path)? {
                Maybe::Err(err) => {
                    return Ok(Maybe::Err(
                        self.walker.handle_sys_err_with_path(err, dir_path),
                    ));
                }
                Maybe::Ok(fd_) => {
                    self.bump_open_fds();
                    fd_
                }
            }
        };

        // Literal-tail optimization: if the only active index is the last
        // component and it is a Literal, statat() instead of iterating.
        // Skip for multi-index masks since each index has different needs.
        if active.count() == 1 {
            let idx: u32 = u32::try_from(active.find_first_set().unwrap()).unwrap();
            if idx as usize == self.walker.pattern_components.len().saturating_sub(1)
                && self.walker.pattern_components[idx as usize].syntax_hint == SyntaxHint::Literal
            {
                // Zig: `defer this.closeDisallowingCwd(fd)` — covered explicitly on
                // both exit paths below (Err arm and post-Ok); no `?` between here
                // and those calls, so a scopeguard is unnecessary.
                // PERF(port): was stack-fallback (stackFallback(256, arena))
                let pat_slice = self.walker.pattern_components[idx as usize]
                    .pattern_slice(&self.walker.pattern)
                    .to_vec();
                let pathz = dupe_z(&pat_slice);
                // SAFETY: dupe_z NUL-terminates
                let pathz_ref = unsafe { ZStr::from_raw(pathz.as_ptr(), pathz.len() - 1) };
                let stat_result: Stat = match A::statat(fd, pathz_ref) {
                    Maybe::Err(e_) => {
                        let e: SysError = e_;
                        self.close_disallowing_cwd(fd);
                        if e.errno() == E::NOENT {
                            self.iter_state = IterState::GetNext;
                            return Ok(Maybe::Ok(()));
                        }
                        return Ok(Maybe::Err(e.with_path(
                            self.walker.pattern_components[idx as usize]
                                .pattern_slice(&self.walker.pattern),
                        )));
                    }
                    Maybe::Ok(stat) => stat,
                };
                self.close_disallowing_cwd(fd);
                let mode = u32::try_from(stat_result.mode).unwrap();
                let matches = (S::isdir(mode) && !self.walker.only_files)
                    || S::isreg(mode)
                    || !self.walker.only_files;
                if matches {
                    if let Some(path) = self
                        .walker
                        .prepare_matched_path(&pathz[..pathz.len() - 1], dir_path.as_bytes())?
                    {
                        self.iter_state = IterState::Matched(path);
                    } else {
                        self.iter_state = IterState::GetNext;
                    }
                } else {
                    self.iter_state = IterState::GetNext;
                }
                return Ok(Maybe::Ok(()));
            }
        }

        log!(
            "Transition(dirpath={}, active_count={})",
            bstr::BStr::new(dir_path.as_bytes()),
            active.count()
        );

        let mut iterator = A::DirIter::iterate(fd);
        #[cfg(windows)]
        {
            // computeNtFilter operates on a single pattern component.
            // When multiple indices are active (e.g. after `**`), the
            // kernel filter could hide entries needed by other indices,
            // so skip it. The filter is purely an optimization;
            // matchPatternImpl still runs for correctness.
            // TODO(port): @hasDecl(Accessor.DirIter, "setNameFilter") — trait default method covers this
            let filter: Option<&[u16]> = if active.count() == 1 {
                self.compute_nt_filter(u32::try_from(active.find_first_set().unwrap()).unwrap())
            } else {
                None
            };
            iterator.set_name_filter(filter);
        }

        self.iter_state = IterState::Directory(Directory {
            fd,
            iter: iterator,
            path: dir_path_buf,
            dir_path_len,
            active,
            iter_closed: false,
            at_cwd,
        });

        Ok(Maybe::Ok(()))
    }

    /// Compute an optional NtQueryDirectoryFile FileName filter for the current
    /// pattern component. The kernel filter is used purely as a pre-filter;
    /// matchPatternImpl still runs on every returned entry for correctness
    /// (case sensitivity, 8.3 aliases, etc). We only emit a filter when the
    /// NT match is guaranteed to be a superset of the glob match.
    #[cfg(windows)]
    fn compute_nt_filter(&mut self, component_idx: u32) -> Option<&[u16]> {
        let comp = &self.walker.pattern_components[component_idx as usize];
        match comp.syntax_hint {
            // `*` and `**` match everything; a filter gains nothing and for `**`
            // would incorrectly hide subdirectories we need to recurse into.
            SyntaxHint::Single
            | SyntaxHint::Double
            | SyntaxHint::Dot
            | SyntaxHint::DotBack => return None,
            _ => {}
        }

        let slice = comp.pattern_slice(&self.walker.pattern);
        if slice.is_empty() || slice.len() > self.nt_filter_buf.len() {
            return None;
        }

        // Only `*` and literals are safe to lower. Reject anything NT cannot
        // express (`[` `{` `\` `!`) or where NT semantics under-match glob
        // (`?` matches one UTF-16 code unit, glob matches one codepoint).
        // `<` `>` `"` are NT wildcards; treating them as literals would over-match,
        // but they are invalid in Windows filenames so such a pattern never matches
        // anyway.
        if strings::index_of_any(slice, b"?[{\\!<>\"").is_some() {
            return None;
        }

        let wide = strings::convert_utf8_to_utf16_in_buffer(&mut self.nt_filter_buf, slice);
        Some(wide)
    }

    #[cfg(not(windows))]
    #[allow(dead_code)]
    fn compute_nt_filter(&mut self, _component_idx: u32) -> Option<&[u16]> {
        None
    }

    pub fn next(&mut self) -> Result<Maybe<Option<MatchedPath>>, Error> {
        loop {
            // PORT NOTE: reshaped for borrowck — take/replace iter_state where needed.
            match &mut self.iter_state {
                IterState::Matched(_) => {
                    let IterState::Matched(path) =
                        core::mem::replace(&mut self.iter_state, IterState::GetNext)
                    else {
                        unreachable!()
                    };
                    return Ok(Maybe::Ok(Some(path)));
                }
                IterState::GetNext => {
                    // Done
                    if self.walker.workbuf.is_empty() {
                        return Ok(Maybe::Ok(None));
                    }
                    let work_item = self.walker.workbuf.pop().unwrap();
                    match work_item.kind {
                        WorkItemKind::Directory => {
                            if let Maybe::Err(err) =
                                self.transition_to_dir_iter_state::<false>(work_item)?
                            {
                                return Ok(Maybe::Err(err));
                            }
                            continue;
                        }
                        WorkItemKind::Symlink => {
                            let scratch_path_buf: &mut PathBuffer = &mut self.walker.path_buf;
                            if work_item.path.len() >= scratch_path_buf.len() {
                                return Ok(Maybe::Err(
                                    SysError::from_code(E::NAMETOOLONG, Syscall::Tag::Open)
                                        .with_path(&work_item.path),
                                ));
                            }
                            scratch_path_buf[0..work_item.path.len()]
                                .copy_from_slice(&work_item.path);
                            scratch_path_buf[work_item.path.len()] = 0;
                            let mut symlink_full_path_len = work_item.path.len();
                            // PORT NOTE: reshaped for borrowck — entry_name is a sub-slice
                            // of symlink_full_path; capture range and re-slice later.
                            let entry_start = work_item.entry_start as usize;

                            let mut has_dot_dot = false;
                            let active: ComponentSet = if work_item.active.count() == 1 {
                                let single: u32 =
                                    u32::try_from(work_item.active.find_first_set().unwrap())
                                        .unwrap();
                                let norm = match self.walker.skip_special_components(
                                    single,
                                    &mut symlink_full_path_len,
                                    scratch_path_buf,
                                    &mut has_dot_dot,
                                ) {
                                    Maybe::Err(e) => return Ok(Maybe::Err(e)),
                                    Maybe::Ok(i) => i,
                                };
                                if norm as usize >= self.walker.pattern_components.len() {
                                    self.iter_state = IterState::GetNext;
                                    continue;
                                }
                                self.walker.single_set(norm)
                            } else {
                                work_item.active
                            };

                            // SAFETY: scratch_path_buf[symlink_full_path_len] == 0
                            let symlink_full_path_z = unsafe {
                                ZStr::from_raw(scratch_path_buf.as_ptr(), symlink_full_path_len)
                            };
                            let entry_name =
                                &scratch_path_buf[entry_start..symlink_full_path_len];

                            self.iter_state = IterState::GetNext;
                            let maybe_dir_fd: Option<A::Handle> =
                                match A::openat(self.cwd_fd, symlink_full_path_z)? {
                                    Maybe::Err(err) => 'brk: {
                                        if usize::try_from(err.errno).unwrap()
                                            == E::NOTDIR as usize
                                        {
                                            break 'brk None;
                                        }
                                        if self.walker.error_on_broken_symlinks {
                                            return Ok(Maybe::Err(
                                                self.walker.handle_sys_err_with_path(
                                                    err,
                                                    symlink_full_path_z,
                                                ),
                                            ));
                                        }
                                        if !self.walker.only_files
                                            && self.walker.eval_file(&active, entry_name)
                                        {
                                            match self.walker.prepare_matched_path_symlink(
                                                symlink_full_path_z.as_bytes(),
                                            )? {
                                                Some(p) => return Ok(Maybe::Ok(Some(p))),
                                                None => continue,
                                            }
                                        }
                                        continue;
                                    }
                                    Maybe::Ok(fd) => {
                                        self.bump_open_fds();
                                        Some(fd)
                                    }
                                };

                            let Some(dir_fd) = maybe_dir_fd else {
                                // Symlink target is a file
                                if self.walker.eval_file(&active, entry_name) {
                                    match self.walker.prepare_matched_path_symlink(
                                        symlink_full_path_z.as_bytes(),
                                    )? {
                                        Some(p) => return Ok(Maybe::Ok(Some(p))),
                                        None => continue,
                                    }
                                }
                                continue;
                            };

                            let mut add_dir: bool = false;
                            let child = self.walker.eval_dir(&active, entry_name, &mut add_dir);
                            if child.count() != 0 {
                                self.walker.workbuf.push(WorkItem::new_with_fd(
                                    work_item.path,
                                    child,
                                    WorkItemKind::Directory,
                                    dir_fd,
                                ));
                            } else {
                                self.close_disallowing_cwd(dir_fd);
                            }

                            if add_dir && !self.walker.only_files {
                                match self
                                    .walker
                                    .prepare_matched_path_symlink(symlink_full_path_z.as_bytes())?
                                {
                                    Some(p) => return Ok(Maybe::Ok(Some(p))),
                                    None => continue,
                                }
                            }

                            continue;
                        }
                    }
                }
                IterState::Directory(dir) => {
                    let entry = match dir.iter.next() {
                        Maybe::Err(err) => {
                            let dir_fd = dir.fd;
                            let at_cwd = dir.at_cwd;
                            let dir_path = dir.dir_path();
                            // PORT NOTE: reshaped for borrowck
                            let err = self.walker.handle_sys_err_with_path(err, dir_path);
                            if !at_cwd {
                                self.close_disallowing_cwd(dir_fd);
                            }
                            if let IterState::Directory(d) = &mut self.iter_state {
                                d.iter_closed = true;
                            }
                            return Ok(Maybe::Err(err));
                        }
                        Maybe::Ok(ent) => ent,
                    };
                    let Some(entry) = entry else {
                        let dir_fd = dir.fd;
                        let at_cwd = dir.at_cwd;
                        if !at_cwd {
                            self.close_disallowing_cwd(dir_fd);
                        }
                        if let IterState::Directory(d) = &mut self.iter_state {
                            d.iter_closed = true;
                        }
                        self.iter_state = IterState::GetNext;
                        continue;
                    };
                    // Re-borrow dir after potential &mut self above
                    let IterState::Directory(dir) = &mut self.iter_state else {
                        unreachable!()
                    };
                    log!(
                        "dir: {} entry: {}",
                        bstr::BStr::new(dir.dir_path().as_bytes()),
                        bstr::BStr::new(entry.name_slice())
                    );

                    let active = dir.active.clone();
                    let entry_name = entry.name_slice();
                    let dir_dir_path = dir.dir_path().as_bytes();
                    let dir_fd = dir.fd;
                    match entry.kind() {
                        bun_sys::FileKind::File => {
                            if self.walker.eval_file(&active, entry_name) {
                                match self
                                    .walker
                                    .prepare_matched_path(entry_name, dir_dir_path)?
                                {
                                    Some(prepared) => return Ok(Maybe::Ok(Some(prepared))),
                                    None => continue,
                                }
                            }
                            continue;
                        }
                        bun_sys::FileKind::Directory => {
                            let mut add_dir: bool = false;
                            let child = self.walker.eval_dir(&active, entry_name, &mut add_dir);
                            if child.count() != 0 {
                                let subdir_parts: &[&[u8]] = &[dir_dir_path, entry_name];
                                let subdir_entry_name = self.walker.join(subdir_parts)?;
                                self.walker.workbuf.push(WorkItem::new(
                                    subdir_entry_name,
                                    child,
                                    WorkItemKind::Directory,
                                ));
                            }
                            if add_dir && !self.walker.only_files {
                                match self
                                    .walker
                                    .prepare_matched_path(entry_name, dir_dir_path)?
                                {
                                    Some(prepared_path) => {
                                        return Ok(Maybe::Ok(Some(prepared_path)));
                                    }
                                    None => continue,
                                }
                            }
                            continue;
                        }
                        bun_sys::FileKind::SymLink => {
                            if self.walker.follow_symlinks {
                                if !self.walker.eval_impl(&active, entry_name) {
                                    continue;
                                }

                                let subdir_parts: &[&[u8]] = &[dir_dir_path, entry_name];
                                let entry_start: u32 =
                                    u32::try_from(if dir_dir_path.is_empty() {
                                        0
                                    } else {
                                        dir_dir_path.len() + 1
                                    })
                                    .unwrap();
                                let subdir_entry_name = self.walker.join(subdir_parts)?;

                                self.walker.workbuf.push(WorkItem::new_symlink(
                                    subdir_entry_name,
                                    active,
                                    entry_start,
                                ));
                                continue;
                            }

                            if self.walker.only_files {
                                continue;
                            }

                            if self.walker.eval_file(&active, entry_name) {
                                match self
                                    .walker
                                    .prepare_matched_path(entry_name, dir_dir_path)?
                                {
                                    Some(prepared_path) => {
                                        return Ok(Maybe::Ok(Some(prepared_path)));
                                    }
                                    None => continue,
                                }
                            }
                            continue;
                        }
                        bun_sys::FileKind::Unknown => {
                            if !self.walker.eval_impl(&active, entry_name) {
                                continue;
                            }

                            // PERF(port): was stack-fallback (stackFallback(256, arena))
                            let name_z = dupe_z(entry_name);
                            // SAFETY: dupe_z NUL-terminates
                            let name_z_ref =
                                unsafe { ZStr::from_raw(name_z.as_ptr(), name_z.len() - 1) };
                            let stat_result = A::lstatat(dir_fd, name_z_ref);
                            let real_kind = match stat_result {
                                Maybe::Ok(st) => bun_sys::kind_from_mode(
                                    u32::try_from(st.mode).unwrap(),
                                ),
                                Maybe::Err(_) => continue,
                            };

                            match real_kind {
                                bun_sys::FileKind::File => {
                                    if self.walker.eval_file(&active, entry_name) {
                                        match self
                                            .walker
                                            .prepare_matched_path(entry_name, dir_dir_path)?
                                        {
                                            Some(prepared) => {
                                                return Ok(Maybe::Ok(Some(prepared)));
                                            }
                                            None => continue,
                                        }
                                    }
                                }
                                bun_sys::FileKind::Directory => {
                                    let mut add_dir: bool = false;
                                    let child =
                                        self.walker.eval_dir(&active, entry_name, &mut add_dir);
                                    if child.count() != 0 {
                                        let subdir_parts: &[&[u8]] =
                                            &[dir_dir_path, entry_name];
                                        let subdir_entry_name = self.walker.join(subdir_parts)?;
                                        self.walker.workbuf.push(WorkItem::new(
                                            subdir_entry_name,
                                            child,
                                            WorkItemKind::Directory,
                                        ));
                                    }
                                    if add_dir && !self.walker.only_files {
                                        match self
                                            .walker
                                            .prepare_matched_path(entry_name, dir_dir_path)?
                                        {
                                            Some(prepared_path) => {
                                                return Ok(Maybe::Ok(Some(prepared_path)));
                                            }
                                            None => continue,
                                        }
                                    }
                                }
                                bun_sys::FileKind::SymLink => {
                                    if self.walker.follow_symlinks {
                                        let subdir_parts: &[&[u8]] =
                                            &[dir_dir_path, entry_name];
                                        let entry_start: u32 =
                                            u32::try_from(if dir_dir_path.is_empty() {
                                                0
                                            } else {
                                                dir_dir_path.len() + 1
                                            })
                                            .unwrap();
                                        let subdir_entry_name =
                                            self.walker.join(subdir_parts)?;
                                        self.walker.workbuf.push(WorkItem::new_symlink(
                                            subdir_entry_name,
                                            active,
                                            entry_start,
                                        ));
                                    } else if !self.walker.only_files {
                                        if self.walker.eval_file(&active, entry_name) {
                                            match self
                                                .walker
                                                .prepare_matched_path(entry_name, dir_dir_path)?
                                            {
                                                Some(prepared_path) => {
                                                    return Ok(Maybe::Ok(Some(prepared_path)));
                                                }
                                                None => continue,
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                            continue;
                        }
                        _ => continue,
                    }
                }
            }
        }
    }
}

impl<'a, A: Accessor, const SENTINEL: bool> Drop for Iterator<'a, A, SENTINEL> {
    fn drop(&mut self) {
        // Zig: pub fn deinit(this: *Iterator)
        self.close_cwd_fd();
        if let IterState::Directory(dir) = &self.iter_state {
            if !dir.iter_closed {
                let fd = dir.fd;
                self.close_disallowing_cwd(fd);
            }
        }

        while let Some(work_item) = self.walker.workbuf.pop() {
            if let Some(fd) = work_item.fd {
                self.close_disallowing_cwd(fd);
            }
        }

        if count_fds::<A>() {
            #[cfg(debug_assertions)]
            debug_assert!(self.fds_open == 0);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkItem
// ─────────────────────────────────────────────────────────────────────────────

pub struct WorkItem<A: Accessor> {
    // Zig: `path: []const u8` — arena-owned slice. Now heap-owned.
    pub path: Box<[u8]>,
    /// Bitmask of active component indices.
    pub active: ComponentSet,
    pub kind: WorkItemKind,
    pub entry_start: u32,
    pub fd: Option<A::Handle>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WorkItemKind {
    Directory,
    Symlink,
}

impl<A: Accessor> WorkItem<A> {
    fn new(path: Box<[u8]>, active: ComponentSet, kind: WorkItemKind) -> Self {
        Self { path, active, kind, entry_start: 0, fd: None }
    }

    fn new_with_fd(
        path: Box<[u8]>,
        active: ComponentSet,
        kind: WorkItemKind,
        fd: A::Handle,
    ) -> Self {
        Self { path, active, kind, entry_start: 0, fd: Some(fd) }
    }

    fn new_symlink(path: Box<[u8]>, active: ComponentSet, entry_start: u32) -> Self {
        Self {
            path,
            active,
            kind: WorkItemKind::Symlink,
            entry_start,
            fd: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/// A component is each part of a glob pattern, separated by directory
/// separator:
/// `src/**/*.ts` -> `src`, `**`, `*.ts`
#[derive(Clone, Copy)]
pub struct Component {
    pub start: u32,
    pub len: u32,

    pub syntax_hint: SyntaxHint,
    pub trailing_sep: bool,
    pub is_ascii: bool,

    /// Only used when component is not ascii
    pub unicode_set: bool,
}

impl Default for Component {
    fn default() -> Self {
        Self {
            start: 0,
            len: 0,
            syntax_hint: SyntaxHint::None,
            trailing_sep: false,
            is_ascii: false,
            unicode_set: false,
        }
    }
}

impl Component {
    pub fn pattern_slice<'a>(&self, pattern: &'a [u8]) -> &'a [u8] {
        let end = (self.start + self.len - u32::from(self.trailing_sep)) as usize;
        &pattern[self.start as usize..end]
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum SyntaxHint {
    None,
    Single,
    Double,
    /// Uses special fast-path matching for components like: `*.ts`
    WildcardFilepath,
    /// Uses special fast-patch matching for literal components e.g.
    /// "node_modules", becomes memcmp
    Literal,
    /// ./fixtures/*.ts
    /// ^
    Dot,
    /// ../
    DotBack,
}

impl SyntaxHint {
    fn is_special_syntax(self) -> bool {
        !matches!(self, SyntaxHint::Literal)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GlobWalker impl
// ─────────────────────────────────────────────────────────────────────────────

impl<A: Accessor, const SENTINEL: bool> GlobWalker<A, SENTINEL> {
    /// The arena parameter is dereferenced and copied if all allocations go well and nothing goes wrong
    // PORT NOTE: out-param constructor reshaped to return Self.
    pub fn init(
        pattern: &[u8],
        dot: bool,
        absolute: bool,
        follow_symlinks: bool,
        error_on_broken_symlinks: bool,
        only_files: bool,
        ignore_filter_fn: Option<IgnoreFilterFn>,
    ) -> Result<Maybe<Self>, Error> {
        Self::init_with_cwd(
            pattern,
            FS::instance().top_level_dir(),
            dot,
            absolute,
            follow_symlinks,
            error_on_broken_symlinks,
            only_files,
            ignore_filter_fn,
        )
    }

    pub fn debug_pattern_components(&self) {
        let pattern = &self.pattern;
        let components = &self.pattern_components;
        let ptr = self as *const _ as usize;
        log!("GlobWalker(0x{:x}) components:", ptr);
        for cmp in components.iter() {
            match cmp.syntax_hint {
                SyntaxHint::Single => log!("  *"),
                SyntaxHint::Double => log!("  **"),
                SyntaxHint::Dot => log!("  ."),
                SyntaxHint::DotBack => log!("  ../"),
                SyntaxHint::Literal | SyntaxHint::WildcardFilepath | SyntaxHint::None => log!(
                    "  hint={} component_str={}",
                    <&'static str>::from(cmp.syntax_hint),
                    bstr::BStr::new(cmp.pattern_slice(pattern))
                ),
            }
        }
    }

    /// `cwd` should be allocated with the arena
    /// The arena parameter is dereferenced and copied if all allocations go well and nothing goes wrong
    // PORT NOTE: out-param constructor reshaped to return Self.
    pub fn init_with_cwd(
        pattern: &[u8],
        cwd: &[u8],
        dot: bool,
        absolute: bool,
        follow_symlinks: bool,
        error_on_broken_symlinks: bool,
        only_files: bool,
        ignore_filter_fn: Option<IgnoreFilterFn>,
    ) -> Result<Maybe<Self>, Error> {
        log!("initWithCwd(cwd={})", bstr::BStr::new(cwd));
        let mut this = Self {
            cwd: Box::from(cwd),
            pattern: Box::from(pattern),
            dot,
            absolute,
            follow_symlinks,
            error_on_broken_symlinks,
            only_files,
            basename_excluding_special_syntax_component_idx: 0,
            end_byte_of_basename_excluding_special_syntax: 0,
            has_relative_components: false,
            pattern_components: Vec::new(),
            matched_paths: MatchedMap::default(),
            i: 0,
            path_buf: PathBuffer::uninit(),
            workbuf: Vec::new(),
            is_ignored: ignore_filter_fn.unwrap_or(dummy_filter_false),
            _accessor: core::marker::PhantomData,
        };

        Self::build_pattern_components(
            &mut this.pattern_components,
            &this.pattern,
            &mut this.has_relative_components,
            &mut this.end_byte_of_basename_excluding_special_syntax,
            &mut this.basename_excluding_special_syntax_component_idx,
        )?;

        // copy arena after all allocations are successful
        // PERF(port): was arena bulk-free — arena field removed.

        if cfg!(debug_assertions) {
            this.debug_pattern_components();
        }

        Ok(Maybe::Ok(this))
    }

    pub fn handle_sys_err_with_path(&mut self, err: SysError, path_buf: &ZStr) -> SysError {
        let copy_len = path_buf.as_bytes().len().min(self.path_buf.len());
        self.path_buf[0..copy_len].copy_from_slice(&path_buf.as_bytes()[0..copy_len]);
        err.with_path(&self.path_buf[0..copy_len])
    }

    pub fn walk(&mut self) -> Result<Maybe<()>, Error> {
        if self.pattern_components.is_empty() {
            return Ok(Maybe::Ok(()));
        }

        let mut iter = Iterator::new(self);
        if let Maybe::Err(err) = iter.init()? {
            return Ok(Maybe::Err(err));
        }

        loop {
            let path = match iter.next()? {
                Maybe::Err(err) => return Ok(Maybe::Err(err)),
                Maybe::Ok(matched_path) => matched_path,
            };
            let Some(path) = path else { break };
            log!("walker: matched path: {}", bstr::BStr::new(&path));
            // The paths are already put into self.matched_paths, which we use for the output,
            // so we don't need to do anything here
            let _ = path;
        }

        Ok(Maybe::Ok(()))
    }

    // NOTE you must check that the pattern at `idx` has `syntax_hint == .Dot` or
    // `syntax_hint == .DotBack` first
    //
    // PORT NOTE: reshaped for borrowck — Zig passed `dir_path: *[:0]u8` (a fat
    // slice into `path_buf`). Rust passes `dir_path_len: &mut usize` instead.
    fn collapse_dots(
        &mut self,
        idx: u32,
        dir_path_len: &mut usize,
        path_buf: &mut PathBuffer,
        encountered_dot_dot: &mut bool,
    ) -> Maybe<u32> {
        let mut component_idx = idx;
        let mut len = *dir_path_len;
        while (component_idx as usize) < self.pattern_components.len() {
            match self.pattern_components[component_idx as usize].syntax_hint {
                SyntaxHint::Dot => {
                    if len + 2 >= MAX_PATH_BYTES {
                        // SAFETY: path_buf[len] == 0 from prior writes
                        let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), len) };
                        return Maybe::Err(self.handle_sys_err_with_path(
                            SysError::from_code(E::NAMETOOLONG, Syscall::Tag::Open),
                            z,
                        ));
                    }
                    if len == 0 {
                        path_buf[len] = b'.';
                        path_buf[len + 1] = 0;
                        len += 1;
                    } else {
                        path_buf[len] = b'/';
                        path_buf[len + 1] = b'.';
                        path_buf[len + 2] = 0;
                        len += 2;
                    }
                    component_idx += 1;
                }
                SyntaxHint::DotBack => {
                    *encountered_dot_dot = true;
                    if len + 3 >= MAX_PATH_BYTES {
                        // SAFETY: path_buf[len] == 0 from prior writes
                        let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), len) };
                        return Maybe::Err(self.handle_sys_err_with_path(
                            SysError::from_code(E::NAMETOOLONG, Syscall::Tag::Open),
                            z,
                        ));
                    }
                    if len == 0 {
                        path_buf[len] = b'.';
                        path_buf[len + 1] = b'.';
                        path_buf[len + 2] = 0;
                        len += 2;
                    } else {
                        path_buf[len] = b'/';
                        path_buf[len + 1] = b'.';
                        path_buf[len + 2] = b'.';
                        path_buf[len + 3] = 0;
                        len += 3;
                    }
                    component_idx += 1;
                }
                _ => break,
            }
        }

        *dir_path_len = len;

        Maybe::Ok(component_idx)
    }

    // NOTE you must check that the pattern at `idx` has `syntax_hint == .Double` first
    fn collapse_successive_double_wildcards(&self, idx: u32) -> u32 {
        let mut component_idx = idx;
        let _pattern = &self.pattern_components[idx as usize];
        // Collapse successive double wildcards
        while (component_idx + 1) as usize < self.pattern_components.len()
            && self.pattern_components[(component_idx + 1) as usize].syntax_hint
                == SyntaxHint::Double
        {
            component_idx += 1;
        }
        component_idx
    }

    pub fn skip_special_components(
        &mut self,
        work_item_idx: u32,
        dir_path_len: &mut usize,
        scratch_path_buf: &mut PathBuffer,
        encountered_dot_dot: &mut bool,
    ) -> Maybe<u32> {
        let mut component_idx = work_item_idx;

        if (component_idx as usize) < self.pattern_components.len() {
            // Skip `.` and `..` while also appending them to `dir_path`
            component_idx = match self.pattern_components[component_idx as usize].syntax_hint {
                SyntaxHint::Dot | SyntaxHint::DotBack => match self.collapse_dots(
                    component_idx,
                    dir_path_len,
                    scratch_path_buf,
                    encountered_dot_dot,
                ) {
                    Maybe::Err(e) => return Maybe::Err(e),
                    Maybe::Ok(i) => i,
                },
                _ => component_idx,
            };
        }

        if (component_idx as usize) < self.pattern_components.len() {
            // Skip to the last `**` if there is a chain of them
            component_idx = match self.pattern_components[component_idx as usize].syntax_hint {
                SyntaxHint::Double => self.collapse_successive_double_wildcards(component_idx),
                _ => component_idx,
            };
        }

        Maybe::Ok(component_idx)
    }

    fn match_pattern_dir(
        &self,
        pattern: &Component,
        next_pattern: Option<&Component>,
        entry_name: &[u8],
        component_idx: u32,
        is_last: bool,
        add: &mut bool,
    ) -> Option<u32> {
        if !self.dot && Self::starts_with_dot(entry_name) {
            return None;
        }
        if (self.is_ignored)(entry_name) {
            return None;
        }

        // Handle double wildcard `**`, this could possibly
        // propagate the `**` to the directory's children
        if pattern.syntax_hint == SyntaxHint::Double {
            // Stop the double wildcard if it matches the pattern afer it
            // Example: src/**/*.js
            // - Matches: src/bun.js/
            //            src/bun.js/foo/bar/baz.js
            if !is_last && self.match_pattern_impl(next_pattern.unwrap(), entry_name) {
                // But if the next pattern is the last
                // component, it should match and propagate the
                // double wildcard recursion to the directory's
                // children
                if (component_idx + 1) as usize == self.pattern_components.len() - 1 {
                    *add = true;
                    return Some(0);
                }

                // In the normal case skip over the next pattern
                // since we matched it, example:
                // BEFORE: src/**/node_modules/**/*.js
                //              ^
                //  AFTER: src/**/node_modules/**/*.js
                //                             ^
                return Some(2);
            }

            if is_last {
                *add = true;
            }

            return Some(0);
        }

        let matches = self.match_pattern_impl(pattern, entry_name);
        if matches {
            if is_last {
                *add = true;
                return None;
            }
            return Some(1);
        }

        None
    }

    /// A file can only match if:
    /// a) it matches against the last pattern, or
    /// b) it matches the next pattern, provided the current
    ///    pattern is a double wildcard and the next pattern is
    ///    not a double wildcard
    ///
    /// Examples:
    /// a -> `src/foo/index.ts` matches
    /// b -> `src/**/*.ts` (on 2nd pattern) matches
    fn match_pattern_file(
        &self,
        entry_name: &[u8],
        component_idx: u32,
        is_last: bool,
        pattern: &Component,
        next_pattern: Option<&Component>,
    ) -> bool {
        if pattern.trailing_sep {
            return false;
        }

        // Handle case b)
        if !is_last {
            return pattern.syntax_hint == SyntaxHint::Double
                && (component_idx + 1) as usize
                    == self.pattern_components.len().saturating_sub(1)
                && next_pattern.unwrap().syntax_hint != SyntaxHint::Double
                && self.match_pattern_impl(next_pattern.unwrap(), entry_name);
        }

        // Handle case a)
        self.match_pattern_impl(pattern, entry_name)
    }

    fn match_pattern_impl(&self, pattern_component: &Component, filepath: &[u8]) -> bool {
        log!("matchPatternImpl: {}", bstr::BStr::new(filepath));
        if !self.dot && Self::starts_with_dot(filepath) {
            return false;
        }
        if (self.is_ignored)(filepath) {
            return false;
        }

        match pattern_component.syntax_hint {
            SyntaxHint::Double | SyntaxHint::Single => true,
            SyntaxHint::WildcardFilepath => {
                match_wildcard_filepath(pattern_component.pattern_slice(&self.pattern), filepath)
            }
            SyntaxHint::Literal => {
                match_wildcard_literal(pattern_component.pattern_slice(&self.pattern), filepath)
            }
            _ => self.match_pattern_slow(pattern_component, filepath),
        }
    }

    fn match_pattern_slow(&self, pattern_component: &Component, filepath: &[u8]) -> bool {
        bun_glob::r#match(pattern_component.pattern_slice(&self.pattern), filepath).matches()
    }

    /// Create an empty ComponentSet sized for this pattern.
    fn make_set(&self) -> ComponentSet {
        // Zig wrapped in handleOom; Rust aborts on OOM.
        ComponentSet::init_empty(self.pattern_components.len())
    }

    fn single_set(&self, idx: u32) -> ComponentSet {
        let mut s = self.make_set();
        s.set(idx as usize);
        s
    }

    /// Evaluate a directory entry against all active component indices.
    /// Returns the child's active set (union of all recursion targets).
    /// Sets `add` if any index says the directory itself is a match.
    fn eval_dir(&self, active: &ComponentSet, entry_name: &[u8], add: &mut bool) -> ComponentSet {
        let mut child = self.make_set();
        let comps = &self.pattern_components;
        let len: u32 = u32::try_from(comps.len()).unwrap();
        let mut it = active.iterator(Default::default());
        while let Some(i) = it.next() {
            let idx: u32 = u32::try_from(i).unwrap();
            let pattern = &comps[idx as usize];
            let next_pattern = if idx + 1 < len {
                Some(&comps[(idx + 1) as usize])
            } else {
                None
            };
            let is_last = idx == len - 1;
            let mut add_this = false;
            if let Some(bump) =
                self.match_pattern_dir(pattern, next_pattern, entry_name, idx, is_last, &mut add_this)
            {
                child.set(self.normalize_idx(idx + bump) as usize);
                // At `**/X` boundaries, keep the outer `**` alive unless
                // idx+2 is itself `**` (whose recursion already covers it).
                if bump == 2 && comps[(idx + 2) as usize].syntax_hint != SyntaxHint::Double {
                    child.set(idx as usize);
                }
            }
            if add_this {
                *add = true;
            }
        }
        child
    }

    fn eval_file(&self, active: &ComponentSet, entry_name: &[u8]) -> bool {
        let comps = &self.pattern_components;
        let len: u32 = u32::try_from(comps.len()).unwrap();
        let mut it = active.iterator(Default::default());
        while let Some(i) = it.next() {
            let idx: u32 = u32::try_from(i).unwrap();
            let pattern = &comps[idx as usize];
            let next_pattern = if idx + 1 < len {
                Some(&comps[(idx + 1) as usize])
            } else {
                None
            };
            let is_last = idx == len - 1;
            if self.match_pattern_file(entry_name, idx, is_last, pattern, next_pattern) {
                return true;
            }
        }
        false
    }

    fn eval_impl(&self, active: &ComponentSet, entry_name: &[u8]) -> bool {
        let mut it = active.iterator(Default::default());
        while let Some(idx) = it.next() {
            if self.match_pattern_impl(&self.pattern_components[idx], entry_name) {
                return true;
            }
        }
        false
    }

    #[inline]
    fn normalize_idx(&self, idx: u32) -> u32 {
        if (idx as usize) < self.pattern_components.len()
            && self.pattern_components[idx as usize].syntax_hint == SyntaxHint::Double
        {
            return self.collapse_successive_double_wildcards(idx);
        }
        idx
    }

    #[inline]
    fn matched_path_to_bun_string(matched_path: &[u8]) -> BunString {
        // PORT NOTE: in Zig, MatchedPath is `[:0]const u8` (len excludes NUL) and
        // this fn re-slices `[0..len+1]` to include it. In the port, MatchedPath is
        // `Box<[u8]>` and join()/dupe_z() already include the trailing NUL when
        // SENTINEL is true, so callers pass the full slice and no `+1` is needed.
        BunString::from_bytes(matched_path)
    }

    fn prepare_matched_path_symlink(
        &mut self,
        symlink_full_path: &[u8],
    ) -> Result<Option<MatchedPath>, AllocError> {
        let result = self
            .matched_paths
            .get_or_put(BunString::from_bytes(symlink_full_path));
        if result.found_existing {
            log!("(dupe) prepared match: {}", bstr::BStr::new(symlink_full_path));
            return Ok(None);
        }
        if !SENTINEL {
            let slice: Box<[u8]> = Box::from(symlink_full_path);
            *result.key_ptr = Self::matched_path_to_bun_string(&slice);
            return Ok(Some(slice));
        }
        let slicez = dupe_z(symlink_full_path);
        *result.key_ptr = Self::matched_path_to_bun_string(&slicez);
        Ok(Some(slicez))
    }

    fn prepare_matched_path(
        &mut self,
        entry_name: &[u8],
        dir_name: &[u8],
    ) -> Result<Option<MatchedPath>, AllocError> {
        let subdir_parts: &[&[u8]] = &[&dir_name[0..dir_name.len()], entry_name];
        let name_matched_path = self.join(subdir_parts)?;
        let name = Self::matched_path_to_bun_string(&name_matched_path);
        let result = self.matched_paths.get_or_put_value(name.clone(), ());
        if result.found_existing {
            log!("(dupe) prepared match: {}", bstr::BStr::new(&name_matched_path));
            return Ok(None);
        }
        *result.key_ptr = name;
        // if SENTINEL { return name[0..name.len()-1 :0]; }
        log!("prepared match: {}", bstr::BStr::new(&name_matched_path));
        Ok(Some(name_matched_path))
    }

    fn append_matched_path(
        &mut self,
        entry_name: &[u8],
        dir_name: &ZStr,
    ) -> Result<(), AllocError> {
        let subdir_parts: &[&[u8]] = &[dir_name.as_bytes(), entry_name];
        let name_matched_path = self.join(subdir_parts)?;
        let name = Self::matched_path_to_bun_string(&name_matched_path);
        let result = self.matched_paths.get_or_put(name.clone());
        if result.found_existing {
            log!("(dupe) prepared match: {}", bstr::BStr::new(&name_matched_path));
            return Ok(());
        }
        *result.key_ptr = name;
        Ok(())
    }

    fn append_matched_path_symlink(&mut self, symlink_full_path: &[u8]) -> Result<(), AllocError> {
        let name: Box<[u8]> = Box::from(symlink_full_path);
        self.matched_paths.put(BunString::from_bytes(&name), ());
        // TODO(port): lifetime — BunString::from_bytes borrows; Zig arena kept it alive.
        Ok(())
    }

    #[inline]
    fn join(&self, subdir_parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        if !self.absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path
            // TODO(port): std.fs.path.join / joinZ — bun_paths needs a non-normalizing join.
            return Ok(std_join::<SENTINEL>(subdir_parts));
        }

        let joined = bun_join::<SENTINEL>(subdir_parts, bun_paths::Platform::Auto);
        let out: Box<[u8]> = Box::from(joined);
        // For SENTINEL, bun_join already included trailing NUL in the slice it returned.
        Ok(out)
    }

    #[inline]
    fn starts_with_dot(filepath: &[u8]) -> bool {
        !filepath.is_empty() && filepath[0] == b'.'
    }

    const SYNTAX_TOKENS: &'static [u8] = b"*[{?!";

    fn check_special_syntax(pattern: &[u8]) -> bool {
        strings::index_of_any(pattern, Self::SYNTAX_TOKENS).is_some()
    }

    fn make_component(
        pattern: &[u8],
        start_byte: u32,
        end_byte: u32,
        has_relative_patterns: &mut bool,
    ) -> Option<Component> {
        let mut component = Component {
            start: start_byte,
            len: end_byte - start_byte,
            ..Default::default()
        };
        if component.len == 0 {
            return None;
        }

        'out: {
            let comp_slice =
                &pattern[component.start as usize..(component.start + component.len) as usize];
            if comp_slice == b"." {
                component.syntax_hint = SyntaxHint::Dot;
                *has_relative_patterns = true;
                break 'out;
            }
            if comp_slice == b".." {
                component.syntax_hint = SyntaxHint::DotBack;
                *has_relative_patterns = true;
                break 'out;
            }

            if !Self::check_special_syntax(comp_slice) {
                component.syntax_hint = SyntaxHint::Literal;
                break 'out;
            }

            match component.len {
                1 => {
                    if pattern[component.start as usize] == b'*' {
                        component.syntax_hint = SyntaxHint::Single;
                    }
                    break 'out;
                }
                2 => {
                    if pattern[component.start as usize] == b'*'
                        && pattern[(component.start + 1) as usize] == b'*'
                    {
                        component.syntax_hint = SyntaxHint::Double;
                        break 'out;
                    }
                }
                _ => {}
            }

            'out_of_check_wildcard_filepath: {
                if component.len > 1
                    && pattern[component.start as usize] == b'*'
                    && pattern[(component.start + 1) as usize] == b'.'
                    && (component.start + 2) as usize < pattern.len()
                {
                    for &c in &pattern[(component.start + 2) as usize..] {
                        match c {
                            // The fast path checks that path[1..] == pattern[1..],
                            // this will obviously not work if additional
                            // glob syntax is present in the pattern, so we
                            // must not apply this optimization if we see
                            // special glob syntax.
                            //
                            // This is not a complete check, there can be
                            // false negatives, but that's okay, it just
                            // means we don't apply the optimization.
                            //
                            // We also don't need to look for the `!` token,
                            // because that only applies negation if at the
                            // beginning of the string.
                            b'[' | b'{' | b'?' | b'*' => break 'out_of_check_wildcard_filepath,
                            _ => {}
                        }
                    }
                    component.syntax_hint = SyntaxHint::WildcardFilepath;
                    break 'out;
                }
            }
        }

        if component.syntax_hint != SyntaxHint::Single
            && component.syntax_hint != SyntaxHint::Double
        {
            if strings::is_all_ascii(
                &pattern[component.start as usize..(component.start + component.len) as usize],
            ) {
                component.is_ascii = true;
            }
        } else {
            component.is_ascii = true;
        }

        let last_idx = (component.start + component.len).saturating_sub(1) as usize;
        if pattern[last_idx] == b'/' {
            component.trailing_sep = true;
        } else {
            #[cfg(windows)]
            {
                component.trailing_sep = pattern[last_idx] == b'\\';
            }
        }

        Some(component)
    }

    /// Build an ad-hoc glob pattern. Useful when you don't need to traverse
    /// a directory.
    pub fn build_pattern(
        pattern_components: &mut Vec<Component>,
        pattern: &[u8],
        has_relative_patterns: &mut bool,
        end_byte_of_basename_excluding_special_syntax: Option<&mut u32>,
        basename_excluding_special_syntax_component_idx: Option<&mut u32>,
    ) -> Result<(), AllocError> {
        // in case the consumer doesn't care about some outputs.
        let mut scratchpad: [u32; 3] = [0; 3];
        let (s1, rest) = scratchpad.split_at_mut(2);
        Self::build_pattern_components(
            pattern_components,
            pattern,
            has_relative_patterns,
            end_byte_of_basename_excluding_special_syntax.unwrap_or(&mut s1[1]),
            basename_excluding_special_syntax_component_idx.unwrap_or(&mut rest[0]),
        )
    }

    fn build_pattern_components(
        pattern_components: &mut Vec<Component>,
        pattern: &[u8],
        has_relative_patterns: &mut bool,
        end_byte_of_basename_excluding_special_syntax: &mut u32,
        basename_excluding_special_syntax_component_idx: &mut u32,
    ) -> Result<(), AllocError> {
        let mut start_byte: u32 = 0;

        let mut prev_is_backslash = false;
        let mut saw_special = false;
        let mut i: u32 = 0;
        let mut width: u32 = 0;
        while (i as usize) < pattern.len() {
            let c = pattern[i as usize];
            width = u32::from(strings::utf8_byte_sequence_length(c));

            match c {
                b'\\' => {
                    #[cfg(windows)]
                    {
                        let mut end_byte = i;
                        // is last char
                        if (i + width) as usize == pattern.len() {
                            end_byte += width;
                        }
                        if let Some(component) =
                            Self::make_component(pattern, start_byte, end_byte, has_relative_patterns)
                        {
                            saw_special = saw_special || component.syntax_hint.is_special_syntax();
                            if !saw_special {
                                *basename_excluding_special_syntax_component_idx =
                                    u32::try_from(pattern_components.len()).unwrap();
                                *end_byte_of_basename_excluding_special_syntax = i + width;
                            }
                            pattern_components.push(component);
                        }
                        start_byte = i + width;
                        i += 1;
                        continue;
                    }

                    #[cfg(not(windows))]
                    {
                        if prev_is_backslash {
                            prev_is_backslash = false;
                            i += 1;
                            continue;
                        }

                        prev_is_backslash = true;
                    }
                }
                b'/' => {
                    let mut end_byte = i;
                    // is last char
                    if (i + width) as usize == pattern.len() {
                        end_byte += width;
                    }
                    if let Some(component) =
                        Self::make_component(pattern, start_byte, end_byte, has_relative_patterns)
                    {
                        saw_special = saw_special || component.syntax_hint.is_special_syntax();
                        if !saw_special {
                            *basename_excluding_special_syntax_component_idx =
                                u32::try_from(pattern_components.len()).unwrap();
                            *end_byte_of_basename_excluding_special_syntax = i + width;
                        }
                        pattern_components.push(component);
                    }
                    start_byte = i + width;
                }
                // TODO: Support other escaping glob syntax
                _ => {}
            }
            i += 1;
        }
        let _ = prev_is_backslash;
        debug_assert!(i == 0 || i as usize == pattern.len());
        i = i.saturating_sub(1);

        if let Some(component) = Self::make_component(
            pattern,
            start_byte,
            u32::try_from(pattern.len()).unwrap(),
            has_relative_patterns,
        ) {
            saw_special = saw_special || component.syntax_hint.is_special_syntax();
            if !saw_special {
                *basename_excluding_special_syntax_component_idx =
                    u32::try_from(pattern_components.len()).unwrap();
                *end_byte_of_basename_excluding_special_syntax = i + width;
            }
            pattern_components.push(component);
        } else if !saw_special {
            *basename_excluding_special_syntax_component_idx =
                u32::try_from(pattern_components.len()).unwrap();
            *end_byte_of_basename_excluding_special_syntax = i + width;
        }

        Ok(())
    }
}

/// NOTE This also calls deinit on the arena, if you don't want to do that then
// Zig: pub fn deinit(this: *GlobWalker, comptime clear_arena: bool)
// PERF(port): was arena bulk-free — Drop frees Vec/Box fields automatically.
impl<A: Accessor, const SENTINEL: bool> Drop for GlobWalker<A, SENTINEL> {
    fn drop(&mut self) {
        log!("GlobWalker.deinit");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Free functions
// ─────────────────────────────────────────────────────────────────────────────

#[inline]
pub fn is_separator(c: Codepoint) -> bool {
    #[cfg(windows)]
    {
        return c == u32::from(b'/') || c == u32::from(b'\\');
    }
    #[cfg(not(windows))]
    {
        c == u32::from(b'/')
    }
}

#[inline]
fn unescape(c: &mut u32, glob: &[u32], glob_index: &mut u32) -> bool {
    if *c == u32::from(b'\\') {
        *glob_index += 1;
        if *glob_index as usize >= glob.len() {
            return false; // Invalid pattern!
        }

        *c = match glob[*glob_index as usize] {
            x if x == u32::from(b'a') => 0x61,
            x if x == u32::from(b'b') => 0x08,
            x if x == u32::from(b'n') => u32::from(b'\n'),
            x if x == u32::from(b'r') => u32::from(b'\r'),
            x if x == u32::from(b't') => u32::from(b'\t'),
            cc => cc,
        };
    }

    true
}

const GLOB_STAR_MATCH_STR: &[u32] = &[b'/' as u32, b'*' as u32, b'*' as u32];

// src/**/**/foo.ts
#[inline]
fn skip_globstars(glob: &[u32], glob_index: &mut u32) {
    *glob_index += 2;

    // Coalesce multiple ** segments into one.
    while (*glob_index + 3) as usize <= glob.len()
        && &glob[*glob_index as usize..(*glob_index + 3) as usize] == GLOB_STAR_MATCH_STR
    {
        *glob_index += 3;
    }

    *glob_index -= 2;
}

pub fn match_wildcard_filepath(glob: &[u8], path: &[u8]) -> bool {
    let needle = &glob[1..];
    let needle_len: u32 = u32::try_from(needle.len()).unwrap();
    if path.len() < needle_len as usize {
        return false;
    }
    needle == &path[path.len() - needle_len as usize..]
}

pub fn match_wildcard_literal(literal: &[u8], path: &[u8]) -> bool {
    literal == path
}

// ─────────────────────────────────────────────────────────────────────────────
// Port helpers (no Zig equivalent — replaces arena.dupeZ / std/bun join dispatch)
// ─────────────────────────────────────────────────────────────────────────────

/// `allocator.dupeZ(u8, s)` — returns owned bytes with trailing NUL included
/// at index `len()-1`.
fn dupe_z(s: &[u8]) -> Box<[u8]> {
    let mut v = Vec::with_capacity(s.len() + 1);
    v.extend_from_slice(s);
    v.push(0);
    v.into_boxed_slice()
}

// const stdJoin = if (!sentinel) std.fs.path.join else std.fs.path.joinZ;
// TODO(port): std.fs.path.join / joinZ — needs a bun_paths helper that joins
// with platform separator WITHOUT normalizing. Placeholder implementation.
fn std_join<const SENTINEL: bool>(parts: &[&[u8]]) -> Box<[u8]> {
    let mut out: Vec<u8> = Vec::new();
    let mut first = true;
    for p in parts {
        if p.is_empty() {
            continue;
        }
        if !first {
            out.push(bun_paths::SEP);
        }
        first = false;
        out.extend_from_slice(p);
    }
    if SENTINEL {
        out.push(0);
    }
    out.into_boxed_slice()
}

// const bunJoin = if (!sentinel) ResolvePath.join else ResolvePath.joinZ;
fn bun_join<const SENTINEL: bool>(parts: &[&[u8]], platform: bun_paths::Platform) -> Box<[u8]> {
    if SENTINEL {
        let s = resolve_path::join_z(parts, platform);
        // include trailing NUL in the owned box (Zig: out[0..out.len-1 :0])
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v.into_boxed_slice()
    } else {
        Box::from(resolve_path::join(parts, platform))
    }
}

// TODO(port): AccessorDirEntry impl for DirIterator::IteratorResult lives in bun_runtime.
impl AccessorDirEntry for DirIterator::IteratorResult {
    fn name_slice(&self) -> &[u8] {
        self.name.slice()
    }
    fn kind(&self) -> bun_sys::FileKind {
        self.kind
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/glob/GlobWalker.zig (1857 lines)
//   confidence: medium
//   todos:      12
//   notes:      Arena removed (non-AST crate); Directory.dir_path reshaped to len+buf to avoid self-reference; Accessor duck-typing → trait; ignore_filter_fn lowered to runtime fn ptr; SENTINEL MatchedPath = Box<[u8]> that already includes the trailing NUL (matched_path_to_bun_string takes the full slice); alloc-only fns return Result<_, AllocError> — Phase B should revisit BunString lifetime tying to owned paths.
// ──────────────────────────────────────────────────────────────────────────
