#!/bin/bash
# usage: turnmeasure.sh <cli> <img> <label> — restore, one "pong" turn, report idle / after-turn / after gc+reclean
CLI=$1; IMG=$2; L=$3; S=cctm$$; D=~/code/tmp/ccmem
tmux kill-session -t $S 2>/dev/null
tmux new-session -d -s $S -x 150 -y 45 "env BUN_JSC_useGenerationalGC=${GENGC:-1} BUN_JSC_useBaselineJIT=0 BUN_JSC_useFTLJIT=0 MIMALLOC_DETERMINISTIC_HINT=1 BUN_IMAGE_JIT_ADDR=0x3c0000000 BUN_JSC_useConcurrentGC=0 BUN_JSC_useConcurrentJIT=0 BUN_MEMDEBUG=$D BUN_IMAGE_IN=$IMG $EXTRA $HOME/code/tmp/noaslr/noaslr $CLI 2>/tmp/$S.err; sleep 30"
sleep 15; P=$(pgrep -f "build-img/.*/cli$" | tail -1)
I=$(vmmap --summary $P 2>/dev/null | grep "Physical footprint:" | awk '{print $3}')
tmux send-keys -t $S "say only the word pong"; sleep 2; tmux send-keys -t $S Enter
T0=$(date +%s); until tmux capture-pane -t $S -p | grep -q "⏺" || [ $(( $(date +%s) - T0 )) -ge 150 ]; do sleep 3; done; TT=$(( $(date +%s) - T0 ))
sleep 8; A=$(vmmap --summary $P 2>/dev/null | grep "Physical footprint:" | awk '{print $3}')
echo gc > $D/cmd.$P; sleep 6; echo reclean > $D/cmd.$P; sleep 5
G=$(vmmap --summary $P 2>/dev/null | grep "Physical footprint:" | awk '{print $3}')
echo "$L: idle=$I afterTurn=$A(${TT}s) afterGC+reclean=$G"
tmux kill-session -t $S 2>/dev/null; pkill -f "build-img/.*/cli$" 2>/dev/null
