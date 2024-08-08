#!/usr/bin/env bash
set -e

export TARGET_PLATFORM=${1:-win32}
export TARGET_ARCH=${2:-x64}

if ! which bun; then
  export PATH="$PATH:$HOME/.bun/bin"
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../"

OUT=build-codegen-${TARGET_PLATFORM}-${TARGET_ARCH}

if [ -n "$3" ]; then
  OUT="$3"
fi

rm -rf "$OUT/codegen"
rm -rf "$OUT/js"
mkdir -p "$OUT"
mkdir -p "$OUT/"{codegen,js,tmp_functions,tmp_modules}

OUT=$(realpath "$OUT")

task() {
  echo '$ '"$@"
  "$@"
  if [ "$?" != "0" ]; then
    # some scripts are flaky, run them again
    echo "!!! retrying"
    "$@"
    if [ "$?" != "0" ]; then
      echo "!!! failed"
      exit 1
    fi
  fi
}

task bun ./src/codegen/bundle-modules.ts --debug=OFF "$OUT"

rm -rf "$OUT/tmp_functions"
rm -rf "$OUT/tmp_modules"

CLASSES=(
  ./src/bun.js/*.classes.ts
  ./src/bun.js/api/*.classes.ts
  ./src/bun.js/test/*.classes.ts
  ./src/bun.js/webcore/*.classes.ts
  ./src/bun.js/node/*.classes.ts
)
task bun "./src/codegen/generate-classes.ts" ${CLASSES[@]} "$OUT/codegen"

LUTS=(
  ./src/bun.js/bindings/BunObject.cpp
  ./src/bun.js/bindings/ZigGlobalObject.lut.txt
  ./src/bun.js/bindings/JSBuffer.cpp
  ./src/bun.js/bindings/BunProcess.cpp
  ./src/bun.js/bindings/ProcessBindingConstants.cpp
  ./src/bun.js/bindings/ProcessBindingNatives.cpp
)
for lut in ${LUTS[@]}; do
  result=$(basename $lut | sed 's/.lut.txt/.cpp/' | sed 's/.cpp/.lut.h/')
  task bun "./src/codegen/create-hash-table.ts" "$lut" "$OUT/codegen/$result"
done

task bun "./src/codegen/generate-jssink.ts" "$OUT/codegen"

wait

rm -rf "$OUT/tmp"*

echo "-> `basename "$OUT"`"
