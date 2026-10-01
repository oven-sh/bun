// node rows.cjs : every source of the two test tables, as tsc 6.0.2 and as the Go oracles read it; prints where tsc differs from typescript-go.
const fs = require("fs");
const { execFileSync } = require("child_process");
const ts = require("/workspace/bun/node_modules/typescript");
const D = [
  "// @ts-ignore\nlet x: number = 'a';", "/// @ts-ignore\nx;", "//@ts-expect-error: reason\nx;", "//\t \t@ts-expect-error\nx;",
  "x; // @ts-ignore\ny; /* @ts-expect-error */ z;\n", "x;\n// @ts-ignore", "// @ts-ignoreXYZ\n// @ts-expect-errors\nx;",
  "// @ts-ignore\r\nx;\r\n/*\r\n @ts-expect-error */\r\ny;\r\n",
  "/* @ts-expect-error */\nx;", "/*\n * @ts-ignore */\nx;", "/* @ts-ignore\n */\nx;", "/**\n * text\n * @ts-expect-error */\nx;",
  "/*\n   // @ts-expect-error */\nx;", "/* a\u2028 @ts-ignore */\nx;", "/*\r @ts-ignore */\rx;", "/*\n\t*/ @ts-ignore\n",
  "// see @ts-ignore\nx;", "/* x @ts-ignore */\nx;", "// @TS-IGNORE\nx;", "// @ ts-ignore\nx;", "// @ts-nocheck\n// @ts-check\n// @ts-expect-erro\n", "//@\nts-ignore",
  "//// @ts-ignore\nx;", "//\u00a0@ts-ignore\nx;", "//\u000b@ts-ignore\nx;", "/*@ts-ignore",
];
const P = [
  "/// <reference path=\"a.ts\" />\nx;", "/// <reference types=\"node\" />\nx;", "/// <reference lib=\"es2015\" />\nx;", "/// <reference lib='dom' />\nx;",
  "/// <reference types=\"a\" resolution-mode=\"import\" />\nx;", "/// <reference types=\"a\" resolution-mode=\"require\" />\nx;",
  "/// <reference path=\"a.ts\" preserve=\"true\" />\nx;", "/// <reference lib=\"dom\" preserve=\"false\" />\nx;",
  "/// <reference no-default-lib=\"true\" />\nx;", "/// <reference no-default-lib=\"true\" types=\"a\" />\nx;",
  "/// <reference path=\"p\" lib=\"l\" types=\"t\" />\nx;", "/// <REFERENCE PATH=\"a.ts\" />\nx;", "///<reference path = \"a.ts\"/>\nx;",
  "/// <reference path=\"\" />\nx;", "/// <reference path=\"\u00e9\u4e2d.ts\" />\nx;", "/// <reference path=\"a\" resolution-mode=\"bad\" />\nx;",
  "/// <reference />\nx;", "/// <reference no-default-lib=\"false\" />\nx;", "/// <reference foo=\"bar\" />\nx;", "/// <reference path=a.ts />\nx;",
  "/// <reference path=\"a.ts />\nx;", "/// <reference path='a.ts\" />\nx;", "/// <reference />\n/// <reference foo=\"1\" />\nx;",
  "/// <reference types=\"a\" resolution-mode=\"node\" />\nx;", "/// <reference types=\"a\" resolution-mode=\"IMPORT\" />\nx;", "/// <reference types=\"\" resolution-mode=\"x\" />\nx;",
  "// @ts-nocheck\n// @ts-check\nx;", "// @ts-check\n// @ts-nocheck\nx;", "// @ts-nocheck\nx;", "//@ts-check\nx;", "//\t@ts-check\nx;", "/// @ts-nocheck\nx;",
  "// @ts-nocheck: because\nx;", "// @TS-NOCHECK\nx;", "/* a */ // @ts-nocheck\nx;", "// @ts-nocheckx\nx;", "// use @ts-check\nx;", "/* @ts-nocheck */\nx;", "//// @ts-nocheck\nx;",
  "x;\n/// <reference path=\"a.ts\" />\n// @ts-nocheck\n", "#!/usr/bin/env bun\n/// <reference types=\"bun\" />\n// @ts-check\nx;", "#!/usr/bin/env bun\r\n/// <reference lib=\"dom\" />\r\nx;",
  "#!/usr/bin/env bun // @ts-nocheck\nx;", "\n#!/usr/bin/env bun\n// @ts-nocheck\nx;", "/// <reference path=\"a.ts\" />\r\n// @ts-nocheck\r\nx;\r\n",
  "\n\n// a\n/* b */\n/// <reference path=\"a.ts\" />\nx;", "/* c */ /// <reference path=\"a.ts\" />\nx;", "/// <reference path=\"a.ts\" />\u2028// @ts-nocheck\nx;",
  "\ufeff/// <reference path=\"a.ts\" />\nx;", "/// <reference path=\"a.ts\" />", "-->\n// @ts-check\nx;",
  "// <reference path=\"a.ts\" />\nx;", "//// <reference path=\"a.ts\" />\nx;", "/* <reference path=\"a.ts\" /> */\nx;", "/// <referencepath=\"a.ts\" />\nx;", "/// <amd-module name=\"m\" />\nx;",
  "/** @jsx h */\n/* @jsxFrag Fragment */\nx;", "// @jsx h\nx;", "// @ts-ignore\nx;", "",
  "/// <reference path=\"a.ts\"\nx;", "/// <reference\nx;", "/// <reference/>\nx;", "/// <reference path=\"a.ts\" path=\"b.ts\" />\nx;", "/// <reference garbage path=\"a.ts\" />\nx;",
  "///\u00a0<reference path=\"a.ts\" />\nx;", "/// <reference PRESERVE=\"true\" Path=\"a\" />\nx;", "///<", "/// <reference", "/// <reference path=\"",
];
const hex = s => Buffer.from(s, "utf8").toString("hex");
const name = (p, i) => p + String(i).padStart(2, "0");
fs.writeFileSync("rows-d.hex", D.map((s, i) => `${name("d", i)}\t${hex(s)}`).join("\n") + "\n");
fs.writeFileSync("rows-p.hex", P.map((s, i) => `${name("p", i)}\t${hex(s)}`).join("\n") + "\n");
const split = out => { const m = new Map(); let cur; for (const l of out.split("\n")) { if (l.startsWith("--- ")) { cur = l.slice(4); m.set(cur, []); } else if (l && !l.startsWith("pragma ")) m.get(cur).push(l); } return m; };
const goD = split(execFileSync("oracle-hex/directives/oracle", ["rows-d.hex"], { encoding: "utf8" }));
const goP = split(execFileSync("oracle-hex/pragmas/oracle", ["rows-p.hex"], { encoding: "utf8" }));
const rsD = split(execFileSync("proto2/proto2", ["directives", "rows-d.hex"], { encoding: "utf8" }));
const rsP = split(execFileSync("proto2/proto2", ["pragmas", "rows-p.hex"], { encoding: "utf8" }));
let bad = 0, dDiff = 0, pDiff = 0;
D.forEach((source, i) => {
  const n = name("d", i), b = k => Buffer.byteLength(source.slice(0, k), "utf8");
  if (JSON.stringify(goD.get(n)) !== JSON.stringify(rsD.get(n))) { bad++; console.log("PORT DIFFERS", n); }
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const t = [...new Set((sf.commentDirectives || []).map(d => `directive ${d.type === 0 ? "ExpectError" : "Ignore"} ${b(d.range.pos)}..${b(d.range.end)}`))];
  if (JSON.stringify(t) !== JSON.stringify(goD.get(n))) { dDiff++; console.log(`tsc differs ${n} ${JSON.stringify(source)}\n   tsc : ${t.join("; ")}\n   tsgo: ${goD.get(n).join("; ")}`); }
});
P.forEach((source, i) => {
  const n = name("p", i), b = k => Buffer.byteLength(source.slice(0, k), "utf8");
  if (JSON.stringify(goP.get(n)) !== JSON.stringify(rsP.get(n))) { bad++; console.log("PORT DIFFERS", n); }
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const t = [];
  const mode = m => m === undefined ? "none" : m === ts.ModuleKind.ESNext ? "import" : m === ts.ModuleKind.CommonJS ? "require" : String(m);
  if (sf.checkJsDirective) t.push(`check ${sf.checkJsDirective.enabled ? 1 : 0} ${b(sf.checkJsDirective.pos)}..${b(sf.checkJsDirective.end)}`);
  for (const r of sf.referencedFiles) t.push(`path ${b(r.pos)}..${b(r.end)} preserve=${r.preserve ? 1 : 0}`);
  for (const r of sf.typeReferenceDirectives) t.push(`types ${b(r.pos)}..${b(r.end)} mode=${mode(r.resolutionMode)} preserve=${r.preserve ? 1 : 0}`);
  for (const r of sf.libReferenceDirectives) t.push(`lib ${b(r.pos)}..${b(r.end)} preserve=${r.preserve ? 1 : 0}`);
  for (const d of sf.parseDiagnostics) if (d.code === 1084 || d.code === 1453) t.push(`diag TS${d.code} ${b(d.start)}..${b(d.start + d.length)}`);
  if (JSON.stringify(t) !== JSON.stringify(goP.get(n))) { pDiff++; console.log(`tsc differs ${n} ${JSON.stringify(source)}\n   tsc : ${t.join("; ")}\n   tsgo: ${goP.get(n).join("; ")}`); }
});
console.log(`rows: ${D.length} directive sources, ${P.length} header sources; port differs from typescript-go on ${bad}; tsc ${ts.version} differs from typescript-go on ${dDiff} + ${pDiff}`);
