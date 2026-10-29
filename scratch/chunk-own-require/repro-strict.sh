#!/bin/sh
# Stricter variant of /tmp/gate/shm/ms/repro-before-body.sh: the module that holds the function has no top-level
# side effect, so the bundle of origin/main (bun-base) prints byte-for-byte what the unbundled program prints.
# usage: sh /tmp/gate/shm/rfst/repro-strict.sh   (re-creates /tmp/gate/shm/rfst/work, a few KB)
BASE=/tmp/measure/bin/bun-main; PR=/tmp/measure/bin/bun-acc; D=/tmp/gate/shm/rfst/work
rm -rf "$D"; mkdir -p "$D/one/src" "$D/two/src/a" "$D/two/src/b"
for f in one two; do
  mkdir -p "$D/$f/node_modules/cjsdep"
  echo '{"name":"cjsdep","version":"1.0.0","main":"index.js"}' > "$D/$f/node_modules/cjsdep/package.json"
  echo 'module.exports = { tag: "!" };' > "$D/$f/node_modules/cjsdep/index.js"
done
check() { # name, unbundled entry, built entry, build args...
  name=$1; src=$2; built=$3; shift 3
  "$BASE" "$src" > src.out 2>&1; echo "$name unbundled: exit $?"
  for b in "$BASE" "$PR"; do
    n=$(basename "$b"); rm -rf "out-$n"
    "$b" build "$@" --splitting --target bun --outdir "out-$n" >/dev/null 2>&1
    "$b" "out-$n/$built" > "$n.out" 2>&1; rc=$?
    if cmp -s src.out "$n.out"; then same="identical to unbundled"; else same="DIFFERS: $(grep -m1 Error "$n.out")"; fi
    echo "$name $n: exit $rc, output $same"
  done
}
# 1. one entry point, --chunk-naming 'chunks/[name]-[hash].[ext]'
cd "$D/one"
printf '%s\n' 'import { eol } from "./platform.js";' 'import { Store } from "./store.js";' 'export { eol };' \
  'console.log("index body:", new Store().name, eol());' 'import("./lazy.js");' > src/index.js
echo 'export function eol() { return JSON.stringify(require("node:os").EOL); }' > src/platform.js
printf '%s\n' 'import dep from "cjsdep";' 'const { eol } = require("./index.js");' 'console.log("store body:", eol());' \
  'export class Store { name = "app" + dep.tag; }' > src/store.js
printf '%s\n' 'import { Store } from "./store.js";' 'console.log("lazy body:", new Store().name);' > src/lazy.js
check "[chunks/ naming]" src/index.js index.js src/index.js --chunk-naming 'chunks/[name]-[hash].[ext]'
# 2. entry points in two directories, default naming
cd "$D/two"
printf '%s\n' 'import { eol } from "./platform.js";' 'import { Store } from "../store.js";' 'export { eol };' \
  'console.log("a body:", new Store().name, eol());' > src/a/entry.js
cp "$D/one/src/platform.js" src/a/platform.js
printf '%s\n' 'import dep from "cjsdep";' 'const { eol } = require("./a/entry.js");' 'console.log("store body:", eol());' \
  'export class Store { name = "app" + dep.tag; }' > src/store.js
printf '%s\n' 'import { Store } from "../store.js";' 'console.log("b body:", new Store().name);' > src/b/entry.js
check "[two directories]" src/a/entry.js a/entry.js src/a/entry.js src/b/entry.js
