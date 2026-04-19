# bun-darwin-pkg

Builds the macOS `.pkg` installer for Bun — a universal (arm64 + x86_64)
package that double-click-installs `bun` and `bunx` to `/usr/local/bin`,
wires up `PATH` and `BUN_INSTALL`, and installs shell completions. The
Installer UI is themed around the Bun logo (rendered from
[`src/logo.svg`](../../src/logo.svg)) with custom welcome/conclusion panes.

## What the installer does

| Step        | Result                                                                        |
| ----------- | ----------------------------------------------------------------------------- |
| Payload     | `/usr/local/bin/bun` (universal), `/usr/local/bin/bunx → bun`                 |
| PATH        | `/etc/paths.d/200-bun` → `/usr/local/bin`                                     |
| Env         | `BUN_INSTALL="$HOME/.bun"` + `~/.bun/bin` on `PATH` in zsh/bash/fish profiles |
| Completions | `bun completions` run as the installing user (best-effort)                    |

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

### Releases (GitHub Actions)

The production `.pkg` is built by the **`macos-pkg`** job in
[`.github/workflows/release.yml`](../../.github/workflows/release.yml),
which fires when a GitHub release is published (the same trigger that
generates `SHASUMS256.txt.asc`). It runs on `macos-latest`, calls
`./build.sh --from-release <tag>`, and:

1. downloads `bun-darwin-{aarch64,x64}.zip` from the release via `gh`
2. builds / codesigns / notarizes the universal `.pkg`
3. uploads `bun-darwin-universal.pkg` back to the same release

The `sign` job `needs: macos-pkg`, so the `.pkg` is present before
`SHASUMS256.txt` is generated and therefore included in the signature.
If Apple signing secrets (`APPLE_CERTIFICATES_P12`, `APPLE_NOTARY_*`)
aren't configured the job still produces and attaches an unsigned
package.

### Buildkite (testing only)

A `darwin-pkg` step in [`.buildkite/ci.mjs`](../../.buildkite/ci.mjs) can
be triggered with `[build pkg]` in the commit message to exercise
`build.sh` end-to-end against the freshly-built darwin artifacts on a PR
branch. It uploads the result as a Buildkite artifact for inspection but
does **not** attach it to any release.

## Signing & notarization

Set these on the CI agent (or export locally) to produce a notarized
installer that passes Gatekeeper:

| Variable                         | Value                                               |
| -------------------------------- | --------------------------------------------------- |
| `APPLE_DEVELOPER_ID_APPLICATION` | `Developer ID Application: <Team> (<TeamID>)`       |
| `APPLE_DEVELOPER_ID_INSTALLER`   | `Developer ID Installer: <Team> (<TeamID>)`         |
| `APPLE_KEYCHAIN_PROFILE`         | name passed to `xcrun notarytool store-credentials` |

If any of these are missing the script degrades gracefully: the binary is
ad-hoc signed, the installer is unsigned, and notarization is skipped with
a warning.

## Layout

```text
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
