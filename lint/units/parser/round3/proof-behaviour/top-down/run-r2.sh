#!/bin/bash
# What a parse without lint does with every input: the base binary against a binary under test, record by record.
# The only passing result is zero differing records in every pair of runs.
#   /workspace/tools/lk bash run-r2.sh <tag> <bun under test> [workers of the binary under test] [step ...]
# steps: testrows comments targeted small-sub small bench files runtime
#        default: testrows comments targeted bench small files runtime
#   testrows .. bench  a corpus through harness.mjs (15 configurations) and harness.extra-apis.mjs (7 configurations)
#   bench              the inputs of the transpiler benchmark (notes/lint/benchroot), made into a corpus in R2_OUT
#   files              every tracked TypeScript and JavaScript file under test/ and src/js of R2_TREE, hashes of the outputs
#   runtime            testrows, comments, targeted, small-sub and bench as modules that the runtime loads and never
#                      evaluates: the entries of the runtime transpiler cache (version, output, source map, module record)
# env: R2_BASE  the base binary                      default /workspace/base/bun.f4d755a9c
#      R2_OUT   raw runs, never inside the notes     default /tmp/parser-r2
#      R2_TREE  the checkout that `files` reads      default /workspace/wt/parser
#      R2_SAVE  a directory that gets the summary, the tables and the one-line logs (small text files only)
# A binary with debug assertions adds " (token: T...)" to the message of Lexer::expect_contextual_keyword: its runs are
# compared after that text is removed (the version of such a binary contains "-debug").
set -u
N=/workspace/notes/lint/units/parser
BASE=${R2_BASE:-/workspace/base/bun.f4d755a9c}
OUT=${R2_OUT:-/tmp/parser-r2}
TREE=${R2_TREE:-/workspace/wt/parser}
[ $# -ge 2 ] || { echo "usage: run-r2.sh <tag> <bun under test> [workers] [step ...]"; exit 2; }
TAG=$1
NEXT=$(readlink -f "$2")
JOBS=${3:-4}
shift; shift; [ $# -gt 0 ] && shift
[ $# -gt 0 ] || set -- testrows comments targeted bench small files runtime
[ -x "$BASE" ] && [ -x "$NEXT" ] || { echo "missing binary: $BASE or $NEXT"; exit 2; }
case "$OUT" in /workspace/notes*) echo "R2_OUT must be outside the notes"; exit 2 ;; esac
MAIN=$N/grammar-diff/harness.mjs
EXTRA=$N/round2/a1-differential/top-down/blind-spots/harness.extra-apis.mjs
sha() { sha256sum "$1" | cut -c1-12; }
B=$OUT/base.$(sha "$BASE")
D=$OUT/$TAG.$(sha "$NEXT")
mkdir -p "$B" "$D"
ENVS="BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NO_COLOR=1"
NEXT_VERSION=$(env $ENVS "$NEXT" --revision)
case "$NEXT_VERSION" in *-debug*) STRIP=1 ;; *) STRIP=0 ;; esac

corpus() {
  case $1 in
    small) echo "$N/grammar-diff/corpus.small.json" ;;
    small-sub) echo "$N/grammar-diff-oracle-and-causes/runs/corpus.small-sub.json" ;;
    targeted) echo "$N/round2/grammar-diff-run/bottom-up/runs/corpus.targeted.with-09.json" ;;
    testrows) echo "$N/grammar-diff-oracle-and-causes/runs/corpus.testrows.json" ;;
    comments) echo "$N/round2/a1-differential/top-down/blind-spots/corpus.comments.json" ;;
    bench) echo "$OUT/corpus.bench.json" ;;
  esac
}

cat > "$OUT/classes.mjs" <<'JS'
import { readFileSync } from "node:fs";
const table = {};
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  const key = `${d.api.padEnd(16)} ${d.cls}`;
  table[key] = (table[key] ?? 0) + 1;
}
for (const key of Object.keys(table).sort()) console.log(`        ${key.padEnd(28)} ${table[key]}`);
JS

cat > "$OUT/strip-debug-suffix.mjs" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
const [inPath, outPath] = process.argv.slice(2);
const lines = gunzipSync(readFileSync(inPath)).toString("utf8").split("\n").filter(Boolean);
const suffix = /^(Expected "[^]*" but found "[^]*") \(token: T[A-Za-z]+\)$/;
let changed = 0;
const out = [lines[0]];
for (let i = 1; i < lines.length; i++) {
  const r = JSON.parse(lines[i]);
  let here = 0;
  const vals = [];
  const keys = new Map();
  const res = [];
  for (const at of r.res ?? []) {
    let value = r.vals[at];
    if (value[0] === "e") {
      value = ["e", value[1].map(([message, line, column]) => {
        const m = suffix.exec(message);
        if (m) here++;
        return [m ? m[1] : message, line, column];
      })];
    }
    const key = JSON.stringify(value);
    let index = keys.get(key);
    if (index === undefined) {
      index = vals.length;
      vals.push(value);
      keys.set(key, index);
    }
    res.push(index);
  }
  changed += here;
  out.push(here === 0 ? lines[i] : JSON.stringify({ ...r, res, vals }));
}
writeFileSync(outPath, gzipSync(out.join("\n") + "\n"));
console.log(`${changed} messages without the text of debug assertions`);
JS

cat > "$OUT/bench-corpus.mjs" <<'JS'
import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/notes/lint/benchroot";
const groups = [
  { name: "bun-types", dir: "packages/bun-types", pattern: "**/*.d.ts", skip: ["ts7.1/"] },
  { name: "typescript-lib", dir: "node_modules/typescript/lib", pattern: "lib*.d.ts" },
  { name: "src-js", dir: "src/js", pattern: "**/*.ts" },
  { name: "tsx", dir: "bench/snippets", pattern: "transpiler-typescript-fixture.tsx" },
  { name: "js-control", dir: "bench/react-hello-world", pattern: "react-hello-world.node.js" },
];
const sources = [];
const seen = new Set();
for (const group of groups) {
  const dir = join(root, group.dir);
  const skip = ["node_modules/", ...(group.skip ?? [])];
  const paths = [...new Glob(group.pattern).scanSync({ cwd: dir })].filter(path => !skip.some(prefix => path.startsWith(prefix) || path.includes("/" + prefix))).sort();
  for (const path of paths) {
    const src = readFileSync(join(dir, path), "utf8");
    if (seen.has(src)) continue;
    seen.add(src);
    sources.push({ src, prod: `${group.name}/${path}` });
  }
}
writeFileSync(process.argv[2], JSON.stringify({ name: "bench", contexts: {}, forms: [], sources }));
JS

cat > "$OUT/files-worker.mjs" <<JS
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { APIS as MAIN } from "$MAIN";
import { APIS as EXTRA } from "$EXTRA";
const [root, outPath] = process.argv.slice(2);
const listed = Bun.spawnSync({ cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"], stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) throw new Error("git ls-files: " + listed.stderr.toString());
const loaderOf = file => (/\.(ts|mts|cts)\$/.test(file) ? "ts" : /\.tsx\$/.test(file) ? "tsx" : /\.(js|mjs|cjs)\$/.test(file) ? "js" : /\.jsx\$/.test(file) ? "jsx" : null);
const files = listed.stdout.toString().split("\0").filter(file => loaderOf(file) !== null);
const apis = [...MAIN, ...EXTRA].map(([name, method, options]) => ({ name, method, loader: options.loader, transpiler: new Bun.Transpiler({ define: { "process.env.NODE_ENV": '"development"' }, ...options }) }));
const strip = Bun.version.includes("-debug") ? text => text.replace(/^(Expected "[^]*" but found "[^]*") \(token: T[A-Za-z]+\)\$/, "\$1") : text => text;
const out = openSync(outPath, "w");
let records = 0;
for (const file of files) {
  let source;
  try {
    source = readFileSync(root + "/" + file);
  } catch {
    continue;
  }
  if (source.length > 4_000_000) continue;
  writeSync(out, JSON.stringify({ start: file }) + "\n");
  const r = [];
  for (const api of apis) {
    if (api.loader !== loaderOf(file)) continue;
    records++;
    try {
      const value = api.transpiler[api.method](source);
      const text = typeof value === "string" ? value : JSON.stringify(value);
      r.push([api.name, "A", text.length, Bun.hash(text).toString(16)]);
    } catch (e) {
      r.push([api.name, "R", (e?.errors?.length ? e.errors : [e]).map(x => [strip(String(x?.message ?? x)), x?.position?.line ?? null, x?.position?.column ?? null])]);
    }
  }
  writeSync(out, JSON.stringify({ file, r }) + "\n");
}
closeSync(out);
console.log(\`\${files.length} files, \${records} records, bun \${Bun.version} \${Bun.revision}\`);
JS

cat > "$OUT/files-diff.mjs" <<'JS'
import { readFileSync } from "node:fs";
const read = path => new Map(readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(x => x.file !== undefined).map(x => [x.file, x.r]));
const [a, b] = [read(process.argv[2]), read(process.argv[3])];
let compared = 0;
let differ = 0;
for (const file of new Set([...a.keys(), ...b.keys()])) {
  const [x, y] = [a.get(file) ?? [], b.get(file) ?? []];
  for (let k = 0; k < Math.max(x.length, y.length); k++) {
    compared++;
    if (JSON.stringify(x[k]) === JSON.stringify(y[k])) continue;
    differ++;
    if (differ <= 40) console.log(`        ${(x[k] ?? y[k])[0].padEnd(16)} ${x[k]?.[1] ?? "missing"}>${y[k]?.[1] ?? "missing"} ${file}`);
  }
}
console.log(`${compared} records compared, ${differ} differ`);
JS

cat > "$OUT/rt-worker.mjs" <<'JS'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [corpusPath, work] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) inputs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) inputs.push(s.src);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
// The first import does not resolve, so the module is transpiled and never evaluated. The padding passes the smallest cached size.
const pad = "\n" + "// padding padding padding padding padding padding padding padding\n".repeat(64);
let evaluated = 0;
for (let i = 0; i < inputs.length; i++) {
  const file = join(work, `s${i}.ts`);
  writeFileSync(file, `import "./does-not-exist.js";\n${inputs[i]}${pad}`);
  try {
    await import(file);
    evaluated++;
  } catch {}
}
rmSync(work, { recursive: true, force: true });
console.log(`${inputs.length} modules, ${evaluated} evaluated`);
JS

cat > "$OUT/rt-sum.mjs" <<'JS'
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const versions = new Set();
const lines = [];
for (const name of readdirSync(dir).filter(n => n.endsWith(".pile")).sort()) {
  const bytes = readFileSync(join(dir, name));
  versions.add(bytes.readUInt32LE(0));
  lines.push(`${name} ${bytes.length} ${new Bun.CryptoHasher("sha256").update(bytes.subarray(4)).digest("hex")}`);
}
console.log(`versions ${[...versions].sort().join(",")} entries ${lines.length}`);
console.log(lines.join("\n"));
JS

# One run of a harness. It is skipped when its output exists: the directory name holds the hash of the binary.
one_run() {
  local bin=$1 workers=$2 hfile=$3 cfile=$4 out=$5 log=${5%.jsonl.gz}.log rc
  [ -s "$out" ] && return 0
  (cd "$OUT" && env $ENVS "$bin" "$hfile" "$cfile" "$out" "--jobs=$workers") > "$log" 2>&1
  rc=$?
  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    echo "harness failed, rc=$rc: $log"
    tail -5 "$log"
    return 1
  fi
}
records_sha() { gzip -dc "$1" | tail -n +2 | sha256sum | cut -d' ' -f1; }
# sha256 of the records (the run without its first line) that the release build of main at f4d755a9cf gives.
golden() {
  case $1 in
    main.testrows) echo 77468c48cc326d5a5329afe92ad108182a10d179d7f6b41f925169d0f100a3e2 ;;
    main.comments) echo 034937f8c0a0039e56fee931d37d4db81965d95a4941a5cd7ec8a89d187e8860 ;;
    main.targeted) echo ba2aed306128816e0ddeaf35fee67ea768f4bb6c3139fdef12aa78d819249b5e ;;
    main.small-sub) echo 7bdcb1430a3c03158d37b53f272e85beb0f1edf667a7c4e4b0fdfffd4a56a260 ;;
    main.small) echo 2d9f0eb39865624b3ef690a598ca4497cd937c41dbcb871c3982cd23baa73c0b ;;
    extra.testrows) echo 499643a35586e1312f448d2f48efaa78222889e1f1983e8a2ae55fee5ef378e2 ;;
    extra.comments) echo 8c63964f6cac16cfd666aa3ab592a129997b7014aac7c5ce792bc0abe1db0765 ;;
    extra.targeted) echo 8d963576d4e66888ec4389e6ca9f46f738bdfd4f274f23207d7a7731a1a0ae19 ;;
    extra.small-sub) echo 2c5ab7ff4fc64f0afca2ef969d9c8f06fdbb05a8f46008e47ccc858f2ab95ce0 ;;
    extra.small) echo 4b4a01e5fbdadff0c584d23853b3b7292db84966d458adc9070c7169d236fa83 ;;
  esac
}
field() { sed -nE "s/.*: ([0-9]+) inputs x ([0-9]+) apis, ([0-9]+) crashes.*/\\$2/p" "$1"; }

pair() {
  local h=$1 c=$2 hfile=$3 napis=$4 cfile b n cmpn rc line compared differ bs ns mark gold
  cfile=$(corpus "$c")
  [ -n "$cfile" ] || { echo "FAIL  unknown step $c"; return 1; }
  if [ "$c" = bench ] && [ ! -s "$cfile" ]; then (cd "$OUT" && env $ENVS "$BASE" "$OUT/bench-corpus.mjs" "$cfile") || return 1; fi
  b=$B/$h.$c.jsonl.gz
  n=$D/$h.$c.jsonl.gz
  one_run "$BASE" 4 "$hfile" "$cfile" "$b" || return 1
  one_run "$NEXT" "$JOBS" "$hfile" "$cfile" "$n" || return 1
  cmpn=$n
  if [ $STRIP = 1 ]; then
    cmpn=$D/$h.$c.stripped.jsonl.gz
    "$BASE" "$OUT/strip-debug-suffix.mjs" "$n" "$cmpn" > "$D/$h.$c.stripped.log" 2>&1 || return 1
  fi
  "$BASE" "$N/grammar-diff/diff.mjs" "$b" "$cmpn" "--causes=$N/grammar-diff/causes.mjs" "--out=$D/diff.$h.$c.jsonl" --show=5 > "$D/diff.$h.$c.txt" 2>&1
  rc=$?
  line=$(sed -n 3p "$D/diff.$h.$c.txt")
  compared=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\1/p')
  differ=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\2/p')
  bs=$(records_sha "$b")
  ns=$(records_sha "$cmpn")
  mark=ok
  [ "$rc" = 0 ] && [ "$differ" = 0 ] && [ "$bs" = "$ns" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 2)" = "$napis" ] && [ "$(field "${n%.jsonl.gz}.log" 2)" = "$napis" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 1)" = "$(field "${n%.jsonl.gz}.log" 1)" ] || mark=FAIL
  [ "$compared" = "$(($(field "${b%.jsonl.gz}.log" 1) * napis))" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 3)" = 0 ] && [ "$(field "${n%.jsonl.gz}.log" 3)" = 0 ] || mark=FAIL
  gold=$(golden "$h.$c")
  case "$("$BASE" --revision)" in *+f4d755a9c) [ -z "$gold" ] || [ "$gold" = "$bs" ] || { mark=FAIL; echo "        the base run is not the one of f4d755a9cf: $bs"; } ;; esac
  printf '%-4s  %-5s %-9s sources %-6s x %-2s records %-8s differ %-7s crashes %s/%s  sha256 of the records %s %s\n' \
    "$mark" "$h" "$c" "$(field "${b%.jsonl.gz}.log" 1)" "$napis" "${compared:-?}" "${differ:-?}" \
    "$(field "${b%.jsonl.gz}.log" 3)" "$(field "${n%.jsonl.gz}.log" 3)" "${bs:0:16}" "$([ "$bs" = "$ns" ] && echo = || echo "!= ${ns:0:16}")"
  [ $STRIP = 1 ] && echo "        $(cat "$D/$h.$c.stripped.log")"
  [ "$mark" = ok ] && return 0
  [ -s "$D/diff.$h.$c.jsonl" ] && "$BASE" "$OUT/classes.mjs" "$D/diff.$h.$c.jsonl"
  return 1
}

# Both sides read the checkout as it is now, so this step is never taken from an earlier run.
files() {
  local b=$B/files.jsonl n=$D/files.jsonl mark=ok
  (cd "$OUT" && env $ENVS "$BASE" "$OUT/files-worker.mjs" "$TREE" "$b") > "$B/files.log" 2>&1 || { echo "FAIL  files: the base worker ended early after $(tail -1 "$b" | cut -c1-200), $B/files.log"; return 1; }
  (cd "$OUT" && env $ENVS "$NEXT" "$OUT/files-worker.mjs" "$TREE" "$n") > "$D/files.log" 2>&1 || { echo "FAIL  files: the worker ended early after $(tail -1 "$n" | cut -c1-200), $D/files.log"; return 1; }
  cmp -s "$b" "$n" || mark=FAIL
  printf '%-4s  files           %s | %s  sha256 %s %s\n' "$mark" "$(tail -1 "$B/files.log")" "$(tail -1 "$D/files.log")" \
    "$(sha256sum < "$b" | cut -c1-16)" "$(cmp -s "$b" "$n" && echo = || echo "!= $(sha256sum < "$n" | cut -c1-16)")"
  [ "$mark" = ok ] && return 0
  "$BASE" "$OUT/files-diff.mjs" "$b" "$n" > "$D/diff.files.txt" 2>&1
  cat "$D/diff.files.txt"
  return 1
}

# The cache entries that the runtime transpiler writes for the sources of a corpus, both sides, never from an earlier run.
runtime_one() {
  local c=$1 cfile side dir bin mark=ok
  cfile=$(corpus "$c")
  if [ "$c" = bench ] && [ ! -s "$cfile" ]; then (cd "$OUT" && env $ENVS "$BASE" "$OUT/bench-corpus.mjs" "$cfile") || return 1; fi
  for side in base next; do
    if [ $side = base ]; then dir=$B; bin=$BASE; else dir=$D; bin=$NEXT; fi
    rm -rf "$dir/rt.$c.cache"
    (cd "$OUT" && env $ENVS "BUN_RUNTIME_TRANSPILER_CACHE_PATH=$dir/rt.$c.cache" "$bin" "$OUT/rt-worker.mjs" "$cfile" "$OUT/rt-work") > "$dir/rt.$c.log" 2>&1 \
      || { echo "FAIL  runtime $c: the $side run ended early, $dir/rt.$c.log"; return 1; }
    "$BASE" "$OUT/rt-sum.mjs" "$dir/rt.$c.cache" > "$dir/rt.$c.txt" 2>&1 || { echo "FAIL  runtime $c: no cache entries of the $side run"; return 1; }
    rm -rf "$dir/rt.$c.cache"
  done
  cmp -s "$B/rt.$c.txt" "$D/rt.$c.txt" || mark=FAIL
  [ "$(tail -1 "$D/rt.$c.log" | cut -d' ' -f3)" = 0 ] || mark=FAIL
  printf '%-4s  runtime %-9s %s | %s  base: %s  next: %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$B/rt.$c.log")" "$(tail -1 "$D/rt.$c.log")" \
    "$(head -1 "$B/rt.$c.txt")" "$(head -1 "$D/rt.$c.txt")" "$(sha256sum < "$B/rt.$c.txt" | cut -c1-16)" \
    "$(cmp -s "$B/rt.$c.txt" "$D/rt.$c.txt" && echo = || echo "!= $(sha256sum < "$D/rt.$c.txt" | cut -c1-16)")"
  [ "$mark" = ok ] && return 0
  echo "        entries only of the base $(comm -23 <(tail -n +2 "$B/rt.$c.txt" | cut -d' ' -f1) <(tail -n +2 "$D/rt.$c.txt" | cut -d' ' -f1) | wc -l), only of the binary under test $(comm -13 <(tail -n +2 "$B/rt.$c.txt" | cut -d' ' -f1) <(tail -n +2 "$D/rt.$c.txt" | cut -d' ' -f1) | wc -l), of both with other bytes $(join <(tail -n +2 "$B/rt.$c.txt") <(tail -n +2 "$D/rt.$c.txt") | awk '$2 != $4 || $3 != $5' | wc -l)"
  return 1
}

main() {
  local bad=0 pairs=0 c r
  echo "run     $(date -u +%FT%TZ)  tag $TAG  steps $*"
  echo "base    $BASE  sha256 $(sha256sum "$BASE" | cut -d' ' -f1)  $("$BASE" --revision)"
  echo "next    $NEXT  sha256 $(sha256sum "$NEXT" | cut -d' ' -f1)  $NEXT_VERSION  built $(date -u -r "$NEXT" +%FT%TZ)  workers $JOBS"
  echo "tree    $TREE  $(git -C "$TREE" rev-parse HEAD)  $(git -C "$TREE" status --short -uno | wc -l) modified files"
  for c in "$@"; do
    if [ "$c" = files ]; then
      pairs=$((pairs + 1))
      files || bad=$((bad + 1))
      continue
    fi
    if [ "$c" = runtime ]; then
      [ $STRIP = 0 ] || { echo "skip  runtime: a binary with debug assertions names its cache entries *.debug.pile"; continue; }
      for r in testrows comments targeted small-sub bench; do
        pairs=$((pairs + 1))
        runtime_one "$r" || bad=$((bad + 1))
      done
      continue
    fi
    pairs=$((pairs + 2))
    pair main "$c" "$MAIN" 15 || bad=$((bad + 1))
    pair extra "$c" "$EXTRA" 7 || bad=$((bad + 1))
  done
  if [ $bad -eq 0 ]; then
    echo "RESULT  ZERO differing records in $pairs pairs of runs"
  else
    echo "RESULT  FAIL: $bad of $pairs pairs of runs differ or did not run"
  fi
  return $bad
}

main "$@" 2>&1 | tee "$D/summary.$(date -u +%Y%m%dT%H%M%SZ).txt"
status=${PIPESTATUS[0]}
if [ -n "${R2_SAVE:-}" ]; then
  mkdir -p "$R2_SAVE/$TAG/base"
  cp "$D"/summary.*.txt "$D"/diff.*.txt "$D"/*.log "$R2_SAVE/$TAG/" 2>/dev/null
  cp "$B"/*.log "$R2_SAVE/$TAG/base/" 2>/dev/null
fi
[ "$status" -eq 0 ]
