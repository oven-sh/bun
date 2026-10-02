// Scratch: the rows of the four typescript-grammar*.test.ts files as { file, describe, group, loader, src, expected, key? }.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const DIR = "/workspace/wt/parser/test/bundler/transpiler/";
const FILES = ["typescript-grammar.test.ts", "typescript-grammar-expressions.test.ts", "typescript-grammar-statements.test.ts", "typescript-grammar-decorator-metadata.test.ts"];
const rows = [];
for (const file of FILES) {
  const text = readFileSync(DIR + file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
  const consts = {};
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (d.initializer && (ts.isNoSubstitutionTemplateLiteral(d.initializer) || ts.isStringLiteral(d.initializer))) consts[d.name.text] = d.initializer.text;
  }
  const evalNode = n => new Function(...Object.keys(consts), "return " + n.getText(sf))(...Object.values(consts));
  const visit = (node, describe) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "describe") {
      const title = node.arguments[0].text;
      ts.forEachChild(node, c => visit(c, title));
      return;
    }
    // test.each(table)(title, fn)
    if (ts.isCallExpression(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "each") {
      const table = node.expression.arguments[0];
      const group = node.arguments[0].text;
      const fnText = node.arguments[1].getText(sf);
      for (const el of table.elements) {
        const v = evalNode(el);
        let row;
        if (file === "typescript-grammar-decorator-metadata.test.ts") {
          const ret = /ofReturnType/.test(fnText);
          row = { loader: "deco", src: ret ? `class C { @d m(): ${v[0]} { throw 0 } }` : `class C { @d p: ${v[0]}; }`, key: ret ? "returntype" : "type", expected: v[1] };
        } else if (/design\(/.test(fnText)) {
          row = { loader: "deco", src: v[0], key: v[1], expected: v[2] };
        } else if (v.length === 3) {
          row = { loader: v[0] === "decorators" ? "deco" : v[0], src: v[1], expected: v[2] };
        } else {
          row = { loader: /tsx\.transformSync/.test(fnText) ? "tsx" : "ts", src: v[0], expected: v[1] };
        }
        rows.push({ file, describe, group, ...row });
      }
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test") {
      rows.push({ file, describe, group: node.arguments[0].text, loader: "js", src: 'import A from "x"\nwith { type: "json" };\nimport B from "y"\nwith (A) {}', expected: 'import A from "x";\nimport B from "y";\nwith (A) {}\n' });
      return;
    }
    ts.forEachChild(node, c => visit(c, describe));
  };
  visit(sf, null);
}
writeFileSync("/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/rows.json", JSON.stringify(rows, null, 0));
const by = new Map();
for (const r of rows) by.set(`${r.file} | ${r.describe} | ${r.group}`, (by.get(`${r.file} | ${r.describe} | ${r.group}`) ?? 0) + 1);
for (const [k, n] of by) console.log(String(n).padStart(4), k);
console.log(rows.length, "rows");
