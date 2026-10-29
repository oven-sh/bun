#!/bin/bash
# usage: bash /dev/shm/xunb/matrix.sh
# Each fixture has one "early call": code that runs while a chunk still waits on its imports and calls a function
# of that chunk that uses `require`. Each is run as
#   U      the source, unbundled, on today's runtime (bun-base)          (bun only)
#   U1142  the source, unbundled, on bun 1.1.42 (the release before #16222), if /dev/shm/xunb/old/bun-1.1.42 exists
#   N      bundle WITHOUT --splitting, built by main (bun-base)
#   M      bundle with --splitting, built by main (bun-base)
#   P      bundle with --splitting, built by the PR (bun-pr)
# A cell is "ok" when the early call printed its line, "THROWS" when it did not.
set -u
B=/tmp/measure/bin/bun-main; P=/tmp/measure/bin/bun-acc; OLD=/dev/shm/xunb/old/bun-1.1.42
export BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1 NO_COLOR=1
W=/tmp/gate/matrix-w; rm -rf "$W"; mkdir -p "$W"; cd "$W"

cell() { # cell <marker> <runner> <file>
  if "$2" "$3" 2>&1 | grep -q -- "$1"; then printf '%-7s' ok; else printf '%-7s' THROWS; fi
}
row() { # row <name> <target> <marker> <entry.js relative to src/ and out/> <entries...> -- <extra build flags...>
  local name=$1 target=$2 marker=$3 run=$4; shift 4
  local entries=(); while [ "$1" != "--" ]; do entries+=("src/$1"); shift; done; shift
  local runner=$B; [ "$target" = node ] && runner=node
  printf '%-58s %-5s ' "$name" "$target"
  if [ "$target" = bun ]; then printf 'U=';     cell "$marker" $B "src/$run"; else printf 'U=%-7s' n/a; fi
  if [ "$target" = bun ] && [ -x $OLD ]; then printf 'U1142='; cell "$marker" $OLD "src/$run"; else printf 'U1142=%-7s' n/a; fi
  local nosplit=(); for f in "$@"; do case "$f" in --chunk-naming|*'[hash]'*) ;; *) nosplit+=("$f");; esac; done
  rm -rf out; $B build "${entries[@]}" --target $target --format esm --outdir out "${nosplit[@]}" >/dev/null 2>&1 || printf 'BUILDFAIL '
  [ -f plugin.js ] && cp plugin.js out/plugin.js; printf 'N='; cell "$marker" $runner "out/$run"
  rm -rf out; $B build "${entries[@]}" --splitting --target $target --format esm --outdir out "$@" >/dev/null 2>&1 || printf 'BUILDFAIL '
  [ -f plugin.js ] && cp plugin.js out/plugin.js; printf 'M='; cell "$marker" $runner "out/$run"
  rm -rf out; $P build "${entries[@]}" --splitting --target $target --format esm --outdir out "$@" >/dev/null 2>&1 || printf 'BUILDFAIL '
  [ -f plugin.js ] && cp plugin.js out/plugin.js; printf 'P='; cell "$marker" $runner "out/$run"
  echo; rm -rf out
}

# ---- 1. the PR's todo fixture: a non-entry chunk in a directory of its own ([hash]/[name].[ext])
mkdir -p todo/src; cd todo
printf '%s\n' 'import { fx } from "./x.js";' 'import "./y.js";' 'console.log("e body:", fx());' > src/e.js
printf '%s\n' 'import { tag } from "./d1.js";' 'console.log("e2 body:", tag);' > src/e2.js
printf '%s\n' 'import { fx } from "./x.js";' 'import "./y.js";' 'export const value = fx();' 'console.log("b body:", value);' > src/b.js
printf '%s\n' 'export const tag = "d1";' 'console.log("d1 body start", typeof require(String("node:os")).EOL);' 'const b = require("./b.js");' 'console.log("d1 body end, b.value =", b.value);' > src/d1.js
printf '%s\n' 'export function fx() {' '  return typeof require(String("node:os")).EOL;' '}' 'console.log("x body");' > src/x.js
printf '%s\n' 'import { tag } from "./d1.js";' 'console.log("y body", tag);' > src/y.js
row "1 todo: shared chunk, [hash]/ dir, static+require cycle" bun "b body: string" e.js e.js e2.js -- --chunk-naming '[hash]/[name].[ext]'
cd ..

# ---- 2./3. an external module imports the entry back (unseen caller); entries in two directories
mk_ext() { # mk_ext <dir> <sibling: 0|1>
  mkdir -p $1/src/a $1/src/b
  echo 'export const shared = "shared";' > $1/src/shared.js
  printf '%s\n' 'import { shared } from "../shared.js";' 'console.log("b body", shared, typeof require(String("node:os")).EOL);' > $1/src/b/entry.js
  printf '%s\n' 'import { load } from "./a/entry.js";' 'console.log("plugin body:", typeof load("node:os").EOL);' > $1/plugin.js
  cp $1/plugin.js $1/src/plugin.js
  if [ $2 = 0 ]; then
    printf '%s\n' 'import { shared } from "../shared.js";' 'import "../plugin.js";' 'export function load(name) {' '  return require(name);' '}' 'console.log("a body", shared, typeof load("node:os").EOL);' > $1/src/a/entry.js
  else
    printf '%s\n' 'import { shared } from "../shared.js";' 'import { load } from "./config.js";' 'import "../plugin.js";' 'export { load };' 'console.log("a body", shared, typeof load("node:os").EOL);' > $1/src/a/entry.js
    printf '%s\n' 'export function load(name) {' '  return require(name);' '}' > $1/src/a/config.js
  fi
}
for t in bun node; do
  mk_ext ext0 0; cd ext0; row "2 external cycle, callee in the entry file (q1)" $t "plugin body: string" a/entry.js a/entry.js b/entry.js -- --external '*/plugin.js'; cd ..; rm -rf ext0
  mk_ext ext1 1; cd ext1; row "3 external cycle, callee in a module imported first (E2)" $t "plugin body: string" a/entry.js a/entry.js b/entry.js -- --external '*/plugin.js'; cd ..; rm -rf ext1
done

# ---- 4./5. a chunk the entry imports require()s the entry back (linker-visible); user entry chunk declares
mk_req() { # mk_req <dir> <sibling: 0|1> <layout: twodirs|flat>
  local up=../ a=a/entry.js b=b/entry.js cfg=./config.js
  if [ $3 = flat ]; then up=./; a=a.js; b=b.js; fi
  mkdir -p $1/src/a $1/src/b
  printf '%s\n' 'export const shared = "shared";' "const a = require(\"./$a\");" 'console.log("shared body:", typeof a.load("node:os").EOL);' > $1/src/shared.js
  printf '%s\n' "import { shared } from \"${up}shared.js\";" 'console.log("b body", shared, typeof require(String("node:os")).EOL);' > $1/src/$b
  if [ $2 = 0 ]; then
    printf '%s\n' "import { shared } from \"${up}shared.js\";" 'export function load(name) {' '  return require(name);' '}' 'console.log("a body", shared, typeof load("node:os").EOL);' > $1/src/$a
  else
    printf '%s\n' "import { load } from \"$cfg\";" "import { shared } from \"${up}shared.js\";" 'export { load };' 'console.log("a body", shared, typeof load("node:os").EOL);' > $1/src/$a
    printf '%s\n' 'export function load(name) {' '  return require(name);' '}' > $1/src/$(dirname $a)/config.js
  fi
}
mk_req req0 0 twodirs; cd req0; row "4 require() of the entry by its dependency, callee in entry (q3)" bun "shared body: string" a/entry.js a/entry.js b/entry.js --; cd ..; rm -rf req0
mk_req req1 1 twodirs; cd req1; row "5 same, callee in a module imported first (q3s), two dirs" bun "shared body: string" a/entry.js a/entry.js b/entry.js --; cd ..; rm -rf req1
mk_req req2 1 flat; cd req2; row "5b same (q3s), one dir + --chunk-naming chunks/..." bun "shared body: string" a.js a.js b.js -- --chunk-naming 'chunks/[name]-[hash].[ext]'; cd ..; rm -rf req2
mk_req req3 1 flat; cd req3; row "5c control: q3s, one dir, default naming (nothing declares)" bun "shared body: string" a.js a.js b.js --; cd ..; rm -rf req3
cd /tmp/gate
