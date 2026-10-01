#!/bin/sh
# The whole measurement of the parse_paren_expr seam, in order. Nothing is written into /workspace/wt/parser.
# Needs: a finished `bun run build:release` in /workspace/wt/parser at e3566be889 (build/release/rust-target and build.ninja).
# Scratch: /tmp/paren-seam (root/<variant>/src/js_parser = patched copy, out/<variant> = rlib, link/<variant> = link output).
set -e
T=/workspace/notes/lint/units/parser/paren-expr-seam
S=/tmp/paren-seam
mkdir -p $S/out $S/link
ALL=$(python3 $T/variants.py --list)

# 1. patched copies, then one rlib per copy with the rustc command of the release build (about 30 s each, four at a time)
python3 $T/variants.py $ALL
for v in $ALL; do echo $v; done | xargs -P 4 -I{} sh -c "RELAX=1 python3 $T/run.py {} $S/root/{} > $S/out/{}.build.log 2>&1; tail -1 $S/out/{}.build.log"
# the unpatched copy must give the bitcode of the release build: 0 differing bytes in the .rcgu.o member
mkdir -p $S/arx/a $S/arx/b
(cd $S/arx/a && llvm-ar x /workspace/wt/parser/build/release/rust-target/x86_64-unknown-linux-gnu/deps/libbun_js_parser-185fe25973f3a1f8.rlib)
(cd $S/arx/b && llvm-ar x $S/out/base/libbun_js_parser-185fe25973f3a1f8.rlib)
cmp $S/arx/a/*.rcgu.o $S/arx/b/*.rcgu.o && echo "base bitcode identical"

# 2. one full link of the unpatched tree fills the ThinLTO cache (about 8 minutes); its code sections equal build/release/bun-profile
/workspace/tools/lk python3 $T/relink.py base0 full
cp "$(for f in $S/thinlto-cache/llvmcache-*; do llvm-nm --defined-only $f 2>/dev/null | grep -q 16parse_paren_expr && echo $f; done | head -1)" $S/link/base0/bun_js_parser.lto.o

# 3. per variant: the native object of the bun_js_parser module as the ThinLTO link compiles it (40 to 110 s each, ONE lock for all)
touch $S/link/HARVEST
cat > $S/linkall.sh <<'EOS'
#!/bin/sh
for v in "$@"; do python3 /workspace/notes/lint/units/parser/paren-expr-seam/relink.py $v /tmp/paren-seam/out/$v/libbun_js_parser-185fe25973f3a1f8.rlib; done
EOS
chmod +x $S/linkall.sh
/workspace/tools/lk $S/linkall.sh $(echo $ALL | sed 's/^base //')

# 4. function by function against the reference (stub for the lint variants, base0 for the P1 edits)
python3 $T/summarize.py > $T/results.linked.txt
python3 $T/objfn.py $S/link/stub/bun_js_parser.lto.o $S/link/v2m2/bun_js_parser.lto.o --cmp --all

# 5. whole binaries and instruction counts for the finalists (about 200 s per link, 90 s per cgbench)
for v in v1 v1t v2m v2m2 v5t topw topwjs p1a p1b p1c2 p1abc2 v2y; do /workspace/tools/lk python3 $T/relink.py $v $S/out/$v/libbun_js_parser-185fe25973f3a1f8.rlib full; done
for v in base0 v1 v1t v2m v2m2 v5t topw topwjs p1a p1b p1c2 p1abc2; do /workspace/tools/lk /workspace/notes/lint/tools/cgbench.sh $S/link/$v/bun-profile $S/cg $v 20 > $S/cg.$v.txt; done
python3 /workspace/notes/lint/units/parser/measure/tools/cgdiff.py $S/cg/base0.src-js.cg $S/cg/v2m2.src-js.cg
python3 /workspace/notes/lint/tools/symsizes.py $S/link/v2m2/bun-profile

# 6. the P1 edits do what they are for (p1abc2 against base0 and tsc 6.0.2)
$S/link/base0/bun-profile $T/check/p1out.mjs > $S/p1.base.txt; $S/link/p1abc2/bun-profile $T/check/p1out.mjs > $S/p1.p1abc2.txt; bun $T/check/p1tsc.mjs > $S/p1.tsc.txt

# 7. the lint twin records what tsc has (v2y: BUN_LINT_SEAM_OUT=<file> turns the records on; v2x is the same with the
#    DecoratorMetadata sink as stand-in, which calls find_symbol inside attempts and prints a wrong alternate: see check/mini.mjs)
bun $T/check/corpus.mjs $S/corpus.json
$S/link/v2y/bun-profile $T/check/run.mjs $S/corpus.json $S/corpus.plain.jsonl
rm -f $S/seam.dump; BUN_LINT_SEAM_OUT=$S/seam.dump $S/link/v2y/bun-profile $T/check/run.mjs $S/corpus.json $S/corpus.records.jsonl
bun $T/check/oracle.mjs $S/corpus.json $S/corpus.records.jsonl $S/corpus.plain.jsonl
rm -f $S/rewind.dump; BUN_LINT_SEAM_OUT=$S/rewind.dump $S/link/v2y/bun-profile $T/check/rewind.mjs
$S/link/base0/bun-profile test test/bundler/transpiler/transpiler.test.js --timeout 180000; $S/link/p1abc2/bun-profile test test/bundler/transpiler/transpiler.test.js --timeout 180000
