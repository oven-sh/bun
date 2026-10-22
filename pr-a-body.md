### Problem
- Since #44968 (not released), an isolated install that cannot create one directory of one package copies every later package instead of hard-linking it. The failing package prints a wrong error: `ENOENT: No such file or directory: failed to link package: axios@1.7.2 (open)` for a `mkdir` that failed with `EACCES`.
- Cause: `needs_copy` (`src/install/isolated_install/Installer.rs:3020`) looks only at the errno. #44968 made `Hardlinker::link` return the error of a `mkdir`, and `EACCES` from it reads as a file system that refuses hard links.

### Fix
- `needs_copy` also requires `syscall == Tag::link`. `sys::linkat`, `sys::link_w` and the error that `Hardlinker::link` builds on Windows carry that tag.
- Correct because a copy needs the same directory, so the fallback cannot help.
- Verified: `test/cli/install/bun-install-hardlink-fallback.test.ts` (one new test: it fails on main and passes on a build from before #44968). Also seven more install suites, listed in Notes.

### Background
- The isolated linker links each package with one backend: clonefile, hardlink or copyfile. `supported_backend` holds that choice for the whole install.
- Some file systems refuse hard links with `EXDEV`, or with `EACCES` or `EPERM` on FUSE (#36852). The linker then stores copyfile, and every later package is copied.
- Considered an error type that marks the link errors of `Hardlinker::link`. It touches every error path of the backends. The tag check fixes the regression alone.

### Downsides
- An unreadable directory in a cached package no longer switches the backend either. 1.4.3 and main both switch there.
- A `file:` folder whose copy cannot get a new empty directory now fails with the `mkdir` error. 1.4.3 and main exit 0 and leave the directory out.
- None found on the success path. `needs_copy` runs only after a link fails.

<details><summary>Notes</summary>

**Origin.** There is no tracker issue. The case came up during work on how `bun install` reports a directory that it cannot create.

**The test.** `axios@1.7.2` of the test registry is installed, then its `package.json` and `dist/node` are removed from the project's store. `<entry>/node_modules` and `axios/dist` lose write permission. The old copy cannot be moved away, so the package is linked into it. `dist` holds only directories, so the `mkdir` of `dist/node` is the first call that fails in it, whatever the order of the directory listing is. The other two packages are not in the cache, so they are linked after a download, when axios has failed.

| Build | Error of axios | Exit | The other two packages |
|---|---|---|---|
| 1.4.3-canary.1 (367d939d9, before #44968) | `ENOENT: No such file or directory: failed to link package: axios@1.7.2 (link)` | 1 | hard links |
| main | `ENOENT: No such file or directory: failed to link package: axios@1.7.2 (open)` | 1 | copies |
| this PR | `EACCES: Permission denied: failed to link package: axios@1.7.2 (mkdir)` | 1 | hard links |

- Release builds: main fails the test 10 of 10 times, and the build from before #44968 passes it 10 of 10 times.
- The test asserts the exit code and the link counts, not the wording of the error.

**What the switch costs.** With the global store on a cache that the user cannot write, one store entry that cannot be created plus 120 project-local packages: main copied 30, 2, 2, 36 and 1 of the 120 in five runs. The count depends on whether the walk of the failing package meets a directory before a file. The copies stay: a later install that succeeds leaves them (29, 19 and 1 of 120 in three runs), and `--force` links them again.

**The two states under Downsides** (release builds of 1.4.3-canary.1 and main, debug build of this PR):

- A cached package with a directory that cannot be read: all three print `EACCES: Permission denied: failed to link package: basic-1@1.0.0 (open)` and exit 1. On 1.4.3 and main the packages linked after it are copies. With this PR they are hard links.
- A `file:` folder with a new empty directory, and a copy whose parent directory cannot be written: 1.4.3 and main print nothing and exit 0, and the copy has no such directory. This PR prints the `mkdir` error and exits 1. #44968 made the directory arm return that error on purpose. `needs_copy` then turned it into a copy, and a copy leaves empty directories out.

**Other open PRs.** #45761 replaces the call in `link_cached_package` with a new `link_refusal`, which also reads only the errno. It needs the same condition, and the new test fails without it. #45761 and #46022 edit lines next to this change, so the second one to land needs a rebase.

**Suites.** Debug build, with `--timeout 60000`: `bun-install-hardlink-fallback` (10 pass), `isolated-install` (283), `bun-install-backends` (28), `bun-install-staging` (51), `isolated-relink` (6), `bun-install-link-path` (49), `bun-patch` (232), `bun-link` (57).

**Not run.** Windows and macOS: `cargo check -p bun_install` passes for `x86_64-pc-windows-msvc` and `aarch64-apple-darwin`. On Windows a failed `mkdirat` has the tag `open` (`open_dir_at_windows_nt_path`), so it does not pass the new condition either. The new test is skipped on Windows because it takes a permission away with `chmod`.

</details>
