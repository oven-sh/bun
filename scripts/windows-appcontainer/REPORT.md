# Bun inside a Windows AppContainer

State of the world for running bun under a lowbox (AppContainer) token: what
works, what bun had to change, what libuv has to change, and what the platform
simply does not allow. Everything here was measured, not inferred; the harness
in this directory reproduces all of it.

- Machine: Windows Server 2019 (build 17763). The libuv work was authored
  against Windows 11 26200; every AppContainer denial it describes reproduces
  on 17763, so none of this is new-Windows-only behavior.
- Bun: debug build of `fb24aac703` plus the two commits in
  https://github.com/oven-sh/bun/pull/33107, with `LIBUV_COMMIT` pointed at
  oven-sh/libuv#5 (head `b919670` at the time of writing).
- Sandbox: a real AppContainer profile (`CreateAppContainerProfile`) launched
  with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` and the three network
  capabilities, stdio inherited. See `ac_run.c`.

## Windows primitives inside an AppContainer (ground truth)

Measured with `acprobe.c` (native, no bun involved) in and out of the
container. Everything else in this report is downstream of these.

| primitive | outside | inside the AppContainer |
|---|---|---|
| `CreateNamedPipeW("\\.\pipe\x")` | ok | `ERROR_ACCESS_DENIED` |
| `CreateNamedPipeW("\\.\pipe\LOCAL\x")` | ok | ok |
| anonymous pipes, `CreatePipe` | ok | ok |
| `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` | ok | `ERROR_ACCESS_DENIED` (every handle: file or dir, relative or absolute open) |
| `GetFinalPathNameByHandleW(VOLUME_NAME_GUID)` | ok | `ERROR_ACCESS_DENIED` |
| `GetFinalPathNameByHandleW(VOLUME_NAME_NT)` | ok | ok (`\Device\HarddiskVolumeN\path`) |
| `GetFinalPathNameByHandleW(VOLUME_NAME_NONE)` | ok | ok (path without the volume) |
| `QueryDosDeviceW("C:")` | ok | `ERROR_ACCESS_DENIED` |
| `GetVolumeInformationW("C:\")` | ok | `ERROR_ACCESS_DENIED` |
| `GetFileInformationByHandle` (volume serial of an open handle) | ok | ok |
| `GetLogicalDrives`, `GetDriveTypeW` | ok | ok |
| open/stat/list `C:\`, `C:\Users\<user>` | ok | `ERROR_ACCESS_DENIED` (drive roots and profiles carry no `ALL APPLICATION PACKAGES` ACE) |
| open `NUL` | ok | `ERROR_ACCESS_DENIED` |
| open `CONOUT$` | ok | ok |
| `CreateSymbolicLinkW` (either flag) | ok (admin) | `ERROR_PRIVILEGE_NOT_HELD`, always |
| `CreateHardLinkA` | ok | ok |
| junction (mount point) creation | ok | ok, but the kernel rewrites `\??\C:\x` to `\??\Global\C:\x` in the reparse data (also true for `cmd /c mklink /J`) |
| `CreatePseudoConsole` | ok | ok |
| `CreateProcessW` of another exe | ok | ok (child inherits the container) |
| `OpenProcess` on an unrelated pid | ok | denied |
| TCP listen + connect to self (loopback) | ok | ok, even with zero capabilities |
| TCP connect to another local process's 127.0.0.1 port | ok | `ECONNREFUSED` until `CheckNetIsolation.exe LoopbackExempt -a -p=<sid>` |
| outbound internet, getaddrinfo, c-ares UDP | ok | ok with `internetClient` (+`privateNetworkClientServer` for private resolvers); denied with no capabilities |
| `GetTempPath`/`%TEMP%` | user temp | rewritten by `CreateProcess` to `...\Packages\<profile>\AC\Temp`, which is writable |
| `%USERPROFILE%` | readable | env var unchanged, directory inaccessible |
| HKLM/HKCU reads bun needs (version, cpu, environment) | ok | ok |

One launcher-side requirement: outside an interactive session the container
SID must be granted on the window station and desktop, or any exe importing
user32.dll (bun does) dies at load with `STATUS_DLL_INIT_FAILED` (0xC0000142).
`ac_run.c` does this. Interactive sessions already carry the right ACEs.

## Where bun stands

### Broken before, fixed now

oven-sh/libuv#5 (libuv):

- Spawning with piped stdio and `uv_pipe()` used to spin forever at 100% CPU
  (`ERROR_ACCESS_DENIED` treated as a name collision and retried). Verified:
  the pre-PR release bun hangs until killed on `Bun.spawn({stdout: "pipe",
  stdin: "pipe"})` inside the container; the patched build completes it.
- node-style IPC (`process.send` round trip), `bun test` workers, `bun run
  --filter` channels: work (same pipe namespace fix).
- Console read cancellation without `WriteConsoleInputW`: raw-mode reads,
  `setRawMode` toggles, and exit with a pending read inside a ConPTY all work
  and nothing deadlocks.
- `uv_fs_realpath` now reports the real error (`EPERM`) instead of `EBADF`.

https://github.com/oven-sh/bun/pull/33107 (bun):

- `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` fallback: rebuild `X:\path`
  from the NT device form plus a device map learned from the cwd and the
  executable (the only trustworthy seeds, since `QueryDosDevice` and volume
  enumeration are denied). This single denial was breaking `bun file.js`
  (`CouldntReadCurrentDirectory`), `bun install` (`main returned error.EBADF`),
  `bun build` (`EBADFD opening root directory "."`), `bunx` (`EBADFD create
  package.json`), and every relative-path fs call whose path contains a dot or
  separator (`fs.writeFileSync("t.txt")`, `fs.readdirSync(".")`, `fs.cpSync`,
  `fs.opendirSync`, the shell's file redirects).
- `Bun.Terminal` ConPTY pipes are now under `\\.\pipe\LOCAL\` ("Failed to open
  PTY" before).
- The installer's four raw `GetFinalPathNameByHandleW` call sites now use the
  fallback-aware variant (`EPERM: failed opening node_modules/package dir`
  before).

With both: `bun file.js`, `bun -e`, `bun exec`, `bun install` (network,
extract, lifecycle scripts, bin links, lockfile), `bun add`, `bun build`,
`bun build --compile`, `bun test`, `bunx` (with a writable temp), Bun.serve +
fetch + net + WebSocket loopback, workers (node and web), `bun:sqlite`,
`bun:ffi`, `fs.watch`, and `Bun.Terminal` all work inside the container.

### Still broken, bun side (ranked)

1. `bun run <script>`: `error loading current directory`. The resolver builds
   `DirInfo` for every ancestor starting at `C:\`, and opening `C:\` is denied
   in any AppContainer (no `ALL APPLICATION PACKAGES` ACE on drive roots, by
   default, everywhere). The resolver treats that EPERM as fatal for the whole
   chain. Proof of mechanism: granting the container read on just the `C:\`
   directory object (`icacls C:\ /grant "*S-1-15-2-1:(RX)"`) makes `bun run`
   work; removing it breaks it again. Fix direction: in
   `bun_resolver::read_dir_info`'s open loop, treat `EPERM`/`EACCES` on an
   ancestor like an opaque or empty directory (the same way `ENOTDIR` is
   already tolerated) instead of returning `Ok(None)` for the whole walk.
   This also means nothing above the granted tree can hold `node_modules`,
   which is correct behavior in a sandbox anyway.
2. `node:fs` realpath family. Three different code paths, all broken
   differently:
   - `fs.realpathSync.native`, `fs.realpath.native`: libuv `uv_fs_realpath`,
     denied inside libuv (returns `EPERM`).
   - `fs.promises.realpath`: also routed to the native libuv path (and
     therefore broken) even though `fs.realpathSync` is not. Inconsistent.
   - `fs.realpathSync`/`fs.realpath`: the JS walk lstats every ancestor
     (`C:\` first) so it fails with `EPERM` for any path on the system drive.
   Fix direction: on Windows route all four through bun's own
   `open + get_fd_path` (which now has the fallback) instead of libuv's, and
   make the JS walk treat an ancestor lstat `EPERM` as "not a link" rather
   than fatal. Today a sandboxed process has no working `realpath` at all,
   which also means `--preserve-symlinks`-style identity, the isolated
   linker's store verification, and `require.resolve` through junctions all
   degrade.
3. Junction readback: junctions created inside the container get their
   substitute name rewritten by the kernel to `\??\Global\C:\...`, and libuv's
   `fs__readlink_handle` only accepts `\??\<drive>:`, so `readlink` returns
   `EINVAL` and `lstat` says "not a symlink" for junctions bun itself just
   created (traversal through them is fine). Needs the libuv readlink change;
   bun's own reparse-point reader (if/where it has one) should accept the
   `Global\` infix too.
4. Error quality (cosmetic but misleading): the openat failure surfaced as
   `EBADFD: unknown error`; a named-pipe listen denial surfaces as
   `ERR_INVALID_ARG_TYPE: Failed to listen at \\.\pipe\x` instead of `EACCES`;
   `bun -e` printed a spurious `error: Cannot read file "<cwd>\": EBADFD` line
   on every run (gone with the path fix).

### Still broken, libuv side (reported on oven-sh/libuv#5)

1. `NUL` is denied in an AppContainer, and `uv__stdio_create` opens `NUL` for
   every `UV_IGNORE` stdio slot, so **any spawn with an ignored stdio fails**
   (`uv_spawn` returns EPERM). `Bun.spawn` defaults stdin to ignore, so
   `Bun.spawn`/`Bun.spawnSync`/`execSync` with defaults fail while all-pipe or
   all-inherit spawns work. Suggested fix: when `CreateFileW("NUL")` fails and
   `uv_os_is_app_container()`, substitute an anonymous pipe with the parent
   end closed. Workaround today: always pass explicit `pipe`/`inherit` stdio.
2. `fs__readlink_handle` should accept `\??\Global\<drive>:` mount points
   (see above).

## Impossible or host responsibility (document these, do not wait for fixes)

These are AppContainer semantics, not bugs. Anyone embedding bun in a
sandboxed process has to deal with them:

- **File access is allow-listed.** The container only reads/writes what is
  ACL'd to its SID (or `ALL APPLICATION PACKAGES`), plus OS directories.
  The project tree must be granted explicitly (`icacls <dir> /grant
  "*S-1-15-2-1:(OI)(CI)(F)"` or a package-specific SID). `os.homedir()`
  returns a directory the process cannot even stat. Drive roots are never
  listable.
- **TEMP works by magic, HOME does not.** `CreateProcess` rewrites `TMP`/
  `TEMP` for an AppContainer child to `%LOCALAPPDATA%\Packages\<profile>\AC\
  Temp`, which exists and is writable, so `os.tmpdir()` and everything built
  on it work untouched. Nothing rewrites `USERPROFILE`.
- **True symlinks are impossible** (`SeCreateSymbolicLinkPrivilege` cannot be
  held by a lowbox token). Junctions and hardlinks work. Bun's installer
  already falls back to junctions and copies, so installs work; anything that
  insists on `fs.symlink(type: "file" | "dir")` cannot run sandboxed.
- **Named pipe servers must live under `\\.\pipe\LOCAL\`.** User-supplied
  pipe names (`net.listen({path})`, `Bun.listen({unix})`) outside that prefix
  are denied by the OS. Connecting to an existing pipe elsewhere is allowed if
  the pipe's ACL admits the container.
- **Loopback to other processes is blocked by design.** In-process (and
  same-package) loopback always works, so `Bun.serve` + `fetch` to yourself is
  fine. Reaching any other local process's 127.0.0.1 port (a database, a dev
  server, an inspector) requires the machine-level debugging exemption
  `CheckNetIsolation.exe LoopbackExempt -a -p=<container sid>` (admin), which
  shipped apps cannot rely on.
- **Network needs capabilities.** No capability means no DNS and no sockets
  (`WSAEACCES`). `internetClient` covers outbound internet;
  `privateNetworkClientServer` is needed for private-range addresses
  (corporate DNS servers included); `internetClientServer` for unsolicited
  inbound.
- **Non-interactive hosts must grant the window station.** Services or CI
  launching bun in a container must add the container SID to the window
  station and desktop DACLs or the process dies before `main`.
- **Machine-wide observation is limited.** `OpenProcess` on unrelated pids,
  enumerating other users' processes, and similar are denied; `process.kill`
  of an arbitrary pid will not work. Own-process and child management is fine.

## Debug-build-only notes (irrelevant for release binaries)

A debug `bun-debug.exe` loads `build/debug/js/*` and `src/**` (for
`bun:ffi`'s `FFI.h`) from the source tree at runtime, and dumps transpiled
sources to disk. Inside the container that surfaces as `bun-debug failed to
load bundled version of node:X` and `Failed to load FFI.h: Access is denied`
unless the checkout is granted read. Release builds embed all of it.

## Open questions / not covered

- Windows 11 was not available here; all "denied" results should be
  double-checked there once (the libuv PR author saw the same core set on
  26200). `NUL` being denied is the one most worth re-confirming.
- LPAC (`ALL_APPLICATION_PACKAGES_POLICY = opt out`, i.e. "less privileged
  AppContainer") was not tested; every grant in this report that names
  `ALL APPLICATION PACKAGES` would need the LPAC-specific SIDs instead.
- Inbound connections from off-box to a sandboxed `Bun.serve` (needs
  `internetClientServer`/firewall rules) were not exercised.
- `bun upgrade`, the crash reporter upload path, and `bun repl` (reads
  `%USERPROFILE%\.bun_repl_history`) were not exercised.
- A standing bug unrelated to AppContainers was found on the way: a Windows
  debug build of current main segfaults on any `Bun.$` command with a file
  redirect, in or out of the sandbox (release 1.3.14 is fine). Filed as
  https://github.com/oven-sh/bun/issues/33108.
