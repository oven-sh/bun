#!/bin/sh
if ! test -d build/debug/codegen; then
  echo "Missing codegen"
  exit 1
fi

out="codegen-for-zig-team.tar.gz"
tar -cf "$out" \
  build/debug/codegen \
  src/bun.js/bindings/GeneratedBindings.zig \
  src/bun.js/bindings/GeneratedJS2Native.zig
echo "-> $out"