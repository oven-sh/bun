use core::ops::Range;

use bun_alloc::AllocError;
use bun_paths::{OSPathChar, OSPathSlice, OSPathSliceZ, SEP};
use bun_sys::{self as sys, dir_iterator, Fd};
use bun_wyhash::hash_with_seed;

// TODO(port): `DirIterator.NewWrappedIterator(if (Environment.isWindows) .u16 else .u8)` —
// assumed `dir_iterator::WrappedIterator` is already parameterized on the native OS path char.
type WrappedIterator = dir_iterator::WrappedIterator;

type NameBufferList = Vec<OSPathChar>;

pub struct Walker {
    stack: Vec<StackItem>,
    name_buffer: NameBufferList,
    // PORT NOTE: reshaped for borrowck — Zig stored `skip_filenames`/`skip_dirnames` as
    // sub-slices borrowed from `skip_all`. Rust stores index ranges into `skip_all` instead
    // (self-referential slices are not expressible without raw pointers).
    skip_filenames: Range<usize>,
    skip_dirnames: Range<usize>,
    skip_all: Box<[u64]>,
    seed: u64,
    resolve_unknown_entry_types: bool,
}

pub struct WalkerEntry<'a> {
    /// The containing directory. This can be used to operate directly on `basename`
    /// rather than `path`, avoiding `error.NameTooLong` for deeply nested paths.
    /// The directory remains open until `next` or `deinit` is called.
    pub dir: Fd,
    pub basename: OSPathSliceZ<'a>,
    pub path: OSPathSliceZ<'a>,
    // TODO(port): Zig used `std.fs.Dir.Entry.Kind`; assumed `bun_sys::EntryKind` is the port.
    pub kind: sys::EntryKind,
}

struct StackItem {
    iter: WrappedIterator,
    dirname_len: usize,
}

impl Walker {
    /// After each call to this function, and on deinit(), the memory returned
    /// from this function becomes invalid. A copy must be made in order to keep
    /// a reference to the path.
    pub fn next(&mut self) -> sys::Result<Option<WalkerEntry<'_>>> {
        while !self.stack.is_empty() {
            // `top` becomes invalid after appending to `self.stack`
            // PORT NOTE: reshaped for borrowck — use index instead of holding `&mut` across push.
            let top_idx = self.stack.len() - 1;
            let mut dirname_len = self.stack[top_idx].dirname_len;
            match self.stack[top_idx].iter.next() {
                sys::Result::Err(err) => return sys::Result::Err(err),
                sys::Result::Ok(res) => {
                    if let Some(base) = res {
                        // Some filesystems (NFS, FUSE, bind mounts) don't provide
                        // d_type and return DT_UNKNOWN. Optionally resolve via
                        // fstatat so callers get accurate types for recursion.
                        // This only affects POSIX; Windows always provides types.
                        #[cfg(not(windows))]
                        let kind: sys::EntryKind = if base.kind == sys::EntryKind::Unknown
                            && self.resolve_unknown_entry_types
                        {
                            let dir_fd = self.stack[top_idx].iter.dir();
                            // TODO(port): `base.name.sliceAssumeZ()` — assumed `.as_zstr()`
                            match sys::lstatat(dir_fd, base.name.as_zstr()) {
                                sys::Result::Ok(stat_buf) => sys::kind_from_mode(stat_buf.mode),
                                sys::Result::Err(_) => continue, // skip entries we can't stat
                            }
                        } else {
                            base.kind
                        };
                        #[cfg(windows)]
                        let kind: sys::EntryKind = base.kind;

                        match kind {
                            sys::EntryKind::Directory => {
                                let skip = &self.skip_all[self.skip_dirnames.clone()];
                                if skip.contains(
                                    // avoid hashing if there will be 0 results
                                    &(if !skip.is_empty() {
                                        hash_with_seed(
                                            self.seed,
                                            slice_as_bytes(base.name.as_slice()),
                                        )
                                    } else {
                                        0
                                    }),
                                ) {
                                    continue;
                                }
                            }
                            sys::EntryKind::File => {
                                let skip = &self.skip_all[self.skip_filenames.clone()];
                                if skip.contains(
                                    // avoid hashing if there will be 0 results
                                    &(if !skip.is_empty() {
                                        hash_with_seed(
                                            self.seed,
                                            slice_as_bytes(base.name.as_slice()),
                                        )
                                    } else {
                                        0
                                    }),
                                ) {
                                    continue;
                                }
                            }

                            // we don't know what it is for a symlink
                            sys::EntryKind::SymLink => {
                                let skip = &self.skip_all[..];
                                if skip.contains(
                                    // avoid hashing if there will be 0 results
                                    &(if !skip.is_empty() {
                                        hash_with_seed(
                                            self.seed,
                                            slice_as_bytes(base.name.as_slice()),
                                        )
                                    } else {
                                        0
                                    }),
                                ) {
                                    continue;
                                }
                            }

                            _ => {}
                        }

                        self.name_buffer.truncate(dirname_len);
                        if !self.name_buffer.is_empty() {
                            self.name_buffer.push(SEP as OSPathChar);
                            dirname_len += 1;
                        }
                        self.name_buffer.extend_from_slice(base.name.as_slice());
                        let cur_len = self.name_buffer.len();
                        self.name_buffer.push(0);

                        let mut top_idx = top_idx;
                        if kind == sys::EntryKind::Directory {
                            let new_dir = match sys::open_dir_for_iteration_os_path(
                                self.stack[top_idx].iter.dir(),
                                base.name.as_slice(),
                            ) {
                                sys::Result::Ok(fd) => fd,
                                sys::Result::Err(err) => return sys::Result::Err(err),
                            };
                            {
                                self.stack.push(StackItem {
                                    // TODO(port): Zig passed encoding `if windows .u16 else .u8`;
                                    // assumed native-encoding overload.
                                    iter: dir_iterator::iterate(new_dir),
                                    dirname_len: cur_len,
                                });
                                top_idx = self.stack.len() - 1;
                            }
                        }
                        // SAFETY: `name_buffer[cur_len] == 0` was written above; both slices end
                        // at `cur_len` and are NUL-terminated by that sentinel byte/char.
                        let (basename, path) = unsafe {
                            (
                                OSPathSliceZ::from_raw(
                                    self.name_buffer.as_ptr().add(dirname_len),
                                    cur_len - dirname_len,
                                ),
                                OSPathSliceZ::from_raw(self.name_buffer.as_ptr(), cur_len),
                            )
                        };
                        return sys::Result::Ok(Some(WalkerEntry {
                            dir: self.stack[top_idx].iter.dir(),
                            basename,
                            path,
                            kind,
                        }));
                    } else {
                        let item = self.stack.pop().unwrap();
                        if !self.stack.is_empty() {
                            item.iter.dir().close();
                        }
                    }
                }
            }
        }
        sys::Result::Ok(None)
    }
}

impl Drop for Walker {
    fn drop(&mut self) {
        if !self.stack.is_empty() {
            for item in &mut self.stack[1..] {
                // Zig had `if (self.stack.items.len != 0)` here, which is always true inside
                // this branch — preserved as-is.
                item.iter.dir().close();
            }
            // `self.stack` Vec drops itself.
        }

        // `self.skip_all` (Box<[u64]>) and `self.name_buffer` (Vec) drop themselves.
    }
}

/// Recursively iterates over a directory.
/// `self` must have been opened with `OpenDirOptions{.iterate = true}`.
/// Must call `Walker.deinit` when done.
/// The order of returned file system entries is undefined.
/// `self` will not be closed after walking it.
pub fn walk(
    self_: Fd,
    skip_filenames: &[OSPathSlice<'_>],
    skip_dirnames: &[OSPathSlice<'_>],
) -> Result<Walker, AllocError> {
    let name_buffer = NameBufferList::new();

    let mut stack: Vec<StackItem> = Vec::new();

    let mut skip_names = vec![0u64; skip_filenames.len() + skip_dirnames.len()].into_boxed_slice();
    let seed = (skip_filenames.len() + skip_dirnames.len()) as u64;
    let mut skip_name_i: usize = 0;

    for name in skip_filenames {
        skip_names[skip_name_i] = hash_with_seed(seed, slice_as_bytes(name));
        skip_name_i += 1;
    }
    let skip_filenames_ = 0..skip_name_i;
    let skip_dirnames_ = skip_name_i..skip_names.len();

    for (i, name) in skip_dirnames.iter().enumerate() {
        skip_names[skip_name_i + i] = hash_with_seed(seed, slice_as_bytes(name));
    }

    stack.push(StackItem {
        // TODO(port): Zig passed encoding `if windows .u16 else .u8`; assumed native-encoding overload.
        iter: dir_iterator::iterate(self_),
        dirname_len: 0,
    });

    Ok(Walker {
        stack,
        name_buffer,
        skip_all: skip_names,
        seed,
        skip_filenames: skip_filenames_,
        skip_dirnames: skip_dirnames_,
        resolve_unknown_entry_types: false,
    })
}

/// Reinterpret a slice of `OSPathChar` (or any POD `T`) as bytes.
/// Mirrors `std.mem.sliceAsBytes`.
// TODO(port): move to a shared helper in bun_core / bun_str if not already present.
#[inline]
fn slice_as_bytes<T>(s: &[T]) -> &[u8] {
    // SAFETY: reading any `T` slice as raw bytes is sound for POD path chars (u8/u16);
    // length is `len * size_of::<T>()` and alignment of u8 is 1.
    unsafe {
        core::slice::from_raw_parts(s.as_ptr().cast::<u8>(), core::mem::size_of_val(s))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/walker_skippable.zig (199 lines)
//   confidence: medium
//   todos:      5
//   notes:      skip_filenames/skip_dirnames reshaped to Range<usize> into skip_all (self-ref slices); DirIterator/WrappedIterator/EntryKind/OSPathSliceZ API names assumed — verify in Phase B.
// ──────────────────────────────────────────────────────────────────────────
