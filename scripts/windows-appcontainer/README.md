# Windows AppContainer harness

Manual tooling used to exercise bun inside a Windows AppContainer (lowbox
token). Nothing here runs in CI.

- `ac_run.c`: launcher. Creates (or reuses) an AppContainer profile, grants the
  container SID on the current window station and desktop (required outside an
  interactive session or any exe importing user32 dies with 0xC0000142), builds
  the `SECURITY_CAPABILITIES` attribute, and runs the command in a
  kill-on-close job with inherited stdio.
  `clang-cl /O1 ac_run.c /Fe:ac_run.exe`
- `acprobe.c`: Win32 primitive probe (pipe namespaces, GetFinalPathNameByHandle
  flavors, QueryDosDevice, NUL/CONOUT$, symlink/hardlink, registry, winsock,
  ConPTY). Run it bare and under `ac_run.exe` and diff.
- `probes/*.mjs`: runtime API probes driven by `run_probes.ps1` through
  `bun -e "await import('./p_x.mjs')"`.
- `tooling.ps1`: `bun install` / `run` / `add` / `test` / `build` / `bunx` /
  `--compile` matrix.

The work area needs an ACL grant before anything runs in the container:
`icacls C:\ac /grant "*S-1-15-2-1:(OI)(CI)(F)" /Q` (S-1-15-2-1 is
ALL APPLICATION PACKAGES).
