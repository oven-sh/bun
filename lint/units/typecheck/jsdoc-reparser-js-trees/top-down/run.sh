#!/bin/sh
# Reproduces the measurements of this directory (JSDoc, the reparser and the JS-only diagnostics of typescript-go at 89d5d5b).
# Needs: bun, /workspace/bun/node_modules/typescript (6.0.2), /workspace/ref/typescript-go, the corpus and the tree dumps of
# typescript-go's own parser made by ../../ts-dump-and-test-importer/top-down/run.sh (/tmp/tsimp/corpus, /tmp/tsimp/go-out,
# /tmp/tsimp/lib-go-out, /tmp/tsimp/corpus.manifest.json), and for the Go probes the toolchain of
# ../../ts-dump-and-test-importer/groundtruth/build.sh (/tmp/rr/go126, /tmp/rr/deps, /tmp/rr/mod, /tmp/rr/dumpast, /tmp/rr/dumpbind).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${W:-/tmp/jsr}
D=$HERE/data
mkdir -p $W/node_modules
ln -sfn /workspace/bun/node_modules/typescript $W/node_modules/typescript
cp $HERE/probe/*.ts $HERE/probe/*.mjs $W/
cd $W
LIBS=/workspace/ref/typescript-go/internal/bundled/libs

# 1. Route A: TypeScript 6.0.2 dump with JSDoc nodes -> convert.mjs -> jsdocfix.mjs -> reparse.mjs -> print, against typescript-go's tree.
REPORT=$D/js.unmasked MASK=none bun difftree2.ts '\.(js|jsx|mjs|cjs)$'
REPORT=$D/js.masked MASK=comments bun difftree2.ts '\.(js|jsx|mjs|cjs)$'
REPORT=$D/ts.unmasked MASK=none bun difftree2.ts '\.(ts|tsx|mts|cts)$'
REPORT=$D/ts.masked MASK=comments bun difftree2.ts '\.(ts|tsx|mts|cts)$'
CORPUS=$LIBS GOOUT=/tmp/tsimp/lib-go-out REPORT=$W/libs.unmasked MASK=none bun difftree2.ts '\.d\.ts$'
# One unit: bun show2.ts <corpus name> [context lines]   (MASK=none for the exact text)

# 2. Which differences come from the JSDoc trees and which from the reparser pass.
bun isolate.ts
# 3. Do both compilers attach JSDoc to the same hosts.
bun hostcmp.ts '\.(js|jsx|mjs|cjs)$'
bun hostcmp.ts '\.(ts|tsx|mts|cts)$'
CORPUS=$LIBS GOOUT=/tmp/tsimp/lib-go-out bun hostcmp.ts '\.d\.ts$'
# 4. checkJSSyntax as a pass (checkjs.mjs) against typescript-go's JS diagnostics; parse and JSDoc diagnostics.
SAME=$D/js.unmasked.same.txt bun cmpjsdiag.ts
SAME=$D/js.unmasked.same.txt bun cmpdiag2.ts
# 5. Lazily parsed comments of TypeScript files: flags, link nodes.
bun lazylinks.ts
# 6. Fixture choice (greedy cover of the branch counters) and the synthetic inputs.
bun cover.ts $D/js.unmasked.same.txt $D/js.fixtures.tsv
mkdir -p $W/syn-corpus $W/syn-go $W/q-corpus $W/q-go
for f in $HERE/probe/synthetic/*.js; do cp $f $W/syn-corpus/syn_$(basename $f); done
(cd $W/syn-corpus && ls | awk -v d=$W/syn-corpus '{print $0"="d"/"$0}' | xargs /tmp/rr/dumpast $W/syn-go)
CORPUS=$W/syn-corpus GOOUT=$W/syn-go REPORT=$W/syn MASK=none bun difftree2.ts
for f in $HERE/probe/quirks/*.js; do cp $f $W/q-corpus/q_$(basename $f); done
(cd $W/q-corpus && ls | awk -v d=$W/q-corpus '{print $0"="d"/"$0}' | xargs /tmp/rr/dumpast $W/q-go)
CORPUS=$W/q-corpus GOOUT=$W/q-go REPORT=$W/q MASK=none bun difftree2.ts

# 7. Route B size. Static: the call closure inside internal/parser. Measured: the functions entered below parseJSDocComment.
export GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOFLAGS=-mod=mod
(cd $HERE/goanal/closure && go build -o $W/closure .)
P=/workspace/ref/typescript-go/internal/parser
$W/closure $P -table > $D/parser-functions.tsv
$W/closure $P -quiet -roots jsdoc.go > $D/closure.jsdoc-only.tsv
$W/closure $P -quiet -roots reparser.go > $D/closure.reparser-only.tsv
$W/closure $P -quiet -rootfuncs ParseIsolatedEntityName > $D/closure.ParseIsolatedEntityName.tsv
$W/closure $P -quiet -rootfuncs Parser.checkJSSyntax > $D/closure.checkJSSyntax.tsv
(cd $HERE/goanal/instrument && go build -o $W/instrument .)
rm -rf $W/mod && cp -r /tmp/rr/mod $W/mod && rm -rf $W/mod/cmd/parsediag && mkdir -p $W/mod/cmd/jsdocprobe
sed -i 's#=> \.\./deps/#=> /tmp/rr/deps/#' $W/mod/go.mod
$W/instrument $W/mod/internal/parser parser
$W/instrument $W/mod/internal/scanner scanner
# parseJSDocComment must also count for the scanner package: add `scanner.JSDocDepth++` and `defer scanner.JSDocLeave()`
# after the two lines that the tool inserted at the top of Parser.parseJSDocComment, and import internal/scanner in jsdoc.go.
cp $HERE/goanal/instrument/jsdocprobe.go.txt $W/mod/cmd/jsdocprobe/main.go
(cd $W/mod && PATH=/tmp/rr/go126/bin:$PATH GOROOT=/tmp/rr/go126 go build -o $W/jsdocprobe ./cmd/jsdocprobe)
ls /tmp/tsimp/corpus | grep -E '\.(js|jsx|mjs|cjs)$' | awk '{print $0"=/tmp/tsimp/corpus/"$0}' > $W/list.js.txt
ls /tmp/tsimp/corpus | grep -E '\.(ts|tsx|mts|cts)$' | awk '{print $0"=/tmp/tsimp/corpus/"$0}' > $W/list.ts.txt
ls $LIBS | grep '\.d\.ts$' | awk -v d=$LIBS '{print $0"="d"/"$0}' > $W/list.libs.txt
$W/jsdocprobe $D/entered.all.tsv $W/list.js.txt $W/list.ts.txt $W/list.libs.txt
# 8. File data that depends on the reparsed tree: the external module indicator and file.imports (parser/references.go).
cd $W
bun emicmp.ts
SAME=$D/js.unmasked.same.txt bun importscmp.ts
