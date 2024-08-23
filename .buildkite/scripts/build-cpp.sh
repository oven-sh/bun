#!/bin/bash

set -eo pipefail
export FORCE_UPDATE_SUBMODULES=1

# env.sh calls update_submodules.sh
source "$(dirname "$0")/env.sh"
source "$(dirname "$0")/fix-cmake.sh"

{ set +x; } 2>/dev/null

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

run_command cmake -B build "${CMAKE_FLAGS[@]}" \
  -GNinja \
  -DBUN_CPP_ONLY="1" \
  -DNO_CONFIGURE_DEPENDS="1" \
  -DCMAKE_BUILD_TYPE="$CMAKE_BUILD_TYPE" \
  -DUSE_CPU="$CPU_TARGET" \
  -DUSE_LTO="$USE_LTO" \
  -DENABLE_ASSERTIONS="$USE_DEBUG_JSC" \
  -DENABLE_CANARY="ON" \
  -DUSE_CANARY_REVISION="$CANARY" \
  -DUSE_REVISION="$GIT_SHA"
cmake build --build build

source "$(dirname "$0")/upload-artifact.sh" "build/libbun.a" --split
