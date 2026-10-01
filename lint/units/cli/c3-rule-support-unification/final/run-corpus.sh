#!/bin/sh
# Every report of ESLint's eleven rules against the probe over real files. usage: sh run-corpus.sh   (cwd: the worktree)
cd /workspace/wt/cli
for f in /tmp/c3final/corpus/nm.* /workspace/notes/lint/units/cli/rule-support-unification-bottomup/logs/corpus-big.list; do
  echo "== $f"
  ASAN_OPTIONS=detect_leaks=0 node --max-old-space-size=6000 /tmp/c3final/oracle/corpus.cjs --probe /tmp/c3final/out/lintprobe "$f"
done
