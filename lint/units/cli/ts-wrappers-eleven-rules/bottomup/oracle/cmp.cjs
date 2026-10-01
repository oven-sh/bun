// usage: node cmp.cjs [--bin path] [--show kinds] [--rule r] [--json out] list.json...
// A list is [{code, ext?, jsx?}]. Compares ESLint at the pin (typescript-eslint's parser for TS files, and its rule of
// no-dupe-class-members there) with a probe binary that takes the operands of `bun --lint` and writes the plain format.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const plugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const RULES = ["no-debugger","no-dupe-keys","no-dupe-class-members","no-duplicate-case","no-empty-pattern","no-compare-neg-zero","use-isnan","valid-typeof","no-unsafe-negation","no-sparse-arrays","no-self-assign"];
const isTs = ext => ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts";
const args = process.argv.slice(2);
let bin = process.env.PROBE_BIN || "/tmp/tsw/out/tsentry", show = new Set(), only = null, jsonOut = null, lists = [], env = {};
while (args.length) {
  const a = args.shift();
  if (a === "--bin") bin = args.shift();
  else if (a === "--show") show = new Set(args.shift().split(","));
  else if (a === "--rule") only = args.shift();
  else if (a === "--json") jsonOut = args.shift();
  else lists.push(a);
}
const rules = only ? [only] : RULES;
function once(code, ext, sourceType, jsx) {
  const ts = isTs(ext);
  const languageOptions = { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
  if (ts) languageOptions.parser = tsParser;
  const ruleConfig = {};
  for (const r of rules) ruleConfig[ts && r === "no-dupe-class-members" ? "@typescript-eslint/no-dupe-class-members" : r] = "error";
  const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": plugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: ruleConfig }];
  return linter.verify(code, config, { filename: `c.${ext}` });
}
function verify(code, ext) {
  let tries;
  if (ext === "js") tries = [["script", false, "js"], ["module", false, "js"], ["script", true, "jsx"], ["module", true, "jsx"]];
  else if (ext === "jsx") tries = [["script", true, "jsx"], ["module", true, "jsx"]];
  else if (ext === "mjs") tries = [["module", false, "mjs"]];
  else if (ext === "cjs") tries = [["commonjs", false, "cjs"]];
  else if (ext === "cts") tries = [["commonjs", false, "cts"]];
  else tries = [["module", ext === "tsx", ext]];
  let first = null;
  for (const [type, jsx, asExt] of tries) {
    const messages = once(code, asExt, type, jsx);
    const fatal = messages.find(m => m.fatal) || null;
    const result = { fatal, messages: messages.filter(m => !m.fatal && m.ruleId !== null), ext: asExt };
    if (!fatal) return result;
    first = first || result;
  }
  return first;
}
const cases = [];
const seen = new Set();
for (const l of lists) for (const c of JSON.parse(fs.readFileSync(l, "utf8"))) {
  const ext = c.ext || (c.jsx ? "jsx" : "js");
  const k = ext + ":" + c.code;
  if (seen.has(k)) continue;
  seen.add(k);
  cases.push({ code: c.code, ext, fixtureExpect: c.expect, differs: c.differs });
}
const names = cases.map((c, i) => `c${String(i).padStart(5, "0")}.${c.ext}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tswcmp-"));
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
const bun = cases.map(() => []);
const rejected = cases.map(() => null);
const CH = 400;
for (let at = 0; at < names.length; at += CH) {
  const run = spawnSync(bin, ["--lint", ...names.slice(at, at + CH)], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1" }, encoding: "utf8", maxBuffer: 1 << 28 });
  if (run.status !== 0 && run.status !== 2) console.log("probe exit", run.status, run.signal, (run.stderr || "").slice(-2000));
  for (const line of run.stderr.split("\n").filter(Boolean)) {
    const m = /^(c(\d+)\.[cm]?[jt]sx?)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
    if (!m) { if (!/^\s/.test(line)) console.log("?? " + line); continue; }
    const i = Number(m[2]);
    if (RULES.includes(m[6])) { if (rules.includes(m[6])) bun[i].push(`${m[3]}:${m[4]} ${m[6]}: ${m[7]}`); }
    else if (m[5] === "error") rejected[i] = (rejected[i] || "") + `${m[3]}:${m[4]} ${m[6]}: ${m[7]} | `;
  }
}
fs.rmSync(dir, { recursive: true, force: true });
const counts = {};
const out = [];
cases.forEach((c, i) => {
  const r = verify(c.code, c.ext);
  const es = r.fatal ? null : [...new Set(r.messages.map(m => `${m.line}:${m.column} ${m.ruleId.replace("@typescript-eslint/", "")}: ${m.message.replace(/\r\n?|\n/g, " ")}`))].sort();
  const b = rejected[i] ? null : [...new Set(bun[i])].sort();
  let kind;
  if (!es && !b) kind = "both-reject";
  else if (!es) kind = "eslint-rejects";
  else if (!b) kind = "bun-rejects";
  else if (JSON.stringify(es) === JSON.stringify(b)) kind = "same";
  else {
    const strip = s => s.replace(/^\d+:\d+ /, "");
    const eo = es.filter(x => !b.includes(x)), bo = b.filter(x => !es.includes(x));
    if (!bo.length) kind = "missing";
    else if (!eo.length) kind = "extra";
    else if (JSON.stringify(eo.map(strip).sort()) === JSON.stringify(bo.map(strip).sort())) kind = "moved";
    else kind = "other";
  }
  counts[kind] = (counts[kind] || 0) + 1;
  out.push({ code: c.code, ext: c.ext, kind, eslint: es, bun: b, fatal: r.fatal ? r.fatal.message : undefined, rejected: rejected[i] || undefined, differs: c.differs });
  if (show.has(kind) || show.has("all")) {
    console.log(`${kind}: ${JSON.stringify(c.code)} [${c.ext}]${c.differs ? " (fixture differs: " + c.differs + ")" : ""}`);
    console.log(`    eslint: ${es ? es.join(" | ") || "(none)" : "FATAL " + r.fatal.message}`);
    console.log(`    bun:    ${b ? b.join(" | ") || "(none)" : "REJECTS " + rejected[i]}`);
  }
});
console.log(JSON.stringify({ cases: cases.length, ...counts }));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
