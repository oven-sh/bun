#!/bin/sh
# A2, pass 1b (top-down): everything that was run, in order. Nothing is written into /workspace/wt/parser.
# Binaries: /workspace/notes/lint/measure/parser/{base,head}/bun-profile (e3566be889 and be1ebe5295, sha256 in ../../../../../measure/parser/SHA256SUMS.txt).
# Scratch: /tmp/zcm-td (cg/ = cachegrind files, seam/ = patched copies, rlibs and relinked binaries, gd/ = the A1 harness).
# Kept copies of the cachegrind files (ignored by git): /workspace/notes/lint/measure/parser/cg-td/.
T=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
B=/workspace/notes/lint/measure/parser
O=/tmp/zcm-td/cg
S=/tmp/zcm-td/seam

# 1. counts. batch1.sh: 1 pass (start-up share), the decorator bench, a second run of 20 passes (tags base20b, head20b).
#    batch2.sh: relink of the unpatched head (tag head0: its .text equals head/bun-profile), variants nolintbt and nolint,
#    and the three runs with --vex-guest-chase=no (tags rawbase, rawhead, rawnolintbt).
#    batch3.sh: the decorator bench on deco-bench.common.json (default and raw), variant f1 (default and raw).
#    batch4.sh: variant vold (default and raw) and the A1 harness with base, head and vold.
#    batch5.sh: variant f1b (raw and default). batch6.sh: variant vold3 (vold2 is its two-jump form, assembly only), the A1 harness head vs vold3 and base vs vold3, raw and default.
#    batch7.sh: variant f3 (named-like cast at the word), the A1 harness head vs f3, raw and default.
# /workspace/tools/lk /tmp/zcm-td/batch1.sh ; ... ; batch7.sh     (copies of the seven scripts: batches/)

# 2. tables (each prints to stdout; the saved outputs are the *.txt and *.tsv beside this file)
python3 $T/summary.py $O base20b head20b nolint nolintbt f1 vold          # matched Ir, Bc, Bi per group, difference to the first tag
python3 $T/summary.py $O rawbase rawhead rawnolintbt rawf1 rawvold        # the same with one Bc per executed conditional jump
python3 $T/buckets.py $O base20b head20b                                  # differences by cause (Bc; --ir, --bi)
python3 $T/buckets.py $O rawbase rawhead
python3 $T/cgtable.py $O base20b head20b                                  # every parser symbol that differs, five groups side by side
python3 $T/cgall.py $O/base20b.js-control.cg $O/head20b.js-control.cg     # every symbol of the program, parser and rest
python3 $T/startup.py $O base20b $O base1 $O head20b $O head1             # per pass and once per process
python3 $T/cglinediff.py $O/base20b.src-js.cg $O/head20b.src-js.cg --fn 'P<true, false>>::parse_fn$'   # one function by source line text
python3 $T/cgline.py $O/head20b.typescript-lib.cg --fn 'P<true, false>>::parse_type::<' --top 40         # hot lines of one function
python3 $T/cgsites.py $O/head20b.src-js.cg                                # Bc on the lines that test the side table

# 3. variants: patched copy -> rlib with the rustc command of the release build -> ThinLTO relink -> counts
python3 $T/variants.py nolint nolintbt f1 f1b f3 vold vold2 vold3                  # copies under $S/root/<tag>/src/js_parser
for v in nolint nolintbt f1 f1b f3 vold vold2 vold3; do RELAX=1 python3 $T/run.py $v $S/root/$v; done     # about one minute each, no lock
# OUT=$S/link CACHE=$S/thinlto-cache python3 /workspace/notes/lint/units/parser/paren-expr-seam/relink.py <tag> $S/out/<tag>/libbun_js_parser-185fe25973f3a1f8.rlib full
# /workspace/notes/lint/tools/cgbench.sh $S/link/<tag>/bun-profile $O <tag> 20 ; $T/cgbench-raw.sh $S/link/<tag>/bun-profile $O raw<tag> 20

# 4. the decorator bench on inputs that base and head transform to the same text (6291 of 7595)
$B/base/bun-profile $T/deco-results.mjs /workspace/notes/lint/units/parser/measure/deco-bench.inputs.json /tmp/zcm-td/deco/base.json
$B/head/bun-profile $T/deco-results.mjs /workspace/notes/lint/units/parser/measure/deco-bench.inputs.json /tmp/zcm-td/deco/head.json

# 5. JavaScript that js-control lacks (classes, imports): raw counts of one process per build, 6 passes and 1 pass
# BUN_JSC_useJIT=0 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes --vex-guest-chase=no --cachegrind-out-file=/tmp/zcm-td/jsx/raw.<build>.<n>.cg <bun-profile> $T/js-classes-bench.mjs --iterations=<n>

# 6. parity of a variant with head: the differential harness of A1 (copied from /tmp/a1td/gd = units/parser/grammar-diff + causes)
# cd /tmp/zcm-td/gd && <bun-profile> harness.mjs corpus.{testrows,targeted,small}.json runs/<tag>.<corpus>.jsonl.gz --jobs=4
# bun diff.mjs runs/head.<corpus>.jsonl.gz runs/<tag>.<corpus>.jsonl.gz --causes=causes.empty.mjs --out=runs/diff.head-<tag>.<corpus>.jsonl --show=4
python3 $T/decodiff.py $O        # the decorator bench per pass, default; `raw` as second argument for --vex-guest-chase=no
