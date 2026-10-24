#!/bin/bash
set -euo pipefail
here=$1
out=$2 CC=$3 CXX=$4 AR=$5
shift 5
flags="$* -mno-omit-leaf-frame-pointer -g1 -fno-omit-frame-pointer -ffunction-sections -fdata-sections -faddrsig -fno-unwind-tables -fno-asynchronous-unwind-tables -DU_STATIC_IMPLEMENTATION=1 -Os"
version=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$here/source.json")
sha256=$(sed -n 's/.*"sha256": "\(.*\)".*/\1/p' "$here/source.json")
mkdir -p "$out"
sources=${BUN_ICU_SOURCES:-$out/icu4c-$version-sources.tgz}
[ -f "$sources" ] || curl -fsSL -o "$sources" "https://github.com/unicode-org/icu/releases/download/release-$version/icu4c-$version-sources.tgz"
echo "$sha256  $sources" | sha256sum --check --quiet
rm -rf "$out/icu" "$out/lib"
mkdir -p "$out/icu" "$out/lib"
tar -xf "$sources" -C "$out/icu" --strip-components=1 --no-same-owner
patch -s -p1 -d "$out/icu" < "$here/udata-decompress-hook.patch"
cd "$out/icu/source"
export CC CXX AR LDFLAGS="-fuse-ld=lld" CFLAGS="$flags -std=c17"
export CXXFLAGS="$flags -stdlib=libstdc++ -DUCONFIG_NO_LEGACY_CONVERSION=1 -std=c++20 -fno-exceptions -fno-c++-static-destructors"
./configure --enable-static --disable-shared --disable-layoutex --disable-layout --with-data-packaging=static --disable-samples --disable-debug --disable-tests --disable-extras --disable-icuio > configure.log 2>&1 || { tail -n 20 configure.log >&2; exit 1; }
mkdir -p lib bin
for part in stubdata common i18n; do
    make -C $part -j"$(nproc)" > make-$part.log 2>&1 || { tail -n 40 make-$part.log >&2; exit 1; }
done
cp lib/libicuuc.a lib/libicui18n.a "$out/lib/"
