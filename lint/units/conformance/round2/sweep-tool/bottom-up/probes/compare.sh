#!/usr/bin/env bash
# sweep-orig.ts (3110ce85cf) and sweep.ts (the prototype) on the same command lines: exit code, stderr, and the text without the two tables.
set -uo pipefail
cd /tmp/st1a/repo
out=/tmp/st1a/cmp; rm -rf "$out"; mkdir -p "$out"
X="--expectations /tmp/st1a/expectations.json"
replay="--check /tmp/st1a/fx/replay-check.ts"
empty="--check /tmp/st1a/fx/empty-check.ts"
strip() { awk '/^by directory:/ {skip=1} /^by diagnostic code:/ {skip=1} /^$/ {skip=0} !skip' "$1" | sed 's/^report .*//'; }
n=0; same=0; differ=0
while IFS= read -r args; do
  n=$((n + 1))
  for side in orig new; do
    script=test/cli/lint/conformance/sweep.ts; [ "$side" = orig ] && script=test/cli/lint/conformance/sweep-orig.ts
    # shellcheck disable=SC2086
    bun $script $args --report "$out/$side-$n.json" > "$out/$side-$n.out" 2> "$out/$side-$n.err"; echo "exit $?" >> "$out/$side-$n.out"
    sed -i 's/sweep-orig\.ts/sweep.ts/g' "$out/$side-$n.out" "$out/$side-$n.err"
    sed -i '/^usage: /,$d' "$out/$side-$n.err"
  done
  if cmp -s <(strip "$out/orig-$n.out") <(strip "$out/new-$n.out") && cmp -s "$out/orig-$n.err" "$out/new-$n.err"; then
    same=$((same + 1)); echo "same       $(tail -1 "$out/new-$n.out") | $args" | cut -c1-200
  else
    differ=$((differ + 1)); echo "DIFFERENT  $n: $args"
  fi
done <<LIST
$X --no-run
$X --no-run --listed
$X --no-run --tag triaged
$X $replay --no-files
$X $empty --no-files
$X $replay --no-files conformance/types/tuple/
$X $empty --no-files conformance/types/tuple/
$X $replay --jobs 4 conformance/types/tuple/
$X $replay --no-files --tag accepted --kind E
$X $replay --no-files abstractPropertyNegative* castingTuple.ts conformance/types/tuple/castingTuple.ts
$X $empty --no-files abstractPropertyNegative* castingTuple.ts conformance/types/tuple/castingTuple.ts 2dArrays.ts
$X $replay --no-files noSuchCase.ts conformance/types/tuple
$X $replay --no-files conformance/types/tuple
$X $replay --no-files --listed castingTuple.ts
--corpus /tmp/st1a/nonexistent $X $replay --no-files
$X --check /tmp/st1a/fx/nonexistent.ts --no-files castingTuple.ts
$X --check /tmp/st1a/expectations.json --no-files castingTuple.ts
--jobs 0 --foo
--foo=1
--jobs
--jobs=
--kind X
--bin x --check y
--no-files
--jobs 2 --jobs 3
$X --no-run --jobs 2
--round-trip castingTuple.ts
--timeout 1.5 $X $replay --no-files castingTuple.ts
$X $replay --no-files --jobs=2 --timeout=5000 --kind=C conformance/types/tuple/
--help
$X --no-files castingTuple.ts
LIST
echo "same $same, different $differ"
