Fixes #5361

### Problem
- `bunx` and `bun create <npm template>` ignore the project's `bunfig.toml`, `.npmrc` and `.env`. `bun create @scope/pkg` fails: `error: GET https://registry.npmjs.org/@scope%2fcreate-pkg - 404`.
- `bunx` spawns `bun add` in its cache directory (`src/runtime/cli/bunx_command.rs:1007`), and `PackageManager::init` reads config only in the root of its cwd.

### Fix
- `bunx` spawns `bun add` in the invoking directory, with the cache directory in a hidden flag, `--bunx-install-dir`.
- With the flag, `PackageManager::init` walks to the root read-only, loads `bunfig.toml`, `.env` and `.npmrc` there, then enters the install directory. So `bunx` reads the files that `bun add` reads.
- Verified: `test/cli/install/bunx.test.ts` (44 new tests, 33 fail on main), `bun-create.test.ts` (4 new, 4 fail on main).

### Background
- `bunx` installs a package into `<install cache>/.bunx-<uid>/<pkg>@<version>` with a spawned `bun add`, then runs the bin.
- `PackageManager::init` walks up from the cwd to the nearest `package.json`, then to its workspace root, and reads config there.
- Considered: `bunx` passes `--config=<bunfig.toml>` (the first version). It covers one input of four and adds a second discovery rule.

### Downsides
- Behavior change: a project's `[install]` settings and `.npmrc` now apply to `bunx` and `bun create`. A project registry without the tool makes `bunx <tool>` fail.
- Cost: +1 `stat` per project `bunfig.toml` or `.npmrc` on each `bunx`. An install: +9 system calls, +208 in a 20-package workspace. Binary size: SIZE_PLACEHOLDER.
- An edit of those files makes a new cache entry (its name has their hash). The old one stays until `bun pm cache rm`.

<details><summary>Notes</summary>

**What the install reads now.** The spawned `bun add` picks its config root like `bun add` in the invoking directory: the nearest `package.json`, then the workspace root that lists it, or the cwd when no `package.json` exists. It reads `bunfig.toml`, the `.env` files and `.npmrc` there, then the global files. A relative `cafile` is relative to the invoking directory, as for `bun add`. A relative `[install.cache] dir` is relative to the config root. Nothing in the project is written: the walk opens `package.json` read-only and never creates one.

**Differences from `bun add` in that root, on purpose.**
- A `package.json` that cannot be opened, or a parent `package.json` that cannot be read or parsed, does not stop `bunx`. `bun add` exits there. On main `bunx` does not look at those files at all.
- `frozenLockfile` and `production` do not freeze the lockfile of the install: it adds one package to `{}`.

**Security scanner.** A scanner named in the project or the user `bunfig.toml` is looked up from the project root, so a scanner that is installed in the project scans what `bunx` installs. A scanner that cannot be found stops the install, as on main. #31149 is not changed for a scanner that is not installed in the project.

**Cache entry name.** `bunx` appends `+config=<hash>` to the name of the directory it installs into, after `+trust` and `+min-age=`. The hash covers path, size and mtime of each `bunfig.toml` and `.npmrc` in the cwd and in each ancestor that has a `package.json`. The directory listings are already in memory, so a project with none of these files costs no system call and keeps the name it has on main.

**Tests.** `describe("the project's install config")` in `bunx.test.ts`:
- 6 layouts (project root, subdirectory, workspace member, no `package.json`, project below the config, subdirectory that holds the config) x 5 inputs (`bunfig.toml` registry, `bunfig.toml` scope, `.npmrc` registry, `.npmrc` scope with a token from `.env`, `bunfig.toml` scope with a token from `.env.local`). Each case runs `bun add` and `bun x` and compares the registry and the credentials, and the project files before and after.
- Default registry from the environment with a scope from the project. Malformed `bunfig.toml` (exit 1, like `bun add`). Unreadable `bunfig.toml` (skipped, like `bun add`). Config files put into the install directory are not read. A cache entry per project config file. 6 security scanner cases. `frozenLockfile` and `production` in the user `bunfig.toml`. `minimumReleaseAge` in the project.
- On a debug build of main: 33 fail, 11 pass. The 11 are the 10 cases where the config must not apply and the scanner that is not installed.
- `bun-create.test.ts`: `bun create @bun13247test/package` asks the scope registry of the project `bunfig.toml` or `.npmrc`, from a directory with no `package.json` and from a subdirectory of a project.
- Also run on the debug build: all of `bunx.test.ts`, `bun-create.test.ts`, `bunx-concurrent`, `bunx-directories-bin`, `config-precedence`, `bun-add`, `bun-add-filter`, `bun-workspaces`, `bad-workspace`, `bun-pm-scan`, `bun-install-env-file`, `npmrc`, `run_command`. `bun run rust:check-all x86_64-pc-windows-msvc aarch64-apple-darwin` passes.

**System calls** (ptrace logger, debug builds of main a9c57bdd89 and this PR, linux-x64, whole process):

| `bunx px-probe`, no install | main | PR |
| --- | --- | --- |
| no project config file | 556 | 556 |
| `bunfig.toml` in the root | 556 | 557 |
| `bunfig.toml` and `.npmrc` | 556 | 558 |

| the spawned `bun add` | main | PR |
| --- | --- | --- |
| cwd with no `package.json` above | 717 | 726 |
| 7 levels below the project root | 716 | 737 |
| the same, root has `bunfig.toml`, `.npmrc`, `.env` | 715 | 751 |
| member of a 20-package workspace | 716 | 924 |

The added calls are one `openat` of `package.json` per directory up to the root, the listing of the config root, one `chdir`, one `getcwd`, and for a workspace member the read of each member's `package.json` (the same read that `bun add` does there). The spawned install makes 0 opens for write in the project and 0 opens of config files in the install directory.

**Not covered.**
- `bunx` run by a lifecycle script of a dependency has that package's directory as its cwd, so its root is that package, not the project that is being installed.
- The cache entry name does not include `.env`, the environment, or the user-level files. It does not on main.
- `bun add -g` and auto-install at runtime are not changed.

**Related.** #13247 (`bun create` with a scope, closed as a duplicate of #5361). A report that `bunx` ignores the project `.npmrc` for a scoped package: covered by the `.npmrc` cases. Earlier versions of this PR passed `--config=<nearest bunfig.toml>` from `bunx` with an ownership check. Review found that this leaves `.npmrc` and `.env` unread, checks a path and opens it again later, and picks a different file than `bun add`. That code is gone.

</details>
