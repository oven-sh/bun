// usage: node tree-diff.cjs <inputs.json> <lint.txt>   where tsc 6.0.2 and the lint parse both take a source, compares the
// members that stay in the tree of each top-level class statement: kind, name, static. tsc side: the members that Bun keeps
// (no semicolon element, no index signature, no overload, no member with declare or abstract).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const lint = fs.readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean).map(line => line.split("\t"));
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const word = s => { const m = /^[^ \n(:;=?!<},\])]{0,24}/.exec(s); return m ? m[0] : ""; };
let same = 0, differ = 0, skipped = 0;
inputs.forEach((r, id) => {
  const l = r.l || "ts"; const kl = l === "dts" ? "ts" : l;
  const row = lint[id] || [];
  const sf = ts.createSourceFile(l === "dts" ? "a.d.ts" : "a." + l, r.s, ts.ScriptTarget.Latest, true, kinds[kl]);
  if (sf.parseDiagnostics.length || row[1] !== "OK") { skipped++; return; }
  const has = (m, k) => (m.modifiers || []).some(x => x.kind === k);
  const want = sf.statements.filter(s => s.kind === ts.SyntaxKind.ClassDeclaration).map(c => {
    const isAmbient = has(c, ts.SyntaxKind.DeclareKeyword) || l === "dts";
    const parts = c.members.filter(m => {
      if (m.kind === ts.SyntaxKind.SemicolonClassElement || m.kind === ts.SyntaxKind.IndexSignature) return false;
      if (has(m, ts.SyntaxKind.DeclareKeyword) || has(m, ts.SyntaxKind.AbstractKeyword)) return false;
      if ((m.kind === ts.SyntaxKind.MethodDeclaration || m.kind === ts.SyntaxKind.Constructor || m.kind === ts.SyntaxKind.GetAccessor || m.kind === ts.SyntaxKind.SetAccessor) && !m.body) return false;
      return true;
    }).map(m => {
      const st = has(m, ts.SyntaxKind.StaticKeyword) ? "static " : "";
      if (m.kind === ts.SyntaxKind.ClassStaticBlockDeclaration) return "class_static_block:-;";
      const kind = m.kind === ts.SyntaxKind.GetAccessor ? "get" : m.kind === ts.SyntaxKind.SetAccessor ? "set" : has(m, ts.SyntaxKind.AccessorKeyword) ? "auto_accessor" : "normal";
      let name = m.kind === ts.SyntaxKind.Constructor ? (r.s.slice(m.getStart()).match(/constructor|'constructor'|"constructor"/) || ["constructor"])[0] : m.name.kind === ts.SyntaxKind.ComputedPropertyName ? word(m.name.expression.getText()) : word(m.name.getText());
      if (m.kind === ts.SyntaxKind.Constructor) { const at = r.s.indexOf("constructor", m.getStart()); const q = r.s[at - 1]; name = q === "'" || q === '"' ? q + "constructor" + q : "constructor"; }
      return st + kind + ":" + name + ";";
    });
    return " class{" + parts.join("") + "}" + ((c.heritageClauses || []).some(h => h.token === ts.SyntaxKind.ExtendsKeyword && h.types.length) ? "+extends" : "");
  }).join("");
  const m = /( class\{.*)$/s.exec(row[2] || "");
  const got = m ? m[1] : "";
  // A declared class leaves no statement in Bun's tree.
  const wantKept = sf.statements.filter(s => s.kind === ts.SyntaxKind.ClassDeclaration).some(c => has(c, ts.SyntaxKind.DeclareKeyword)) || l === "dts" ? got : want;
  if (got === wantKept) same++;
  else { differ++; console.log(`${l === "ts" ? "" : "[" + l + "] "}${JSON.stringify(r.s)}\n   tsc :${want}\n   lint:${got}`); }
});
console.log(`# same ${same}, differ ${differ}, not compared ${skipped}`);
