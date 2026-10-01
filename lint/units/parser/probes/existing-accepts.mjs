// Lists the inputs that the existing tests expect Bun to accept and that the parser of tsc rejects.
// A parse without lint has to keep accepting them (the tests pin them already); a lint parse reports
// the diagnostic of tsc.
//
// usage: bun existing-accepts.mjs [repository root, default /workspace/wt/parser]
// Read from test/bundler/transpiler/transpiler.test.js: every call whose first argument is a string literal and
// whose callee is ts.expectPrinted, ts.expectPrinted_, or an alias declared in the enclosing block as
// `const exp = ts.expectPrinted_` (any name, any ts.* printer).
// Output: out/existing-accepts.tsv

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const ts = (await import(TS_PATH)).default;
const ROOT = process.argv[2] ?? "/workspace/wt/parser";
const file = "test/bundler/transpiler/transpiler.test.js";
const text = readFileSync(join(ROOT, file), "utf8");
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

const aliasOf = (call, name) => {
  for (let n = call.parent; n; n = n.parent) {
    if (!ts.isBlock(n)) continue;
    for (const st of n.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (d.name.getText() === name && d.initializer) return d.initializer.getText();
      }
    }
  }
  return null;
};

const rows = [];
const visit = node => {
  if (ts.isCallExpression(node) && node.arguments.length >= 1) {
    let callee = node.expression.getText();
    if (/^[\w$]+$/.test(callee)) callee = aliasOf(node, callee) ?? callee;
    const a = node.arguments[0];
    if (/^ts\.expectPrinted/.test(callee) && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) {
      rows.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, src: a.text });
    }
  }
  ts.forEachChild(node, visit);
};
visit(sf);

const out = ["file:line\tinput\tbun now\ttsc code\tstart\tlength\tmessage"];
let rejected = 0;
const t = new Bun.Transpiler({ loader: "ts" });
for (const r of rows) {
  const parsed = ts.createSourceFile("/input.ts", r.src, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
  if (!parsed.parseDiagnostics.length) continue;
  rejected++;
  let now = "accepts";
  try {
    t.transformSync(r.src);
  } catch (e) {
    now = "rejects";
  }
  const d = parsed.parseDiagnostics[0];
  out.push([`${file}:${r.line}`, JSON.stringify(r.src), now, d.code, d.start, d.length, JSON.stringify(ts.flattenDiagnosticMessageText(d.messageText, " "))].join("\t"));
}
writeFileSync(join(HERE, "out", "existing-accepts.tsv"), out.join("\n") + "\n");
console.log(`expectations that Bun prints an input with the TypeScript loader: ${rows.length}; the parser of tsc rejects ${rejected} of the inputs`);
