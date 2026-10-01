// Finds, in the existing test files, the decorated members whose metadata differs between the
// installed Bun and tsc 6.0.2 (strictNullChecks off). An expectation on such a member encodes a tag
// that changes when the grammar changes.
//
// usage: bun existing-tests.mjs [repository root, default /workspace/wt/parser]
//
// Each test file is read twice: as a whole (the tests of decorator-metadata.test.ts declare their
// classes in the test file itself), and string by string (the bundler tests keep their sources in
// string and template literals). Only the files are read; nothing is run from the repository.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tagOf } from "./metadata.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const ts = (await import(TS_PATH)).default;
const ROOT = process.argv[2] ?? "/workspace/wt/parser";

const FILES = [
  "test/bundler/transpiler/decorator-metadata.test.ts",
  "test/bundler/bundler_decorator_metadata.test.ts",
  "test/bundler/transpiler/transpiler.test.js",
  "test/bundler/esbuild/ts.test.ts",
  "test/bundler/transpiler/decorators.test.ts",
  "test/js/bun/typescript/type-export.test.ts",
  "test/bundler/transpiler/transpiler-stack-overflow.test.ts",
  "test/cli/run/transpiler-cache.test.ts",
  // Not in the list of parser.md, found by a search for "design:" and emitDecoratorMetadata under test/.
  "test/regression/issue/27575.test.ts",
  "test/regression/issue/27526.test.ts",
  "test/integration/nest/nest_metadata.test.ts",
  "test/integration/typegraphql/src/typegraphql.test.ts",
  "test/integration/typegraphql/src/unsolvable.test.ts",
  "test/integration/typegraphql/src/ts_example.test.ts",
  "test/bundler/bundler_cjs2esm.test.ts",
];

const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });

function balanced(js, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < js.length; i++) {
    const c = js[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(last, i).trim());
      last = i + 1;
    }
  }
  parts.push(text.slice(last).trim());
  return parts;
}

// One entry per decorate call: the target ("C.prototype.m", "C") and the tags by key.
function decorateCalls(js) {
  const out = [];
  const re = /(?:__legacyDecorateClassTS\w*|__decorate\w*)\(/g;
  let m;
  while ((m = re.exec(js))) {
    const open = re.lastIndex - 1;
    const close = balanced(js, open);
    if (close < 0) continue;
    const args = splitTop(js.slice(open + 1, close));
    if (!args[0]?.startsWith("[")) continue;
    const target = args[1] + (args[2] ? "." + args[2].replace(/^["'`]|["'`]$/g, "") : "");
    const tags = {};
    for (const item of splitTop(args[0].slice(1, -1))) {
      const k = /^[\w$]+\(\s*"design:(type|paramtypes|returntype)"\s*,/.exec(item);
      if (!k) continue;
      const inner = item.slice(item.indexOf(",") + 1, item.lastIndexOf(")"));
      tags[k[1]] = tagOf(inner);
    }
    if (Object.keys(tags).length) out.push({ target, tags });
  }
  return out;
}

const KEYS = ["type", "paramtypes", "returntype"];
const show = t => KEYS.filter(k => t[k] !== undefined).map(k => `${k}=${t[k]}`).join("  ");

function compare(source, loader) {
  let bunJs;
  try {
    bunJs = new Bun.Transpiler({ loader, tsconfig: DECO }).transformSync(source);
  } catch (e) {
    return { error: "bun: " + String(e?.message ?? e).slice(0, 120) };
  }
  const sf = ts.createSourceFile(loader === "tsx" ? "/input.tsx" : "/input.ts", source, ts.ScriptTarget.ESNext, false);
  if (sf.parseDiagnostics.length) return { error: "tsc: TS" + sf.parseDiagnostics[0].code };
  const tscJs = ts.transpileModule(source, {
    fileName: loader === "tsx" ? "input.tsx" : "input.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
      noEmitHelpers: true,
      strict: false,
      strictNullChecks: false,
    },
  }).outputText;
  const a = decorateCalls(bunJs);
  const b = decorateCalls(tscJs);
  const count = js => (js.match(/(?:__legacyMetadataTS\w*|__metadata)\(\s*"design:(?:type|paramtypes|returntype)"/g) ?? []).length;
  const seen = list => list.reduce((n, c) => n + Object.keys(c.tags).length, 0);
  const missed = count(bunJs) - seen(a) + (count(tscJs) - seen(b));
  const used = new Set();
  const diffs = [];
  for (const x of a) {
    const j = b.findIndex((y, i) => !used.has(i) && y.target === x.target);
    if (j < 0) {
      diffs.push({ target: x.target, bun: show(x.tags), tsc: "(no call)" });
      continue;
    }
    used.add(j);
    if (show(x.tags) !== show(b[j].tags)) diffs.push({ target: x.target, bun: show(x.tags), tsc: show(b[j].tags) });
  }
  b.forEach((y, i) => {
    if (!used.has(i)) diffs.push({ target: y.target, bun: "(no call)", tsc: show(y.tags) });
  });
  return { calls: a.length, diffs, missed };
}

const lines = [];
for (const file of FILES) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    lines.push(`${file}: not found`);
    continue;
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const snippets = [];
  if (file.endsWith(".ts") && /@\w/.test(text)) snippets.push({ line: 1, source: text, whole: true });
  const visit = node => {
    let s;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) s = node.text;
    // A template with substitutions: the substitutions are dropped (they hold a polyfill or a path).
    else if (ts.isTemplateExpression(node)) s = node.head.text + node.templateSpans.map(span => span.literal.text).join("");
    if (s !== undefined && s.includes("class") && /@[\w(]/.test(s)) {
      snippets.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, source: s });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let calls = 0;
  let differing = 0;
  const rows = [];
  for (const sn of snippets) {
    const res = compare(sn.source, "ts");
    if (res.error) {
      if (sn.whole) rows.push(`  whole file: ${res.error}`);
      continue;
    }
    calls += res.calls;
    if (res.missed) rows.push(`  ${file}:${sn.whole ? "(whole file)" : sn.line}  ${res.missed} metadata values were not matched to a decorate call`);
    for (const d of res.diffs) {
      differing++;
      rows.push(`  ${file}:${sn.whole ? "(whole file)" : sn.line}  ${d.target}\n      bun: ${d.bun}\n      tsc: ${d.tsc}`);
    }
  }
  lines.push(`${file}: ${snippets.length} sources with decorators, ${calls} decorate calls with metadata, ${differing} differ`);
  lines.push(...rows);
}
writeFileSync(join(HERE, "out", "existing-tests.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
