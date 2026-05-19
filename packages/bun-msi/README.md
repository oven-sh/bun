# bun-msi

WiX v5 source and build script for Bun's universal Windows MSI installer.

One `bun-windows.msi` carries all three payloads (`x64`, `x64-baseline`, `arm64`) and picks the right one at install time.

## What the MSI does

- Per-machine install to `%ProgramFiles%\Bun\bin\bun.exe` (+ `bunx.exe`, created at install time as a DuplicateFile copy).
- Detects the host at install time via a small native CustomAction DLL (`detect-cpu.c`, compiled at MSI-build time — no binary checked in): `IsWow64Process2()` for ARM64, `IsProcessorFeaturePresent(PF_AVX2)` for x64 vs x64-baseline. Same Win32 calls `install.ps1` P/Invokes.
- Appends `%ProgramFiles%\Bun\bin` to the **system** `PATH`.
- Sets the **system** env var `BUN_INSTALL` to the install root (trailing `\` left in place; all consumers path-join and Windows collapses `\\`, so no script CA needed — important for locked-down fleets where VBScript is disabled). Same layout `install.ps1` produces under `~\.bun`.
- Writes `HKLM\Software\Oven\Bun` (`InstallRoot`, `BinDir`, `Version`, `Variant`) for fleet inventory.
- Registers an Add/Remove Programs entry with the Bun icon, website, docs, and release-notes links.
- Blocks install on anything older than Windows 10 1809 / Server 2019 (build 17763) — same floor as `src/cli/install.ps1`.
- Single `UpgradeCode`: running a newer MSI replaces an older one in place; running the same version repairs. All three variants are one product family — installing any replaces any.
- Branded welcome / exit dialogs rendered from `src/bun.ico` onto Bun's cream→blush gradient. No binary bitmaps are checked into git; `build-msi.ps1` generates them via `System.Drawing` at build time.

Package platform is x64. ARM64 Windows 11 runs x64 MSIs under emulation and `IsWow64Process2` sees through it, so ARM64 hosts still get the native `arm64` payload. (ARM64 Windows 10 can't emulate x64 — but Bun's ARM64 build targets Win11 only.)

## Silent / enterprise deployment

```batch
msiexec /i bun-windows.msi /qn
msiexec /i bun-windows.msi /qn INSTALLFOLDER=D:\Tools\Bun ADDTOPATH=0
msiexec /i bun-windows.msi /qn BUNVARIANT=x64-baseline
msiexec /x bun-windows.msi /qn
```

Public properties (all cross the UAC boundary, so they work from an unelevated shell invoking the MSI):

| Property        | Default              | Effect                                                                 |
| --------------- | -------------------- | ---------------------------------------------------------------------- |
| `INSTALLFOLDER` | `%ProgramFiles%\Bun` | Install root. `bin\` is created beneath it.                            |
| `BUNVARIANT`    | auto-detected        | Force `x64`, `x64-baseline`, or `arm64`. Skips CPU detection when set. |
| `ADDTOPATH`     | `1`                  | `0` skips appending `bin` to the system `PATH`.                        |
| `SETBUNINSTALL` | `1`                  | `0` skips setting the system `BUN_INSTALL` env var.                    |

## Building locally

Requires Windows with a .NET SDK and MSVC (Visual Studio Build Tools) on the machine. The script installs the `wix` dotnet tool into `packages/bun-msi/.wix/` and compiles `detect-cpu.c` via `cl.exe`.

```powershell
cd packages\bun-msi
.\build-msi.ps1 `
  -BunExeX64         C:\path\to\x64\bun.exe `
  -BunExeX64Baseline C:\path\to\baseline\bun.exe `
  -BunExeArm64       C:\path\to\arm64\bun.exe
# → .\bun-windows.msi
```

`-Version` defaults to the contents of `LATEST`.

## CI

Built by the `msi` job in `.github/workflows/release.yml` on a `windows-latest` runner, after the `sign` job. Downloads `bun-windows-{x64,x64-baseline,aarch64}.zip` from the GitHub release, runs `build-msi.ps1`, and uploads `bun-windows.msi` back to the same release (plus as a workflow artifact for inspection).

Fires automatically on `release: published` and the daily canary schedule; for ad-hoc testing, dispatch the `Release` workflow manually with **"Should the Windows MSI installer be built?"** checked.

The embedded `bun.exe` binaries are already Authenticode-signed (they come from the release zips, which Buildkite's `windows-sign` step signed). The MSI wrapper itself is not signed here because the DigiCert `smctl` secrets live in Buildkite; if they are ever mirrored into GitHub Actions secrets, add an `smctl sign` step after the build.
