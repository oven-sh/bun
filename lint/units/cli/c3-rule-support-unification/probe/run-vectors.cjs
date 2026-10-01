// Runs the probe binary over every vector file and compares what it reports with what the files expect.
// usage: node run-vectors.cjs [/tmp/c3u/probe] [-v]
// Vector families (all below /workspace/notes/lint/units/cli):
//   A  rules-comparisons/lists/<rule>.txt           VALID / INVALID / DIFFERENT, positions line:col with a tag
//   B  rules-expression-equality/cases/*.json        with expected/<rule>.<list>.eslint.txt (what ESLint says)
//   C  rules-expression-equality-bottomup/vectors    {code, eslint[], expect[]|null, jsx?}
//   D  c3-rule-support-unification/vectors/<rule>.json   {code, jsx?, eslint[]} written by make-vectors.cjs
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = "/workspace/notes/lint/units/cli";
const probe = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "/tmp/c3u/probe";
const verbose = process.argv.includes("-v");

const cases = []; // {id, code, jsx, rule, family, file, eslint: ["L:C message"], bun: ["L:C message"]|undefined, note}
const add = c => { c.id = cases.length; cases.push(c); };

const untag = (rule, tag) => {
  if (rule === "no-compare-neg-zero") return `Do not use the '${tag.slice(1, -1)}' operator to compare against -0.`;
  if (rule === "no-unsafe-negation") return `Unexpected negating the left operand of '${tag.slice(1, -1)}' operator.`;
  if (tag === "C") return "Use the isNaN function to compare with NaN.";
  if (tag === "S") return "'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch.";
  if (tag === "K") return "'case NaN' can never match. Use Number.isNaN before the switch.";
  if (tag === "") return "Invalid typeof comparison value.";
  throw new Error("tag " + tag);
};
const parseList = (rule, text) => (text === "none" ? [] : text.split(" ").map(e => { const m = /^(\d+:\d+)(.*)$/.exec(e); return `${m[1]} ${untag(rule, m[2])}`; }));

// A
for (const rule of ["no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation"]) {
  const lines = fs.readFileSync(`${ROOT}/rules-comparisons/lists/${rule}.txt`, "utf8").split("\n");
  let section = "";
  for (const line of lines.slice(1)) {
    if (/^(VALID|INVALID|DIFFERENT):$/.test(line)) { section = line.slice(0, -1); continue; }
    if (!line) continue;
    const base = { rule, family: "A", file: `lists/${rule}.txt`, jsx: true };
    if (section === "VALID") add({ ...base, code: JSON.parse(line), eslint: [] });
    else {
      const at = line.lastIndexOf('" => ');
      const code = JSON.parse(line.slice(0, at + 1));
      const rest = line.slice(at + 5);
      if (section === "INVALID") add({ ...base, code, eslint: parseList(rule, rest) });
      else { const m = /^ESLint (.*); bun (.*)$/.exec(rest); add({ ...base, code, eslint: parseList(rule, m[1]), bun: parseList(rule, m[2]) }); }
    }
  }
}
// B
for (const f of fs.readdirSync(`${ROOT}/rules-expression-equality/expected`)) {
  const m = /^(no-[a-z-]+)\.(.+)\.eslint\.txt$/.exec(f);
  if (!m) continue;
  const rule = m[1];
  for (const line of fs.readFileSync(`${ROOT}/rules-expression-equality/expected/${f}`, "utf8").split("\n")) {
    if (!line) continue;
    const at = line.lastIndexOf('"  =>  ');
    const code = JSON.parse(line.slice(0, at + 1));
    const rest = line.slice(at + 7);
    if (rest.startsWith("FATAL")) continue;
    const eslint = rest === "(none)" ? [] : rest.split("  |  ").map(e => { const x = /^(\d+:\d+)-\d+:\d+ \S+ (".*")$/.exec(e); return `${x[1]} ${JSON.parse(x[2])}`; });
    add({ rule, family: "B", file: f, code, jsx: /<[a-zA-Z/>]/.test(code) && f.includes("dup"), eslint, module: f.includes("module") });
  }
}
// C
for (const rule of ["no-duplicate-case", "no-self-assign"]) {
  const file = `rules-expression-equality-bottomup/vectors/vectors-${rule}.json`;
  for (const v of JSON.parse(fs.readFileSync(`${ROOT}/${file}`, "utf8"))) {
    add({ rule, family: "C", file, code: v.code, jsx: !!v.jsx, eslint: v.eslint.map(e => `${e.line}:${e.column} ${e.message}`),
      bun: v.expect === null ? undefined : v.expect.map(e => `${e.line}:${e.column} ${e.message}`), why: v.why });
  }
}
// D
const dir = `${ROOT}/c3-rule-support-unification/vectors`;
if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".json") || f.endsWith(".eslint-rejects.json")) continue;
  const rule = f.replace(/\.json$/, "");
  for (const v of JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"))) {
    add({ rule, family: "D", file: `vectors/${f}`, code: v.code, jsx: !!v.jsx, eslint: v.eslint.map(e => `${e.line}:${e.column} ${e.message}`),
      bun: v.bun ? v.bun.map(e => `${e.line}:${e.column} ${e.message}`) : undefined, why: v.why });
  }
}

const hex = s => Buffer.from(s, "utf8").toString("hex");
fs.writeFileSync("/tmp/c3u/cases.txt", cases.map(c => `${c.id}\t${c.jsx ? "jsx" : "js"}\t${hex(c.code)}`).join("\n") + "\n");
const out = execFileSync(probe, ["lint", "/tmp/c3u/cases.txt"], { env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 28 }).toString();
const got = new Map();
for (const line of out.split("\n")) {
  if (!line) continue;
  const p = line.split("\t");
  const id = +p[0];
  if (p[1] === "PARSE_ERROR") got.set(id, null);
  else if (p[1] === "OK") got.set(id, []);
  else got.get(id).push({ rule: p[2], start: +p[3], len: +p[4], message: Buffer.from(p[5], "hex").toString("utf8") });
}
function lineCol(code, byteOffset) {
  const before = Buffer.from(code, "utf8").subarray(0, byteOffset).toString("utf8");
  let line = 1, col = 1;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === "\r" && before[i + 1] === "\n") continue;
    if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") { line++; col = 1; } else col++;
  }
  return `${line}:${col}`;
}
const stats = {};
const show = [];
for (const c of cases) {
  const key = `${c.family} ${c.file}`;
  const s = (stats[key] ??= { cases: 0, rejected: 0, asEslint: 0, asBun: 0, neither: 0, dedupOnly: 0 });
  s.cases++;
  const reports = got.get(c.id);
  if (reports === null || reports === undefined) { s.rejected++; show.push(`REJECTED ${key}: ${JSON.stringify(c.code)}  eslint: ${c.eslint.join(" | ") || "(none)"}`); continue; }
  // Half a surrogate pair prints as U+FFFD.
  const lone = s => s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  const mine = reports.filter(r => r.rule === c.rule).map(r => `${lineCol(c.code, r.start)} ${r.message}`).sort();
  const eslint = c.eslint.map(lone).sort();
  const eslintDedup = [...new Set(eslint)];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (same(mine, eslint)) s.asEslint++;
  else if (same(mine, eslintDedup)) { s.asEslint++; s.dedupOnly++; }
  else if (c.bun && same(mine, [...new Set(c.bun)].sort())) { s.asBun++; if (verbose) show.push(`AS-SPECIFIED ${key}: ${JSON.stringify(c.code)}\n    eslint: ${eslint.join(" | ") || "(none)"}\n    probe:  ${mine.join(" | ") || "(none)"}`); }
  else { s.neither++; show.push(`MISMATCH ${key}: ${JSON.stringify(c.code)}\n    eslint: ${eslint.join(" | ") || "(none)"}\n    spec:   ${c.bun ? c.bun.join(" | ") || "(none)" : "-"}\n    probe:  ${mine.join(" | ") || "(none)"}`); }
}
console.log(show.join("\n"));
console.log("\nfamily file: cases / parser rejects / as ESLint (of which only merged duplicates) / as the unit's specified difference / neither");
for (const [k, s] of Object.entries(stats)) console.log(`${k}: ${s.cases} / ${s.rejected} / ${s.asEslint} (${s.dedupOnly}) / ${s.asBun} / ${s.neither}`);
