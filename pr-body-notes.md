<details><summary>Notes</summary>

**Origin.** There is no tracker issue. The case came up during the work on #46100. `globalStore` is off by default.

**What prints.** Linux x64, release builds, uid 65534, store entry missing. `plain` has two files. `other` has a directory.

| Cache | Backend | main | This PR |
|---|---|---|---|
| `chmod -R a-w`, or owned by another user | hardlink | `ENOENT: No such file or directory: failed to link package: plain@1.0.0 (link)` | `EACCES: Permission denied: failed to link package: plain@1.0.0: cannot create "<cache>/links" (mkdir)` |
| same | copyfile | `EPERM: Operation not permitted: failed to link package: plain@1.0.0 (copyfile)` | the `EACCES` line above |
| read-only mount | hardlink | `ENOENT ... (link)` | `EROFS: Read-only file system: failed to link package: plain@1.0.0: cannot create "<cache>/links" (mkdir)` |
| read-only mount | copyfile | `EROFS: Read-only file system: failed to link package: plain@1.0.0 (copyfile)` | the `EROFS` line above |
| `links/` exists, mode 555 | hardlink | `ENOENT ... plain@1.0.0 (link)` and `EPERM ... other@1.0.0 (copyfile)` | `EACCES ... cannot create "<cache>/links/plain@1.0.0-<hash>.tmp-<id>" (mkdir)` |

- One note follows the first failure of a store entry: `note: the global store is "<cache>/links". set globalStore = false under [install] in bunfig.toml to install without it`. It names `BUN_INSTALL_GLOBAL_STORE=0` when that variable turned the store on. It prints for `EACCES`, `EPERM` and `EROFS` only.
- A store that holds every entry still installs from a read-only cache with exit 0. The trace has no `mkdir`, `link`, `rename` or `unlink` under `<cache>`, on main and on this PR.
- For a failed package of files only, main makes 2 `linkat` calls into `<cache>/links` that must fail. This PR makes 0.

**The switch to copyfile since #44968.** #44968 made the directory arm of `Hardlinker::link` return its `mkdir` error. `needs_copy` reads `EACCES` and `EPERM` from any error of `Hardlinker::link` as a file system that refuses hardlinks, and stores copyfile for the rest of the install. The copies stay: a later install that succeeds leaves them (29, 19 and 1 of 120 in three runs), and `--force` links them again.

- One store-eligible package that cannot be written plus 120 project-local packages (`/tmp` fixture, five runs each): main copied 30, 2, 2, 36 and 1 of the 120. This PR copied 0 in every run.
- An error of the walk over the cached package (`open` fails with `EACCES`) switched the backend on main the same way. It is `LinkError::Other` now, and the test `a directory of a cached package that cannot be read` covers it.
- #44968 merged on 2026-10-14. The last release, 1.4.3, is from 2026-10-10.

**The retry stays.** #37424 kept the discarded `mkdir` results on purpose ("the retry decides"), and #44968 included that PR. That reason does not hold for a `mkdir` that fails: the retry then reports `ENOENT` for an `EACCES` or `EROFS`. This PR keeps the retry and returns the `mkdir` error when the `mkdir` fails.

- Deleting the `ENOENT` arm of `Hardlinker::link` was measured and dropped. With three or more installs at once in one project, another install can rename a directory between the `mkdir` and the `linkat`, and the arm repairs that. Without it, 46 of 240 (4 at once) and 77 of 360 (6 at once) processes failed where main had 5 and 11.
- With the arm kept (150 packages, 60 rounds, main and PR interleaved):

| Packages, installs at once | main: exits not 0 | main: rounds with files missing | PR: exits not 0 | PR: rounds with files missing |
|---|---|---|---|---|
| with directories, 4 | 7 of 240 | 3 of 60 | 3 of 240 | 2 of 60 |
| flat, 4 | 10 of 240 | 6 of 60 | 13 of 240 | 7 of 60 |
| with directories, 6 | 9 of 360 | 0 of 60 | 23 of 360 | 5 of 60 |
| flat, 6 | 37 of 360 | 6 of 60 | 21 of 360 | 6 of 60 |
| with directories, 6, three more runs of 40 rounds | 9, 3, 11 of 240 | 2, 0, 1 of 40 | 4, 10, 5 of 240 | 0, 2, 0 of 40 |

- No round on either build ended with files missing while every process exited 0.

**Sites.** `let _ = <mkdir>` in `src/install` goes from 22 to 12 (`grep -rnE 'let _ = [^;]*(mkdir|make_dir|make_path|mkdirat|mkdir_recursive|MakePath)'`).

- Returned now (line numbers on main): `Hardlinker.rs:195` and `:248`, `FileCloner.rs:47`, `FileCopier.rs:149` and `:185`, `Symlinker.rs:86` and `:112`, `Installer.rs:2771`, `bin.rs:1249` and `:1336`. Also `isolated_install.rs:2094`, `mkdirat(node_modules).is_ok()`: with a project directory that cannot be written, main prints `ENOENT: No such file or directory: failed to create './node_modules/.bun' (mkdir)`. This PR prints the line of the hoisted linker: `EACCES: Permission denied: could not create the "node_modules" directory (mkdir)`.
- Left out, same class: the hoisted linker (`PackageInstall.rs:981`, `:1548`, `:1670`, `:1780`, `:2304`), extraction (`TarballStream.rs:1301`, `:1318`, `:1331`, `:1344`, `:1345`, `extract_tarball.rs:578`), `lib.rs:745` (Windows), `isolated_install.rs:1608` (`move_entries_aside`), and the sites outside `src/install`.
- Left out, other class: the `EEXIST` arms beside each retry drop the result of `delete_tree`. A file that cannot be removed still prints `EEXIST ... (link)`.
- `FileCopier::copy` had a block that turned `EACCES` into `EPERM` (and `ENOTDIR` into `ENOENT` on Windows) and replaced the syscall with `copyfile`. Its comment asked for its removal. No caller branches on the result. `FileCopier::copy` now opens the directory, runs `mkdir -p` only after `ENOENT`, and returns the error of the call that failed.

**Self-review.** 16 concerns, 12 addressed. Rejected:

- A separate PR with only a `syscall == Tag::link` guard in `needs_copy`. `LinkError::Link` does that job here, and it also covers the errors of the source walk.
- A repository-wide lint for discarded `mkdir` results. That is a policy for a maintainer to choose. The sites that remain are listed above.
- The `EEXIST` arms. They are a different failure: an existing file that cannot be replaced, not a directory that cannot be made.
- One backend hint per destination (`supported_backend` is one value for the project and the store). A link that the file system really refuses in the project still builds later store entries by copy. That is older than this PR and needs its own change.

Two suggestions inside the addressed concerns were not taken: a test with a `linkat` shim that pins the retry (its behaviour is the one of main), and the directory in the `bun patch` message (`error overwriting folder in node_modules: EACCES` keeps its shape).

**Measurements.** Linux x64. Release builds of 9b4284f788 with and without this diff, uid 65534, ptrace tracer.

- File system calls per cold isolated package, hardlink backend (slope of N=4 and N=8):

| Package | Store off | Store on |
|---|---|---|
| two files | 16 to 15 (failed 4 to 3) | 19 to 18 (failed 6 to 5) |
| scoped name | 18 to 17 (failed 5 to 4) | 21 to 20 (failed 7 to 6) |
| first entry is a directory | 26 to 25 (failed 4 to 3) | 29 to 28 (failed 6 to 5) |

  The call that goes away is the `linkat` that fails with `ENOENT` (or one `mkdirat` that fails with `ENOENT` when the first entry is a directory). With it goes one error value that carries a path (`gdb` breakpoint on `Error::with_path`: 1 to 0 per package from `Hardlinker::link`).
- Installs that link no cold package (warm store hit, no-op with the store on, no-op with it off, hoisted cold install): the normalized trace is the same as main, 0 lines differ.
- Destination exists or other backend, whole install of three packages, five runs: `file:` folder first install 242 to 236, folder again 161 and 161, `--force` store off 220 to 217, `--force` store on 262 to 259, copyfile cold 257 and 257, copyfile cold with the store 265 and 265.
- Release binary: `.text` 81,904,485 to 81,909,093 (+4,608), file 107,497,184 to 107,505,376 (+8,192) (`size -A`, `ls -l`).
- Types: `LinkError` is 48 bytes (`sys::Error` is 40). `TaskError` (72), `Task` (152) and `Installer` (768) do not change.

**Not run.** The Windows and macOS arms compile for `x86_64-pc-windows-msvc` and `aarch64-apple-darwin`. Nothing here ran them.

- On macOS the default backend clones. `FileCloner::clone` makes the parent directory after `ENOENT` and now returns that `mkdir` error. When the parent exists and cannot be written, the clone fails with `EACCES ... (clonefile)` and no directory, as on main.
- On Windows only `a file where the global virtual store belongs` runs. The other new tests take a permission away with `chmod`.
- The Windows reports of `failed to link package ... (copyfile)` such as #26543 are a `CopyFileW` failure. This PR does not change them.

**Other open PRs.** #45761, #46022, #45572 and #45569 edit the same functions. In a trial merge, #45761 conflicts in `Hardlinker.rs` and `Installer.rs`, and #45569 in `FileCopier.rs`. #46022 and #46100 merge cleanly. The decision which errno changes the backend stays at the two call sites (`needs_copy` and the clone match), where those PRs edit it.

**Suites.** Debug build: `isolated-install` (301 pass), `bun-install-hardlink-fallback` (9), `bun-install-backends` (28), `bun-install-link-path` (49), `isolated-relink` (6), `bun-install-staging` (51), `bun-patch` (221), `bun-install-patch` (53), `bun-link` (57), `bun-workspaces` (285), `bunx` (174), `bun-install-lifecycle-scripts` (427 of 428), `bun-remove` (37), `hoist` (175), `bun-prune` (176), `bun-install-git-deps` (201), `bun-install` (772), `bun-install-registry` (489), `bun-add` (219).

- `hoist`, `bun-prune`, `bun-install-git-deps`, `bun-install-staging` and `isolated-install` needed `--timeout 60000` on the debug build. With the default 5 s, 118 of their tests ran out of time under the concurrent load. None had a failed assertion.
- One CPU-time test of `bun-install-lifecycle-scripts` (`does not use 100% cpu > install`) failed once in the full file and passed 5 of 5 alone.
- The new tests also pass when the test runner itself is uid 65534.
- `bun run rust:check-all`: 12 of 12 targets.
- Fail-before: with a release build of main, 15 of the 18 new tests in `isolated-install.test.ts` fail and the 3 controls pass. The 3 new `bun-patch` tests fail.

</details>
