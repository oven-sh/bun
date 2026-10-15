The head moved: `f2dcbf60db` to `e8870e810d`. The branch is rebased onto main at `a407eae88a`, as one commit. A re-check can use this head.

**The rebase.** Main now has #44968. It lists this pull request as not taken (`not install: Bun.Archive`), and it changed the code around it:

- `bun create` on main has its own check for a link in the destination (`leaves_destination`). This branch no longer changes `create_command.rs` or the `bun create` tests. The extraction of `bun create` still goes through `ContainedDir`.
- `bun install` on main skips symlink entries. This branch no longer changes `TarballStream.rs`.
- The cache pack calls `create_deferred_symlinks`. Its call site takes the new return type.

**Fixes since `f2dcbf60db`**, from the two open review threads and from a review of the rebased diff:

- A sandbox that answers `openat2` with `EACCES`, `EFAULT` or `EOPNOTSUPP` made `extract()` reject. Those errnos now start the probe too, and the probe opens `/`.
- With `fs.protected_symlinks=1`, an entry below another user's symlink in a sticky world-writable directory was a `ReadError` (default extractor) or was skipped (`glob`). It now rejects with `ELOOP` and the entry.
- A directory entry whose own name is a symlink was counted and skipped. It now rejects with `ELOOP`.
- The fallback walk, after it ran out of descriptors once, gave a directory the mode of the archive and not `0755`.
- A directory entry with the setgid bit made `extract()` reject under systemd's `RestrictSUIDSGID=`, where main extracts it.
- FreeBSD: the walk opens parents with `O_SEARCH`. This is type-checked only.

The script of the pre-merge note, as uid 65534, on this head:

```
1 read-only destination: REJECTED ReadError | members 2 | on disk: (nothing)
2 `a`, then `a/b`: REJECTED ReadError | members 3 | on disk: a
3 layer 2 over bin -> usr/bin: REJECTED ELOOP: too many symbolic links encountered, open 'bin/tool' | members 2 | on disk: bin usr usr/bin
```

Checked on this tree, with a debug build:

- `test/js/bun/archive.test.ts`: 141 pass, 5 skip as root. 143 pass, 3 skip as uid 65534. The two tests for a sticky directory need root and `fs.protected_symlinks=1`. With the sysctl set they run and pass.
- `test/js/node/fs/fs-stat-seccomp-linux.test.ts`: 21 pass, 2 skip. `bun-create.test.ts`: 86 pass. `bun-pm-cache-pack.test.ts`: 199 pass, with a longer timeout (15 tests pass the 5 s limit on a debug build). `bun-install-streaming-extract`: 62. `symlink-path-traversal`: 52. `bun-install-tarball-integrity`: 165 pass, 42 skip.
- `bun run rust:check-all`: 12 of 12 targets.
- A debug build of main at `a407eae88a` fails 15 tests of the `path safety` block and the 7 `openat2` tests of the seccomp file.
- 194 archive and destination pairs against that build of main: 40 differ, the same 40 as root and as uid 65534, with umask 022 and 000. All are in the groups that the body lists. The kernel path against the fallback walk: 0 differ.

Release builds of main at `a407eae88a` and of this head: text +15,872 bytes. The syscall table in the body is from release builds of `1ef3216281`. Release builds of the new base and of this head give the same numbers within 65 calls, and the body marks the one cell that changed.

Still open: Windows is not covered. The choice between reject, skip and follow for a link in the way is for a maintainer. `bun create` on main lets a link below `.git/` pass its check. That is separate work. With this branch the extraction stops at that entry.

Update: the head is now `b6688effec`. It adds one commit that changes a test only: the two cases for a sticky directory are skipped where `/proc/sys/fs/protected_symlinks` cannot be read. Before, the read could throw when the test file loads. `src/` is the same as at `e8870e810d`.
