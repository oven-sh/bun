#!/bin/sh
# Differential on f2dcbf60db (debug build). chain A: main (system bun 367d939d9) against the candidate.
# chain B: candidate with the kernel arm against candidate with the walk.
cd /tmp/arc/diff
B=/workspace/bun/build/release/bun
P=/workspace/bun/build/debug/bun-debug
W=/tmp/arc/diff/bun-walk.sh
case "$1" in
A)
  python3 drive.py /tmp/arc/diff/cases8 $B $P --user nobody > r10-nobody-022.txt 2> r10-nobody-022.err
  DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $B $P > r10-root-000.txt 2> r10-root-000.err
  python3 drive.py /tmp/arc/diff/cases8 $B $P > r10-root-022.txt 2> r10-root-022.err
  DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $B $P --user nobody > r10-nobody-000.txt 2> r10-nobody-000.err
  date -u > r10-A.done
  ;;
B)
  python3 drive.py /tmp/arc/diff/cases8 $P $W > r10-walk-root-022.txt 2> r10-walk-root-022.err
  DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $P $W --user nobody > r10-walk-nobody-000.txt 2> r10-walk-nobody-000.err
  date -u > r10-B.done
  ;;
esac
