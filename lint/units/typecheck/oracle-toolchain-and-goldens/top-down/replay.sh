#!/bin/bash
# Regenerates the goldens that the research passes stored under units/typecheck with the ONE probe program of
# bootstrap.sh and says, file by file, whether the new output has the same bytes.
# usage: bash replay.sh [family...]      families: tree lowering bind init layers rel ecf decl printer e2e diagfmt types
#                                        long ones, only when named: digests (whole corpus, needs bun) manifest (whole suite)
# environment: ORACLE_WORK (default /tmp/oracle-td), ORACLE (default <work>/bin/oracle), ORACLE_TRACE (<work>/bin/oracle-trace)
# result: <work>/replay/status.tsv (status, family, golden), a count per family on stdout, exit 1 when a golden differs.
# A status is identical, differs, or skipped with the reason (a golden that needs the trace build, bun, or a script that is gone).
W=${ORACLE_WORK:-/tmp/oracle-td}
O=${ORACLE:-$W/bin/oracle}
OT=${ORACLE_TRACE:-$W/bin/oracle-trace}
HERE=$(cd "$(dirname "$0")" && pwd)
N=$(cd "$HERE/../.." && pwd)
REF=${ORACLE_REF:-/workspace/ref/typescript-go}
TSLIB=$REF/_submodules/TypeScript/src/lib
BLIB=$REF/internal/bundled/libs
CASES=$REF/_submodules/TypeScript/tests/cases
R=$W/replay
mkdir -p "$R"
: > "$R/status.tsv"
[ -x "$O" ] || { echo "replay: $O is missing, run bootstrap.sh"; exit 2; }
family=
note() { printf '%s\t%s\t%s\n' "$1" "$family" "${2#$N/}" >> "$R/status.tsv"; }
# same <golden> <new file>
same() {
  if [ ! -f "$1" ]; then note "skipped: no stored golden" "$1"; return; fi
  if cmp -s "$1" "$2"; then note identical "$1"; else note differs "$1"; fi
}
# samegz <golden.gz> <new file>
samegz() {
  if gzip -dc "$1" | cmp -s - "$2"; then note identical "$1"; else note differs "$1"; fi
}

f_tree() {
  family=tree
  local D=$N/ts-dump-and-test-importer T=$R/tree
  rm -rf "$T"; mkdir -p "$T/data" "$T/rules" "$T/sample" "$T/src"
  "$O" tree -nojsdoc "$T/data" min.ts="$D/data/min.ts" a.ts="$D/data/sample-a.ts"
  same "$D/data/min.ts.tsgo.txt" "$T/data/min.ts.tsgo.txt"
  same "$D/data/sample-a.ts.tsgo.txt" "$T/data/a.ts.tsgo.txt"
  (cd "$D/top-down/rules/src" && "$O" tree "$T/rules" $(ls | awk -v d="$PWD" '{print $0"="d"/"$0}'))
  for g in "$D"/top-down/rules/tsgo/*.tsgo.txt; do same "$g" "$T/rules/$(basename "$g")"; done
  # data/golden-sample.tar.gz: 267 trees (cout/) next to their sources (corpus/), made without JSDoc
  tar -xzf "$D/data/golden-sample.tar.gz" -C "$T/sample"
  local srcdir; srcdir=$(find "$T/sample" -mindepth 1 -maxdepth 1 -type d ! -name cout | head -1)
  mkdir -p "$T/sample/new"
  (cd "$srcdir" && ls | awk -v d="$PWD" '{print $0"="d"/"$0}' | xargs -n 500 "$O" tree -nojsdoc "$T/sample/new")
  local ok=0 bad=0
  for g in "$T"/sample/cout/*.tsgo.txt; do if cmp -s "$g" "$T/sample/new/$(basename "$g")"; then ok=$((ok+1)); else bad=$((bad+1)); fi; done
  if [ $bad -eq 0 ]; then note "identical ($ok trees)" "$D/data/golden-sample.tar.gz"; else note "differs ($bad of $((ok+bad)) trees)" "$D/data/golden-sample.tar.gz"; fi
}

f_lowering() {
  family=lowering
  local D=$N/bun-ast-lowering/probe T=$R/lowering
  rm -rf "$T"; mkdir -p "$T/tsgo" "$T/tsgo-nojsdoc"
  local args; args=$(cd "$D/src" && ls | awk -v d="$D/src" '{print $0"="d"/"$0}')
  "$O" tree "$T/tsgo" $args
  "$O" tree -nojsdoc "$T/tsgo-nojsdoc" $args
  for g in "$D"/tsgo/*.tsgo.txt; do same "$g" "$T/tsgo/$(basename "$g")"; done
  for g in "$D"/tsgo-nojsdoc/*.tsgo.txt; do same "$g" "$T/tsgo-nojsdoc/$(basename "$g")"; done
}

f_bind() {
  family=bind
  local D=$N/binder-port-and-fixtures T=$R/bind
  rm -rf "$T"; mkdir -p "$T/units" "$T/new" "$T/old"
  tar -xzf "$D/data/bind-dumps.tar.gz" -C "$T/old"
  # The units are cut out of the cases as prototype/units.mjs cuts them (lines split at CR LF or LF, joined with LF).
  python3 - "$D/data/SELECTION.tsv" "$CASES" "$T/units" > "$T/args.txt" <<'PY'
import os, re, sys
sel, cases, out = sys.argv[1:4]
opt = re.compile(r'^/{2}\s*@(\w+)\s*:\s*([^\r\n]*)')
for line in open(sel, encoding='utf-8').read().split('\n')[1:]:
    if not line: continue
    f = line.split('\t')
    rel, index, virtual = f[1], int(f[4]), f[12]
    code = open(os.path.join(cases, rel), 'rb').read().decode('utf-8')
    units, current, content = [], None, ''
    for l in re.split(r'\r?\n', code):
        m = opt.match(l)
        if m:
            if m.group(1).lower() != 'filename': continue
            if current is not None: units.append(content)
            current, content = m.group(2).strip(), ''
            continue
        if content: content += '\n'
        content += l
    units.append(content)
    path = os.path.join(out, virtual)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(units[index].encode('utf-8'))
    print('%s=%s' % (virtual, path))
PY
  for s in "$D"/data/synthetic/*; do echo "$(basename "$s")=$s" >> "$T/args.txt"; done
  xargs -n 400 "$O" bind "$T/new" < "$T/args.txt"
  local ok=0 bad=0 names=""
  for g in "$T"/old/dumps/*.bind.txt; do if cmp -s "$g" "$T/new/$(basename "$g")"; then ok=$((ok+1)); else bad=$((bad+1)); names="$names $(basename "$g")"; fi; done
  if [ $bad -eq 0 ]; then note "identical ($ok dumps)" "$D/data/bind-dumps.tar.gz"; else note "differs ($bad of $((ok+bad)) dumps:$(echo "$names" | cut -c1-200))" "$D/data/bind-dumps.tar.gz"; fi
}

f_init() {
  family=init
  local D=$N/checker-core-scratch/groundtruth T=$R/init
  rm -rf "$T"; mkdir -p "$T"
  local I=$D/inputs L=$BLIB A=$D/inputs/alias
  local LIB="lib.es5.d.ts=$L/lib.es5.d.ts lib.decorators.d.ts=$L/lib.decorators.d.ts lib.decorators.legacy.d.ts=$L/lib.decorators.legacy.d.ts"
  "$O" init min.ts=$I/min.ts > "$T/out.strict.nolib.txt"
  "$O" init -nostrict min.ts=$I/min.ts > "$T/out.nostrict.nolib.txt"
  "$O" init -exact min.ts=$I/min.ts > "$T/out.exact.nolib.txt"
  "$O" init $LIB min.ts=$I/min.ts > "$T/out.strict.es5.txt"
  "$O" init -nostrict $LIB min.ts=$I/min.ts > "$T/out.nostrict.es5.txt"
  "$O" init -max 0 $LIB a.ts=$I/a.ts b.ts=$I/b.ts m1.ts=$I/m1.ts m2.ts=$I/m2.ts > "$T/out.merge.es5.txt"
  "$O" init -aliases lib1.ts=$A/lib1.ts lib2.ts=$A/lib2.ts lib3.ts=$A/lib3.ts eq.ts=$A/eq.ts cyc1.ts=$A/cyc1.ts cyc2.ts=$A/cyc2.ts user.ts=$A/user.ts > "$T/out.aliases.txt"
  for g in "$D"/out/*.txt; do same "$g" "$T/$(basename "$g")"; done
}

f_layers() {
  family=layers
  local D=$N/checker-type-layers-scratch/groundtruth T=$R/layers
  rm -rf "$T"; mkdir -p "$T"
  (cd "$D/inputs" && for f in min.ts rich.ts zero.ts infer.ts cjs.js cjs2.js; do
    flags="-strict"; case "$f" in *.js) flags="-strict -checkjs";; esac
    "$O" k4 $flags lib.es5.d.ts=$TSLIB/es5.d.ts "$f=$f" > "$T/$f.out.txt"
  done)
  for g in "$D"/out/*.out.txt; do same "$g" "$T/$(basename "$g")"; done
  for g in "$D"/out/*.entered.txt; do note "skipped: function list of a coverage run (cover build, go tool covdata func)" "$g"; done
}

f_rel() {
  family=rel
  local D=$N/checker-relations-and-inference T=$R/rel
  rm -rf "$T"; mkdir -p "$T/td"
  for p in "$D"/groundtruth/inputs/*.ts; do
    local f; f=$(basename "$p" .ts)
    "$O" rel -strict lib.es5.d.ts=$TSLIB/es5.d.ts "$f.ts=$p" > "$T/$f.out.txt"
    same "$D/groundtruth/out/$f.out.txt" "$T/$f.out.txt"
    if [ -x "$OT" ]; then
      "$OT" rel -strict -trace -funcs lib.es5.d.ts=$TSLIB/es5.d.ts "$f.ts=$p" > "$T/$f.trace.txt"
      samegz "$D/groundtruth/out/$f.trace.txt.gz" "$T/$f.trace.txt"
    else
      note "skipped: needs the trace build" "$D/groundtruth/out/$f.trace.txt.gz"
    fi
  done
  # The function list (-funcs) is only in the first of the three stored outputs.
  for f in min rel2 chain; do
    if [ -x "$OT" ]; then
      local funcs=""; [ "$f" = min ] && funcs="-funcs"
      "$OT" rel -strict -trace $funcs lib.es5.d.ts=$TSLIB/es5.d.ts "$f.ts=$D/top-down/probe/$f.ts" > "$T/td/$f.out.txt"
      same "$D/top-down/probe/$f.out.txt" "$T/td/$f.out.txt"
    else
      note "skipped: needs the trace build" "$D/top-down/probe/$f.out.txt"
    fi
  done
  note "skipped: condensed by hand from a rel-all trace, the condenser was not stored" "$D/groundtruth/out/k4.relation-tree.txt"
}

f_ecf() {
  family=ecf
  local D=$N/checker-expressions-calls-flow T=$R/ecf
  rm -rf "$T"; mkdir -p "$T/inputs" "$T/bu" "$T/td"
  local L5="lib.es5.d.ts=$TSLIB/es5.d.ts" LIBS="lib.es5.d.ts=$TSLIB/es5.d.ts" l f
  for l in es2015.core es2015.symbol es2015.symbol.wellknown es2015.iterable es2015.generator es2015.promise es2015.collection; do LIBS="$LIBS lib.$l.d.ts=$TSLIB/$l.d.ts"; done
  cp "$D"/bottom-up/groundtruth/inputs/*.ts "$T/inputs/"
  python3 "$D/bottom-up/groundtruth/gen.py" "$T/inputs"
  (cd "$T/inputs"
    "$O" check -strict $L5 min.ts=min.ts > "$T/bu/min.out.txt" 2>&1
    for f in flow reach calls ctx oper access literal func more; do "$O" check -strict -suggestions $LIBS $f.ts=$f.ts > "$T/bu/$f.out.txt" 2>&1; done
    for f in postsuper toolarge edge1999 edge2000 deepbin deepor; do "$O" check -strict -suggestions $L5 $f.ts=$f.ts > "$T/bu/$f.out.txt" 2>&1; done)
  for g in "$D"/bottom-up/groundtruth/out/*.out.txt; do same "$g" "$T/bu/$(basename "$g")"; done
  local ARGS; ARGS=$(while read -r f; do printf '%s=%s/%s ' "$f" "$BLIB" "$f"; done < "$D/top-down/groundtruth/libs.es2025.txt")
  (cd "$D/top-down/groundtruth/inputs"
    "$O" check -strict $ARGS min.ts=min.ts > "$T/td/min.default-libs.out.txt" 2>&1
    "$O" check -strict lib.es5.d.ts=$BLIB/lib.es5.d.ts min.ts=min.ts > "$T/td/min.es5-only.out.txt" 2>&1
    for f in flow1 calls1 unreach1; do "$O" check -strict $ARGS $f.ts=$f.ts > "$T/td/$f.out.txt" 2>&1; done
    for f in flow1 unreach1; do "$O" check -strict -unreachable-error $ARGS $f.ts=$f.ts > "$T/td/$f.unreachable-error.out.txt" 2>&1; done)
  for g in "$D"/top-down/groundtruth/out/*.out.txt; do same "$g" "$T/td/$(basename "$g")"; done
  for g in "$D"/top-down/groundtruth/out/*.blocks.tsv; do note "skipped: block list of a coverage run (cover build)" "$g"; done
}

f_decl() {
  family=decl
  local D=$N/checker-declarations-grammar-jsx T=$R/decl
  rm -rf "$T"; mkdir -p "$T/res" "$T/lines" "$T/td"
  local G=$D/bottom-up/groundtruth name flags libs files args l f
  (cd "$G/inputs" && while IFS='|' read -r name flags libs files; do
    [ -z "$name" ] && continue
    args=""
    for l in $libs; do args="$args lib.$l.d.ts=$TSLIB/$l.d.ts"; done
    for f in $files; do args="$args $f=$f"; done
    case "$name" in
      jsx_badfactory) "$O" decl -strict -o jsx=#3 -o "jsxFactory=h create" $args > "$T/res/$name.out.txt" 2>&1 ;;
      *) "$O" decl $flags $args > "$T/res/$name.out.txt" 2>&1 ;;
    esac
  done < "$G/runs.txt")
  local i=0 line
  : > "$T/res/grammar_lines.out.txt"
  while IFS= read -r line; do
    i=$((i+1)); f=$(printf 'g%03d.ts' $i)
    printf 'declare const o: any; declare function dec(...a: any[]): any; declare class A1 {} declare class B1 {} interface I1 {} interface I2 {}\n%b\n' "$line" > "$T/lines/$f"
    { printf -- '--- %d: %b\n' "$i" "$line"; (cd "$T/lines" && "$O" decl -strict -o target=#4 lib.es5.d.ts=$TSLIB/es5.d.ts lib.decorators.d.ts=$TSLIB/decorators.d.ts mod_a.ts="$G/inputs/mod_a.ts" $f=$f 2>&1) | grep "^PARSE g\|^g[0-9]\|^  \|^panic\|^goroutine\|^global" | sed 's/^PARSE g[0-9]*\.ts //' | sed "s/^g[0-9]*\.ts/L/"; } >> "$T/res/grammar_lines.out.txt"
  done < "$G/inputs/grammar_lines.txt"
  for g in "$G"/out/*.out.txt; do same "$g" "$T/res/$(basename "$g")"; done
  local P=$D/top-down/probes
  one() { local n=$1 file=$2; shift 2; (cd "$P" && "$O" decl "$@" lib.es5.d.ts=$TSLIB/es5.d.ts $file=$file) > "$T/td/$n.out.txt" 2>&1; same "$P/$n.out.txt" "$T/td/$n.out.txt"; }
  one expando expando.ts -strict
  one tsjsdoc tsjsdoc.ts -strict -sugg -o noUnusedLocals=true
  one tlamod tlamod.ts -strict -o module=#1
  one tlamod2 tlamod.ts -strict -o module=#99 -o target=#9
  "$O" pien < "$P/pien.txt" > "$T/td/pien.out.txt"
  same "$P/pien.out.txt" "$T/td/pien.out.txt"
}

f_printer() {
  family=printer
  local D=$N/checker-type-printer T=$R/printer
  rm -rf "$T"; mkdir -p "$T/decls" "$T/probes" "$T/corpus"
  local f
  (cd "$D/bottom-up/groundtruth/inputs" && for f in *.ts; do
    "$O" print-decls -strict lib.es5.d.ts=$TSLIB/es5.d.ts "$f=$f" > "$T/decls/$f.strings.tsv"
    "$O" print-decls -strict -notrunc lib.es5.d.ts=$TSLIB/es5.d.ts "$f=$f" > "$T/decls/$f.strings.notrunc.tsv"
  done)
  for g in "$D"/bottom-up/groundtruth/out/*.tsv; do same "$g" "$T/decls/$(basename "$g")"; done
  # top-down/probes/<name>.out.txt: the k4 sub-command without its two counter lines
  (cd "$D/top-down/probes" && for f in min.ts trunc1.ts trunc2.ts utf8cut_a.ts utf8cut_b.ts objlit.ts sigs.ts stage_types.ts stage_scope.ts stage_syms.ts stage_more.ts; do
    extra=""; case "$f" in stage_syms.ts) extra="lib.es2015.symbol.d.ts=$TSLIB/es2015.symbol.d.ts mod.ts=mod.ts";; esac
    "$O" k4 -strict lib.es5.d.ts=$TSLIB/es5.d.ts $extra "$f=$f" | grep -v '^RESOLUTIONDEPTH\|^COUNTS' > "$T/probes/${f%.ts}.out.txt"
  done)
  for g in "$D"/top-down/probes/*.out.txt; do same "$g" "$T/probes/$(basename "$g")"; done
  for g in "$D"/top-down/probes/*.fns.txt; do note "skipped: function list of a coverage run (cover build)" "$g"; done
  # The three corpus oracles: the argument texts of the reference's error baselines through the printer probes.
  python3 "$D/bottom-up/py/typecorpus.py" "$T/corpus/texts.tsv" > /dev/null
  cut -f3- "$T/corpus/texts.tsv" | "$O" print-rt all > "$T/corpus/roundtrip.tsv"
  samegz "$D/bottom-up/data/printer-roundtrip.tsv.gz" "$T/corpus/roundtrip.tsv"
  awk -F'\t' '$1=="TYPE-SAME"{printf "declare const __v%d: %s;\n", n++, $2}' "$T/corpus/roundtrip.tsv" > "$T/corpus/vars.ts"
  awk -F'\t' '$1=="TYPE-SAME"{printf "__v%d\t%s\n", n++, $2}' "$T/corpus/roundtrip.tsv" > "$T/corpus/vars.index.tsv"
  "$O" print-types -strict lib.es5.d.ts=$TSLIB/es5.d.ts vars.ts="$T/corpus/vars.ts" > "$T/corpus/typestrings.raw.tsv"
  "$O" print-types -strict -notrunc lib.es5.d.ts=$TSLIB/es5.d.ts vars.ts="$T/corpus/vars.ts" > "$T/corpus/typestrings.notrunc.raw.tsv"
  paste "$T/corpus/vars.index.tsv" "$T/corpus/typestrings.raw.tsv" | cut -f1,2,4- > "$T/corpus/typestrings.tsv"
  paste "$T/corpus/vars.index.tsv" "$T/corpus/typestrings.notrunc.raw.tsv" | cut -f1,2,4- > "$T/corpus/typestrings.notrunc.tsv"
  samegz "$D/bottom-up/data/typestrings.tsv.gz" "$T/corpus/typestrings.tsv"
  samegz "$D/bottom-up/data/typestrings.notrunc.tsv.gz" "$T/corpus/typestrings.notrunc.tsv"
  python3 "$D/top-down/py/texts.py" "$T/corpus/distinct-args.txt" > /dev/null
  "$O" print-clone "$T/corpus/distinct-args.txt" strip > "$T/corpus/rt.strip.out"
  grep '^ok' "$T/corpus/rt.strip.out" | cut -f2 > "$T/corpus/roundtrip-texts.txt"
  grep '^diff' "$T/corpus/rt.strip.out" > "$T/corpus/roundtrip-diff.tsv"
  grep '^noparse' "$T/corpus/rt.strip.out" | cut -f2 > "$T/corpus/roundtrip-noparse.txt"
  samegz "$D/top-down/data/roundtrip-texts.txt.gz" "$T/corpus/roundtrip-texts.txt"
  same "$D/top-down/data/roundtrip-diff.tsv" "$T/corpus/roundtrip-diff.tsv"
  same "$D/top-down/data/roundtrip-noparse.txt" "$T/corpus/roundtrip-noparse.txt"
}

f_e2e() {
  family=e2e
  local D=$N/end-to-end-k4-k5/vectors T=$R/e2e
  rm -rf "$T"; mkdir -p "$T/run" "$T/order"
  printf 'const x: number = "s";\n' > "$T/run/min.ts"
  printf 'const x: number = "s";\n' > "$T/run/a.ts"
  local g name opt
  for g in "$D"/program-order/*.txt; do
    name=$(basename "$g" .txt)
    case "$name" in
      target-default) opt="" ;;
      target-*) opt="--target ${name#target-}" ;;
      lib-*) opt="--lib $(echo "${name#lib-}" | tr '+' ',')" ;;
    esac
    (cd "$T/run" && "$O" tsc min.ts --noEmit --listFiles $opt | grep '^bundled' | sed 's#bundled:///libs/##') > "$T/order/$name.txt"
    same "$g" "$T/order/$name.txt"
  done
  (cd "$T/run" && "$O" tsc min.ts --noEmit > "$T/k4.txt" 2>&1; echo "exit=$?" >> "$T/k4.txt")
  printf 'min.ts(1,7): error TS2322: Type '"'"'string'"'"' is not assignable to type '"'"'number'"'"'.\nexit=2\n' > "$T/k4.expected.txt"
  if cmp -s "$T/k4.txt" "$T/k4.expected.txt"; then note identical "K4 line of goals/typecheck.md through the real command line"; else note differs "K4 line of goals/typecheck.md through the real command line"; fi
  # The stored output was made in /tmp/e2e/run3 with these three files, and one message holds that path.
  mkdir -p "$T/run3"
  printf 'export const x = 1;\n' > "$T/run3/a.ts"
  printf 'export const y = 1;\n' > "$T/run3/b.js"
  printf 'export const z = <div/>;\n' > "$T/run3/c.tsx"
  : > "$T/verify.txt"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    { echo ">>> $line"; (cd "$T/run3" && "$O" tsc $line 2>&1; echo "exit=$?"); } >> "$T/verify.txt"
  done < "$D/verify-compiler-options.cases.txt"
  sed "s#/tmp/e2e/run3#$T/run3#g" "$D/verify-compiler-options.txt" > "$T/verify.expected.txt"
  if cmp -s "$T/verify.expected.txt" "$T/verify.txt"; then note "identical (the run directory replaced)" "$D/verify-compiler-options.txt"; else note differs "$D/verify-compiler-options.txt"; fi
}

f_diagfmt() {
  family=diagfmt
  local D=$N/diagnostics-groundtruth/golden T=$R/diagfmt
  rm -rf "$T"; mkdir -p "$T"
  local n
  for n in vectors.txt vectors-external.txt; do gzip -dc "$D/$n.gz" > "$T/$n"; done
  gzip -dc "$D/go-keys.out.gz" | grep -o '^KEY [0-9]*' > "$T/vectors-keys.txt"
  "$O" diagfmt < "$T/vectors.txt" > "$T/go.out"
  "$O" diagfmt < "$T/vectors-external.txt" > "$T/go-external.out"
  "$O" diagfmt < "$T/vectors-keys.txt" > "$T/go-keys.out"
  samegz "$D/go.out.gz" "$T/go.out"
  samegz "$D/go-external.out.gz" "$T/go-external.out"
  samegz "$D/go-keys.out.gz" "$T/go-keys.out"
}

# The structural goldens of this directory (golden/types): see golden/types/RUNS.txt for the command of each.
f_types() {
  family=types
  local G=$HERE/golden/types T=$R/types name args
  [ -f "$G/RUNS.txt" ] || { note "skipped: no RUNS.txt" "$G"; return; }
  rm -rf "$T"; mkdir -p "$T"
  while IFS='|' read -r name args; do
    [ -z "$name" ] && continue
    (cd "$HERE/fixtures" && eval "\"$O\" types $args" | "$O" canon) > "$T/$name.types.txt" 2>&1
    same "$G/$name.types.txt" "$T/$name.types.txt"
  done < <(sed -e "s#\$TSLIB#$TSLIB#g" -e "s#\$BLIB#$BLIB#g" "$G/RUNS.txt")
}

f_digests() {
  family=digests
  local D=$N/ts-dump-and-test-importer/top-down T=$R/digests
  command -v bun > /dev/null || { note "skipped: needs bun" "$D/golden/cases.tsgo-digests.tsv.gz"; return; }
  rm -rf "$T"; mkdir -p "$T/corpus" "$T/go-out" "$T/lib-go-out" "$T/final"
  sed "s#/tmp/tsimp#$T#g" "$D/probe/mkcorpus.mjs" > "$T/mkcorpus.mjs"
  (cd "$T" && bun mkcorpus.mjs > mkcorpus.log 2>&1)
  (cd "$T/corpus" && ls | awk -v d="$T/corpus" '{print $0"="d"/"$0}' | xargs -n 2000 "$O" tree "$T/go-out")
  (cd "$BLIB" && ls *.d.ts | awk -v d="$BLIB" '{print $0"="d"/"$0}' | xargs "$O" tree "$T/lib-go-out")
  cp "$D"/probe/* "$T/final/"
  local manifest; manifest=$(ls "$T"/corpus.manifest.json "$T"/manifest.json 2>/dev/null | head -1)
  (cd "$T/final" && bun golden.ts "$T/go-out" "$T/corpus" "$manifest" "$T/cases.tsv" > golden.log 2>&1; bun golden.ts "$T/lib-go-out" "$BLIB" - "$T/libs.tsv" >> golden.log 2>&1)
  samegz "$D/golden/cases.tsgo-digests.tsv.gz" "$T/cases.tsv"
  same "$D/golden/libs.tsgo-digests.tsv" "$T/libs.tsv"
}

f_manifest() {
  family=manifest
  local D=$N/drivers-k4-k5 T=$R/manifest
  rm -rf "$T"; mkdir -p "$T"
  "$O" manifest "$T" > "$T/test.log" 2>&1
  tail -2 "$T/test.log"
  # The instances finish in any order: compare the sorted lines.
  LC_ALL=C sort "$T/manifest.jsonl" > "$T/new.sorted"
  gzip -dc "$D/top-down/data/manifest.with-opts.jsonl.gz" | LC_ALL=C sort > "$T/old.sorted"
  if cmp -s "$T/new.sorted" "$T/old.sorted"; then note "identical as a set of $(wc -l < "$T/new.sorted") lines" "$D/top-down/data/manifest.with-opts.jsonl.gz"; else note "differs ($(comm -3 "$T/new.sorted" "$T/old.sorted" | wc -l) lines)" "$D/top-down/data/manifest.with-opts.jsonl.gz"; fi
}

[ $# -eq 0 ] && set -- tree lowering bind init layers rel ecf decl printer e2e diagfmt types
for fam in "$@"; do
  case "$fam" in
    tree|lowering|bind|init|layers|rel|ecf|decl|printer|e2e|diagfmt|types|digests|manifest) "f_$fam" ;;
    *) echo "replay: unknown family $fam"; exit 2 ;;
  esac
done
awk -F'\t' '{ s=$1; sub(/ \(.*/, "", s); sub(/:.*/, "", s); n[$2" "s]++ } END { for (k in n) print n[k], k }' "$R/status.tsv" | sort -k2
grep -c '^differs' "$R/status.tsv" > /dev/null && { echo "replay: some goldens differ, see $R/status.tsv"; grep '^differs' "$R/status.tsv" | head -20; exit 1; }
echo "replay: every golden that was regenerated is identical ($R/status.tsv)"
