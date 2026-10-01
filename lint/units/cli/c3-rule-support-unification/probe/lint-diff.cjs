// Lints real files with the probe and with ESLint at the pin (the eleven rules, default options) and compares.
// usage: ESLINT_PIN=/tmp/cmp-probe/eslint-pin node lint-diff.cjs <list of files> [/tmp/c3u/probe]
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const PIN = process.env.ESLINT_PIN || "/tmp/cmp-probe/eslint-pin";
const { Linter } = require(path.join(PIN, "lib/linter"));
const RULES = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero",
  "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const probe = process.argv[3] || "/tmp/c3u/probe";
const codes = files.map(f => fs.readFileSync(f, "utf8"));
fs.writeFileSync("/tmp/c3u/lint-diff-cases.txt", files.map((f, i) => `${i}\t${f.endsWith("x") ? "jsx" : "js"}\t${Buffer.from(codes[i], "utf8").toString("hex")}`).join("\n") + "\n");
const out = execFileSync(probe, ["lint", "/tmp/c3u/lint-diff-cases.txt"], { env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 30 }).toString();
const got = new Map();
for (const line of out.split("\n")) {
  if (!line) continue;
  const p = line.split("\t");
  if (p[1] === "PARSE_ERROR") got.set(+p[0], null);
  else if (p[1] === "OK") got.set(+p[0], []);
  else got.get(+p[0]).push({ rule: p[2], start: +p[3], message: Buffer.from(p[5], "hex").toString("utf8") });
}
const linter = new Linter({ configType: "flat" });
let same = 0, different = 0, bunRejects = 0, eslintRejects = 0, reports = 0;
const byRule = {};
for (let i = 0; i < files.length; i++) {
  const mineRaw = got.get(i);
  if (!mineRaw) { bunRejects++; continue; }
  const code = codes[i];
  let messages = null;
  for (const sourceType of ["module", "script", "commonjs"]) {
    const m = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: files[i].endsWith("x") } } },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: Object.fromEntries(RULES.map(r => [r, "error"])) }]);
    // A comment that configures ESLint is not read: what ESLint says about it is dropped.
    if (!m.some(x => x.fatal)) { messages = m.filter(x => RULES.includes(x.ruleId)); break; }
  }
  if (!messages) { eslintRejects++; continue; }
  // byte offset -> line:col in UTF-16 units
  const buf = Buffer.from(code, "utf8");
  const lineCol = offset => {
    const before = buf.subarray(0, offset).toString("utf8");
    let line = 1, last = -1;
    for (let k = 0; k < before.length; k++) {
      const ch = before.charCodeAt(k);
      if (ch === 13 && before.charCodeAt(k + 1) === 10) continue;
      if (ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029) { line++; last = k; }
    }
    return `${line}:${before.length - last}`;
  };
  const mine = [...new Set(mineRaw.map(r => `${lineCol(r.start)} ${r.rule} ${r.message}`))].sort();
  const theirs = [...new Set(messages.map(m => `${m.line}:${m.column} ${m.ruleId} ${m.message}`))].sort();
  reports += theirs.length;
  for (const m of messages) byRule[m.ruleId] = (byRule[m.ruleId] || 0) + 1;
  if (JSON.stringify(mine) === JSON.stringify(theirs)) same++;
  else {
    different++;
    const a = new Set(mine), b = new Set(theirs);
    console.log(`DIFFERENT ${files[i]}`);
    for (const x of theirs) if (!a.has(x)) console.log(`    only ESLint: ${x}`);
    for (const x of mine) if (!b.has(x)) console.log(`    only probe:  ${x}`);
  }
}
console.log(`${files.length} files: ${same} with the same reports, ${different} different, ${bunRejects} Bun's parser rejects, ${eslintRejects} ESLint's parser rejects; ${reports} reports of ESLint: ${JSON.stringify(byRule)}`);
