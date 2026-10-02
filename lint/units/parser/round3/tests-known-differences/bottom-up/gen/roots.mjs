// The type-grammar roots of a source, as tsc 6.0.2 builds them: what a test reads alone with the sink that builds nodes.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const ts = require("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const K = ts.SyntaxKind;
const names = new Map();
for (const [name, value] of Object.entries(K)) if (typeof value === "number" && !names.has(value)) names.set(value, name);
export const kindName = k => names.get(k);
export const scriptKind = loader => (loader === "tsx" ? ts.ScriptKind.TSX : loader === "js" ? ts.ScriptKind.JS : ts.ScriptKind.TS);
export const parse = (src, loader) => ts.createSourceFile(loader === "tsx" ? "/a.tsx" : loader === "js" ? "/a.js" : "/a.ts", src, ts.ScriptTarget.Latest, true, scriptKind(loader));

// The outline of type_sink_tests.rs: a line for each type node under `root`, offsets less `offset`.
export function outline(sf, root, offset) {
  const out = [];
  const range = list => `${list.pos - offset},${list.end - offset}`;
  const visit = node => {
    if (ts.isTypeNode(node) && node.kind !== K.TemplateLiteralTypeSpan) {
      let line = `${kindName(node.kind)}[${node.getStart(sf) - offset},${node.end - offset})`;
      if (node.typeArguments) line += `<${range(node.typeArguments)}>`;
      if ((ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) && node.typeParameters) line += `{${range(node.typeParameters)}}`;
      out.push(line);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out.join(" ");
}

const isFunctionLike = n => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
const insideType = n => { for (let p = n.parent; p; p = p.parent) if (ts.isTypeNode(p) && p.kind !== K.ExpressionWithTypeArguments) return true; return false; };

// Every root: { entry: "type" | "return" | "type-parameters" | "heritage", site, start, end, text, outline }.
export function roots(src, loader) {
  const sf = parse(src, loader);
  const out = [];
  const typeRoot = (node, entry, site) => out.push({ entry, site, start: node.getStart(sf), end: node.end, text: src.slice(node.getStart(sf), node.end), outline: outline(sf, node, node.getStart(sf)) });
  const visit = node => {
    if (ts.isTypeNode(node) && !insideType(node)) {
      const p = node.parent;
      if (node.kind === K.ExpressionWithTypeArguments) {
        out.push({ entry: "heritage", site: kindName(p.parent.kind) + "." + (p.token === K.ExtendsKeyword ? "extends" : "implements"), start: node.getStart(sf), end: node.end, text: src.slice(node.getStart(sf), node.end), outline: outline(sf, node, node.getStart(sf)) });
      } else if (isFunctionLike(p) && p.type === node) typeRoot(node, "return", kindName(p.kind));
      else if (ts.isTypeParameterDeclaration(p)) { /* read with its list */ }
      else typeRoot(node, "type", kindName(p.kind));
    }
    if (node.typeParameters && !ts.isTypeNode(node) && !insideType(node)) {
      const list = node.typeParameters;
      // The list runs from its "<" to its ">": `pos` is after "<".
      const lt = list.pos - 1;
      let gt = list.end;
      while (src[gt] !== ">") gt++;
      const params = list.map(p => `${p.name.text}[${p.getStart(sf) - lt},${p.end - lt})`).join(" ");
      out.push({ entry: "type-parameters", site: kindName(node.kind), start: lt, end: gt + 1, text: src.slice(lt, gt + 1), outline: `{${list.pos - lt},${list.end - lt}} ${params}`, closeEnd: gt + 1 - lt });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { diagnostics: sf.parseDiagnostics.map(d => [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, " ")]), roots: out };
}
if (import.meta.main) for (const src of process.argv.slice(2)) console.log(JSON.stringify(src), JSON.stringify(roots(src, "ts"), null, 1));
