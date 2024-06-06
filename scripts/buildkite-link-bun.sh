#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

tag="${1:-}"
if [ -z "$tag" ]; then
  echo "No tag provided."
  exit 1
fi

export USE_LTO="ON"
if [[ $* == *--fast* ]]; then
  export USE_LTO="OFF"
fi

mkdir -p release
buildkite-agent artifact download '**' release --step bun-$tag-deps
buildkite-agent artifact download '**' release --step bun-$tag-zig
buildkite-agent artifact download '**' release --step bun-$tag-cpp

cmake \
  -GNinja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_LTO=${USE_LTO} \
  -DBUN_LINK_ONLY=1 \
  -DBUN_ZIG_OBJ="$(pwd)/release/bun-zig.o" \
  -DBUN_CPP_ARCHIVE="$(pwd)/release/bun-cpp-objects.a" \
  -DBUN_DEPS_OUT_DIR="$(pwd)/release/src/deps" \
  -DNO_CONFIGURE_DEPENDS=1
ninja -v

chmod +x bun-profile bun
mkdir -p bun-$tag-profile/ bun-$tag/
mv bun-profile bun-$tag-profile/bun-profile
mv bun bun-$tag/bun
zip -r bun-$tag-profile.zip bun-$tag-profile
zip -r bun-$tag.zip bun-$tag
