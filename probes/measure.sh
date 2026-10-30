#!/bin/bash
# usage: measure.sh <release build dir with bun-profile and bun> [debug binary]
# Prints the numbers that the PR body's cost lines use, for one build.
set -u
dir=${1:?release build dir}
debug=${2:-}
profile="$dir/bun-profile"
echo "== $dir"
size -A "$profile" | awk '$1 == ".text" { print ".text bytes:", $2 }'
echo "bun-profile bytes: $(stat -c %s "$profile")"
[ -f "$dir/bun" ] && echo "stripped bun bytes: $(stat -c %s "$dir/bun")"
for fn in us_nq_stream_send_headers us_quic_stream_send_headers us_quic_send_header_block; do
  # One line per instruction between the symbol's label and the next blank line.
  n=$(objdump -d --no-show-raw-insn "$profile" --disassemble="$fn" 2>/dev/null | grep -cE '^ +[0-9a-f]+:')
  echo "$fn instructions: $n"
done
if [ -n "$debug" ]; then
  echo "== $debug"
  gdb -batch -ex 'set language rust' -ex 'print sizeof(bun_runtime::node::quic::stream::QuicStream)' "$debug" 2>/dev/null | tail -1
fi
