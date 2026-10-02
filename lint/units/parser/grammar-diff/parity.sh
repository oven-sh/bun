#!/bin/bash
# A parse without lint against main, record by record: every corpus, every configuration, two binaries.
# EXPECT=zero passes only with ZERO differing records in every pair of runs. There is no cause list: diff.mjs gets none.
#   /workspace/tools/lk bash parity.sh <tag> <bun under test> [step ...]
# steps, default all of them in this order:
#   seams testrows comments targeted small-sub check bench tscases repo-ts repo-js small
#            a corpus through harness.mjs (15 configurations) and harness.extra-apis.mjs (7 configurations)
#   files    every tracked TypeScript and JavaScript file under test/ and src/js of TREE, with the configurations of its loader
#   runtime  the small corpora as modules that the runtime loads and never evaluates: the entries of the runtime
#            transpiler cache (version, output, source map, module record)
#   bundle   the small corpora, each source as the one entry point of Bun.build, as .ts, .tsx and .js: the output, the
#            mappings and names of its source map, the messages
#   pmdiff   the small corpora as .js, .ts and .tsx files of two folders through `bun pm diff`: the parser with its default
#            features and the visit pass, which no configuration of Bun.Transpiler runs for JavaScript
# env: BASE    the base binary, a release build of main     default /workspace/base/bun.f4d755a9c
#      JOBS    workers of the binary under test             default 4 (the base always runs 4)
#      OUT     run files, never inside the notes            default /tmp/parser-parity
#      TREE    the checkout that files and repo-* read      default /workspace/wt/parser
#      SAVE    a directory that gets <tag>/: the summary, the tables and the one-line logs (small text only)
#      EXPECT  zero (default) | differ: the binary under test is known to differ and the run has to see it, in
#              every seam of the seams corpus and in every pair of MUST_SEE
#      FINE    1 (default): an error is message, line, column, length, offset, level, notes | 0: message, line, column
#      RUNTIME_CORPORA, BUNDLE_CORPORA, PMDIFF_CORPORA   the corpora of those three steps, default the small ones
# A binary with debug assertions ends the message of Lexer::expect_contextual_keyword with " (token: T...)": its runs are
# compared without that text, and the steps runtime and pmdiff are left out for it.
# The body is functions, so that an edit of this file during a run does not reach the run.
set -u

write_tools() {
mkdir -p "$T"
cat > "$T/fine.mjs" <<'JS'
// A copy of a harness whose error record is [message, line, column, length, offset, level, notes].
import { readFileSync, writeFileSync } from "node:fs";
const [from, to] = process.argv.slice(2);
const text = readFileSync(from, "utf8");
const old = "  return list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null]);";
if (text.split(old).length !== 2) throw new Error("the line of errorsOf is not in " + from);
const fine =
  "  const at = p => [p?.line ?? null, p?.column ?? null, p?.length ?? null, p?.offset ?? null];\n" +
  "  return list.map(x => [String(x?.message ?? x), ...at(x?.position), x?.level ?? null, (x?.notes ?? []).map(n => [String(n?.message ?? n), ...at(n?.position)])]);";
writeFileSync(to, text.replace(old, () => fine));
JS

cat > "$T/classes.mjs" <<'JS'
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

cat > "$T/strip-debug-suffix.mjs" <<'JS'
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
      value = ["e", value[1].map(([message, ...rest]) => {
        const m = suffix.exec(message);
        if (m) here++;
        return [m ? m[1] : message, ...rest];
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
          if (!/\.(ts|tsx|mts|cts)$/.test(unit)) continue;
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
const [root, outPath, mainPath, extraPath] = process.argv.slice(2);
const { APIS: MAIN } = await import(mainPath);
const { APIS: EXTRA } = await import(extraPath);
const listed = Bun.spawnSync({ cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"], stdout: "pipe", stderr: "pipe" });
if (listed.exitCode !== 0) throw new Error("git ls-files: " + listed.stderr.toString());
const loaderOf = file => (/\.(ts|mts|cts)$/.test(file) ? "ts" : /\.tsx$/.test(file) ? "tsx" : /\.(js|mjs|cjs)$/.test(file) ? "js" : /\.jsx$/.test(file) ? "jsx" : null);
const files = listed.stdout.toString().split("\0").filter(file => loaderOf(file) !== null);
const apis = [...MAIN, ...EXTRA].map(([name, method, options]) => ({ name, method, loader: options.loader, transpiler: new Bun.Transpiler({ define: { "process.env.NODE_ENV": '"development"' }, ...options }) }));
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
    if (differ <= 40) console.log(`        ${(x[k] ?? y[k])[0].padEnd(16)} ${x[k]?.[1] ?? "missing"}>${y[k]?.[1] ?? "missing"} ${file}`);
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

cat > "$T/seams-seen.mjs" <<'JS'
// The seams of the seams corpus by how many of their sources differ in the two diff files: a seam with none is not seen.
import { readFileSync } from "node:fs";
const [corpusPath, ...diffs] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const seams = new Map();
for (const s of corpus.sources) {
  const seam = seams.get(s.prod) ?? { sources: 0, differ: new Set(), classes: {} };
  seam.sources++;
  seams.set(s.prod, seam);
}
for (const path of diffs) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    const seam = seams.get(d.prod);
    if (!seam) continue;
    if (!seam.differ.has(d.src + "\0" + d.cls)) seam.classes[d.cls] = (seam.classes[d.cls] ?? 0) + 1;
    seam.differ.add(d.src + "\0" + d.cls);
    seam.differ.add(d.src);
  }
}
let unseen = 0;
for (const [name, seam] of seams) {
  const sources = [...seam.differ].filter(key => !key.includes("\0")).length;
  const expected = name !== "site.unchanged";
  if (expected && sources === 0) unseen++;
  console.log(`        ${(expected && sources === 0 ? "NOT SEEN" : "seen").padEnd(9)}${name.padEnd(30)} sources ${String(seam.sources).padStart(4)}  differ ${String(sources).padStart(4)}  ${Object.entries(seam.classes).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
console.log(`${seams.size} seams, ${unseen} not seen`);
process.exit(unseen === 0 ? 0 : 1);
JS
}

corpus_file() {
  case $1 in
    seams) echo "$G/corpus.seams.json" ;;
    small) echo "$G/corpus.small.json" ;;
    small-sub) echo "$N/grammar-diff-oracle-and-causes/runs/corpus.small-sub.json" ;;
    targeted) echo "$N/round2/grammar-diff-run/bottom-up/runs/corpus.targeted.with-09.json" ;;
    testrows) echo "$N/grammar-diff-oracle-and-causes/runs/corpus.testrows.json" ;;
    comments) echo "$N/round2/a1-differential/top-down/blind-spots/corpus.comments.json" ;;
    check) echo "$N/round2/grammar-diff-run/bottom-up/runs/corpus.check.json" ;;
    bench | tscases | repo-ts | repo-js) echo "$OUT/corpus.$1.json" ;;
  esac
}
# sha256 of the corpora that the notes hold: a corpus that changed is no longer the one of the recorded runs.
corpus_pin() {
  case $1 in
    seams) echo 140755828465cf395762eaeb73ffb94d6fdc991d2373e17e63158ea5ed1412d5 ;;
    small) echo 19d140cdf29b4cfcc6682bf827642a0c3e138ad34a120867b0e0e21e35e3dc81 ;;
    small-sub) echo edb744ab7286d2fc7d774bea188dde4eb861f3bfd97160ba108de5b68f279bc4 ;;
    targeted) echo 68d65cd91163a1d165a2f68da19054bf895024e4459ef6cce03977fc56b63487 ;;
    testrows) echo 7188b5c7588d722ca533abf19b0cbb748c320eff2832baaf435fdc2005c84e64 ;;
    comments) echo 71d0420c2a27660af8b170c55dcd131691fae4572942f7967c76287733444b4f ;;
    check) echo 15d1162dae521e3aa0b922b920c939dd0fbcaff418e3b9cb8d7dd13b687d899a ;;
  esac
}
# sha256 of the records (the run without its first line) that the release build of main at f4d755a9cf gives: <FINE>.<harness>.<corpus>
golden() {
  case $1 in
    0.main.testrows) echo 77468c48cc326d5a5329afe92ad108182a10d179d7f6b41f925169d0f100a3e2 ;;
    0.main.comments) echo 034937f8c0a0039e56fee931d37d4db81965d95a4941a5cd7ec8a89d187e8860 ;;
    0.main.targeted) echo ba2aed306128816e0ddeaf35fee67ea768f4bb6c3139fdef12aa78d819249b5e ;;
    0.main.small-sub) echo 7bdcb1430a3c03158d37b53f272e85beb0f1edf667a7c4e4b0fdfffd4a56a260 ;;
    0.main.small) echo 2d9f0eb39865624b3ef690a598ca4497cd937c41dbcb871c3982cd23baa73c0b ;;
    0.extra.testrows) echo 499643a35586e1312f448d2f48efaa78222889e1f1983e8a2ae55fee5ef378e2 ;;
    0.extra.comments) echo 8c63964f6cac16cfd666aa3ab592a129997b7014aac7c5ce792bc0abe1db0765 ;;
    0.extra.targeted) echo 8d963576d4e66888ec4389e6ca9f46f738bdfd4f274f23207d7a7731a1a0ae19 ;;
    0.extra.small-sub) echo 2c5ab7ff4fc64f0afca2ef969d9c8f06fdbb05a8f46008e47ccc858f2ab95ce0 ;;
    0.extra.small) echo 4b4a01e5fbdadff0c584d23853b3b7292db84966d458adc9070c7169d236fa83 ;;
    1.main.seams) echo 68aad3ce786f63a5a63fd8a766bcc6532091e3eeda47d70333ea3aa04832635a ;;
    1.main.testrows) echo 425c436806c46c5c01b0ba16c81d3b9ac3e92a6089e14eea7e1cff2053493c93 ;;
    1.main.comments) echo 0e74102d0cd37a5d9529a5815c2cd136a443801bfa710159541e0067b0039aea ;;
    1.main.targeted) echo a42a1c9f81a3cc1b5ce95f0c7472d0bf5ecf4599ec4f790da4645154f7716d7e ;;
    1.main.small-sub) echo 3d29777be9d305f2c9f7a1bd42beaa086bcaf653999b0af1cff31cf9aa60376e ;;
    1.main.check) echo e7eb1e9cbd2e1079d0c3d84fe52ac86edc5df6f286932f8cbed010b99c549297 ;;
    1.main.small) echo 550b15871c279c804e1bfcc0ff9886bbb118c248fedd84b561c71bff35e84d97 ;;
    1.extra.seams) echo 42fceddbac8d8d0512a7431478ce2c00ec8d30b9d060b4aec8d16a9705e0c70b ;;
    1.extra.testrows) echo a2344c70cd5705e693b3814f65df335504d9f3025dc5ba21af0fd4a5be45ea19 ;;
    1.extra.comments) echo 864080cb8f259d443b5345c21248268973f322d3e86dd75575bd686cd0edf7f3 ;;
    1.extra.targeted) echo 0b12128e2fc0add9ddaf51ccba0941300b8acd655517f27e6a40d1585b675154 ;;
    1.extra.small-sub) echo 88e69a40f3ec4477389406df06d52fb970dc7ff000b80d45d96a4aeb4c2d0477 ;;
    1.extra.check) echo c5219b150811afe0ac13ad71b63c680d56c6bf960c78b9f56729d1a4060c7671 ;;
    1.extra.small) echo cfaa4130587c781f7a6fa5b1a36abb522894a982991e4a47e3cc757c3427df73 ;;
  esac
}

sha() { sha256sum "$1" | cut -c1-12; }
field() { sed -nE "s/.*: ([0-9]+) inputs x ([0-9]+) apis, ([0-9]+) crashes.*/\\$2/p" "$1"; }
records_sha() { gzip -dc "$1" | tail -n +2 | sha256sum | cut -d' ' -f1; }

# One run of a harness. It is skipped when its output exists: the directory holds the hash of the binary, the name the one of the corpus.
one_run() {
  local bin=$1 workers=$2 hfile=$3 cfile=$4 out=$5 log=${5%.jsonl.gz}.log rc
  [ -s "$out" ] && [ -s "$log" ] && return 0
  (cd "$OUT" && env $ENVS "$bin" "$hfile" "$cfile" "$out" "--jobs=$workers") > "$log" 2>&1
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
  local h=$1 c=$2 hfile napis cfile pin csha b n cmpn rc line compared differ bs ns how=same mark gold
  [ "$h" = main ] && { hfile=$MAIN; napis=15; } || { hfile=$EXTRA; napis=7; }
  cfile=$(corpus_file "$c")
  [ -n "$cfile" ] && [ -s "$cfile" ] || { echo "FAIL  $h $c: no corpus $cfile"; count "$h.$c" FAIL; return; }
  pin=$(corpus_pin "$c")
  csha=$(sha256sum "$cfile" | cut -d' ' -f1)
  [ -z "$pin" ] || [ "$pin" = "$csha" ] || { echo "FAIL  $h $c: the corpus changed, $cfile is $csha"; count "$h.$c" FAIL; return; }
  b=$B/$h.$c.${csha:0:8}.jsonl.gz
  n=$D/$h.$c.${csha:0:8}.jsonl.gz
  one_run "$BASE" 4 "$hfile" "$cfile" "$b" && one_run "$NEXT" "$JOBS" "$hfile" "$cfile" "$n" || { echo "FAIL  $h $c: a harness did not run"; count "$h.$c" FAIL; return; }
  cmpn=$n
  if [ $STRIP = 1 ]; then
    cmpn=$D/$h.$c.stripped.jsonl.gz
    "$BASE" "$T/strip-debug-suffix.mjs" "$n" "$cmpn" > "$D/$h.$c.stripped.log" 2>&1 || { echo "FAIL  $h $c: strip"; count "$h.$c" FAIL; return; }
  fi
  "$BASE" "$G/diff.mjs" "$b" "$cmpn" "--out=$D/diff.$h.$c.jsonl" --show=3 > "$D/diff.$h.$c.txt" 2>&1
  rc=$?
  line=$(sed -n 3p "$D/diff.$h.$c.txt")
  compared=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\1/p')
  differ=$(echo "$line" | sed -nE 's/^([0-9]+) records compared, ([0-9]+) differ, in ([0-9]+) sources$/\2/p')
  bs=$(records_sha "$b")
  ns=$(records_sha "$cmpn")
  [ "$rc" = 0 ] && [ "$differ" = 0 ] && [ "$bs" = "$ns" ] || how=other
  mark=$(verdict $how)
  # Whatever is expected, both runs are whole: the same inputs, all configurations, no crash, no hang.
  [ "$(field "${b%.jsonl.gz}.log" 2)" = "$napis" ] && [ "$(field "${n%.jsonl.gz}.log" 2)" = "$napis" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 1)" = "$(field "${n%.jsonl.gz}.log" 1)" ] || mark=FAIL
  [ "$compared" = "$(($(field "${b%.jsonl.gz}.log" 1) * napis))" ] || mark=FAIL
  [ "$(field "${b%.jsonl.gz}.log" 3)" = 0 ] && [ "$(field "${n%.jsonl.gz}.log" 3)" = 0 ] || mark=FAIL
  gold=$(golden "$FINE.$h.$c")
  case "$BASE_VERSION" in *+f4d755a9c) [ -z "$gold" ] || [ "$gold" = "$bs" ] || { mark=FAIL; echo "        the base run is not the one of f4d755a9cf: $bs"; } ;; esac
  printf '%-4s  %-5s %-9s sources %-6s x %-2s records %-8s differ %-7s crashes %s/%s  sha256 of the records %s %s\n' \
    "$mark" "$h" "$c" "$(field "${b%.jsonl.gz}.log" 1)" "$napis" "${compared:-?}" "${differ:-?}" \
    "$(field "${b%.jsonl.gz}.log" 3)" "$(field "${n%.jsonl.gz}.log" 3)" "${bs:0:16}" "$([ "$bs" = "$ns" ] && echo = || echo "!= ${ns:0:16}")"
  [ $STRIP = 1 ] && echo "        $(cat "$D/$h.$c.stripped.log")"
  [ $how = other ] && [ -s "$D/diff.$h.$c.jsonl" ] && "$BASE" "$T/classes.mjs" "$D/diff.$h.$c.jsonl"
  count "$h.$c" "$mark"
}

# Both sides read the checkout as it is now, so this step is never taken from an earlier run.
files() {
  local b=$B/files.jsonl n=$D/files.jsonl how=same mark
  (cd "$OUT" && env $ENVS "$BASE" "$T/files-worker.mjs" "$TREE" "$b" "$MAIN_PLAIN" "$EXTRA_PLAIN") > "$B/files.log" 2>&1 || { echo "FAIL  files: the base worker ended early after $(tail -1 "$b" | cut -c1-200), $B/files.log"; count files FAIL; return; }
  (cd "$OUT" && env $ENVS "$NEXT" "$T/files-worker.mjs" "$TREE" "$n" "$MAIN_PLAIN" "$EXTRA_PLAIN") > "$D/files.log" 2>&1 || { echo "FAIL  files: the worker ended early after $(tail -1 "$n" | cut -c1-200), $D/files.log"; count files FAIL; return; }
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

run_steps() {
  local c r must missing=""
  echo "run     $(date -u +%FT%TZ)  tag $TAG  expect $EXPECT  fine $FINE  steps $*"
  echo "base    $BASE  sha256 $(sha256sum "$BASE" | cut -d' ' -f1)  $BASE_VERSION"
  echo "next    $NEXT  sha256 $(sha256sum "$NEXT" | cut -d' ' -f1)  $NEXT_VERSION  built $(date -u -r "$NEXT" +%FT%TZ)  workers $JOBS"
  echo "tree    $TREE  $(git -C "$TREE" rev-parse HEAD)  $(git -C "$TREE" status --short -uno | wc -l) modified files"
  echo "tools   harness $(sha "$G/harness.mjs")  extra harness $(sha "$N/round2/a1-differential/top-down/blind-spots/harness.extra-apis.mjs")  diff $(sha "$G/diff.mjs")  causes none"
  for c in "$@"; do
    case $c in
      files) files ;;
      runtime)
        [ $STRIP = 0 ] || { echo "skip  runtime: a binary with debug assertions names its cache entries *.debug.pile"; continue; }
        for r in $RUNTIME_CORPORA; do runtime_one "$r"; done
        ;;
      bundle)
        for r in $BUNDLE_CORPORA; do bundle_one "$r"; done
        ;;
      pmdiff)
        [ $STRIP = 0 ] || { echo "skip  pmdiff: left to the release build"; continue; }
        for r in $PMDIFF_CORPORA; do pmdiff_one "$r"; done
        ;;
      seams | testrows | comments | targeted | small-sub | check | bench | tscases | repo-ts | repo-js | small)
        pair main "$c"
        pair extra "$c"
        if [ "$c" = seams ] && [ -f "$D/diff.main.seams.jsonl" ] && [ -f "$D/diff.extra.seams.jsonl" ] && [ "$EXPECT" = differ ]; then
          "$BASE" "$T/seams-seen.mjs" "$G/corpus.seams.json" "$D/diff.main.seams.jsonl" "$D/diff.extra.seams.jsonl" || BAD=$((BAD + 1))
        fi
        ;;
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
      echo "RESULT  FAIL: $BAD pairs did not run or seams are not seen; pairs that have to differ and do not:${missing:- none}"
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
  BASE=${BASE:-/workspace/base/bun.f4d755a9c}
  OUT=${OUT:-/tmp/parser-parity}
  TREE=${TREE:-/workspace/wt/parser}
  EXPECT=${EXPECT:-zero}
  FINE=${FINE:-1}
  JOBS=${JOBS:-4}
  MUST_SEE=${MUST_SEE:-main.seams extra.seams main.testrows extra.testrows main.comments extra.comments main.targeted extra.targeted main.small-sub extra.small-sub main.check extra.check main.tscases extra.tscases main.small extra.small files runtime.seams runtime.testrows bundle.seams bundle.testrows pmdiff.seams pmdiff.testrows}
  RUNTIME_CORPORA=${RUNTIME_CORPORA:-seams testrows comments targeted small-sub bench}
  BUNDLE_CORPORA=${BUNDLE_CORPORA:-seams testrows comments targeted}
  PMDIFF_CORPORA=${PMDIFF_CORPORA:-seams testrows comments targeted}
  [ $# -ge 2 ] || { echo "usage: parity.sh <tag> <bun under test> [step ...]"; return 2; }
  TAG=$1
  NEXT=$(readlink -f "$2")
  shift 2
  [ $# -gt 0 ] || set -- seams testrows comments targeted small-sub check bench tscases repo-ts repo-js small files runtime bundle pmdiff
  [ -x "$BASE" ] && [ -x "$NEXT" ] || { echo "missing binary: $BASE or $NEXT"; return 2; }
  case "$OUT" in /workspace/notes*) echo "OUT must be outside the notes"; return 2 ;; esac
  case "$EXPECT" in zero | differ) ;; *) echo "EXPECT is zero or differ"; return 2 ;; esac
  ENVS="BUN_DEBUG_QUIET_LOGS=1 BUN_NO_CORE_DUMP=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 NO_COLOR=1"
  BASE_VERSION=$(env $ENVS "$BASE" --revision)
  NEXT_VERSION=$(env $ENVS "$NEXT" --revision)
  case "$NEXT_VERSION" in *-debug*) STRIP=1 ;; *) STRIP=0 ;; esac
  T=$OUT/tools
  B=$OUT/base.$(sha "$BASE").fine$FINE
  D=$OUT/$TAG.$(sha "$NEXT").fine$FINE
  mkdir -p "$B" "$D" || return 2
  rm -f "$D"/summary.*.txt "$D"/diff.*
  write_tools
  MAIN_PLAIN=$G/harness.mjs
  EXTRA_PLAIN=$N/round2/a1-differential/top-down/blind-spots/harness.extra-apis.mjs
  MAIN=$MAIN_PLAIN
  EXTRA=$EXTRA_PLAIN
  if [ "$FINE" = 1 ]; then
    MAIN=$T/harness.fine.mjs
    EXTRA=$T/harness.extra-apis.fine.mjs
    "$BASE" "$T/fine.mjs" "$MAIN_PLAIN" "$MAIN" && "$BASE" "$T/fine.mjs" "$EXTRA_PLAIN" "$EXTRA" || return 2
  fi
  local made=""
  for c in "$@"; do
    case $c in
      bench | tscases | repo-ts | repo-js) made="$made $c" ;;
      runtime) case " $RUNTIME_CORPORA " in *" bench "*) case " $made " in *" bench "*) ;; *) made="$made bench" ;; esac ;; esac ;;
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
