### Problem

- `Bun.Archive#extract()` passes an entry's whole path to one `openat`, `mkdirat` or `symlinkat`. The kernel follows a symlink already in the destination, so the entry lands outside.
- Repro: archives `d1 -> .`, `d1/d2/up -> ../..`, `d1/d2/up/victim/file.txt` into one directory.

### Fix

- `ContainedDir` (`src/libarchive/lib.rs`) creates each entry. A file entry's open refuses symlinks in the kernel: `openat2(RESOLVE_NO_SYMLINKS)` on Linux, `O_NOFOLLOW_ANY` on macOS. Other entries open their parent that way.
- A symlink where an entry needs a directory rejects with `ELOOP` and the entry path. A symlink under a file entry's name is replaced.
- `bun install` and the `--compile` download keep their calls (`DestinationKind::PrivateFresh`): they extract into a directory they made. `bun create` keeps its check from #44968 and extracts through `ContainedDir`.
- Verified: `test/js/bun/archive.test.ts`, `fs-stat-seccomp-linux.test.ts`, `bun-create.test.ts`, install extraction suites. Self-reviewed: 18 concerns raised, 12 addressed, 6 in Notes.

### Background

- `openat(dirfd, "a/b/c")` resolves `a` and `a/b` through symlinks. `O_NOFOLLOW` covers only `c`. The kernel flags cover every component.
- Without them, a walk opens the parent one component at a time with `O_NOFOLLOW`.
- Considered that walk alone (the first version): 2x to 3x the syscalls on npm tarballs. The design is #31481's, extended to Linux.

### Downsides

- Breaking: an extraction over a symlinked directory rejects. Reject, skip, or follow inside links: a maintainer decides. The default extractor also rejects a directory entry it cannot create (main ignores that).
- First extraction: +2 syscalls per new nested directory (+0.5% to +11% on five npm packages). Text SIZE_LINE.
- A seccomp policy that kills on `openat2` kills `extract()`. Windows still follows junctions.
