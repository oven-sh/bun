#!/bin/bash
# Scratch: one worker of the head debug binary at a time over a corpus, 600 sources per process.
# usage: chunks.sh <corpus.json> <part file> <count>
corpus=$1; part=$2; count=$3
rm -f "$part" "$part.mark"; touch "$part"
cd /tmp/gdo/gd
start=0
while [ "$start" -lt "$count" ]; do
  end=$((start + 600))
  s=$(date +%s)
  BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 /tmp/gdo/head/bun-debug harness.mjs --worker "$corpus" "$part" 0 1 "$start" "$end" 2>> "$part.err"
  rc=$?
  echo "chunk $start..$end rc=$rc secs=$(( $(date +%s) - s )) mark=$(cat "$part.mark")"
  if [ "$rc" -ne 0 ]; then
    # the worker died on the input of the mark: note it and go on behind it
    at=$(cat "$part.mark")
    echo "{\"i\":$at,\"crashed\":\"exit $rc\"}" >> "$part.crashes"
    start=$((at + 1))
    # redo the finished part of this chunk is not needed: lines before the mark are written only when the buffer was flushed
    continue
  fi
  start=$end
done
echo finished
