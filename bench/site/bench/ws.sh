#!/bin/bash
# WebSocket chat (bench/websocket-server), closed loop: 32 sockets split across K client processes (always run under
# bun-release), every server offered the identical bounded workload. Reports msgs/s summed over the client processes
# (samples 2-10), server CPU (/proc utime+stime over an 8s window) and peak RSS.
# Rows: bun publish(), bun send()-loop (servers/chat-server.bun-send.js), bun-release publish(), node ws, Deno.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
W=$BENCH_DIR/websocket-server; cd "$W"
K=${K:-4}; TOTAL=32; PER=$((TOTAL/K))
RES=$OUT/ws.txt; : > "$RES"
# every server prints "Waiting for <n> clients to connect" once it is listening
run() { local name="$1"; shift
  : > "$TMP/ws-srv.log"
  CLIENTS_COUNT=$TOTAL "$@" > "$TMP/ws-srv.log" 2>&1 & local SRV=$!
  local up=""; for i in $(seq 1 60); do grep -q "Waiting for" "$TMP/ws-srv.log" && up=1 && break; kill -0 $SRV 2>/dev/null || break; sleep 0.25; done
  if [ -z "$up" ]; then echo "$name FAILED_TO_START: $(head -3 "$TMP/ws-srv.log" | tr '\n' ' ')" | tee -a "$RES"; kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; return; fi
  sleep 1
  local CP=""; for i in $(seq 1 $K); do CLIENTS_COUNT=$PER TOTAL_CLIENTS=$TOTAL timeout 120 $BUN_RELEASE ./chat-client.mjs > "$TMP/ws-c$i.log" 2>&1 & CP="$CP $!"; done
  sleep 2
  local c0=$(cpu_ticks $SRV) t0=$(date +%s.%N); sleep 8; local c1=$(cpu_ticks $SRV) t1=$(date +%s.%N)
  local cpu=$(awk -v a=$c0 -v b=$c1 -v t0=$t0 -v t1=$t1 'BEGIN{printf "%.0f", (b-a)/100/(t1-t0)*100}')
  local timed_out=""; for p in $CP; do wait $p 2>/dev/null; [ $? = 124 ] && timed_out=1; done
  [ -n "$timed_out" ] && echo "$name CLIENTS_TIMED_OUT (server: $(tail -1 "$TMP/ws-srv.log"))" | tee -a "$RES"
  local hwm=$(peak_rss_mb $SRV) sum=0 n=0
  for i in $(seq 1 $K); do m=$(sed -n "s/ messages per second.*//p" "$TMP/ws-c$i.log" | sed -n "2,10p" | awk '{s+=$1;n++} END {if(n) printf "%d", s/n; else print 0}'); sum=$((sum+m)); n=$((n+$(sed -n "s/ messages per second.*//p" "$TMP/ws-c$i.log" | wc -l))); done
  printf "%-40s msgs/s=%9d   server_cpu=%3s%%   peak_rss=%sMB   (client_samples=%s)\n" "$name" "$sum" "$cpu" "$hwm" "$n" | tee -a "$RES"
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; pkill -f "chat-client.mjs" 2>/dev/null; sleep 1
}
for rep in $(seq 1 $RUNS); do
  echo "== rep $rep" | tee -a "$RES"
  run "$BUN_LABEL publish()"              $BUN ./chat-server.bun.js
  run "$BUN_LABEL send()-loop"            $BUN "$SITE_DIR/servers/chat-server.bun-send.js"
  run "$BUN_RELEASE_LABEL publish()"      $BUN_RELEASE ./chat-server.bun.js
  run "$NODE_LABEL ws"                    $NODE ./chat-server.node.mjs
  run "$DENO_LABEL Deno.upgradeWebSocket" $DENO run -A ./chat-server.deno.mjs
done
echo WS_DONE | tee -a "$RES"
