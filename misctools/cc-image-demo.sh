#!/bin/bash
# Side-by-side: the same Claude Code binary booted normally vs restored from its embedded heap image.
# usage: misctools/cc-image-demo.sh <path/to/cli> [cwd]   (cli built with CLAUDE_CODE_BUILD_HEAP_IMAGE=1 CLAUDE_CODE_SNAPSHOT_AT=repl)
set -u
CLI=${1:?usage: $0 <cli> [cwd]}; CWD=${2:-$PWD}
DRIVE="$HOME/code/tmp/ccmem/drive.ts"; SAFE="$HOME/code/tmp/ccmem/safe-run.sh"
run() { # $1=label $2..=extra env
  local label=$1; shift
  local out; out=$(cd "$HOME/code/tmp/ccmem" && MAX_CLI=4 "$SAFE" 150 env "$@" bun "$DRIVE" "$CLI" --bare --pre-enter --cwd "$CWD" --type "reply with the single word pong" --enter --wait "⏺" --secs 60 2>&1)
  local prompt idle cpu turn
  prompt=$(echo "$out" | grep -o "\[drive\] [0-9.]*s prompt=true footprint=[0-9.]*M" | head -1)
  idle=$(echo "$out" | grep -o "idle footprint=[0-9.]*M cpu=[0-9:.]*" | head -1)
  turn=$(echo "$out" | grep -o "[0-9.]*s waited for ⏺: [a-z]*" | head -1)
  printf "%-10s | to prompt: %-32s | %-34s | first turn done at: %s\n" "$label" "${prompt#\[drive\] }" "$idle" "$turn"
}
echo "binary: $CLI ($(du -h "$CLI" | cut -f1))   cwd: $CWD"
run "plain"    BUN_IMAGE=0
run "image"    X=1
run "image #2" X=1
