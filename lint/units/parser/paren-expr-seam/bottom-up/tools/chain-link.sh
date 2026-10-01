#!/bin/sh
# usage: lk chain-link.sh <tag>...   Links the variants one after the other under ONE acquisition of the machine lock.
# Log: /tmp/pes/link/chain.log ; output of each link: /tmp/pes/link/<tag>.out
echo "LOCK $(date -u +%H:%M:%S) load=$(cut -d' ' -f1-3 /proc/loadavg)" >> /tmp/pes/link/chain.log
for t in "$@"; do
  echo "START $t $(date -u +%H:%M:%S)" >> /tmp/pes/link/chain.log
  python3 /tmp/pes/tools/link.py $t /tmp/pes/rlib/$t/libbun_js_parser-185fe25973f3a1f8.rlib > /tmp/pes/link/$t.out 2>&1
  echo "END   $t rc=$? $(date -u +%H:%M:%S) $(head -c 40 /tmp/pes/link/$t.out)" >> /tmp/pes/link/chain.log
done
echo "CHAIN DONE $(date -u +%H:%M:%S)" >> /tmp/pes/link/chain.log
