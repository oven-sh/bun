#!/bin/bash
# usage: count-drain.sh <bun-profile> <out file> [requests=4] [body=hello]
# Counts, for every call of QuicStream::drain_outbound (a stream's write event), the instructions
# that run inside drain_outbound and inside send_pending_headers themselves.
set -u
bin=${1:?bun-profile}
out=${2:?out file}
dir=$(dirname "$0")
sym() { nm -S -C "$bin" | awk -v n="$1" '$0 ~ n"$" { print "0x"$1":0x"$2; exit }'; }
drain=$(sym '<bun_runtime::node::quic::stream::QuicStream>::drain_outbound')
pending=$(sym '<bun_runtime::node::quic::stream::QuicStream>::send_pending_headers')
rm -f "$out"
FN=${drain%%:*} RANGES="drain_outbound=$drain,send_pending_headers=$pending" OUT="$out" \
  gdb -batch -x "$dir/count-instructions.py" --args "$bin" "$dir/count-program.mjs" "${3:-4}" "${4:-hello}" >/dev/null 2>&1
cat "$out"
