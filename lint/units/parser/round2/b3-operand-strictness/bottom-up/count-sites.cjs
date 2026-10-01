// Counts, per cgbench group and per pass, how often the parser would run each site where a test of the side table could stand (option B).
// usage: node count-sites.cjs        (inputs: /workspace/notes/lint/benchroot, the snapshot cgbench.sh parses)
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("node:fs");
const path = require("node:path");
const root = "/workspace/notes/lint/benchroot";
function walkDir(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out); else out.push(p);
  }
  return out;
}
const groups = [
  { name: "bun-types", kind: ts.ScriptKind.TS, files: () => walkDir(root + "/packages/bun-types", []).filter(p => p.endsWith(".d.ts") && !p.includes("/node_modules/") && !p.includes("/ts7.1/")) },
  { name: "typescript-lib", kind: ts.ScriptKind.TS, files: () => fs.readdirSync(root + "/node_modules/typescript/lib").filter(n => /^lib.*\.d\.ts$/.test(n)).map(n => root + "/node_modules/typescript/lib/" + n) },
  { name: "src-js", kind: ts.ScriptKind.TS, files: () => walkDir(root + "/src/js", []).filter(p => p.endsWith(".ts") && !p.includes("/node_modules/")) },
  { name: "tsx", kind: ts.ScriptKind.TSX, files: () => [root + "/bench/snippets/transpiler-typescript-fixture.tsx"] },
  { name: "js-control", kind: ts.ScriptKind.JS, files: () => [root + "/bench/react-hello-world/react-hello-world.node.js"] },
];
const K = ts.SyntaxKind;
const isAssign = k => k >= K.FirstAssignment && k <= K.LastAssignment;
const rows = {};
for (const g of groups) {
  const c = { "assignment (16 arms, parse_suffix.rs:615-1422)": 0, "postfix ++ -- (535, 554)": 0, "prefix ++ -- (parse_prefix.rs:557, 571)": 0, "member . ?. (82, 142)": 0, "index [ (355)": 0, "call ( (401)": 0, "tagged template (294, 325)": 0, "yield with * (mod.rs:137)": 0, "yield without operand (mod.rs:147-152)": 0, "non-null ! (510, existing test)": 0, "type assertion <T>x (parse_prefix.rs:1031, existing test)": 0, "name on a later line than its dot": 0, "parse diagnostics": 0 };
  for (const f of g.files()) {
    const text = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, false, g.kind);
    c["parse diagnostics"] += sf.parseDiagnostics.length;
    const visit = n => {
      switch (n.kind) {
        case K.PostfixUnaryExpression: c["postfix ++ -- (535, 554)"]++; break;
        case K.PrefixUnaryExpression: if (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken) c["prefix ++ -- (parse_prefix.rs:557, 571)"]++; break;
        case K.BinaryExpression: if (isAssign(n.operatorToken.kind)) c["assignment (16 arms, parse_suffix.rs:615-1422)"]++; break;
        case K.PropertyAccessExpression: {
          c["member . ?. (82, 142)"]++;
          if (/[\r\n\u2028\u2029]/.test(text.slice(n.name.pos, n.name.getStart(sf)))) c["name on a later line than its dot"]++;
          break;
        }
        case K.ElementAccessExpression: c["index [ (355)"]++; break;
        case K.CallExpression: c["call ( (401)"]++; break;
        case K.TaggedTemplateExpression: c["tagged template (294, 325)"]++; break;
        case K.YieldExpression: if (n.asteriskToken) c["yield with * (mod.rs:137)"]++; if (!n.expression) c["yield without operand (mod.rs:147-152)"]++; break;
        case K.NonNullExpression: c["non-null ! (510, existing test)"]++; break;
        case K.TypeAssertionExpression: c["type assertion <T>x (parse_prefix.rs:1031, existing test)"]++; break;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  for (const [k, v] of Object.entries(c)) (rows[k] ??= {})[g.name] = v;
}
const names = groups.map(g => g.name);
console.log("per ONE pass (cgbench runs 20 passes; tsx repeats its file 100 times per pass)".padEnd(62) + names.map(n => n.padStart(15)).join(""));
for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(62) + names.map(n => String(v[n]).padStart(15)).join(""));
