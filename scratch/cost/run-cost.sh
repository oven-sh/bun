#!/bin/bash
# Scratch. Counts the instructions that lsquic_stream.o executes for whole HTTP/3 messages.
# usage: run-cost.sh <lsquic_stream.c> <label>
# Needs: /tmp/work/u/build-base-asserts (run-cases.sh), /tmp/work/u/cost/flags.txt (the release flags of lsquic_stream.c,
# without LTO), /tmp/work/u/cases.c, cost-cases.c and icount.c next to this script.
set -euo pipefail
HERE=$(dirname "$(readlink -f "$0")")
CC=${CC:-/usr/lib/llvm-23/bin/clang}
SRC=$(readlink -f "$1"); LABEL=$2
U=/tmp/work/u; B=$U/build-base-asserts
W=$U/build-cost-$LABEL; rm -rf "$W"; mkdir -p "$W/tests"
for o in "$B"/*.o; do case $o in */lsquic_stream.o|*/test.o|*/stubs.o) ;; *) cp "$o" "$W/" ;; esac; done
bash -c "$(cat $U/cost/flags.txt) -c $SRC -o $W/lsquic_stream.o"
cp "$U/base/tests/test_h3_framing.c" "$W/tests/"
python3 - "$W/tests/test_h3_framing.c" "$HERE/cost-cases.c" <<'PY'
import sys
path, cost = sys.argv[1:3]
src = open(path).read()
anchor = "int\nmain (int argc, char **argv)\n"
assert src.count(anchor) == 1
src = src.replace(anchor, open(cost).read() + "\n\n" + anchor)
hook = "    init_test_ctl_settings(&g_ctl_settings);\n\n    if (fuzz_hq_framing_input)\n"
assert src.count(hook) == 1
src = src.replace(hook, """    init_test_ctl_settings(&g_ctl_settings);

    if (getenv("BUN_COST_KIND"))
    {
        cost_workload();
        return 0;
    }

    if (fuzz_hq_framing_input)
""")
open(path, "w").write(src)
PY
$CC @"$B/flags.rsp" "$W/tests/test_h3_framing.c" -o "$W/test.o"
$CC -no-pie -o "$W/cost" "$W"/*.o -Wl,--gc-sections -lm -lpthread 2> "$W/link1.err" || true
grep -o "undefined reference to \`[A-Za-z0-9_]*'" "$W/link1.err" | sed "s/.*\`//; s/'//" | sort -u > "$W/undef.txt"
{
  echo '#include <stdint.h>'; echo '#include <stdlib.h>'; echo '#include <stdio.h>'
  echo 'int RAND_bytes(uint8_t *buf, size_t len) { while (len--) *buf++ = (uint8_t) rand(); return 1; }'
  echo 'int SSL_get_ex_new_index(long a, void *b, void *c, void *d, void *e) { return 1; }'
  echo 'int SSL_CTX_get_ex_new_index(long a, void *b, void *c, void *d, void *e) { return 1; }'
  echo 'void CRYPTO_library_init(void) { }'
  grep -v "^RAND_bytes$\|^SSL_get_ex_new_index$\|^SSL_CTX_get_ex_new_index$\|^CRYPTO_library_init$" "$W/undef.txt" | sed 's/.*/void &(void) { fprintf(stderr, "stub called: &\\n"); abort(); }/'
} > "$W/stubs.c"
$CC -w -c "$W/stubs.c" -o "$W/stubs.o"
$CC -no-pie -o "$W/cost" "$W"/*.o -Wl,--gc-sections -Wl,-Map="$W/map.txt" -lm -lpthread
python3 - "$W/map.txt" "$W/lsquic_stream.o" > "$W/ranges.txt" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
obj = sys.argv[2]
n = 0
for m in re.finditer(r'^ (\.text\S*)\s*\n?\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(\S+)$', text, re.M):
    # The sections that the link dropped are listed too, at address 0.
    if m.group(4) == obj and int(m.group(3), 16) > 0 and int(m.group(2), 16) > 0:
        lo = int(m.group(2), 16)
        print("%x %x" % (lo, lo + int(m.group(3), 16)))
        n += 1
assert n > 50, n
PY
[ -x "$U/cost/icount" ] || $CC -O2 -o "$U/cost/icount" "$HERE/icount.c"
echo "[$LABEL] ranges: $(wc -l < "$W/ranges.txt"), bytes: $(awk '{ s += strtonum("0x" $2) - strtonum("0x" $1) } END { print s }' "$W/ranges.txt")"
