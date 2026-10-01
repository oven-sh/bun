#!/bin/bash
# Under the machine lock, once: in the scratch clone with the verified files of ../verified laid over 3110ce85cf, sweep.ts of HEAD
# beside sweep.ts of the tree: --no-run, and the default check with the debug build on conformance/types/tuple/ with --jobs 4.
tree=/tmp/corpus-glue-1b/repo
out=/tmp/corpus-glue-1b/out
home=test/cli/lint/conformance
debug=/workspace/wt/conformance/build/debug/bun-debug
cd "$tree" || exit 1
echo "start $(date +%T)" > "$out/progress4"
git show "HEAD:$home/sweep.ts" > "$home/sweep_before.ts"
for side in before after; do
  script=sweep.ts; [ "$side" = before ] && script=sweep_before.ts
  (bun "$home/$script" --no-run > "$out/f-norun-$side.txt" 2>&1; echo "exit $?" >> "$out/f-norun-$side.txt")
  rm -f "$out/f-tuple-$side.json"
  (bun "$home/$script" --bin "$debug" --jobs 4 --report "$out/f-tuple-$side.json" conformance/types/tuple/ > "$out/f-tuple-$side.txt" 2>&1; echo "exit $?" >> "$out/f-tuple-$side.txt")
  sed -i 's/^report .*//' "$out/f-tuple-$side.txt"
  bun -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); delete r.seconds; console.log(JSON.stringify(r))' "$out/f-tuple-$side.json" > "$out/f-tuple-$side.report"
done
rm -f "$home/sweep_before.ts"
{
  cmp "$out/f-norun-before.txt" "$out/f-norun-after.txt" && echo "--no-run: same text and exit code"
  cmp "$out/f-tuple-before.txt" "$out/f-tuple-after.txt" && echo "tuple, debug binary: same text and exit code"
  cmp "$out/f-tuple-before.report" "$out/f-tuple-after.report" && echo "tuple, debug binary: same report"
} >> "$out/progress4" 2>&1
echo "end $(date +%T)" >> "$out/progress4"
