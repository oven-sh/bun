#!/bin/sh
# Full differential: 97 shapes, root and nobody, umask 022 and 000.
cd /tmp/arc/diff
B=/tmp/arc/bun-system-367d939d9
P=/workspace/bun/build/debug/bun-debug
python3 drive.py /tmp/arc/diff/cases8 $B $P > r9-root-022.txt 2> r9-root-022.err
DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $B $P > r9-root-000.txt 2> r9-root-000.err
python3 drive.py /tmp/arc/diff/cases8 $B $P --user nobody > r9-nobody-022.txt 2> r9-nobody-022.err
DIFF_UMASK=000 python3 drive.py /tmp/arc/diff/cases8 $B $P --user nobody > r9-nobody-000.txt 2> r9-nobody-000.err
echo done > r9.done
