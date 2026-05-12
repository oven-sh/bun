use core::ops::Range;

use crate::{self as sys, Fd, FdExt, dir_iterator};
use bun_alloc::AllocError;
use bun_core::slice_as_bytes;
use bun_paths::{OSPathChar, OSPathSlice, OSPathSliceZ, SEP};
use bun_wyhash::Wyhash11;

#[inline]
fn hash_with_seed(seed: u64, bytes: &[u8]) -> u64 {
    Wyhash11::hash(seed, bytes)
}

// TODO(port): `DirIterator.NewWrappedIterator(if (Environment.isWindows) .u16 else .u8)` —
// `dir_iterator::WrappedIterator` is parameterized on the native OS path char in Zig.
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
    pub resolve_unknown_entry_types: bool,
}

pub struct WalkerEntry<'a> {
    /// The containing directory. This can be used to operate directly on `basename`
    /// rather than `path`, avoiding `error.NameTooLong` for deeply nested paths.
    /// The directory remains open until `next` or `deinit` is called.
    pub dir: Fd,
    pub basename: &'a OSPathSliceZ,
    pub path: &'a OSPathSliceZ,
    // PORT NOTE: Zig used `std.fs.Dir.Entry.Kind`; mapped to `bun_core::FileKind`
    // (re-exported as `crate::EntryKind`).
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
                Err(err) => return Err(err),
                Ok(res) => {
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
                                Ok(stat_buf) => sys::kind_from_mode(stat_buf.st_mode as sys::Mode),
                                Err(_) => continue, // skip entries we can't stat
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
                                Ok(fd) => fd,
                                Err(err) => return Err(err),
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
                        // `name_buffer[cur_len] == 0` was written above; both views end at
                        // `cur_len` and are NUL-terminated by that sentinel char. `from_buf`
                        // ties the borrow to `&self.name_buffer` (no raw-pointer reslice).
                        return Ok(Some(WalkerEntry {
                            dir: self.stack[top_idx].iter.dir(),
                            basename: OSPathSliceZ::from_buf(
                                &self.name_buffer[dirname_len..],
                                cur_len - dirname_len,
                            ),
                            path: OSPathSliceZ::from_buf(&self.name_buffer, cur_len),
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
        Ok(None)
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
    skip_filenames: &[&OSPathSlice],
    skip_dirnames: &[&OSPathSlice],
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

// ported from: src/sys/walker_skippable.zig
