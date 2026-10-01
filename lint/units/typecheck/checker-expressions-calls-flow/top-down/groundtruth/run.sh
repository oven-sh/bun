#!/bin/sh
# Runs the probe of the reference on inputs/ and compares with out/.
# The probe: probe-src/build.sh builds checkprobe (plain, with -maxstack and the state counters) and checkprobe.cover (a test
# binary, statement counts of checker and binder). It needs the Go 1.26 toolchain and the module sources in /tmp/rr
# (../../../ts-dump-and-test-importer/groundtruth/build.sh) and runs the build under /workspace/tools/lk.
# The probe sources were taken from the scratch directory of the bottom-up pass of this unit (/tmp/ecf/gt/src).
# usage: run.sh [work dir, default /tmp/ecf1b-run/gt]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-/tmp/ecf1b-run/gt}
LIBS=/workspace/ref/typescript-go/internal/bundled/libs
mkdir -p "$W"
[ -x "$W/checkprobe" ] || bash "$HERE/probe-src/build.sh" "$W"
ARGS=$(while read f; do printf '%s=%s/%s ' "$f" "$LIBS" "$f"; done < "$HERE/libs.es2025.txt")
cd "$HERE/inputs"
"$W/checkprobe" -strict $ARGS min.ts=min.ts > "$W/min.default-libs.out.txt" 2>&1
"$W/checkprobe" -strict lib.es5.d.ts=$LIBS/lib.es5.d.ts min.ts=min.ts > "$W/min.es5-only.out.txt" 2>&1
for f in flow1 calls1 unreach1; do "$W/checkprobe" -strict $ARGS $f.ts=$f.ts > "$W/$f.out.txt" 2>&1; done
for f in flow1 unreach1; do "$W/checkprobe" -strict -unreachable-error $ARGS $f.ts=$f.ts > "$W/$f.unreachable-error.out.txt" 2>&1; done
for f in min.default-libs min.es5-only flow1 calls1 unreach1 flow1.unreachable-error unreach1.unreachable-error; do cmp "$W/$f.out.txt" "$HERE/out/$f.out.txt"; done
# executed blocks of the twelve layers for K4
PROBE_ARGS="-strict $ARGS min.ts=min.ts" "$W/checkprobe.cover" -test.run TestProbe -test.coverprofile="$W/min.cover.txt" > /dev/null 2>&1
(cd "$HERE/../py" && python3 blocks.py "$W/min.cover.txt" > "$W/k4_default_libs_blocks.tsv" && rm -rf __pycache__)
cmp "$W/k4_default_libs_blocks.tsv" "$HERE/../data/k4_default_libs_blocks.tsv"
# Go stack: the stress files need megabytes, everything else of the sample passes with 256 KB
T=/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases/compiler
"$W/checkprobe" -strict -maxstack 2097152 $ARGS s.ts=$T/binderBinaryExpressionStress.ts 2>&1 | grep -q 'stack exceeds'
"$W/checkprobe" -strict -maxstack 4194304 $ARGS s.ts=$T/binderBinaryExpressionStress.ts 2>&1 | grep -q 'AFTER check'
"$W/checkprobe" -strict -maxstack 1048576 $ARGS l.ts=$T/largeControlFlowGraph.ts 2>&1 | grep -q 'stack exceeds'
"$W/checkprobe" -strict -maxstack 2097152 $ARGS l.ts=$T/largeControlFlowGraph.ts 2>&1 | grep -q 'TS2563'
echo "probe ok"
