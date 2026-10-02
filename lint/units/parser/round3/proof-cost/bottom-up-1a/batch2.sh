#!/bin/sh
# site2: site1 with the site of the declaration annotation moved behind `expect(T::TColon)`, directly before the skip call.
# Runs through cycle2.sh (the reference of this scratch run is ref0: main + sink form + boxed tables, on the crates of main).
S=/tmp/costproof
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
D=/workspace/notes/lint/units/parser/round3/proof-cost/bottom-up-1a
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
echo "start $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)"
mkdir -p $S/link/ref; [ -e $S/link/ref/bun-profile ] || ln -s $S/link/ref0/bun-profile $S/link/ref/bun-profile
t0=$(date +%s)
S=$S sh $D/cycle2.sh site2 $S/root/site2 cg; echo "cycle2 exit $?  $(( $(date +%s) - t0 )) s"
t0=$(date +%s)
$P/cgbench-raw.sh $S/link/site2/bun-profile $S/cg rawsite2 20 > $S/cg/rawsite2.jsonl
echo "cg rawsite2 $(( $(date +%s) - t0 )) s"
python3 $D/testeq.py $S/cg ref0 site2 --src $S/root/site2 --count $S/count --all > $S/check/testeq.ref0-site2.txt; cat $S/check/testeq.ref0-site2.txt
# nolint1: site1 with the predicate a constant false. Every parser function must then be the one of the reference.
t0=$(date +%s)
S=$S sh $D/cycle2.sh nolint1 $S/root/nolint1; echo "cycle2 nolint1 exit $?  $(( $(date +%s) - t0 )) s"
cat $S/check/nolint1.tsdiff.txt | cut -c1-200
echo "done $(date +%T)"
cp $S/check/testeq.ref0-site2.txt $D/results/testeq.ref0-site2.txt 2>/dev/null
cp $S/check/site2.tsdiff.txt $D/results/tsdiff.ref0-site2.txt 2>/dev/null
cp $S/check/nolint1.tsdiff.txt $D/results/tsdiff.ref0-nolint1.txt 2>/dev/null
cp $S/batch2.log $D/results/batch2.log 2>/dev/null
