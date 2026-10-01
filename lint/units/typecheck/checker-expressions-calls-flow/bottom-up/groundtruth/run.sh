#!/bin/bash
# Runs the probe on inputs/ and on the generated inputs, compares with out/, and lists the functions each input enters.
# usage: run.sh [work dir, default /tmp/ecf1a/gt]     needs <work dir>/checkprobe and checkprobe.cover from build.sh, and FNS for py/cov.py
set -e
W=${1:-/tmp/ecf1a/gt}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=/workspace/ref/typescript-go/_submodules/TypeScript/src/lib
L5="lib.es5.d.ts=$LIB/es5.d.ts"
LIBS="$L5"
for l in es2015.core es2015.symbol es2015.symbol.wellknown es2015.iterable es2015.generator es2015.promise es2015.collection; do LIBS="$LIBS lib.$l.d.ts=$LIB/$l.d.ts"; done
mkdir -p "$W/inputs" "$W/out" "$W/cov"
cp "$HERE"/inputs/*.ts "$W/inputs/"
python3 "$HERE/gen.py" "$W/inputs"
cd "$W/inputs"
"$W/checkprobe" -strict $L5 min.ts=min.ts > "$W/out/min.out.txt" 2>&1
for f in flow reach calls ctx oper access literal func more; do "$W/checkprobe" -strict -suggestions $LIBS $f.ts=$f.ts > "$W/out/$f.out.txt" 2>&1; done
for f in postsuper toolarge edge1999 edge2000 deepbin deepor; do "$W/checkprobe" -strict -suggestions $L5 $f.ts=$f.ts > "$W/out/$f.out.txt" 2>&1; done
for f in min flow reach calls ctx oper access literal func more postsuper toolarge edge1999 edge2000 deepbin deepor; do cmp "$W/out/$f.out.txt" "$HERE/out/$f.out.txt" || echo "differs: $f"; done
PROBE_ARGS="-strict $L5 min.ts=min.ts" "$W/checkprobe.cover" -test.run TestProbe -test.coverprofile="$W/cov/min.profile" > /dev/null
for f in flow reach calls ctx oper access literal func more; do PROBE_ARGS="-strict -suggestions $LIBS $f.ts=$f.ts" "$W/checkprobe.cover" -test.run TestProbe -test.coverprofile="$W/cov/$f.profile" > /dev/null; done
for f in min flow reach calls ctx oper access literal func more; do python3 "$HERE/../py/cov.py" "$W/cov/$f.profile" > "$W/cov/$f.entered.tsv"; done
python3 "$HERE/../py/covlayers.py" "$W/cov" min flow reach calls ctx oper access literal func more > "$W/probe-coverage.txt"
cmp "$W/probe-coverage.txt" "$HERE/../data/probe-coverage.txt" || echo "differs: probe-coverage.txt"
echo "probe ok"
