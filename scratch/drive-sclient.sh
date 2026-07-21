#!/bin/sh
# usage: drive-sclient.sh <runtime> <n-conns> [sess]
RT="$1"; N="${2:-5}"; SESS="$3"
DIR="$(cd "$(dirname "$0")" && pwd)"
CERT="$DIR/../test/js/node/test/fixtures/keys/agent1-cert.pem"
"$RT" "$DIR/dbg-server.js" > "$DIR/dbg-port.txt" &
SVPID=$!
sleep 1
PORT=$(sed 's/PORT=//' "$DIR/dbg-port.txt")
[ -z "$PORT" ] && { echo "no port"; kill $SVPID; exit 1; }
rm -f "$DIR/sess.pem"
BAD=""
i=1
while [ $i -le $N ]; do
  FLAGS="-connect 127.0.0.1:$PORT -CAfile $CERT -msg -tls1_2"
  if [ -n "$SESS" ]; then
    [ -f "$DIR/sess.pem" ] && FLAGS="$FLAGS -sess_in $DIR/sess.pem"
    FLAGS="$FLAGS -sess_out $DIR/sess.pem"
  fi
  OUT=$(timeout 6 openssl s_client $FLAGS < /dev/null 2>&1)
  RC=$?
  GOT=$(printf '%s' "$OUT" | grep -c '<<<.*close_notify')
  REUSED=$(printf '%s' "$OUT" | grep -c '^Reused')
  echo "conn $i: exit=$RC close_notify_received=$GOT reused=$REUSED"
  [ "$GOT" -eq 0 ] && BAD="$BAD $i"
  i=$((i+1))
done
kill $SVPID 2>/dev/null
[ -z "$BAD" ] && echo ALL_OK || echo "MISSING close_notify on:$BAD"
