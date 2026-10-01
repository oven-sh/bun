#!/usr/bin/env bash
# usage: compare.sh <tree> <out> <label>   the sweeps of <tree>/test/cli/lint/conformance/sweep.ts, into <out>/<label>
#        compare.sh --diff <out> <a> <b>   the outputs of two labels that differ; a report is compared without its seconds
# Proves that a change of sweep.ts or of the runner prints the same: run it with one label before the change and with
# another after it. The tree needs the corpus (sync.sh) and expectations.json. Every sweep is one process that starts
# no other (the checks are modules), about a minute in all with a release bun. The synthetic corpora hold what the
# corpus of the pinned commits has none of: instances that the reference fails (a case that is no UTF-8, content
# before the first file, too many variations, a panic of the file system, a diff in both lists), a skipped instance
# in both lists, two cases of one name, a corpus without a list, no corpus.
set -uo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [ "${1:-}" = --diff ]; then
  out=${2:?}; a=${3:?}; b=${4:?}; differ=0
  for f in $(ls "$out/$a"); do
    if [ "${f##*.}" = json ]; then filter='s/^ "seconds": [0-9.]+,$/ "seconds": X,/'; else filter=''; fi
    if cmp -s <(sed -E "$filter" "$out/$a/$f") <(sed -E "$filter" "$out/$b/$f"); then echo "same   $f"; else echo "DIFFER $f"; differ=1; fi
  done
  exit $differ
fi
tree=$(cd -- "${1:?usage: compare.sh <tree> <out> <label>}" && pwd); out=${2:?}; label=${3:?}
export H=$tree/test/cli/lint/conformance
O=$out/$label; mkdir -p "$O"
report=$out/report.json
syn=$out/synthetic
if [ ! -d "$syn" ]; then
  R=$syn/1; mkdir -p $R/cases/compiler $R/cases/conformance/dir $R/lib $R/baselines/typescript $R/baselines/typescript-go/compiler
  printf 'let x: number = "s";\n' > $R/cases/compiler/ok.ts
  printf 'let y = 1;\n' > $R/cases/compiler/clean.ts
  printf 'let a = 1;\n// @filename: b.ts\nlet b = 2;\n' > $R/cases/compiler/before.ts
  printf 'let z = 1;\n' > $R/cases/compiler/both.ts
  printf '// @target: es5\nlet w = 1;\n' > $R/cases/compiler/skipboth.ts
  printf '// @strict: true, false\nlet v = 1;\n' > $R/cases/conformance/dir/vary.ts
  printf '// @target: *\n// @strict: true, false\nlet m = 1;\n' > $R/cases/compiler/many.ts
  printf 'let u = "\xff";\n' > $R/cases/compiler/notutf8.ts
  printf '// @filename: /a.ts\nlet q = 1;\n// @filename: A:/b.ts\nlet r = 1;\n' > $R/cases/compiler/drive.ts
  printf 'let k: number = "s";\n' > $R/cases/compiler/gone.ts
  printf 'x' > $R/baselines/typescript/ok.errors.txt
  printf 'x' > $R/baselines/typescript/gone.errors.txt
  printf 'x' > $R/baselines/typescript-go/compiler/both.errors.txt
  printf 'compiler/gone.errors.txt\n' > $R/baselines/typescript-go/NO_ERRORS.txt
  printf '# accepted\ncompiler/both.errors.txt.diff\ncompiler/skipboth.errors.txt.diff\nconformance/vary(strict=true).errors.txt.diff\n' > $R/submoduleAccepted.txt
  printf 'compiler/both.errors.txt.diff\ncompiler/skipboth.errors.txt.diff\nconformance/vary(strict=false).errors.txt.diff\n' > $R/submoduleTriaged.txt
  printf '{\n  "level": "baseline",\n  "E": [\n    "before.ts",\n    "clean.ts",\n    "ok.ts"\n  ],\n  "C": [\n    "both.ts",\n    "gone.ts",\n    "nosuch.ts",\n    "skipboth.ts",\n    "vary(strict=true).ts"\n  ]\n}\n' > $syn/1-expectations.json
  for n in 2 3; do
    R=$syn/$n; mkdir -p $R/cases/compiler $R/cases/conformance/dir $R/lib $R/baselines/typescript $R/baselines/typescript-go
    printf 'let x = 1;\n' > $R/cases/compiler/a.ts; : > $R/submoduleAccepted.txt; : > $R/submoduleTriaged.txt
  done
  printf 'let x = 2;\n' > $syn/2/cases/conformance/dir/a.ts; : > $syn/2/baselines/typescript-go/NO_ERRORS.txt
fi
cd "$tree"
S=test/cli/lint/conformance/sweep.ts
run() { name=$1; shift; bun $S "$@" > "$O/$name.txt" 2> "$O/$name.err"; echo "exit $?" >> "$O/$name.txt"; if [ -f "$report" ]; then mv "$report" "$O/$name.json"; fi; }
replay=(--check "$here/replay-check.ts" --report "$report")
empty=(--check "$here/empty-check.ts" --report "$report")
one=(--corpus "$syn/1" --expectations "$syn/1-expectations.json")
run no-run --no-run
run tuple-nofiles "${replay[@]}" --no-files conformance/types/tuple/
run tuple-files "${replay[@]}" conformance/types/tuple/
run all-nofiles "${replay[@]}" --no-files
run all-files "${replay[@]}"
run all-empty "${empty[@]}" --no-files
run syn1-no-run "${one[@]}" --no-run
run syn1-empty "${one[@]}" "${empty[@]}" --no-files
run syn1-empty-files "${one[@]}" "${empty[@]}"
run syn1-tag "${one[@]}" --no-run --tag accepted
run syn1-selectors "${one[@]}" --no-run "vary*" both.ts compiler/before.ts conformance/
run syn1-kind "${one[@]}" --no-run --kind E
run syn1-listed "${one[@]}" --no-run --listed
run no-corpus --corpus "$out/no-such-corpus" --no-run
run two-cases-of-one-name --corpus "$syn/2" --no-run
run no-list --corpus "$syn/3" --no-run
run no-instance --no-run noSuchCase.ts
run directory-without-slash --no-run conformance/types/tuple
ls "$O" | wc -l
