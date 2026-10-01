#!/bin/sh
# The in-memory file system of the runner against the reference: stored results of Go 1.26, and fresh ones when a Go 1.26 is at hand.
# usage: sh prove.sh [runner directory] [go 1.26 binary, default /tmp/rr/go126/bin/go] [work directory, default /tmp/memfs-go126]
# The stored files: vectors/vectors.json.gz is what "bun gen.ts 3000" writes; go126.jsonl.gz and go124.jsonl.gz are one run each of
# groundtruth/main.go; unstable.json lists the vectors where twelve runs of Go 1.26 differ among themselves (the map order of Go).
set -e
H=$(cd "$(dirname "$0")" && pwd)
RUNNER=${1:-/workspace/wt/conformance/test/cli/lint/conformance/runner}
GO126=${2:-/tmp/rr/go126/bin/go}
W=${3:-/tmp/memfs-go126}
mkdir -p "$W"
echo "== the runner against the stored results of Go 1.26"
bun "$H/verify.ts" "$RUNNER"
echo "== the generator gives the stored vectors"
bun "$H/gen.ts" 3000 "$W/vectors.json" && gunzip -c "$H/vectors/vectors.json.gz" | cmp - "$W/vectors.json" && echo "the same bytes"
echo "== classes of difference between the stored results of Go 1.24 and Go 1.26 (testing/fstest follows links since Go 1.25)"
gunzip -c "$H/vectors/go124.jsonl.gz" > "$W/go124.jsonl"
gunzip -c "$H/vectors/go126.jsonl.gz" > "$W/go126.jsonl"
bun -e 'const fs = require("fs"); const a = fs.readFileSync(process.argv[1], "utf8").split("\n"), b = fs.readFileSync(process.argv[2], "utf8").split("\n"); let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; console.log(n + " of " + (a.length - 1) + " vectors differ");' "$W/go124.jsonl" "$W/go126.jsonl"
if [ -x "$GO126" ]; then
  echo "== fresh results of $("$GO126" version)"
  sh "$H/groundtruth/build.sh" "$GO126" "$W/gt126" no
  bun "$H/drive.ts" "$W/gt126/gt" "$W/vectors.json" "$W/fresh.jsonl"
  bun "$H/verify.ts" "$RUNNER" "$W/vectors.json" "$W/fresh.jsonl"
else
  echo "no Go 1.26 at $GO126: the stored results only"
fi
