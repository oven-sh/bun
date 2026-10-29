#!/bin/sh
# Re-creates the two fixtures where a bundle runs from source and on origin/main (bun-base) and throws
# `TypeError: __require is not a function` with the chunk-local-require diff (bun-pr).
# usage: sh /tmp/gate/shm/ms/repro-before-body.sh
set -e
BASE=/tmp/measure/bin/bun-main
PR=/tmp/measure/bin/bun-acc
D=/tmp/gate/shm/ms/repro
rm -rf "$D"
mkdir -p "$D/one/src" "$D/two/src/a" "$D/two/src/b"
for f in one two; do
  mkdir -p "$D/$f/node_modules/cjsdep"
  echo '{"name":"cjsdep","version":"1.0.0","main":"index.js"}' > "$D/$f/node_modules/cjsdep/package.json"
  echo 'module.exports = { tag: "!" };' > "$D/$f/node_modules/cjsdep/index.js"
done

# 1. one entry, --chunk-naming 'chunks/[name]-[hash].[ext]'
cd "$D/one"
cat > src/index.js <<'EOF'
import { fx } from "./x.js";
import { Store } from "./store.js";
export { fx };
console.log("index body:", new Store().name, fx());
import("./lazy.js");
EOF
cat > src/x.js <<'EOF'
export function fx(name = "node:os") { return typeof require(name).EOL; }
console.log("x body");
EOF
cat > src/store.js <<'EOF'
import dep from "cjsdep";
const entry = require("./index.js");
console.log("store body:", entry.fx());
export class Store { name = "app" + dep.tag; }
EOF
cat > src/lazy.js <<'EOF'
import { Store } from "./store.js";
console.log("lazy body:", new Store().name);
EOF
echo "### 1. chunks/ naming, unbundled:"; "$BASE" src/index.js 2>&1 | tail -n 4; 
for b in "$BASE" "$PR"; do
  n=$(basename "$b")
  "$b" build src/index.js --splitting --target bun --outdir "out-$n" --chunk-naming 'chunks/[name]-[hash].[ext]' >/dev/null
  echo "### 1. chunks/ naming, $n:"; "$b" "out-$n/index.js" 2>&1 | grep -E 'body|Error' || true
done

# 2. entry points in two directories, default naming
cd "$D/two"
cat > src/a/entry.js <<'EOF'
import { fx } from "./x.js";
import { Store } from "../store.js";
export { fx };
console.log("a body:", new Store().name, fx());
EOF
cp "$D/one/src/x.js" src/a/x.js
cat > src/b/entry.js <<'EOF'
import { Store } from "../store.js";
console.log("b body:", new Store().name);
EOF
cat > src/store.js <<'EOF'
import dep from "cjsdep";
const a = require("./a/entry.js");
console.log("store body:", a.fx());
export class Store { name = "app" + dep.tag; }
EOF
echo "### 2. two directories, unbundled a/entry.js:"; "$BASE" src/a/entry.js 2>&1 | tail -n 3
for b in "$BASE" "$PR"; do
  n=$(basename "$b")
  "$b" build src/a/entry.js src/b/entry.js --splitting --target bun --outdir "out-$n" >/dev/null
  echo "### 2. two directories, $n, out/a/entry.js:"; "$b" "out-$n/a/entry.js" 2>&1 | grep -E 'body|Error' || true
done
