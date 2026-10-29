#!/bin/bash
# Scratch. usage: curl100.sh <bun binary> <number of POSTs> [with-download: 1|0] [one-way delay ms, 0 = no relay]
# Starts serve100.mjs, sends N POSTs with "Expect: 100-continue" on one HTTP/3 connection with stock curl
# (and one 5 MB GET beside them), and prints how the transfers ended.
BIN=$1; N=$2; DL=${3:-1}; DELAY=${4:-0}
D=/tmp/work/recut2; rm -f $D/serve100.port $D/relay.port
BUN_DEBUG_QUIET_LOGS=1 $BIN --no-warnings $D/probes/serve100.mjs 3000 > $D/serve100.port 2> $D/serve100.err < /dev/null &
SPID=$!
for i in $(seq 1 150); do [ -s $D/serve100.port ] && break; sleep 0.2; done
PORT=$(head -1 $D/serve100.port); RPID=
if [ "$DELAY" != 0 ]; then
  /workspace/bun/build/release/bun $D/probes/delay-relay.mjs $PORT $DELAY > $D/relay.port 2>/dev/null < /dev/null &
  RPID=$!
  for i in $(seq 1 50); do [ -s $D/relay.port ] && break; sleep 0.1; done
  PORT=$(head -1 $D/relay.port)
fi
if [ "$DL" = 1 ]; then
  timeout -k 5 90 curl -sk --http3-only --parallel --parallel-max 100 -o /dev/null -w 'GET %{http_code} %{size_download} %{errormsg}\n' "https://localhost:$PORT/big" \
    --next -sk --http3-only -H 'Expect: 100-continue' --data-binary @$D/post-body.txt -o /dev/null -w 'POST %{http_code} %{size_download} %{errormsg}\n' "https://localhost:$PORT/p[1-$N]" > $D/curl.out 2>&1
else
  timeout -k 5 90 curl -sk --http3-only --parallel --parallel-max 100 -H 'Expect: 100-continue' --data-binary @$D/post-body.txt -o /dev/null -w 'POST %{http_code} %{size_download} %{errormsg}\n' "https://localhost:$PORT/p[1-$N]" > $D/curl.out 2>&1
fi
echo "curl rc=$?"
kill $SPID $RPID 2>/dev/null
sort $D/curl.out | uniq -c | sort -rn | head -6 | cut -c1-200
