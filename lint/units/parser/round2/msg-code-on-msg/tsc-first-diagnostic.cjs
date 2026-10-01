const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = [
  ["ts", "\"abc"],
  ["ts", "'abc\n x"],
  ["ts", "`abc "],
  ["ts", "`abc ${x"],
  ["ts", "/* abc"],
  ["ts", "// c\n/* abc"],
  ["ts", "function f(...a, ) {}"],
  ["ts", "export { class };"],
  ["ts", "export { default };"],
  ["ts", "\u0001"],
  ["ts", "#!/usr/bin/env bun\n\"abc"],
  ["ts", "0b2"],
  ["ts", "1_"],
  ["ts", "let x = \"abc"],
  ["ts", "x = `abc"],
  ["ts", "function class() {}"],
  ["ts", "function (" ],
  ["ts", "x = a ? b"],
  ["ts", "default"],
  ["ts", "catch (e) {}"],
  ["ts", "x as A | () => void;"],
  ["ts", "for (const x off y) {}"],
  ["ts", "import.foo"],
  ["ts", "import * ass x from 'y'"],
  ["ts", "type as T"],
  ["ts", "'\\"],
  ["js", "let x = ;"],
  ["tsx", "<a></b>"],
  ["tsx", "<a"],
];
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
for (const [l, code] of inputs) {
  const sf = ts.createSourceFile("x." + l, code, ts.ScriptTarget.Latest, false, kinds[l]);
  console.log(JSON.stringify(code), "[" + l + "]");
  for (const d of sf.parseDiagnostics.slice(0, 4)) console.log(`   tsc @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  if (!sf.parseDiagnostics.length) console.log("   tsc parses");
}
