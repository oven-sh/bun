#!/bin/sh
# Differential on the rebased head (57f178a0f4 tree). B: kernel arm against walk. A: main against PR (needs /tmp/arc/bun-main-debug).
cd /tmp/arc/diff
M=/tmp/arc/bun-main-debug
P=/tmp/arc/bun-pr-debug2
W=/tmp/arc/diff/bun-walk.sh
case "$1" in
A)
  python3 drive.py /tmp/arc/diff/cases8 $M $P --user nobody > r13-nobody-022.txt 2> r13-nobody-022.err
  python3 drive.py /tmp/arc/diff/cases8 $M $P > r13-root-022.txt 2> r13-root-022.err
  DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $M $P --user nobody > r13-nobody-000.txt 2> r13-nobody-000.err
  DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $M $P > r13-root-000.txt 2> r13-root-000.err
  date -u > r13-A.done
  ;;
B)
  python3 drive.py /tmp/arc/diff/cases8 $P $W --user nobody > r13-walk-nobody-022.txt 2> r13-walk-nobody-022.err
  python3 drive.py /tmp/arc/diff/cases8 $P $W > r13-walk-root-022.txt 2> r13-walk-root-022.err
  date -u > r13-B.done
  ;;
esac
