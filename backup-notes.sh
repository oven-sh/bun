#!/bin/bash
# Pushes the scratch notes of this session to refs/backup/robobun-cf2a0e8e-notes (not a branch).
cd /workspace/bun
tmp=$(mktemp)
for f in /tmp/draft/HANDOFF.md /tmp/draft/selfreview-result.json /tmp/draft/design-result.json /tmp/draft/pr_body_final.md /tmp/draft/measurements.md /tmp/draft/pr_body.md /tmp/draft/backup-notes.sh /tmp/design.json /tmp/fuzz/fuzz.ts /tmp/oracle/proto3.ts /tmp/insn/measure.sh /tmp/insn/measure-fn.sh /tmp/insn/count.c /tmp/insn/hist.c /tmp/insn/gen.py /tmp/insn/allocs-raw.sh /tmp/insn/sys.sh /tmp/insn/run-set3.sh /tmp/draft/make_body.py /tmp/draft/pr_notes.md /tmp/fx/build-all.sh /tmp/fx/fxdiff.py /tmp/try/run.ts /tmp/try/batch.ts /tmp/flood/cnt.sh; do
  [ -f "$f" ] || continue
  h=$(git hash-object -w "$f")
  printf '100644 blob %s\t%s\n' "$h" "$(basename $f)" >> $tmp
done
tree=$(git mktree < $tmp)
c=$(git commit-tree $tree -m "scratch notes for robobun cf2a0e8e (not for merge)")
git push -f origin $c:refs/backup/robobun-cf2a0e8e-notes 2>&1 | tail -1
rm -f $tmp
