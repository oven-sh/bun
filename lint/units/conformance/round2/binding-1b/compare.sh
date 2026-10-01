#!/usr/bin/env bash
# usage: compare.sh <tree> <out directory>
# In a scratch clone of ../scratch.sh (no --prototype) with expectations.json in place: runs sweep.ts as committed, lays the
# binding over the tree with apply.sh, runs the same commands again and says for each whether the text and the report
# are the same. One process at a time; the whole corpus is about 12 seconds a run with the installed release build.
set -euo pipefail
tree=$(cd -- "${1:?usage: compare.sh <tree> <out directory>}" && pwd)
out=${2:?usage: compare.sh <tree> <out directory>}
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
mkdir -p "$out"
export RUNNER=$home/runner
[ -f "$home/expectations.json" ] || cp "$here/expectations.json" "$home/expectations.json"
bash "$here/mini.sh" "$tree" "$out/mini" > /dev/null
mkdir -p "$out/dup/cases/compiler" "$out/dup/cases/conformance/y" "$out/dup/baselines/typescript" "$out/dup/baselines/typescript-go"
: > "$out/dup/baselines/typescript-go/NO_ERRORS.txt"; : > "$out/dup/submoduleAccepted.txt"; : > "$out/dup/submoduleTriaged.txt"
printf 'var a;\n' > "$out/dup/cases/compiler/same.ts"; printf 'var b;\n' > "$out/dup/cases/conformance/y/same.ts"
replay="--check $here/replay-check.ts"
mini="--corpus $out/mini"
run() {
  local side=$1
  local n=0
  while IFS= read -r args; do
    n=$((n + 1))
    # shellcheck disable=SC2086
    (cd "$tree" && bun test/cli/lint/conformance/sweep.ts $args --report "$out/report.json" > "$out/$side-$n.txt" 2>&1; echo "exit $?" >> "$out/$side-$n.txt") || true
    if [ -f "$out/report.json" ]; then
      bun -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); delete r.seconds; console.log(JSON.stringify(r))' "$out/report.json" > "$out/$side-$n.report"
      rm -f "$out/report.json"
    else
      echo none > "$out/$side-$n.report"
    fi
  done <<LIST
$replay --no-files
$replay --jobs 4
$replay --no-files conformance/types/tuple/
$replay --jobs 4 conformance/types/tuple/
$replay --no-files --tag accepted --kind E
$replay --no-files abstractPropertyNegative* castingTuple.ts conformance/types/tuple/castingTuple.ts
$mini $replay --no-files
$mini $replay --jobs 2
$mini $replay --no-files --tag accepted
$mini $replay --no-files --tag triaged
$mini $replay --no-files --kind E
$mini $replay --no-files bad.ts both.ts
$mini $replay --no-files conformance/x/
$mini $replay --no-files c(*
$mini $replay --no-files --expectations $out/mini.expectations.json
$mini $replay --no-files --listed --expectations $out/mini.expectations.json
--corpus $out/nonexistent $replay --no-files
--corpus $out/dup $replay --no-files
LIST
  local m=0
  while IFS= read -r args; do
    m=$((m + 1))
    # shellcheck disable=SC2086
    (cd "$tree" && bun test/cli/lint/conformance/sweep.ts $args > "$out/$side-norun-$m.txt" 2>&1; echo "exit $?" >> "$out/$side-norun-$m.txt") || true
  done <<LIST
--no-run
--no-run --since HEAD
--no-run --listed
--no-run --tag triaged
$mini --no-run
LIST
}
run before
bash "$here/apply.sh" "$tree"
run after
same=0; differ=0
for before in "$out"/before-*; do
  after=${before/before-/after-}
  if cmp -s "$before" "$after"; then same=$((same + 1)); else differ=$((differ + 1)); echo "DIFFERENT: $before $after"; fi
done
echo "same $same, different $differ"
