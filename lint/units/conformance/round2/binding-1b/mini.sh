#!/usr/bin/env bash
# usage: mini.sh <tree> <directory>
# Writes a corpus of six cases into <directory>, from two cases of the corpus of <tree>: two instances that run without errors,
# one with errors, two variations of one case (one of them accepted), one that the reference skips (target ES5), one at
# which the reference stops (an unknown value of a varied option) and one whose diff both lists of typescript-go name.
# The pinned corpus has no instance of the last two kinds, so only such a corpus shows what the sweep and the binding
# make of them. Also writes <directory>.expectations.json, lists that name instances of every kind.
set -euo pipefail
tree=$(cd -- "${1:?usage: mini.sh <tree> <directory>}" && pwd)
mini=${2:?usage: mini.sh <tree> <directory>}
corpus=$tree/test/cli/lint/conformance/corpus
rm -rf "$mini"
mkdir -p "$mini/cases/compiler" "$mini/cases/conformance/x" "$mini/lib" "$mini/baselines/typescript" "$mini/baselines/typescript-go"
cp "$corpus/cases/compiler/2dArrays.ts" "$corpus/cases/compiler/ArrowFunctionExpression1.ts" "$mini/cases/compiler/"
cp "$corpus/baselines/typescript/ArrowFunctionExpression1.errors.txt" "$mini/baselines/typescript/"
printf '// @target: es5\nvar x = 1;\n' > "$mini/cases/compiler/skipme.ts"
printf '// @target: nosuch,es2015\nvar x = 1;\n' > "$mini/cases/compiler/bad.ts"
printf 'var both = 1;\n' > "$mini/cases/compiler/both.ts"
printf '// @strict: true,false\nvar c = 1;\n' > "$mini/cases/conformance/x/c.ts"
: > "$mini/baselines/typescript-go/NO_ERRORS.txt"
printf 'compiler/both.errors.txt.diff\nconformance/c(strict=true).errors.txt.diff\n' > "$mini/submoduleAccepted.txt"
printf 'compiler/both.errors.txt.diff\n' > "$mini/submoduleTriaged.txt"
printf '{\n  "level": "baseline",\n  "E": [\n    "ArrowFunctionExpression1.ts",\n    "bad.ts",\n    "both.ts"\n  ],\n  "C": [\n    "2dArrays.ts",\n    "c(strict=true).ts",\n    "gone.ts",\n    "skipme.ts"\n  ]\n}\n' > "$mini.expectations.json"
echo "mini corpus at $mini"
