#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

tag="${1:-}"
if [ -z "$tag" ]; then
  echo "No tag provided."
  exit 1
fi

mkdir -p release
buildkite-agent artifact download '**' release --step bun-$tag-deps
buildkite-agent artifact download '**' release --step bun-$tag-zig
buildkite-agent artifact download '**' release --step bun-$tag-cpp

cmake \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_LTO=ON \
  -DBUN_LINK_ONLY=1 \
  -DBUN_ZIG_OBJ="$(pwd)/release/bun-zig.o" \
  -DBUN_CPP_ARCHIVE="$(pwd)/release/bun-cpp-objects.a" \
  -DBUN_DEPS_OUT_DIR="$(pwd)/release/src/deps" \
  -DNO_CONFIGURE_DEPENDS=1
ninja -v

chmod +x bun-profile bun
mkdir -p $tag-profile/ $tag/
mv bun-profile $tag-profile/bun-profile
mv bun $tag/bun
zip -r $tag-profile.zip $tag-profile
zip -r $tag.zip $tag
