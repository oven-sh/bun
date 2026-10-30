#!/bin/bash
# usage: probe-curl.sh <bun binary> [requests=60] [linkBytes=3000]
# Starts probe-server.mjs with that binary, sends <requests> parallel GETs with curl-h3 on one
# connection, and prints how many got which result.
set -u
bin=${1:?bun binary}
n=${2:-60}
link=${3:-3000}
dir=$(dirname "$0")
out=$(mktemp)
BUN_DEBUG_QUIET_LOGS=1 "$bin" "$dir/probe-server.mjs" "$link" 200 >"$out" 2>/dev/null &
pid=$!
port=""
for _ in $(seq 200); do
  port=$(grep -o '"port":[0-9]*' "$out" | head -1 | cut -d: -f2)
  [ -n "$port" ] && break
  sleep 0.1
done
if [ -z "$port" ]; then echo "server did not start"; kill "$pid" 2>/dev/null; exit 1; fi
cfg=$(mktemp)
for i in $(seq "$n"); do
  printf 'url = "https://localhost:%s/%s"\noutput = "/dev/null"\n' "$port" "$i" >>"$cfg"
done
/usr/bin/curl-h3 -4 --http3-only -k -s --parallel --parallel-max "$n" --max-time 30 \
  -w '%{http_code} %{exitcode} %{errormsg}\n' -K "$cfg" 2>/dev/null | sort | uniq -c | sort -rn
kill -TERM "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
grep refused "$out"
rm -f "$cfg" "$out"
