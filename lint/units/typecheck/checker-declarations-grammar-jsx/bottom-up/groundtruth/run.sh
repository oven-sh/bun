#!/bin/sh
# Runs the probe on inputs/ with the options of runs.txt and compares with out/. Coverage lists go to <work dir>/func.
# usage: run.sh [work dir, default /tmp/cdg/gt]     needs <work dir>/declprobe (build.sh) and /tmp/ctl/gt/mod for covdata
W=${1:-/tmp/cdg/gt}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
export GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-mod=mod GOCACHE=/tmp/ctl/gt/gocache PATH=/tmp/rr/go126/bin:$PATH
mkdir -p "$W/res" "$W/func"
cd "$HERE/inputs" || exit 1
while IFS='|' read -r name flags libs files; do
  [ -z "$name" ] && continue
  args=""
  for l in $libs; do args="$args lib.$l.d.ts=$LIB/$l.d.ts"; done
  for f in $files; do args="$args $f=$f"; done
  rm -rf "$W/cov/$name" && mkdir -p "$W/cov/$name"
  # the one option value with a space is passed through a positional rewrite
  case "$name" in
    jsx_badfactory) GOCOVERDIR="$W/cov/$name" "$W/declprobe" -strict -o jsx=#3 -o "jsxFactory=h create" $args > "$W/res/$name.out.txt" 2>&1 ;;
    *) GOCOVERDIR="$W/cov/$name" "$W/declprobe" $flags $args > "$W/res/$name.out.txt" 2>&1 ;;
  esac
  if [ -f "$HERE/out/$name.out.txt" ]; then cmp -s "$W/res/$name.out.txt" "$HERE/out/$name.out.txt" || echo "differs: $name"; fi
  (cd /tmp/ctl/gt/mod && go tool covdata func -i="$W/cov/$name" > "$W/func/$name.func.txt")
done < "$HERE/runs.txt"
# one construct per file: inputs/grammar_lines.txt, two lines of prelude, options -strict target es2017
mkdir -p "$W/lines" && rm -rf "$W/cov/glines" && mkdir -p "$W/cov/glines" && : > "$W/res/grammar_lines.out.txt"
i=0
while IFS= read -r line; do
  i=$((i+1)); f=$(printf 'g%03d.ts' $i)
  printf 'declare const o: any; declare function dec(...a: any[]): any; declare class A1 {} declare class B1 {} interface I1 {} interface I2 {}\n%b\n' "$line" > "$W/lines/$f"
  { echo "--- $i: $line"; (cd "$W/lines" && GOCOVERDIR="$W/cov/glines" "$W/declprobe" -strict -o target=#4 lib.es5.d.ts=$LIB/es5.d.ts lib.decorators.d.ts=$LIB/decorators.d.ts mod_a.ts="$HERE/inputs/mod_a.ts" $f=$f 2>&1) | grep "^PARSE g\|^g[0-9]\|^  \|^panic\|^goroutine\|^global" | sed 's/^PARSE g[0-9]*\.ts //' | sed "s/^g[0-9]*\.ts/L/"; } >> "$W/res/grammar_lines.out.txt"
done < "$HERE/inputs/grammar_lines.txt"
if [ -f "$HERE/out/grammar_lines.out.txt" ]; then cmp -s "$W/res/grammar_lines.out.txt" "$HERE/out/grammar_lines.out.txt" || echo "differs: grammar_lines"; fi
(cd /tmp/ctl/gt/mod && go tool covdata func -i="$W/cov/glines" > "$W/func/grammar_lines.func.txt")
echo "probe runs done: $W/res $W/func"
