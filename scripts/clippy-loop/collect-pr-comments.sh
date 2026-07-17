#!/usr/bin/env bash
# Collects unresolved bot review comments from a PR, deduplicates by location,
# writes one .txt per file with all its comments, and emits a manifest
# compatible with edit-round.workflow.ts.
#
# Usage: collect-pr-comments.sh <pr-number>
# Output: $OUT/manifest-pr.json (path printed to stdout)
set -euo pipefail
PR="${1:?PR number}"
OUT="${CLIPPY_LOOP_DIR:-/tmp/clippy-loop}"
mkdir -p "$OUT/pr-diags"

# `bun run` echoes the command line first; piping truncates large outputs at
# 64KB, so write to a file and strip in place.
bun run pr:comments "$PR" --json > "$OUT/pr-raw.txt" 2>/dev/null
sed -n '/^\[/,$p' "$OUT/pr-raw.txt" > "$OUT/pr-comments.json"

# Filter: unresolved bot line-comments with a location, group by file,
# write one .txt per file with all comments + their bodies.
jq -r '
  [ .[]
    | select(.tag == "line-comment" and .resolved != true)
    | select(.user | test("claude\\[bot\\]|coderabbitai\\[bot\\]"))
    | select(.location != null)
    | {
        file: (.location | split(":")[0]),
        line: ((.location | split(":")[1]) // "?"),
        body: .body,
        url: .url
      }
  ]
  | group_by(.file)
  | .[]
  | { file: .[0].file, count: length, comments: . }
' "$OUT/pr-comments.json" | jq -s '.' > "$OUT/pr-grouped.json"

rm -rf "$OUT/pr-diags"
mkdir -p "$OUT/pr-diags"

jq -r '.[].file' "$OUT/pr-grouped.json" | while read -r f; do
  safe="${f//\//_}"
  jq -r --arg f "$f" '
    .[] | select(.file == $f) | .comments[] |
    "## review comment @ line \(.line)\n\(.url)\n\n\(.body)\n\n────────────────────\n"
  ' "$OUT/pr-grouped.json" > "$OUT/pr-diags/${safe}.txt"
done

jq -c --arg out "$OUT" '[.[] | {file, count, diagPath: ($out + "/pr-diags/" + (.file | gsub("/";"_")) + ".txt")}]' \
  "$OUT/pr-grouped.json" > "$OUT/manifest-pr.json"

>&2 jq -r '"files=\(length) comments=\([.[].count]|add // 0)"' "$OUT/pr-grouped.json"
echo "$OUT/manifest-pr.json"
