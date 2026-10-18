#!/bin/bash
# Behaviour probes on the release build of the head, next to node and Bun 1.4.3.
cd /tmp/h2repro
H=/tmp/h2repro/rel-head/bun
OUT=/tmp/h2repro/final/probes.txt
: > $OUT
for N in 150 1011 1012; do
  for rt in node bun $H; do echo "flight N=$N $rt: $(BUN_DEBUG_QUIET_LOGS=1 timeout 120 $rt flight.cjs $N 10 2>&1 | tail -1)" >> $OUT; done
done
for rt in node bun $H; do echo "sync3 $rt: $(timeout 60 $rt sync3.cjs 3 1 2>&1 | tail -1)" >> $OUT; done
for srv in node bun $H; do
  echo "pub bun-client 150 hold, server $srv: $(timeout 120 pub/run.sh $srv bun 10 150 hold 2>&1 | tr '\n' ' ')" >> $OUT
  echo "pub node-client 300 hold, server $srv: $(timeout 120 pub/run.sh $srv node 10 300 hold 2>&1 | tr '\n' ' ')" >> $OUT
  echo "pub node-client 300 sync, server $srv: $(timeout 120 pub/run.sh $srv node 10 300 sync 2>&1 | tr '\n' ' ')" >> $OUT
done
cd /tmp/h2repro/ooo
for m in same later trailers-same trailers; do
  for rt in node bun $H; do echo "refused-frames $m $rt: $(timeout 60 $rt refused-frames.cjs $m 2>&1 | tail -1)" >> $OUT; done
done
echo DONE >> $OUT
