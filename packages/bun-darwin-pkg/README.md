# bun-darwin-pkg

Builds the macOS `.pkg` installer for Bun — a universal (arm64 + x86_64)
package that double-click-installs `bun` and `bunx` to `/usr/local/bin`,
wires up `PATH` and `BUN_INSTALL`, and installs shell completions. The
Installer UI is themed around the Bun logo (rendered from
[`src/logo.svg`](../../src/logo.svg)) with custom welcome/conclusion panes.

## What the installer does

| Step        | Result                                                                            |
| ----------- | --------------------------------------------------------------------------------- |
| Payload     | `/usr/local/bin/bun` (universal), `/usr/local/bin/bunx → bun`                     |
| PATH        | `/etc/paths.d/200-bun` → `/usr/local/bin`                                         |
| Env         | `BUN_INSTALL="$HOME/.bun"` + `~/.bun/bin` on `PATH` in zsh/bash/fish profiles     |
| Completions | `bun completions` run as the installing user (best-effort)                       |

The shell-profile block is guarded with a `# bun (installed via .pkg)`
marker so reinstalling doesn't duplicate it.

## Building locally

You need the per-arch binaries on disk (either download them from a GitHub
release, or build them yourself). Then:

```sh
cd packages/bun-darwin-pkg
./build.sh --local /path/to/bun-arm64 /path/to/bun-x64
open build/Bun-v*.pkg
```

Without signing credentials the resulting package is ad-hoc signed and not
notarized; Gatekeeper will warn on open. That's expected for local builds.

## Building in CI

Buildkite runs this from [`.buildkite/ci.mjs`](../../.buildkite/ci.mjs) as
the `darwin-pkg` step, after both `darwin-*-build-bun` steps complete on a
`build-darwin` agent. Artifacts are downloaded via `buildkite-agent`, and
the finished `bun-darwin-universal.pkg` is uploaded alongside the existing
`bun-darwin-*.zip` artifacts for `upload-release.sh` to attach to the
GitHub release / S3.

## Signing & notarization

Set these on the CI agent (or export locally) to produce a notarized
installer that passes Gatekeeper:

| Variable                         | Value                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| `APPLE_DEVELOPER_ID_APPLICATION` | `Developer ID Application: <Team> (<TeamID>)`               |
| `APPLE_DEVELOPER_ID_INSTALLER`   | `Developer ID Installer: <Team> (<TeamID>)`                 |
| `APPLE_KEYCHAIN_PROFILE`         | name passed to `xcrun notarytool store-credentials`        |

If any of these are missing the script degrades gracefully: the binary is
ad-hoc signed, the installer is unsigned, and notarization is skipped with
a warning.

## Layout

```
build.sh                      entry point
distribution.xml.template     productbuild UI definition
resources/
  welcome.html                big kawaii bun, install summary
  conclusion.html             even bigger kawaii bun, next steps
  background*.png             rendered at build time from src/logo.svg
  license.txt                 copied from LICENSE.md at build time
scripts/
  postinstall                 PATH + BUN_INSTALL + completions
```

## Uninstalling

```sh
sudo rm -f /usr/local/bin/bun /usr/local/bin/bunx /etc/paths.d/200-bun
sudo pkgutil --forget sh.bun.bun
# optional: remove global packages + completions
rm -rf ~/.bun
```
