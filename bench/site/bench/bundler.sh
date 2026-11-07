#!/bin/bash
# rolldown/benchmarks harness on apps/10000 (10k React components / ~19k modules): vite, rsbuild, rspack, rollup, rolldown, esbuild, bun.
# The harness runs `bun build` via `bun` on PATH, so a shim dir pointing at $BUN goes first on PATH.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
APP=${APP:-apps/10000}
SHIM=$S/bin; mkdir -p "$SHIM"; ln -sf "$BUN" "$SHIM/bun"; export PATH=$SHIM:$PATH
cd "$S/benchmarks"
echo "bun=$(bun --version) ($BUN) node=$($NODE --version) hyperfine=$(hyperfine --version)"
$NODE bench.mjs --app "$APP" --json "$OUT/bundler-$(basename "$APP").json"
echo "--- release-bun row (same command as the harness's build:bun, run alone):"
(cd "$APP" && hyperfine --export-json "$OUT/bundler-$(basename "$APP")-bun-release.json" -n "$BUN_RELEASE_LABEL" "$BUN_RELEASE build --outdir=dist-bun --production --sourcemap ./src/index.jsx")
echo "--- peak RSS per bundler (one build each under GNU time; output size in the harness json):"
cd "$APP"
for t in bun rolldown esbuild rspack rollup vite rsbuild; do
  $GNU_TIME -f "%M" -o "$TMP/rss.txt" $NODE --run build:$t > /dev/null 2>&1 || echo "  (build:$t exited non-zero)"
  echo "peak_rss $t $(( $(tail -1 "$TMP/rss.txt") / 1024 ))MB"
done | tee "$OUT/bundler-$(basename "$APP")-rss.txt"
echo BUNDLER_DONE
