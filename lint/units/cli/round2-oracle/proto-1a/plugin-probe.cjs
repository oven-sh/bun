// Compares ESLint's core no-dupe-class-members with @typescript-eslint/no-dupe-class-members over case lists (TS cases only).
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const plugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const fs = require("fs");
const cases = process.argv.slice(2).flatMap(f => JSON.parse(fs.readFileSync(f, "utf8"))).filter(c => c.ext);
let same = 0, differ = 0;
for (const c of cases) {
  const run = rules => linter.verify(c.code, [{ files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tsParser, sourceType: "module" }, plugins: { "@typescript-eslint": plugin }, rules }], { filename: `case.${c.ext}` });
  const k = ms => ms.map(m => (m.fatal ? "FATAL " + m.message : `${m.line}:${m.column} ${m.message}`)).sort().join(" | ") || "(none)";
  const core = k(run({ "no-dupe-class-members": "error" }));
  const ext = k(run({ "@typescript-eslint/no-dupe-class-members": "error" }));
  if (core === ext) same++; else { differ++; console.log(JSON.stringify(c.code), "\n   core:  ", core, "\n   plugin:", ext); }
}
console.log({ cases: cases.length, same, differ }, plugin.meta || "");
