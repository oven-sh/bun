### Problem

- `Bun.Archive#extract()` passes an entry's whole path to one `openat`, `mkdirat` or `symlinkat`. The kernel follows a symlink already in the destination, so the entry lands outside.
- Repro: archives `d1 -> .`, `d1/d2/up -> ../..`, `d1/d2/up/victim/file.txt` into one directory.

### Fix

- `ContainedDir` (`src/libarchive/lib.rs`) creates each entry. A file entry's open refuses symlinks in the kernel: `openat2(RESOLVE_NO_SYMLINKS)` on Linux, `O_NOFOLLOW_ANY` on macOS. Other entries open their parent that way.
- A symlink where an entry needs a directory rejects with `ELOOP` and the entry path. A symlink under a file entry's name is replaced.
- `bun install` and the `--compile` download keep their calls (`DestinationKind::PrivateFresh`): they extract into a directory they made. `bun create` keeps its check (#44968) and extracts through `ContainedDir`.
- Verified: `test/js/bun/archive.test.ts`, `fs-stat-seccomp-linux.test.ts`, `bun-create.test.ts`, install suites. Self-reviewed: 18 concerns raised, 12 addressed, 6 in Notes.

### Background

- `openat(dirfd, "a/b/c")` resolves `a` and `a/b` through symlinks. `O_NOFOLLOW` covers only `c`. The kernel flags cover every component.
- Without them, a walk opens the parent one component at a time (`O_NOFOLLOW`).
- Considered that walk alone (the first version): 2x to 3x the syscalls on npm tarballs. The design is #31481's, plus Linux.

### Downsides

- Breaking: an extraction over a symlinked directory rejects. Reject, skip, or follow inside links: a maintainer decides. The default extractor also rejects a directory entry it cannot create (main ignores that).
- First extraction: +2 syscalls per new nested directory (+0.5% to +11% on five npm packages). Second: +1 per directory entry. Text +15,872 bytes.
- A seccomp policy that kills on `openat2` kills `extract()`. Windows still follows junctions.

<details><summary>Notes</summary>

#### State of this pull request

The branch is rebased onto main after #44968 (the consolidation of the package manager pull requests). That change lists this pull request as not taken, with the reason `not install: Bun.Archive`. Three things changed for this branch:

- `bun create` on main now checks each path of the template for a link in the destination (`leaves_destination`). Without `--force` the link is a conflict. With `--force` the link is replaced. This pull request no longer changes that check or its messages.
- `bun install` on main skips the symlink entries of a tarball, so the streaming extractor has no symlinks to create. This pull request no longer touches it.
- The cache pack (`bun pm cache unpack`) calls `create_deferred_symlinks`. Its one call site is adapted to the new return type.

#### State of the self-review

A review of the rebased diff raised 18 concerns. Two more reviewers checked each one against the code, and some describe the same defect. 12 are addressed:

- The fallback walk starts again when it runs out of descriptors. It then forgot that it had made the parent, and a directory got the mode of the archive, not `0755`. A member below a read-only directory then failed.
- With `fs.protected_symlinks=1` the kernel answers `EACCES`, not `ELOOP`, for another user's symlink at the end of a path in a sticky world-writable directory. The entry below it was a `ReadError` (default extractor) or was skipped (`glob`). It now rejects with `ELOOP`.
- A directory entry whose own name is a symlink was counted and skipped. It now rejects with `ELOOP`.
- systemd's `RestrictSUIDSGID=` refuses a `mkdirat` with the setgid bit. A directory entry with that bit made `extract()` reject where main extracted it. The mode for `mkdirat` has no setuid or setgid bit now. The kernel ignores both there.
- FreeBSD has no `O_PATH` in `bun_sys`, so the walk opened each parent `O_RDONLY` and failed below a directory that the process can search but not read. It now opens with `O_SEARCH`. This is type-checked only.
- Tests: a directory entry and a symlink entry below a link, a link that is not the first component, a link under a file entry's name that dangles or points at a directory, and the deep tree under both resolvers.

6 are not changed:

- A file entry does not replace another user's symlink in a sticky directory. The process cannot remove that link. The default extractor rejects, and the `glob` extractor skips the entry.
- The fallback walk keeps up to 128 directories open and gives them up only on its own `EMFILE`.
- `bun create`: the conflict check of main lets a link below `.git/` pass, because `.git/` never conflicts. On main the entry is written through the link. With this pull request the extraction stops at that entry with `error: 'main' returned error.ELOOP`. The check itself is separate work.
- The default extractor rejects a directory entry that it cannot create. This is intended (see Downsides).
- Several of the added archive tests also pass on main. They guard behavior that must stay as it is.
- No test covers the cleanup of a partial file in the `glob` extractor.

A heavier review run was interrupted four times and never finished.

#### The choice that is open

What a symlink in the way means is a product decision. This PR builds the strictest answer, so that nothing is dropped in silence.

| answer | who does it |
| --- | --- |
| reject and name the entry | this PR, both extractors. `bun create` without `--force` (#44968) |
| replace the link | `bun create --force` (#44968) |
| skip the entry and warn | node-tar 7.5.15 (`TAR_ENTRY_ERROR: TAR_SYMLINK_ERROR: Cannot extract through symbolic link`). With `strict: true` it rejects |
| follow the link | GNU tar 1.35, and `extract()` before this PR |
| follow only a link that stays inside the destination | nobody above. It needs a resolution step in user space for each entry |

A symlink under the name of a file entry is replaced by GNU tar 1.35 and by node-tar 7.5.15. This PR does the same.

The rejection is a `SystemError`: `code: "ELOOP"`, `syscall: "open"`, `path` is the entry. The message is the standard text of the errno, for example `ELOOP: too many symbolic links encountered, open 'bin/tool'`. Other extraction failures still reject with the bare `Error("ReadError")`. #44509 (draft) changes that.

#### Behavior changes

- An entry below a symlink that is already in the destination rejects with `ELOOP`. Before, the file was written through the link. Entries before that one stay extracted.
- A file entry replaces a symlink under its own name. Before, it wrote to the target of the link. This is the short form of the report: a member `cfg` over an existing `cfg -> ../victim/f.txt`.
- A directory entry whose own name is a symlink rejects with `ELOOP`. Before, it was counted and the link stayed.
- The `glob` extractor creates the symlinks of an archive after all other entries, as the default extractor does. An archive that has `current -> releases/v1` and then `current/config` now gets a directory `current`, not a file in `releases/v1`. Before, an archive with symlink entries nested under the names of each other made the `glob` extractor spin without end.
- The default extractor rejects when it cannot create a directory entry, for example a name that is too long or a destination that is not writable. Main ignores that failure when the name has a `/` in it, and still counts the entry. The `glob` extractor skips such an entry, as before.
- A symlink entry whose name ends in `/` (malformed) no longer leaves empty directories behind.
- `create_deferred_symlinks` drops its dev/ino re-check of the parent. The parent is now opened without symlinks each time.
- `bun create` extracts through `ContainedDir`. After its own check this changes one case: the link below `.git/` that the check does not see.
- Everything else is as on main. A generated set of 97 archive and destination shapes, each extracted two times by both extractors, gives 194 pairs. Against a build of main at `a407eae88a`, 40 pairs differ, the same 40 as root and as uid 65534, with umask 022 and 000: 28 with a symlink already in the destination (14 shapes), 8 where the `glob` extractor now creates the symlinks of an archive last, 3 with a symlink entry whose name ends in `/`, and one directory entry with a name of 300 bytes. The kernel path and the fallback walk give the same result on all 194, as root and as uid 65534.

#### Cost

Syscalls of the extraction (`mkdirat`, `openat`/`openat2`, `close`, `write`), counted with a ptrace tracer. D: 2000 files in the root. A: 200 leaf directories at depth 4, 10 files each. E: A with directory entries. B: 2000 leaf directories at depth 6, one file each. C: B in random order.

The table is from release builds of an earlier head (`1ef3216281`) and of its merge base. Release builds of main at `a407eae88a` and of this head give the same numbers within 65 calls: on the machine of this measurement a run makes a few `openat`, `close` and `fstat` calls that the first machine did not. One cell changed and is marked.

| default extractor | D | A | E | B | C |
| --- | --- | --- | --- | --- | --- |
| main, first extraction | 6003 | 6845 | 6424 | 11315 | 11315 |
| PR, first extraction | 6003 | 7685 | 7264 | 16625 | 16625 |
| main, second extraction | 6003 | 6003 | 6424 | 6003 | 6003 |
| PR, second extraction | 6003 | 6003 | 7685 (*) | 6003 | 6003 |
| PR, fallback walk, first | 6003 | 7267 | 7266 | 13972 | 31231 |

(*) 7264 in the release measurement, and one `lstat` for each of the 421 directory entries that are there already. The `lstat` tells a directory from a symlink under the name of the entry.

The rule: a file in a directory that exists costs the one open it cost before. A directory that is made below another directory costs 2 more calls (open the parent, close it). So does a directory entry below another directory. A directory entry whose name is taken costs one `lstat`.

Layouts of real packages, members in the order npm writes them (by extension, then base name, so members jump between directories), first extraction, from the same release builds:

| package | files | directories | main | PR | PR, fallback walk |
| --- | --- | --- | --- | --- | --- |
| caniuse-lite | 837 | 7 | 2528 | 2540 (+0.5%) | 2984 |
| rxjs 7.8.1 | 2277 | 88 | 7010 | 7184 (+2.5%) | 21255 |
| core-js 3.37.1 | 3487 | 168 | 10800 | 11134 (+3.1%) | 19977 |
| astro 5.5.5 | 888 | 103 | 2850 | 3054 (+7.2%) | 5476 |
| aws-cdk-lib 2.148.0 | 5012 | 928 | 16888 | 18742 (+11.0%) | 34681 |

The second extraction into the same tree costs the same as main for all five.

- `glob` extractor, release builds of main at `a407eae88a` and of this head: first extraction 6016 / 7701 / 7277 / 16644 / 16656 (main: 6007 / 8446 / 8440 / 9331 / 9340), second extraction 6019 / 6016 / 7701 / 6055 / 6013 (main: 6016 / 8016 / 8437 / 8019 / 8019).
- `bun install` (measured at `1ef3216281`, not again): two tarballs (rxjs, aws-cdk-lib) with a fresh cache make 37,891 syscalls on the buffered path and about 38,100 on the streaming path, and every file system call count equals main. `openat2`: 0 on both. The `--compile` download was not run (it needs a download). It takes the same `PrivateFresh` path.
- Rare paths: a symlink under the name of a file entry costs 2 more calls per replaced entry in the root and 4 more below a directory. A refusal costs 2 opens. On a kernel that has `openat2`, an open that fails with one of the seven errnos of the next section costs 2 more calls (the probe and its close).
- Descriptors open at the same time (at `1ef3216281`): main 9, PR 10 (the root, the file, one parent). The fallback walk keeps one per directory level, at most 128, and fewer after `EMFILE`. A tree 70 levels deep extracts under `ulimit -n 16`.
- Binary: text +15,872 bytes (106,006,447 to 106,022,319), release builds of main at `a407eae88a` and of this head, measured with `size`. Data and bss are the same.
- Wall clock (at `1ef3216281`), tmpfs, 31 interleaved runs, median: between -2% and +9% on these shapes, with a noise floor (main against main) of up to 12%. 100,000 opens of a depth-4 path: `openat2(RESOLVE_NO_SYMLINKS)` and `openat` differ by less than the noise (2% to 4%).
- Instruction counts: not measured. `perf` and `valgrind` are not available on the build machine.

#### `openat2` and sandboxes

- A kernel or a sandbox without `openat2` answers the call with an errno. After `ENOSYS`, `EPERM`, `EACCES`, `EFAULT`, `EOPNOTSUPP`, `EINVAL` or `E2BIG`, the extractor makes the same call on `/`, which opens for every process. If that call fails with one of these errnos too, the process uses the fallback walk for the rest of its life. If it opens, the error is about the entry. `fs-stat-seccomp-linux.test.ts` runs an extraction under a seccomp filter for each of the seven. Before this, `EACCES`, `EFAULT` and `EOPNOTSUPP` made `extract()` reject.
- The probe is on `/` and not on `.`: for a destination root that the process cannot search, `openat2(dir, ".")` says `EACCES` on a kernel that has `openat2`.
- A seccomp policy that kills the process for a syscall it does not list cannot be detected. `BUN_FEATURE_FLAG_DISABLE_OPENAT2=1` turns `openat2` off. A Linux build on an Android kernel never tries it (`is_android_kernel`, as for the other `openat2` calls of `bun_sys`). Bun already calls `openat2` for static routes of `Bun.serve` and when `bun install` links a bin.

#### Not covered

- Windows. Its arms are unchanged, and a junction in the destination is still followed. `openat_windows` maps `O_NOFOLLOW` to `FILE_OPEN_REPARSE_POINT`, so the same idea can work there. I cannot build or run Windows code, so it is separate work. No change for it exists yet.
- macOS and FreeBSD. I cannot run either. The macOS lanes of CI passed on `f2dcbf60db`, the head before the rebase, which had the same `O_NOFOLLOW_ANY` and `O_SEARCH` paths. FreeBSD is type-checked only (`bun run rust:check-all`, 12 of 12).
- A symlink entry whose own name is taken stays as on main: `symlinkat` answers `EEXIST` and what is there stays.

#### Relation to other pull requests

- #44968 (merged) is the base of the rebase, see the first section.
- #31481 (closed, taken in part by #44968) opens the parent with `O_NOFOLLOW_ANY` on macOS and walks the components only to make a missing parent. This PR uses that design, adds `openat2` for Linux, and applies it to each destination that a caller gives.
- #31585 walks the components of every entry. That is the fallback here.
- #43144 replaces an existing file with unlink and `O_EXCL`. It touches the same open. The one that lands second needs a rebase.
- #44509 (draft) makes `extract()` reject with the errno of the failed call, in place of the bare `ReadError`. It changes the same functions. The one that lands second needs a rebase.
- #40600 fixes the `make_path` loop that made the `glob` extractor spin. The `glob` extractor no longer calls `make_path` on POSIX.

#### History of this PR

The first version walked the components of every parent with cached directory descriptors. A review found that it skipped an entry in silence where main rejected (a destination that is not writable, a name that is too long). The second version keeps main's errors for every case without a symlink, and adds one: a directory entry that cannot be created. This version is the second one on the new main, with the fixes of the section on the self-review.

The pre-merge check asked for three cases. On this head, as uid 65534:

```
1 read-only destination: REJECTED ReadError | members 2 | on disk: (nothing)
2 `a`, then `a/b`: REJECTED ReadError | members 3 | on disk: a
3 layer 2 over bin -> usr/bin: REJECTED ELOOP: too many symbolic links encountered, open 'bin/tool' | members 2 | on disk: bin usr usr/bin
```

On main, case 3 resolves with 2 and writes `usr/bin/tool`.

</details>
