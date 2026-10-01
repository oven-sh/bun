// For every class member with a computed name in real TypeScript and JavaScript sources, evaluate the
// test the parser now makes after "[" and report a computed name that the test would take for an index signature.
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
const roots = process.argv.slice(2);
let files = 0, computed = 0, index = 0, bad = 0, indexMissed = 0;
const SK = ts.SyntaxKind;
function predicate(text, pos) {
  // pos: offset just after "["
  const sc = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, text, undefined, pos);
  let t = sc.scan();
  if (t === SK.DotDotDotToken || t === SK.CloseBracketToken) return true;
  const isIdent = t === SK.Identifier || (t > SK.LastReservedWord && t <= SK.LastKeyword);
  if (!isIdent) return false;
  t = sc.scan();
  if (t === SK.ColonToken || t === SK.CommaToken) return true;
  if (t !== SK.QuestionToken) return false;
  t = sc.scan();
  return t === SK.ColonToken || t === SK.CommaToken || t === SK.CloseBracketToken;
}
for (const root of roots) {
  for (const pattern of ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]) {
    for (const rel of new Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
      if (rel.includes("node_modules/") && !rel.includes("node_modules/typescript/lib")) continue;
      const path = root + "/" + rel;
      let text;
      try { text = readFileSync(path, "utf8"); } catch { continue; }
      if (text.length > 3_000_000) continue;
      files++;
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, false, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = node => {
        if (ts.isClassLike(node)) {
          for (const m of node.members) {
            if (ts.isIndexSignatureDeclaration(m)) {
              index++;
              const open = text.indexOf("[", m.getStart(sf));
              if (!predicate(text, open + 1)) { indexMissed++; if (indexMissed <= 10) console.log("index signature not matched:", path, JSON.stringify(text.slice(m.getStart(sf), m.end).slice(0, 80))); }
            } else if (m.name && ts.isComputedPropertyName(m.name)) {
              computed++;
              const open = m.name.getStart(sf);
              if (predicate(text, open + 1)) { bad++; console.log("COMPUTED NAME MATCHED:", path, JSON.stringify(text.slice(open, m.name.end).slice(0, 80))); }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
}
console.log(JSON.stringify({ files, computed, index, bad, indexMissed }));
