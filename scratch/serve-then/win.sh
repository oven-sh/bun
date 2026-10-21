#!/bin/bash
# Usage: win.sh <bun-profile> <script> <mode> [symbol-substring] [first] [last] [protocol]
# Prints the instructions of the main thread from the entry of the symbol to its return, for hits first..last. JIT off.
BIN=$1; SCRIPT=$2; MODE=$3
SYM=${4:-"bun_runtime::server::trampoline::on_request::<false, false>"}
FIRST=${5:-20}; LAST=${6:-29}; PROTO=${7:-h1}
N=$((LAST + 3))
[ -f "$BIN.syms" ] || nm -C "$BIN" > "$BIN.syms" 2>/dev/null
ADDR=$(grep -F " $SYM" "$BIN.syms" | head -1 | cut -d' ' -f1)
[ -n "$ADDR" ] || { echo "symbol not found: $SYM"; exit 1; }
OUT=$(mktemp)
BUN_JSC_useJIT=${USE_JIT:-0} BENCH_PROTO=$PROTO /tmp/measure/iwindow "$ADDR" "$FIRST" "$LAST" -- "$BIN" "$SCRIPT" "$MODE" "$N" > "$OUT.port" 2> "$OUT.err" &
PID=$!
PORT=""
for i in $(seq 1 300); do PORT=$(grep -E '^[0-9]+$' "$OUT.port" | head -1); [ -n "$PORT" ] && break; sleep 0.1; done
if [ -z "$PORT" ]; then echo "no port"; tail -5 "$OUT.err"; kill $PID 2>/dev/null; exit 1; fi
for i in $(seq 1 "$N"); do
  if [ "$PROTO" = "h2" ]; then curl -sk --http2-prior-knowledge -m 20 -o /dev/null -w "%{http_code} " "http://127.0.0.1:$PORT/" >> "$OUT.codes";
  else curl -s -m 20 -o /dev/null -w "%{http_code} " "http://127.0.0.1:$PORT/" >> "$OUT.codes"; fi
done
wait $PID
echo "codes: $(tr ' ' '\n' < "$OUT.codes" | sort | uniq -c | tr '\n' ' ')"
grep WINDOW "$OUT.err" | grep instructions | awk '{print $3}' | cut -d= -f2 | tr '\n' ' '; echo
rm -f "$OUT" "$OUT.port" "$OUT.err" "$OUT.codes"
