#!/bin/sh
# Reproduces the comparison of this directory: the tree made from a TypeScript 6.0.2 dump against typescript-go's own tree.
# Needs: bun, /workspace/bun/node_modules/typescript (6.0.2), /workspace/ref/typescript-go at 89d5d5b, and the probe
# ../groundtruth/build.sh built as /tmp/rr/dumpast (Go 1.26). Work directory: /tmp/tsimp.
set -e
W=/tmp/tsimp
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p $W/corpus $W/go-out $W/lib-go-out $W/final/node_modules
ln -sfn /workspace/bun/node_modules/typescript $W/final/node_modules/typescript
cp $HERE/probe/* $W/final/
cp $HERE/probe/mkcorpus.mjs $W/
(cd $W && bun mkcorpus.mjs)
(cd $W/corpus && ls | awk '{print $0"=/tmp/tsimp/corpus/"$0}' | xargs -n 2000 /tmp/rr/dumpast $W/go-out)
L=/workspace/ref/typescript-go/internal/bundled/libs
(cd $L && ls *.d.ts | awk -v d=$L '{print $0"="d"/"$0}' | xargs /tmp/rr/dumpast $W/lib-go-out)
cd $W/final
bun difftree.ts '\.(ts|tsx|mts|cts)$'
NOJSDOC=1 bun difftree.ts '\.(ts|tsx|mts|cts)$'
bun difftree.ts '\.(js|jsx|mjs|cjs)$'
CORPUS=$L GOOUT=$W/lib-go-out MASKTAGS=1 bun difftree.ts '\.d\.ts$'
# The two inputs of ExternalModuleIndicatorOptions, on a part of the corpus (probe flags -force and -jsx):
#   FORCE=1 EMI=1 NOJSDOC=1 CORPUS=<dir> GOOUT=<dumps made with dumpast -force> bun difftree.ts '\.(ts|tsx|mts|cts)$'
#   JSX=1 EMI=1 NOJSDOC=1 CORPUS=<dir of .tsx> GOOUT=<dumps made with dumpast -jsx> bun difftree.ts '\.tsx$'
# File data and parse diagnostics: bun diffhead.ts, bun diagcmp.ts. JSDoc trees of JavaScript units: bun jsdoccmp.ts.
# Properties that TypeScript nodes carry: bun census.ts. Digests of typescript-go's trees: bun golden.ts.
