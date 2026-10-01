#!/bin/sh
# Reproduces every result of this directory: the ground truth of Go, the check of the merged bottom layer,
# the verifiers of the upper prototypes before and after, and the assembled file set with its checks.
# usage: sh prove.sh [work directory, default /tmp/sfm-prove]      needs bun, python3, go (1.24 or later), no network
set -e
W=${1:-/tmp/sfm-prove}
N=$(cd "$(dirname "$0")/../.." && pwd)
H=$N/shared-foundation-merge/bottom-up
REF=${TSGO:-/workspace/ref/typescript-go}
TSC=${TSC:-/workspace/bun/node_modules/.bin/tsc}
TYPES=${TYPES:-/workspace/bun/packages/bun-types}
PRETTIER=${PRETTIER:-/workspace/bun/node_modules/.bin/prettier}
PLUGIN=${PLUGIN:-/workspace/bun/node_modules/prettier-plugin-organize-imports/index.js}
PRETTIERRC=${PRETTIERRC:-/workspace/wt/conformance/.prettierrc}
mkdir -p "$W"

echo "== 1. ground truth of Go and the merged bottom layer"
python3 "$H/groundtruth/build.py" "$REF" "$W/gt-sfm"
"$W/gt-sfm/gt" "$W/gt-sfm/vectors.jsonl"
# The first line names the Go version: Go 1.24.4 and Go 1.26.0 give the same lines after it.
tail -n +2 "$W/gt-sfm/vectors.jsonl" > "$W/now.jsonl"
gunzip -c "$H/vectors/go-vectors.jsonl.gz" | tail -n +2 | cmp - "$W/now.jsonl" && echo "the stored vectors are the ones that Go gives now ($(head -c 60 "$W/gt-sfm/vectors.jsonl" | head -1))"
bun "$H/verify/verify_go.ts" "$W/gt-sfm/vectors.jsonl" | tail -1
bun "$H/overlay/comment_runs.ts" "$H"/runner/*.ts

echo "== 2. the verifiers of the upper prototypes, as they are and over the merged set"
GOCACHE="$W/gocache" python3 "$N/error-baseline-format/groundtruth/build.py" "$REF" "$W/gt-ebf"
mkdir -p "$W/gt-prefix"
cp "$N/instance-materialisation/bottom-up/groundtruth/prefixes_main.go.txt" "$W/gt-prefix/main.go"
printf 'module gtprefix\n\ngo 1.24\n' > "$W/gt-prefix/go.mod"
(cd "$W/gt-prefix" && GOCACHE="$W/gocache" GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off go build -o gt .)
rm -rf "$W/base" "$W/out-base" "$W/out-ovl"
mkdir -p "$W/base"
for d in "$N"/*/; do case "$d" in */shared-foundation-merge/) ;; *) cp -r "$d" "$W/base/" ;; esac; done
bun "$H/overlay/build.ts" "$N" "$W/ovl" | head -1
bun "$H/overlay/run_verifiers.ts" "$W/base" "$W/out-base" "$W/gt-ebf/gt" "$W/gt-prefix/gt" > "$W/base.log"
bun "$H/overlay/run_verifiers.ts" "$W/ovl" "$W/out-ovl" "$W/gt-ebf/gt" "$W/gt-prefix/gt" > "$W/ovl.log"
echo "verifiers that do not exit with 0, base then overlay:"
grep -v "exit 0" "$W/base.log" || true
grep -v "exit 0" "$W/ovl.log" || true
bun "$H/overlay/compare.ts" "$W/out-base" "$W/out-ovl"

echo "== 3. the assembled file set"
bun "$H/overlay/assemble.ts" "$N" "$W/asm" | head -1
# What follows checks the files as they would be committed: in the format that the repository's own prettier setup gives.
if [ -x "$PRETTIER" ]; then
  cp "$PRETTIERRC" "$W/asm/.prettierrc"
  (cd "$W/asm" && "$PRETTIER" --plugin="$PLUGIN" --config .prettierrc --write "test/**/*.ts" | grep -vc unchanged | sed 's/$/ of the assembled files change when the prettier setup of the repository formats them; the checks below run on the formatted files/')
  rm "$W/asm/.prettierrc"
else
  echo "no prettier at $PRETTIER: the assembled files keep the format of the prototypes"
fi
(cd "$W/asm" && bun "$H/overlay/comment_runs.ts" test/cli/lint/conformance/runner/*.ts test/cli/lint/conformance/sweep.ts test/cli/lint/conformance.test.ts)
bun "$H/verify/regex_sites.ts" "$W/asm" | tail -1
mkdir -p "$W/tsc"
cat > "$W/tsc/tsconfig.json" <<JSON
{ "compilerOptions": { "lib": ["ESNext"], "target": "ESNext", "module": "ESNext", "moduleDetection": "force", "allowJs": true, "resolveJsonModule": true,
    "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true, "strict": true, "skipLibCheck": true, "noFallthroughCasesInSwitch": true,
    "isolatedModules": true, "noImplicitAny": false, "noImplicitThis": false, "typeRoots": ["$TYPES/node_modules/@types"], "types": ["node", "$TYPES"] },
  "include": ["$W/asm/test/cli/lint/conformance/runner/*.ts", "$W/asm/test/cli/lint/conformance/sweep.ts"] }
JSON
(cd "$W/tsc" && "$TSC" -p tsconfig.json && echo "tsc: no error")
(cd "$W/asm" && TFS_CHECK=replay NO_COLOR=1 bun test --timeout 180000 test/cli/lint/conformance.test.ts 2>&1 | tail -4)
printf 'import { replayCheck, runOracleOf } from "%s/asm/test/cli/lint/conformance/runner";\nimport type { Corpus } from "%s/asm/test/cli/lint/conformance/runner";\nexport default ({ corpus }: { corpus: Corpus }) => replayCheck(i => runOracleOf(corpus, i.suite, i.name));\n' "$W" "$W" > "$W/replay-check.ts"
bun "$W/base/test-file-and-sweep/top-down/sweep.ts" --reference "$REF" --check "$W/base/test-file-and-sweep/top-down/replay-check.ts" --report "$W/sweep-base.json" > "$W/sweep-base.txt" 2>&1
bun "$W/asm/test/cli/lint/conformance/sweep.ts" --reference "$REF" --check "$W/replay-check.ts" --report "$W/sweep-asm.json" > "$W/sweep-asm.txt" 2>&1
norm() { sed -E 's/[0-9.]+ ?(ms|s)\b/T/g; s#--check [^ ]*#--check CHECK#; s#--report [^ ]*#--report REPORT#; s#^report .*#report REPORT#' "$1"; }
norm "$W/sweep-base.txt" > "$W/sweep-base.norm"
norm "$W/sweep-asm.txt" > "$W/sweep-asm.norm"
cmp "$W/sweep-base.norm" "$W/sweep-asm.norm" && echo "the sweep over every instance prints the same text: $(grep '^pass ' "$W/sweep-asm.txt")"
bun "$W/asm/test/cli/lint/conformance/sweep.ts" --reference "$REF" --round-trip 2>&1 | tail -1
bun "$H/verify/cross_roots.ts" "$W/asm" "$N" "$REF"
bun "$H/verify/cross_writer_vectors.ts" "$W/asm" "$N"
bun "$H/verify/scan_corpus_text.ts" "$REF"
