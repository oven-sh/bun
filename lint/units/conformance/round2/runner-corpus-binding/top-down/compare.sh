#!/usr/bin/env bash
# usage: compare.sh <tree> <out directory> [revision]
# In a tree with the corpus and the binding in place (a scratch clone of ../../scratch.sh after apply.sh, or the worktree):
# runs sweep.ts of the revision (default 3110ce85cf, where it carries its own glue) beside sweep.ts of the tree on 23
# command lines, and says for each whether the text, the exit code and the report are the same. The sweep of the revision
# runs against the runner of the tree, whose modules it imports one by one. One process at a time; a run over the whole
# corpus is about 12 seconds with the installed release build.
set -euo pipefail
tree=$(cd -- "${1:?usage: compare.sh <tree> <out directory> [revision]}" && pwd)
out=${2:?usage: compare.sh <tree> <out directory> [revision]}
revision=${3:-3110ce85cf}
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
mkdir -p "$out"
out=$(cd -- "$out" && pwd)
export RUNNER=$home/runner
git -C "$tree" show "$revision:test/cli/lint/conformance/sweep.ts" > "$home/sweep_before.ts"
trap 'rm -f "$home/sweep_before.ts"' EXIT
bash "$here/mini.sh" "$tree" "$out/mini" > /dev/null
mkdir -p "$out/dup/cases/compiler" "$out/dup/cases/conformance/y" "$out/dup/baselines/typescript" "$out/dup/baselines/typescript-go"
: > "$out/dup/baselines/typescript-go/NO_ERRORS.txt"; : > "$out/dup/submoduleAccepted.txt"; : > "$out/dup/submoduleTriaged.txt"
printf 'var a;\n' > "$out/dup/cases/compiler/same.ts"; printf 'var b;\n' > "$out/dup/cases/conformance/y/same.ts"
replay="--check $here/replay-check.ts"
mini="--corpus $out/mini"
n=0; same=0; differ=0
while IFS= read -r args; do
  n=$((n + 1))
  for side in before after; do
    script=sweep.ts; [ "$side" = before ] && script=sweep_before.ts
    report=; case "$args" in *--no-run*) ;; *) report="--report $out/report.json" ;; esac
    # The words of a line are the arguments, and no pattern of them names a file of the tree.
    # shellcheck disable=SC2086
    (cd "$tree" && bun "test/cli/lint/conformance/$script" $args $report > "$out/$side-$n.txt" 2>&1; echo "exit $?" >> "$out/$side-$n.txt") || true
    sed -i 's/^report .*//' "$out/$side-$n.txt"
    if [ -f "$out/report.json" ]; then
      bun -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); delete r.seconds; console.log(JSON.stringify(r))' "$out/report.json" > "$out/$side-$n.report"
      rm -f "$out/report.json"
    else
      echo none > "$out/$side-$n.report"
    fi
  done
  if cmp -s "$out/before-$n.txt" "$out/after-$n.txt" && cmp -s "$out/before-$n.report" "$out/after-$n.report"; then
    same=$((same + 1)); echo "same       $(head -1 "$out/after-$n.txt" | cut -c1-70) | $(tail -1 "$out/after-$n.txt") | $args" | cut -c1-230
  else
    differ=$((differ + 1)); echo "DIFFERENT  $args"
  fi
done <<LIST
--no-run
--no-run --since HEAD
--no-run --listed
--no-run --tag triaged
$mini --no-run
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
echo "same $same, different $differ"
