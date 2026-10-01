const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = [
  ["ts", "\"abc"],
  ["ts", "'abc\n x"],
  ["ts", "`abc "],
  ["ts", "/* abc"],
  ["js", "// c\n/* abc"],
  ["ts", "let x: (A & | B);"],
  ["ts", "#!/usr/bin/env bun\n\"abc"],
  ["ts", "x = a ? b"], ["ts", "f(1;"], ["ts", "function ("], ["ts", "function class() {}"],
  ["ts", "x = \"abc"], ["ts", "x = `abc"], ["ts", "let x = ;"], ["js", "let x = ;"], ["ts", "x = 1 +"],
  ["ts", "if (x) )"], ["ts", "in x"], ["ts", ")"], ["js", "{ ) }"], ["ts", "function f() { default }"],
  ["ts", "default"], ["ts", "catch (e) {}"], ["ts", "let x: ;"], ["ts", "function f(a: ) {}"], ["ts", "let x: A<;"],
];
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
for (const [l, code] of inputs) {
  const sf = ts.createSourceFile("x." + l, code, ts.ScriptTarget.Latest, false, kinds[l]);
  const d = sf.parseDiagnostics[0];
  console.log(JSON.stringify(code), "[" + l + "]", d ? `TS${d.code} [${d.start},${d.start + d.length}) ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}` : "parses");
}
console.log(ts.version);
