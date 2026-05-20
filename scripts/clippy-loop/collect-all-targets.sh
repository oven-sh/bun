#!/usr/bin/env bash
# Collect ALL diagnostics (check errors + clippy errors + clippy warnings) across
# the host + the 5 commonly-broken targets, dedup by (file, line, code), and
# emit one merged manifest the edit-round workflow can consume. The per-file
# diag dump includes which targets each diagnostic fired on so the fixer knows
# to cfg-gate rather than delete.
set -euo pipefail
OUT="${CLIPPY_LOOP_DIR:-/tmp/clippy-loop}"
mkdir -p "$OUT"
# GNU base64 decodes with -d; BSD/macOS uses -D. Probe once.
if printf '' | base64 -d >/dev/null 2>&1; then B64D="-d"; else B64D="-D"; fi
TARGETS=(
  x86_64-unknown-linux-gnu
  aarch64-apple-darwin
  x86_64-pc-windows-msvc
  x86_64-unknown-freebsd
  aarch64-linux-android
  x86_64-unknown-linux-musl
)

find src/ -name '*.rs' -exec touch {} +

# Host clippy (errors + warnings — the deny set + default-on)
{ cargo clippy --workspace --no-deps --keep-going --message-format=json 2>/dev/null || true; } \
  | jq -c 'select(.reason=="compiler-message") | {target:"host", m:.message}' \
  > "$OUT/all.jsonl"

# Per-target check (errors only — cross-platform cfg breakage)
for T in "${TARGETS[@]}"; do
  >&2 echo "[collect] $T"
  cargo check --workspace --target "$T" --keep-going --message-format=json 2>/dev/null \
    | jq -c --arg t "$T" 'select(.reason=="compiler-message" and .message.level=="error") | {target:$t, m:.message}' \
    >> "$OUT/all.jsonl" || true
done

# Group by file. For each file, merge diagnostics from all targets and tag them.
jq -s '
  map(
    . as $e
    | ($e.m.spans | map(select(.is_primary))[0] // $e.m.spans[0]) as $sp
    | select($sp != null and ($sp.file_name | startswith("src/")))
    | {
        file: $sp.file_name,
        code: ($e.m.code.code // "uncoded"),
        line: $sp.line_start,
        target: $e.target,
        rendered: $e.m.rendered
      }
  )
  | group_by(.file)
  | map({
      file: .[0].file,
      count: (group_by(.code + (.line|tostring)) | length),
      diagnostics: (
        group_by(.code + (.line|tostring))
        | map({
            code: .[0].code,
            line: .[0].line,
            targets: (map(.target) | unique),
            rendered: .[0].rendered
          })
      )
    })
  | sort_by(-.count)
' "$OUT/all.jsonl" > "$OUT/all.grouped.json"

>&2 jq -r '"files=\(length) diags=\([.[].count]|add // 0)"' "$OUT/all.grouped.json"

# Per-file diag dump (with target tags) + slim manifest
rm -rf "$OUT/diags"
mkdir -p "$OUT/diags"
jq -r '.[] | @base64' "$OUT/all.grouped.json" | while read -r b64; do
  entry=$(echo "$b64" | base64 "$B64D")
  file=$(echo "$entry" | jq -r '.file')
  safe=$(echo "$file" | tr '/' '_')
  echo "$entry" | jq -r '
    "# \(.count) diagnostics for \(.file)\n" +
    (.diagnostics | map(
      "## [\(.targets | join(", "))] \(.code) @ line \(.line)\n\(.rendered)"
    ) | join("\n"))
  ' > "$OUT/diags/${safe}.txt"
done

jq -c --arg out "$OUT" '[.[] | {file, count, diagPath: ($out + "/diags/" + (.file | gsub("/";"_")) + ".txt")}]' \
  "$OUT/all.grouped.json" > "$OUT/manifest-all.json"

>&2 echo "manifest: $OUT/manifest-all.json"
echo "$OUT/manifest-all.json"
