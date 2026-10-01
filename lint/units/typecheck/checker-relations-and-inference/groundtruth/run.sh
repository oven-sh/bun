#!/bin/sh
# Runs the probe on inputs/ with options {Strict} and lib es5.d.ts as /lib.es5.d.ts and compares with out/.
# out/<name>.out.txt: diagnostics and the sizes of the five relation caches. out/<name>.trace.txt.gz: the same plus the trace.
# Trace lines: "T <indent><function>" entry of a function of relater.go or inference.go, "T # ..." a note
# (isRelatedToEx arguments and result, reportError with the chain after it, SET <relation> key=<key bytes in hex> result=<flags>,
# inferFromTypes arguments, getInferredType result), "F <function> <line> <count>" functions entered in order of first entry.
# usage: run.sh [work dir of build.sh, default /tmp/relinf/gt]
set -e
W=${1:-/tmp/relinf/gt}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
T=$(mktemp -d)
for p in "$HERE"/inputs/*.ts; do
  f=$(basename "$p" .ts)
  "$W/relprobe" -strict -trace -funcs lib.es5.d.ts=$LIB/es5.d.ts "$f.ts=$p" > "$T/$f.trace.txt"
  grep -v '^T \|^F ' "$T/$f.trace.txt" > "$T/$f.out.txt"
  cmp "$T/$f.out.txt" "$HERE/out/$f.out.txt" || echo "differs: $f.out.txt"
  gzip -dc "$HERE/out/$f.trace.txt.gz" | cmp - "$T/$f.trace.txt" || echo "differs: $f.trace.txt"
done
rm -rf "$T"
echo "probe ok"
