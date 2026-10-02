#!/bin/sh
# What the top-down pass of the cost proof ran on 2026-10-02, in order. Nothing is written into /workspace/wt/parser.
# State then: build/release of the worktree held the release build of MAIN (bc7a813b10), so every loop binary below is
# main's parser text, patched, in the crates of main. Scratch: /tmp/cpr3-1b. The trees ref0, site1, site2, nolint1 and
# their binaries are the ones of the bottom-up pass (../bottom-up-1a, scratch /tmp/costproof), read only.
H=/workspace/notes/lint/units/parser/round3/proof-cost/top-down-1b
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
L=/workspace/notes/lint/tools
S=/tmp/cpr3-1b
BASE=/workspace/base/bun-profile.bc7a813b1
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

# 1. the reference text (main + sink form + boxed tables + MDot) and the text of main, as trees
sh $P/mkref.sh $S/root /workspace/bun
mkdir -p $S/root/main0/src && git -C /workspace/bun archive bc7a813b10 src/js_parser | tar -x -C $S/root/main0

# 2. the noise floor: the base binary three times with --vex-guest-chase=no and twice with default VEX (results/noise-floor.base.txt)
/workspace/tools/lk sh -c "$P/cgbench-raw.sh $BASE $S/cg rawbase2 20; $P/cgbench-raw.sh $BASE $S/cg rawbase3 20; $L/cgbench.sh $BASE $S/cg base 20; $L/cgbench.sh $BASE $S/cg base2 20"
for g in bun-types typescript-lib src-js tsx js-control; do python3 $H/cgclass.py $BASE $S/cg/rawbase2.$g.cg $BASE $S/cg/rawbase3.$g.cg | head -4; done

# 3. main against ref0 (sink form + boxed tables) and ref0 against six sites: machine code, counts, tests by function
R0=/tmp/costproof/link/ref0/bun-profile
python3 $H/fncmp2.py $BASE $R0 --strict --all; python3 $H/fncmp2.py $BASE $R0 --ts --all; python3 $P/fnclass.py $BASE $R0 --inst .
python3 $H/r3table2.py /tmp/costproof/cg ref0 $R0 site1 /tmp/costproof/link/site1/bun-profile --src /tmp/costproof/root/site1
for g in bun-types typescript-lib src-js tsx js-control; do
  python3 $H/cgclass.py $R0 /tmp/costproof/cg/rawref0.$g.cg /tmp/costproof/link/site2/bun-profile /tmp/costproof/cg/rawsite2.$g.cg --src /tmp/costproof/root/site2
done

# 4. the loop itself, real path: reference, then a tree with sites, with js-control counted (compile 20 s, link 461 s cold
#    and 233 s warm, the whole second turn 6 min 38 s at a load of 500)
S=$S/cyc2 /workspace/tools/lk sh -c "sh $H/r3cycle.sh ref /tmp/costproof/root/ref0; sh $H/r3cycle.sh site1 /tmp/costproof/root/site1 cgjs"
# the unpatched text of main through the same loop against the release build of main
S=$S/cyc2 /workspace/tools/lk sh $H/r3cycle.sh main0 $S/root/main0
python3 $H/fncmp2.py $BASE $S/cyc2/link/main0/bun-profile --inst .

# 5. the whole report on stand-ins: BASE = main, REF = ref0, HEAD = site2
S=$S BASE=$BASE BASE_BUN=/workspace/base/bun.bc7a813b1 REF=$R0 HEAD=/tmp/costproof/link/site2/bun-profile HEAD_BUN=/nonexistent \
  REF_TREE=/tmp/costproof/root/ref0 HEAD_TREE=/tmp/costproof/root/site2 /workspace/tools/lk sh $H/r3report.sh $S/report2

# 6. what the five groups do not run (results/js-classes.deco.base-ref0.txt)
#    js-classes-bench.mjs and deco-bench.mjs, 5 passes, --vex-guest-chase=no: base, ref0, site2 (r3report.sh does the same)

# 7. the text of the worktree as it was (HEAD 2102fb058f, round 1): results/siteaudit2.head-2102fb058f.txt, results/srcfn.ref-head2102fb058f.txt
python3 $H/siteaudit2.py --ref $S/root/ref --head /workspace/bun --ast-base bc7a813b10 --repo /workspace/bun --max 3
python3 $P/srcfn.py $S/root/ref /workspace/bun
