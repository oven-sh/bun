# bun-msi

WiX v5 source and build script for Bun's Windows MSI installer.

## What the MSI does

- Per-machine install to `%ProgramFiles%\Bun\bin\bun.exe` (+ `bunx.exe`).
- Appends `%ProgramFiles%\Bun\bin` to the **system** `PATH`.
- Sets the **system** env var `BUN_INSTALL` to the install root (e.g. `C:\Program Files\Bun\` — the trailing `\` is Windows Installer's directory-property convention; every consumer in the tree path-joins, and avoiding it would require a script CA that enterprise Windows images increasingly disable). Same layout `install.ps1` produces under `~\.bun`, so `bun upgrade` / `bun completions` behave the same either way.
- Registers an Add/Remove Programs entry with the Bun icon, website, docs, and release-notes links.
- Blocks install on anything older than Windows 10 1809 / Server 2019 (build 17763) — same floor as `src/cli/install.ps1`.
- Major-upgrade aware: running a newer MSI replaces an older one in place; running the same version repairs.
- Branded welcome / exit dialogs rendered from `src/bun.ico` onto Bun's cream-to-pink gradient. No binary bitmaps are checked into git; `build-msi.ps1` generates them via `System.Drawing` at build time.

## Silent / enterprise deployment

```batch
msiexec /i bun-windows-x64.msi /qn
msiexec /i bun-windows-x64.msi /qn INSTALLFOLDER=D:\Tools\Bun ADDTOPATH=0
msiexec /x bun-windows-x64.msi /qn
```

Public properties (all cross the UAC boundary, so they work from an unelevated shell invoking the MSI):

| Property        | Default              | Effect                                              |
| --------------- | -------------------- | --------------------------------------------------- |
| `INSTALLFOLDER` | `%ProgramFiles%\Bun` | Install root. `bin\` is created beneath it.         |
| `ADDTOPATH`     | `1`                  | `0` skips appending `bin` to the system `PATH`.     |
| `SETBUNINSTALL` | `1`                  | `0` skips setting the system `BUN_INSTALL` env var. |

The install also writes `HKLM\Software\Oven\Bun` (`InstallRoot`, `BinDir`, `Version`) for fleet inventory tooling that prefers a stable registry key over parsing ARP.

## Building locally

Requires Windows with a .NET SDK on `PATH` (the script installs the `wix` dotnet tool into `packages/bun-msi/.wix/`).

```powershell
cd packages\bun-msi
.\build-msi.ps1 -BunExe C:\path\to\bun.exe -Arch x64
# → .\bun-windows-x64.msi
```

Pass `-Arch arm64` for ARM64. `-Version` defaults to the contents of `LATEST`.

## CI

Built by the `msi` job in `.github/workflows/release.yml`. It runs on a `windows-latest` runner after the `sign` job, once per matrix entry (`bun-windows-x64`, `bun-windows-x64-baseline`, `bun-windows-aarch64`), downloads the corresponding zip from the GitHub release, runs `build-msi.ps1`, and uploads the `.msi` back to the same release (plus as a workflow artifact for inspection). WiX cross-builds the arm64 package from the x64 host — it only embeds the binary, it doesn't run it.

The job fires automatically on `release: published` and the daily canary schedule; for ad-hoc testing, dispatch the `Release` workflow manually with the **Should Windows MSI installers be built?** input checked.

The embedded `bun.exe` is already Authenticode-signed (it comes from the release zip, which was signed on Buildkite). The MSI wrapper itself is not signed here because the DigiCert `smctl` secrets live in Buildkite; if they are ever mirrored into GitHub Actions secrets, add an `smctl sign` step after the build.
