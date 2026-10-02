const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = [
  ["ts", ")"], ["js", "{ ) }"], ["ts", "function f() { default }"], ["ts", "default"], ["ts", "catch (e) {}"], ["ts", "x = 1\n)"],
  ["ts", "foo();\n}"], ["ts", "function f() {}\n}"], ["ts", "a: { ) }"], ["ts", "switch (x) { case 1: ) }"], ["ts", "class A { static { ) } }"],
  ["ts", "namespace N { ) }"], ["ts", "() => { ) }"], ["tsx", "const f = () => { ) }"], ["ts", "if (x) )"], ["ts", "let x = ;"], ["ts", "x = 1 +"],
  ["ts", "for ()"], ["ts", "for (;)"], ["ts", "for (;;) )"], ["ts", "while (x) )"], ["ts", "a ? (b): ;"], ["ts", "return )"], ["ts", "`${ )`"],
  ["tsx", "let a = <div>{ )}</div>"], ["ts", "x = [ ) ]"], ["ts", "do )"], ["ts", "if (a) b; else )"], ["ts", "label: )"],
  ["ts", "class A implements ) {}"], ["ts", "export default )"], ["ts", "throw )"], ["ts", "x = () => )"], ["ts", "with (a) )"],
  ["ts", "{"], ["ts", "in x"], ["ts", "finally {}"], ["ts", "function f() { catch }"], ["ts", "{ default }"],
];
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
for (const [l, code] of inputs) {
  const sf = ts.createSourceFile("x." + l, code, ts.ScriptTarget.Latest, false, kinds[l]);
  const d = sf.parseDiagnostics[0];
  console.log(JSON.stringify(code), "[" + l + "]", d ? `TS${d.code} [${d.start},${d.start + d.length}) ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}` : "parses");
}
console.log(ts.version);
