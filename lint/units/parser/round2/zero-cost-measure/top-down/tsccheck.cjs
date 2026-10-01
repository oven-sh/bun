const ts = require("/workspace/bun/node_modules/typescript");
const items = JSON.parse(require("fs").readFileSync("/tmp/zcm-td/vold3.diffsrc.json", "utf8"));
let ok = 0, bad = 0; const okKinds = {}, badKinds = {};
const kind = s => /import\(/.test(s) && s.includes("<") ? "import type + type arguments" : /asserts\s+\w+\s*\n\s*is/.test(s) ? "asserts x + line break + is" : /asserts\s+is/.test(s) ? "asserts with no subject" : /\(readonly /.test(s) ? "(readonly A) =>" : "reserved word as a type";
for (const [src, cls] of items) {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const n = sf.parseDiagnostics.length; const k = kind(src) + " [" + cls + "]";
  if (n === 0) { ok++; okKinds[k] = (okKinds[k] || 0) + 1; } else { bad++; badKinds[k] = (badKinds[k] || 0) + 1; }
}
console.log("sources", items.length, "tsc parses without a diagnostic:", ok, JSON.stringify(okKinds));
console.log("tsc reports a parse diagnostic:", bad, JSON.stringify(badKinds));
