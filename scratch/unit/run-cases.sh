#!/bin/sh
# Scratch. Builds tests/test_h3_framing.c of a bun-patched lsquic tree (mktree.sh) with the four unit cases of
# /tmp/work/u/cases.c and runs them. What the link does not find is stubbed with abort(): the cases never get there.
# usage: run-cases.sh <lsquic tree> <label> [cflags for lsquic_stream.c only]
#   REUSE=<build dir of another label>: every object but lsquic_stream.o comes from there.
set -e
CC=${CC:-clang}
T=$(readlink -f "$1"); LABEL=$2; X=${3:-}
BUN=/tmp/recut/bun; V=$BUN/vendor
W=/tmp/work/u/build-$LABEL; rm -rf "$W"; mkdir -p "$W/tests"
cp "$T/tests/test_h3_framing.c" "$W/tests/"
python3 - "$W/tests/test_h3_framing.c" <<'PY'
import sys
path = sys.argv[1]
src = open(path).read()
case = open("/tmp/work/u/cases.c").read()
anchor = "int\nmain (int argc, char **argv)\n"
assert src.count(anchor) == 1
src = src.replace(anchor, case + "\n\n" + anchor)
hook = "    init_test_ctl_settings(&g_ctl_settings);\n\n    if (fuzz_hq_framing_input)\n"
assert src.count(hook) == 1
src = src.replace(hook, """    init_test_ctl_settings(&g_ctl_settings);

    if (getenv("BUN_CASE"))
    {
        switch (atoi(getenv("BUN_CASE")))
        {
        case 23: test_waiting_headers_frame_respects_conn_cap(); break;
        case 24: test_waiting_headers_frame_respects_stream_window(); break;
        case 25: test_buffered_stream_is_flushed_when_conn_cap_is_used_up(); break;
        case 26: test_flush_respects_stream_window(); break;
        default: return 2;
        }
        return 0;
    }

    if (fuzz_hq_framing_input)
""")
open(path, "w").write(src)
PY
ZLIB=$(dirname "$(find $BUN/build -maxdepth 4 -name zlib.h -path '*deps/zlib*' | head -1)")
cat > "$W/flags.rsp" <<EOS
-O1 -g -w -c -I$T/include -I$T/src/liblsquic -I$V/boringssl/include -I$V/lshpack -I$V/lshpack/deps/xxhash -I$V/lsqpack -I$ZLIB
-DLSXPACK_MAX_STRLEN=4294967295 -DHAVE_BORINGSSL=1 "-DXXH_HEADER_NAME=\"xxhash.h\"" -DLS_QPACK_USE_LARGE_TABLES=1 -DLS_HPACK_BSS_LARGE_TABLES=1
"-DLSQPACK_ENC_LOGGER_HEADER=\"lsquic_qpack_enc_logger.h\"" "-DLSQPACK_DEC_LOGGER_HEADER=\"lsquic_qpack_dec_logger.h\""
-DLSQUIC_DEBUG_NEXT_ADV_TICK=0 -DLSQUIC_CONN_STATS=1 -DLSQUIC_QIR=0 -DLSQUIC_WEBTRANSPORT_SERVER_SUPPORT=0 -DLSQUIC_TEST=1
-ffunction-sections -fdata-sections
EOS
SRCS=$(sed -n '/^const liblsquic/,/^];/p' "$BUN/scripts/build/deps/lsquic.ts" | grep -o '"[^"]*\.c"' | tr -d '"' | sed "s|^|$T/src/liblsquic/|")
for f in $SRCS "$V/lsqpack/lsqpack.c" "$V/lshpack/lshpack.c" "$V/lshpack/deps/xxhash/xxhash.c"; do
  case $f in */lsquic_stream.c) x=$X ;; *) x= ;; esac
  echo "$CC @$W/flags.rsp $x $f -o $W/$(basename "$f" .c).o"
done > "$W/cmds.txt"
if [ -n "${REUSE:-}" ]; then
  for o in "$REUSE"/*.o; do case $o in */lsquic_stream.o|*/test.o|*/stubs.o) ;; *) cp "$o" "$W/" ;; esac; done
  grep "/lsquic_stream.c " "$W/cmds.txt" > "$W/cmds1.txt"; mv "$W/cmds1.txt" "$W/cmds.txt"
fi
xargs -P 8 -I{} sh -c '{} || echo "COMPILE FAILED: {}" >&2' < "$W/cmds.txt" 2> "$W/compile.err" || true
if grep -q "COMPILE FAILED" "$W/compile.err"; then grep -B3 "COMPILE FAILED" "$W/compile.err" | head -40; exit 1; fi
$CC @"$W/flags.rsp" "$W/tests/test_h3_framing.c" -o "$W/test.o"
$CC -o "$W/test_h3_framing" "$W"/*.o -Wl,--gc-sections -lm -lpthread 2> "$W/link1.err" || true
grep -o "undefined reference to \`[A-Za-z0-9_]*'\|undefined symbol: [A-Za-z0-9_]*" "$W/link1.err" | sed "s/.*[\`: ]//; s/'//" | sort -u > "$W/undef.txt"
{
  echo '#include <stdint.h>'; echo '#include <stdlib.h>'; echo '#include <stdio.h>'
  echo 'int RAND_bytes(uint8_t *buf, size_t len) { while (len--) *buf++ = (uint8_t) rand(); return 1; }'
  echo 'int SSL_get_ex_new_index(long a, void *b, void *c, void *d, void *e) { return 1; }'
  echo 'int SSL_CTX_get_ex_new_index(long a, void *b, void *c, void *d, void *e) { return 1; }'
  echo 'void CRYPTO_library_init(void) { }'
  grep -v "^RAND_bytes$\|^SSL_get_ex_new_index$\|^SSL_CTX_get_ex_new_index$\|^CRYPTO_library_init$" "$W/undef.txt" | sed 's/.*/void &(void) { fprintf(stderr, "stub called: &\\n"); abort(); }/'
} > "$W/stubs.c"
$CC -w -c "$W/stubs.c" -o "$W/stubs.o"
$CC -o "$W/test_h3_framing" "$W"/*.o -Wl,--gc-sections -lm -lpthread
for c in 23 24 26 25; do
  if BUN_CASE=$c "$W/test_h3_framing" > /dev/null 2> "$W/case$c.err"; then echo "[$LABEL] case $c: ok"
  else echo "[$LABEL] case $c: rc=$? $(grep -o "Assertion.*\|stub called.*" "$W/case$c.err" | head -1)"; fi
done
