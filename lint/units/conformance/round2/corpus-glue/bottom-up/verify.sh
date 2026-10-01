#!/usr/bin/env bash
# usage: verify.sh <tree> <out directory> [revision]   (run under /workspace/tools/lk)
# The checks of the binding in a scratch clone with the corpus (../../scratch.sh, then apply.sh): the test file under the
# release build and under the debug build of the worktree with the leak check of CI, sweep.ts of the revision (default
# 3110ce85cf, where it carries its own glue) beside sweep.ts of the tree with the debug binary on one small directory and
# with --no-run, and compare.sh of ../../runner-corpus-binding/top-down on 23 command lines.
set -uo pipefail
tree=$(cd -- "$1" && pwd)
out=$2
revision=${3:-3110ce85cf}
mkdir -p "$out"
out=$(cd -- "$out" && pwd)
dbg=/workspace/wt/conformance/build/debug/bun-debug
home=test/cli/lint/conformance
cd "$tree"

echo "== release test"; date
(USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts > "$out/release.log" 2>&1; echo "exit $?" >> "$out/release.log")
tail -6 "$out/release.log"

echo "== debug test, leak check of CI"; date
(BUN_DEBUG_QUIET_LOGS=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
  ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
  LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$tree/test/leaksan.supp \
  "$dbg" test test/cli/lint/conformance.test.ts > "$out/debug-leak.log" 2>&1; echo "exit $?" >> "$out/debug-leak.log")
tail -7 "$out/debug-leak.log"
grep -c "LeakSanitizer\|AddressSanitizer" "$out/debug-leak.log"

echo "== sweeps before and after"; date
git show "$revision:$home/sweep.ts" > "$home/sweep_before.ts"
trap 'rm -f "$tree/$home/sweep_before.ts"' EXIT
for side in before after; do
  script=sweep.ts; [ "$side" = before ] && script=sweep_before.ts
  (bun "$home/$script" --no-run > "$out/norun-$side.txt" 2>&1; echo "exit $?" >> "$out/norun-$side.txt")
  (bun "$home/$script" --bin "$dbg" --jobs 4 --report "$out/tuple-$side.json" conformance/types/tuple/ > "$out/tuple-$side.txt" 2>&1; echo "exit $?" >> "$out/tuple-$side.txt")
  sed -i 's/^report .*//' "$out/tuple-$side.txt"
  bun -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); delete r.seconds; console.log(JSON.stringify(r))' "$out/tuple-$side.json" > "$out/tuple-$side.report"
done
cmp "$out/norun-before.txt" "$out/norun-after.txt" && echo "--no-run: same text and exit code"
cmp "$out/tuple-before.txt" "$out/tuple-after.txt" && echo "tuple with the debug binary: same text and exit code"
cmp "$out/tuple-before.report" "$out/tuple-after.report" && echo "tuple with the debug binary: same report"
cat "$out/norun-after.txt"
head -12 "$out/tuple-after.txt"
rm -f "$home/sweep_before.ts"
trap - EXIT

echo "== compare.sh"; date
bash /workspace/notes/lint/units/conformance/round2/runner-corpus-binding/top-down/compare.sh "$tree" "$out/cmp" "$revision" 2>&1 | tail -30
date
