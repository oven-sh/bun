// Corpora of whole files for harness.mjs: the tracked TypeScript and JavaScript files of the repository (test, src/js),
// and the single-file units of TypeScript's own tests. One source per distinct text, files above 300 KB left out.
// usage: bun mk-real-corpora.mjs <out dir> [<repository root>]     writes corpus.repo-ts.json, corpus.repo-js.json, corpus.tscases.json
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const root = process.argv[3] ?? "/workspace/wt/parser";
if (!out) {
  console.error("usage: bun mk-real-corpora.mjs <out dir> [<repository root>]");
  process.exit(1);
}
const LIMIT = 300000;
const write = (name, sources) => {
  writeFileSync(join(out, `corpus.${name}.json`), JSON.stringify({ name, contexts: {}, forms: [], sources }));
  console.log(`corpus.${name}.json: ${sources.length} sources, ${sources.reduce((n, s) => n + s.src.length, 0)} characters`);
};

const listed = spawnSync("git", ["-C", root, "ls-files", "-z", "--", "test", "src/js"], { maxBuffer: 1 << 28 });
if (listed.status !== 0) throw new Error("git ls-files: " + listed.stderr);
const files = listed.stdout.toString().split("\0").filter(Boolean).sort();
for (const [name, pattern] of [
  ["repo-ts", /\.(ts|tsx|mts|cts)$/],
  ["repo-js", /\.(js|mjs|cjs|jsx)$/],
]) {
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
    if (!st.isFile() || st.size > LIMIT) continue;
    const src = readFileSync(join(root, file), "utf8");
    if (seen.has(src)) continue;
    seen.add(src);
    sources.push({ prod: file, src });
  }
  write(name, sources);
}

const CASES = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const seen = new Set();
const units = [];
function walk(dir) {
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
}
walk(join(CASES, "compiler"));
walk(join(CASES, "conformance"));
write("tscases", units);
