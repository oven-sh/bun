// Writes vectors/<rule>.json for the five rules that had no vector file: what ESLint at the pin reports for
// every case of cases/<rule>.*.json and of ESLint's own test file of the rule (default options, JavaScript).
// usage: ESLINT_PIN=/tmp/cmp-probe/eslint-pin node make-vectors.cjs
// ESLINT_PIN is a copy of lib, conf, messages and package.json of /workspace/ref/eslint (4618052) with
// `npm install --omit=dev --ignore-scripts` run in it (../rules-expression-equality-bottomup/prototype/setup.sh).
// Vector: {code, origin, jsx?, sourceType?, eslint: [{line, column, endLine, endColumn, message}]}
// A case ESLint's parser rejects goes to vectors/<rule>.eslint-rejects.json with the error.
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const PIN = process.env.ESLINT_PIN || "/tmp/cmp-probe/eslint-pin";
const REF = "/workspace/ref/eslint";
const HERE = __dirname;
const RULES = ["no-debugger", "no-sparse-arrays", "no-empty-pattern", "no-dupe-keys", "no-dupe-class-members"];
const { Linter } = require(path.join(PIN, "lib/linter"));

// ESLint's own test file, read with a RuleTester that only records.
function upstream(rule) {
  const recorded = [];
  class RuleTester {
    constructor(config) { this.config = config || {}; }
    run(name, ruleObject, tests) {
      const typescript = Boolean(this.config.languageOptions && this.config.languageOptions.parser);
      recorded.push({ typescript, valid: tests.valid, invalid: tests.invalid });
    }
  }
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (/rule-tester\/rule-tester$/u.test(request)) return RuleTester;
    if (request === "@typescript-eslint/parser") return { typescript: true };
    return load.call(this, request, parent, isMain);
  };
  const dir = path.join(PIN, "tests/lib/rules");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REF, "tests/lib/rules", rule + ".js"), path.join(dir, rule + ".js"));
  try { require(path.join(dir, rule + ".js")); } finally { Module._load = load; }
  const out = [];
  let skipped = 0;
  for (const run of recorded) {
    for (const c of [...run.valid, ...run.invalid]) {
      const test = typeof c === "string" ? { code: c } : c;
      const lo = test.languageOptions || {};
      if (run.typescript || lo.parser || (test.options && test.options.length) || lo.globals) { skipped++; continue; }
      out.push({ code: test.code, origin: "eslint-tests", sourceType: lo.sourceType, ecmaVersion: lo.ecmaVersion,
        jsx: Boolean(lo.parserOptions && lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.jsx) });
    }
  }
  return { cases: out, skipped };
}

function own(rule) {
  const out = [];
  for (const f of fs.readdirSync(path.join(HERE, "cases")).sort()) {
    if (!f.startsWith(rule + ".") || !f.endsWith(".json")) continue;
    const origin = f.slice(rule.length + 1, -5);
    for (const c of JSON.parse(fs.readFileSync(path.join(HERE, "cases", f), "utf8"))) {
      out.push(typeof c === "string" ? { code: c, origin } : { ...c, origin });
    }
  }
  return out;
}

function verify(rule, c, sourceType) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(c.code, [{
    languageOptions: { ecmaVersion: c.ecmaVersion || "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: !!c.jsx } } },
    rules: { [rule]: "error" },
  }]);
}

fs.mkdirSync(path.join(HERE, "vectors"), { recursive: true });
for (const rule of RULES) {
  const up = upstream(rule);
  const seen = new Set();
  const vectors = [];
  const rejects = [];
  for (const c of [...up.cases, ...own(rule)]) {
    const key = JSON.stringify([c.code, !!c.jsx]);
    if (seen.has(key)) continue;
    seen.add(key);
    // A file is a script unless it says otherwise: what ESLint rejects as a script is tried as a module.
    let sourceType = c.sourceType || "script";
    let messages = verify(rule, c, sourceType);
    if (messages.some(m => m.fatal) && !c.sourceType) {
      const again = verify(rule, c, "module");
      if (!again.some(m => m.fatal)) { messages = again; sourceType = "module"; }
    }
    const fatal = messages.find(m => m.fatal);
    if (fatal) { rejects.push({ code: c.code, origin: c.origin, jsx: c.jsx || undefined, error: `${fatal.line}:${fatal.column} ${fatal.message}` }); continue; }
    const v = { code: c.code, origin: c.origin };
    if (c.jsx) v.jsx = true;
    if (sourceType !== "script") v.sourceType = sourceType;
    v.eslint = messages.map(m => ({ line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, message: m.message }));
    vectors.push(v);
  }
  fs.writeFileSync(path.join(HERE, "vectors", rule + ".json"), JSON.stringify(vectors, null, 1) + "\n");
  fs.writeFileSync(path.join(HERE, "vectors", rule + ".eslint-rejects.json"), JSON.stringify(rejects, null, 1) + "\n");
  console.log(`${rule}: ${vectors.length} vectors (${vectors.filter(v => v.eslint.length).length} with reports, ${vectors.reduce((n, v) => n + v.eslint.length, 0)} reports), ` +
    `${up.cases.length} from ESLint's tests (${up.skipped} with options or TypeScript skipped), ${rejects.length} rejected by ESLint's parser`);
}
