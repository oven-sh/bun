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

rm -rf src/generated_versions_list.zig
echo "// AUTO-GENERATED FILE. Created via .scripts/write-versions.sh" >src/generated_versions_list.zig
echo "" >>src/generated_versions_list.zig
echo "pub const boringssl = \"$BORINGSSL_VERSION\";" >>src/generated_versions_list.zig
echo "pub const libarchive = \"$LIBARCHIVE_VERSION\";" >>src/generated_versions_list.zig
echo "pub const mimalloc = \"$MIMALLOC_VERSION\";" >>src/generated_versions_list.zig
echo "pub const picohttpparser = \"$PICOHTTPPARSER_VERSION\";" >>src/generated_versions_list.zig
echo "pub const webkit = \"$WEBKIT_VERSION\";" >>src/generated_versions_list.zig
echo "pub const zig = @import(\"std\").fmt.comptimePrint(\"{}\", .{@import(\"builtin\").zig_version});" >>src/generated_versions_list.zig
echo "pub const zlib = \"$ZLIB_VERSION\";" >>src/generated_versions_list.zig
echo "pub const tinycc = \"$TINYCC\";" >>src/generated_versions_list.zig
echo "pub const lolhtml = \"$LOLHTML\";" >>src/generated_versions_list.zig
echo "pub const c_ares = \"$C_ARES\";" >>src/generated_versions_list.zig
echo "pub const libdeflate = \"$LIBDEFLATE\";" >>src/generated_versions_list.zig
echo "pub const zstd = \"$ZSTD\";" >>src/generated_versions_list.zig
echo "pub const lshpack = \"$LSHPACK\";" >>src/generated_versions_list.zig
echo "" >>src/generated_versions_list.zig

zig fmt src/generated_versions_list.zig
