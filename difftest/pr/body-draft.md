### Problem

- `Bun.Archive#extract()` and `bun create` give the whole path of an entry to one `openat`, `mkdirat` or `symlinkat` call. The kernel resolves a symlink that is already in the destination, so an entry lands outside it.
- Three archives into one directory are enough: `d1 -> .`, then `d1/d2/up -> ../..`, then `d1/d2/up/victim/file.txt`. A member `cfg` also truncates the target of an existing `cfg -> ../victim/f.txt`.

### Fix

- `ContainedDir` (`src/libarchive/lib.rs`) creates each entry of a caller-provided destination. The open that a file entry already makes refuses symlinks in the kernel: `openat2(RESOLVE_NO_SYMLINKS)` on Linux, `O_NOFOLLOW_ANY` on macOS. A directory or symlink entry opens its parent that way.
- A symlink in place of a parent directory rejects with `ELOOP` and the path of the entry, in both extractors. A symlink under the name of a file entry is replaced. Every other error is as on main.
- `bun install` and the `--compile` download pass `DestinationKind::PrivateFresh` and keep their calls.
- Verified: `test/js/bun/archive.test.ts`, `test/cli/install/bun-create.test.ts` (the new tests fail on main), and the install extraction suites. Self-reviewed: N concerns raised, M addressed.

### Background

- `openat(dirfd, "a/b/c")` resolves `a` and `a/b` through symlinks. `O_NOFOLLOW` covers only `c`. The two kernel flags cover every component in the same call.
- Without them (Linux before 5.6, seccomp, Android, FreeBSD) the parent is opened one component at a time with `O_NOFOLLOW`, and those directories stay open.
- A symlink entry is created after all other entries. The `glob` extractor now does that too.
- Considered that walk alone (the first version of this PR): 2x to 3x the syscalls on npm tarballs, whose members are not in directory order. The design is #31481's, extended to Linux.

### Downsides

- Breaking: an extraction over a tree with a symlinked directory rejects, and `bun create` into one fails. Before, the write went through the link. Reject, skip, or follow a link that stays inside: that choice is open for a maintainer. node-tar skips with a warning.
- First extraction: +2 syscalls per directory made below another one, +0.5% to +11% on five npm packages. Text +17,152 bytes. No instruction counts: `perf` is not available.
- Windows is unchanged: a junction in the destination is still followed.
