#!/bin/bash

set -eo pipefail
export FORCE_UPDATE_SUBMODULES=1

# env.sh calls update_submodules.sh
source "$(dirname "$0")/env.sh"

{ set +x; } 2>/dev/null

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

mkdir -p build
cd build
mkdir -p tmp_modules tmp_functions js codegen

run_command cmake .. "${CMAKE_FLAGS[@]}" \
  -GNinja \
  -DBUN_CPP_ONLY="1" \
  -DNO_CONFIGURE_DEPENDS="1" \
  -DCMAKE_BUILD_TYPE="$CMAKE_BUILD_TYPE" \
  -DCPU_TARGET="$CPU_TARGET" \
  -DUSE_LTO="$USE_LTO" \
  -DUSE_DEBUG_JSC="$USE_DEBUG_JSC" \
  -DCANARY="$CANARY" \
  -DGIT_SHA="$GIT_SHA"

chmod +x compile-cpp-only.sh
source compile-cpp-only.sh -v -j "$CPUS"
{ set +x; } 2>/dev/null

cd ..
source "$(dirname "$0")/upload-artifact.sh" "build/bun-cpp-objects.a" --split
