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
use bun_core::env::IS_WINDOWS;
use bun_core::strings::{self, UnsignedCodepointIterator as CodepointIterator};
use bun_core::{String as BunString, ZStr};
use bun_core::define_scoped_log;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, resolve_path};
use bun_sys::dir_iterator as DirIterator;
use bun_sys::{self as Syscall, E, Error as SysError, Fd, FdExt, O, Result as Maybe, S, Stat};

// const Codepoint = u32;

define_scoped_log!(log, Glob, visible);

type Cursor = strings::Cursor;
// PORT NOTE: Zig's `CodepointIterator.Cursor.CodePointType` is `u32` (UnsignedCodepointIterator).
// The bun_string Cursor stores `c: i32`; cast at the assignment sites.
type Codepoint = u32;

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
        self.cursor.c = next_cp as _;
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
    use bun_paths::resolve_path::{self, platform};
    // Zig uses a SINGLE stack `bun.PathBuffer` for both `getFdPath` and
    // `joinZBuf` (the join assembles parts into a temp scratch first, so the
    // in/out alias is benign there). Rust's `&mut`/`&` aliasing rules forbid
    // passing the same buffer as both `join_z_buf`'s output and an input part,
    // so we still need two buffers — but on Windows `PathBuffer` is ~96 KB,
    // and this is called from deep inside `Iterator::next()` (via `lstatat`
    // for `FileKind::Unknown`), so two stack `PathBuffer`s (~192 KB, zero-
    // initialized by `PathBuffer::uninit()`) risk overflowing the smaller
    // worker-thread stacks. Draw both from the per-thread heap pool instead
    // (uninit, RAII-returned) — zero stack footprint, no zero-fill.
    let mut dir_buf = bun_paths::path_buffer_pool::get();
    let dir = Syscall::get_fd_path(fd, &mut dir_buf)?;
    let parts: &[&[u8]] = &[&dir[..], path.as_bytes()];
    let mut join_buf = bun_paths::path_buffer_pool::get();
    let statpath = resolve_path::join_z_buf::<platform::Auto>(&mut join_buf[..], parts);
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
            value: DirIterator::iterate(dir.value),
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
        Ok(Syscall::open(path, O::DIRECTORY | O::RDONLY, 0).map(|fd| SyscallHandle { value: fd }))
    }

    fn statat(handle: SyscallHandle, path: &ZStr) -> Maybe<Stat> {
        #[cfg(windows)]
        {
            return statat_windows(handle.value, path);
        }
        #[cfg(not(windows))]
        Syscall::fstatat(handle.value, path)
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
            Syscall::openat(handle.value, path, O::DIRECTORY | O::RDONLY, 0)
                .map(|fd| SyscallHandle { value: fd }),
        )
    }

    fn close(handle: SyscallHandle) -> Option<SysError> {
        // TODO(port): @returnAddress() — Rust has no stable equivalent; pass None.
        handle.value.close_allowing_bad_file_descriptor(None)
    }

    fn getcwd(path_buf: &mut PathBuffer) -> Maybe<&[u8]> {
        let len = Syscall::getcwd(&mut path_buf[..])?;
        Ok(&path_buf[..len])
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DirEntryAccessor
// ─────────────────────────────────────────────────────────────────────────────
// MOVED: `DirEntryAccessor` lives in `bun_resolver::dir_entry_accessor` —
// the full DirEntry cache (`DirEntry`, `EntryMap`, `read_directory`,
// `EntriesOption`) is owned by `bun_resolver` (higher-tier). Per PORTING.md
// §Dispatch this is the "low-tier owns the trait, high-tier owns the impl"
// case: the `Accessor` trait is exported here and `bun_resolver` provides
// `impl bun_glob::walk::Accessor for DirEntryAccessor`. Keeping it in
// `bun_glob` would create an upward dependency edge (bun_glob → bun_resolver).

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

    pub path_buf: Box<PathBuffer>,
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
// PORT NOTE: Zig keys this on `BunString` so `.keys()` can hand a slice
// straight to `BunString.toJSArray`. `to_js_array` lives in a `*_jsc` crate
// (per PORTING.md §Strings, `.toJS` is only callable there), so the JS-array
// fast path moves up-tier anyway and there's no win keeping `BunString` keys
// here. Use `StringArrayHashMap<()>` (boxed `[u8]` keys); the JSC consumer
// rebuilds `BunString`s from `.keys()`.
// TODO(port): Phase B — wire `MatchedMapContext` as a `StringArrayHashMap`
// custom context once SENTINEL-aware hashing matters (currently the trailing
// NUL is part of the key so dedupe is still exact).
pub type MatchedMap = bun_collections::StringArrayHashMap<()>;

pub struct MatchedMapContext;
// TODO(port): ArrayHashMap context trait shape — Phase B wires the actual trait.
impl MatchedMapContext {
    pub fn hash(&self, this: &BunString) -> u32 {
        debug_assert!(this.tag() == bun_core::Tag::ZigString);
        let slice = this.byte_slice();
        // For SENTINEL the slice includes trailing NUL; hash excludes it.
        // TODO(port): const-generic SENTINEL not reachable here; Zig branched at comptime.
        // Phase B: thread `SENTINEL` through `MatchedMapContext` (or strip the NUL at
        // insert time so the key never carries it).
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
    pub path: Box<PathBuffer>,
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
        // path[dir_path_len] == 0 was written by transition_to_dir_iter_state
        ZStr::from_buf(&self.path[..], self.dir_path_len)
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
        log!(
            "Iterator init pattern={}",
            bstr::BStr::new(&self.walker.pattern)
        );
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
                    // Matched-path payload must respect SENTINEL (Zig: MatchedPath
                    // = if (sentinel) [:0]const u8 else []const u8). The open()
                    // probe always needs a NUL — use a separate dupeZ for it so
                    // SENTINEL=false matched paths don't carry a spurious 0x00.
                    let path = dupe_matched::<SENTINEL>(path_without_special_syntax);
                    let pathz_owned = dupe_z(path_without_special_syntax);
                    // SAFETY: dupe_z appends NUL at len()-1; ZStr len excludes it.
                    let pathz = ZStr::from_slice_with_nul(&pathz_owned[..]);
                    let fd = match A::open(pathz)? {
                        Err(e) => {
                            if e.get_errno() == E::ENOTDIR {
                                self.iter_state = IterState::Matched(path);
                                return Ok(Ok(()));
                            }
                            // Doesn't exist
                            if e.get_errno() == E::ENOENT {
                                self.iter_state = IterState::GetNext;
                                return Ok(Ok(()));
                            }
                            return Ok(Err(e.with_path(matched_as_slice::<SENTINEL>(&path))));
                        }
                        Ok(fd) => fd,
                    };
                    let _ = A::close(fd);
                    self.iter_state = IterState::Matched(path);
                    return Ok(Ok(()));
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

        // PORT NOTE: reshaped for borrowck — `path_buf` aliases `self.walker.path_buf`;
        // capture the raw ptr+len up front so the &mut borrow ends before
        // `handle_sys_err_with_path` re-borrows `self.walker`.
        let root_path = &root_work_item.path;
        let (path_buf_ptr, root_path_len) = {
            let path_buf: &mut PathBuffer = &mut *self.walker.path_buf;
            if root_path.len() >= path_buf.len() {
                return Ok(Err(SysError::from_code(
                    E::ENAMETOOLONG,
                    Syscall::Tag::open,
                )
                .with_path(root_path)));
            }
            path_buf[0..root_path.len()].copy_from_slice(&root_path[0..root_path.len()]);
            path_buf[root_path.len()] = 0;
            (path_buf.as_ptr(), root_path.len())
        };
        // SAFETY: path_buf[root_path_len] == 0 written above; buffer outlives `cwd_fd` open call.
        let root_path_z = unsafe { ZStr::from_raw(path_buf_ptr, root_path_len) };
        let cwd_fd = match A::open(root_path_z)? {
            Err(err) => {
                let len = root_path_len + 1;
                return Ok(Err(self.walker.handle_sys_err_with_path(
                    err,
                    // SAFETY: NUL at index len-1 written above
                    unsafe { ZStr::from_raw(path_buf_ptr, len) },
                )));
            }
            Ok(fd) => fd,
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
        if let Err(err) = trans {
            return Ok(Err(err));
        }

        Ok(Ok(()))
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
        // For SENTINEL=true, `MatchedPath`-derived WorkItem paths carry a trailing
        // NUL in their `.len()`; the logical path drops it (see `work_item_logical_path`).
        let work_item_path: &[u8] = work_item_logical_path(&work_item.path);
        log!("transition => {}", bstr::BStr::new(work_item_path));
        // PORT NOTE: reshaped for borrowck — Zig set `iter_state = .{ .directory = .{...} }`
        // up front and then mutated `this.iter_state.directory.*` while also borrowing
        // `this.walker`. Build the Directory in a local and assign at the end.
        let mut dir_path_buf = Box::new(PathBuffer::uninit());
        let mut dir_path_len: usize = 'dir_path: {
            if ROOT {
                if !self.walker.absolute {
                    dir_path_buf[0] = 0;
                    break 'dir_path 0;
                }
            }
            // TODO Optimization: On posix systems filepaths are already null byte terminated so we can skip this if thats the case
            if work_item_path.len() >= dir_path_buf.len() {
                if let Some(fd) = work_item.fd {
                    self.close_disallowing_cwd(fd);
                }
                return Ok(Err(SysError::from_code(
                    E::ENAMETOOLONG,
                    Syscall::Tag::open,
                )
                .with_path(work_item_path)));
            }
            dir_path_buf[0..work_item_path.len()].copy_from_slice(work_item_path);
            dir_path_buf[work_item_path.len()] = 0;
            work_item_path.len()
        };

        let mut had_dot_dot = false;
        // Single-index sets (the initial WorkItem) may point to Dot/DotBack
        // or collapsible `**` runs. Multi-index sets only arise mid-traversal
        // after `**/X` boundaries and are already past any Dots.
        let active: ComponentSet = 'set: {
            if work_item.active.count() == 1 {
                let single: u32 =
                    u32::try_from(work_item.active.find_first_set().unwrap()).expect("int cast");
                let norm = match self.walker.skip_special_components(
                    single,
                    &mut dir_path_len,
                    &mut *dir_path_buf,
                    &mut had_dot_dot,
                ) {
                    Err(e) => {
                        if let Some(fd) = work_item.fd {
                            self.close_disallowing_cwd(fd);
                        }
                        return Ok(Err(e));
                    }
                    Ok(i) => i,
                };
                if norm as usize >= self.walker.pattern_components.len() {
                    if let Some(fd) = work_item.fd {
                        self.close_disallowing_cwd(fd);
                    }
                    self.iter_state = IterState::GetNext;
                    return Ok(Ok(()));
                }
                break 'set self.walker.single_set(norm);
            }
            // Multi-index sets are already normalized by eval_dir.
            work_item.active
        };

        // SAFETY: dir_path_buf[dir_path_len] == 0 written above (or by collapse_dots)
        let dir_path = ZStr::from_buf(&dir_path_buf[..], dir_path_len);

        let mut at_cwd = false;
        let fd: A::Handle = 'fd: {
            if let Some(fd) = work_item.fd {
                break 'fd fd;
            }
            if ROOT {
                if had_dot_dot {
                    break 'fd match A::openat(self.cwd_fd, dir_path)? {
                        Err(err) => {
                            return Ok(Err(self.walker.handle_sys_err_with_path(err, dir_path)));
                        }
                        Ok(fd_) => {
                            self.bump_open_fds();
                            fd_
                        }
                    };
                }

                at_cwd = true;
                break 'fd self.cwd_fd;
            }

            match A::openat(self.cwd_fd, dir_path)? {
                Err(err) => {
                    return Ok(Err(self.walker.handle_sys_err_with_path(err, dir_path)));
                }
                Ok(fd_) => {
                    self.bump_open_fds();
                    fd_
                }
            }
        };

        // Literal-tail optimization: if the only active index is the last
        // component and it is a Literal, statat() instead of iterating.
        // Skip for multi-index masks since each index has different needs.
        if active.count() == 1 {
            let idx: u32 = u32::try_from(active.find_first_set().unwrap()).expect("int cast");
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
                let pathz_ref = ZStr::from_slice_with_nul(&pathz[..]);
                let stat_result: Stat = match A::statat(fd, pathz_ref) {
                    Err(e_) => {
                        let e: SysError = e_;
                        self.close_disallowing_cwd(fd);
                        if e.get_errno() == E::ENOENT {
                            self.iter_state = IterState::GetNext;
                            return Ok(Ok(()));
                        }
                        return Ok(Err(e.with_path(
                            self.walker.pattern_components[idx as usize]
                                .pattern_slice(&self.walker.pattern),
                        )));
                    }
                    Ok(stat) => stat,
                };
                self.close_disallowing_cwd(fd);
                let mode = stat_result.st_mode as u32;
                let matches = (S::ISDIR(mode) && !self.walker.only_files)
                    || S::ISREG(mode)
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
                return Ok(Ok(()));
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
                self.compute_nt_filter(
                    u32::try_from(active.find_first_set().unwrap()).expect("int cast"),
                )
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

        Ok(Ok(()))
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
            SyntaxHint::Single | SyntaxHint::Double | SyntaxHint::Dot | SyntaxHint::DotBack => {
                return None;
            }
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
        'outer: loop {
            // PORT NOTE: reshaped for borrowck — take/replace iter_state where needed.
            match &mut self.iter_state {
                IterState::Matched(_) => {
                    let IterState::Matched(path) =
                        core::mem::replace(&mut self.iter_state, IterState::GetNext)
                    else {
                        unreachable!()
                    };
                    return Ok(Ok(Some(path)));
                }
                IterState::GetNext => {
                    // Done
                    if self.walker.workbuf.is_empty() {
                        return Ok(Ok(None));
                    }
                    let work_item = self.walker.workbuf.pop().unwrap();
                    match work_item.kind {
                        WorkItemKind::Directory => {
                            if let Err(err) =
                                self.transition_to_dir_iter_state::<false>(work_item)?
                            {
                                return Ok(Err(err));
                            }
                            continue;
                        }
                        WorkItemKind::Symlink => {
                            // For SENTINEL=true the joined symlink path carries a trailing
                            // NUL in `.len()`; drop it (see `work_item_logical_path`) so the
                            // NUL re-written at `[len]` below isn't left embedded in the path.
                            let work_item_path: &[u8] = work_item_logical_path(&work_item.path);
                            if work_item_path.len() >= MAX_PATH_BYTES {
                                return Ok(Err(SysError::from_code(
                                    E::ENAMETOOLONG,
                                    Syscall::Tag::open,
                                )
                                .with_path(work_item_path)));
                            }
                            // PORT NOTE: reshaped for borrowck — Zig used `self.path_buf`
                            // both as the scratch buffer here and from inside
                            // `collapseDots`/`handleSysErrWithPath`. In Rust we split-borrow
                            // `path_buf` and `pattern_components` (disjoint fields) for the
                            // write+normalize, then drop the &mut and read via `self.walker`.
                            let mut symlink_full_path_len = work_item_path.len();
                            // PORT NOTE: reshaped for borrowck — entry_name is a sub-slice
                            // of symlink_full_path; capture range and re-slice later.
                            let entry_start = work_item.entry_start as usize;

                            let mut has_dot_dot = false;
                            let active: ComponentSet = {
                                let walker = &mut *self.walker;
                                let scratch_path_buf = &mut *walker.path_buf;
                                scratch_path_buf[0..work_item_path.len()]
                                    .copy_from_slice(work_item_path);
                                scratch_path_buf[work_item_path.len()] = 0;

                                if work_item.active.count() == 1 {
                                    let single: u32 =
                                        u32::try_from(work_item.active.find_first_set().unwrap())
                                            .unwrap();
                                    let norm = match GlobWalker::<A, SENTINEL>::skip_special_components_disjoint(
                                        &walker.pattern_components,
                                        single,
                                        &mut symlink_full_path_len,
                                        scratch_path_buf,
                                        &mut has_dot_dot,
                                    ) {
                                        Err(e) => return Ok(Err(e)),
                                        Ok(i) => i,
                                    };
                                    if norm as usize >= walker.pattern_components.len() {
                                        self.iter_state = IterState::GetNext;
                                        continue;
                                    }
                                    walker.single_set(norm)
                                } else {
                                    work_item.active
                                }
                            }; // &mut walker / scratch_path_buf dropped here

                            // Buffer is read-only from here on; read via &self.walker.
                            let scratch_ptr = self.walker.path_buf.as_ptr();
                            let symlink_full_path_z =
                                unsafe { ZStr::from_raw(scratch_ptr, symlink_full_path_len) };
                            let entry_name: &[u8] = unsafe {
                                core::slice::from_raw_parts(
                                    scratch_ptr.add(entry_start),
                                    symlink_full_path_len - entry_start,
                                )
                            };

                            self.iter_state = IterState::GetNext;
                            let maybe_dir_fd: Option<A::Handle> =
                                match A::openat(self.cwd_fd, symlink_full_path_z)? {
                                    Err(err) => 'brk: {
                                        if err.get_errno() == E::ENOTDIR {
                                            break 'brk None;
                                        }
                                        if self.walker.error_on_broken_symlinks {
                                            return Ok(Err(self.walker.handle_sys_err_with_path(
                                                err,
                                                symlink_full_path_z,
                                            )));
                                        }
                                        if !self.walker.only_files
                                            && self.walker.eval_file(&active, entry_name)
                                        {
                                            match self.walker.prepare_matched_path_symlink(
                                                symlink_full_path_z.as_bytes(),
                                            )? {
                                                Some(p) => return Ok(Ok(Some(p))),
                                                None => continue 'outer,
                                            }
                                        }
                                        continue 'outer;
                                    }
                                    Ok(fd) => {
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
                                        Some(p) => return Ok(Ok(Some(p))),
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
                                    Some(p) => return Ok(Ok(Some(p))),
                                    None => continue,
                                }
                            }

                            continue;
                        }
                    }
                }
                IterState::Directory(dir) => {
                    let entry = match dir.iter.next() {
                        Err(err) => {
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
                            return Ok(Err(err));
                        }
                        Ok(ent) => ent,
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

                    let active = dir.active.clone().expect("OOM: ComponentSet::clone");
                    let entry_name = entry.name_slice();
                    let dir_dir_path = dir.dir_path().as_bytes();
                    let dir_fd = dir.fd;
                    match entry.kind() {
                        bun_sys::FileKind::File => {
                            if self.walker.eval_file(&active, entry_name) {
                                match self.walker.prepare_matched_path(entry_name, dir_dir_path)? {
                                    Some(prepared) => return Ok(Ok(Some(prepared))),
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
                                match self.walker.prepare_matched_path(entry_name, dir_dir_path)? {
                                    Some(prepared_path) => {
                                        return Ok(Ok(Some(prepared_path)));
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
                                let entry_start: u32 = u32::try_from(if dir_dir_path.is_empty() {
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
                                match self.walker.prepare_matched_path(entry_name, dir_dir_path)? {
                                    Some(prepared_path) => {
                                        return Ok(Ok(Some(prepared_path)));
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
                            let name_z_ref = ZStr::from_slice_with_nul(&name_z[..]);
                            let stat_result = A::lstatat(dir_fd, name_z_ref);
                            let real_kind = match stat_result {
                                Ok(st) => bun_sys::kind_from_mode(st.st_mode as u32),
                                Err(_) => continue,
                            };

                            match real_kind {
                                bun_sys::FileKind::File => {
                                    if self.walker.eval_file(&active, entry_name) {
                                        match self
                                            .walker
                                            .prepare_matched_path(entry_name, dir_dir_path)?
                                        {
                                            Some(prepared) => {
                                                return Ok(Ok(Some(prepared)));
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
                                                return Ok(Ok(Some(prepared_path)));
                                            }
                                            None => continue,
                                        }
                                    }
                                }
                                bun_sys::FileKind::SymLink => {
                                    if self.walker.follow_symlinks {
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
                                    } else if !self.walker.only_files {
                                        if self.walker.eval_file(&active, entry_name) {
                                            match self
                                                .walker
                                                .prepare_matched_path(entry_name, dir_dir_path)?
                                            {
                                                Some(prepared_path) => {
                                                    return Ok(Ok(Some(prepared_path)));
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
        Self {
            path,
            active,
            kind,
            entry_start: 0,
            fd: None,
        }
    }

    fn new_with_fd(
        path: Box<[u8]>,
        active: ComponentSet,
        kind: WorkItemKind,
        fd: A::Handle,
    ) -> Self {
        Self {
            path,
            active,
            kind,
            entry_start: 0,
            fd: Some(fd),
        }
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
        // `bun_paths::fs::FileSystem` (singleton holds only the cwd string; the
        // DirEntry cache stays in `bun_resolver`).
        Self::init_with_cwd(
            pattern,
            bun_paths::fs::FileSystem::instance().top_level_dir(),
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
        let ptr = std::ptr::from_ref(self) as usize;
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
            path_buf: Box::new(PathBuffer::uninit()),
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

        Ok(Ok(this))
    }

    pub fn handle_sys_err_with_path(&mut self, err: SysError, path_buf: &ZStr) -> SysError {
        let src = path_buf.as_bytes();
        let copy_len = src.len().min(self.path_buf.len());
        // Several callers pass a `path_buf` that is itself a slice of
        // `self.path_buf` (e.g. Iterator::init error path, next() symlink
        // openat error path). When src and dst alias the same range,
        // `copy_from_slice` is UB (its safety contract requires
        // non-overlapping). Zig's `bun.copy` is memmove. Match that:
        // short-circuit identical-range, otherwise use overlap-safe ptr::copy.
        let dst = self.path_buf.as_mut_ptr();
        if src.as_ptr() != dst.cast_const() {
            // SAFETY: copy_len ≤ both src and dst capacity; ptr::copy is memmove
            // (overlap-safe) so partial overlap is fine too.
            unsafe { core::ptr::copy(src.as_ptr(), dst, copy_len) };
        }
        err.with_path(&self.path_buf[0..copy_len])
    }

    pub fn walk(&mut self) -> Result<Maybe<()>, Error> {
        if self.pattern_components.is_empty() {
            return Ok(Ok(()));
        }

        let mut iter = Iterator::new(self);
        if let Err(err) = iter.init()? {
            return Ok(Err(err));
        }

        loop {
            let path = match iter.next()? {
                Err(err) => return Ok(Err(err)),
                Ok(matched_path) => matched_path,
            };
            let Some(path) = path else { break };
            log!("walker: matched path: {}", bstr::BStr::new(&path));
            // The paths are already put into self.matched_paths, which we use for the output,
            // so we don't need to do anything here
            let _ = path;
        }

        Ok(Ok(()))
    }

    // NOTE you must check that the pattern at `idx` has `syntax_hint == .Dot` or
    // `syntax_hint == .DotBack` first
    //
    // PORT NOTE: reshaped for borrowck — Zig passed `dir_path: *[:0]u8` (a fat
    // slice into `path_buf`). Rust passes `dir_path_len: &mut usize` instead.
    fn collapse_dots(
        &self,
        idx: u32,
        dir_path_len: &mut usize,
        path_buf: &mut PathBuffer,
        encountered_dot_dot: &mut bool,
    ) -> Maybe<u32> {
        Self::collapse_dots_disjoint(
            &self.pattern_components,
            idx,
            dir_path_len,
            path_buf,
            encountered_dot_dot,
        )
    }

    // PORT NOTE: associated fn taking `pattern_components` so callers can
    // split-borrow it from `&mut self.path_buf` (Zig freely aliased; Rust
    // forbids `&mut self` + `&mut self.path_buf`). Error path builds SysError
    // directly from `path_buf` (which is already `self.path_buf` for the
    // symlink caller) instead of routing through `handle_sys_err_with_path`.
    fn collapse_dots_disjoint(
        pattern_components: &[Component],
        idx: u32,
        dir_path_len: &mut usize,
        path_buf: &mut PathBuffer,
        encountered_dot_dot: &mut bool,
    ) -> Maybe<u32> {
        let mut component_idx = idx;
        let mut len = *dir_path_len;
        while (component_idx as usize) < pattern_components.len() {
            match pattern_components[component_idx as usize].syntax_hint {
                SyntaxHint::Dot => {
                    if len + 2 >= MAX_PATH_BYTES {
                        return Err(SysError::from_code(E::ENAMETOOLONG, Syscall::Tag::open)
                            .with_path(&path_buf[..len]));
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
                        return Err(SysError::from_code(E::ENAMETOOLONG, Syscall::Tag::open)
                            .with_path(&path_buf[..len]));
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

        Ok(component_idx)
    }

    // NOTE you must check that the pattern at `idx` has `syntax_hint == .Double` first
    fn collapse_successive_double_wildcards(&self, idx: u32) -> u32 {
        let mut component_idx = idx;
        let _pattern = &self.pattern_components[idx as usize];
        // Collapse successive double wildcards
        while ((component_idx + 1) as usize) < self.pattern_components.len()
            && self.pattern_components[(component_idx + 1) as usize].syntax_hint
                == SyntaxHint::Double
        {
            component_idx += 1;
        }
        component_idx
    }

    pub fn skip_special_components(
        &self,
        work_item_idx: u32,
        dir_path_len: &mut usize,
        scratch_path_buf: &mut PathBuffer,
        encountered_dot_dot: &mut bool,
    ) -> Maybe<u32> {
        Self::skip_special_components_disjoint(
            &self.pattern_components,
            work_item_idx,
            dir_path_len,
            scratch_path_buf,
            encountered_dot_dot,
        )
    }

    /// Same as [`skip_special_components`] but takes `pattern_components`
    /// directly so callers can split-borrow it from `&mut self.path_buf`
    /// (the symlink branch in `Iterator::next` passes `self.path_buf` as
    /// `scratch_path_buf` while reading `pattern_components`).
    pub fn skip_special_components_disjoint(
        pattern_components: &[Component],
        work_item_idx: u32,
        dir_path_len: &mut usize,
        scratch_path_buf: &mut PathBuffer,
        encountered_dot_dot: &mut bool,
    ) -> Maybe<u32> {
        let mut component_idx = work_item_idx;

        if (component_idx as usize) < pattern_components.len() {
            // Skip `.` and `..` while also appending them to `dir_path`
            component_idx = match pattern_components[component_idx as usize].syntax_hint {
                SyntaxHint::Dot | SyntaxHint::DotBack => {
                    match Self::collapse_dots_disjoint(
                        pattern_components,
                        component_idx,
                        dir_path_len,
                        scratch_path_buf,
                        encountered_dot_dot,
                    ) {
                        Err(e) => return Err(e),
                        Ok(i) => i,
                    }
                }
                _ => component_idx,
            };
        }

        if (component_idx as usize) < pattern_components.len() {
            // Skip to the last `**` if there is a chain of them
            component_idx = match pattern_components[component_idx as usize].syntax_hint {
                SyntaxHint::Double => {
                    let mut i = component_idx;
                    while ((i + 1) as usize) < pattern_components.len()
                        && pattern_components[(i + 1) as usize].syntax_hint == SyntaxHint::Double
                    {
                        i += 1;
                    }
                    i
                }
                _ => component_idx,
            };
        }

        Ok(component_idx)
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
                && (component_idx + 1) as usize == self.pattern_components.len().saturating_sub(1)
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
        crate::r#match(pattern_component.pattern_slice(&self.pattern), filepath).matches()
    }

    /// Create an empty ComponentSet sized for this pattern.
    fn make_set(&self) -> ComponentSet {
        // Zig wrapped in handleOom; Rust aborts on OOM.
        ComponentSet::init_empty(self.pattern_components.len())
            .expect("OOM: ComponentSet::init_empty")
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
        let len: u32 = u32::try_from(comps.len()).expect("int cast");
        let mut it = active.iterator::<true, true>();
        while let Some(i) = it.next() {
            let idx: u32 = u32::try_from(i).expect("int cast");
            let pattern = &comps[idx as usize];
            let next_pattern = if idx + 1 < len {
                Some(&comps[(idx + 1) as usize])
            } else {
                None
            };
            let is_last = idx == len - 1;
            let mut add_this = false;
            if let Some(bump) = self.match_pattern_dir(
                pattern,
                next_pattern,
                entry_name,
                idx,
                is_last,
                &mut add_this,
            ) {
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
        let len: u32 = u32::try_from(comps.len()).expect("int cast");
        let mut it = active.iterator::<true, true>();
        while let Some(i) = it.next() {
            let idx: u32 = u32::try_from(i).expect("int cast");
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
        let mut it = active.iterator::<true, true>();
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
        // PERF(port): was getOrPut single-probe — two lookups here; profile in Phase B
        if self.matched_paths.contains_key(symlink_full_path) {
            log!(
                "(dupe) prepared match: {}",
                bstr::BStr::new(symlink_full_path)
            );
            return Ok(None);
        }
        if !SENTINEL {
            let slice: Box<[u8]> = Box::from(symlink_full_path);
            self.matched_paths.insert(&slice, ());
            return Ok(Some(slice));
        }
        let slicez = dupe_z(symlink_full_path);
        self.matched_paths.insert(&slicez, ());
        Ok(Some(slicez))
    }

    fn prepare_matched_path(
        &mut self,
        entry_name: &[u8],
        dir_name: &[u8],
    ) -> Result<Option<MatchedPath>, AllocError> {
        let subdir_parts: &[&[u8]] = &[&dir_name[0..dir_name.len()], entry_name];
        let name_matched_path = self.join(subdir_parts)?;
        // PERF(port): was getOrPutValue single-probe — two lookups here; profile in Phase B
        if self.matched_paths.contains_key(&name_matched_path) {
            log!(
                "(dupe) prepared match: {}",
                bstr::BStr::new(&name_matched_path)
            );
            return Ok(None);
        }
        self.matched_paths.insert(&name_matched_path, ());
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
        // PERF(port): was getOrPut single-probe — two lookups here; profile in Phase B
        if self.matched_paths.contains_key(&name_matched_path) {
            log!(
                "(dupe) prepared match: {}",
                bstr::BStr::new(&name_matched_path)
            );
            return Ok(());
        }
        self.matched_paths.insert(&name_matched_path, ());
        Ok(())
    }

    fn append_matched_path_symlink(&mut self, symlink_full_path: &[u8]) -> Result<(), AllocError> {
        self.matched_paths.insert(symlink_full_path, ());
        Ok(())
    }

    #[inline]
    fn join(&self, subdir_parts: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
        if !self.absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path
            return Ok(bun_paths::join_sep_maybe_z::<SENTINEL>(subdir_parts));
        }

        // For SENTINEL, bun_join already included trailing NUL in the slice it returned.
        Ok(bun_join::<SENTINEL>(subdir_parts))
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
                    && ((component.start + 2) as usize) < pattern.len()
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
        let pattern_len: u32 = u32::try_from(pattern.len()).expect("int cast");

        let mut prev_is_backslash = false;
        let mut saw_special = false;
        let mut i: u32 = 0;
        let mut width: u32 = 0;
        while (i as usize) < pattern.len() {
            let c = pattern[i as usize];
            // PORT NOTE: Zig calls bun.strings.utf8ByteSequenceLength; same table as wtf8.
            width = u32::from(strings::wtf8_byte_sequence_length(c));

            // PORT NOTE: GlobWalker.zig duplicates this block across the '\\' (Windows) and '/'
            // arms because Zig has no or-pattern with a comptime guard; merged here.
            if bun_core::path_sep::is_sep_native(c) {
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
                            u32::try_from(pattern_components.len()).expect("int cast");
                        *end_byte_of_basename_excluding_special_syntax =
                            (i + width).min(pattern_len);
                    }
                    pattern_components.push(component);
                }
                start_byte = i + width;
            } else if c == b'\\' {
                if prev_is_backslash {
                    prev_is_backslash = false;
                    i += 1;
                    continue;
                }
                prev_is_backslash = true;
            }
            // TODO: Support other escaping glob syntax
            i += 1;
        }
        let _ = prev_is_backslash;
        debug_assert!(i == 0 || i as usize == pattern.len());
        i = i.saturating_sub(1);

        if let Some(component) = Self::make_component(
            pattern,
            start_byte,
            u32::try_from(pattern.len()).expect("int cast"),
            has_relative_patterns,
        ) {
            saw_special = saw_special || component.syntax_hint.is_special_syntax();
            if !saw_special {
                *basename_excluding_special_syntax_component_idx =
                    u32::try_from(pattern_components.len()).expect("int cast");
                *end_byte_of_basename_excluding_special_syntax =
                    (i + width).min(pattern_len);
            }
            pattern_components.push(component);
        } else if !saw_special {
            *basename_excluding_special_syntax_component_idx =
                u32::try_from(pattern_components.len()).expect("int cast");
            *end_byte_of_basename_excluding_special_syntax =
                (i + width).min(pattern_len);
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
    // Thin u32 shim over `bun_paths::is_sep_native` (PathChar covers u8/u16
    // only). Separators are ASCII, so the truncating cast is exact when in
    // range; out-of-range codepoints are never separators.
    c <= 0xFF && bun_paths::is_sep_native(c as u8)
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
    let needle_len: u32 = u32::try_from(needle.len()).expect("int cast");
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
/// at index `len()-1`. Kept as `Box<[u8]>` (not `ZBox`) so `dupe_matched` can
/// store sentinel and non-sentinel payloads in the same `MatchedPath` shape.
#[inline]
fn dupe_z(s: &[u8]) -> Box<[u8]> {
    bun_core::ZBox::from_bytes(s).into_boxed_slice_with_nul()
}

/// Allocate a matched-path payload: when `SENTINEL` is true the box has a
/// trailing NUL at `len()-1` (Zig `[:0]const u8`); when false it does not (Zig
/// `[]const u8`). Mirrors `MatchedPath = if (sentinel) [:0]const u8 else []const u8`.
#[inline]
fn dupe_matched<const SENTINEL: bool>(s: &[u8]) -> Box<[u8]> {
    if SENTINEL {
        dupe_z(s)
    } else {
        Box::<[u8]>::from(s)
    }
}

/// Slice of a `dupe_matched` payload that excludes the trailing NUL (when
/// `SENTINEL`), suitable for `e.with_path` and other `[]const u8` consumers.
#[inline]
fn matched_as_slice<const SENTINEL: bool>(p: &[u8]) -> &[u8] {
    if SENTINEL && !p.is_empty() {
        &p[..p.len() - 1]
    } else {
        p
    }
}

/// The logical path stored in a [`WorkItem`], excluding any trailing NUL.
///
/// For `SENTINEL == true`, `MatchedPath` boxes produced by [`GlobWalker::join`]
/// carry a trailing NUL inside their `.len()` — Zig models the same value as
/// `[:0]const u8`, which coerces to a `[]const u8` whose `.len` *excludes* the
/// NUL. Root `WorkItem`s (and `SENTINEL == false` walks) instead hold a plain
/// path with no NUL. A real filesystem path can never contain (let alone end
/// in) a NUL byte, so a single trailing NUL is unambiguously the sentinel; we
/// strip it here to recover the logical length, mirroring the Zig coercion.
/// Without this, the NUL would be copied into the directory-path buffer and end
/// up *embedded* in every path joined onto it (e.g. `assets/*` matching as
/// `assets\0/file-1`, which truncates to `assets` when used as a C string).
#[inline]
fn work_item_logical_path(path: &[u8]) -> &[u8] {
    if path.last() == Some(&0) {
        &path[..path.len() - 1]
    } else {
        path
    }
}

// const bunJoin = if (!sentinel) ResolvePath.join else ResolvePath.joinZ;
fn bun_join<const SENTINEL: bool>(parts: &[&[u8]]) -> Box<[u8]> {
    use bun_paths::platform;
    if SENTINEL {
        let s = resolve_path::join_z::<platform::Auto>(parts);
        // include trailing NUL in the owned box (Zig: out[0..out.len-1 :0])
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v.into_boxed_slice()
    } else {
        Box::from(resolve_path::join::<platform::Auto>(parts))
    }
}

impl AccessorDirEntry for DirIterator::IteratorResult {
    fn name_slice(&self) -> &[u8] {
        // Zig `entry.name.slice()` is always `[]const u8`: on Windows the `.u8`
        // NewWrappedIterator transcodes via `strings.fromWPath` at iteration
        // time. `Name::slice_u8()` exposes that cached transcode (or the native
        // slice on POSIX) so this is uniformly `&[u8]`.
        self.name.slice_u8()
    }
    fn kind(&self) -> bun_sys::FileKind {
        self.kind
    }
}

// ported from: src/glob/GlobWalker.zig
