// What tsc 6.0.2 reads from the header comments of a JavaScript file: checkJsDirective and the pragma names.
// usage: node pragmas-js.cjs > pragmas-js.txt
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const inputs = [
  "// @ts-check\nx",
  "// @ts-nocheck\nx",
  "//@ts-check\nx",
  "// @ts-check and more\nx",
  "/* @ts-check */\nx",
  "/** @ts-check */\nx",
  "// @ts-check\n// @ts-nocheck\nx",
  "// @ts-nocheck\n// @ts-check\nx",
  "#!/usr/bin/env node\n// @ts-check\nx",
  "'use strict';\n// @ts-check\nx",
  "\n\n  // @ts-check\nx",
  "// a comment\n// @ts-check\nx",
  "/* license */ // @ts-check\nx",
  "x;\n// @ts-check\n",
  "// @TS-CHECK\nx",
  "// @ts-checkx\nx",
  "/// <reference path=\"a.d.ts\" />\n// @ts-check\nx",
  "// @jsx h\n// @ts-check\nx",
  "/** @jsx h */\nx",
  "// @ts-check",
  "",
];
for (const src of inputs) {
  for (const name of ["a.js", "a.mjs", "a.ts"]) {
    const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, false);
    const d = sf.checkJsDirective;
    console.log(`${JSON.stringify(src).padEnd(62)} ${name.padEnd(6)} checkJsDirective=${d ? `{enabled:${d.enabled},pos:${d.pos},end:${d.end}}` : "none"} pragmas=[${[...sf.pragmas.keys()].join(",")}]`);
  }
}
