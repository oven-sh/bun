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
    print "error: $@" >&2
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
BUILD_TYPE="${BUILD_TYPE:-release}"

print "=== Bun Dependency Baking Script ==="
print "Architecture: $ARCH"
print "ABI: ${ABI:-glibc}"
print "Repository path: $BUN_REPO_PATH"
print "Build type: $BUILD_TYPE"

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
BUILD_PATH="$BUN_REPO_PATH/build/$BUILD_TYPE"
CACHE_PATH="$BUILD_PATH/cache"
mkdir -p "$BUILD_PATH" "$CACHE_PATH"

print "Build path: $BUILD_PATH"
print "Cache path: $CACHE_PATH"

# Run cmake configure to download all dependencies
# This will download: Zig, WebKit, BoringSSL, and all other dependencies
print "Running CMake configure to download dependencies..."

CMAKE_ARGS="-S $BUN_REPO_PATH -B $BUILD_PATH"
CMAKE_ARGS="$CMAKE_ARGS -G Ninja"
CMAKE_ARGS="$CMAKE_ARGS -DCMAKE_BUILD_TYPE=Release"
CMAKE_ARGS="$CMAKE_ARGS -DCI=ON"

if [ -n "$ABI" ]; then
    CMAKE_ARGS="$CMAKE_ARGS -DABI=$ABI"
fi

# Run cmake configure - this downloads WebKit
cmake $CMAKE_ARGS

# Run cmake build for clone targets only - this downloads Zig, BoringSSL, etc.
# These are build targets that download dependencies
print "Downloading build dependencies (Zig, BoringSSL, etc.)..."
cmake --build "$BUILD_PATH" --target clone-zig clone-boringssl clone-mimalloc clone-zstd clone-lolhtml clone-cares clone-libdeflate clone-libarchive clone-tinycc clone-zlib clone-lshpack clone-brotli clone-highway clone-hdrhistogram clone-picohttpparser || true

# Also download debug WebKit variant for debug builds
print "Downloading debug WebKit variant..."
cmake $CMAKE_ARGS -DCMAKE_BUILD_TYPE=Debug -B "$BUN_REPO_PATH/build/debug" || true

# Clean up build artifacts but keep downloaded dependencies
print "Cleaning up build artifacts..."
rm -rf "$BUILD_PATH/CMakeFiles" "$BUILD_PATH/CMakeCache.txt" "$BUILD_PATH/cmake_install.cmake" "$BUILD_PATH/build.ninja" "$BUILD_PATH/compile_commands.json" "$BUILD_PATH/.ninja_deps" "$BUILD_PATH/.ninja_log"
rm -rf "$BUN_REPO_PATH/build/debug/CMakeFiles" "$BUN_REPO_PATH/build/debug/CMakeCache.txt" "$BUN_REPO_PATH/build/debug/build.ninja" 2>/dev/null || true

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
