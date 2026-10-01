// usage: node --experimental-vm-modules tsc-run.mjs <path to typescript.js> > tsc.json
import vm from "node:vm";
import { inputs } from "./inputs.mjs";
const ts = (await import(process.argv[2])).default;
const K = ts.SyntaxKind;
function sexp(node, sf) {
  const kids = [];
  ts.forEachChild(node, c => void kids.push(sexp(c, sf)));
  let name = K[node.kind];
  if (node.kind === K.Identifier || node.kind === K.PrivateIdentifier) return node.text;
  if (node.kind === K.NumericLiteral || node.kind === K.StringLiteral) return JSON.stringify(node.text);
  name = name.replace(/Expression$|Declaration$|Statement$/, "").replace(/^First|^Last/, "");
  if (node.kind === K.BinaryExpression) return `(${kids[0]} ${ts.tokenToString(node.operatorToken.kind)} ${kids[2]})`;
  if (node.kind === K.ExpressionStatement) return kids[0] + ";";
  return kids.length ? `${name}(${kids.join(" ")})` : name;
}
const names = ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx"];
const out = {};
for (const [id, code] of inputs) {
  const row = {};
  for (const name of names) {
    const fileName = "/" + name;
    const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ESNext, true);
    const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, checkJs: false, noLib: true, noResolve: true, types: [], noEmit: true, strict: false, jsx: ts.JsxEmit.Preserve };
    const host = { getSourceFile: f => (f === fileName ? sf : undefined), getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: () => undefined };
    const program = ts.createProgram([fileName], options, host);
    const syn = program.getSyntacticDiagnostics(sf);
    const fmt = d => `TS${d.code}@${d.start}+${d.length}`;
    const parse = sf.parseDiagnostics.map(fmt);
    const js = syn.filter(d => !sf.parseDiagnostics.includes(d)).map(d => `${fmt(d)} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    row[name] = { jsx: sf.languageVariant === ts.LanguageVariant.JSX, jsFile: (sf.flags & ts.NodeFlags.JavaScriptFile) !== 0, parse, parseText: sf.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")), js, tree: sf.statements.map(s => sexp(s, sf)).join(" ") };
  }
  let script, module;
  try { new vm.Script(code); script = "ok"; } catch (e) { script = String(e.message); }
  try { new vm.SourceTextModule(code); module = "ok"; } catch (e) { module = String(e.message); }
  row.v8 = { script, module };
  out[id] = row;
}
console.log(JSON.stringify({ typescript: ts.version, node: process.version, rows: out }, null, 1));
