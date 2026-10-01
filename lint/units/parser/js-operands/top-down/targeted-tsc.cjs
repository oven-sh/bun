// Parses every targeted input with tsc as a.js, a.jsx, a.mjs, a.cjs, a.ts, a.tsx: parse diagnostics, the
// diagnostics for TypeScript-only syntax in a JavaScript file (program.getSyntacticDiagnostics with allowJs and
// checkJs), and the shape of the tree (kinds in preorder) so that two parses can be compared.
// usage: node targeted-tsc.cjs [inputs.json] > targeted-tsc.jsonl
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const inputs = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "targeted-inputs.json"), "utf8"));
const K = ts.SyntaxKind;
function shape(node, sf) {
  let s = K[node.kind];
  if (node.kind === K.Identifier || node.kind === K.PrivateIdentifier) s += ":" + node.text;
  const kids = [];
  node.forEachChild(c => { kids.push(shape(c, sf)); });
  return kids.length ? s + "(" + kids.join(",") + ")" : s;
}
function one(name, src) {
  const options = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, noLib: true, types: [], experimentalDecorators: false };
  const host = ts.createCompilerHost(options, true);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onError, shouldCreate) => path.basename(f) === name ? ts.createSourceFile(f, src, lang, true) : undefined;
  host.fileExists = f => path.basename(f) === name;
  host.readFile = f => path.basename(f) === name ? src : undefined;
  const program = ts.createProgram([name], options, host);
  const sf = program.getSourceFile(name);
  const syn = program.getSyntacticDiagnostics(sf);
  const fmt = d => ({ code: d.code, start: d.start, length: d.length, text: ts.flattenDiagnosticMessageText(d.messageText, " ") });
  const parse = sf.parseDiagnostics.map(fmt);
  const parseKeys = new Set(parse.map(d => d.code + ":" + d.start));
  return {
    parse,
    js: syn.filter(d => !parseKeys.has(d.code + ":" + d.start)).map(fmt),
    shape: shape(sf, sf).replace(/^SourceFile\(/, "").replace(/,?EndOfFileToken\)$/, ""),
    variant: sf.languageVariant === ts.LanguageVariant.JSX ? "JSX" : "Standard",
  };
}
console.error("typescript", ts.version);
for (const [group, list] of Object.entries(inputs)) {
  for (const src of list) {
    const rec = { group, src };
    for (const name of ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx"]) rec[name] = one(name, src);
    console.log(JSON.stringify(rec));
  }
}
