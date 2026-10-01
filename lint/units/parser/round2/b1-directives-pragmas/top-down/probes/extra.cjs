const fs = require("fs");
const ts = require("/workspace/bun/node_modules/typescript");
const P = [
  ["x-unclosed-with-path", "/// <reference path=\"a.ts\"\nx;"],
  ["x-no-space-before-close", "/// <reference path=\"a.ts\"/>\nx;"],
  ["x-no-space-after-slashes", "///<reference path=\"a.ts\" />\nx;"],
  ["x-spaces-around-equals", "/// <reference path = \"a.ts\" />\nx;"],
  ["x-trailing-text", "/// <reference path=\"a.ts\" /> trailing\nx;"],
  ["x-garbage-before-arg", "/// <reference garbage path=\"a.ts\" />\nx;"],
  ["x-tab-separators", "///\t<reference\tpath=\"a.ts\"\t/>\nx;"],
  ["x-tag-immediately-closed", "/// <reference/>\nx;"],
  ["x-tag-suffix", "/// <referencepath=\"a.ts\" />\nx;"],
  ["x-mismatched-quotes", "/// <reference path='a.ts\" />\nx;"],
  ["x-preserve-upper-value", "/// <reference path=\"a\" preserve=\"TRUE\" />\nx;"],
  ["x-upper-arg-names", "/// <reference PRESERVE=\"true\" Path=\"a\" />\nx;"],
  ["x-mode-upper", "/// <reference types=\"a\" resolution-mode=\"IMPORT\" />\nx;"],
  ["x-block-then-reference-same-line", "/* c */ /// <reference path=\"a.ts\" />\nx;"],
  ["x-shebang-line-comment", "#!/usr/bin/env bun // @ts-nocheck\nx;"],
  ["x-shebang-not-at-zero", "\n#!/usr/bin/env bun\n// @ts-nocheck\nx;"],
  ["x-amd-module", "/// <amd-module name=\"m\" />\nx;"],
  ["x-amd-dependency", "/// <amd-dependency path=\"p\" name=\"n\" />\nx;"],
  ["x-ls-ends-line-comment", "/// <reference path=\"a.ts\" />\u2028// @ts-nocheck\nx;"],
  ["x-value-with-gt", "/// <reference path=\"a/>b\" />\nx;"],
  ["x-check-no-space", "//@ts-check\nx;"],
  ["x-check-tab", "//\t@ts-check\nx;"],
  ["x-check-words-before", "// use @ts-check\nx;"],
  ["x-check-after-block-same-line", "/* a */ // @ts-nocheck\nx;"],
  ["x-only-comment-unterminated-block", "/* @ts-nocheck"],
  ["x-empty", ""],
  ["x-only-shebang", "#!/usr/bin/env bun"],
  ["x-reference-non-ascii-value", "/// <reference path=\"\u00e9\u4e2d.ts\" />\nx;"],
  ["x-nbsp-after-slashes", "///\u00a0<reference path=\"a.ts\" />\nx;"],
  ["x-types-empty-and-mode", "/// <reference types=\"\" resolution-mode=\"x\" />\nx;"],
];
const hex = s => Buffer.from(s, "utf8").toString("hex");
fs.writeFileSync("/tmp/b1dp/extra-p.hex", P.map(([n, s]) => `${n}\t${hex(s)}`).join("\n") + "\n");
for (const [name, source] of P) {
  const b = i => Buffer.byteLength(source.slice(0, i), "utf8");
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  console.log(`--- ${name}`);
  const pr = [];
  sf.pragmas.forEach((v, k) => { for (const e of Array.isArray(v) ? v : [v]) pr.push([e.range.pos, `pragma ${k} ${b(e.range.pos)}..${b(e.range.end)}`]); });
  pr.sort((a, c) => a[0] - c[0]);
  for (const [, l] of pr) console.log(l);
  if (sf.checkJsDirective) console.log(`check ${sf.checkJsDirective.enabled ? 1 : 0} ${b(sf.checkJsDirective.pos)}..${b(sf.checkJsDirective.end)}`);
  const mode = m => m === undefined ? "none" : m === ts.ModuleKind.ESNext ? "import" : m === ts.ModuleKind.CommonJS ? "require" : String(m);
  for (const r of sf.referencedFiles) console.log(`path ${b(r.pos)}..${b(r.end)} preserve=${r.preserve ? 1 : 0}`);
  for (const r of sf.typeReferenceDirectives) console.log(`types ${b(r.pos)}..${b(r.end)} mode=${mode(r.resolutionMode)} preserve=${r.preserve ? 1 : 0}`);
  for (const r of sf.libReferenceDirectives) console.log(`lib ${b(r.pos)}..${b(r.end)} preserve=${r.preserve ? 1 : 0}`);
  for (const d of sf.parseDiagnostics) if (d.code === 1084 || d.code === 1453) console.log(`diag TS${d.code} ${b(d.start)}..${b(d.start + d.length)}`);
}
