#!/bin/bash
# R2: a parse without lint equals main. The base binary against a binary under test, record by record.
# diff.mjs gets NO cause list: the only passing result is zero differing records in every pair of runs.
#
#   /workspace/tools/lk bash run-r2.sh <tag> <bun under test> [step ...]
#
# steps, default: seams seams-bu testrows comments targeted bench tscases small files runtime build
#   seams .. small   a corpus through harness.all.mjs (34 configurations of Bun.Transpiler), R2_JOBS workers
#     seams      seams.mjs: the sites outside the type grammar that round 1 changed, from the lists of the sites
#     seams-bu   seams-bu.mjs: the same sites, from the diff of f4d755a9cf..23a20afa7e under src/js_parser and src/ast
#     testrows   the 301 sources of the four test files of round 1 (typescript-grammar*.test.ts)
#     comments   122 sources with a comment inside a construct
#     targeted   3,952 sources by construct (with the 1,547 of file 09, the grammar checks of the checker)
#     small-sub  7,089 sources of small (not in the default: it is for a binary with debug assertions, which is slow)
#     bench      the inputs of the transpiler benchmark (notes/lint/benchroot)
#     tscases    the single-file units of TypeScript's own tests (ref/typescript-go/_submodules/TypeScript/tests/cases)
#     small      209,628 sources: 11,646 type forms in 18 contexts
#   files      every tracked TypeScript and JavaScript file under test/ and src/js of R2_TREE, by the hash of each output
#   runtime    seams, seams-bu, testrows, comments, targeted and bench as modules that the runtime loads and never evaluates:
#              the entries of the runtime transpiler cache (version, output, source map, module record)
#   build      seams, seams-bu, testrows and comments through Bun.build, as a .ts and as a .js entry point: output, source map, messages
# env: R2_BASE    the base binary                          default /workspace/base/bun.f4d755a9c
#      R2_OUT     raw runs, never inside the notes         default /tmp/parser-r2
#      R2_TREE    the checkout that `files` reads          default /workspace/wt/parser
#      R2_JOBS    workers of each harness run              default 4
#      R2_EXPECT  zero (default): every pair is equal. differ: the run is a test of itself against a binary that is
#                 known to differ (/workspace/head/bun.head, round 1): every corpus pair must differ, and
#                 seams-seen.mjs must see every group of seams.mjs and of seams-bu.mjs.
#      R2_SAVE    a directory that gets the summary, the tables and the one-line logs (small text files only)
# Exit code 0 only for "RESULT  OK". A run of the base is kept under R2_OUT by the hashes of the binary, of
# harness.all.mjs and of the corpus, so a second run only runs the binary under test.
# A binary with debug assertions: harness.all.mjs cuts the " (token: T...)" that such a binary adds to one
# message, `runtime` is skipped (its cache entries have another name), and `small` takes hours: pass the steps.
set -u
N=/workspace/notes/lint/units/parser
G=$N/grammar-diff
BASE=${R2_BASE:-/workspace/base/bun.f4d755a9c}
OUT=${R2_OUT:-/tmp/parser-r2}
TREE=${R2_TREE:-/workspace/wt/parser}
JOBS=${R2_JOBS:-4}
EXPECT=${R2_EXPECT:-zero}
BENCHROOT=/workspace/notes/lint/benchroot
TSCASES=/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases
[ $# -ge 2 ] || { echo "usage: run-r2.sh <tag> <bun under test> [step ...]"; exit 2; }
TAG=$1
NEXT=$(readlink -f "$2")
shift 2
[ $# -gt 0 ] || set -- seams seams-bu testrows comments targeted bench tscases small files runtime build
[ -x "$BASE" ] && [ -x "$NEXT" ] || { echo "missing binary: $BASE or $NEXT"; exit 2; }
case "$OUT" in /workspace/notes*) echo "R2_OUT must be outside the notes"; exit 2 ;; esac
case "$EXPECT" in zero | differ) ;; *) echo "R2_EXPECT is zero or differ"; exit 2 ;; esac
HARNESS=$G/harness.all.mjs
sha() { sha256sum "$1" | cut -c1-12; }
B=$OUT/base.$(sha "$BASE").$(sha "$HARNESS")
D=$OUT/$TAG.$(sha "$NEXT").$(sha "$HARNESS")
mkdir -p "$B" "$D" || exit 2
ENVS="BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NO_COLOR=1"
NEXT_VERSION=$(env $ENVS "$NEXT" --revision 2>&1 | tail -1)
case "$NEXT_VERSION" in *-debug*) IS_DEBUG=1 ;; *) IS_DEBUG=0 ;; esac
NAPIS=$(env $ENVS "$BASE" "$HARNESS" --list | tail -1 | cut -d' ' -f1)

corpus() {
  case $1 in
    seams | seams-bu | bench | tscases) echo "$OUT/corpus.$1.json" ;;
    testrows | comments | small | small-sub) echo "$G/corpus.$1.json" ;;
    targeted) echo "$G/corpus.targeted-09.json" ;;
  esac
}
# The corpora that are made here, from their sources, on every run.
make_corpus() {
  case $1 in
    seams | seams-bu) (cd "$OUT" && env $ENVS "$BASE" "$G/$1.mjs" "$OUT/corpus.$1.json") > "$OUT/corpus.$1.log" 2>&1 ;;
    bench) [ -d "$BENCHROOT" ] && (cd "$OUT" && env $ENVS "$BASE" "$OUT/bench-corpus.mjs" "$OUT/corpus.bench.json") > "$OUT/corpus.bench.log" 2>&1 ;;
    tscases) [ -d "$TSCASES" ] && (cd "$OUT" && env $ENVS "$BASE" "$OUT/tscases-corpus.mjs" "$OUT/corpus.tscases.json") > "$OUT/corpus.tscases.log" 2>&1 ;;
    *) true ;;
  esac
}

cat > "$OUT/classes.mjs" <<'JS'
import { readFileSync } from "node:fs";
const table = {};
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  const key = `${d.api.padEnd(20)} ${d.cls}`;
  table[key] = (table[key] ?? 0) + 1;
}
for (const key of Object.keys(table).sort()) console.log(`        ${key.padEnd(32)} ${table[key]}`);
JS

cat > "$OUT/bench-corpus.mjs" <<JS
import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = "$BENCHROOT";
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
    sources.push({ src, prod: group.name + "/" + path });
  }
}
writeFileSync(process.argv[2], JSON.stringify({ name: "bench", contexts: {}, forms: [], sources }));
console.log(sources.length + " sources");
JS

cat > "$OUT/tscases-corpus.mjs" <<JS
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const CASES = "$TSCASES";
const seen = new Set();
const sources = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (/\\.tsx?\$/.test(name) && st.size < 60000) {
      const text = readFileSync(path, "utf8");
      const parts = text.split(/^\\s*\\/\\/\\s*@filename:\\s*(.*)\$/im);
      const list = [];
      if (parts.length === 1) list.push([name, text]);
      else for (let i = 1; i < parts.length; i += 2) list.push([parts[i].trim(), parts[i + 1] ?? ""]);
      for (const [unit, body] of list) {
        if (!/\\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)\$/.test(unit)) continue;
        const src = body.replace(/^\\uFEFF/, "");
        if (!src.trim() || seen.has(src)) continue;
        seen.add(src);
        sources.push({ prod: path.slice(CASES.length + 1) + (parts.length === 1 ? "" : "#" + unit), src });
      }
    }
  }
}
walk(join(CASES, "compiler"));
walk(join(CASES, "conformance"));
writeFileSync(process.argv[2], JSON.stringify({ name: "tscases", contexts: {}, forms: [], sources }));
console.log(sources.length + " sources");
JS

cat > "$OUT/files-worker.mjs" <<JS
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { APIS } from "$HARNESS";
const [root, outPath] = process.argv.slice(2);
const listed = Bun.spawnSync({ cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"], stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) throw new Error("git ls-files: " + listed.stderr.toString());
const loaderOf = file => (/\\.(ts|mts|cts)\$/.test(file) ? "ts" : /\\.tsx\$/.test(file) ? "tsx" : /\\.(js|mjs|cjs)\$/.test(file) ? "js" : /\\.jsx\$/.test(file) ? "jsx" : null);
const files = listed.stdout.toString().split("\\0").filter(file => loaderOf(file) !== null);
const apis = APIS.map(([name, method, options]) => ({ name, method, loader: options.loader, transpiler: new Bun.Transpiler({ define: { "process.env.NODE_ENV": '"development"' }, ...options }) }));
const strip = Bun.version.includes("-debug") ? text => text.replace(/^(Expected "[^]*" but found "[^]*") \\(token: T[A-Za-z]+\\)\$/, "\$1") : text => text;
const at = p => [p?.line ?? null, p?.column ?? null, p?.length ?? null, p?.offset ?? null];
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
  writeSync(out, JSON.stringify({ start: file }) + "\\n");
  const r = [];
  for (const api of apis) {
    if (api.loader !== loaderOf(file)) continue;
    records++;
    try {
      const value = api.transpiler[api.method](source);
      const text = typeof value === "string" ? value : JSON.stringify(value);
      r.push([api.name, "A", text.length, Bun.hash(text).toString(16)]);
    } catch (e) {
      r.push([api.name, "R", (e?.errors?.length ? e.errors : [e]).map(x => [strip(String(x?.message ?? x)), ...at(x?.position), x?.level ?? null, (x?.notes ?? []).map(n => [String(n?.message ?? n), ...at(n?.position)])])]);
    }
  }
  writeSync(out, JSON.stringify({ file, r }) + "\\n");
}
closeSync(out);
console.log(files.length + " files, " + records + " records, bun " + Bun.version + " " + Bun.revision);
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
    if (differ <= 40) console.log(`        ${(x[k] ?? y[k])[0].padEnd(20)} ${x[k]?.[1] ?? "missing"}>${y[k]?.[1] ?? "missing"} ${file}`);
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

cat > "$OUT/build-worker.mjs" <<'JS'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [corpusPath, outPath, work] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) inputs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) inputs.push(s.src);
const strip = Bun.version.includes("-debug") ? text => text.replace(/^(Expected "[^]*" but found "[^]*") \(token: T[A-Za-z]+\)$/, "$1") : text => text;
const logOf = l => [strip(String(l.message)), l.level, l.position?.line ?? null, l.position?.column ?? null, l.position?.length ?? null];
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "in"), { recursive: true });
writeFileSync(outPath, "");
let buffer = "";
let built = 0;
for (let i = 0; i < inputs.length; i++) {
  for (const ext of ["ts", "js"]) {
    // A path of its own for every build: the bundler keeps what it read of a path.
    const file = join(work, "in", `s${i}${ext}.${ext}`);
    writeFileSync(file, inputs[i]);
    const outdir = join(work, "out", `s${i}${ext}`);
    let record;
    try {
      const result = await Bun.build({ entrypoints: [file], outdir, sourcemap: "external", target: "bun", packages: "external", throw: false });
      if (!result.success) {
        record = { e: result.logs.map(logOf) };
      } else {
        built++;
        const js = join(outdir, `s${i}${ext}.js`);
        const text = existsSync(js) ? readFileSync(js, "utf8") : null;
        const map = existsSync(js + ".map") ? JSON.parse(readFileSync(js + ".map", "utf8")) : null;
        record = { js: text, mappings: map?.mappings ?? null, names: map?.names ?? null, w: result.logs.map(logOf) };
      }
    } catch (e) {
      record = { threw: strip(String(e?.message ?? e)).slice(0, 300) };
    }
    rmSync(file, { force: true });
    rmSync(outdir, { recursive: true, force: true });
    buffer += JSON.stringify({ i, ext, src: inputs[i], ...record }) + "\n";
  }
  if (buffer.length > 1 << 16) {
    appendFileSync(outPath, buffer);
    buffer = "";
  }
}
appendFileSync(outPath, buffer);
rmSync(work, { recursive: true, force: true });
console.log(`${inputs.length * 2} builds, ${built} built, bun ${Bun.version} ${Bun.revision}`);
JS

cat > "$OUT/build-diff.mjs" <<'JS'
import { readFileSync } from "node:fs";
const read = p => readFileSync(p, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const [a, b] = [read(process.argv[2]), read(process.argv[3])];
const kind = r => (r === undefined ? "missing" : r.e ? "R" : r.threw ? "T" : "A");
const count = {};
let differ = 0;
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  const [x, y] = [a[i], b[i]];
  if (JSON.stringify(x) === JSON.stringify(y)) continue;
  differ++;
  let cls = `${kind(x)}>${kind(y)}`;
  if (cls === "A>A") cls += x.js !== y.js ? " output" : x.mappings !== y.mappings || JSON.stringify(x.names) !== JSON.stringify(y.names) ? " SOURCE MAP" : " messages";
  count[cls] = (count[cls] ?? 0) + 1;
  if (differ <= 12) console.log(`        ${cls.padEnd(16)} .${(x ?? y).ext} ${JSON.stringify((x ?? y).src).slice(0, 120)}`);
}
for (const [cls, n] of Object.entries(count).sort()) console.log(`        ${cls.padEnd(16)} ${n}`);
console.log(`${Math.max(a.length, b.length)} records compared, ${differ} differ`);
JS

# One run of the harness. It is skipped when its output exists: its name holds the hashes of the binary, of the harness and of the corpus.
one_run() {
  local bin=$1 cfile=$2 out=$3 log=${3%.jsonl.gz}.log rc
  [ -s "$out" ] && return 0
  (cd "$OUT" && env $ENVS "$bin" "$HARNESS" "$cfile" "$out" "--jobs=$JOBS") > "$log" 2>&1
  rc=$?
  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    echo "        harness failed, rc=$rc: $log"
    tail -5 "$log"
    return 1
  fi
}
records_sha() { gzip -dc "$1" | tail -n +2 | sha256sum | cut -d' ' -f1; }
field() { sed -nE "s/.*: ([0-9]+) inputs x ([0-9]+) apis, ([0-9]+) crashes.*/\\$2/p" "$1"; }
# The verdict of one pair: with R2_EXPECT=zero `equal` passes, with R2_EXPECT=differ `differs` does.
# The benchmark inputs are valid code that round 1 reads as main does: with R2_EXPECT=differ they may be equal.
verdict() {
  if [ "$1" = broken ]; then echo FAIL; elif [ "$EXPECT" = zero ] && [ "$1" = equal ]; then echo ok; elif [ "$EXPECT" = differ ] && [ "$1" = differs ]; then echo seen; elif [ "$EXPECT" = differ ] && [ "${2:-}" = bench ]; then echo same; else echo FAIL; fi
}

pair() {
  local c=$1 cfile csha b n rc line compared differ bs ns state mark
  cfile=$(corpus "$c")
  [ -n "$cfile" ] || { echo "FAIL  unknown step $c"; return 1; }
  make_corpus "$c" || { echo "FAIL  $c: the corpus cannot be made, $OUT/corpus.$c.log"; return 1; }
  [ -s "$cfile" ] || { echo "FAIL  $c: no corpus $cfile"; return 1; }
  csha=$(sha "$cfile")
  b=$B/$c.$csha.jsonl.gz
  n=$D/$c.$csha.jsonl.gz
  one_run "$BASE" "$cfile" "$b" || return 1
  one_run "$NEXT" "$cfile" "$n" || return 1
  env $ENVS "$BASE" "$G/diff.mjs" "$b" "$n" "--out=$D/diff.$c.jsonl" --show=5 > "$D/diff.$c.txt" 2>&1
  rc=$?
  line=$(sed -n 3p "$D/diff.$c.txt")
  compared=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\1/p')
  differ=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\2/p')
  bs=$(records_sha "$b")
  ns=$(records_sha "$n")
  state=differs
  [ "$rc" = 0 ] && [ "$differ" = 0 ] && [ "$bs" = "$ns" ] && state=equal
  [ "$(field "${b%.jsonl.gz}.log" 2)" = "$NAPIS" ] && [ "$(field "${n%.jsonl.gz}.log" 2)" = "$NAPIS" ] || state=broken
  [ "$(field "${b%.jsonl.gz}.log" 1)" = "$(field "${n%.jsonl.gz}.log" 1)" ] || state=broken
  [ "$compared" = "$(($(field "${b%.jsonl.gz}.log" 1) * NAPIS))" ] || state=broken
  [ "$(field "${b%.jsonl.gz}.log" 3)" = 0 ] && [ "$(field "${n%.jsonl.gz}.log" 3)" = 0 ] || state=broken
  mark=$(verdict $state "$c")
  printf '%-4s  %-9s sources %-6s x %-2s records %-8s differ %-7s crashes %s/%s  corpus %s  sha256 of the records %s %s\n' \
    "$mark" "$c" "$(field "${b%.jsonl.gz}.log" 1)" "$NAPIS" "${compared:-?}" "${differ:-?}" \
    "$(field "${b%.jsonl.gz}.log" 3)" "$(field "${n%.jsonl.gz}.log" 3)" "$csha" "${bs:0:16}" "$([ "$bs" = "$ns" ] && echo = || echo "!= ${ns:0:16}")"
  if [ "$state" != equal ] && [ -s "$D/diff.$c.jsonl" ]; then
    if [ "$c" = seams ] || [ "$c" = seams-bu ]; then
      env $ENVS "$BASE" "$G/seams-seen.mjs" "$cfile" "$D/diff.$c.jsonl" > "$D/$c-seen.txt" 2>&1 || { [ "$EXPECT" = differ ] && mark=FAIL; }
      sed 's/^/        /' "$D/$c-seen.txt"
    else
      env $ENVS "$BASE" "$OUT/classes.mjs" "$D/diff.$c.jsonl" | head -40
    fi
  fi
  [ "$mark" != FAIL ]
}

# Both sides read the checkout as it is now, so this step is never taken from an earlier run.
files() {
  local b=$B/files.jsonl n=$D/files.jsonl state=equal mark
  (cd "$OUT" && env $ENVS "$BASE" "$OUT/files-worker.mjs" "$TREE" "$b") > "$B/files.log" 2>&1 || { echo "FAIL  files: the base worker ended early after $(tail -1 "$b" | cut -c1-200), $B/files.log"; return 1; }
  (cd "$OUT" && env $ENVS "$NEXT" "$OUT/files-worker.mjs" "$TREE" "$n") > "$D/files.log" 2>&1 || { echo "FAIL  files: the worker ended early after $(tail -1 "$n" | cut -c1-200), $D/files.log"; return 1; }
  cmp -s "$b" "$n" || state=differs
  mark=$(verdict $state)
  printf '%-4s  files     %s | %s  sha256 %s %s\n' "$mark" "$(tail -1 "$B/files.log")" "$(tail -1 "$D/files.log")" \
    "$(sha256sum < "$b" | cut -c1-16)" "$(cmp -s "$b" "$n" && echo = || echo "!= $(sha256sum < "$n" | cut -c1-16)")"
  if [ $state = differs ]; then
    env $ENVS "$BASE" "$OUT/files-diff.mjs" "$b" "$n" > "$D/diff.files.txt" 2>&1
    cat "$D/diff.files.txt"
  fi
  [ "$mark" != FAIL ]
}

# The cache entries that the runtime transpiler writes for the sources of a corpus, both sides, never from an earlier run.
runtime_one() {
  local c=$1 cfile side dir bin state=equal mark
  cfile=$(corpus "$c")
  make_corpus "$c" && [ -s "$cfile" ] || { echo "FAIL  runtime $c: no corpus $cfile"; return 1; }
  for side in base next; do
    if [ $side = base ]; then dir=$B; bin=$BASE; else dir=$D; bin=$NEXT; fi
    rm -rf "$dir/rt.$c.cache"
    (cd "$OUT" && env $ENVS "BUN_RUNTIME_TRANSPILER_CACHE_PATH=$dir/rt.$c.cache" "$bin" "$OUT/rt-worker.mjs" "$cfile" "$OUT/rt-work") > "$dir/rt.$c.log" 2>&1 \
      || { echo "FAIL  runtime $c: the $side run ended early, $dir/rt.$c.log"; return 1; }
    env $ENVS "$BASE" "$OUT/rt-sum.mjs" "$dir/rt.$c.cache" > "$dir/rt.$c.txt" 2>&1 || { echo "FAIL  runtime $c: no cache entries of the $side run"; return 1; }
    rm -rf "$dir/rt.$c.cache"
  done
  cmp -s "$B/rt.$c.txt" "$D/rt.$c.txt" || state=differs
  [ "$(tail -1 "$D/rt.$c.log" | cut -d' ' -f3)" = 0 ] || state=broken
  mark=$(verdict $state "$c")
  printf '%-4s  runtime %-9s %s | %s  base: %s  next: %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$B/rt.$c.log")" "$(tail -1 "$D/rt.$c.log")" \
    "$(head -1 "$B/rt.$c.txt")" "$(head -1 "$D/rt.$c.txt")" "$(sha256sum < "$B/rt.$c.txt" | cut -c1-16)" \
    "$(cmp -s "$B/rt.$c.txt" "$D/rt.$c.txt" && echo = || echo "!= $(sha256sum < "$D/rt.$c.txt" | cut -c1-16)")"
  [ $state = equal ] || echo "        entries only of the base $(comm -23 <(tail -n +2 "$B/rt.$c.txt" | cut -d' ' -f1) <(tail -n +2 "$D/rt.$c.txt" | cut -d' ' -f1) | wc -l), only of the binary under test $(comm -13 <(tail -n +2 "$B/rt.$c.txt" | cut -d' ' -f1) <(tail -n +2 "$D/rt.$c.txt" | cut -d' ' -f1) | wc -l), of both with other bytes $(join <(tail -n +2 "$B/rt.$c.txt") <(tail -n +2 "$D/rt.$c.txt") | awk '$2 != $4 || $3 != $5' | wc -l)"
  [ "$mark" != FAIL ]
}

# Bun.build of each source as a .ts and as a .js entry point, both sides, never from an earlier run.
build_one() {
  local c=$1 cfile state=equal mark
  cfile=$(corpus "$c")
  make_corpus "$c" && [ -s "$cfile" ] || { echo "FAIL  build $c: no corpus $cfile"; return 1; }
  (cd "$OUT" && env $ENVS "$BASE" "$OUT/build-worker.mjs" "$cfile" "$B/build.$c.jsonl" "$OUT/build-work") > "$B/build.$c.log" 2>&1 || { echo "FAIL  build $c: the base run ended early, $B/build.$c.log"; return 1; }
  (cd "$OUT" && env $ENVS "$NEXT" "$OUT/build-worker.mjs" "$cfile" "$D/build.$c.jsonl" "$OUT/build-work") > "$D/build.$c.log" 2>&1 || { echo "FAIL  build $c: the run ended early, $D/build.$c.log"; return 1; }
  cmp -s "$B/build.$c.jsonl" "$D/build.$c.jsonl" || state=differs
  mark=$(verdict $state)
  printf '%-4s  build   %-9s %s | %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$B/build.$c.log")" "$(tail -1 "$D/build.$c.log")" \
    "$(sha256sum < "$B/build.$c.jsonl" | cut -c1-16)" "$(cmp -s "$B/build.$c.jsonl" "$D/build.$c.jsonl" && echo = || echo "!= $(sha256sum < "$D/build.$c.jsonl" | cut -c1-16)")"
  if [ $state = differs ]; then
    env $ENVS "$BASE" "$OUT/build-diff.mjs" "$B/build.$c.jsonl" "$D/build.$c.jsonl" > "$D/diff.build.$c.txt" 2>&1
    tail -30 "$D/diff.build.$c.txt"
  fi
  [ "$mark" != FAIL ]
}

main() {
  local bad=0 pairs=0 c r
  echo "run     $(date -u +%FT%TZ)  tag $TAG  expect $EXPECT  steps $*"
  echo "base    $BASE  sha256 $(sha256sum "$BASE" | cut -d' ' -f1)  $(env $ENVS "$BASE" --revision)"
  echo "next    $NEXT  sha256 $(sha256sum "$NEXT" | cut -d' ' -f1)  $NEXT_VERSION  built $(date -u -r "$NEXT" +%FT%TZ)  workers $JOBS"
  echo "tree    $TREE  $(git -C "$TREE" rev-parse HEAD)  $(timeout 120 git -C "$TREE" status --short -uno -- src/js_parser src/ast src/jsc | wc -l) modified files under src/js_parser, src/ast, src/jsc  $(git -C "$TREE" log --oneline f4d755a9cf..HEAD -- src/js_parser src/js_printer src/ast | wc -l) commits after f4d755a9cf under src/js_parser, src/js_printer, src/ast"
  echo "tools   harness.all.mjs $(sha "$HARNESS") ($NAPIS configurations)  diff.mjs $(sha "$G/diff.mjs")  seams.mjs $(sha "$G/seams.mjs")  seams-bu.mjs $(sha "$G/seams-bu.mjs")  run-r2.sh $(sha "$0")"
  case "$(env $ENVS "$BASE" --revision)" in *+f4d755a9c) ;; *) echo "FAIL  the base binary is not a build of f4d755a9cf"; bad=$((bad + 1)) ;; esac
  for c in "$@"; do
    case $c in
      files)
        pairs=$((pairs + 1))
        files || bad=$((bad + 1))
        ;;
      runtime)
        [ $IS_DEBUG = 0 ] || { echo "skip  runtime: a binary with debug assertions names its cache entries *.debug.pile"; continue; }
        for r in seams seams-bu testrows comments targeted bench; do
          pairs=$((pairs + 1))
          runtime_one "$r" || bad=$((bad + 1))
        done
        ;;
      build)
        for r in seams seams-bu testrows comments; do
          pairs=$((pairs + 1))
          build_one "$r" || bad=$((bad + 1))
        done
        ;;
      *)
        pairs=$((pairs + 1))
        pair "$c" || bad=$((bad + 1))
        ;;
    esac
  done
  if [ $bad -ne 0 ]; then
    echo "RESULT  FAIL: $bad of $pairs pairs of runs are not as expected ($EXPECT) or did not run"
  elif [ "$EXPECT" = zero ]; then
    echo "RESULT  OK: ZERO differing records in $pairs pairs of runs"
  else
    echo "RESULT  OK: the run tells the two binaries apart in each of its $pairs pairs of runs"
  fi
  return $bad
}

main "$@" 2>&1 | tee "$D/summary.$(date -u +%Y%m%dT%H%M%SZ).txt"
status=${PIPESTATUS[0]}
if [ -n "${R2_SAVE:-}" ]; then
  mkdir -p "$R2_SAVE/$TAG/base"
  for f in "$D"/summary.*.txt "$D"/diff.*.txt "$D"/seams*-seen.txt "$D"/*.log; do
    [ -f "$f" ] && head -c 262144 "$f" > "$R2_SAVE/$TAG/$(basename "$f")"
  done
  cp "$B"/*.log "$R2_SAVE/$TAG/base/" 2>/dev/null
fi
[ "$status" -eq 0 ]
