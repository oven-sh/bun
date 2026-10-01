#!/bin/sh
# Instruction and branch counts of the edits against the release build of be1ebe5295, without a full build:
# the rlib of a patched copy with the rustc command of the release build, one link, cgbench (tools of paren-expr-seam/).
# usage: /workspace/tools/lk sh measure.sh [v1]     (one lock for all of it; the first link fills the ThinLTO cache: 17 minutes
#        on the loaded machine, later links 4 minutes). The head counts are /workspace/notes/lint/measure/parser/cg/head.*.cg.
# The other crates of the link were compiled against the unpatched parser, so the copy must keep the mangled names they
# call: an `impl` block added BEFORE `impl Lexer` in lexer.rs shifts its number (`Ms1_` becomes `Ms2_`) and the link fails
# with `undefined symbol: <bun_js_parser::lexer::Lexer>::next`. The first version (v1-enum/) has such a block: it is moved
# to the end of the file for the measurement. The second version adds no `impl` block.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
T=/workspace/notes/lint/units/parser/paren-expr-seam
S=${S:-/tmp/b1seam}
V=${1:-v2}
mkdir -p $S/root/$V/src $S/out $S/link $S/cg
rm -rf $S/root/$V/src/js_parser
cp -r /workspace/wt/parser/src/js_parser $S/root/$V/src/js_parser
if [ "$V" = v1 ]; then
  python3 "$HERE/v1-enum/apply-prototype.py" $S/root/$V/src/js_parser
  python3 - $S/root/$V/src/js_parser/lexer.rs <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
start = s.index("impl TrackComments {")
end = s.index("const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);")
block = s[start:end]
s = s[:start] + s[end:]
open(p, 'w').write(s.rstrip() + "\n\n" + block.rstrip() + "\n")
PY
else
  python3 "$HERE/apply-prototype.py" $S/root/$V/src/js_parser
fi
cp "$HERE/comments.rs" $S/root/$V/src/js_parser/parse/comments.rs
RELAX=1 OUT=$S/out python3 $T/run.py $V $S/root/$V
RLIB=$(ls $S/out/$V/libbun_js_parser-*.rlib | head -1)
OUT=$S/link CACHE=$S/thinlto-cache python3 $T/relink.py $V "$RLIB" full
/workspace/notes/lint/tools/cgbench.sh $S/link/$V/bun-profile $S/cg $V 20 | tee $S/cg.$V.txt
for g in bun-types typescript-lib src-js tsx js-control; do
  echo "== $g"
  python3 /workspace/notes/lint/units/parser/measure/tools/cgdiff.py /workspace/notes/lint/measure/parser/cg/head.$g.cg $S/cg/$V.$g.cg --match bun_js_parser --top 12
done
