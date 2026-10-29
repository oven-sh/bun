#!/bin/sh
# Every chunk is written to out/a/, so main's imported __require already resolves from the right directory.
# bun-pr still declares `var __require` in the entry chunks (is_in_same_directory compares "a" with "./a")
# and the bundle throws `TypeError: __require is not a function` at load. bun-base runs.
# usage: sh /tmp/gate/shm/synth/repro-samedir.sh
set -e
D=/tmp/gate/shm/synth/samedir; rm -rf "$D"; mkdir -p "$D/src/a" "$D/node_modules/cjsdep"; cd "$D"
echo '{"name":"cjsdep","version":"1.0.0","main":"index.js"}' > node_modules/cjsdep/package.json
echo 'module.exports = { tag: "!" };' > node_modules/cjsdep/index.js
cat > src/a/entry.js <<'EOF'
import { fx } from "./x.js";
import { Store } from "./store.js";
export { fx };
console.log("a body:", new Store().name, fx());
EOF
cat > src/a/x.js <<'EOF'
export function fx(name = "node:os") { return typeof require(name).EOL; }
console.log("x body");
EOF
cat > src/a/entry2.js <<'EOF'
import { Store } from "./store.js";
console.log("b body:", new Store().name);
EOF
cat > src/a/store.js <<'EOF'
import dep from "cjsdep";
const a = require("./entry.js");
console.log("store body:", a.fx());
export class Store { name = "app" + dep.tag; }
EOF
for naming in '[dir]/[name]-[hash].[ext]' 'a/[name]-[hash].[ext]'; do
  for b in main acc; do
    rm -rf "out-$b"
    /tmp/measure/bin/bun-$b build src/a/entry.js src/a/entry2.js --splitting --target bun --root ./src \
      --chunk-naming "$naming" --outdir "out-$b" >/dev/null
    echo "## --chunk-naming '$naming' / bun-$b: $(cd out-$b && find . -type f | sort | tr '\n' ' ')"
    /tmp/measure/bin/bun-main "out-$b/a/entry.js" 2>&1 | grep -E 'body|Error' | tr '\n' '|'; echo
  done
done
