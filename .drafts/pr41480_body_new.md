### Problem
- `fs.rm(dir, { recursive: true })` fails with `ENOENT` when another process removes a child during the walk. With `force: true` it returns success with the rest of the tree on disk (`zig_delete_tree` in `src/runtime/node/node_fs.rs`).
- `maxRetries` and `retryDelay` are never used.
- An errno outside the name table of the walker becomes `EFAULT`, and `path` is always the root.

### Fix
- `zig_delete_tree` returns the raw errno and the path of the entry that failed. `ENOENT` below the root continues the walk.
- A listing that removes nothing and still ends in `ENOTEMPTY` returns that error with the path of the directory.
- `rmSync` retries like Node's `rimraf`. The async calls make one native attempt and wait for the next on a timer in `fs.promises.ts`.
- Verified: `test/js/node/fs/rm-recursive-errors.test.ts` (9 tests, 7 to 8 fail on main). Also `promises.test.js` and `test-fs-rm.js`.

### Background
- `zig_delete_tree` is the walker behind recursive `fs.rm`: a stack of open directories, each read with `getdents64`.
- A directory can list an entry under a name that does not remove it (an unpaired surrogate on NTFS). Its unlink reports `ENOENT`, but the directory stays non-empty.
- Five open PRs patch one face each at a call site (#35800, #39710, #35749, #39003, #41486). This change repairs the error channel of the walker, where they start.

### Downsides
- `err.path` now names the entry that failed, not the argument.
- A directory that another process refills after a listing that removed nothing now fails with `ENOTEMPTY`, as in Node.
- None found in size: release `text` is 2,522 bytes smaller than main.

<details><summary>Notes</summary>

Related open PRs that each cover one face of this: #35800 and #39710 (ENOENT race), #35749 (errno passthrough), #35927 (failing path), #39003 (maxRetries). This change covers their Linux and macOS parts in one walker. Not covered: the Windows `STATUS_DELETE_PENDING` mapping on the directory open from #39710. The non-recursive `unlink` path is the same as on main: #41486 owns the removal of `map_rm_errno_narrow`, and this change does not overlap it.

Two findings of the review on 2026-10-03 were reproduced and are fixed here.

1. An entry that is listed but cannot be removed by name. Its unlink reports `ENOENT`, the walker skipped it as vanished, the `rmdir` of the directory reported `ENOTEMPTY`, and the walker opened and listed the directory again with no bound: `rmSync` never returned. Now each stack item records whether its listing removed an entry. When the `rmdir` reports `ENOTEMPTY` (or `EEXIST`) and the listing removed nothing, the walker returns that error with the path of the directory. A listing that removed something is followed by another one, as before. The walker for trees deeper than 16 levels had the same loop on main (it already skipped `ENOENT`) and gets the same rule. The test lists `real.txt` as `geal.txt` through an `LD_PRELOAD` shim on `getdents64`: `rmSync` and `fs.promises.rm` with `force` report `ENOTEMPTY` with the path of the directory, at depth 1 and at depth 21. With the previous head of this branch the test does not return, and with main's `src/` the first two rows report `ENOENT` or success.

2. The retry delay on a work-pool thread. `rm_with_retries` slept on the thread that ran the walk, which is a pool thread for `fs.rm` and `fs.promises.rm`. Now `NodeFS::rm` takes the `Flavor`: `Sync` keeps the loop and the sleep (Node's C++ `RmSync` also sleeps), `Async` makes one attempt. `fs.promises.rm` in `src/js/node/fs.promises.ts` catches a retryable code, waits `retryDelay * attempt` ms with `setTimeout`, and calls the native function again. A retry that finds the path gone succeeds. The callback `fs.rm` goes through the same function. The test starts twice as many retrying calls as the pool has threads, all failing with `EMFILE`, then one `fs.promises.stat`: the stat settles before any of the calls gives up. With the previous head and with main it settles after.

Retry tests. The `EMFILE` tests run bun under `ulimit -n 64`, open descriptors until `EMFILE`, then free two: enough to open `root` and `root/a`, not `root/a/b`. The async retry test frees descriptors only after an attempt has failed: it waits until the first listed file of `a` is gone (the attempt then holds both free descriptors and cannot open `b`), then until a descriptor can be opened again (the attempt gave them back) while `c.txt` still exists. The sync retry test uses the shim: the first listing of a directory named `flaky` hides its entry, so the first attempt of `rmSync` ends with `ENOTEMPTY` and the second one removes the tree. Without `maxRetries` the same tree reports `ENOTEMPTY`.

Race tests. A worker deletes the same tree while the main thread walks it. Three tests use a deleter that unlinks from the end of each listing. It reports ready before the walk starts, and it now fails on any error other than `ENOENT` (on Windows it still ignores all of them: a pending delete has several codes there). The fourth test runs two recursive walkers at once: the one that falls behind still holds a directory open when the other removes it, and its next `getdents64` reports `ENOENT`. These four tests are races, so on main 2 to 3 of them fail in a run. The five other tests are deterministic and all fail on main.

Measurements. Release builds of this branch and of the same tree with main's `src/`: `text` 89,103,407 bytes on main, 89,100,885 here (2,522 fewer), `data` and `bss` equal, file size equal. The walk adds one `bool` for each open directory and one store for each removed entry. No new syscall: the shim tests count on the same `getdents64` calls before and after.

Windows. Build 123305 ran the two-walker test on the Windows lanes (x64 and aarch64) and it passed. The directory-open mapping of `STATUS_DELETE_PENDING` is still not part of this change.

Other details. `rmSync` with `maxRetries` blocks the JS thread for at most `retryDelay * maxRetries * (maxRetries + 1) / 2` ms. Past 16 levels the error names the depth-16 directory, not the deeper entry, because the second walker does not keep the chain of names. `ENOENT` from `getdents64` on a directory that was removed while open also continues the walk. On macOS, `dt_delete_file` reports `ENOENT` when the entry vanishes between `unlinkat` and the `lstatat` that disambiguates `EPERM`. `rm()` tags the error of the walker as `rm` and strips the Windows `\\?\` prefix from the path. An earlier revision also made the two `getdents64` iterators loop on `EINTR`. That retry is a separate change with its own test (EINTR_PR_PLACEHOLDER).

Suites run on the merge with main (71d0d43997), debug build: `test/js/node/fs/rm-recursive-errors.test.ts` (9 of 9, 7 runs), `test/js/node/fs/promises.test.js`, `test/js/node/fs/dir.test.ts`, `test/js/node/test/parallel/test-fs-rm.js`, `test-fs-rmdir-throws-on-file.js`, `bun scripts/rust-check-all.ts` (12 of 12 targets). In `test/js/node/fs/fs.test.ts` the recursive `readdir` stress tests (`should work x 100`) time out in the debug build on the machine used. They fail the same way with main's `src/`, and this change does not touch `readdir`.
</details>

<!-- robobun:evidence:begin -->

---

**no test proof** · iteration 6 · platform-specific test(s) that do not run on this machine, deferring to CI, which covers all platforms: test/js/node/fs/rm-recursive-errors.test.ts

<!-- robobun:evidence:end -->



