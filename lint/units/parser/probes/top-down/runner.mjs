#!/usr/bin/env bun
// Compares the TypeScript grammar of a bun binary with tsc, input by input.
//
// usage:  bun runner.mjs [--only <text>] [--inputs <dir>] [--out <dir>] [--bun <path to bun>] [--fresh] [--no-program] [--full]
//   --only <text>   run only the input files whose name contains <text>
//   --inputs <dir>  directory of the input files (default: ./inputs)
//   --out <dir>     directory of the result files (default: ./results)
//   --bun <path>    the bun binary that is probed (default: the binary that runs this script)
//   --fresh         make a new Bun.Transpiler for every call (default: one per configuration)
//   --no-program    skip the tsc program diagnostics (parse diagnostics only)
//   --full          write every input to the result files (default: only the inputs of class A1, A2, B, CRASH,
//                   the inputs whose bun results disagree with each other, and the metadata rows that differ)
//
// Input files: inputs/*.txt. A record starts with a line "=== <kind> <id>" and ends before the next one.
//   kind "file"   the body is a whole source file, compared as .ts
//   kind "tsx"    the body is a whole source file, compared as .tsx
//   kind "dts"    the body is a whole source file, compared as .d.ts (bun has no such mode: loader ts)
//   kind "type"   the body is one type, put into every context of TYPE_CONTEXTS
//   kind "atype"  the body is one type, put into the contexts of ATYPE_CONTEXTS (what is nested in a type)
//   kind "mtype"  the body is one type, put into the contexts of MTYPE_CONTEXTS (decorator metadata)
//   kind "meta"   like "file", and the decorator metadata of bun and tsc is compared
// A line "--- twin" inside a body of kind file, tsx, dts or meta starts a second source: input that the probed
// bun accepts and that must print the same output as the record once the record parses.
//
// Result files, per input file NAME: NAME.jsonl (every detail), and for all files together: classes.tsv,
// causes.tsv (causes.mjs names the place in bun and the production of the reference), metadata.tsv,
// test-candidates.json (rows that fail on the probed bun: input and the output it must print), summary.txt.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { causeOf } from "./causes.mjs";

const HERE = import.meta.dirname;
const argv = process.argv.slice(2);
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const hasFlag = name => argv.includes(name);

const BUN_CONFIGS = [
  { key: "ts", loader: "ts", deco: false },
  { key: "ts+deco", loader: "ts", deco: true },
  { key: "tsx", loader: "tsx", deco: false },
  { key: "tsx+deco", loader: "tsx", deco: true },
];

// The parameter is named x so that "x is T" and "asserts x" name a parameter.
export const TYPE_CONTEXTS = {
  alias: T => `type X = ${T};`,
  var: T => `let x: ${T};`,
  param: T => `function f(x: ${T}) {}`,
  ret: T => `function f(x: any): ${T} { return null as any }`,
  arrowp: T => `let f = (x: ${T}) => x;`,
  arrowr: T => `let f = (x: any): ${T} => x;`,
  as: T => `let v = x as ${T};`,
  satis: T => `let v = x satisfies ${T};`,
  angle: T => `let v = <${T}>x;`,
  targ: T => `f<${T}>(x);`,
  tparam: T => `function f<U extends ${T}, V = ${T}>() {}`,
  prop: T => `class K { @d p: ${T}; }`,
  mparam: T => `class K { @d m(x: ${T}) {} }`,
  mret: T => `class K { @d m(x: any): ${T} { return null as any } }`,
};
export const ATYPE_CONTEXTS = ["alias", "prop"];
export const MTYPE_CONTEXTS = ["alias", "prop", "mparam", "mret"];
const META_CONTEXTS = new Set(["prop", "mparam", "mret"]);

// ───────────────────────────── worker: the bun side ─────────────────────────────

function bunErrors(e) {
  const list = Array.isArray(e?.errors) && e.errors.length > 0 ? e.errors : [e];
  return list.map(x => ({
    m: String(x?.message ?? x),
    o: x?.position?.offset ?? -1,
    l: x?.position?.length ?? -1,
    line: x?.position?.line ?? -1,
    col: x?.position?.column ?? -1,
  }));
}

function makeTranspiler(config) {
  return new Bun.Transpiler({
    loader: config.loader,
    tsconfig: config.deco
      ? { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }
      : undefined,
  });
}

function runBunOnce(transpilers, fresh, src) {
  const result = {};
  for (const config of BUN_CONFIGS) {
    const get = () => (fresh ? makeTranspiler(config) : (transpilers[config.key] ??= makeTranspiler(config)));
    const entry = {};
    try {
      entry.t = { ok: true, out: get().transformSync(src) };
    } catch (e) {
      entry.t = { ok: false, errs: bunErrors(e) };
    }
    try {
      const scanned = get().scan(src);
      entry.s = { ok: true, exports: scanned.exports, imports: scanned.imports };
    } catch (e) {
      entry.s = { ok: false, errs: bunErrors(e) };
    }
    try {
      entry.i = { ok: true, imports: get().scanImports(src) };
    } catch (e) {
      entry.i = { ok: false, errs: bunErrors(e) };
    }
    result[config.key] = entry;
  }
  return result;
}

function workerMain() {
  const inFile = flagValue("--in");
  const outFile = flagValue("--res");
  const from = Number(flagValue("--from", "0"));
  const fresh = hasFlag("--fresh");
  const items = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const fd = fs.openSync(outFile, "a");
  const transpilers = {};
  for (let i = from; i < items.length; i++) {
    fs.writeSync(fd, JSON.stringify({ start: i }) + "\n");
    const res = runBunOnce(transpilers, fresh, items[i]);
    fs.writeSync(fd, JSON.stringify({ done: i, res }) + "\n");
  }
  fs.closeSync(fd);
}

// A crash or a hang of the probed binary is a result of the input that was running, not of the run.
function runBunSide(sources, bunPath, fresh, tmpDir) {
  const inFile = path.join(tmpDir, "bun-in.json");
  const outFile = path.join(tmpDir, "bun-out.jsonl");
  fs.writeFileSync(inFile, JSON.stringify(sources));
  fs.rmSync(outFile, { force: true });
  const results = new Array(sources.length).fill(null);
  let from = 0;
  while (from < sources.length) {
    const args = [import.meta.filename, "--worker", "--in", inFile, "--res", outFile, "--from", String(from)];
    if (fresh) args.push("--fresh");
    const child = spawnSync(bunPath, args, { stdio: ["ignore", "inherit", "pipe"], timeout: 20 * 60 * 1000 });
    const lines = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean) : [];
    let running = -1;
    for (const line of lines) {
      const rec = JSON.parse(line);
      if (rec.start !== undefined) running = rec.start;
      if (rec.done !== undefined) {
        results[rec.done] = rec.res;
        running = -1;
      }
    }
    if (child.status === 0 && running === -1) break;
    if (running === -1) {
      throw new Error(`bun worker failed before any input: status ${child.status} signal ${child.signal}\n${child.stderr}`);
    }
    const stderrTail = String(child.stderr ?? "").split("\n").slice(-12).join("\n");
    results[running] = { crash: { status: child.status, signal: child.signal ?? null, stderr: stderrTail } };
    from = running + 1;
    fs.rmSync(outFile, { force: true });
    fs.writeFileSync(outFile, "");
  }
  return results;
}

// ───────────────────────────── the tsc side ─────────────────────────────

const require = createRequire("/workspace/bun/package.json");
let ts;
const TS_LIB_DIR = "/workspace/bun/node_modules/typescript/lib";
const libCache = new Map();
const kindNames = new Map();

function loadTypeScript() {
  ts = require("typescript");
  for (const name of Object.keys(ts.SyntaxKind)) {
    const value = ts.SyntaxKind[name];
    if (typeof value !== "number") continue;
    if (/^(First|Last)/.test(name)) continue;
    if (!kindNames.has(value)) kindNames.set(value, name);
  }
}

const isGrammarCode = c => c < 2000 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);

function diag(d) {
  return { c: d.code, s: d.start ?? -1, l: d.length ?? -1, m: ts.flattenDiagnosticMessageText(d.messageText, "\n") };
}

const TSC_MODES = {
  ts: { file: "/probe/input.ts", kind: () => ts.ScriptKind.TS },
  tsx: { file: "/probe/input.tsx", kind: () => ts.ScriptKind.TSX },
  dts: { file: "/probe/input.d.ts", kind: () => ts.ScriptKind.TS },
};

function tscParse(src, mode) {
  const m = TSC_MODES[mode];
  return ts.createSourceFile(m.file, src, { languageVersion: ts.ScriptTarget.ESNext }, true, m.kind());
}

function tscProgramDiagnostics(src, mode, deco) {
  const m = TSC_MODES[mode];
  const options = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noResolve: true,
    types: [],
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    ...(deco ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {}),
  };
  const host = {
    getSourceFile(name, languageVersion) {
      if (name === m.file) return ts.createSourceFile(name, src, languageVersion, true, m.kind());
      let sf = libCache.get(name);
      if (sf === undefined) {
        let text;
        try {
          text = fs.readFileSync(name, "utf8");
        } catch {
          return undefined;
        }
        sf = ts.createSourceFile(name, text, languageVersion, true);
        libCache.set(name, sf);
      }
      return sf;
    },
    getDefaultLibFileName: o => path.join(TS_LIB_DIR, ts.getDefaultLibFileName(o)),
    getDefaultLibLocation: () => TS_LIB_DIR,
    writeFile() {},
    getCurrentDirectory: () => "/probe",
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: f => f === m.file || fs.existsSync(f),
    readFile: f => (f === m.file ? src : fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [m.file], options, host });
  const sf = program.getSourceFile(m.file);
  const all = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map(diag);
  const other = [...new Set(all.filter(d => !isGrammarCode(d.c)).map(d => d.c))].sort((a, b) => a - b);
  return { grammar: all.filter(d => isGrammarCode(d.c)), other };
}

function shapeOf(node, sf) {
  const name = kindNames.get(node.kind) ?? String(node.kind);
  if (node.kind === ts.SyntaxKind.Identifier || node.kind === ts.SyntaxKind.PrivateIdentifier) return node.text;
  if (ts.isLiteralExpression(node) || ts.isTemplateLiteralToken?.(node)) {
    return `${name}(${node.getText(sf)})`;
  }
  const children = [];
  ts.forEachChild(node, child => {
    children.push(shapeOf(child, sf));
  });
  if (children.length === 0) return name;
  return `${name}(${children.join(", ")})`;
}

// The checker runs for the primary mode of an input, and for all three modes of a whole file.
function programModes(testCase) {
  if (testCase.kind === "mtype") return testCase.ctx === "alias" ? ["ts"] : [];
  if (testCase.ctx !== "") return ["ts"];
  return Object.keys(TSC_MODES);
}

function tscSide(testCase, withProgram) {
  const out = { parse: {}, prog: {}, progDeco: {}, other: {} };
  const modes = programModes(testCase);
  for (const mode of Object.keys(TSC_MODES)) {
    const sf = tscParse(testCase.src, mode);
    out.parse[mode] = sf.parseDiagnostics.map(diag);
    if (mode === "ts" && testCase.ctx === "alias" && out.parse.ts.length === 0) {
      const stmt = sf.statements[0];
      if (stmt && ts.isTypeAliasDeclaration(stmt)) out.shape = shapeOf(stmt.type, sf);
    }
    if (withProgram && modes.includes(mode) && out.parse[mode].length === 0) {
      const plain = tscProgramDiagnostics(testCase.src, mode, false);
      out.prog[mode] = plain.grammar;
      out.other[mode] = plain.other;
      if (testCase.src.includes("@")) out.progDeco[mode] = tscProgramDiagnostics(testCase.src, mode, true).grammar;
    }
  }
  return out;
}

function tscTranspile(src, strictNullChecks) {
  const compilerOptions = {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  };
  if (strictNullChecks === false) compilerOptions.strictNullChecks = false;
  try {
    const r = ts.transpileModule(src, { compilerOptions, fileName: "input.ts", reportDiagnostics: true });
    return { out: r.outputText, diags: (r.diagnostics ?? []).map(diag), threw: null };
  } catch (e) {
    return { out: null, diags: [], threw: String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 120) };
  }
}

// ───────────────────────────── decorator metadata ─────────────────────────────

function matchClose(text, openIndex) {
  const open = text[openIndex];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text[i] === close ? i : -1;
    }
  }
  return -1;
}

export function normalizeMetadataValue(expr) {
  const NAME = String.raw`[^\s()&|?:=!",\[\]]+`;
  let s = expr.replace(/\s+/g, " ").trim();
  s = s.replace(
    new RegExp(String.raw`typeof \((_\w+) = typeof (${NAME}) !== "undefined" && ((?:\(_\w+ = ${NAME}\) !== void 0 && )*)(${NAME})\) === "function" \? \1 : Object`, "g"),
    (_m, _t, _root, chain, last) => {
      const names = [];
      const re = new RegExp(String.raw`\(_\w+ = (${NAME})\) !== void 0 && `, "g");
      let mm;
      while ((mm = re.exec(chain))) names.push(mm[1]);
      names.push(last);
      let full = names[0];
      for (let i = 1; i < names.length; i++) full += "." + names[i].split(".").slice(1).join(".");
      return `ref(${full})`;
    },
  );
  s = s.replace(
    new RegExp(String.raw`typeof (${NAME}) === "undefined" (?:\|\| typeof ${NAME} === "undefined" )*\? Object : (${NAME})`, "g"),
    (_m, _root, full) => `ref(${full})`,
  );
  s = s.replace(/\bvoid 0\b/g, "undefined");
  s = s.replace(/\[ /g, "[").replace(/ \]/g, "]");
  s = s.replace(/ref\((BigInt|Symbol)\)/g, "$1");
  return s;
}

export function extractMetadata(output) {
  const found = [];
  const re = /(?:__decorate|__legacyDecorateClassTS\w*)\(\[/g;
  let m;
  while ((m = re.exec(output))) {
    const parenIndex = m.index + m[0].length - 2;
    const arrayStart = parenIndex + 1;
    const arrayEnd = matchClose(output, arrayStart);
    const callEnd = matchClose(output, parenIndex);
    if (arrayEnd < 0 || callEnd < 0) continue;
    const target = output
      .slice(arrayEnd + 1, callEnd)
      .replace(/^\s*,\s*/, "")
      .replace(/\s+/g, " ")
      .replace(/\bvoid 0\b/g, "undefined")
      .trim();
    const body = output.slice(arrayStart + 1, arrayEnd);
    const entries = {};
    const mre = /(?:__metadata|__legacyMetadataTS\w*)\("design:(\w+)",\s*/g;
    let mm;
    while ((mm = mre.exec(body))) {
      const open = body.indexOf("(", mm.index);
      const close = matchClose(body, open);
      if (close < 0) continue;
      entries[mm[1]] = normalizeMetadataValue(body.slice(mm.index + mm[0].length, close));
      mre.lastIndex = close;
    }
    found.push({ target, entries });
    re.lastIndex = arrayEnd;
  }
  found.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return found;
}

export function metadataText(list) {
  return list
    .map(
      e =>
        `${e.target} {${["type", "paramtypes", "returntype"]
          .filter(k => k in e.entries)
          .map(k => `${k}=${e.entries[k]}`)
          .join("; ")}}`,
    )
    .join(" ");
}

// ───────────────────────────── inputs ─────────────────────────────

function parseInputFile(file) {
  const records = [];
  let current = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^=== (\w+) (\S+)(?: \| (.*))?$/.exec(line);
    if (m) {
      current = { kind: m[1], id: m[2], note: m[3] ?? "", lines: [], twinLines: null };
      records.push(current);
      continue;
    }
    if (current === null) continue;
    if (line === "--- twin") {
      current.twinLines = [];
      continue;
    }
    (current.twinLines ?? current.lines).push(line);
  }
  const trim = lines => {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  };
  const ids = new Set();
  return records.map(r => {
    if (ids.has(r.id)) throw new Error(`${file}: the id ${r.id} is used twice`);
    ids.add(r.id);
    return { kind: r.kind, id: r.id, note: r.note, body: trim(r.lines), twin: r.twinLines ? trim(r.twinLines) : null };
  });
}

function expand(record, group) {
  const base = { group, recordId: record.id, kind: record.kind, note: record.note };
  if (record.kind === "type" || record.kind === "atype" || record.kind === "mtype") {
    const contexts =
      record.kind === "type" ? Object.keys(TYPE_CONTEXTS) : record.kind === "atype" ? ATYPE_CONTEXTS : MTYPE_CONTEXTS;
    return contexts.map(ctx => ({
      ...base,
      id: `${record.id}@${ctx}`,
      ctx,
      type: record.body,
      src: TYPE_CONTEXTS[ctx](record.body),
      twin: TYPE_CONTEXTS[ctx]("any"),
      primary: "ts",
      meta: META_CONTEXTS.has(ctx),
    }));
  }
  const primary = record.kind === "tsx" ? "tsx" : record.kind === "dts" ? "dts" : "ts";
  return [
    {
      ...base,
      id: record.id,
      ctx: "",
      src: record.body,
      twin: record.twin,
      primary,
      meta: record.kind === "meta",
    },
  ];
}

// ───────────────────────────── classification ─────────────────────────────

const bunKeyOf = mode => (mode === "tsx" ? "tsx" : "ts");

function bunVerdict(bun, key) {
  if (bun.crash) return "crash";
  return bun[key].t.ok ? "ok" : "err";
}

function classify(bun, tsc, mode, deco) {
  const key = bunKeyOf(mode) + (deco ? "+deco" : "");
  const b = bunVerdict(bun, key);
  const parseOk = tsc.parse[mode].length === 0;
  const checker = deco ? (tsc.progDeco[mode] ?? tsc.prog[mode]) : tsc.prog[mode];
  const grammar = parseOk ? (checker ?? []) : [];
  if (b === "crash") return "CRASH";
  if (parseOk && b === "err") return grammar.length === 0 ? "A1" : "A2";
  if (!parseOk && b === "ok") return "B";
  if (parseOk && b === "ok") return grammar.length === 0 ? "both-accept" : "both-accept-checker-grammar";
  return "both-reject";
}

// Every way the bun results of one input disagree with each other.
function bunInconsistencies(bun) {
  if (bun.crash) return [];
  const notes = [];
  for (const loader of ["ts", "tsx"]) {
    const plain = bun[loader];
    const deco = bun[`${loader}+deco`];
    if (plain.t.ok !== deco.t.ok) notes.push(`${loader}: transform ${plain.t.ok ? "ok" : "err"} without decorators, ${deco.t.ok ? "ok" : "err"} with`);
    for (const [name, entry] of [
      [loader, plain],
      [`${loader}+deco`, deco],
    ]) {
      if (entry.t.ok !== entry.s.ok) notes.push(`${name}: transform ${entry.t.ok ? "ok" : "err"}, scan ${entry.s.ok ? "ok" : "err"}`);
      if (entry.t.ok !== entry.i.ok) notes.push(`${name}: transform ${entry.t.ok ? "ok" : "err"}, scanImports ${entry.i.ok ? "ok" : "err"}`);
    }
  }
  return notes;
}

const oneLine = s => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
const firstBunError = (bun, key) => {
  if (bun.crash) return `crash status=${bun.crash.status} signal=${bun.crash.signal}`;
  const e = bun[key].t.errs?.[0];
  return e ? `${e.m} @${e.o}+${e.l}` : "";
};
const tscDiagText = list => list.map(d => `TS${d.c}@${d.s}+${d.l} ${d.m}`).join(" || ");

// ───────────────────────────── main ─────────────────────────────

function main() {
  loadTypeScript();
  const outDir = path.resolve(flagValue("--out", path.join(HERE, "results")));
  const bunPath = flagValue("--bun", process.execPath);
  const only = flagValue("--only", "");
  const fresh = hasFlag("--fresh");
  const withProgram = !hasFlag("--no-program");
  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "probe-run-"));

  const revision = spawnSync(bunPath, ["--revision"], { encoding: "utf8" }).stdout.trim();
  const inputDir = path.resolve(flagValue("--inputs", path.join(HERE, "inputs")));
  const files = fs
    .readdirSync(inputDir)
    .filter(f => f.endsWith(".txt") && f.includes(only))
    .sort();

  const full = hasFlag("--full");
  const classRows = [];
  const metaRows = [];
  const metaCounts = {};
  const causes = new Map();
  const candidates = [];
  const pendingTwins = [];
  const a1Checker = { records: 0, inputs: 0, codes: {} };
  const metaCandidates = [];
  const summary = [];
  summary.push(`bun: ${bunPath} ${revision}`);
  summary.push(`tsc: ${ts.version}`);
  summary.push("");

  for (const file of files) {
    const group = file.replace(/\.txt$/, "");
    const records = parseInputFile(path.join(inputDir, file));
    const cases = records.flatMap(r => expand(r, group));
    const started = performance.now();
    const sources = cases.map(c => c.src);
    const twins = cases.map(c => c.twin ?? "");
    const bunResults = runBunSide(sources, bunPath, fresh, tmpDir);
    const twinResults = runBunSide(twins, bunPath, fresh, tmpDir);
    const lines = [];
    const counts = {};
    const formCounts = {};
    const countsByMode = { deco: {}, tsx: {}, dts: {} };
    const byRecord = new Map();
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const bun = bunResults[i];
      const tsc = tscSide(c, withProgram);
      const cls = classify(bun, tsc, c.primary, false);
      const clsDeco = classify(bun, tsc, c.primary, true);
      const clsTsx = classify(bun, tsc, "tsx", false);
      const clsDts = classify(bun, tsc, "dts", false);
      counts[cls] = (counts[cls] ?? 0) + 1;
      if (c.ctx === "" || c.ctx === "alias") formCounts[cls] = (formCounts[cls] ?? 0) + 1;
      countsByMode.deco[clsDeco] = (countsByMode.deco[clsDeco] ?? 0) + 1;
      countsByMode.tsx[clsTsx] = (countsByMode.tsx[clsTsx] ?? 0) + 1;
      countsByMode.dts[clsDts] = (countsByMode.dts[clsDts] ?? 0) + 1;
      if (!byRecord.has(c.recordId)) byRecord.set(c.recordId, []);
      byRecord.get(c.recordId).push(`${c.ctx}=${cls}`);
      const inconsistent = bunInconsistencies(bun);
      const twinKey = bunKeyOf(c.primary);
      const twin = c.twin !== null && !twinResults[i].crash && twinResults[i][twinKey].t.ok ? twinResults[i][twinKey].t.out : null;

      let meta = null;
      if (c.meta) {
        const strict = tscTranspile(c.src, undefined);
        const loose = tscTranspile(c.src, false);
        const bunOut = !bun.crash && bun["ts+deco"].t.ok ? bun["ts+deco"].t.out : null;
        meta = {
          bun: bunOut === null ? null : metadataText(extractMetadata(bunOut)),
          tsc: strict.diags.length > 0 || strict.threw ? null : metadataText(extractMetadata(strict.out)),
          tscLoose: loose.diags.length > 0 || loose.threw ? null : metadataText(extractMetadata(loose.out)),
          tscDiags: strict.diags,
          tscThrew: strict.threw,
        };
        const verdict =
          meta.bun === null || meta.tsc === null
            ? "n/a"
            : meta.bun === meta.tsc && meta.bun === meta.tscLoose
              ? "same"
              : meta.bun === meta.tsc
                ? "same-as-strict-only"
                : meta.bun === meta.tscLoose
                  ? "same-as-loose-only"
                  : "DIFF";
        metaCounts[verdict] = (metaCounts[verdict] ?? 0) + 1;
        if (full || verdict !== "same") metaRows.push(
          [
            group,
            c.id,
            verdict,
            oneLine(c.type ?? c.src),
            meta.bun ?? `(bun: ${firstBunError(bun, "ts+deco")})`,
            meta.tsc ?? (strict.threw ? `(tsc throws: ${strict.threw})` : `(tsc: ${tscDiagText(strict.diags)})`),
            meta.tscLoose ?? "",
          ].join("\t"),
        );
      }

      const interesting = !cls.startsWith("both") || !clsDeco.startsWith("both") || inconsistent.length > 0;
      let cause = null;
      if (cls === "A1" || cls === "A2" || cls === "B") {
        const first = bun.crash ? null : bun[bunKeyOf(c.primary)].t.errs?.[0];
        cause = causeOf({
          cls,
          group,
          rid: c.recordId,
          kind: c.kind,
          ctx: c.ctx,
          src: c.src,
          type: c.type,
          msg: first ? first.m : "",
          parse: tsc.parse[c.primary].map(d => d.c),
          parseFirstMessage: tsc.parse[c.primary][0]?.m ?? "",
          grammar: [...new Set((tsc.prog[c.primary] ?? []).map(d => d.c))],
          other: tsc.other[c.primary] ?? [],
        });
        const entry = causes.get(cause.id) ?? { ...cause, records: { A1: 0, A2: 0, B: 0 }, inputs: { A1: 0, A2: 0, B: 0 }, examples: [], tscCodes: new Set() };
        entry.inputs[cls]++;
        if (c.ctx === "" || c.ctx === "alias") entry.records[cls]++;
        if (entry.examples.length < 4 && (c.ctx === "" || c.ctx === "alias" || entry.examples.length === 0)) entry.examples.push(oneLine(c.src));
        for (const d of cls === "B" ? tsc.parse[c.primary].slice(0, 1) : (tsc.prog[c.primary] ?? [])) entry.tscCodes.add(`TS${d.c}`);
        for (const code of cls === "B" ? [] : (tsc.other[c.primary] ?? [])) if (!NOISE_CODES.has(code)) entry.tscCodes.add(`(TS${code})`);
        causes.set(cause.id, entry);
        const checkerCodes = (tsc.other[c.primary] ?? []).filter(code => !NOISE_CODES.has(code));
        if (cls === "A1" && checkerCodes.length > 0) {
          a1Checker.inputs++;
          if (c.ctx === "" || c.ctx === "alias") a1Checker.records++;
          for (const code of checkerCodes) a1Checker.codes[code] = (a1Checker.codes[code] ?? 0) + 1;
        }
        if (cls === "A1" && !META_CONTEXTS.has(c.ctx)) {
          const base = { group, id: c.id, cause: cause.id, loader: bunKeyOf(c.primary), decorators: false, input: c.src, tscCheckerCodes: checkerCodes };
          if (twin !== null) candidates.push({ ...base, output: twin, twin: c.twin });
          else if (c.twin === null && cause.twin) {
            const twinSrc = cause.twin(c.src);
            if (twinSrc && twinSrc !== c.src) pendingTwins.push({ ...base, twin: twinSrc });
          }
        }
      }
      const line = { id: c.id, kind: c.kind, ctx: c.ctx, primary: c.primary, src: c.src, cls, clsDeco, clsTsx, clsDts };
      if (cause) line.cause = cause.id;
      if (tsc.shape) line.shape = tsc.shape;
      if (inconsistent.length > 0) line.inconsistent = inconsistent;
      if (interesting) {
        line.bun = bun.crash ? bun : slimBun(bun);
        line.tsc = tsc;
        if (twin !== null) line.twinSrc = c.twin;
        if (twin !== null) line.twinOut = twin;
      }
      if (meta) line.meta = meta;
      const metaDiffers = meta !== null && meta.bun !== null && meta.tsc !== null && !(meta.bun === meta.tsc && meta.bun === meta.tscLoose);
      if (metaDiffers && meta.tsc === meta.tscLoose && c.ctx !== "") metaCandidates.push({ group, id: c.id, ctx: c.ctx, input: c.src, type: c.type, tsc: meta.tsc, bun: meta.bun });
      if (full || interesting || metaDiffers) lines.push(JSON.stringify(line));
      if (full || interesting) classRows.push(
        [
          group,
          c.id,
          c.primary,
          cls,
          clsDeco,
          clsTsx,
          clsDts,
          oneLine(c.src),
          firstBunError(bun, bunKeyOf(c.primary)),
          tscDiagText(tsc.parse[c.primary]),
          tscDiagText(tsc.prog[c.primary] ?? []),
          tscDiagText(tsc.progDeco[c.primary] ?? []),
          (tsc.other[c.primary] ?? []).join(","),
          inconsistent.join(" ; "),
          tsc.shape ?? "",
          cause ? cause.id : "",
          cls === "A1" ? (tsc.other[c.primary] ?? []).filter(code => !NOISE_CODES.has(code)).join(",") : "",
        ].join("\t"),
      );
    }
    const mixed = [];
    for (const [recordId, list] of byRecord) {
      const classes = new Set(list.map(x => x.split("=")[1].replace("both-accept-checker-grammar", "both-accept")));
      if (classes.size > 1) mixed.push(`${recordId}: ${list.join(" ")}`);
    }
    fs.writeFileSync(path.join(outDir, `${group}.jsonl`), lines.join("\n") + "\n");
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const at = summary.length;
    summary.push(`${group}: ${records.length} records, ${cases.length} inputs, ${seconds}s`);
    summary.push(`  records (whole files, and types as "type X = T;"): ${fmtCounts(formCounts)}`);
    summary.push(`  inputs, primary mode: ${fmtCounts(counts)}`);
    summary.push(`  inputs, experimentalDecorators + emitDecoratorMetadata on both sides: ${fmtCounts(countsByMode.deco)}`);
    summary.push(`  inputs, as .tsx (loader tsx): ${fmtCounts(countsByMode.tsx)}`);
    summary.push(`  inputs, as .d.ts (loader ts): ${fmtCounts(countsByMode.dts)}`);
    console.log(summary.slice(at).join("\n"));
    summary.push(`  records whose class depends on the context: ${mixed.length}`);
    for (const m of mixed) summary.push(`    ${m}`);
  }

  summary.push("");
  summary.push(`decorator metadata, verdict of every compared input: ${fmtCounts(metaCounts)}`);

  // The output that a metadata row must print: the probed bun prints it for a type that has the tag of tsc.
  const twinTypes = metaCandidates.map(m => twinTypeForTag(tagOf(m.tsc, m.ctx)));
  const twinSources = metaCandidates.map((m, i) => (twinTypes[i] === null ? "" : TYPE_CONTEXTS[m.ctx](twinTypes[i])));
  const twinRuns = runBunSide(twinSources, bunPath, fresh, tmpDir);
  for (let i = 0; i < metaCandidates.length; i++) {
    const m = metaCandidates[i];
    const run = twinRuns[i];
    if (twinTypes[i] === null || run.crash || !run["ts+deco"].t.ok) continue;
    const out = run["ts+deco"].t.out;
    if (metadataText(extractMetadata(out)) !== m.tsc) continue;
    candidates.push({ group: m.group, id: m.id, cause: "decorator metadata", loader: "ts", decorators: true, input: m.input, output: out, twin: twinSources[i], bunNow: m.bun, tsc: m.tsc });
  }

  const pendingRuns = runBunSide(pendingTwins.map(x => x.twin), bunPath, fresh, tmpDir);
  for (let i = 0; i < pendingTwins.length; i++) {
    const run = pendingRuns[i];
    if (run.crash || !run[pendingTwins[i].loader].t.ok) continue;
    candidates.push({ ...pendingTwins[i], output: run[pendingTwins[i].loader].t.out });
  }
  summary.push(
    `A1 inputs for which the checker of tsc reports a code outside the grammar ranges that is not about names or types: ` +
      `${a1Checker.records} records, ${a1Checker.inputs} inputs, codes ${fmtCounts(Object.fromEntries(Object.entries(a1Checker.codes).map(([k, v]) => [`TS${k}`, v])))}`,
  );

  const causeRows = [...causes.values()]
    .sort((a, b) => b.inputs.A1 + b.inputs.A2 + b.inputs.B - (a.inputs.A1 + a.inputs.A2 + a.inputs.B))
    .map(e =>
      [
        e.id,
        `A1=${e.records.A1} A2=${e.records.A2} B=${e.records.B}`,
        `A1=${e.inputs.A1} A2=${e.inputs.A2} B=${e.inputs.B}`,
        [...e.tscCodes].sort().join(" "),
        e.examples.join("  ##  "),
        e.bun,
        e.ref,
        e.what,
      ].join("\t"),
    );
  const suffix = only ? `.${only.replace(/[^\w.-]/g, "_")}` : "";
  fs.writeFileSync(
    path.join(outDir, `causes${suffix}.tsv`),
    "cause\trecords\tinputs\ttsc_codes\texamples\tbun_site\treference_production\twhat\n" + causeRows.join("\n") + "\n",
  );
  const byGroup = {};
  for (const c of candidates) if (tscAgrees(c.input, c.twin, c.decorators)) (byGroup[c.group] ??= []).push(c);
  fs.writeFileSync(path.join(outDir, `test-candidates${suffix}.json`), JSON.stringify(byGroup, null, 1) + "\n");
  summary.push(`test candidates (every row fails on the probed bun): ${Object.entries(byGroup).map(([g, l]) => `${g}=${l.length}`).join(" ")}`);
  fs.writeFileSync(
    path.join(outDir, `classes${suffix}.tsv`),
    "group\tid\tprimary\tclass\tclass_deco\tclass_tsx\tclass_dts\tsource\tbun_first_error\ttsc_parse\ttsc_checker_grammar\ttsc_checker_grammar_deco\ttsc_other_codes\tbun_inconsistent\ttsc_shape\tcause\ta1_checker_codes\n" +
      classRows.join("\n") +
      "\n",
  );
  fs.writeFileSync(
    path.join(outDir, `metadata${suffix}.tsv`),
    "group\tid\tverdict\ttype_or_source\tbun\ttsc\ttsc_strictNullChecks_false\n" + metaRows.join("\n") + "\n",
  );
  fs.writeFileSync(path.join(outDir, `summary${suffix}.txt`), summary.join("\n") + "\n");
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Codes of the checker that say nothing about syntax (names that are not declared, types that do not fit).
const NOISE_CODES = new Set([
  2304, 2307, 2552, 2503, 2694, 2339, 2322, 2345, 2564, 2693, 2749, 2300, 2451, 2315, 2314, 2344, 2558, 2347, 2349, 2351,
  2365, 2362, 2363, 2367, 2532, 2531, 2533, 2683, 2578, 2571, 2769, 2556, 2554, 2555, 2350, 2348, 2454, 2448, 2355, 2391,
  2389, 2393, 2384, 2394, 2403, 2717, 2687, 2488, 2461, 2504, 2495, 2538, 2536, 2537, 2540, 2542, 2588, 2695, 2318, 2583,
  2584, 2585, 2591, 2580, 2581, 2582, 2686, 2378, 2366, 2377, 2376, 2335, 2336, 2337, 2511, 2515, 2654, 2420, 2415, 2416,
  2417, 2422, 2425, 2426, 2430, 2434, 2449, 2450, 2456, 2502, 2506, 2507, 2508, 2509, 2510, 2512, 2513, 2514, 2516, 2517,
  2526, 2527, 2528, 2539, 2541, 2545, 2551, 2559, 2560, 2561, 2562, 2563, 2565, 2566, 2574, 2589, 2590, 2610, 2611, 2612,
  2613, 2614, 2615, 2616, 2617, 2635, 2636, 2637, 2638, 2649, 2651, 2656, 2661, 2663, 2664, 2665, 2669, 2670, 2671, 2672,
  2673, 2674, 2675, 2676, 2677, 2678, 2679, 2688, 2689, 2690, 2691, 2692, 2697, 2698, 2699, 2700, 2705, 2707, 2708, 2709,
  2712, 2713, 2714, 2715, 2716, 2718, 2720, 2722, 2724, 2729, 2731, 2732, 2739, 2740, 2741, 2742, 2743, 2744, 2745, 2790,
  2833, 2836, 6133, 6196, 7005, 7006, 7008, 7010, 7011, 7013, 7015, 7016, 7017, 7019, 7020, 7022, 7023, 7024, 7027, 7031,
  7033, 7034, 7041, 7044, 7053,
]);

// A candidate is kept only when tsc prints the same JavaScript for the input and for its twin.
export function tscAgrees(input, twin, decorators) {
  if (!ts) loadTypeScript();
  const compilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext };
  if (decorators) Object.assign(compilerOptions, { experimentalDecorators: true, emitDecoratorMetadata: true, strictNullChecks: false });
  try {
    const a = ts.transpileModule(input, { compilerOptions, fileName: "input.ts", reportDiagnostics: true });
    const b = ts.transpileModule(twin, { compilerOptions, fileName: "input.ts", reportDiagnostics: true });
    const plain = text => text.replace(/^var _[a-z](, _[a-z])*;\n/m, "").replace(/\b_[a-z]\b/g, "_");
    return (a.diagnostics ?? []).length === 0 && plain(a.outputText) === plain(b.outputText);
  } catch {
    return false;
  }
}

function tagOf(metaText, ctx) {
  const m =
    ctx === "prop" ? /\{type=(.*)\}$/.exec(metaText) : ctx === "mparam" ? /paramtypes=\[(.*)\]; returntype=/.exec(metaText) : /returntype=(.*)\}$/.exec(metaText);
  return m ? m[1] : null;
}

function twinTypeForTag(tag) {
  if (tag === null) return null;
  const fixed = { Object: "any", String: "string", Number: "number", Boolean: "boolean", undefined: "void", Function: "() => void", Array: "any[]", BigInt: "bigint", Symbol: "symbol" };
  if (tag in fixed) return fixed[tag];
  const ref = /^ref\(([\w.$]+)\)$/.exec(tag);
  return ref ? ref[1] : null;
}

function fmtCounts(counts) {
  return Object.keys(counts)
    .sort()
    .map(k => `${k}=${counts[k]}`)
    .join(" ");
}

// Keeps the outputs of loader ts, and of loader tsx only where they differ.
function slimBun(bun) {
  const out = {};
  for (const config of BUN_CONFIGS) {
    const entry = bun[config.key];
    const copy = { t: entry.t, s: entry.s, i: entry.i };
    if (config.loader === "tsx" && entry.t.ok) {
      const twin = bun[config.deco ? "ts+deco" : "ts"];
      if (twin.t.ok && twin.t.out === entry.t.out) copy.t = { ok: true, sameAsTs: true };
    }
    if (entry.s.ok === entry.t.ok && !entry.s.ok) copy.s = { ok: false, sameAsTransform: sameErrors(entry.s.errs, entry.t.errs) };
    if (entry.i.ok === entry.t.ok && !entry.i.ok) copy.i = { ok: false, sameAsTransform: sameErrors(entry.i.errs, entry.t.errs) };
    out[config.key] = copy;
  }
  return out;
}

function sameErrors(a, b) {
  return JSON.stringify(a.map(e => [e.m, e.o])) === JSON.stringify(b.map(e => [e.m, e.o]));
}

if (import.meta.main) {
  if (hasFlag("--worker")) workerMain();
  else main();
}
