const ts = require("/workspace/wt/parser/node_modules/typescript");
const cases = [
  ["a.js", "x\n--> legacy\n// after\n"],
  ["b.js", "--> first line\nx;\n"],
  ["c.ts", "/* a\n*/ --> after block with newline\nx;\n"],
  ["d.ts", "x;\n  --> indented\ny;\n"],
  ["e.ts", "let a = 1\n--> c\n;"],
  ["f.ts", "x --> y;"],
  ["g.js", "<!-- open\nx;"],
];
for (const [file, text] of cases) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
  console.log(JSON.stringify(text), "=>", sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`).join(" | ") || "no diagnostics");
}
console.log(ts.version);
