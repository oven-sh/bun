#!/bin/bash
# A parse without lint against main: both harnesses with two binaries over the corpora, then diff.mjs with an empty cause list.
# usage: /workspace/tools/lk bash run-proof.sh <tag> <next binary> [corpus ...]
#   corpus   testrows comments targeted small small-sub check, or a name with $OUT/corpus.<name>.json
#            (mk-real-corpora.mjs <OUT> writes tscases, repo-ts and repo-js there)
#            default: testrows comments targeted small
#   env      BASE=<binary>   JOBS=<workers, default 4>   OUT=<scratch, default /tmp/parser-r3-proof>
#            KEEP=<where the logs and tables go>   EXPECT=zero|differ|causes   CAUSES=<cause list, default the empty one>
#            FINE=1   an error is recorded with the length and offset of its range, its level and its notes too
# Run files (*.jsonl.gz, *.jsonl) stay under $OUT. Only text (logs, tables, sums) is copied to $KEEP/<tag>/.
# The body is one function, so that an edit of this file during a run does not reach the run.
set -u
main() {
N=/workspace/notes/lint/units/parser
TAG=${1:?usage: run-proof.sh <tag> <next binary> [corpus ...]}
NEXT=${2:?usage: run-proof.sh <tag> <next binary> [corpus ...]}
shift 2
CORPORA=${*:-testrows comments targeted small}
BASE=${BASE:-/workspace/base/bun.f4d755a9c}
JOBS=${JOBS:-4}
OUT=${OUT:-/tmp/parser-r3-proof}
KEEP=${KEEP:-$N/round3/proof-behaviour/runs}
EXPECT=${EXPECT:-zero}
CAUSES=${CAUSES:-$N/grammar-diff/causes.mjs}
JUDGE=${JUDGE:-/usr/local/bin/bun}
HARNESSES="main extra"
[ "${FINE:-0}" = 1 ] && HARNESSES="main-fine extra-fine"
W=${W:-/workspace/wt/parser}
export BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

corpus_path() {
  case $1 in
    small) echo "$N/grammar-diff/corpus.small.json" ;;
    targeted) echo "$N/round2/grammar-diff-run/bottom-up/runs/corpus.targeted.with-09.json" ;;
    testrows) echo "$N/grammar-diff-oracle-and-causes/runs/corpus.testrows.json" ;;
    small-sub) echo "$N/grammar-diff-oracle-and-causes/runs/corpus.small-sub.json" ;;
    comments) echo "$N/round2/a1-differential/top-down/blind-spots/corpus.comments.json" ;;
    check) echo "$N/round2/grammar-diff-run/bottom-up/runs/corpus.check.json" ;;
    *) echo "$OUT/corpus.$1.json" ;;
  esac
}
corpus_sha() {
  case $1 in
    small) echo 19d140cdf29b4cfcc6682bf827642a0c3e138ad34a120867b0e0e21e35e3dc81 ;;
    targeted) echo 68d65cd91163a1d165a2f68da19054bf895024e4459ef6cce03977fc56b63487 ;;
    testrows) echo 7188b5c7588d722ca533abf19b0cbb748c320eff2832baaf435fdc2005c84e64 ;;
    small-sub) echo edb744ab7286d2fc7d774bea188dde4eb861f3bfd97160ba108de5b68f279bc4 ;;
    comments) echo 71d0420c2a27660af8b170c55dcd131691fae4572942f7967c76287733444b4f ;;
    check) echo 15d1162dae521e3aa0b922b920c939dd0fbcaff418e3b9cb8d7dd13b687d899a ;;
    *) echo any ;;
  esac
}
harness_path() {
  case $1 in
    main) echo "$N/grammar-diff/harness.mjs" ;;
    extra) echo "$N/round2/a1-differential/top-down/blind-spots/harness.extra-apis.mjs" ;;
    main-fine) echo "$OUT/fine/harness.main.mjs" ;;
    extra-fine) echo "$OUT/fine/harness.extra.mjs" ;;
  esac
}
harness_apis() { case $1 in main*) echo 15 ;; extra*) echo 7 ;; esac; }
# A copy of a harness whose error record is [message, line, column, length, offset, level, notes].
make_fine() {
  mkdir -p "$OUT/fine"
  "$JUDGE" -e '
    const fs = require("fs");
    const [from, to] = process.argv.slice(1);
    const text = fs.readFileSync(from, "utf8");
    const old = "  return list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null]);";
    if (text.split(old).length !== 2) throw new Error("the line of errorsOf is not in " + from);
    const fine = "  const at = p => [p?.line ?? null, p?.column ?? null, p?.length ?? null, p?.offset ?? null];\n  return list.map(x => [String(x?.message ?? x), ...at(x?.position), x?.level ?? null, (x?.notes ?? []).map(n => [String(n?.message ?? n), ...at(n?.position)])]);";
    fs.writeFileSync(to, text.replace(old, () => fine));
  ' "$1" "$2"
}

FAIL=0
USED=
fail() { echo "FAIL $*"; FAIL=1; }
step() { echo "== $(date -u +%H:%M:%S) $*"; }

[ -x "$BASE" ] || { echo "no base binary $BASE"; exit 2; }
[ -x "$NEXT" ] || { echo "no next binary $NEXT"; exit 2; }
[ -x "$JUDGE" ] || { echo "no judge binary $JUDGE"; exit 2; }
if [ "${FINE:-0}" = 1 ]; then
  mkdir -p "$OUT" || exit 2
  make_fine "$(harness_path main)" "$(harness_path main-fine)" && make_fine "$(harness_path extra)" "$(harness_path extra-fine)" || exit 2
fi
BASE_SHA=$(sha256sum "$BASE" | cut -c1-64)
NEXT_SHA=$(sha256sum "$NEXT" | cut -c1-64)
B=$OUT/base.${BASE_SHA:0:12}
D=$OUT/$TAG
mkdir -p "$B" "$D" || exit 2
rm -f "$D"/*.txt "$D"/*.log "$D"/*.jsonl "$D"/*.jsonl.gz
{
  step "start tag=$TAG expect=$EXPECT jobs=$JOBS corpora=$CORPORA"
  echo "base $BASE_SHA $BASE $("$BASE" --revision 2>&1 | tail -1)"
  echo "next $NEXT_SHA $NEXT $("$NEXT" --revision 2>&1 | tail -1)"
  echo "tree $(git -C "$W" rev-parse HEAD) changed-files-under-src=$(git -C "$W" status --short -- src | wc -l) main-commits-after-f4d755a9cf=$(git -C "$W" log --oneline f4d755a9cf..HEAD | grep -cE "\(#[0-9]+\)$") next-mtime=$(stat -c %y "$NEXT" | cut -c1-19)"
  echo "harnesses $HARNESSES"
  echo "tools $(sha256sum "$(harness_path main)" "$(harness_path extra)" "$N/grammar-diff/diff.mjs" | cut -c1-16 | tr "\n" " ")"
  echo "judge $JUDGE $("$JUDGE" --revision 2>&1 | tail -1)"
  echo "causes $CAUSES: $("$JUDGE" -e 'const c = (await import(process.argv[1])).default; console.log(c.length + " entries")' "$CAUSES" 2>&1)"
  env | grep -E "^(BUN_FEATURE_FLAG_|BUN_DEBUG_QUIET_LOGS|BUN_GARBAGE_COLLECTOR_LEVEL|BUN_JSC_|BUN_NO_CORE_DUMP|ASAN_OPTIONS|LSAN_OPTIONS)" | sort | tr '\n' ' '
  echo
} | tee "$D/RESULT.txt"

# <binary> <harness> <corpus> <out.jsonl.gz>
harness() {
  local bin=$1 h=$2 c=$3 out=$4 log=${4%.jsonl.gz}.log
  rm -f "$out"
  (cd "$OUT" && "$bin" "$(harness_path "$h")" "$(corpus_path "$c")" "$out" "--jobs=$JOBS") > "$log" 2>&1
  local rc=$?
  tail -2 "$log"
  [ "$rc" -eq 0 ] && [ -s "$out" ] || { fail "harness $h $c with $bin: rc=$rc"; return 1; }
  grep -q ": $5 inputs x $(harness_apis "$h") apis, 0 crashes" "$log" || fail "harness $h $c with $bin: inputs, apis or crashes are not as expected"
}

for c in $CORPORA; do
  cpath=$(corpus_path "$c")
  [ -s "$cpath" ] || { fail "no corpus $cpath"; continue; }
  want=$(corpus_sha "$c")
  csha=$(sha256sum "$cpath" | cut -c1-64)
  [ "$want" = any ] || [ "$csha" = "$want" ] || { fail "corpus $c changed: $cpath"; continue; }
  count=$("$JUDGE" -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(c.forms.length * Object.keys(c.contexts).length + c.sources.length)' "$cpath")
  for h in $HARNESSES; do
    b=$B/$h.$c.${csha:0:8}.jsonl.gz
    n=$D/$h.$c.jsonl.gz
    if [ ! -s "$b" ]; then
      step "harness base $h $c"
      harness "$BASE" "$h" "$c" "$b" "$count" || continue
    fi
    cp "${b%.jsonl.gz}.log" "$D/base.$h.$c.log"
    step "harness next $h $c"
    harness "$NEXT" "$h" "$c" "$n" "$count" || continue
    USED="$USED $b $n"
    for side in "$b" "$n"; do
      [ "$(zcat "$side" | grep -c '"crash":')" = 0 ] || fail "crash or hang records in $side"
    done
    "$JUDGE" "$N/grammar-diff/diff.mjs" "$b" "$n" "--causes=$CAUSES" "--out=$D/$h.$c.diff.jsonl" --show=2 > "$D/$h.$c.diff.txt" 2>&1
    rc=$?
    line=$(sed -n 3p "$D/$h.$c.diff.txt")
    compared=$((count * $(harness_apis "$h")))
    case $EXPECT in
      zero)
        [ "$rc" -eq 0 ] && [ "$line" = "$compared records compared, 0 differ, in 0 sources" ] && verdict=PASS || { verdict=FAIL; FAIL=1; }
        ;;
      differ)
        [ "$rc" -eq 1 ] && echo "$line" | grep -Eq "^$compared records compared, [1-9][0-9]* differ, in [1-9][0-9]* sources$" && verdict=DETECTED || { verdict=FAIL; FAIL=1; }
        ;;
      causes)
        [ "$rc" -eq 0 ] && echo "$line" | grep -Eq "^$compared records compared, " && verdict=PASS || { verdict=FAIL; FAIL=1; }
        ;;
    esac
    classes=$(grep -E '^(!!|  ) +[0-9]+  ' "$D/$h.$c.diff.txt" | sed 's/^!!//' | awk '{ n[$2 " " $3] += $1 } END { for (k in n) printf "%s=%d; ", k, n[k] }')
    echo "$verdict $h $c: $line (diff rc=$rc) ${classes}" | tee -a "$D/RESULT.txt"
  done
done

{
  echo "run files:"
  [ -z "$USED" ] || sha256sum $USED | sed "s|$OUT/||"
  [ "$FAIL" -eq 0 ] && echo "RESULT $TAG: OK (expect=$EXPECT)" || echo "RESULT $TAG: FAILED (expect=$EXPECT)"
} | tee -a "$D/RESULT.txt"
step done

mkdir -p "$KEEP/$TAG"
for f in "$D"/*.txt "$D"/*.log; do
  [ "$(stat -c %s "$f")" -le 262144 ] && cp "$f" "$KEEP/$TAG/" || head -c 262144 "$f" > "$KEEP/$TAG/$(basename "$f").head"
done
exit "$FAIL"
}
main "$@"
