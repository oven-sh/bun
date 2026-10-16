Fixes #5361

### Problem
- `bunx` and `bun create <npm template>` ignore the registries in the project's `bunfig.toml` and `.npmrc`. `bun create @scope/pkg` fails: `error: GET https://registry.npmjs.org/@scope%2fcreate-pkg - 404`.
- `bunx` spawns `bun add` in its own directory (`src/runtime/cli/bunx_command.rs:1111`). That install reads only the user's files.

### Fix
- `bunx` names its project to the spawned `bun add` in `BUN_INTERNAL_BUNX_PROJECT`. `PackageManager::init` overlays that project's `bunfig.toml` and `.npmrc`.
- `of_project_for_bunx` keeps 8 of the 36 `[install]` settings: registries, credentials, `ca`, `cafile`, `minimumReleaseAge` with its excludes, and the security scanner.
- The name of the directory that `bunx` installs into gets a hash of the kept registries.
- Verified: `test/cli/install/bunx.test.ts` (62 new tests, 37 fail on main), `bun-create.test.ts` (4 new, 4 fail on main).

### Background
- `bunx` installs a tool into `<install cache>/.bunx-<uid>/<pkg>@<version>` with a spawned `bun add`, then runs its bin.
- The project is `project_directory(cwd)`: the root where `bunx` looks for the project's own copy of a tool.
- Considered: run the `bun add` in the project (the previous version). Every `[install]` key reached the tool, and `init` got a second mode.

### Downsides
- `bunx <public tool>` now asks the project's default registry, and fails if that registry lacks the tool. A project scanner that is not installed stops `bunx`.
- `bunx pkg@version` does the project lookup of `bunx pkg`: +15 system calls. A project `bunfig.toml` or `.npmrc` is read on each run: +6 to +10. Binary size: pending.
- Four choices need a maintainer's decision: see Notes.

<details><summary>Notes</summary>

**Choices to sign off.** Each is one place in the diff.
1. Which files count. This PR: the `bunfig.toml` and `.npmrc` of the project root only, as for `bun add` and npm. The root is `project_directory(cwd)`, or the cwd if there is no `package.json`. The other option is what auto-install does: every directory from the root down to the cwd.
2. Which settings apply. This PR: `default_registry`, `scoped`, `url_auth`, `ca`, `cafile`, `minimum_release_age_ms`, `minimum_release_age_excludes`, `security_scanner`. `of_project_for_bunx` destructures every field of `Api::BunInstall`, so a new field does not compile until someone decides it.
3. The scanner in a project that has not installed it. This PR: `bunx` stops, as it does on main for a scanner in `~/.bunfig.toml`. `bun add` in that project installs the scanner first. `bunx` does not.
4. A project `bunfig.toml` or `.npmrc` that cannot be read or parsed. This PR: `bunx` stops and names the file, as installs do since #45307.

**What applies, and from where.**
- The user's own `~/.bunfig.toml` and `~/.npmrc` apply as on main. The kept settings of the project's `.npmrc` override the user's `.npmrc`. The user's `bunfig.toml` overrides both, and the kept settings of the project's `bunfig.toml` override that. This is the order that `bun add` has in the project.
- The project's `.env` files are read only to expand `$VAR` in the two files (`config_env` in `Options::load`). They do not set `BUN_CONFIG_REGISTRY`, and the install scripts of the tool do not see them. `bunx --env-file` turns them off, as `bun add --env-file` does.
- A relative `cafile` is relative to the file that sets it, as on main.
- The security scanner runs in the project directory, so a scanner in the project's `node_modules` is found, also when `~/.bunfig.toml` names it.

**What keeps the user's config only.**
- `bunx` with its cwd in a `node_modules` directory (a package's install script), and the node-gyp that `bun install` runs for a package.
- `bun add -g`, the three legacy `bun create` templates and the download of `bun build --compile --target` (#25713). A `bun install` that a `create-*` tool runs in the new directory reads that directory, not the one you ran `bun create` in.

**The name of the install directory.** Main's rule is "What decides the content of a tree is part of its name" (`+trust`, `+min-age=`). `bunx_project_key` hashes the registry URLs, the release-age settings and the scanner that each of the two files sets. Two projects with the same values share a directory. A project that sets none of them keeps the name it has on main, so a `bunfig.toml` with only `[install.cache]` changes nothing (the test on main for that still passes). The suffix is `+project-<hex>`: it has no `=`, because node-gyp writes the path of its own files into a Makefile, and GNU make reads `=` there as an assignment.

**Tests.** `describe("the project's registries")` in `bunx.test.ts`:
- 8 layouts x 5 inputs. Each case runs `bun add` and `bun x` and compares the registry and the credentials, and the project's files before and after.
- A `package.json` with only `type`. A package with a version. The environment's registry with a project scope. A relative `cafile` from a subdirectory, over TLS. A registry in `.env` (not taken). Other `[install]` keys (not taken). A cwd in `node_modules` (user config). A `bunfig.toml` that cannot be parsed or read. Shared and separate install directories. 6 security scanner cases. `minimumReleaseAge`.
- `bun-create.test.ts`: `bun create @bun13247test/package` asks the scope registry of the project's `bunfig.toml` or `.npmrc`.
- Also run on the debug build: all of `bunx.test.ts` (235 pass, 2 skip) and `bun-create.test.ts` (143 pass), `bunx-concurrent`, `bunx-directories-bin`, `config-precedence`, `npmrc`, `bun-add`, `bun-pm-scan`, `bun-security-scanner-workspaces`, `bun-install-env-file`, `bun-install-lifecycle-scripts`, `run-autoinstall`, `no-envfile`, `env`. Under load, four tests hit the 5 s default timeout on the debug build. Three pass when run alone (two in `bun-security-scanner-workspaces`, one in `run-autoinstall`). The fourth, `env` "a worker in a compiled executable", also times out on main. `bun run rust:check-all x86_64-pc-windows-msvc aarch64-apple-darwin` passes.

**System calls** (ptrace logger, debug builds of main 5866b5f13d and this PR, linux-x64, cwd 3 levels below the project root):

| whole `bunx` process, no install | main | PR |
| --- | --- | --- |
| `bunx px-probe`, no project config file | 608 | 608 |
| `bunx px-probe`, `bunfig.toml` | 608 | 614 |
| `bunx px-probe`, `bunfig.toml` and `.npmrc` | 608 | 618 |
| `bunx px-probe@1.0.0`, no project config file | 558 | 573 |
| `bunx px-probe@1.0.0`, `bunfig.toml` and `.npmrc` | 558 | 583 |

| the spawned `bun add` | main | PR |
| --- | --- | --- |
| no `package.json` | 716 | 720 |
| project with no config file | 718 | 720 |
| project with `bunfig.toml` and `.npmrc` | 720 | 744 |
| the same with `.env` | 718 | 750 |

The +15 of `bunx px-probe@1.0.0` is one `openat` of `package.json` per directory up to `/` and the read of the project's `package.json`. `bunx px-probe` does that lookup on main. Without a project config file the spawned install adds 2 calls: it looks for the project's `bunfig.toml` and `.npmrc`. It opens nothing for write in the project.

**Not in this PR.**
- `frozenLockfile`, `production` and `dryRun` in `~/.bunfig.toml` break the install that `bunx` spawns on main. That needs no project config and is a separate change.
- The report and the prompt of a security scanner print to stdout, as for `bun add`. With `x=$(bunx tool)` they land in the captured output.
- The name of the install directory does not include `.env` values, the environment, or the user-level files. It does not on main.
- In a project whose default registry needs a login, `bunx npm login` asks that registry for `npm`. `BUN_CONFIG_REGISTRY=https://registry.npmjs.org bunx npm login` works.

**History.** Two earlier versions of this PR are gone. The first passed `--config=<nearest bunfig.toml>` from `bunx`. The second ran the `bun add` in the project with a hidden `--bunx-install-dir` flag. Related: #13247 (closed as a duplicate of #5361), #31149 (not changed for a scanner that is not installed in the project).

</details>

<!-- robobun:evidence:begin -->

---

**no test proof** · iteration 2 · platform-specific test(s) that do not run on this machine, deferring to CI, which covers all platforms: test/cli/install/bunx.test.ts, test/cli/install/bun-create.test.ts

<!-- robobun:evidence:end -->
