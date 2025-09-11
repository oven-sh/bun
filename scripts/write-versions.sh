#!/bin/bash
set -exo pipefail

WEBKIT_VERSION=$(grep 'set(WEBKIT_TAG' "CMakeLists.txt" | awk '{print $2}' | cut -f 1 -d ')')
MIMALLOC_VERSION=$(git rev-parse HEAD:./src/deps/mimalloc)
LIBARCHIVE_VERSION=$(git rev-parse HEAD:./src/deps/libarchive)
PICOHTTPPARSER_VERSION=$(git rev-parse HEAD:./src/deps/picohttpparser)
BORINGSSL_VERSION=$(git rev-parse HEAD:./src/deps/boringssl)
ZLIB_VERSION=$(git rev-parse HEAD:./src/deps/zlib)
LOLHTML=$(git rev-parse HEAD:./src/deps/lol-html)
TINYCC=$(git rev-parse HEAD:./src/deps/tinycc)
C_ARES=$(git rev-parse HEAD:./src/deps/c-ares)
ZSTD=$(git rev-parse HEAD:./src/deps/zstd)
LSHPACK=$(git rev-parse HEAD:./src/deps/ls-hpack)
LIBDEFLATE=$(git rev-parse HEAD:./src/deps/libdeflate)

# generated_versions_list.zig is no longer needed - versions are handled by CMake-generated header
# This script is kept for reference but the file generation has been removed
