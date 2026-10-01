// The test cases of TypeScript as a corpus: every TypeScript unit of tests/cases/{conformance,compiler}.
// A test without an error baseline is valid TypeScript by the judgement of the reference itself
// (no diagnostic of the parser or of the checker under the options of the test).
//
//   bun upstream-corpus.mjs build <out corpus.jsonl>
//   bun upstream-corpus.mjs report <corpus.jsonl> <bun-side .jsonl.gz> <tsc-side .jsonl.gz> <tsgo-side .jsonl.gz> <out dir>
//
// build: one record per unit (a test file, or one @filename part of it) with the extension ts, tsx, mts or cts
//   {"id","src","test": path under tests/cases,"unit": file name of the unit,"tsx","dts","deco": the test sets
//    experimentalDecorators,"go": "clean" | "errors" | "none" (typescript-go has an error baseline, or no
//    baseline at all for the test), "ts": the same for the baselines of TypeScript, "options": the @ lines}
// report: writes upstream.summary.txt and upstream.bun-rejects-clean.tsv (units of tests that are clean in the
//   baselines of typescript-go and that the base build rejects in the configuration of the test).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { readBunSide, readJsonl, readParseSide, tsv } from "./lib.mjs";

const REF = "/workspace/ref/typescript-go";
const CASES = join(REF, "_submodules/TypeScript/tests/cases");
const GO_BASE = join(REF, "testdata/baselines/reference/submodule");
const TS_BASE = join(REF, "_submodules/TypeScript/tests/baselines/reference");
const [mode, ...rest] = process.argv.slice(2);

function baselineIndex(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    const m = /^(.*?)(\(.*\))?\.(errors\.txt|js|types|symbols)$/.exec(name);
    if (!m) continue;
    const e = map.get(m[1]) ?? { any: false, errors: false };
    e.any = true;
    if (m[3] === "errors.txt") e.errors = true;
    map.set(m[1], e);
  }
  return map;
}

if (mode === "build") {
  const [outPath] = rest;
  const lines = [];
  let id = 0;
  const stats = { tests: 0, units: 0 };
  for (const suite of ["conformance", "compiler"]) {
    const goIndex = baselineIndex(join(GO_BASE, suite));
    const tsIndex = baselineIndex(TS_BASE);
    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    })(join(CASES, suite));
    for (const path of files.sort()) {
      const text = readFileSync(path, "utf8").replace(/^\ufeff/, "");
      const name = basename(path).replace(/\.tsx?$/, "");
      const state = idx => {
        const e = idx.get(name);
        return !e ? "none" : e.errors ? "errors" : "clean";
      };
      const options = [];
      const units = [];
      let current = { unit: basename(path), lines: [] };
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*\/\/\s*@(\w+)\s*:\s*(.*?)\s*$/.exec(line);
        if (m) {
          if (m[1].toLowerCase() === "filename") {
            if (current.lines.some(l => l.trim() !== "") || units.length > 0) units.push(current);
            current = { unit: m[2], lines: [] };
          } else options.push(`${m[1]}=${m[2]}`);
          continue;
        }
        current.lines.push(line);
      }
      units.push(current);
      stats.tests++;
      const deco = options.some(o => /^experimentalDecorators=true/i.test(o));
      for (const u of units) {
        if (!/\.(ts|tsx|mts|cts)$/.test(u.unit)) continue;
        stats.units++;
        lines.push(
          JSON.stringify({
            id: id++,
            src: u.lines.join("\n"),
            test: relative(CASES, path),
            unit: u.unit,
            tsx: u.unit.endsWith(".tsx") || undefined,
            dts: /\.d\.[mc]?ts$/.test(u.unit) || undefined,
            deco: deco || undefined,
            go: state(goIndex),
            ts: state(tsIndex),
            options: options.length ? options.join(" ") : undefined,
          }),
        );
      }
    }
  }
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`upstream corpus: ${stats.tests} tests, ${stats.units} TypeScript units`);
} else if (mode === "report") {
  const [corpusPath, bunPath, tscPath, tsgoPath, outDir] = rest;
  mkdirSync(outDir, { recursive: true });
  const corpus = readJsonl(corpusPath);
  const bun = readBunSide(bunPath);
  const tsc = readParseSide(tscPath);
  const tsgo = readParseSide(tsgoPath);
  const out = [];
  const say = s => {
    out.push(s);
    console.log(s);
  };
  const c = { units: corpus.length, goClean: 0, goErrors: 0, goNone: 0, cleanBunRejects: 0, cleanBunAccepts: 0, cleanCrash: 0, cleanTscDiag: 0, cleanGoDiag: 0, errBunAccepts: 0, errBunRejects: 0 };
  const rows = ["test\tunit\tconfiguration\tBun message\toffset\ttsc parse\ttypescript-go parse\toptions\tline of the error"];
  const byMessage = new Map();
  const tests = new Set();
  const cleanTests = new Set();
  const rejectedTests = new Set();
  for (const r of corpus) {
    tests.add(r.test);
    const b = bun.out.get(r.id);
    const d = r.tsx ? "tsx" : "ts";
    const cfg = d + (r.deco ? "D" : "");
    const t = tsc.out.get(r.id)[d];
    const g = tsgo.out.get(r.id)[d];
    if (r.go === "clean") {
      c.goClean++;
      cleanTests.add(r.test);
      if (t[0] !== 0) c.cleanTscDiag++;
      if (g[0] !== 0) c.cleanGoDiag++;
      if (b.crash !== undefined) {
        c.cleanCrash++;
        continue;
      }
      const v = b[cfg];
      if (v[0] === "o") c.cleanBunAccepts++;
      else {
        c.cleanBunRejects++;
        rejectedTests.add(r.test);
        const e = v[1][0];
        const lineText = e[1] ? (r.src.split("\n")[e[1] - 1] ?? "").trim().slice(0, 140) : "";
        rows.push([r.test, r.unit, cfg, tsv(e[0]), e[3], t[0] === 0 ? "parses" : `TS${t[1][0][0]}`, g[0] === 0 ? "parses" : `TS${g[1][0][0]}`, r.options ?? "", tsv(lineText)].join("\t"));
        const k = e[0].replace(/"[A-Za-z_$][\w$]*"/g, '"<w>"');
        byMessage.set(k, (byMessage.get(k) ?? 0) + 1);
      }
    } else if (r.go === "errors") {
      c.goErrors++;
      if (b.crash === undefined) {
        if (b[cfg][0] === "o") c.errBunAccepts++;
        else c.errBunRejects++;
      }
    } else c.goNone++;
  }
  writeFileSync(join(outDir, "upstream.bun-rejects-clean.tsv"), rows.join("\n") + "\n");
  say(`TypeScript test cases (conformance and compiler): ${tests.size} tests with a TypeScript unit, ${c.units} units`);
  say(`  units of tests that typescript-go has no error baseline for ("clean"): ${c.goClean} in ${cleanTests.size} tests; with an error baseline: ${c.goErrors}; test without any baseline in typescript-go: ${c.goNone}`);
  say(`  clean units: tsc 6.0.2 reports a parse diagnostic for ${c.cleanTscDiag}, parsediag (typescript-go) for ${c.cleanGoDiag}`);
  say(`  clean units: the base build accepts ${c.cleanBunAccepts}, REJECTS ${c.cleanBunRejects} (in ${rejectedTests.size} tests), crashes on ${c.cleanCrash}`);
  say(`  units of tests with an error baseline: the base build accepts ${c.errBunAccepts}, rejects ${c.errBunRejects} (the baseline also holds checker errors: no class follows from it)`);
  say(`  rejected clean units by Bun message:`);
  for (const [k, n] of [...byMessage].sort((a, b) => b[1] - a[1])) say(`    ${String(n).padStart(4)}  ${k}`);
  writeFileSync(join(outDir, "upstream.summary.txt"), out.join("\n") + "\n");
} else {
  console.error("usage: bun upstream-corpus.mjs build <out.jsonl> | report <corpus> <bun> <tsc> <tsgo> <out dir>");
  process.exit(1);
}
