const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = [
  ["ts", "class A implements ) {}"],
  ["ts", "class A extends ) {}"],
  ["ts", "interface A extends ) {}"],
  ["ts", "a ? (b): ;"],
  ["ts", "x = a ? (b): c => ;"],
  ["ts", "function ("],
  ["ts", "let x: (a: ) => void"],
  ["ts", "f<A | >(x)"],
  ["ts", "let v = <A | >x;"],
  ["ts", "let f = async <T,>(a: ) => a;"],
  ["ts", "type T = { a: }"],
  ["ts", "type T = A | () => void;"],
  ["ts", "let x = ;"],
  ["js", "let x = ;"],
  ["js", ")"],
  ["js", "default"],
  ["js", "x = \"abc"],
  ["js", "f(1;"],
  ["tsx", "let a = <div>{;}</div>"],
  ["ts", "\"abc"],
  ["ts", "/* abc"],
  ["ts", "`abc"],
  ["ts", "#!/usr/bin/env bun\n\"abc"],
  ["ts", "enum E { A B }"],
  ["ts", "import * ass x from 'y'"],
  ["ts", "await"],
  ["ts", "function f() { await x }"],
];
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
for (const [l, code] of inputs) {
  const sf = ts.createSourceFile("x." + l, code, ts.ScriptTarget.Latest, false, kinds[l]);
  const ds = sf.parseDiagnostics.slice(0, 3).map(d => `TS${d.code} [${d.start},${d.start + d.length}) ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  console.log(JSON.stringify(code), "[" + l + "]", ds.length ? ds.join(" | ") : "parses");
}
console.log(ts.version);
