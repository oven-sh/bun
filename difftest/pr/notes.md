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
- 16 of the added archive tests also pass on main. They guard behavior that must stay as it is.
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
- Everything else is as on main. DIFFERENTIAL

#### Cost

COST

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
THREE_CASES
```

On main, case 3 resolves with 2 and writes `usr/bin/tool`.

</details>
