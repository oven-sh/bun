#!/usr/bin/env bash
set -e

export TARGET_PLATFORM=${1:-win32}
export TARGET_ARCH=${2:-x64}

cd "$(dirname "${BASH_SOURCE[0]}")/../"

OUT=$(realpath build-codegen-${TARGET_PLATFORM}-${TARGET_ARCH})

rm -rf "$OUT"
mkdir -p "$OUT"

bun ./src/codegen/bundle-functions.ts --debug=OFF "$OUT" &

bun ./src/codegen/bundle-modules.ts --debug=OFF "$OUT" &

rm -rf "$OUT/tmp_functions"
rm -rf "$OUT/tmp_modules"

CLASSES=(
  ./src/bun.js/*.classes.ts
  ./src/bun.js/api/*.classes.ts
  ./src/bun.js/test/*.classes.ts
  ./src/bun.js/webcore/*.classes.ts
  ./src/bun.js/node/*.classes.ts
)
bun "./src/codegen/generate-classes.ts" ${CLASSES[@]} "$OUT/codegen" &

LUTS=(
  ./src/bun.js/bindings/BunObject.cpp
  ./src/bun.js/bindings/ZigGlobalObject.lut.txt
  ./src/bun.js/bindings/JSBuffer.cpp
  ./src/bun.js/bindings/BunProcess.cpp
  ./src/bun.js/bindings/ProcessBindingConstants.cpp
  ./src/bun.js/bindings/ProcessBindingNatives.cpp
)
for lut in ${LUTS[@]}; do
  result=$(basename $lut | sed 's/.lut.txt/.cpp/' | sed 's/.cpp/.h/')
  echo bun "./src/codegen/create-hash-table.ts" "$lut" "$OUT/codegen/$result"
done

wait

rm -rf "$OUT/tmp"*

echo "-> `basename "$OUT"`"