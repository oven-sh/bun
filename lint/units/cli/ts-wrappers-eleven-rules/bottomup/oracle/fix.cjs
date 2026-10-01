// usage: node fix.cjs [--bin path] [--show]   the fixtures of the tree through a probe binary: which cases keep the answer of `expect`
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
let bin = "/tmp/tsw/out/tsentry", show = false, rulesDir = "/workspace/wt/cli/test/cli/lint/rules";
while (args.length) { const a = args.shift(); if (a === "--bin") bin = args.shift(); else if (a === "--show") show = true; else if (a === "--rules") rulesDir = args.shift(); }
const rules = fs.readdirSync(rulesDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
let total = 0, changed = 0, toEslint = 0;
for (const rule of rules) {
  const cases = JSON.parse(fs.readFileSync(path.join(rulesDir, rule + ".json"), "utf8"));
  const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext ?? (c.jsx ? "jsx" : "js")}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fix-${rule}-`));
  cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
  const received = cases.map(() => []);
  const other = [];
  for (let at = 0; at < names.length; at += 400) {
    const run = spawnSync(bin, ["--lint", ...names.slice(at, at + 400)], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
    for (const line of run.stderr.split("\n").filter(Boolean)) {
      const m = /^c(\d+)\.[cm]?[jt]sx?\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
      if (!m) { other.push(line); continue; }
      if (m[5] === rule) received[Number(m[1])].push({ line: Number(m[2]), column: Number(m[3]), message: m[6] });
      else if (!rules.includes(m[5]) && !(m[4] === "warning")) other.push(line);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  let ruleChanged = 0, ruleToEslint = 0;
  const norm = rs => JSON.stringify(rs.map(r => [r.line, r.column, r.message.replace(/\r\n?|\n/g, " ")]));
  cases.forEach((c, i) => {
    total++;
    if (norm(received[i]) !== norm(c.expect)) {
      changed++; ruleChanged++;
      const es = c.differs ? c.eslint : c.expect;
      // Equal reports print once.
      const dedup = rs => JSON.stringify([...new Set(rs.map(r => JSON.stringify([r.line, r.column, r.message.replace(/\r\n?|\n/g, " ")])))].sort());
      const isEslint = es && dedup(es) === dedup(received[i]);
      if (isEslint) { toEslint++; ruleToEslint++; }
      if (show) console.log(`${rule}: ${JSON.stringify(c.code)}${c.differs ? " differs=" + c.differs : ""}\n    fixture: ${norm(c.expect)}\n    now:     ${norm(received[i])}${isEslint ? "   = ESLint" : ""}\n    eslint:  ${es ? norm(es) : "?"}`);
    }
  });
  console.log(`${rule}: ${cases.length} cases, ${ruleChanged} changed (${ruleToEslint} to ESLint's answer), other lines ${other.length}${other.length ? ": " + other.slice(0, 2).join(" || ") : ""}`);
}
console.log(JSON.stringify({ total, changed, toEslint }));
