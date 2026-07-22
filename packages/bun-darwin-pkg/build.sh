#!/usr/bin/env bash
#
# Build a universal macOS .pkg installer for Bun.
#
# Run by the `macos-pkg` job in .github/workflows/release.yml when a
# GitHub release is published (or via workflow_dispatch with
# use-macos-pkg=true). It:
#
#   1. Downloads bun-darwin-{aarch64,x64}.zip from the GitHub release
#   2. Lipo's the two binaries into a single universal binary
#   3. Codesigns the binary with Hardened Runtime + entitlements (if creds
#      are present)
#   4. Lays out a payload root at /usr/local, plus /etc/paths.d
#   5. Renders the kawaii installer background from the Bun logo
#   6. Runs pkgbuild + productbuild to produce Bun.pkg
#   7. Signs the installer with a Developer ID Installer identity and
#      submits it for notarization (if creds are present)
#   8. Uploads bun-darwin-universal.pkg back to the same release
#
# When signing credentials are not available the script still produces an
# unsigned .pkg so the workflow can be exercised before secrets are set up.
#
# Optional signing environment (all must be set together to sign):
#   APPLE_DEVELOPER_ID_APPLICATION  - "Developer ID Application: Oven (<TeamID>)"
#   APPLE_DEVELOPER_ID_INSTALLER    - "Developer ID Installer: Oven (<TeamID>)"
#   APPLE_KEYCHAIN_PROFILE          - notarytool keychain profile name
#     (created via `xcrun notarytool store-credentials`)
#
# Usage:
#   ./build.sh --from-release <tag>
#     Downloads bun-darwin-{aarch64,x64}.zip from the given GitHub release
#     (bun-v1.2.3 | 1.2.3 | v1.2.3 | canary) via `gh`, builds the .pkg, and
#     uploads it back to the same release with `gh release upload`.
#
#   ./build.sh --local <arm64-bun> <x64-bun>
#     Build from two local binaries — for testing on a dev machine.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PAYLOAD_ROOT="$BUILD_DIR/root"
# Committed sources (HTML, any bespoke backgrounds) live here; we stage them
# into a per-build directory so generated assets (background*.png,
# license.txt) from a previous run can never leak into this package.
SRC_RESOURCES_DIR="$SCRIPT_DIR/resources"
RESOURCES_DIR="$BUILD_DIR/resources"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"

PKG_IDENTIFIER="sh.bun.bun"
INSTALL_LOCATION="/usr/local"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

Color_Off=''; Red=''; Green=''; Yellow=''; Dim=''; Bold=''
if [[ -t 1 ]]; then
  Color_Off='\033[0m'
  Red='\033[0;31m'
  Green='\033[0;32m'
  Yellow='\033[0;33m'
  Dim='\033[0;2m'
  Bold='\033[1m'
fi

# fd 3 is a dup of the original stderr so run()'s trace line survives
# callers that redirect the function's stdout/stderr (e.g.
# `run qlmanage ... >/dev/null 2>&1` in render_background()).
exec 3>&2

log()    { echo -e "${Dim}[pkg]${Color_Off} $*"; }
ok()     { echo -e "${Green}[pkg]${Color_Off} $*"; }
warn()   { echo -e "${Yellow}[pkg]${Color_Off} $*"; }
fail()   { echo -e "${Red}[pkg] error:${Color_Off} $*" >&2; exit 1; }
run()    { echo -e "${Dim}\$ $*${Color_Off}" >&3; "$@"; }

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------

MODE=""
BUN_VERSION=""
RELEASE_TAG=""
case "${1:-}" in
  --local)
    MODE="local"
    LOCAL_ARM64="${2:?--local requires <arm64-bun> <x64-bun>}"
    LOCAL_X64="${3:?--local requires <arm64-bun> <x64-bun>}"
    ;;
  --from-release)
    # Accepts any of the forms the rest of the release pipeline passes
    # around (see formatTag() in packages/bun-release/src/github.ts):
    #   bun-v1.2.3 | 1.2.3 | v1.2.3 | canary
    MODE="release"
    RELEASE_TAG="${2:?--from-release requires <tag> (e.g. bun-v1.2.3, 1.2.3, or canary)}"
    case "$RELEASE_TAG" in
      canary|bun-v*) ;;
      v[0-9]*)       RELEASE_TAG="bun-${RELEASE_TAG}" ;;
      [0-9]*)        RELEASE_TAG="bun-v${RELEASE_TAG}" ;;
    esac
    # pkgbuild/productbuild require a numeric CFBundleVersion; for canary
    # fall through to LATEST below rather than passing the literal "canary".
    if [[ "$RELEASE_TAG" != "canary" ]]; then
      BUN_VERSION="${RELEASE_TAG#bun-v}"
    fi
    ;;
  *)
    fail "Usage: $0 --from-release <tag> | --local <arm64-bun> <x64-bun>"
    ;;
esac

if [[ -z "$BUN_VERSION" ]]; then
  BUN_VERSION="$(cat "$REPO_ROOT/LATEST" 2>/dev/null || true)"
fi
[[ -n "$BUN_VERSION" ]] || fail "Could not determine Bun version (ensure LATEST exists)"

PKG_NAME="Bun-v${BUN_VERSION}.pkg"

log "Building ${Bold}${PKG_NAME}${Color_Off} (identifier: ${PKG_IDENTIFIER})"

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$PAYLOAD_ROOT/bin" "$BUILD_DIR/flat" "$RESOURCES_DIR"

# Stage committed resources into the per-build dir. Generated assets
# (background*.png, license.txt) are gitignored, so on a clean checkout this
# only copies the HTML pages; on a dev machine with bespoke backgrounds
# committed it copies those too.
for f in "$SRC_RESOURCES_DIR"/*; do
  [[ -f "$f" ]] && cp "$f" "$RESOURCES_DIR/"
done

# ---------------------------------------------------------------------------
# Fetch per-arch binaries
# ---------------------------------------------------------------------------

download_release_asset() {
  local name="$1"
  log "Downloading $name from GitHub release $RELEASE_TAG"
  run gh release download "$RELEASE_TAG" \
    --repo "${GITHUB_REPOSITORY:-oven-sh/bun}" \
    --pattern "$name" \
    --dir "$BUILD_DIR" \
    --clobber
  [[ -f "$BUILD_DIR/$name" ]] || fail "release asset download produced no file: $name"
}

extract_bin() {
  local zip="$1" triplet="$2" out="$3"
  log "Extracting $triplet/bun from $zip"
  run unzip -oq "$BUILD_DIR/$zip" -d "$BUILD_DIR"
  [[ -f "$BUILD_DIR/$triplet/bun" ]] || fail "Expected $triplet/bun inside $zip"
  cp "$BUILD_DIR/$triplet/bun" "$out"
  chmod +x "$out"
}

ARM64_BIN="$BUILD_DIR/bun-arm64"
X64_BIN="$BUILD_DIR/bun-x64"

if [[ "$MODE" == "local" ]]; then
  cp "$LOCAL_ARM64" "$ARM64_BIN"
  cp "$LOCAL_X64" "$X64_BIN"
  chmod +x "$ARM64_BIN" "$X64_BIN"
else
  download_release_asset "bun-darwin-aarch64.zip"
  download_release_asset "bun-darwin-x64.zip"
  extract_bin "bun-darwin-aarch64.zip" "bun-darwin-aarch64" "$ARM64_BIN"
  extract_bin "bun-darwin-x64.zip"     "bun-darwin-x64"     "$X64_BIN"
fi

# ---------------------------------------------------------------------------
# Universal binary
# ---------------------------------------------------------------------------

UNIVERSAL_BIN="$PAYLOAD_ROOT/bin/bun"

log "Creating universal binary"
run lipo -create -output "$UNIVERSAL_BIN" "$ARM64_BIN" "$X64_BIN"
run lipo -info "$UNIVERSAL_BIN"
chmod 755 "$UNIVERSAL_BIN"

# bunx is a symlink to bun; create it in the payload so pkgbuild records it.
ln -sf bun "$PAYLOAD_ROOT/bin/bunx"

# ---------------------------------------------------------------------------
# Codesign (binary)
# ---------------------------------------------------------------------------

ENTITLEMENTS="$REPO_ROOT/entitlements.plist"

if [[ -n "${APPLE_DEVELOPER_ID_APPLICATION:-}" ]]; then
  log "Codesigning with Developer ID Application + Hardened Runtime"
  run codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$APPLE_DEVELOPER_ID_APPLICATION" \
    "$UNIVERSAL_BIN"
  run codesign --verify --verbose "$UNIVERSAL_BIN"
else
  warn "APPLE_DEVELOPER_ID_APPLICATION not set; using ad-hoc signature"
  run codesign --force --sign - \
    --entitlements "$ENTITLEMENTS" \
    "$UNIVERSAL_BIN"
fi

# ---------------------------------------------------------------------------
# Installer background (the huge kawaii Bun logo)
# ---------------------------------------------------------------------------

render_background() {
  local out="$RESOURCES_DIR/background.png"
  local out_dark="$RESOURCES_DIR/background-dark.png"
  local svg="$REPO_ROOT/src/logo.svg"

  # Already committed? Keep it — lets a designer drop in a bespoke image.
  if [[ -f "$out" && -f "$out_dark" ]]; then
    log "Using existing background images"
    return
  fi

  # The background is decorative — the welcome/conclusion panes already
  # embed the logo inline — so failure to render it is a warning, not
  # fatal. In particular, qlmanage needs a WindowServer session and will
  # silently produce nothing on a headless agent.
  log "Rendering installer background from $svg"
  local tmp="$BUILD_DIR/logo@2x.png"

  if command -v rsvg-convert >/dev/null 2>&1; then
    run rsvg-convert -w 720 -h 630 "$svg" -o "$tmp" || true
  elif command -v qlmanage >/dev/null 2>&1; then
    # qlmanage renders to a directory with the source name + .png. Requires
    # a GUI session; on headless agents it exits 0 without writing a file.
    run qlmanage -t -s 720 -o "$BUILD_DIR" "$svg" >/dev/null 2>&1 || true
    if [[ -f "$BUILD_DIR/$(basename "$svg").png" ]]; then
      mv "$BUILD_DIR/$(basename "$svg").png" "$tmp"
    fi
  fi

  if [[ ! -f "$tmp" ]]; then
    warn "Could not render installer background (no rsvg-convert, or qlmanage has no WindowServer)."
    warn "The .pkg will still work; welcome/conclusion panes carry the logo inline."
    warn "Install 'brew install librsvg' on the agent for the full experience."
    return
  fi

  # The Installer window is roughly 620x418pt. We emit the logo as the full
  # background and rely on distribution.xml's alignment="bottomleft" +
  # scaling="none" so it sits behind the content without being stretched.
  # Guarded with `|| true` so a sips failure (e.g. corrupt input from a
  # partially-written tmp file) degrades the same way as the earlier
  # renderers — the <background> elements are stripped downstream when the
  # PNGs are absent.
  if ! run sips -s format png --resampleHeightWidthMax 700 "$tmp" --out "$out" >/dev/null 2>&1; then
    rm -f "$out"
    warn "sips failed; continuing without installer background"
    return
  fi
  cp "$out" "$out_dark" || true

  ok "Rendered $(basename "$out")"
}

render_background

# ---------------------------------------------------------------------------
# License
# ---------------------------------------------------------------------------

# Installer wants plain text for the license pane.
if [[ ! -f "$RESOURCES_DIR/license.txt" ]]; then
  cp "$REPO_ROOT/LICENSE.md" "$RESOURCES_DIR/license.txt"
fi

# ---------------------------------------------------------------------------
# Component package
# ---------------------------------------------------------------------------

COMPONENT_PKG="$BUILD_DIR/flat/bun-component.pkg"

log "Building component package"
# --ownership recommended normalises payload ownership to root:wheel.
# Without it pkgbuild defaults to --ownership preserve and records the
# builder's UID/GID (501:20 on GitHub Actions runners) into the manifest,
# so /usr/local/bin/bun on the target Mac ends up owned by whoever has
# UID 501 there — usually the first local account — and can be replaced
# without sudo.
run pkgbuild \
  --root "$PAYLOAD_ROOT" \
  --identifier "$PKG_IDENTIFIER" \
  --version "$BUN_VERSION" \
  --install-location "$INSTALL_LOCATION" \
  --scripts "$SCRIPTS_DIR" \
  --ownership recommended \
  "$COMPONENT_PKG"

# ---------------------------------------------------------------------------
# Distribution package (adds the UI: background, welcome, conclusion)
# ---------------------------------------------------------------------------

DIST_XML="$BUILD_DIR/distribution.xml"

# Compute installed size in KB for the choice description.
INSTALL_KB="$(du -sk "$PAYLOAD_ROOT" | awk '{print $1}')"

sed \
  -e "s/@BUN_VERSION@/$BUN_VERSION/g" \
  -e "s/@PKG_IDENTIFIER@/$PKG_IDENTIFIER/g" \
  -e "s/@INSTALL_KB@/$INSTALL_KB/g" \
  "$SCRIPT_DIR/distribution.xml.template" > "$DIST_XML"

# productbuild validates every file referenced from --resources; if
# render_background() couldn't produce the PNGs (headless agent, no
# rsvg-convert) drop the <background> elements so the build still succeeds.
if [[ ! -f "$RESOURCES_DIR/background.png" || ! -f "$RESOURCES_DIR/background-dark.png" ]]; then
  warn "Omitting <background> from distribution.xml (PNGs not available)"
  sed -i '' -e '/<background /d' -e '/<background-darkAqua /d' "$DIST_XML"
fi

PRODUCT_PKG="$BUILD_DIR/$PKG_NAME"

log "Building product archive"
run productbuild \
  --distribution "$DIST_XML" \
  --resources "$RESOURCES_DIR" \
  --package-path "$BUILD_DIR/flat" \
  "$PRODUCT_PKG"

# ---------------------------------------------------------------------------
# Sign + notarize the installer
# ---------------------------------------------------------------------------

FINAL_PKG="$BUILD_DIR/signed-$PKG_NAME"

if [[ -n "${APPLE_DEVELOPER_ID_INSTALLER:-}" ]]; then
  log "Signing installer with Developer ID Installer"
  run productsign --timestamp \
    --sign "$APPLE_DEVELOPER_ID_INSTALLER" \
    "$PRODUCT_PKG" "$FINAL_PKG"
  run pkgutil --check-signature "$FINAL_PKG"

  if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
    log "Submitting for notarization (this can take a few minutes)"
    run xcrun notarytool submit "$FINAL_PKG" \
      --keychain-profile "$APPLE_KEYCHAIN_PROFILE" \
      --wait
    log "Stapling notarization ticket"
    run xcrun stapler staple "$FINAL_PKG"
    run xcrun stapler validate "$FINAL_PKG"
  else
    warn "APPLE_KEYCHAIN_PROFILE not set; skipping notarization"
  fi
else
  warn "APPLE_DEVELOPER_ID_INSTALLER not set; installer will be unsigned"
  cp "$PRODUCT_PKG" "$FINAL_PKG"
fi

mv "$FINAL_PKG" "$BUILD_DIR/$PKG_NAME"
# Also emit a stable, version-less filename for the GitHub releases "latest"
# redirect, matching the bun-<triplet>.zip convention.
cp "$BUILD_DIR/$PKG_NAME" "$BUILD_DIR/bun-darwin-universal.pkg"

ok "Built ${Bold}$BUILD_DIR/$PKG_NAME${Color_Off}"
ls -lh "$BUILD_DIR/$PKG_NAME"

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

if [[ "$MODE" == "release" ]]; then
  log "Uploading to GitHub release $RELEASE_TAG"
  run gh release upload "$RELEASE_TAG" \
    --repo "${GITHUB_REPOSITORY:-oven-sh/bun}" \
    --clobber \
    "$BUILD_DIR/bun-darwin-universal.pkg"
fi

ok "Done ✨"
