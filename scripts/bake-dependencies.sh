#!/bin/sh
# Version: 1
#
# This script pre-downloads all build dependencies into the image.
# It should be run during AMI baking to avoid downloading dependencies
# during each CI build.
#
# Dependencies downloaded:
# - Zig compiler
# - WebKit (JavaScriptCore)
# - BoringSSL
# - And other cmake-managed dependencies

set -eu

print() {
    echo "$@"
}

error() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

# Detect architecture
detect_arch() {
    arch="$(uname -m)"
    case "$arch" in
    x86_64 | x64 | amd64)
        echo "x64"
        ;;
    aarch64 | arm64)
        echo "aarch64"
        ;;
    *)
        error "Unsupported architecture: $arch"
        ;;
    esac
}

# Detect ABI (glibc vs musl)
detect_abi() {
    if [ -f "/etc/alpine-release" ]; then
        echo "musl"
    else
        ldd_output="$(ldd --version 2>&1 || true)"
        case "$ldd_output" in
        *musl*)
            echo "musl"
            ;;
        *)
            echo ""
            ;;
        esac
    fi
}

ARCH="$(detect_arch)"
ABI="$(detect_abi)"

# Default paths - these should match what the buildkite agent uses
BUN_REPO_PATH="${BUN_REPO_PATH:-/var/lib/buildkite-agent/build}"
BUILD_DIR="${BUILD_DIR:-release}"

print "=== Bun Dependency Baking Script ==="
print "Architecture: $ARCH"
print "ABI: ${ABI:-glibc}"
print "Repository path: $BUN_REPO_PATH"
print "Build directory: $BUILD_DIR"

# Clone the Bun repository if it doesn't exist
if [ ! -d "$BUN_REPO_PATH/.git" ]; then
    print "Cloning Bun repository..."
    git clone --depth=1 https://github.com/oven-sh/bun.git "$BUN_REPO_PATH"
else
    print "Bun repository already exists, updating..."
    cd "$BUN_REPO_PATH"
    git fetch --depth=1 origin main
    git checkout FETCH_HEAD
fi

cd "$BUN_REPO_PATH"

# Install npm dependencies (will be cleaned later, but needed for codegen)
print "Installing npm dependencies..."
bun install --frozen-lockfile

# Generate cmake source lists (these are gitignored but required for cmake configure)
print "Generating cmake source lists..."
bun run scripts/glob-sources.mjs

# Set up build directory
BUILD_PATH="$BUN_REPO_PATH/build/$BUILD_DIR"
CACHE_PATH="$BUILD_PATH/cache"
mkdir -p "$BUILD_PATH" "$CACHE_PATH"

print "Build path: $BUILD_PATH"
print "Cache path: $CACHE_PATH"

# Run cmake configure to download all dependencies
# This will download: Zig, WebKit, BoringSSL, and all other dependencies
print "Running CMake configure to download dependencies..."

# Run cmake configure - this downloads WebKit
if [ -n "$ABI" ]; then
    if ! cmake -S "$BUN_REPO_PATH" -B "$BUILD_PATH" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCI=ON -DABI="$ABI"; then
        error "CMake configure failed for release build"
    fi
else
    if ! cmake -S "$BUN_REPO_PATH" -B "$BUILD_PATH" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCI=ON; then
        error "CMake configure failed for release build"
    fi
fi

# Run cmake build for clone targets only - this downloads Zig, BoringSSL, etc.
# These are build targets that download dependencies
print "Downloading build dependencies (Zig, BoringSSL, etc.)..."
CLONE_TARGETS="clone-zig clone-boringssl clone-mimalloc clone-zstd clone-lolhtml clone-cares clone-libdeflate clone-libarchive clone-tinycc clone-zlib clone-lshpack clone-brotli clone-highway clone-hdrhistogram clone-picohttpparser"

if ! cmake --build "$BUILD_PATH" --target $CLONE_TARGETS; then
    error "Failed to download build dependencies (clone targets) for release build in $BUILD_PATH"
fi

# Also download debug WebKit variant for debug builds
print "Downloading debug WebKit variant..."
if [ -n "$ABI" ]; then
    if ! cmake -S "$BUN_REPO_PATH" -B "$BUN_REPO_PATH/build/debug" -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCI=ON -DABI="$ABI"; then
        error "CMake configure failed for debug build"
    fi
else
    if ! cmake -S "$BUN_REPO_PATH" -B "$BUN_REPO_PATH/build/debug" -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCI=ON; then
        error "CMake configure failed for debug build"
    fi
fi

# Keep cmake/ninja files so subsequent builds don't re-download dependencies
# The ninja build system tracks what's been built - removing these files causes re-downloads
print "Keeping build system files for caching..."

# Remove node_modules - will be reinstalled during actual builds
print "Removing node_modules..."
rm -rf "$BUN_REPO_PATH/node_modules"

# List what was downloaded
print ""
print "=== Downloaded Dependencies ==="
VENDOR_PATH="$BUN_REPO_PATH/vendor"
if [ -d "$VENDOR_PATH/zig" ]; then
    print "✓ Zig compiler: $(du -sh "$VENDOR_PATH/zig" 2>/dev/null | cut -f1)"
fi
if [ -d "$CACHE_PATH" ]; then
    for webkit_dir in "$CACHE_PATH"/webkit-*; do
        if [ -d "$webkit_dir" ]; then
            print "✓ WebKit: $(du -sh "$webkit_dir" 2>/dev/null | cut -f1)"
            break
        fi
    done
fi
if [ -d "$VENDOR_PATH/boringssl" ]; then
    print "✓ BoringSSL: $(du -sh "$VENDOR_PATH/boringssl" 2>/dev/null | cut -f1)"
fi
if [ -d "$VENDOR_PATH/mimalloc" ]; then
    print "✓ mimalloc: $(du -sh "$VENDOR_PATH/mimalloc" 2>/dev/null | cut -f1)"
fi
if [ -d "$VENDOR_PATH/zstd" ]; then
    print "✓ zstd: $(du -sh "$VENDOR_PATH/zstd" 2>/dev/null | cut -f1)"
fi
if [ -d "$VENDOR_PATH/lolhtml" ]; then
    print "✓ lol-html: $(du -sh "$VENDOR_PATH/lolhtml" 2>/dev/null | cut -f1)"
fi
if [ -d "$VENDOR_PATH/cares" ]; then
    print "✓ c-ares: $(du -sh "$VENDOR_PATH/cares" 2>/dev/null | cut -f1)"
fi

# Calculate total size
TOTAL_SIZE="$(du -sh "$BUN_REPO_PATH" 2>/dev/null | cut -f1 || echo 'unknown')"
print ""
print "Total repository size: $TOTAL_SIZE"

print ""
print "=== Dependency baking complete ==="
print "The following will happen during CI builds:"
print "  1. git fetch origin <commit> (instead of full clone)"
print "  2. git checkout <commit>"
print "  3. rm -rf node_modules && bun install"
print "  4. Build will use pre-downloaded dependencies"
