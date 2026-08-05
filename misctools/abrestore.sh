#!/bin/bash
# usage: abrestore.sh <cli> <img> [label] — restore, measure footprint at 15s/45s, type a fixed string (no submit), measure again
CLI=$1; IMG=$2; L=${3:-run}; S=ccab$$
tmux kill-session -t $S 2>/dev/null
tmux new-session -d -s $S -x 150 -y 45 "env BUN_JSC_useGenerationalGC=0 MIMALLOC_DETERMINISTIC_HINT=1 BUN_IMAGE_JIT_ADDR=0x3c0000000 BUN_JSC_useConcurrentGC=0 BUN_JSC_useConcurrentJIT=0 BUN_GC_IDLE_SHRINK_DISABLE=1 BUN_IMAGE_IN=$IMG $EXTRA $HOME/code/tmp/noaslr/noaslr $CLI 2>/tmp/$S.err; sleep 30"
sleep 15; P=$(pgrep -f "build-img/.*/cli$" | tail -1)
F15=$(vmmap --summary $P 2>/dev/null | grep "Physical footprint:" | awk '{print $3}')
sleep 30; F45=$(vmmap --summary $P 2>/dev/null | grep "Physical footprint:" | awk '{print $3}')
tmux send-keys -t $S "hello there, just typing to exercise input and rendering"; sleep 2; tmux send-keys -t $S "/"; sleep 3; tmux send-keys -t $S Escape; sleep 2; tmux send-keys -t $S C-u; sleep 3
FT=$(vmmap --summary $P 2>/dev/null | grep "Physical footprint:" | awk '{print $3}')
echo "$L: idle15=$F15 idle45=$F45 afterTyping+slashMenu=$FT img=$(du -m $IMG | cut -f1)MB"
tmux kill-session -t $S 2>/dev/null; pkill -f "build-img/.*/cli$" 2>/dev/null
