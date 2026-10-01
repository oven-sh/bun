#!/bin/bash
# Checks every artifact that the research findings of the parser unit cite against the disk, and the facts
# about binaries that the findings state. Prints a tab-separated table: group, path, state, detail.
# state: present | absent. detail: files and bytes of a directory, sha256 of a binary, tracked files in the notes.
# usage: check-artifacts.sh > artifacts.tsv
N=/workspace/notes/lint/units/parser
row() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"; }
check() {
  local group=$1 p=$2
  if [ -d "$p" ]; then
    local files bytes tracked=""
    files=$(find "$p" -type f 2>/dev/null | wc -l)
    bytes=$(du -sb "$p" 2>/dev/null | cut -f1)
    case "$p" in /workspace/notes/*) tracked=", tracked in the notes: $(git -C /workspace/notes ls-files -- "$p" 2>/dev/null | wc -l)" ;; esac
    row "$group" "$p" present "directory, $files files, $bytes bytes$tracked"
  elif [ -f "$p" ]; then
    local tracked=""
    case "$p" in /workspace/notes/*) tracked=", tracked in the notes: $(git -C /workspace/notes ls-files -- "$p" 2>/dev/null | wc -l)" ;; esac
    row "$group" "$p" present "file, $(stat -c %s "$p") bytes$tracked"
  else
    row "$group" "$p" absent ""
  fi
}
printf 'group\tpath\tstate\tdetail\n'
# Cited by the findings that name 8965734d5 as the installed binary (the other machine state).
for p in probe.mjs upstream-verdicts.json results make_rows.mjs metadata_tags.mjs typescript-grammar.test.template.ts existing-tests upstream \
  inputs/type-forms inputs/object-types inputs/expressions inputs/signatures inputs/class-members inputs/module-syntax \
  type-grammar-core members-params-args decorator-metadata type-nodes lexer-comments lint-entry diag-codes \
  area-expressions area-functions-classes area-statements-modules; do
  check "other machine state: probes" "$N/probes/$p"
done
for p in "$N/tools" "$N/verify" "$N/base" /workspace/notes/lint/measure/pr2 /workspace/notes/lint/measure/pr2/bun.pr2b \
  /workspace/notes/lint/measure/pr2/bun-profile.pr2b /tmp/rr/bin/tsgo /tmp/lexprobe /tmp/parser-bootstrap /tmp/sidecar-research; do
  check "other machine state: tools and binaries" "$p"
done
# What this machine has.
for p in probes/run.mjs probes/report.mjs probes/clusters.mjs probes/digest.mjs probes/strict.mjs probes/metadata.mjs probes/candidates.mjs \
  probes/existing-tests.mjs probes/existing-errors.mjs probes/existing-accepts.mjs probes/inputs probes/out probes/out/raw probes/top-down \
  probes/outside-type-grammar grammar-diff measure measure/base/bin measure/base/grammar-diff measure/base/cg-b lexer-lint-hooks \
  sidecar-core sidecar-erased-statements sidecar-inline-drops-wrappers sidecar-skip-call-sites build-sink build-sink-positions \
  type-nodes-layout lint-entry-probe api-contract-top-down ledger/rescued-tmp ledger/bottom-up/tmp-rescue ledger/bottom-up/corpus \
  ledger/bottom-up/tsgo-oracle ledger/bottom-up/pins; do
  check "this machine: notes of the parser unit" "$N/$p"
done
for p in /workspace/notes/lint/tools/symsizes.py /workspace/notes/lint/tools/cgbench.sh /workspace/notes/lint/tools/cgsum.py /workspace/notes/lint/benchroot \
  /workspace/tools/vg /workspace/tools/valgrind/bin/valgrind /workspace/notes/lint/design /workspace/notes/lint/parser-inventory /workspace/notes/lint/port-map \
  /workspace/ref/typescript-go /tmp/rr/go126/bin/go /tmp/rr/deps /tmp/rr/dumpast /tmp/rr/parsediag-bu; do
  check "this machine: shared tools" "$p"
done
for p in /tmp/gct1a-42866 /tmp/otg_bottomup_7f3k /tmp/sidecar-probe /tmp/lint-entry-probe /tmp/sidl /tmp/lexhooks /tmp/tsnodes /tmp/gte /tmp/gte-probe \
  /tmp/gotg /tmp/gotg1b /tmp/parser-research /tmp/tsprobe /tmp/sidecar-oracle /tmp/sidecar-wrappers-probe /tmp/erased-bu-7f3a /tmp/erased-probe \
  /tmp/erased-research /tmp/parser-base /tmp/parser-probe; do
  check "this machine: scratch in /tmp (lost at a restart)" "$p"
done
# Binaries: identity by sha256, never by the revision stamp alone.
bin() {
  local group=$1 p=$2
  if [ -x "$p" ]; then
    row "$group" "$p" present "sha256 $(sha256sum "$p" | cut -d' ' -f1), $(stat -c %s "$p") bytes, reports $("$p" --revision 2>/dev/null | head -1)"
  else
    row "$group" "$p" absent ""
  fi
}
bin "binary: installed (bun on PATH)" "$(readlink -f "$(command -v bun)")"
bin "binary: base release of the worktree" /workspace/wt/parser/build/release/bun
bin "binary: base release, copy in the notes (git-ignored)" "$N/measure/base/bin/bun"
bin "binary: base profile of the worktree" /workspace/wt/parser/build/release/bun-profile
bin "binary: base profile, copy in the notes (git-ignored)" "$N/measure/base/bin/bun-profile"
if [ -x /workspace/wt/parser/build/debug/bun-debug ]; then
  row "binary: debug build of the worktree" /workspace/wt/parser/build/debug/bun-debug present "sha256 $(sha256sum /workspace/wt/parser/build/debug/bun-debug | cut -d' ' -f1), pinned revision $(cat /workspace/wt/parser/build/debug/git-revision 2>/dev/null)"
else
  row "binary: debug build of the worktree" /workspace/wt/parser/build/debug/bun-debug absent ""
fi
row "git" "/workspace/wt/parser HEAD" "$(git -C /workspace/wt/parser rev-parse HEAD)" "branch $(git -C /workspace/wt/parser branch --show-current), $(git -C /workspace/wt/parser status --porcelain | wc -l) changed files"
for c in 8965734d5 367d939d9 2d28b35c01 36cd1514e e3566be889; do
  if git -C /workspace/wt/parser cat-file -e "$c^{commit}" 2>/dev/null; then
    row "git" "commit $c" present "$(git -C /workspace/wt/parser log -1 --format='%h %s' "$c" | cut -c1-100)"
  else
    row "git" "commit $c" absent "not an object of the repository"
  fi
done
row "git" "notes HEAD" "$(git -C /workspace/notes rev-parse --short HEAD)" "origin $(git -C /workspace/notes rev-parse --short origin/robobun/abbc0c92/lint-notes 2>/dev/null)"
