#!/usr/bin/env bash
# Apply 1% packet loss + 60ms RTT (30ms each way) on loopback, run bench,
# then clean up. Linux `tc netem` equivalent of the brief's dnctl/pfctl.
set -euo pipefail

BUN="${1:-/workspace/bun/build/release/bun}"
DEV=lo

cleanup() { tc qdisc del dev "$DEV" root 2>/dev/null || true; }
trap cleanup EXIT

cleanup
tc qdisc add dev "$DEV" root netem delay 30ms loss 1%
echo "[lossy] netem: $(tc qdisc show dev $DEV)" >&2

cd "$(dirname "$0")"
"$BUN" bench.ts --bun "$BUN" --reps 5 --label "lossy-1pct-60ms"
