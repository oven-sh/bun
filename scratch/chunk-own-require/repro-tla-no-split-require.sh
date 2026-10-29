#!/bin/sh
# The PR's todo fixture with `await import("./b.js")` in place of `require("./b.js")`, so no split require() is involved.
# --chunk-naming '[hash]/[name].[ext]'. bun-base = origin/main 9b8347a24e, bun-pr = 7a2d606fb2.
#   target bun, with and without --no-split-require: the bun-base build runs, the bun-pr build throws
#     `TypeError: __require is not a function`.
#   target node, run by node: both builds print only `d1 body start string` (the module cycle never settles).
#   target node, run by bun:  the bun-base build runs, the bun-pr build throws the same TypeError.
# usage: sh /tmp/gate/shm/final-review-run/repro-tla-no-split-require.sh
set -e
D=/tmp/gate/shm/final-review-run/tla-nsr; rm -rf "$D"; mkdir -p "$D"; cd "$D"; export NO_COLOR=1
printf '%s\n' 'import { fx } from "./x.js";' 'import "./y.js";' 'console.log("e body:", fx());' > e.js
printf '%s\n' 'import { tag } from "./d1.js";' 'console.log("e2 body:", tag);' > e2.js
printf '%s\n' 'import { fx } from "./x.js";' 'import "./y.js";' 'export const value = fx();' 'console.log("b body:", value);' > b.js
printf '%s\n' 'export const tag = "d1";' 'console.log("d1 body start", typeof require(String("node:os")).EOL);' \
  'const b = await import("./b.js");' 'console.log("d1 body end, b.value =", b.value);' > d1.js
printf '%s\n' 'export function fx() {' '  return typeof require(String("node:os")).EOL;' '}' 'console.log("x body");' > x.js
printf '%s\n' 'import { tag } from "./d1.js";' 'console.log("y body", tag);' > y.js
echo "unbundled (bun-base e.js): $(/tmp/measure/bin/bun-main e.js 2>&1 | grep -E 'body|Error' | tr '\n' '|')"
show() { # show <label> <runner>
  echo "[$1] $(timeout 20 "$2" out/e.js 2>&1 | grep -E 'body|Error' | tr '\n' '|')"
}
for flags in "--target bun" "--target bun --no-split-require" "--target node"; do
  for b in main acc; do
    rm -rf out
    /tmp/measure/bin/bun-$b build e.js e2.js --splitting $flags --format esm --outdir out \
      --chunk-naming '[hash]/[name].[ext]' >/dev/null 2>&1 || echo "BUILD FAILED"
    case "$flags" in
      *node*) show "$flags, built by bun-$b, run by node" node
              show "$flags, built by bun-$b, run by bun" /tmp/measure/bin/bun-main ;;
      *)      show "$flags, built by bun-$b, run by bun" /tmp/measure/bin/bun-main ;;
    esac
  done
done
rm -rf out
