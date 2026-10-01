#!/bin/sh
# Runs the probe on inputs/ and compares with out/. The two coverage lists are written next to the work dir.
# usage: run.sh [work dir, default /tmp/ctl/gt]
set -e
W=${1:-/tmp/ctl/gt}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
export GOTOOLCHAIN=local GOCACHE="$W/gocache" PATH=/tmp/rr/go126/bin:$PATH
cd "$HERE/inputs"
for f in min.ts rich.ts zero.ts infer.ts cjs.js cjs2.js; do
  flags="-strict"
  case "$f" in *.js) flags="-strict -checkjs";; esac
  rm -rf "$W/cov/$f" && mkdir -p "$W/cov/$f"
  GOCOVERDIR="$W/cov/$f" "$W/k4probe" $flags lib.es5.d.ts=$LIB/es5.d.ts "$f=$f" > "$W/$f.out.txt"
  cmp "$W/$f.out.txt" "$HERE/out/$f.out.txt" || echo "differs: $f"
done
(cd "$W/mod" && go tool covdata func -i="$W/cov/min.ts" > "$W/k4.func.txt" && go tool covdata func -i="$W/cov/rich.ts" > "$W/rich.func.txt")
echo "probe ok: $W/k4.func.txt $W/rich.func.txt"
