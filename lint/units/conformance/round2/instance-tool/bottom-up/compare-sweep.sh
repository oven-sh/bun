#!/usr/bin/env bash
# usage: compare-sweep.sh <before root> <after root> <out directory>
# sweep.ts of two trees on the same command lines: text, exit code and report (but for its seconds). One process at a time.
set -uo pipefail
before=$1; after=$2; out=$3
W=/tmp/instance-tool-1a
corpus=$after/test/cli/lint/conformance/corpus
mkdir -p "$out"
replay="--check $W/checks/replay.ts"
empty="--check $W/checks/empty.ts"
mini="--corpus $W/mini"
n=0; same=0; differ=0
while IFS= read -r args; do
  n=$((n + 1))
  for side in before after; do
    root=$before; [ "$side" = after ] && root=$after
    report=; case "$args" in *--no-run*) ;; *) report="--report $out/report.json" ;; esac
    c=; case "$args" in *--corpus*) ;; *) c="--corpus $corpus" ;; esac
    # shellcheck disable=SC2086
    (cd "$root" && RUNNER=$root/test/cli/lint/conformance/runner bun test/cli/lint/conformance/sweep.ts $c $args $report > "$out/$side-$n.txt" 2>&1; echo "exit $?" >> "$out/$side-$n.txt") || true
    sed -i 's/^report .*//' "$out/$side-$n.txt"
    if [ -f "$out/report.json" ]; then
      bun -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); delete r.seconds; console.log(JSON.stringify(r))' "$out/report.json" > "$out/$side-$n.report"
      rm -f "$out/report.json"
    else
      echo none > "$out/$side-$n.report"
    fi
  done
  if cmp -s "$out/before-$n.txt" "$out/after-$n.txt" && cmp -s "$out/before-$n.report" "$out/after-$n.report"; then
    same=$((same + 1)); echo "same       $(head -1 "$out/after-$n.txt" | cut -c1-60) | $(tail -1 "$out/after-$n.txt") | $args" | cut -c1-220
  else
    differ=$((differ + 1)); echo "DIFFERENT  $args"
  fi
done <<LIST
--no-run
--no-run --listed
--no-run --tag triaged
$mini --no-run
$replay --no-files
$empty --no-files
$replay --jobs 4
$replay --no-files conformance/types/tuple/
$empty --no-files conformance/types/tuple/
$replay --jobs 4 conformance/types/tuple/
$replay --no-files --tag accepted --kind E
$replay --no-files abstractPropertyNegative* castingTuple.ts conformance/types/tuple/castingTuple.ts
$empty --no-files abstractPropertyNegative* castingTuple.ts conformance/types/tuple/castingTuple.ts 2dArrays.ts
$replay --no-files noSuchCase.ts conformance/types/tuple
$replay --no-files --listed castingTuple.ts
$mini $replay --no-files
$mini $replay --jobs 2
$mini $replay --no-files --tag accepted
$mini $replay --no-files --tag triaged
$mini $replay --no-files --kind E
$mini $replay --no-files bad.ts both.ts
$mini $replay --no-files conformance/x/
$mini $replay --no-files c(*
$mini $replay --no-files --expectations $W/mini.expectations.json
$mini $replay --no-files --listed --expectations $W/mini.expectations.json
--corpus $W/nonexistent $replay --no-files
--corpus $W/dup $replay --no-files
--check $W/checks/nonexistent.ts --no-files castingTuple.ts
--check $W/mini.expectations.json --no-files castingTuple.ts
--jobs 0 --foo
--foo=1
--foo
--jobs
--jobs=
--kind X
--bin x --check y
--no-files
--jobs 2 --jobs 3
--no-run --jobs 2
--round-trip castingTuple.ts
--timeout 1.5 $replay --no-files castingTuple.ts
$replay --no-files --jobs=2 --timeout=5000 --kind=C conformance/types/tuple/
--help
LIST
echo "same $same, different $differ"
