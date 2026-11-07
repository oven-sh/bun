#!/bin/bash
set -euo pipefail
usage() {
    echo "usage: hardened-icu.sh <WebKit checkout>/icu <out> <cc> <c++> <ar> <patch>... -- <compiler flag>..." >&2
    exit 2
}
[ $# -ge 5 ] || usage
here=$1
out=$2 CC=$3 CXX=$4 AR=$5
shift 5
patches=()
while [ $# -gt 0 ] && [ "$1" != -- ]; do
    patches+=("$1")
    shift
done
# At least one patch: without the decompression hook, ICU cannot read the data that it is linked with.
[ $# -gt 0 ] && [ ${#patches[@]} -gt 0 ] || usage
shift
flags="$* -mno-omit-leaf-frame-pointer -g1 -fno-omit-frame-pointer -ffunction-sections -fdata-sections -faddrsig -fno-unwind-tables -fno-asynchronous-unwind-tables -DU_STATIC_IMPLEMENTATION=1 -Os"
version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$here/source.json")
sha256=$(sed -n 's/.*"sha256": "\(.*\)".*/\1/p' "$here/source.json")
# BusyBox's sha256sum has no --check and no --quiet.
verify() {
    echo "$sha256  $1" | sha256sum -c - > /dev/null && return
    echo "$1 is not the ICU $version of $here/source.json" >&2
    exit 1
}
mkdir -p "$out"
sources=${BUN_ICU_SOURCES:-$out/icu4c-$version-sources.tgz}
if [ ! -f "$sources" ]; then
    curl -fsSL -o "$sources.partial" "https://github.com/unicode-org/icu/releases/download/release-$version/icu4c-$version-sources.tgz"
    verify "$sources.partial"
    mv "$sources.partial" "$sources"
fi
verify "$sources"
rm -rf "$out/icu" "$out/lib"
mkdir -p "$out/icu" "$out/lib"
tar -xf "$sources" -C "$out/icu" --strip-components=1 --no-same-owner
for patch in "${patches[@]}"; do
    echo "applying ${patch##*/}"
    patch -s -p1 -d "$out/icu" < "$patch"
done
cd "$out/icu/source"
export CC CXX AR LDFLAGS="-fuse-ld=lld" CFLAGS="$flags -std=c17"
export CXXFLAGS="$flags -stdlib=libstdc++ -DUCONFIG_NO_LEGACY_CONVERSION=1 -std=c++20 -fno-exceptions -fno-c++-static-destructors"
./configure --enable-static --disable-shared --disable-layoutex --disable-layout --with-data-packaging=static --disable-samples --disable-debug --disable-tests --disable-extras --disable-icuio > configure.log 2>&1 || { tail -n 20 configure.log >&2; exit 1; }
mkdir -p lib bin
for part in stubdata common i18n; do
    make -C $part -j"$(nproc)" > make-$part.log 2>&1 || { tail -n 40 make-$part.log >&2; exit 1; }
done
cp lib/libicuuc.a lib/libicui18n.a "$out/lib/"
