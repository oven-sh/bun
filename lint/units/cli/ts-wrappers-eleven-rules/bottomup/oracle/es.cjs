// usage: node es.cjs <ext> <code>...   or   node es.cjs --file list.json   (list: [{code, ext}])
"use strict";
const { verify } = require("/workspace/notes/lint/units/cli/round2-oracle/proto-1b/eslint-side.cjs");
const RULES = ["no-debugger","no-dupe-keys","no-dupe-class-members","no-duplicate-case","no-empty-pattern","no-compare-neg-zero","use-isnan","valid-typeof","no-unsafe-negation","no-sparse-arrays","no-self-assign"];
let rules = RULES;
const args = process.argv.slice(2);
let cases = [];
if (args[0] === "--rules") { args.shift(); rules = args.shift().split(","); }
if (args[0] === "--file") { cases = JSON.parse(require("fs").readFileSync(args[1], "utf8")); }
else { const ext = args.shift(); cases = args.map(code => ({ code, ext })); }
for (const c of cases) {
  const r = verify(c.code, c.ext || "js", rules);
  const out = r.fatal ? [`FATAL ${r.fatal.line}:${r.fatal.column} ${r.fatal.message}`] : r.messages.map(m => `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId}: ${m.message}`);
  console.log(JSON.stringify(c.code) + ` [${r.ext}]` + (out.length ? "\n    " + out.join("\n    ") : "  (none)"));
}
