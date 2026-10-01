const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = [
  ["ts", "import * ass x from 'y'"],
  ["ts", "export * as x frm 'y'"],
  ["ts", "import x frm 'y'"],
  ["ts", "import x"],
  ["ts", "function f(...a, ) {}"],
  ["ts", "let x: (a: ) => void"],
  ["ts", "let x: (A & | B);"],
  ["ts", "x = \"abc"],
  ["tsx", "let a = <b c=\"d\n"],
];
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
for (const [l, code] of inputs) {
  const sf = ts.createSourceFile("x." + l, code, ts.ScriptTarget.Latest, false, kinds[l]);
  console.log(JSON.stringify(code), "[" + l + "]");
  for (const d of sf.parseDiagnostics.slice(0, 3)) console.log(`   tsc @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  if (!sf.parseDiagnostics.length) console.log("   tsc parses");
}
