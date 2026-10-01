#!/usr/bin/env bash
# Scratch experiments behind RP-1, RP-2, RP-6, VN-1 and RP-4 of needs-draft.txt. usage: experiments.sh [scratch directory]
# Reads the worktree, the reference clones and the tools of /workspace/bun/node_modules. Writes only below the scratch directory.
set -euo pipefail
W=${WORKTREE:-/workspace/wt/conformance}
TS=${TS_CLONE:-/workspace/ref/typescript-go/_submodules/TypeScript}
BIN=${TOOLS:-/workspace/bun/node_modules/.bin}
DEBUG=${DEBUG_BUN:-/workspace/wt/cli/build/debug/bun-debug}
S=${1:-$(mktemp -d)}
mkdir -p "$S"

echo "== RP-1: what the exclude list of test/tsconfig.json covers (tsc --listFilesOnly)"
rm -rf "$S/ts1" && mkdir -p "$S/ts1/test/fixtures" "$S/ts1/test/cli/lint/typecheck/fixtures" "$S/ts1/test/cli/lint/conformance/corpus/cases" "$S/ts1/test/cli/lint/conformance/runner"
cd "$S/ts1/test"
echo 'export const a = 1;' > fixtures/top.ts
echo 'export const b = 1;' > cli/lint/typecheck/fixtures/nested.ts
echo 'export const c: number = "s";' > cli/lint/conformance/corpus/cases/case.ts
echo 'export const d = 1;' > cli/lint/conformance/runner/index.ts
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "noEmit": true, "module": "esnext", "target": "esnext", "moduleDetection": "force" },
  "include": ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
  "exclude": ["fixtures", "__snapshots__", "./snapshots", "./js/deno", "./node.js"] }
JSON
"$BIN/tsc" -p . --listFilesOnly | grep -v node_modules | sed "s#$S/ts1/##"
echo "-- with the two entries:"
sed -i 's#"./node.js"#"./node.js", "cli/lint/conformance/corpus", "cli/lint/typecheck/fixtures"#' tsconfig.json
"$BIN/tsc" -p . --listFilesOnly | grep -v node_modules | sed "s#$S/ts1/##"

echo "== RP-2: oxlint --fix on tests/cases/compiler at the path of the corpus"
rm -rf "$S/ox" && mkdir -p "$S/ox/scripts/oxlint-plugins" "$S/ox/test/cli/lint/conformance/corpus/cases"
cd "$S/ox"
cp "$W/oxlint.json" . && cp -r "$W/scripts/oxlint-plugins/." scripts/oxlint-plugins/
cp -r "$TS/tests/cases/compiler" test/cli/lint/conformance/corpus/cases/compiler
git init -q . && git add -A >/dev/null 2>&1 && git -c user.email=a@b -c user.name=x commit -qm base
"$BIN/oxlint" --config oxlint.json test/cli/lint/conformance 2>&1 | tail -2 || true
"$BIN/oxlint" --config oxlint.json --fix test/cli/lint/conformance 2>&1 | tail -2 || true
echo "files rewritten by --fix: $(git status --porcelain | grep -c '^ M')"
git checkout -q -- .
printf '{ "ignorePatterns": ["**/*"], "categories": { "correctness": "off" } }\n' > test/cli/lint/conformance/corpus/.oxlintrc.json
"$BIN/oxlint" --config oxlint.json --fix test/cli/lint/conformance >/dev/null 2>&1 || true
echo "files rewritten with a configuration file inside the corpus: $(git status --porcelain | grep -c '^ M')"
git checkout -q -- . && rm -f test/cli/lint/conformance/corpus/.oxlintrc.json
sed -i 's#"test/cli/run/module-type-fixture",#"test/cli/run/module-type-fixture",\n    "test/cli/lint/conformance/corpus",#' oxlint.json
"$BIN/oxlint" --config oxlint.json --fix >/dev/null 2>&1 || true
echo "files rewritten with the entry in ignorePatterns: $(git status --porcelain | grep -v oxlint.json | grep -c '^ M' || true)"

echo "== VN-1: what git add stores below typecheck/fixtures"
rm -rf "$S/attr" && mkdir -p "$S/attr/test/cli/lint/typecheck/fixtures" "$S/attr/test/cli/lint/typecheck/fixtures2"
cd "$S/attr" && git init -q . && cp "$W/.gitattributes" .
cp "$TS/tests/cases/compiler/assignmentToObject.ts" "$TS/tests/baselines/reference/assignmentToObject.symbols" test/cli/lint/typecheck/fixtures/
cp "$TS/tests/cases/compiler/assignmentToObject.ts" test/cli/lint/typecheck/fixtures2/
printf '* -text\n' > test/cli/lint/typecheck/fixtures2/.gitattributes
git add . 2>/dev/null
echo "upstream blob (.ts):       $(git -C "$TS" rev-parse HEAD:tests/cases/compiler/assignmentToObject.ts)"
echo "index, root attributes:    $(git rev-parse :test/cli/lint/typecheck/fixtures/assignmentToObject.ts)"
echo "index, with '* -text':     $(git rev-parse :test/cli/lint/typecheck/fixtures2/assignmentToObject.ts)"
echo "upstream blob (.symbols):  $(git -C "$TS" rev-parse HEAD:tests/baselines/reference/assignmentToObject.symbols)"
echo "index (.symbols):          $(git rev-parse :test/cli/lint/typecheck/fixtures/assignmentToObject.symbols)"
echo ".symbols, autocrlf=true:   $(git -c core.autocrlf=true hash-object --path test/cli/lint/typecheck/fixtures/assignmentToObject.symbols test/cli/lint/typecheck/fixtures/assignmentToObject.symbols)"

echo "== RP-6: the ignore rule *.generated.ts and a nested .gitignore"
rm -rf "$S/ign" && mkdir -p "$S/ign/test/cli/lint/conformance/corpus/cases/x"
cd "$S/ign" && git init -q . && cp "$W/.gitignore" .
echo 1 > test/cli/lint/conformance/corpus/cases/x/parserSyntaxWalker.generated.ts
echo "without: $(git check-ignore -v test/cli/lint/conformance/corpus/cases/x/parserSyntaxWalker.generated.ts || echo not-ignored)"
printf '!*\n' > test/cli/lint/conformance/corpus/.gitignore
echo "with a nested '!*': $(git check-ignore test/cli/lint/conformance/corpus/cases/x/parserSyntaxWalker.generated.ts || echo not-ignored)"

if [ -x "$DEBUG" ]; then
  echo "== RP-4: LeakSanitizer on paths that parse and exit (debug build)"
  mkdir -p "$S/lsan" && cd "$S/lsan"
  printf 'const = ;\n' > bad.ts && printf 'const x: number = 1;\nexport {};\n' > ok.ts
  export BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 BUN_DESTRUCT_VM_ON_EXIT=1
  export ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1
  export LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$W/test/leaksan.supp
  for args in "build --no-bundle ok.ts" "build --no-bundle bad.ts" "bad.ts"; do
    code=0; "$DEBUG" $args > out.txt 2> err.txt || code=$?
    echo "[$args] exit=$code leak lines=$(grep -c 'LeakSanitizer\|SUMMARY: AddressSanitizer' err.txt || true)"
  done
fi
echo "scratch directory: $S"
