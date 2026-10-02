#!/bin/sh
# Makes every file of data/ again. Scratch is /tmp/r4: the tools name paths there. No build: the two binaries exist.
#   main  = /workspace/base/bun.f4d755a9c (release of f4d755a9cf)
#   head  = /workspace/wt/parser/build/release/bun (23a20afa7e, round 1), only for the line "pass 366"
# Step 1 reads the four test files test/bundler/transpiler/typescript-grammar*.test.ts; after their removal it takes data/testrows.json.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ND=/workspace/notes/lint/units/parser
S=/tmp/r4
MAIN=${MAIN:-/workspace/base/bun.f4d755a9c}
HEAD=${HEAD:-/workspace/wt/parser/build/release/bun}
mkdir -p $S/gd $S/runs
cp "$HERE"/tools/* $S/
cp $ND/grammar-diff/*.mjs $S/gd/ && cp $ND/grammar-diff-oracle-and-causes/for-grammar-diff/*.mjs $S/gd/
ln -sfn $ND/probes $S/probes
cd $S
# 1. the 366 rows, what main and round 1 do with each, what tsc 6.0.2 says
if [ -f /workspace/wt/parser/test/bundler/transpiler/typescript-grammar.test.ts ]; then "$MAIN" testrows.mjs; else cp "$HERE"/data/testrows.json $S/testrows.json; fi
"$MAIN" rows-run.mjs testrows.json base.rows.json
"$HEAD" rows-run.mjs testrows.json head.rows.json
node rows-tsc.mjs testrows.json tsc.rows.json
# 2. class and family, the sites of the TypeScript syntax, what a lint parse needs
python3 classify.py $S
node sites.mjs
python3 deps.py $S
# 3. the corpora of round 2 with main: one light process pair each, the full small corpus takes about 75 s
python3 - <<'EOF'
import json
ND='/workspace/notes/lint/units/parser'
for name in ('valid.plain', 'valid.broad.plain'):
    lines=[l for l in open(f'{ND}/round2/a1-differential/top-down/probes/{name}.txt',encoding='utf8').read().split('\n') if l and not l.startswith('# ')]
    out='valid-plain' if name=='valid.plain' else 'valid-broad'
    json.dump({'name':name,'contexts':{},'forms':[],'sources':[{'prod':name,'src':l.replace('\u23ce','\n')} for l in lines]},open(f'/tmp/r4/corpus.{out}.json','w'))
EOF
cp $ND/grammar-diff-oracle-and-causes/runs/corpus.small-sub.json $ND/grammar-diff-oracle-and-causes/runs/corpus.testrows.json $S/
cp $ND/grammar-diff/corpus.targeted.json $ND/grammar-diff/corpus.small.json $S/
cp $ND/round2/lint-parse-differential/bottom-up/results/baseline/corpus.targeted09.json $S/
for c in testrows valid-plain valid-broad targeted targeted09 small-sub small; do
  (cd $S/gd && /workspace/tools/lk "$MAIN" harness.mjs $S/corpus.$c.json $S/runs/main.$c.jsonl.gz --jobs=2)
done
# 4. main f4d755a9cf against the saved run of e3566be889 over the full small corpus: 0 differing records of 3,144,420
python3 - <<'EOF'
import gzip
a=gzip.open('/workspace/notes/lint/units/parser/measure/base/grammar-diff/base.small.jsonl.gz','rt'); b=gzip.open('/tmp/r4/runs/main.small.jsonl.gz','rt')
a.readline(); b.readline()
print('sources whose records differ:', sum(1 for x,y in zip(a,b) if x!=y))
EOF
# 5. the lists by cause, and this pass against the bottom-up pass
node lists.mjs
python3 crosscheck.py $S
node outline-check.mjs | tail -1
