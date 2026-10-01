// Lists the parse-error expectations of the existing tests and says, for each, what tsc 6.0.2 does
// with the same input. An expectation of an error on an input that tsc parses is an expectation
// that has to change when the grammar starts to accept the input.
//
// usage: bun existing-errors.mjs [repository root, default /workspace/wt/parser]
//
// Read from test/bundler/transpiler/transpiler.test.js: every call of a function named err,
// expectParseError or ts.expectParseError whose two arguments are string literals, inside the
// describe blocks that use the TypeScript loader (the alias `const err = ts.expectParseError`).
// Read from test/bundler/esbuild/ts.test.ts: every itBundled case that has bundleErrors.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isGrammarCode } from "./run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const ts = (await import(TS_PATH)).default;
const ROOT = process.argv[2] ?? "/workspace/wt/parser";

const literal = node => {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
};

function tscVerdict(src, fileName) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, false, kind);
  if (sf.parseDiagnostics.length) {
    const d = sf.parseDiagnostics[0];
    return { parse: `TS${d.code} @${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}` };
  }
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve, noEmit: true };
  const host = {
    getSourceFile: (name, o) => (name === fileName ? ts.createSourceFile(name, src, o, true, kind) : undefined),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile() {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: f => f === fileName,
    readFile: f => (f === fileName ? src : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const g = program.getSemanticDiagnostics(program.getSourceFile(fileName)).filter(d => isGrammarCode(d.code));
  if (g.length) return { grammar: g.map(d => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`).join(" | ") };
  return { clean: true };
}

function bunVerdict(src, loader) {
  try {
    new Bun.Transpiler({ loader }).transformSync(src);
    return "accepts";
  } catch (e) {
    const first = e && Array.isArray(e.errors) && e.errors.length ? e.errors[0] : e;
    return "rejects: " + String(first?.message ?? first);
  }
}

const rows = [];
const counts = { total: 0, tscParses: 0, tscGrammar: 0, tscRejects: 0 };

{
  const file = "test/bundler/transpiler/transpiler.test.js";
  const text = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  // The alias `err` is the TypeScript one when the enclosing function declares `const err = ts.expectParseError`.
  const isTsAlias = call => {
    for (let n = call.parent; n; n = n.parent) {
      if (ts.isBlock(n)) {
        for (const st of n.statements) {
          if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
              if (d.name.getText() === "err" && d.initializer) return d.initializer.getText() === "ts.expectParseError";
            }
          }
        }
      }
    }
    return false;
  };
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const src = literal(node.arguments[0]);
      const message = literal(node.arguments[1]);
      const typescript = callee === "ts.expectParseError" || (callee === "err" && isTsAlias(node));
      if (typescript && src !== undefined && message !== undefined) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        rows.push({ file, line, src, message, loader: "ts" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

{
  const file = "test/bundler/esbuild/ts.test.ts";
  const text = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText() === "itBundled" && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const props = Object.fromEntries(node.arguments[1].properties.filter(p => p.name).map(p => [p.name.getText().replace(/["']/g, ""), p]));
      if (props.bundleErrors && props.files) {
        const files = {};
        for (const f of props.files.initializer.properties ?? []) {
          const name = literal(f.name) ?? f.name?.getText();
          const value = literal(f.initializer);
          if (name && value !== undefined) files[name] = value;
        }
        for (const e of props.bundleErrors.initializer.properties ?? []) {
          const name = literal(e.name) ?? e.name?.getText();
          const messages = e.initializer.elements?.map(x => literal(x) ?? x.getText()) ?? [];
          const line = sf.getLineAndCharacterOfPosition(e.getStart()).line + 1;
          if (files[name] !== undefined) rows.push({ file, line, src: files[name], message: messages.join(" | "), loader: name.endsWith(".tsx") ? "tsx" : "ts", name });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const out = [];
for (const r of rows) {
  counts.total++;
  const fileName = r.loader === "tsx" ? "/input.tsx" : "/input.ts";
  const t = tscVerdict(r.src, fileName);
  const b = bunVerdict(r.src, r.loader);
  let cls;
  if (t.clean) (counts.tscParses++, (cls = "A1  tsc parses, no grammar code"));
  else if (t.grammar) (counts.tscGrammar++, (cls = "A2  tsc parses, checker: " + t.grammar));
  else (counts.tscRejects++, (cls = "RR  tsc: " + t.parse));
  out.push(`${cls.slice(0, 2)}\t${r.file}:${r.line}\t${JSON.stringify(r.src)}\texpected: ${JSON.stringify(r.message)}\tbun now: ${b}\t${cls.slice(4)}`);
}
out.sort();
const head = `error expectations ${counts.total}: tsc parses clean ${counts.tscParses}, tsc parses and the checker reports a grammar code ${counts.tscGrammar}, tsc rejects ${counts.tscRejects}`;
writeFileSync(join(HERE, "out", "existing-errors.tsv"), head + "\n" + out.join("\n") + "\n");
console.log(head);
for (const l of out) if (!l.startsWith("RR")) console.log(l);
