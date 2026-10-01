#!/bin/sh
# Rebuilds the prototype of the node table and runs every check of this research pass.
# Needs: the worktree /workspace/wt/typecheck built once (bun bd), the reference clone, go (any 1.24+), bun.
# The cargo target directory is a cache only: TARGET=/some/dir sh run.sh
set -e
cd "$(dirname "$0")"
TARGET=${TARGET:-/tmp/ntc-td/target}
TMP=/tmp/ntc-td
mkdir -p "$TMP"
export BUN_CODEGEN_DIR=/workspace/wt/typecheck/build/debug/codegen CARGO_TERM_COLOR=never
PROBE=/workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/top-down/probe

# 1. facts of internal/ast from go/types (flattened struct fields, nodeData method owners, the methods of *Node)
(cd goanal && GOFLAGS=-mod=mod GOTOOLCHAIN=local go run . > ../data/astfacts.json 2> ../logs/astfacts.err)
# 2. names that collide in snake_case, and whether the exported twin is a wrapper
(cd probes && bun snake-collisions.ts > ../data/snake-collisions.txt)
bun probes/snake-wrappers.ts > data/snake-wrappers.txt
# 3. the generated files
R=/workspace/ref/typescript-go/internal/ast
(cd gen && (bun generate-flags.ts $R/nodeflags.go NodeFlags u32; echo; bun generate-flags.ts $R/tokenflags.go TokenFlags u32; echo; bun generate-flags.ts $R/modifierflags.go ModifierFlags u32) > ../proto/ast/flags_generated.rs && bun generate-ast.ts)
(cd proto && cargo fmt)
# 4. the inputs of the measurements: the lib closures, dumped by TypeScript 6.0.2 and converted to the reference's shape
bun $PROBE/libclosure.mjs lib.es5.d.ts $TMP/es5.list
bun $PROBE/libclosure.mjs lib.esnext.full.d.ts $TMP/esnext.list
(cd probes && NODE_PATH=/workspace/wt/typecheck/node_modules bun flatten-converted.ts $TMP/es5.json --list $TMP/es5.list && NODE_PATH=/workspace/wt/typecheck/node_modules bun flatten-converted.ts $TMP/esnext.json --list $TMP/esnext.list)
# 4b. every unit of the conformance corpus (the split units and the digests are the dump research's: its
#     probe/mkcorpus.mjs writes /tmp/tsimp/corpus and /tmp/tsimp/corpus.manifest.json)
if [ -d /tmp/tsimp/corpus ]; then
  (cd probes && NODE_PATH=/workspace/wt/typecheck/node_modules bun flatten-corpus.ts /tmp/tsimp/corpus.manifest.json /tmp/tsimp/corpus $TMP/corpus 1000)
  zcat /workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/top-down/golden/cases.tsgo-digests.tsv.gz > $TMP/cases.tsv
fi
# 5. lints, format, tests (debug), measurements (opt-level 3 for the prototype crate only)
cd proto
cp /workspace/wt/typecheck/clippy.toml /workspace/wt/typecheck/rustfmt.toml .
cargo clippy --offline --no-deps --all-targets --target-dir "$TARGET" --message-format=short 2>&1 | tee ../logs/clippy-final.log | tail -3
cargo fmt -- --check
cargo test --offline --target-dir "$TARGET" -- --test-threads=1 --nocapture 2>&1 | tee ../logs/test-debug.log | tail -30
cargo test --offline --target-dir "$TARGET" --config profile.dev.package.ntproto.opt-level=3 --config profile.dev.package.ntproto.debug-assertions=false --config profile.dev.package.ntproto.overflow-checks=false -- --test-threads=1 --nocapture 2>&1 | tee ../logs/test-opt3-all.log | grep -A6 "closure: files\|corpus: nodes"
echo "node table prototype ok"
