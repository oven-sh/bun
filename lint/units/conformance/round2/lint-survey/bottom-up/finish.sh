#!/usr/bin/env bash
# usage: finish.sh [scratch clone] [work directory] [directory for the results, default: the directory of this script]
# After sweep-chunks.sh has ended: merges the reports, makes the tables of observed/, holds the debug build against the
# raw runs of a release build where that file is there, and writes CRASHES.md and LOG.entry.txt. It starts no process
# of the binary under test. The log of the driver is <work directory>/driver.log.
# Exit code 3: the driver has not written its last line, nothing is made.
# DERIVED="<binary and where its raw runs are from>": the work directory was made by from-release-raw.py and no sweep
# ran; the heads of CRASHES.md and LOG.entry.txt then say so.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
scratch=${1:-/tmp/ls1a-scratch}
work=${2:-/tmp/ls1a}
out=${3:-$here}
# The survey of the release build of the same sources, to hold this one against.
release=${RELEASE_SURVEY:-$here/release/observed}
log=$work/driver.log
if ! grep -q '^### finished' "$log" 2> /dev/null; then
  echo "finish.sh: the driver has not ended: $(tail -1 "$log" 2> /dev/null || echo "no $log")"
  exit 3
fi
if [ ! -s "$work/raw.jsonl" ]; then
  echo "finish.sh: $work/raw.jsonl is missing: $(cat "$work/raw.log" 2> /dev/null | tail -2)"
  exit 3
fi
mkdir -p "$out/observed"
cp "$log" "$out/observed/driver.log"
bun "$here/merge.ts" "$work/reports" "$out/observed" > /dev/null
if [ ! -s "$out/observed/roots.tsv" ]; then bun "$here/roots.ts" "$scratch" "$out/observed/roots.tsv" > "$out/observed/roots.txt"; fi
cp "$work/raw.jsonl" "$out/observed/raw.jsonl"
bun "$here/tables.ts" "$out/observed" "$work/raw.jsonl" "$scratch" > "$out/observed/tables.txt"
leak=()
if [ -s "$work/raw-leak.jsonl" ]; then
  leak=(--leak "$work/raw-leak.jsonl")
  # Only what differs from the first raw pass is kept of the pass with the leak check.
  python3 - "$work/raw.jsonl" "$work/raw-leak.jsonl" > "$out/observed/raw-leak.txt" << 'EOF'
import json, sys
first = {json.loads(l)["name"]: json.loads(l) for l in open(sys.argv[1], encoding="utf8") if l.strip()}
leak = [json.loads(l) for l in open(sys.argv[2], encoding="utf8") if l.strip()]
died = [r for r in leak if r.get("died")]
other = [r for r in leak if r["name"] in first and (r.get("stderr"), r.get("exitCode"), r.get("signal")) != (first[r["name"]].get("stderr"), first[r["name"]].get("exitCode"), first[r["name"]].get("signal"))]
print(f"runs with the leak check of CI: {len(leak)}; died {len(died)}; another exit code, signal or stderr than without it: {len(other)}")
for r in other[:50]:
    print(f"  {r['kind']} {r['name']} ({r['casePath']}): {r.get('died')}; exit code {r.get('exitCode')}, signal {r.get('signal')}")
    for line in (r.get("stderr") or "").split("\n")[:30]:
        print(f"      {line}")
EOF
fi
if [ -z "${DERIVED:-}" ] && [ -s "$release/instances.tsv" ] && [ -s "$release/raw.jsonl" ]; then
  python3 "$here/compare-release.py" "$out/observed/instances.tsv" "$work/raw.jsonl" "$release/instances.tsv" "$release/raw.jsonl" \
    > "$out/observed/compare-release.txt"
fi

acquired=$(sed -n 's/^### lock acquired \([^ ]*\).*/\1/p' "$log" | head -1)
finished=$(sed -n 's/^### finished \(.*\)/\1/p' "$log" | tail -1)
revision=$(sed -n 's/^### lock acquired .* bin \(.*\)/\1/p' "$log" | head -1)
commit=$(git -C "$scratch" rev-parse HEAD 2> /dev/null || echo unknown)
upstream=$(grep '^commit ' "$scratch/test/cli/lint/conformance/UPSTREAM" | awk '{print $2 " " substr($3, 1, 7)}' | paste -sd, - | sed 's/,/, /')
if [ -n "${DERIVED:-}" ]; then
  said=(
    --say "No sweep ran for this file, and nothing below \`src/\` was changed for it."
    --say ""
    --say "- Binary: $DERIVED."
    --say "- Corpus: $upstream, laid over a clone of \`$commit\` with \`sync.sh\`."
    --say "- Outcomes: the rules of the default check of that commit (\`check_bun_lint.ts\` readRun and toCheckResult, \`run.ts\` compare) applied by \`from-release-raw.py\` to what each process gave back: exit code, signal, stdout, stderr."
    --say "- The scripts and the tables are in \`round2/lint-survey/bottom-up/\` of these notes (\`HOWTO.txt\`)."
  )
  title="E4, numbers of a release build: \`bun --lint\` of $DERIVED, over every run instance of the corpus"
  how="No sweep: the outcomes are the rules of the default check of $commit applied by from-release-raw.py to the raw runs. Corpus: $upstream."
else
  said=(
    --say "Survey of $acquired to $finished, Linux x64. Nothing below \`src/\` was changed for it."
    --say ""
    --say "- Binary: the debug build of the worktree, \`$revision\` (debug assertions, AddressSanitizer with the defaults of the build: \`detect_stack_use_after_return=0:detect_leaks=0\`). The environment had \`ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0\`, and the default check adds \`BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1 BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1\`."
    --say "- Corpus: $upstream, laid over a clone of \`$commit\` with \`sync.sh\`."
    --say "- Sweep: \`sweep.ts\` of that commit as it is, the default check, \`--jobs 4 --timeout 120000\`, nine chunks by the first character of the instance name. Then every instance whose outcome was \`crash\` or \`timeout\` again with \`raw.ts\`, which keeps the exit code, the signal, stdout and stderr, and gives every root file to the command alone where the command died."
    --say "- The scripts and the tables are in \`round2/lint-survey/bottom-up/\` of these notes (\`HOWTO.txt\`)."
  )
  title="E4, the first numbers: \`bun --lint\` of $revision (debug build of the worktree) over every run instance of the corpus"
  how="When: $acquired to $finished (one hold of the heavy lock). Corpus: $upstream. Runner: sweep.ts and runner/ of $commit as they are, default check, --jobs 4 --timeout 120000, lists empty (--expectations round2/prototype/expectations.json). Script host: the installed bun."
fi
bun "$here/crashes-md.ts" "$out/observed" "$work/raw.jsonl" "$here/class-c-causes.tsv" "$out/CRASHES.md" "${leak[@]}" "${said[@]}" \
  > "$out/observed/crashes-md.txt"

{
  echo "$title"
  echo
  echo "$how"
  echo "The driver, the helpers, the tables and how to run them again: round2/lint-survey/bottom-up/ (HOWTO.txt)."
  echo
  sed 's/^/  /' "$log"
  echo
  sed -n '/^columns:/,$p' "$out/observed/survey.txt"
  echo
  echo "What Bun printed, from the raw runs of the instances whose outcome was crash or timeout (observed/codes.txt has every text):"
  sed -n '1,/^texts with quoted names/p' "$out/observed/codes.txt" | sed '$d' | sed 's/^/  /'
  echo
  echo "Instances with a JavaScript root (the only files that the rules read), observed/javascript.txt:"
  sed -n '1,/^instances with the code unsupported-extension/p' "$out/observed/javascript.txt" | sed 's/^/  /'
  echo
  echo "Crashes and hangs (CRASHES.md has each one):"
  sed -n '1,/^$/p' "$out/observed/died.txt" | sed 's/^/  /'
  grep -m1 '^raw runs that died' "$out/observed/died.txt" | sed 's/^/  /'
  if [ -s "$out/observed/raw-leak.txt" ]; then head -1 "$out/observed/raw-leak.txt" | sed 's/^/  /'; fi
  echo
  echo "Class C instances where Bun prints a diagnostic and TypeScript none (CRASHES.md, last section, for the parser unit):"
  sed -n '1p;4,/^$/p' "$out/observed/class-c-diagnostics.txt" | sed 's/^/  /'
  if [ -s "$out/observed/compare-release.txt" ]; then
    echo "This build (here) against the release build of the same src/ (there: release/ of round2/lint-survey/bottom-up), observed/compare-release.txt:"
    head -40 "$out/observed/compare-release.txt" | sed 's/^/  /'
    echo
  fi
  echo "expectations.json: no name enters. No instance of class E passes (the command prints no code of TypeScript: every"
  echo "line of Bun's parser has the code syntax), and plan() of runner/expectations.ts lets list C hold as many names of a"
  echo "directory as list E holds, so every class C pass is refused with the reason quota. The lists stay"
  echo '{ "level": "baseline", "E": [], "C": [] }.'
} > "$out/LOG.entry.txt"
cat "$out/observed/crashes-md.txt"
echo "finish.sh: wrote $out/CRASHES.md, $out/LOG.entry.txt and $out/observed/"
if [ "$out" = "$here" ]; then /workspace/tools/save-notes "conformance: lint-survey bottom-up: the survey of the debug build, CRASHES.md, LOG.entry.txt" | tail -1; fi
