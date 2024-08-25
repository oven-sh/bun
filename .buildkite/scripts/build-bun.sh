#!/bin/bash

set -eo pipefail
source "$(dirname "$0")/env.sh"

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

cwd="$(pwd)"

mkdir -p build
source "$(dirname "$0")/download-artifact.sh" "build/bun-deps/**" --step "$BUILDKITE_GROUP_KEY-build-deps"
source "$(dirname "$0")/download-artifact.sh" "build/bun-zig.o" --step "$BUILDKITE_GROUP_KEY-build-zig"
source "$(dirname "$0")/download-artifact.sh" "build/bun-cpp-objects.a" --step "$BUILDKITE_GROUP_KEY-build-cpp" --split
cd build

run_command cmake .. "${CMAKE_FLAGS[@]}" \
  -GNinja \
  -DBUN_LINK_ONLY="1" \
  -DNO_CONFIGURE_DEPENDS="1" \
  -DBUN_ZIG_OBJ_DIR="$cwd/build" \
  -DBUN_CPP_ARCHIVE="$cwd/build/bun-cpp-objects.a" \
  -DBUN_DEPS_OUT_DIR="$cwd/build/bun-deps" \
  -DCMAKE_BUILD_TYPE="$CMAKE_BUILD_TYPE" \
  -DCPU_TARGET="$CPU_TARGET" \
  -DUSE_LTO="$USE_LTO" \
  -DUSE_DEBUG_JSC="$USE_DEBUG_JSC" \
  -DCANARY="$CANARY" \
  -DGIT_SHA="$GIT_SHA"
run_command ninja -v -j "$CPUS"
run_command ls

tag="bun-$BUILDKITE_GROUP_KEY"
if [ "$USE_LTO" == "OFF" ]; then
  # Remove OS check when LTO is enabled on macOS again
  if [[ "$tag" == *"darwin"* ]]; then
    tag="$tag-nolto"
  fi
fi

for name in bun bun-profile; do
  dir="$tag"
  if [ "$name" == "bun-profile" ]; then
    dir="$tag-profile"
  fi
  run_command chmod +x "$name"
  run_command "./$name" --revision
  run_command mkdir -p "$dir"
  run_command mv "$name" "$dir/$name"
  run_command zip -r "$dir.zip" "$dir"
  source "$cwd/.buildkite/scripts/upload-artifact.sh" "$dir.zip"
  # temporary disable this so CI can run
  # this is failing because $name is now in $dir/$name and if changed to $dir/$name we get ENOENT reading "bun:internal-for-testing"
  # if [ "$name" == "bun-profile" ]; then
  #   export BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING="1"
  #   run_command "./$name" -e "require('fs').writeFileSync('./features.json', JSON.stringify(require('bun:internal-for-testing').crash_handler.getFeatureData()))"
  #   source "$cwd/.buildkite/scripts/upload-artifact.sh" "features.json"
  # fi
done
