#!/bin/sh
# Reproduces the measurements of this directory: route A (TypeScript 6.0.2 dump with JSDoc, conversion, a port of
# reparser.go and of checkJSSyntax as passes over the finished tree) against typescript-go's own tree.
# Needs: bun, /workspace/bun/node_modules/typescript (6.0.2), /workspace/ref/typescript-go at 89d5d5b, the probe
# ../ts-dump-and-test-importer/groundtruth/build.sh built as /tmp/rr/dumpast (Go 1.26), and the corpus and goldens
# of ../ts-dump-and-test-importer/top-down/run.sh in /tmp/tsimp (corpus, go-out). Work directory: /tmp/jsdocrp.
set -e
W=/tmp/jsdocrp
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p $W/node_modules $W/go-js $W/syn/out
ln -sfn /workspace/bun/node_modules/typescript $W/node_modules/typescript
cp $HERE/probe/*.ts $HERE/probe/*.mjs $W/
cp $HERE/data/synthetic/*.js $HERE/data/synthetic/*.ts $W/syn/
# goldens of the JavaScript units with the current probe (it prints related information of diagnostics)
(cd /tmp/tsimp/corpus && ls | grep -E '\.(js|jsx|mjs|cjs)$' | awk '{print $0"=/tmp/tsimp/corpus/"$0}' | xargs -n 500 /tmp/rr/dumpast $W/go-js)
(cd $W/syn && ls *.js *.ts | awk -v d=$W/syn '{print $0"="d"/"$0}' | xargs /tmp/rr/dumpast $W/syn/out)
cd $W
bun measure3.ts '\.(js|jsx|mjs|cjs)$' $W/m.js.tsv        # trees of JavaScript units, three mask levels
bun measure3.ts '\.(ts|tsx|mts|cts)$' $W/m.ts.tsv        # trees of TypeScript units (JSDoc nodes of lazy parsing)
bun hostcmp.ts '\.(js|jsx|mjs|cjs)$'                      # are JSDoc comments attached to the same hosts
bun hostcmp.ts '\.(ts|tsx|mts|cts)$'
GOOUT=$W/go-js bun jsdiagcmp.ts                           # TS8xxx diagnostics of the checkJSSyntax port
bun diagcmp2.ts                                           # parse and JSDoc diagnostics
bun emicmp.ts                                             # external module indicator after the reparse pass
CORPUS=$W/syn GOOUT=$W/syn/out bun measure3.ts '\.(js|ts)$' $W/m.syn.tsv   # the synthetic inputs (upstream quirks)
bun selectfx.ts                                           # the fixture list data/js-fixtures.tsv
# closure of jsdoc.go and reparser.go in parser.go: (cd probe/callgraph && go build -o cg . && ./cg /workspace/ref/typescript-go/internal/parser jsdoc.go reparser.go)
