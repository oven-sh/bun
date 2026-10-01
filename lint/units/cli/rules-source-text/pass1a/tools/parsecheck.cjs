// For each of the seven rules: every code of ESLint's own test through `bun --lint` (debug build); prints those that Bun's parser rejects.
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs"); const path = require("path");
const rules = ["no-loss-of-precision", "no-octal", "no-nonoctal-decimal-escape", "no-irregular-whitespace", "no-unexpected-multiline", "no-empty", "no-empty-static-block"];
const BUN = "/workspace/wt/cli/build/debug/bun-debug";
for (const rule of rules) {
  const all = JSON.parse(execFileSync("node", ["/workspace/notes/lint/units/cli/round2-oracle/proto-1a/extract.cjs", rule, "--all"], { encoding: "utf8", maxBuffer: 1 << 28 }));
  const dir = fs.mkdtempSync(path.join("/tmp/rst/parsecheck/", rule + "-"));
  const names = all.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext || "js"}`);
  all.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
  const js = names.filter(n => n.endsWith(".js"));
  const r = spawnSync(BUN, ["--lint", ...js], { cwd: dir, encoding: "utf8", env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" } });
  const rejected = new Map(); const other = {};
  for (const line of r.stderr.split("\n").filter(Boolean)) {
    const m = /^(c\d+\.js)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
    if (!m) { console.log("?? " + line); continue; }
    if (m[5] === "syntax" && m[4] === "error") { if (!rejected.has(m[1])) rejected.set(m[1], m[6]); }
    else other[m[5]] = (other[m[5]] || 0) + 1;
  }
  console.log(`== ${rule}: ${all.length} codes (${js.length} js), exit ${r.status}, Bun rejects ${rejected.size}; lines of existing rules: ${JSON.stringify(other)}`);
  for (const [n, msg] of rejected) console.log(`   ${JSON.stringify(all[names.indexOf(n)].code).slice(0, 110)}  -> ${msg}`);
}
