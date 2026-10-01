// Prints, for each type text, the outline that the tests of the Build sink compare with.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("/workspace/bun/node_modules/typescript/lib/typescript.js");

const names = new Map();
for (const [name, value] of Object.entries(ts.SyntaxKind)) {
  if (typeof value === "number" && !names.has(value)) names.set(value, name);
}

function outline(sf, root, offset) {
  const out = [];
  const range = list => `${list.pos - offset},${list.end - offset}`;
  const visit = node => {
    if (ts.isTypeNode(node) && node.kind !== ts.SyntaxKind.TemplateLiteralTypeSpan) {
      let line = `${names.get(node.kind)}[${node.getStart(sf) - offset},${node.end - offset})`;
      if (node.typeArguments) line += `<${range(node.typeArguments)}>`;
      if ((ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) && node.typeParameters)
        line += `{${range(node.typeParameters)}}`;
      out.push(line);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out.join(" ");
}

export function typeOutline(text, prefix = "type T = ", suffix = ";") {
  const source = prefix + text + suffix;
  const sf = ts.createSourceFile("a.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) {
    return { error: sf.parseDiagnostics.map(d => `TS${d.code}@${d.start - prefix.length}`).join(",") };
  }
  let root;
  const find = node => {
    if (root) return;
    if (ts.isTypeAliasDeclaration(node)) root = node.type;
    else if (ts.isVariableDeclaration(node)) root = node.type;
    else if (ts.isFunctionDeclaration(node)) root = node.type;
    else ts.forEachChild(node, find);
  };
  find(sf);
  return { outline: outline(sf, root, prefix.length), end: root.end - prefix.length };
}

if (import.meta.main) {
  console.log(ts.version);
  for (const text of process.argv.slice(2)) console.log(JSON.stringify(text), JSON.stringify(typeOutline(text)));
}
