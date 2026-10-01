// usage: node real.cjs <list of files>   compares the probe binary with ESLint (typescript-eslint's parser) on real files, the eleven rules
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const plugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const RULES = ["no-debugger","no-dupe-keys","no-dupe-class-members","no-duplicate-case","no-empty-pattern","no-compare-neg-zero","use-isnan","valid-typeof","no-unsafe-negation","no-sparse-arrays","no-self-assign"];
const bin = process.env.PROBE_BIN || "/tmp/tsw/out/tsentry";
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const ruleConfig = {};
for (const r of RULES) ruleConfig[r === "no-dupe-class-members" ? "@typescript-eslint/no-dupe-class-members" : r] = "error";
const counts = { files: 0, same: 0, bothReject: 0, eslintRejects: 0, bunRejects: 0, differ: 0, reports: 0 };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "real-"));
const CH = 100;
for (let at = 0; at < files.length; at += CH) {
  const chunk = files.slice(at, at + CH);
  const names = chunk.map((f, i) => `f${String(at + i).padStart(6, "0")}${/\.tsx$/.test(f) ? ".tsx" : /\.mts$/.test(f) ? ".mts" : /\.cts$/.test(f) ? ".cts" : ".ts"}`);
  const texts = chunk.map(f => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } });
  names.forEach((n, i) => { if (texts[i] !== null) fs.writeFileSync(path.join(dir, n), texts[i]); });
  const run = spawnSync(bin, ["--lint", ...names.filter((n, i) => texts[i] !== null)], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 30 });
  if (run.status !== 0 && run.status !== 2) console.log("probe exit", run.status, run.signal, chunk[0], (run.stderr || "").slice(-500));
  const bun = new Map(names.map(n => [n, []])), rejected = new Set();
  for (const line of (run.stderr || "").split("\n")) {
    const m = /^(f\d+\.[cm]?tsx?)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
    if (!m) continue;
    if (RULES.includes(m[5])) bun.get(m[1]).push(`${m[2]}:${m[3]} ${m[5]}: ${m[6]}`);
    else if (m[4] === "error") rejected.add(m[1]);
  }
  names.forEach((n, i) => {
    if (texts[i] === null) return;
    counts.files++;
    const ext = n.slice(n.indexOf(".") + 1);
    let messages;
    try {
      messages = linter.verify(texts[i].replace(/^\uFEFF/, ""), [{ files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: ext === "cts" ? "commonjs" : "module", parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }, plugins: { "@typescript-eslint": plugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: ruleConfig }], { filename: n });
    } catch (e) { messages = [{ fatal: true, message: String(e) }]; }
    const fatal = messages.find(m => m.fatal);
    const es = fatal ? null : [...new Set(messages.filter(m => m.ruleId).map(m => `${m.line}:${m.column} ${m.ruleId.replace("@typescript-eslint/", "")}: ${m.message.replace(/\r\n?|\n/g, " ")}`))].sort();
    const b = rejected.has(n) ? null : [...new Set(bun.get(n))].sort();
    if (!es && !b) counts.bothReject++;
    else if (!es) counts.eslintRejects++;
    else if (!b) counts.bunRejects++;
    else if (JSON.stringify(es) === JSON.stringify(b)) { counts.same++; counts.reports += es.length; }
    else {
      counts.differ++;
      console.log(`DIFF ${chunk[i]}`);
      for (const x of es.filter(x => !b.includes(x))) console.log(`    eslint only: ${x}`);
      for (const x of b.filter(x => !es.includes(x))) console.log(`    bun only:    ${x}`);
    }
  });
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(counts));
