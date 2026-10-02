#!/bin/bash
# R2: a parse without lint equals main. The base binary against a binary under test, record by record:
# every corpus, every configuration, two binaries. EXPECT=zero passes only with ZERO differing records in every
# pair of runs. There is no cause list: diff.mjs gets none, so every differing record is "unexplained" and fails.
#
#   /workspace/tools/lk bash parity.sh <tag> <bun under test> [step ...]
#
# steps, default all of them in this order:
#   seams seams-bu testrows comments targeted small-sub check bench tscases repo-ts repo-js small
#            a corpus through harness.all.mjs: 34 configurations of Bun.Transpiler (the 15 of harness.mjs, the 7 of
#            harness.extra-apis.mjs, 12 more), an error with message, line, column, length, offset, level and notes
#     seams      1,089 sources, seams.mjs: the sites outside the type grammar that round 1 changed, from the lists of the sites
#     seams-bu     744 sources, seams-bu.mjs: the same sites, from the diff of main..round 1 under src/js_parser and src/ast
#     testrows     301 sources: the four test files of round 1 (typescript-grammar*.test.ts)
#     comments     122 sources with a comment inside a construct
#     targeted   3,952 sources by construct
#     small-sub  7,089 sources of small (the part for a binary with debug assertions, which is slow)
#     check     18,390 sources: the probe inputs of round 1, two parts of small, targeted again
#     bench        329 sources: the inputs of the transpiler benchmark (notes/lint/benchroot)
#     tscases   14,635 sources: the single-file units of TypeScript's own tests
#     repo-ts, repo-js   the tracked TypeScript and JavaScript files under test/ and src/js of TREE, below 300 KB
#     small    209,628 sources: 11,646 type forms in 18 contexts
#   files    every tracked TypeScript and JavaScript file under test/ and src/js of TREE, with the configurations of its loader
#   runtime  the small corpora as modules that the runtime loads and never evaluates: the entries of the runtime
#            transpiler cache (version, output, source map, module record)
#   bundle   the small corpora, each source as the one entry point of Bun.build, as .ts, .tsx and .js: the output, the
#            mappings and names of its source map, the messages
#   pmdiff   the small corpora as .js, .ts and .tsx files of two folders through `bun pm diff` (pm_diff_normalize.rs:
#            Parser::init(..).parse()): the parser with its default features and the visit pass, which no configuration
#            of Bun.Transpiler runs for JavaScript
#   order    the small corpora and the JavaScript files of TREE through bytecodeOrderNames of bun:internal-for-testing, as a
#            module, a script and a builtin: Parser::parse_only (JavaScript, no visit pass, a side table that is NOT the one of a
#            lint parse) and a hash of the syntax tree of every function. No other step reaches parse_only.
# env: BASE    the base binary, a release build of main     default /workspace/base/bun.f4d755a9c
#      JOBS    workers of the binary under test             default 4 (the base always runs 4)
#      OUT     run files, never inside the notes            default /tmp/parser-parity
#      TREE    the checkout that files and repo-* read      default /workspace/wt/parser
#      SAVE    a directory that gets <tag>/: the summary, the tables and the one-line logs (small text only)
#      EXPECT  zero (default) | differ: the binary under test is known to differ (round 1) and the run has to see it,
#              in every group of the two seam corpora and in every pair of MUST_SEE
#      RUNTIME_CORPORA, BUNDLE_CORPORA, PMDIFF_CORPORA, ORDER_CORPORA   the corpora of those four steps, default the small ones
# Exit code 0 only for "RESULT  ZERO" (EXPECT=zero) or "RESULT  SEEN" (EXPECT=differ).
# A run of a harness is kept under OUT by the hashes of the binary, of the harness and of the corpus: a second run
# with the same three is not made again. files, runtime, bundle, pmdiff and order always run both sides.
# A binary with debug assertions ends the message of Lexer::expect_contextual_keyword with " (token: T...)": the
# harness and the workers cut that text, and the steps runtime and pmdiff are left out for it (its cache entries
# have another name). Give it the steps by name: small takes hours with it. A first check of a debug build, about 20 minutes:
#   parity.sh <tag> build/debug/bun-debug seams seams-bu testrows comments targeted order bundle
# The body is functions, so that an edit of this file during a run does not reach the run.
set -u

write_tools() {
mkdir -p "$T"
cat > "$T/classes.mjs" <<'JS'
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

cat > "$T/make-corpora.mjs" <<'JS'
// Corpora of whole files: the inputs of the transpiler benchmark, the tracked files of the checkout (test, src/js),
// the single-file units of TypeScript's own tests. One source per distinct text. Files above 300 KB stay out of repo-*.
//   bun make-corpora.mjs <out dir> <checkout> <name ...>        name: bench tscases repo-ts repo-js
import { Glob } from "bun";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [out, root, ...names] = process.argv.slice(2);
const write = (name, sources) => {
  writeFileSync(join(out, `corpus.${name}.json`), JSON.stringify({ name, contexts: {}, forms: [], sources }));
  console.log(`corpus.${name}.json: ${sources.length} sources, ${sources.reduce((n, s) => n + s.src.length, 0)} characters`);
};
if (names.includes("bench")) {
  const bench = "/workspace/notes/lint/benchroot";
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
    const dir = join(bench, group.dir);
    const skip = ["node_modules/", ...(group.skip ?? [])];
    const paths = [...new Glob(group.pattern).scanSync({ cwd: dir })].filter(path => !skip.some(prefix => path.startsWith(prefix) || path.includes("/" + prefix))).sort();
    for (const path of paths) {
      const src = readFileSync(join(dir, path), "utf8");
      if (seen.has(src)) continue;
      seen.add(src);
      sources.push({ src, prod: `${group.name}/${path}` });
    }
  }
  write("bench", sources);
}
if (names.includes("repo-ts") || names.includes("repo-js")) {
  const listed = Bun.spawnSync({ cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"], stdout: "pipe", stderr: "pipe" });
  if (listed.exitCode !== 0) throw new Error("git ls-files: " + listed.stderr.toString());
  const files = listed.stdout.toString().split("\0").filter(Boolean).sort();
  for (const [name, pattern] of [["repo-ts", /\.(ts|tsx|mts|cts)$/], ["repo-js", /\.(js|mjs|cjs|jsx)$/]]) {
    if (!names.includes(name)) continue;
    const seen = new Set();
    const sources = [];
    for (const file of files) {
      if (!pattern.test(file)) continue;
      let st;
      try {
        st = statSync(join(root, file));
      } catch {
        continue;
      }
      if (!st.isFile() || st.size > 300000) continue;
      const src = readFileSync(join(root, file), "utf8");
      if (seen.has(src)) continue;
      seen.add(src);
      sources.push({ prod: file, src });
    }
    write(name, sources);
  }
}
if (names.includes("tscases")) {
  const CASES = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
  const seen = new Set();
  const units = [];
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && st.size < 60000) {
        const text = readFileSync(path, "utf8");
        const parts = text.split(/^\s*\/\/\s*@filename:\s*(.*)$/im);
        const list = [];
        if (parts.length === 1) list.push([name, text]);
        else for (let i = 1; i < parts.length; i += 2) list.push([parts[i].trim(), parts[i + 1] ?? ""]);
        for (const [unit, body] of list) {
          if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(unit)) continue;
          const src = body.replace(/^\uFEFF/, "");
          if (!src.trim() || seen.has(src)) continue;
          seen.add(src);
          units.push({ prod: path.slice(CASES.length + 1) + (parts.length === 1 ? "" : "#" + unit), src });
        }
      }
    }
  };
  walk(join(CASES, "compiler"));
  walk(join(CASES, "conformance"));
  write("tscases", units);
}
JS

cat > "$T/files-worker.mjs" <<'JS'
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
const [root, outPath, harnessPath] = process.argv.slice(2);
const { APIS } = await import(harnessPath);
const listed = Bun.spawnSync({ cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"], stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) throw new Error("git ls-files: " + listed.stderr.toString());
const loaderOf = file => (/\.(ts|mts|cts)$/.test(file) ? "ts" : /\.tsx$/.test(file) ? "tsx" : /\.(js|mjs|cjs)$/.test(file) ? "js" : /\.jsx$/.test(file) ? "jsx" : null);
const files = listed.stdout.toString().split("\0").filter(file => loaderOf(file) !== null);
const apis = APIS.map(([name, method, options]) => ({ name, method, loader: options.loader, transpiler: new Bun.Transpiler({ define: { "process.env.NODE_ENV": '"development"' }, ...options }) }));
const strip = Bun.version.includes("-debug") ? text => text.replace(/^(Expected "[^]*" but found "[^]*") \(token: T[A-Za-z]+\)$/, "$1") : text => text;
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
      r.push([api.name, "R", (e?.errors?.length ? e.errors : [e]).map(x => [strip(String(x?.message ?? x)), ...at(x?.position), x?.level ?? null, (x?.notes ?? []).map(n => [String(n?.message ?? n), ...at(n?.position)])])]);
    }
  }
  writeSync(out, JSON.stringify({ file, r }) + "\n");
}
closeSync(out);
console.log(`${files.length} files, ${records} records, bun ${Bun.version} ${Bun.revision}`);
JS

cat > "$T/files-diff.mjs" <<'JS'
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

cat > "$T/rt-worker.mjs" <<'JS'
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

cat > "$T/rt-sum.mjs" <<'JS'
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

cat > "$T/bundle-worker.mjs" <<'JS'
// What Bun.build gives for each source of a corpus as its one entry point: the output, the mappings and the names of the source map, the messages.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [corpusPath, outPath, dir] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) inputs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) inputs.push(s.src);
// Every file is there before the first build, each extension in its own directory: the bundler keeps what it read of a
// directory, and it looks for s1.ts and s1.tsx where s1.js is asked for.
const EXTS = ["ts", "tsx", "js"];
rmSync(dir, { recursive: true, force: true });
for (const ext of EXTS) {
  mkdirSync(join(dir, ext), { recursive: true });
  for (let i = 0; i < inputs.length; i++) writeFileSync(join(dir, ext, `s${i}.${ext}`), inputs[i]);
}
writeFileSync(outPath, "");
const at = p => [p?.line ?? null, p?.column ?? null, p?.length ?? null, p?.lineText ?? null];
const logs = list => list.map(l => [String(l.message).replace(/ \(token: T[A-Za-z]+\)$/, ""), l.level ?? null, ...at(l.position)]);
let buffer = "";
let records = 0;
for (let i = 0; i < inputs.length; i++) {
  for (const ext of EXTS) {
    const file = join(dir, ext, `s${i}.${ext}`);
    const outdir = join(dir, "out");
    rmSync(outdir, { recursive: true, force: true });
    let record;
    try {
      const result = await Bun.build({ entrypoints: [file], outdir, sourcemap: "external", target: "bun", packages: "external", throw: false });
      if (!result.success) {
        record = { e: logs(result.logs) };
      } else {
        const js = existsSync(join(outdir, `s${i}.js`)) ? readFileSync(join(outdir, `s${i}.js`), "utf8") : null;
        const map = existsSync(join(outdir, `s${i}.js.map`)) ? JSON.parse(readFileSync(join(outdir, `s${i}.js.map`), "utf8")) : null;
        record = { js, mappings: map?.mappings ?? null, names: map?.names ?? null, w: logs(result.logs) };
      }
    } catch (e) {
      record = { threw: String(e?.message ?? e).slice(0, 300) };
    }
    records++;
    buffer += JSON.stringify({ i, ext, src: inputs[i], ...record }) + "\n";
    if (buffer.length > 1 << 16) {
      appendFileSync(outPath, buffer);
      buffer = "";
    }
  }
}
appendFileSync(outPath, buffer);
rmSync(dir, { recursive: true, force: true });
console.log(`${inputs.length} sources, ${records} bundles, bun ${Bun.version} ${Bun.revision}`);
JS

cat > "$T/bundle-diff.mjs" <<'JS'
import { readFileSync } from "node:fs";
const read = path => readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
const [a, b] = [read(process.argv[2]), read(process.argv[3])];
const kind = r => (r === undefined ? "missing" : r.e ? "R" : r.threw ? "T" : "A");
const classes = {};
let differ = 0;
for (let k = 0; k < Math.max(a.length, b.length); k++) {
  const [x, y] = [a[k], b[k]];
  if (JSON.stringify(x) === JSON.stringify(y)) continue;
  differ++;
  let cls = `${kind(x)}>${kind(y)}`;
  if (cls === "A>A") cls += x.js !== y.js ? " output" : x.mappings !== y.mappings ? " same output, mappings" : JSON.stringify(x.names) !== JSON.stringify(y.names) ? " same output, names" : " same output and map, messages";
  const key = `${(x ?? y).ext.padEnd(4)} ${cls}`;
  classes[key] = (classes[key] ?? 0) + 1;
  if (differ <= 6) console.log(`        ${key.padEnd(28)} ${JSON.stringify((x ?? y).src).slice(0, 110)}`);
}
for (const key of Object.keys(classes).sort()) console.log(`        ${key.padEnd(44)} ${classes[key]}`);
console.log(`${Math.max(a.length, b.length)} bundles compared, ${differ} differ`);
JS

cat > "$T/order-worker.mjs" <<'JS'
// What a bytecode order file calls the code of each source of a corpus, read as a module, as a script and as a builtin:
// bun:internal-for-testing bytecodeOrderNames, which reads the text with Parser::parse_only (JavaScript, no visit pass,
// a side table that is not the one of a lint parse) and names every function by a hash of its syntax tree.
import { bytecodeOrderNames } from "bun:internal-for-testing";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [corpusPath, outPath] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) inputs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) inputs.push(s.src);
// builtin: the syntax of JavaScriptCore's own modules (Options::jsc_builtin_syntax), which no other step sets.
const KINDS = ["module", "script", "builtin"];
writeFileSync(outPath, "");
let buffer = "";
let named = 0;
for (let i = 0; i < inputs.length; i++) {
  const r = [];
  for (const kind of KINDS) {
    let names;
    try {
      names = bytecodeOrderNames(inputs[i], kind);
    } catch (e) {
      names = "threw " + String(e?.message ?? e).slice(0, 200);
    }
    if (typeof names === "string" && !names.startsWith("threw ")) {
      named++;
      r.push([names.length, Bun.hash(names).toString(16)]);
    } else {
      r.push(names ?? null);
    }
  }
  buffer += JSON.stringify({ i, src: inputs[i].length > 400 ? inputs[i].slice(0, 400) : inputs[i], r }) + "\n";
  if (buffer.length > 1 << 16) {
    appendFileSync(outPath, buffer);
    buffer = "";
  }
}
appendFileSync(outPath, buffer);
console.log(`${inputs.length} sources, ${inputs.length * KINDS.length} readings, ${named} with names, bun ${Bun.version} ${Bun.revision}`);
JS

cat > "$T/order-diff.mjs" <<'JS'
import { readFileSync } from "node:fs";
const read = path => readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
const [a, b] = [read(process.argv[2]), read(process.argv[3])];
const kind = v => (v === undefined ? "missing" : v === null ? "R" : typeof v === "string" ? "T" : "A");
const classes = {};
let differ = 0;
for (let k = 0; k < Math.max(a.length, b.length); k++) {
  for (let j = 0; j < 3; j++) {
    const [x, y] = [a[k]?.r[j], b[k]?.r[j]];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    differ++;
    const key = `${["module", "script", "builtin"][j]} ${kind(x)}>${kind(y)}`;
    classes[key] = (classes[key] ?? 0) + 1;
    if (differ <= 8) console.log(`        ${key.padEnd(16)} ${JSON.stringify((a[k] ?? b[k]).src).slice(0, 110)}`);
  }
}
for (const key of Object.keys(classes).sort()) console.log(`        ${key.padEnd(16)} ${classes[key]}`);
console.log(`${Math.max(a.length, b.length) * 3} readings compared, ${differ} differ`);
JS

cat > "$T/pmdiff-make.mjs" <<'JS'
// Two folders for `bun pm diff`: every source of a corpus as s<i>.js, s<i>.ts and s<i>.tsx, and on the other side with one more line end.
// A file that parses is "formatting only", one that does not is "not parsed".
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [corpusPath, dir] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const template of Object.values(corpus.contexts)) inputs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) inputs.push(s.src);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "a"), { recursive: true });
mkdirSync(join(dir, "b"), { recursive: true });
const index = [];
for (let i = 0; i < inputs.length; i++) {
  for (const ext of ["js", "ts", "tsx"]) {
    writeFileSync(join(dir, "a", `s${i}.${ext}`), inputs[i]);
    writeFileSync(join(dir, "b", `s${i}.${ext}`), inputs[i] + "\n");
  }
  index.push(inputs[i]);
}
writeFileSync(join(dir, "index.json"), JSON.stringify(index));
console.log(`${inputs.length} sources, ${inputs.length * 3} files a side`);
JS

cat > "$T/pmdiff-diff.mjs" <<'JS'
// The files that two outputs of `bun pm diff` tell differently: the line of the file with its badge.
import { readFileSync } from "node:fs";
const [aPath, bPath, indexPath] = process.argv.slice(2);
const read = path => {
  const text = readFileSync(path, "utf8").replace(/\x1b\[[0-9;]*[mK]/g, "");
  const map = new Map();
  for (const line of text.split("\n")) {
    const m = /^(s\d+\.(?:js|ts|tsx)) ─+ (.*)$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
};
const [a, b] = [read(aPath), read(bPath)];
const index = JSON.parse(readFileSync(indexPath, "utf8"));
const badge = text => (text === undefined ? "missing" : text.startsWith("not parsed") ? "R" : "A");
let differ = 0;
const classes = {};
for (const file of new Set([...a.keys(), ...b.keys()])) {
  if (a.get(file) === b.get(file)) continue;
  differ++;
  const key = `${file.split(".").pop().padEnd(4)} ${badge(a.get(file))}>${badge(b.get(file))}`;
  classes[key] = (classes[key] ?? 0) + 1;
  if (differ <= 12) console.log(`        ${file.padEnd(12)} ${a.get(file) ?? "missing"} | ${b.get(file) ?? "missing"}   ${JSON.stringify(index[Number(file.slice(1).split(".")[0])]).slice(0, 100)}`);
}
for (const key of Object.keys(classes).sort()) console.log(`        ${key.padEnd(12)} ${classes[key]}`);
console.log(`${new Set([...a.keys(), ...b.keys()]).size} files compared, ${differ} differ`);
JS
}

corpus_file() {
  case $1 in
    seams | seams-bu | testrows | comments | small-sub | small) echo "$G/corpus.$1.json" ;;
    targeted) echo "$G/corpus.targeted-09.json" ;;
    check) echo "$N/round2/grammar-diff-run/bottom-up/runs/corpus.check.json" ;;
    bench | tscases | repo-ts | repo-js) echo "$OUT/corpus.$1.json" ;;
  esac
}
# sha256 of the corpora: a corpus that changed is no longer the one of the recorded runs. bench and tscases are made
# on every run from files that do not change. repo-ts and repo-js follow the checkout and have no pin.
corpus_pin() {
  case $1 in
    seams) echo 140755828465cf395762eaeb73ffb94d6fdc991d2373e17e63158ea5ed1412d5 ;;
    seams-bu) echo 77db46ce594296f0e7992e5beeb063535cb9668f4ff80768d6c35a812650b0a9 ;;
    small) echo 19d140cdf29b4cfcc6682bf827642a0c3e138ad34a120867b0e0e21e35e3dc81 ;;
    small-sub) echo edb744ab7286d2fc7d774bea188dde4eb861f3bfd97160ba108de5b68f279bc4 ;;
    targeted) echo 68d65cd91163a1d165a2f68da19054bf895024e4459ef6cce03977fc56b63487 ;;
    testrows) echo 7188b5c7588d722ca533abf19b0cbb748c320eff2832baaf435fdc2005c84e64 ;;
    comments) echo 71d0420c2a27660af8b170c55dcd131691fae4572942f7967c76287733444b4f ;;
    check) echo 15d1162dae521e3aa0b922b920c939dd0fbcaff418e3b9cb8d7dd13b687d899a ;;
    bench) echo "$PIN_BENCH" ;;
    tscases) echo "$PIN_TSCASES" ;;
  esac
}
# sha256 of the records (the run without its first line) that a release build of main gives with harness.all.mjs.
# main at f4d755a9cf and main at bc7a813b10 give the same records: no commit between them is in the parser.
golden() {
  case $1 in
    seams) echo 255aa6be3c2c722dba39f36a197391940ffe268a33eea4dc53dd4cbe2a1711f7 ;;
    seams-bu) echo 549e63ad6fd951888c1dec97f5c7e6b0ff2887beb7513a655ca9825ff94ea057 ;;
    testrows) echo 672f1e03d5b5f0145b5a7167568662580e6a1c007cada017d9ffa3b26b7873e8 ;;
    comments) echo 13f998485d2a2c5624809047cb291ea9daa8a34fde56aa5bcb54082cbce2e638 ;;
    targeted) echo 579fa4af21be4379b33eae28247bbac13e87c30a8528a1196c310c27e35b3152 ;;
    small-sub) echo 08aaea3bb89bfe09f4de3f8f0b3a495b7cf49bca0b91e3b2afdd73afc87600ee ;;
    check) echo 4120467680510265b2b5346dd612def70a53499a1c3282c0e6d0ca1dfa348af5 ;;
    bench) echo 28db6ef12b8fa47f1c78a588e4d63f81119eb72445d9009ef6c47d2d4f256eb6 ;;
    tscases) echo 52b0e193992ea0d3d9e5af3ff8a3222aac1ffd15f24a6a766cc2f5296f3c24d4 ;;
    small) echo "$GOLDEN_SMALL" ;;
  esac
}

sha() { sha256sum "$1" | cut -c1-12; }
field() { sed -nE "s/.*: ([0-9]+) inputs x ([0-9]+) apis, ([0-9]+) crashes.*/\\$2/p" "$1"; }
records_sha() { gzip -dc "$1" | tail -n +2 | sha256sum | cut -d' ' -f1; }

# One run of the harness. It is skipped when its output exists: the directory holds the hashes of the binary and of
# the harness, the name the one of the corpus.
one_run() {
  local bin=$1 workers=$2 cfile=$3 out=$4 log=${4%.jsonl.gz}.log rc
  [ -s "$out" ] && [ -s "$log" ] && return 0
  (cd "$OUT" && env $ENVS "$bin" "$HARNESS" "$cfile" "$out" "--jobs=$workers") > "$log" 2>&1
  rc=$?
  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    echo "harness failed, rc=$rc: $log"
    tail -5 "$log"
    rm -f "$out"
    return 1
  fi
}

# mark <how the pair compares: same|other> : ok or FAIL for EXPECT=zero, seen or same for EXPECT=differ
verdict() {
  if [ "$EXPECT" = differ ]; then [ "$1" = other ] && echo seen || echo same; else [ "$1" = same ] && echo ok || echo FAIL; fi
}
# count <name of the pair> <verdict>
count() {
  PAIRS=$((PAIRS + 1))
  case $2 in
    ok) ;;
    seen) SEEN="$SEEN $1" ;;
    same) SAME="$SAME $1" ;;
    *) BAD=$((BAD + 1)) ;;
  esac
}

pair() {
  local c=$1 cfile pin csha b n rc line compared differ bs ns how=same mark gold
  cfile=$(corpus_file "$c")
  [ -n "$cfile" ] && [ -s "$cfile" ] || { echo "FAIL  $c: no corpus $cfile"; count "$c" FAIL; return; }
  pin=$(corpus_pin "$c")
  csha=$(sha256sum "$cfile" | cut -d' ' -f1)
  [ -z "$pin" ] || [ "$pin" = "$csha" ] || { echo "FAIL  $c: the corpus changed, $cfile is $csha"; count "$c" FAIL; return; }
  b=$B/$c.${csha:0:8}.jsonl.gz
  n=$D/$c.${csha:0:8}.jsonl.gz
  one_run "$BASE" 4 "$cfile" "$b" && one_run "$NEXT" "$JOBS" "$cfile" "$n" || { echo "FAIL  $c: a harness did not run"; count "$c" FAIL; return; }
  "$BASE" "$G/diff.mjs" "$b" "$n" "--out=$D/diff.$c.jsonl" --show=3 > "$D/diff.$c.txt" 2>&1
  rc=$?
  line=$(sed -n 3p "$D/diff.$c.txt")
  compared=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\1/p')
  differ=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\2/p')
  bs=$(records_sha "$b")
  ns=$(records_sha "$n")
  [ "$rc" = 0 ] && [ "$differ" = 0 ] && [ "$bs" = "$ns" ] || how=other
  mark=$(verdict $how)
  # Whatever is expected, both runs are whole: the same inputs, all configurations, no crash, no hang.
  [ "$(field "${b%.jsonl.gz}.log" 2)" = "$NAPIS" ] && [ "$(field "${n%.jsonl.gz}.log" 2)" = "$NAPIS" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 1)" = "$(field "${n%.jsonl.gz}.log" 1)" ] || mark=FAIL
  [ "$compared" = "$(($(field "${b%.jsonl.gz}.log" 1) * NAPIS))" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 3)" = 0 ] && [ "$(field "${n%.jsonl.gz}.log" 3)" = 0 ] || mark=FAIL
  gold=$(golden "$c")
  case "$BASE_VERSION" in *+f4d755a9c | *+bc7a813b1) [ -z "$gold" ] || [ "$gold" = "$bs" ] || { mark=FAIL; echo "        the base run is not the recorded one of main: $bs"; } ;; esac
  local table=""
  if [ $how = other ] && [ -s "$D/diff.$c.jsonl" ]; then
    if [ "$c" = seams ] || [ "$c" = seams-bu ]; then
      # With EXPECT=differ every group of a seam corpus has to differ, but the ones of sites that round 1 left as they were.
      "$BASE" "$G/seams-seen.mjs" "$cfile" "$D/diff.$c.jsonl" > "$D/diff.$c.seen.txt" 2>&1 || { [ "$EXPECT" = differ ] && mark=FAIL; }
      table=$(sed 's/^/        /' "$D/diff.$c.seen.txt")
    else
      table=$("$BASE" "$T/classes.mjs" "$D/diff.$c.jsonl")
    fi
  fi
  printf '%-4s  %-9s sources %-6s x %-2s records %-8s differ %-7s crashes %s/%s  corpus %s  sha256 of the records %s %s\n' \
    "$mark" "$c" "$(field "${b%.jsonl.gz}.log" 1)" "$NAPIS" "${compared:-?}" "${differ:-?}" \
    "$(field "${b%.jsonl.gz}.log" 3)" "$(field "${n%.jsonl.gz}.log" 3)" "${csha:0:12}" "${bs:0:16}" "$([ "$bs" = "$ns" ] && echo = || echo "!= ${ns:0:16}")"
  [ -z "$table" ] || echo "$table"
  count "$c" "$mark"
}

# Both sides read the checkout as it is now, so this step is never taken from an earlier run.
files() {
  local b=$B/files.jsonl n=$D/files.jsonl how=same mark
  (cd "$OUT" && env $ENVS "$BASE" "$T/files-worker.mjs" "$TREE" "$b" "$HARNESS") > "$B/files.log" 2>&1 || { echo "FAIL  files: the base worker ended early after $(tail -1 "$b" | cut -c1-200), $B/files.log"; count files FAIL; return; }
  (cd "$OUT" && env $ENVS "$NEXT" "$T/files-worker.mjs" "$TREE" "$n" "$HARNESS") > "$D/files.log" 2>&1 || { echo "FAIL  files: the worker ended early after $(tail -1 "$n" | cut -c1-200), $D/files.log"; count files FAIL; return; }
  cmp -s "$b" "$n" || how=other
  mark=$(verdict $how)
  printf '%-4s  files           %s | %s  sha256 %s %s\n' "$mark" "$(tail -1 "$B/files.log")" "$(tail -1 "$D/files.log")" \
    "$(sha256sum < "$b" | cut -c1-16)" "$(cmp -s "$b" "$n" && echo = || echo "!= $(sha256sum < "$n" | cut -c1-16)")"
  if [ $how = other ]; then
    "$BASE" "$T/files-diff.mjs" "$b" "$n" > "$D/diff.files.txt" 2>&1
    cat "$D/diff.files.txt"
  fi
  count files "$mark"
}

# The cache entries that the runtime transpiler writes for the sources of a corpus, both sides, never from an earlier run.
runtime_one() {
  local c=$1 cfile side dir bin how=same mark
  cfile=$(corpus_file "$c")
  [ -s "$cfile" ] || { echo "FAIL  runtime $c: no corpus"; count "runtime.$c" FAIL; return; }
  for side in base next; do
    if [ $side = base ]; then dir=$B; bin=$BASE; else dir=$D; bin=$NEXT; fi
    rm -rf "$dir/rt.$c.cache"
    (cd "$OUT" && env $ENVS "BUN_RUNTIME_TRANSPILER_CACHE_PATH=$dir/rt.$c.cache" "$bin" "$T/rt-worker.mjs" "$cfile" "$dir/rt-work") > "$dir/rt.$c.log" 2>&1 \
      || { echo "FAIL  runtime $c: the $side run ended early, $dir/rt.$c.log"; count "runtime.$c" FAIL; return; }
    "$BASE" "$T/rt-sum.mjs" "$dir/rt.$c.cache" > "$dir/rt.$c.txt" 2>&1 || { echo "FAIL  runtime $c: no cache entries of the $side run"; count "runtime.$c" FAIL; return; }
    rm -rf "$dir/rt.$c.cache"
  done
  cmp -s "$B/rt.$c.txt" "$D/rt.$c.txt" || how=other
  mark=$(verdict $how)
  [ "$(tail -1 "$D/rt.$c.log" | cut -d' ' -f3)" = 0 ] || mark=FAIL
  printf '%-4s  runtime %-9s %s | %s  base: %s  next: %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$B/rt.$c.log")" "$(tail -1 "$D/rt.$c.log")" \
    "$(head -1 "$B/rt.$c.txt")" "$(head -1 "$D/rt.$c.txt")" "$(sha256sum < "$B/rt.$c.txt" | cut -c1-16)" \
    "$(cmp -s "$B/rt.$c.txt" "$D/rt.$c.txt" && echo = || echo "!= $(sha256sum < "$D/rt.$c.txt" | cut -c1-16)")"
  [ $how = other ] && echo "        entries only of the base $(comm -23 <(tail -n +2 "$B/rt.$c.txt" | cut -d' ' -f1) <(tail -n +2 "$D/rt.$c.txt" | cut -d' ' -f1) | wc -l), only of the binary under test $(comm -13 <(tail -n +2 "$B/rt.$c.txt" | cut -d' ' -f1) <(tail -n +2 "$D/rt.$c.txt" | cut -d' ' -f1) | wc -l), of both with other bytes $(join <(tail -n +2 "$B/rt.$c.txt") <(tail -n +2 "$D/rt.$c.txt") | awk '$2 != $4 || $3 != $5' | wc -l)"
  count "runtime.$c" "$mark"
}

# Bun.build of every source of a corpus as .ts, .tsx and .js, both sides in the same directory, never from an earlier run.
bundle_one() {
  local c=$1 cfile side dir bin how=same mark
  cfile=$(corpus_file "$c")
  [ -s "$cfile" ] || { echo "FAIL  bundle $c: no corpus"; count "bundle.$c" FAIL; return; }
  for side in base next; do
    if [ $side = base ]; then dir=$B; bin=$BASE; else dir=$D; bin=$NEXT; fi
    (cd "$OUT" && env $ENVS "$bin" "$T/bundle-worker.mjs" "$cfile" "$dir/bundle.$c.jsonl" "$OUT/bundle-work") > "$dir/bundle.$c.log" 2>&1 \
      || { echo "FAIL  bundle $c: the $side run ended early, $dir/bundle.$c.log"; count "bundle.$c" FAIL; return; }
  done
  cmp -s "$B/bundle.$c.jsonl" "$D/bundle.$c.jsonl" || how=other
  mark=$(verdict $how)
  printf '%-4s  bundle  %-9s %s | %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$B/bundle.$c.log" | cut -d, -f1-2)" "$(tail -1 "$D/bundle.$c.log" | cut -d, -f1-2)" \
    "$(sha256sum < "$B/bundle.$c.jsonl" | cut -c1-16)" "$(cmp -s "$B/bundle.$c.jsonl" "$D/bundle.$c.jsonl" && echo = || echo "!= $(sha256sum < "$D/bundle.$c.jsonl" | cut -c1-16)")"
  [ $how = other ] && "$BASE" "$T/bundle-diff.mjs" "$B/bundle.$c.jsonl" "$D/bundle.$c.jsonl" | tee "$D/diff.bundle.$c.txt"
  count "bundle.$c" "$mark"
}

# `bun pm diff` of two folders that hold the sources of a corpus: what it prints on a terminal, its errors, its exit code.
pmdiff_one() {
  local c=$1 cfile csha work side dir bin how=same mark
  cfile=$(corpus_file "$c")
  [ -s "$cfile" ] || { echo "FAIL  pmdiff $c: no corpus"; count "pmdiff.$c" FAIL; return; }
  csha=$(sha "$cfile")
  work=$OUT/pmdiff.$c.$csha
  [ -s "$work/index.json" ] || "$BASE" "$T/pmdiff-make.mjs" "$cfile" "$work" > "$OUT/pmdiff.$c.make.log" 2>&1 || { echo "FAIL  pmdiff $c: the folders were not made"; count "pmdiff.$c" FAIL; return; }
  for side in base next; do
    if [ $side = base ]; then dir=$B; bin=$BASE; else dir=$D; bin=$NEXT; fi
    (cd "$work" && env -u NO_COLOR BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 FORCE_COLOR=1 COLUMNS=120 "$bin" pm diff ./a ./b) > "$dir/pmdiff.$c.out" 2> "$dir/pmdiff.$c.err"
    echo "exit $?" > "$dir/pmdiff.$c.rc"
  done
  cmp -s "$B/pmdiff.$c.out" "$D/pmdiff.$c.out" && cmp -s "$B/pmdiff.$c.err" "$D/pmdiff.$c.err" && cmp -s "$B/pmdiff.$c.rc" "$D/pmdiff.$c.rc" || how=other
  mark=$(verdict $how)
  [ "$(cat "$B/pmdiff.$c.rc")" = "exit 0" ] && [ "$(cat "$D/pmdiff.$c.rc")" = "exit 0" ] || mark=FAIL
  printf '%-4s  pmdiff  %-9s %s  %s | %s  bytes %s | %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$OUT/pmdiff.$c.make.log" 2>/dev/null)" \
    "$(cat "$B/pmdiff.$c.rc")" "$(cat "$D/pmdiff.$c.rc")" "$(stat -c %s "$B/pmdiff.$c.out")" "$(stat -c %s "$D/pmdiff.$c.out")" \
    "$(sha256sum < "$B/pmdiff.$c.out" | cut -c1-16)" "$(cmp -s "$B/pmdiff.$c.out" "$D/pmdiff.$c.out" && echo = || echo "!= $(sha256sum < "$D/pmdiff.$c.out" | cut -c1-16)")"
  [ $how = other ] && "$BASE" "$T/pmdiff-diff.mjs" "$B/pmdiff.$c.out" "$D/pmdiff.$c.out" "$work/index.json" | tee "$D/diff.pmdiff.$c.txt"
  count "pmdiff.$c" "$mark"
}

# The names of a bytecode order file for every source of a corpus, both sides, never from an earlier run.
order_one() {
  local c=$1 cfile side dir bin how=same mark
  cfile=$(corpus_file "$c")
  [ -s "$cfile" ] || { echo "FAIL  order $c: no corpus"; count "order.$c" FAIL; return; }
  for side in base next; do
    if [ $side = base ]; then dir=$B; bin=$BASE; else dir=$D; bin=$NEXT; fi
    (cd "$OUT" && env $ENVS BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 "$bin" "$T/order-worker.mjs" "$cfile" "$dir/order.$c.jsonl") > "$dir/order.$c.log" 2>&1 \
      || { echo "FAIL  order $c: the $side run ended early, $dir/order.$c.log"; count "order.$c" FAIL; return; }
  done
  cmp -s "$B/order.$c.jsonl" "$D/order.$c.jsonl" || how=other
  mark=$(verdict $how)
  printf '%-4s  order   %-9s %s | %s  sha256 %s %s\n' "$mark" "$c" "$(tail -1 "$B/order.$c.log" | cut -d, -f1-3)" "$(tail -1 "$D/order.$c.log" | cut -d, -f1-3)" \
    "$(sha256sum < "$B/order.$c.jsonl" | cut -c1-16)" "$(cmp -s "$B/order.$c.jsonl" "$D/order.$c.jsonl" && echo = || echo "!= $(sha256sum < "$D/order.$c.jsonl" | cut -c1-16)")"
  [ $how = other ] && "$BASE" "$T/order-diff.mjs" "$B/order.$c.jsonl" "$D/order.$c.jsonl" | tee "$D/diff.order.$c.txt"
  count "order.$c" "$mark"
}

run_steps() {
  local c r must missing=""
  echo "run     $(date -u +%FT%TZ)  tag $TAG  expect $EXPECT  steps $*"
  echo "base    $BASE  sha256 $(sha256sum "$BASE" | cut -d' ' -f1)  $BASE_VERSION"
  echo "next    $NEXT  sha256 $(sha256sum "$NEXT" | cut -d' ' -f1)  $NEXT_VERSION  built $(date -u -r "$NEXT" +%FT%TZ)  workers $JOBS"
  echo "tree    $TREE  $(git -C "$TREE" rev-parse HEAD)  $(timeout 300 git -C "$TREE" status --short -uno -- src test | wc -l) modified files under src and test  EXPECTED_VERSION $(sed -nE 's/^const EXPECTED_VERSION: u32 = ([0-9]+);.*/\1/p' "$TREE/src/jsc/RuntimeTranspilerCache.rs")"
  echo "tools   parity.sh $(sha "$SELF")  harness.all.mjs $(sha "$HARNESS") ($NAPIS configurations)  diff.mjs $(sha "$G/diff.mjs")  seams-seen.mjs $(sha "$G/seams-seen.mjs")  causes none"
  for c in "$@"; do
    case $c in
      files) files ;;
      runtime)
        [ $IS_DEBUG = 0 ] || { echo "skip  runtime: a binary with debug assertions names its cache entries *.debug.pile"; continue; }
        for r in $RUNTIME_CORPORA; do runtime_one "$r"; done
        ;;
      bundle)
        for r in $BUNDLE_CORPORA; do bundle_one "$r"; done
        ;;
      pmdiff)
        [ $IS_DEBUG = 0 ] || { echo "skip  pmdiff: left to the release build"; continue; }
        for r in $PMDIFF_CORPORA; do pmdiff_one "$r"; done
        ;;
      order)
        for r in $ORDER_CORPORA; do order_one "$r"; done
        ;;
      seams | seams-bu | testrows | comments | targeted | small-sub | check | bench | tscases | repo-ts | repo-js | small) pair "$c" ;;
      *) echo "FAIL  unknown step $c"; BAD=$((BAD + 1)) ;;
    esac
  done
  if [ "$EXPECT" = differ ]; then
    for must in $MUST_SEE; do
      case " $SEEN $SAME " in *" $must "*) ;; *) continue ;; esac
      case " $SEEN " in *" $must "*) ;; *) missing="$missing $must" ;; esac
    done
    [ -z "$SAME" ] || echo "same   $SAME"
    if [ $BAD -eq 0 ] && [ -z "$missing" ]; then
      echo "RESULT  SEEN: the run tells the two binaries apart in $(echo $SEEN | wc -w) of $PAIRS pairs of runs, and in every pair that has to"
    else
      echo "RESULT  FAIL: $BAD pairs did not run or groups of seams are not seen; pairs that have to differ and do not:${missing:- none}"
      BAD=$((BAD + 1))
    fi
  elif [ $BAD -eq 0 ]; then
    echo "RESULT  ZERO differing records in $PAIRS pairs of runs"
  else
    echo "RESULT  FAIL: $BAD of $PAIRS pairs of runs differ or did not run"
  fi
  return $BAD
}

parity() {
  N=/workspace/notes/lint/units/parser
  G=$N/grammar-diff
  SELF=$(readlink -f "${BASH_SOURCE[0]}")
  HARNESS=$G/harness.all.mjs
  BASE=${BASE:-/workspace/base/bun.f4d755a9c}
  OUT=${OUT:-/tmp/parser-parity}
  TREE=${TREE:-/workspace/wt/parser}
  EXPECT=${EXPECT:-zero}
  JOBS=${JOBS:-4}
  PIN_BENCH=8e8640fec3fa7c9d2c7cdef9f5d46f5e1fff8e56a035cb39fc8d58e98e21ab99
  PIN_TSCASES=cdddef44e6e6a317e29581949261b4dca3679420e6f4df4fa34a008f00cc5d78
  GOLDEN_SMALL=
  MUST_SEE=${MUST_SEE:-seams seams-bu testrows comments targeted small-sub check tscases small files runtime.seams runtime.seams-bu runtime.testrows bundle.seams bundle.seams-bu bundle.testrows pmdiff.seams pmdiff.testrows}
  RUNTIME_CORPORA=${RUNTIME_CORPORA:-seams seams-bu testrows comments targeted small-sub bench}
  BUNDLE_CORPORA=${BUNDLE_CORPORA:-seams seams-bu testrows comments targeted}
  PMDIFF_CORPORA=${PMDIFF_CORPORA:-seams seams-bu testrows comments targeted}
  ORDER_CORPORA=${ORDER_CORPORA:-seams seams-bu testrows comments targeted bench repo-js}
  [ $# -ge 2 ] || { echo "usage: parity.sh <tag> <bun under test> [step ...]"; return 2; }
  TAG=$1
  NEXT=$(readlink -f "$2")
  shift 2
  [ $# -gt 0 ] || set -- seams seams-bu testrows comments targeted small-sub check bench tscases repo-ts repo-js small files runtime bundle pmdiff order
  [ -x "$BASE" ] && [ -x "$NEXT" ] || { echo "missing binary: $BASE or $NEXT"; return 2; }
  case "$OUT" in /workspace/notes*) echo "OUT must be outside the notes"; return 2 ;; esac
  case "$EXPECT" in zero | differ) ;; *) echo "EXPECT is zero or differ"; return 2 ;; esac
  ENVS="BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NO_COLOR=1"
  BASE_VERSION=$(env $ENVS "$BASE" --revision)
  NEXT_VERSION=$(env $ENVS "$NEXT" --revision 2>&1 | tail -1)
  case "$NEXT_VERSION" in *-debug*) IS_DEBUG=1 ;; *) IS_DEBUG=0 ;; esac
  NAPIS=$(env $ENVS "$BASE" "$HARNESS" --list | tail -1 | cut -d' ' -f1)
  [ "$NAPIS" -gt 0 ] 2>/dev/null || { echo "harness.all.mjs --list gave no count"; return 2; }
  T=$OUT/tools
  B=$OUT/base.$(sha "$BASE").$(sha "$HARNESS")
  D=$OUT/$TAG.$(sha "$NEXT").$(sha "$HARNESS")
  mkdir -p "$B" "$D" || return 2
  rm -f "$D"/summary.*.txt "$D"/diff.*
  write_tools
  local made=""
  for c in "$@"; do
    case $c in
      bench | tscases | repo-ts | repo-js) made="$made $c" ;;
      runtime) case " $RUNTIME_CORPORA " in *" bench "*) case " $made " in *" bench "*) ;; *) made="$made bench" ;; esac ;; esac ;;
      order) for r in bench repo-js; do case " $ORDER_CORPORA " in *" $r "*) case " $made " in *" $r "*) ;; *) made="$made $r" ;; esac ;; esac; done ;;
    esac
  done
  if [ -n "$made" ]; then
    (cd "$OUT" && env $ENVS "$BASE" "$T/make-corpora.mjs" "$OUT" "$TREE" $made) > "$OUT/make-corpora.log" 2>&1 || { echo "the corpora of whole files were not made: $OUT/make-corpora.log"; tail -3 "$OUT/make-corpora.log"; return 2; }
  fi
  PAIRS=0
  BAD=0
  SEEN=""
  SAME=""
  local stamp status
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  run_steps "$@" > >(tee "$D/summary.$stamp.txt") 2>&1
  status=$?
  sleep 1
  if [ -n "${SAVE:-}" ]; then
    mkdir -p "$SAVE/$TAG/base"
    cp "$D/summary.$stamp.txt" "$SAVE/$TAG/"
    for f in "$D"/diff.*.txt "$D"/*.log; do [ -f "$f" ] && [ "$(stat -c %s "$f")" -le 262144 ] && cp "$f" "$SAVE/$TAG/"; done
    for f in "$B"/*.log; do [ -f "$f" ] && [ "$(stat -c %s "$f")" -le 262144 ] && cp "$f" "$SAVE/$TAG/base/"; done
  fi
  [ "$status" -eq 0 ]
}

parity "$@"
