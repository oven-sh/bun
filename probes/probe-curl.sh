#!/bin/bash
# usage: [CLEAN=1] probe-curl.sh <bun binary> [requests=60] [linkBytes=3000]
# Starts probe-server.mjs with that binary, sends <requests> parallel GETs with curl-h3 on one
# connection, and prints how many got which result, then the server's own count.
#
# `000 7 Failed to connect` is NOT the header-queue bug. curl 8.19.0 with ngtcp2 1.21.0 sends its
# ClientHello as many out-of-order CRYPTO frames, and lsquic 4.9.4 closes a handshake that needs
# more than 10 stashed frames ("cannot stash more CRYPTO frames, at 10 already, while max is 10",
# CONNECTION_CLOSE with INTERNAL_ERROR; oven-sh/bun#47183 raises the limit). About half of curl's
# handshakes fail that way on the base too. The transfer that owned the attempt reports exit 7,
# and the transfers that waited for it go to curl's next connection.
# CLEAN=1 repeats the run (at most 30 times) until no transfer has exit code 7, so that all
# requests share the first connection, and prints how many runs it discarded.
set -u
bin=${1:?bun binary}
n=${2:-60}
link=${3:-3000}
dir=$(dirname "$0")

one_run() {
  local out cfg pid port
  out=$(mktemp)
  BUN_DEBUG_QUIET_LOGS=1 "$bin" "$dir/probe-server.mjs" "$link" 200 >"$out" 2>/dev/null &
  pid=$!
  port=""
  for _ in $(seq 600); do
    port=$(grep -o '"port":[0-9]*' "$out" | head -1 | cut -d: -f2)
    [ -n "$port" ] && break
    sleep 0.1
  done
  if [ -z "$port" ]; then echo "server did not start"; kill "$pid" 2>/dev/null; rm -f "$out"; return 1; fi
  cfg=$(mktemp)
  for i in $(seq "$n"); do
    printf 'url = "https://localhost:%s/%s"\noutput = "/dev/null"\n' "$port" "$i" >>"$cfg"
  done
  /usr/bin/curl-h3 -4 --http3-only -k -s --parallel --parallel-max "$n" --max-time 30 \
    -w '%{http_code} %{exitcode} %{errormsg}\n' -K "$cfg" 2>/dev/null |
    sed -E 's/stream [0-9]+/stream N/; s/port [0-9]+ after [0-9]+ ms/port P/' | sort | uniq -c | sort -rn
  kill -TERM "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  grep refused "$out"
  rm -f "$cfg" "$out"
}

if [ -z "${CLEAN:-}" ]; then
  one_run
  exit $?
fi
res=$(mktemp)
discarded=0
for _ in $(seq 30); do
  one_run >"$res" || { cat "$res"; rm -f "$res"; exit 1; }
  grep -q ' 000 7 ' "$res" || break
  discarded=$((discarded + 1))
done
cat "$res"
echo "discarded runs with a failed handshake: $discarded"
rm -f "$res"
