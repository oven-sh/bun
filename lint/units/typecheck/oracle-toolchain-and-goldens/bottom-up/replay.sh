#!/bin/bash
# Makes every golden of the typecheck unit notes again with the one probe (bootstrap.sh) and says which are byte-identical.
# usage: bash replay.sh [work dir of bootstrap.sh, default /tmp/oracle-bu] [set ...]
#   sets: tree bind init check rel checkstate checkopts printer diag cli leaf suite      (default: all but suite)
#   PROBE=<binary>   the probe to use (default <work dir>/tsgoprobe)
# result: one line per golden group on standard output ("<group> identical=<n> different=<n>"), the names of the
# files that differ, and at the end the goldens that have no replay with the reason.
# The notes are only read. The `suite` set runs the reference's whole test suite (about 13,000 instances).
set -uo pipefail
W=${1:-/tmp/oracle-bu}
shift || true
SETS=${*:-tree bind init check rel checkstate checkopts printer diag cli leaf}
HERE=$(cd "$(dirname "$0")" && pwd)
N=$(cd "$HERE/../.." && pwd)
P=${PROBE:-$W/tsgoprobe}
REF=/workspace/ref/typescript-go
LIB=$REF/_submodules/TypeScript/src/lib
LIBS=$REF/internal/bundled/libs
CASES=$REF/_submodules/TypeScript/tests/cases
R=$W/replay
rm -rf "$R" && mkdir -p "$R"
# cmpset <group> <made dir> <golden dir> [suffix filter]: compares every file of the golden dir with the made one
cmpset() { python3 "$HERE/cmpset.py" "$@"; }
# same <group> <made file> <golden file>
same() { if cmp -s "$2" "$3"; then echo "$1 identical=1 different=0"; else echo "$1 identical=0 different=1"; echo "  differs: $3"; fi; }
has() { case " $SETS " in *" $1 "*) return 0;; esac; return 1; }

if has tree; then
  T=$N/ts-dump-and-test-importer
  mkdir -p "$R/tree/data"
  "$P" tree "$R/tree/data" min.ts="$T/data/min.ts"
  "$P" tree -nojsdoc "$R/tree/data" a.ts="$T/data/sample-a.ts"
  same tree.data.min "$R/tree/data/min.ts.tsgo.txt" "$T/data/min.ts.tsgo.txt"
  same tree.data.sample-a "$R/tree/data/a.ts.tsgo.txt" "$T/data/sample-a.ts.tsgo.txt"
  # 267 sampled units: the TypeScript family without JSDoc, the JavaScript units with it
  mkdir -p "$R/tree/gs/nojsdoc" "$R/tree/gs/jsdoc"
  tar -xzf "$T/data/golden-sample.tar.gz" -C "$R/tree/gs"
  (cd "$R/tree/gs/corpus" && ls | awk -v d="$PWD" '{print $0"="d"/"$0}') > "$R/tree/gs/args.txt"
  xargs -a "$R/tree/gs/args.txt" "$P" tree -nojsdoc "$R/tree/gs/nojsdoc"
  xargs -a "$R/tree/gs/args.txt" "$P" tree "$R/tree/gs/jsdoc"
  cmpset tree.golden-sample.cout "$R/tree/gs/nojsdoc" "$R/tree/gs/cout"
  cmpset tree.golden-sample.jout "$R/tree/gs/jsdoc" "$R/tree/gs/jout"
  # every unit of every case, the 108 lib files and the rule inputs: digests of the trees, and 269 whole trees
  mkdir -p "$R/tree/all/out" "$R/tree/libs" "$R/tree/rules" "$R/tree/s200/gold" "$R/tree/s200/made"
  python3 "$HERE/split_cases.py" corpus "$R/tree/all/corpus" "$R/tree/all/manifest.tsv"
  awk -F'\t' -v d="$R/tree/all/corpus" '{print $1"="d"/"$1}' "$R/tree/all/manifest.tsv" > "$R/tree/all/args.txt"
  xargs -a "$R/tree/all/args.txt" -n 2000 "$P" tree "$R/tree/all/out"
  # -norelated: the stored digests predate the related-information lines of the tree probe (31 units have one)
  "$W/treedigest" -norelated "$R/tree/all/out" "$R/tree/all/corpus" "$R/tree/all/manifest.tsv" "$R/tree/all/cases.tsgo-digests.tsv"
  gzip -dc "$T/top-down/golden/cases.tsgo-digests.tsv.gz" > "$R/tree/all/golden.tsv"
  python3 "$HERE/cmpset.py" --lines tree.topdown.cases-digests "$R/tree/all/cases.tsgo-digests.tsv" "$R/tree/all/golden.tsv"
  (cd "$LIBS" && ls *.d.ts | awk -v d="$LIBS" '{print $0"="d"/"$0}') > "$R/tree/libs/args.txt"
  xargs -a "$R/tree/libs/args.txt" "$P" tree "$R/tree/libs"
  mkdir -p "$R/tree/libcorpus" && cp "$LIBS"/*.d.ts "$R/tree/libcorpus/"
  "$W/treedigest" "$R/tree/libs" "$R/tree/libcorpus" - "$R/tree/libs.tsgo-digests.tsv"
  python3 "$HERE/cmpset.py" --lines tree.topdown.libs-digests "$R/tree/libs.tsgo-digests.tsv" "$T/top-down/golden/libs.tsgo-digests.tsv"
  (cd "$T/top-down/rules/src" && ls | awk -v d="$PWD" '{print $0"="d"/"$0}') > "$R/tree/rules/args.txt"
  xargs -a "$R/tree/rules/args.txt" "$P" tree "$R/tree/rules"
  cmpset tree.topdown.rules "$R/tree/rules" "$T/top-down/rules/tsgo"
  "$W/treedigest" "$R/tree/rules" "$T/top-down/rules/src" - "$R/tree/rules.tsgo-digests.tsv"
  python3 "$HERE/cmpset.py" --lines tree.topdown.rules-digests "$R/tree/rules.tsgo-digests.tsv" "$T/top-down/golden/rules.tsgo-digests.tsv"
  tar -xzf "$T/top-down/golden/sample-200-cases.tsgo.tar.gz" -C "$R/tree/s200/gold"
  cmpset tree.topdown.sample-200 "$R/tree/all/out" "$R/tree/s200/gold"
  # the inputs of the lowering probe, with and without JSDoc
  B=$N/bun-ast-lowering/probe
  mkdir -p "$R/tree/low/tsgo" "$R/tree/low/tsgo-nojsdoc"
  (cd "$B/src" && ls | awk -v d="$PWD" '{print $0"="d"/"$0}') > "$R/tree/low/args.txt"
  xargs -a "$R/tree/low/args.txt" "$P" tree "$R/tree/low/tsgo"
  xargs -a "$R/tree/low/args.txt" "$P" tree -nojsdoc "$R/tree/low/tsgo-nojsdoc"
  cmpset tree.lowering.tsgo "$R/tree/low/tsgo" "$B/tsgo"
  cmpset tree.lowering.tsgo-nojsdoc "$R/tree/low/tsgo-nojsdoc" "$B/tsgo-nojsdoc"
fi

if has bind; then
  B=$N/binder-port-and-fixtures
  mkdir -p "$R/bind/out" "$R/bind/gold"
  python3 "$HERE/split_cases.py" selection "$B/data/SELECTION.tsv" "$R/bind/units" "$R/bind/args.txt"
  (cd "$B/data/synthetic" && ls | awk -v d="$PWD" '{print $0"="d"/"$0}') >> "$R/bind/args.txt"
  xargs -a "$R/bind/args.txt" "$P" bind "$R/bind/out"
  tar -xzf "$B/data/bind-dumps.tar.gz" -C "$R/bind/gold"
  cmpset bind.dumps "$R/bind/out" "$R/bind/gold/dumps"
  cmpset bind.synthetic "$R/bind/out" "$R/bind/gold/synthetic"
fi

if has init; then
  C=$N/checker-core-scratch/groundtruth
  I=$C/inputs; A=$I/alias; O=$R/init; mkdir -p "$O"
  L3="lib.es5.d.ts=$LIBS/lib.es5.d.ts lib.decorators.d.ts=$LIBS/lib.decorators.d.ts lib.decorators.legacy.d.ts=$LIBS/lib.decorators.legacy.d.ts"
  "$P" init min.ts=$I/min.ts > "$O/out.strict.nolib.txt"
  "$P" init -nostrict min.ts=$I/min.ts > "$O/out.nostrict.nolib.txt"
  "$P" init -exact min.ts=$I/min.ts > "$O/out.exact.nolib.txt"
  "$P" init $L3 min.ts=$I/min.ts > "$O/out.strict.es5.txt"
  "$P" init -nostrict $L3 min.ts=$I/min.ts > "$O/out.nostrict.es5.txt"
  "$P" init -max 0 $L3 a.ts=$I/a.ts b.ts=$I/b.ts m1.ts=$I/m1.ts m2.ts=$I/m2.ts > "$O/out.merge.es5.txt"
  "$P" init -aliases lib1.ts=$A/lib1.ts lib2.ts=$A/lib2.ts lib3.ts=$A/lib3.ts eq.ts=$A/eq.ts cyc1.ts=$A/cyc1.ts cyc2.ts=$A/cyc2.ts user.ts=$A/user.ts > "$O/out.aliases.txt"
  cmpset init.checker-core "$O" "$C/out"
fi

if has check; then
  C=$N/checker-type-layers-scratch/groundtruth
  O=$R/check; mkdir -p "$O"
  for f in min.ts rich.ts zero.ts infer.ts cjs.js cjs2.js; do
    flags="-strict"; case "$f" in *.js) flags="-strict -checkjs";; esac
    (cd "$C/inputs" && "$P" check $flags lib.es5.d.ts=$LIB/es5.d.ts "$f=$f") > "$O/$f.out.txt"
  done
  cmpset check.type-layers "$O" "$C/out" .out.txt
  # the type printer probes of the top-down pass: the same sub-command without its two counter lines
  C=$N/checker-type-printer/top-down/probes
  O=$R/check-printer; mkdir -p "$O"
  for f in min.ts trunc1.ts trunc2.ts utf8cut_a.ts utf8cut_b.ts objlit.ts sigs.ts stage_types.ts stage_scope.ts stage_syms.ts stage_more.ts; do
    extra=""; case "$f" in stage_syms.ts) extra="lib.es2015.symbol.d.ts=$LIB/es2015.symbol.d.ts mod.ts=mod.ts";; esac
    (cd "$C" && "$P" check -strict lib.es5.d.ts=$LIB/es5.d.ts $extra "$f=$f") | grep -v '^RESOLUTIONDEPTH\|^COUNTS' > "$O/${f%.ts}.out.txt"
  done
  cmpset check.printer-probes "$O" "$C" .out.txt
fi

if has rel; then
  C=$N/checker-relations-and-inference
  O=$R/rel; mkdir -p "$O/out" "$O/gold" "$O/td"
  for p in "$C"/groundtruth/inputs/*.ts; do
    f=$(basename "$p" .ts)
    "$P" rel -strict -trace -funcs lib.es5.d.ts=$LIB/es5.d.ts "$f.ts=$p" > "$O/out/$f.trace.txt"
    grep -v '^T \|^F ' "$O/out/$f.trace.txt" > "$O/out/$f.out.txt"
    cp "$C/groundtruth/out/$f.out.txt" "$O/gold/"
    gzip -dc "$C/groundtruth/out/$f.trace.txt.gz" > "$O/gold/$f.trace.txt"
  done
  cmpset rel.out "$O/out" "$O/gold" .out.txt
  cmpset rel.trace "$O/out" "$O/gold" .trace.txt
  "$P" rel -strict -trace -funcs lib.es5.d.ts=$LIB/es5.d.ts "min.ts=$C/top-down/probe/min.ts" > "$O/td/min.out.txt"
  for f in chain rel2; do
    "$P" rel -strict -trace lib.es5.d.ts=$LIB/es5.d.ts "$f.ts=$C/top-down/probe/$f.ts" > "$O/td/$f.out.txt"
  done
  cmpset rel.topdown-probe "$O/td" "$C/top-down/probe" .out.txt
  # the call tree below one relation, from the build that records every function of the checker (TRACEALL=1).
  # The calls below getNamedMembers follow a Go map and differ in every run: that subtree is cut from both sides.
  if [ -x "$W/tsgoprobe-all" ]; then
    "$W/tsgoprobe-all" rel -strict -trace lib.es5.d.ts=$LIB/es5.d.ts "min.ts=$C/groundtruth/inputs/min.ts" > "$O/all.min.txt"
    python3 "$HERE/foldtree.py" "$O/all.min.txt" Checker.checkTypeAssignableToAndOptionallyElaborate -without Checker.getNamedMembers > "$O/relation-tree.cut.txt"
    python3 "$HERE/foldtree.py" -strip "$C/groundtruth/out/k4.relation-tree.txt" Checker.getNamedMembers > "$O/relation-tree.gold.cut.txt"
    same rel.relation-tree-without-getNamedMembers "$O/relation-tree.cut.txt" "$O/relation-tree.gold.cut.txt"
  fi
fi

if has checkstate; then
  C=$N/checker-expressions-calls-flow/bottom-up/groundtruth
  O=$R/checkstate; mkdir -p "$O/inputs" "$O/out" "$O/td"
  cp "$C"/inputs/*.ts "$O/inputs/"
  python3 "$C/gen.py" "$O/inputs"
  L5="lib.es5.d.ts=$LIB/es5.d.ts"; LX="$L5"
  for l in es2015.core es2015.symbol es2015.symbol.wellknown es2015.iterable es2015.generator es2015.promise es2015.collection; do LX="$LX lib.$l.d.ts=$LIB/$l.d.ts"; done
  cd "$O/inputs"
  "$P" checkstate -strict $L5 min.ts=min.ts > "$O/out/min.out.txt" 2>&1
  for f in flow reach calls ctx oper access literal func more; do "$P" checkstate -strict -suggestions $LX $f.ts=$f.ts > "$O/out/$f.out.txt" 2>&1; done
  for f in postsuper toolarge edge1999 edge2000 deepbin deepor; do "$P" checkstate -strict -suggestions $L5 $f.ts=$f.ts > "$O/out/$f.out.txt" 2>&1; done
  cmpset checkstate.bottom-up "$O/out" "$C/out"
  C=$N/checker-expressions-calls-flow/top-down/groundtruth
  ARGS=$(while read f; do printf '%s=%s/%s ' "$f" "$LIBS" "$f"; done < "$C/libs.es2025.txt")
  cd "$C/inputs"
  "$P" checkstate -strict $ARGS min.ts=min.ts > "$O/td/min.default-libs.out.txt" 2>&1
  "$P" checkstate -strict lib.es5.d.ts=$LIBS/lib.es5.d.ts min.ts=min.ts > "$O/td/min.es5-only.out.txt" 2>&1
  for f in flow1 calls1 unreach1; do "$P" checkstate -strict $ARGS $f.ts=$f.ts > "$O/td/$f.out.txt" 2>&1; done
  for f in flow1 unreach1; do "$P" checkstate -strict -unreachable-error $ARGS $f.ts=$f.ts > "$O/td/$f.unreachable-error.out.txt" 2>&1; done
  cmpset checkstate.top-down "$O/td" "$C/out" .out.txt
  cd "$HERE"
fi

if has checkopts; then
  C=$N/checker-declarations-grammar-jsx/bottom-up/groundtruth
  O=$R/checkopts; mkdir -p "$O/res" "$O/lines" "$O/td"
  cd "$C/inputs"
  while IFS='|' read -r name flags libs files; do
    [ -z "$name" ] && continue
    args=""
    for l in $libs; do args="$args lib.$l.d.ts=$LIB/$l.d.ts"; done
    for f in $files; do args="$args $f=$f"; done
    case "$name" in
      jsx_badfactory) "$P" checkopts -strict -o jsx=#3 -o "jsxFactory=h create" $args > "$O/res/$name.out.txt" 2>&1 ;;
      *) "$P" checkopts $flags $args > "$O/res/$name.out.txt" 2>&1 ;;
    esac
  done < "$C/runs.txt"
  : > "$O/res/grammar_lines.out.txt"
  i=0
  while IFS= read -r line; do
    i=$((i+1)); f=$(printf 'g%03d.ts' $i)
    printf 'declare const o: any; declare function dec(...a: any[]): any; declare class A1 {} declare class B1 {} interface I1 {} interface I2 {}\n%b\n' "$line" > "$O/lines/$f"
    # the stored file was written by dash, whose echo expands the escapes of the line
    { printf '%b\n' "--- $i: $line"; (cd "$O/lines" && "$P" checkopts -strict -o target=#4 lib.es5.d.ts=$LIB/es5.d.ts lib.decorators.d.ts=$LIB/decorators.d.ts mod_a.ts="$C/inputs/mod_a.ts" $f=$f 2>&1) | grep "^PARSE g\|^g[0-9]\|^  \|^panic\|^goroutine\|^global" | sed 's/^PARSE g[0-9]*\.ts //' | sed "s/^g[0-9]*\.ts/L/"; } >> "$O/res/grammar_lines.out.txt"
  done < "$C/inputs/grammar_lines.txt"
  cmpset checkopts.bottom-up "$O/res" "$C/out"
  C=$N/checker-declarations-grammar-jsx/top-down/probes
  one() { name=$1; file=$2; shift 2; (cd "$C" && "$P" checkopts "$@" lib.es5.d.ts=$LIB/es5.d.ts $file=$file) > "$O/td/$name.out.txt" 2>&1; }
  one expando expando.ts -strict
  one tsjsdoc tsjsdoc.ts -strict -sugg -o noUnusedLocals=true
  one tlamod tlamod.ts -strict -o module=#1
  one tlamod2 tlamod.ts -strict -o module=#99 -o target=#9
  "$P" pien < "$C/pien.txt" > "$O/td/pien.out.txt"
  cmpset checkopts.top-down "$O/td" "$C" .out.txt
  cd "$HERE"
fi

if has printer; then
  C=$N/checker-type-printer/bottom-up
  O=$R/printer; mkdir -p "$O/decls" "$O/corpus" "$O/gold" "$O/td"
  cd "$C/groundtruth/inputs"
  for f in *.ts; do
    "$P" declstrings -strict lib.es5.d.ts=$LIB/es5.d.ts "$f=$f" > "$O/decls/$f.strings.tsv"
    "$P" declstrings -strict -notrunc lib.es5.d.ts=$LIB/es5.d.ts "$f=$f" > "$O/decls/$f.strings.notrunc.tsv"
  done
  cmpset printer.declstrings "$O/decls" "$C/groundtruth/out"
  python3 "$C/py/typecorpus.py" "$O/corpus/texts.tsv" > /dev/null
  cut -f3- "$O/corpus/texts.tsv" | "$P" roundtrip all > "$O/corpus/roundtrip.tsv"
  gzip -dc "$C/data/printer-roundtrip.tsv.gz" > "$O/gold/roundtrip.tsv"
  same printer.roundtrip "$O/corpus/roundtrip.tsv" "$O/gold/roundtrip.tsv"
  awk -F'\t' '$1=="TYPE-SAME"{printf "declare const __v%d: %s;\n", n++, $2}' "$O/corpus/roundtrip.tsv" > "$O/corpus/vars.ts"
  awk -F'\t' '$1=="TYPE-SAME"{printf "__v%d\t%s\n", n++, $2}' "$O/corpus/roundtrip.tsv" > "$O/corpus/vars.index.tsv"
  "$P" typestrings -strict lib.es5.d.ts=$LIB/es5.d.ts vars.ts="$O/corpus/vars.ts" > "$O/corpus/typestrings.tsv"
  "$P" typestrings -strict -notrunc lib.es5.d.ts=$LIB/es5.d.ts vars.ts="$O/corpus/vars.ts" > "$O/corpus/typestrings.notrunc.tsv"
  paste "$O/corpus/vars.index.tsv" "$O/corpus/typestrings.tsv" | cut -f1,2,4- > "$O/corpus/typestrings.joined.tsv"
  paste "$O/corpus/vars.index.tsv" "$O/corpus/typestrings.notrunc.tsv" | cut -f1,2,4- > "$O/corpus/typestrings.notrunc.joined.tsv"
  gzip -dc "$C/data/typestrings.tsv.gz" > "$O/gold/typestrings.tsv"
  gzip -dc "$C/data/typestrings.notrunc.tsv.gz" > "$O/gold/typestrings.notrunc.tsv"
  same printer.typestrings "$O/corpus/typestrings.joined.tsv" "$O/gold/typestrings.tsv"
  same printer.typestrings-notrunc "$O/corpus/typestrings.notrunc.joined.tsv" "$O/gold/typestrings.notrunc.tsv"
  C=$N/checker-type-printer/top-down
  python3 "$C/py/texts.py" "$O/td/distinct-args.txt" > /dev/null
  "$P" rt "$O/td/distinct-args.txt" strip > "$O/td/rt.strip.out"
  grep '^ok' "$O/td/rt.strip.out" | cut -f2 > "$O/td/roundtrip-texts.txt"
  grep '^diff' "$O/td/rt.strip.out" > "$O/td/roundtrip-diff.tsv"
  grep '^noparse' "$O/td/rt.strip.out" | cut -f2 > "$O/td/roundtrip-noparse.txt"
  gzip -dc "$C/data/roundtrip-texts.txt.gz" > "$O/gold/roundtrip-texts.txt"
  same printer.rt-texts "$O/td/roundtrip-texts.txt" "$O/gold/roundtrip-texts.txt"
  same printer.rt-diff "$O/td/roundtrip-diff.tsv" "$C/data/roundtrip-diff.tsv"
  same printer.rt-noparse "$O/td/roundtrip-noparse.txt" "$C/data/roundtrip-noparse.txt"
  cd "$HERE"
fi

if has diag; then
  C=$N/diagnostics-groundtruth/golden
  O=$R/diag; mkdir -p "$O"
  for n in vectors.txt go.out vectors-external.txt go-external.out go-keys.out; do gzip -dc "$C/$n.gz" > "$O/gold.$n"; done
  grep -o '^KEY [0-9]*' "$O/gold.go-keys.out" > "$O/vectors-keys.txt"
  "$P" diag < "$O/gold.vectors.txt" > "$O/go.out"
  "$P" diag < "$O/gold.vectors-external.txt" > "$O/go-external.out"
  "$P" diag < "$O/vectors-keys.txt" > "$O/go-keys.out"
  same diag.go.out "$O/go.out" "$O/gold.go.out"
  same diag.go-external.out "$O/go-external.out" "$O/gold.go-external.out"
  same diag.go-keys.out "$O/go-keys.out" "$O/gold.go-keys.out"
fi

if has cli; then
  C=$N/end-to-end-k4-k5/vectors
  O=$R/cli; mkdir -p "$O/run" "$O/order" "$O/vco"
  cd "$O/run" && printf 'const x: number = "s";\n' > min.ts
  for g in "$C"/program-order/*.txt; do
    n=$(basename "$g" .txt)
    case $n in target-default) args="";; target-*) args="--target ${n#target-}";; lib-*) args="--lib $(echo "${n#lib-}" | tr '+' ',')";; esac
    "$P" cli min.ts --noEmit --listFiles $args | grep '^bundled' | sed 's#bundled:///libs/##' > "$O/order/$n.txt"
  done
  cmpset cli.program-order "$O/order" "$C/program-order"
  cp "$HERE"/replay-inputs/vco/* "$O/vco/" && cd "$O/vco"
  (while IFS= read -r line; do echo ">>> $line"; "$P" cli $line 2>&1; echo "exit=$?"; done < "$C/verify-compiler-options.cases.txt") > "$O/verify-compiler-options.txt"
  # two messages name the directory of the run: the stored file was made in /tmp/e2e/run3
  sed "s#$O/vco/#/tmp/e2e/run3/#" "$O/verify-compiler-options.txt" > "$O/verify-compiler-options.normalized.txt"
  same cli.verify-compiler-options "$O/verify-compiler-options.normalized.txt" "$C/verify-compiler-options.txt"
  cd "$HERE"
fi

if has leaf; then
  # the vectors of jsnum and stringutil: the unit stores no vector file (20 MB, 118 MB, 1 MB), so digests are compared.
  # They were taken from the files that leaf-packages-scratch/golden/run.sh had written with Go 1.24 and Go 1.26.
  O=$R/leaf; mkdir -p "$O"
  for c in leafdump leafdump2 leafdump3; do
    got=$("$P" $c | sha256sum | cut -c1-64)
    if grep -q "^$got  $c " "$HERE/replay-inputs/leaf/sha256.txt"; then echo "leaf.$c identical=1 different=0"; else echo "leaf.$c identical=0 different=1"; fi
  done
  "$P" leafchk > "$O/leafchk.txt"
  same leaf.leafchk "$O/leafchk.txt" "$HERE/replay-inputs/leaf/leafchk.txt"
fi

if has suite; then
  C=$N/drivers-k4-k5
  O=$R/suite; mkdir -p "$O/plain" "$O/opts"
  (cd "$W/root" && TSGOPROBE_ROOT="$W/root" K5_MANIFEST_DIR="$O/plain" "$P" suite -test.run '^TestSubmodule$' -test.count=1 -test.timeout 170m > "$O/plain.log" 2>&1)
  (cd "$W/root" && TSGOPROBE_ROOT="$W/root" K5_MANIFEST_DIR="$O/opts" K5_OPTS=1 "$P" suite -test.run '^TestSubmodule$' -test.count=1 -test.timeout 170m > "$O/opts.log" 2>&1)
  tail -1 "$O/plain.log"; tail -1 "$O/opts.log"
  # the instances run in parallel: the rows are compared as a set
  LC_ALL=C sort "$O/plain/manifest.jsonl" > "$O/plain.sorted"; gzip -dc "$C/bottom-up/data/manifest.jsonl.gz" | LC_ALL=C sort > "$O/plain.gold"
  LC_ALL=C sort "$O/opts/manifest.jsonl" > "$O/opts.sorted"; gzip -dc "$C/top-down/data/manifest.with-opts.jsonl.gz" | LC_ALL=C sort > "$O/opts.gold"
  python3 "$HERE/cmpset.py" --lines suite.manifest "$O/plain.sorted" "$O/plain.gold"
  python3 "$HERE/cmpset.py" --lines suite.manifest-with-opts "$O/opts.sorted" "$O/opts.gold"
fi

cat <<'EOF'
no replay:
  checker-relations-and-inference/groundtruth/out/k4.relation-tree.txt   as a whole: the 24 lines below getNamedMembers change in every run (checker.go:22173 ranges over a Go map); the rest is compared above with tsgoprobe-all and foldtree.py
  */out/*.entered.txt, */data/*entered*.tsv, *.blocks.tsv, *.fns.txt, *covered-functions.tsv   coverage lists: COVER=1 build, then go tool covdata and the py script of the owning unit
  checker-type-printer/bottom-up/data/{family,panics,...}.tsv   three coverage runs of the whole suite (CTP_MODE), analysis data, not an oracle of the port
  end-to-end-k4-k5/vectors/lib-references.txt   made by py/libmodel.py from the lib files, no probe involved
  ts-dump-and-test-importer/top-down/rules/dump/*.ast.json   made by TypeScript 6.0.2 (probe/dump-ast.ts), not by the reference
EOF
