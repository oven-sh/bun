#!/usr/bin/env bash
# usage: /workspace/tools/lk bash sweep-chunks.sh [scratch clone] [work directory]
# The whole corpus through sweep.ts AS IT IS at the commit of the scratch clone, with the default check against the
# debug build of the worktree, in nine chunks by the first character of the instance name (12,797 run instances).
# One report per chunk in <work directory>/reports; a chunk whose report exists is not run again.
# After each chunk the reports are merged into observed/ of this directory (merge.ts) and the notes are saved.
# After the last chunk, raw.ts runs again every instance whose outcome is crash or timeout and keeps what came back.
# The script that runs sweep.ts is the INSTALLED bun; the binary under test is --bin. Never more than 4 processes.
set -u
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
scratch=${1:-/tmp/ls1a-scratch}
work=${2:-/tmp/ls1a}
bin=${LINT_BIN:-/workspace/wt/conformance/build/debug/bun-debug}
expectations=/workspace/notes/lint/units/conformance/round2/prototype/expectations.json
reports=$work/reports
mkdir -p "$reports"
echo "### lock acquired $(date -u +%FT%TZ) load $(cut -d' ' -f1-3 /proc/loadavg) bin $($bin --revision 2>/dev/null | tail -1)"

chunk() {
  local name=$1
  shift
  if [ -s "$reports/$name.json" ]; then
    echo "chunk $name: report exists"
    return
  fi
  # materialise.ts ancestorProjectFile: with one of these above the temporary directory every instance is "unsupported".
  local f
  for f in /tmp/node_modules /tmp/package.json /tmp/tsconfig.json /tmp/jsconfig.json /node_modules /package.json /tsconfig.json /jsconfig.json; do
    if [ -e "$f" ]; then echo "chunk $name: $f exists, no instance can be laid out"; fi
  done
  local start
  start=$(date +%s)
  (cd "$scratch" && bun test/cli/lint/conformance/sweep.ts --bin "$bin" --jobs 4 --timeout 120000 \
    --report "$reports/$name.json.tmp" --expectations "$expectations" "$@") > "$reports/$name.out" 2>&1
  local rc=$?
  if [ -s "$reports/$name.json.tmp" ]; then mv "$reports/$name.json.tmp" "$reports/$name.json"; fi
  echo "chunk $name: exit $rc, $(($(date +%s) - start)) s, $(head -1 "$reports/$name.out"); $(grep '^by outcome' "$reports/$name.out" | tr '\n' ';')"
  if [ -f "$here/merge.ts" ]; then
    bun "$here/merge.ts" "$reports" "$here/observed" > "$work/merge.log" 2>&1 || echo "merge.ts failed: $(tail -1 "$work/merge.log")"
    /workspace/tools/save-notes "conformance: lint-survey bottom-up: sweep chunk $name" > /dev/null 2>&1 || true
  fi
}

chunk 1-upper-a-b '2*' 'A*' 'C*' 'D*' 'E*' 'F*' 'I*' 'M*' 'N*' 'P*' 'T*' 'V*' 'Y*' 'a*' 'b*'
chunk 2-c 'c*'
chunk 3-d-f-g 'd*' 'f*' 'g*'
chunk 4-e-h-k-l-q 'e*' 'h*' 'k*' 'l*' 'q*'
chunk 5-i-j 'i*' 'j*'
chunk 6-m-n-o 'm*' 'n*' 'o*'
chunk 7-p-r 'p*' 'r*'
chunk 8-s-u-v-w-y 's*' 'u*' 'v*' 'w*' 'y*'
chunk 9-t 't*'
echo "### sweep finished $(date -u +%FT%TZ)"

if [ -f "$here/raw.ts" ] && [ ! -s "$work/raw.jsonl" ]; then
  start=$(date +%s)
  bun "$here/raw.ts" --scratch "$scratch" --bin "$bin" --from "$here/observed/instances.tsv" --out "$work/raw.jsonl.tmp" --jobs 4 \
    --keep "$work/kept" \
    > "$work/raw.log" 2>&1
  rc=$?
  if [ $rc -eq 0 ]; then mv "$work/raw.jsonl.tmp" "$work/raw.jsonl"; fi
  echo "raw.ts: exit $rc, $(($(date +%s) - start)) s, $(tail -1 "$work/raw.log")"
fi
echo "### finished $(date -u +%FT%TZ)"
