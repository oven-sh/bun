#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_ROOT/dist"
mkdir -p "$DIST"

# Detect macOS architecture
MAC_ARCH=$(uname -m)
case "$MAC_ARCH" in arm64|aarch64) MAC_ARCH="aarch64" ;; x86_64|amd64) MAC_ARCH="x64" ;; esac

echo "=== Building macOS $MAC_ARCH (native) ==="
cd "$REPO_ROOT"
bun scripts/build.ts --profile=release
strip build/release/bun
cp build/release/bun "$DIST/bore-darwin-${MAC_ARCH}"
codesign --force --sign - "$DIST/bore-darwin-${MAC_ARCH}"
echo "  -> $DIST/bore-darwin-${MAC_ARCH}"

echo ""
echo "=== Building Linux (Docker, native arch) ==="
docker build -t bore-linux-build -f scripts/Dockerfile.linux-build "$REPO_ROOT"
CONTAINER=$(docker create bore-linux-build)
# Docker on Apple Silicon builds aarch64, on Intel builds x64
DOCKER_ARCH=$(docker run --rm bore-linux-build cat /tmp/bun-arch 2>/dev/null || echo "aarch64")
docker cp "$CONTAINER:/bore-linux-${DOCKER_ARCH}" "$DIST/bore-linux-${DOCKER_ARCH}"
docker rm "$CONTAINER"
echo "  -> $DIST/bore-linux-${DOCKER_ARCH}"

echo ""
echo "=== Done ==="
ls -lh "$DIST"/bore-*
