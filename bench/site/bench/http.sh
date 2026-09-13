#!/bin/bash
# Express hello world over HTTPS (bench/express/express-tls.mjs; bombardier -k -c 50 -d 5s x RUNS after a 3s warmup) for
# bun / bun-release / node / deno, plus plaintext express and the native servers (Bun.serve, node:https, Deno.serve) over
# TLS and plaintext as context. Server CPU = /proc utime+stime over the measured window; peak RSS = VmHWM.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
CERTS=$S/certs; mkdir -p "$CERTS"
[ -f "$CERTS/cert.pem" ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "$CERTS/key.pem" -out "$CERTS/cert.pem" -days 365 -subj "/CN=localhost" 2>/dev/null
export TLS_CERT=$CERTS/cert.pem TLS_KEY=$CERTS/key.pem
EX=$BENCH_DIR/express; SV=$SITE_DIR/servers
RES=$OUT/http.txt; : > "$RES"
DUR=${DUR:-5s}
# run <label> <scheme> <cwd> <cmd...>   -- the server must print "... port <n>" once listening
run() { local label=$1 scheme=$2 dir=$3; shift 3
  : > "$TMP/http.log"
  ( cd "$dir" && PORT=0 "$@" > "$TMP/http.log" 2>&1 ) & local SRV=$!
  local PORT=""; for i in $(seq 1 60); do PORT=$(sed -nE 's/.* port ([0-9]+).*/\1/p' "$TMP/http.log" | head -1); [ -n "$PORT" ] && [ "$PORT" != 0 ] && break; sleep 0.25; done
  # the subshell above is $SRV; the runtime is its child, which is what /proc accounting must look at
  local PID=$(pgrep -P $SRV | head -1); [ -z "$PID" ] && PID=$SRV
  if [ -z "$PORT" ] || [ "$PORT" = 0 ]; then echo "$label $scheme FAILED_TO_START: $(head -3 "$TMP/http.log" | tr '\n' ' ')" | tee -a "$RES"; kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; return; fi
  local KFLAG=""; [ $scheme = https ] && KFLAG=-k
  bombardier $KFLAG -c 50 -d 3s -l $scheme://localhost:$PORT > /dev/null 2>&1
  local c0=$(cpu_ticks $PID) t0=$(date +%s.%N) res=""
  for r in $(seq 1 $RUNS); do
    res="$res $(bombardier $KFLAG -c 50 -d $DUR -l -H "Accept-Encoding: identity" $scheme://localhost:$PORT 2>&1 | grep -oE "Reqs/sec +[0-9.]+" | awk '{printf "%d", $2}')"
  done
  local c1=$(cpu_ticks $PID) t1=$(date +%s.%N)
  local cpu=$(awk -v a=$c0 -v b=$c1 -v t0=$t0 -v t1=$t1 'BEGIN{printf "%.0f", (b-a)/100/(t1-t0)*100}')
  printf "%-34s %-5s req/s:%s   server_cpu=%s%%   peak_rss=%sMB\n" "$label" "$scheme" "$res" "$cpu" "$(peak_rss_mb $PID)" | tee -a "$RES"
  kill $PID $SRV 2>/dev/null; wait $SRV 2>/dev/null; sleep 1
}
echo "############ EXPRESS (HTTPS)" | tee -a "$RES"
run "express $BUN_LABEL"          https "$EX" $BUN ./express-tls.mjs
run "express $BUN_RELEASE_LABEL"  https "$EX" $BUN_RELEASE ./express-tls.mjs
run "express $NODE_LABEL"         https "$EX" $NODE ./express-tls.mjs
run "express $DENO_LABEL"         https "$EX" $DENO run -A ./express-tls.mjs
echo "############ EXPRESS (plaintext, context)" | tee -a "$RES"
run "express $BUN_LABEL"          http  "$EX" $BUN ./express.mjs
run "express $NODE_LABEL"         http  "$EX" $NODE ./express.mjs
run "express $DENO_LABEL"         http  "$EX" $DENO run -A ./express.mjs
echo "############ NATIVE SERVERS (TLS)" | tee -a "$RES"
run "Bun.serve $BUN_LABEL"          https "$SV" $BUN bunserve-tls.js
run "Bun.serve $BUN_RELEASE_LABEL"  https "$SV" $BUN_RELEASE bunserve-tls.js
run "node:https $NODE_LABEL"        https "$SV" $NODE nodehttps.js
run "Deno.serve $DENO_LABEL"        https "$SV" $DENO run -A denoserve-tls.js
echo "############ NATIVE SERVERS (plaintext, context)" | tee -a "$RES"
run "Bun.serve $BUN_LABEL"          http  "$SV" $BUN bunserve.js
run "Bun.serve $BUN_RELEASE_LABEL"  http  "$SV" $BUN_RELEASE bunserve.js
run "node:http $NODE_LABEL"         http  "$SV" $NODE nodehttp.js
run "Deno.serve $DENO_LABEL"        http  "$SV" $DENO run -A denoserve.js
echo HTTP_DONE | tee -a "$RES"
