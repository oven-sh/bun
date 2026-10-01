// DRAFT (see eslint-side.cjs). The cross-rule run, outside CI: ESLint with every rule that has a fixture, over the union of
// the cases of all fixtures, against every line of `bun --lint` for those cases.
// usage: node cross.cjs [--tree /workspace/wt/cli] [--bun path] [--answer core|plugin] [--show]
// The test of a rule passes over the lines of the other rules: here each (case, rule) pair is compared.
// A pair is `known` when the fixture of that rule holds the case with `differs`. Every other difference is printed, and the exit code is 1.
"use strict";
const fs = require("fs");
const path = require("path");
const { verify } = require("./eslint-side.cjs");
const { lint } = require("./bun-side.cjs");
const args = process.argv.slice(2);
let tree = "/workspace/wt/cli", bun, show = false, answer;
while (args.length) {
	const a = args.shift();
	if (a === "--tree") tree = args.shift();
	else if (a === "--bun") bun = args.shift();
	else if (a === "--answer") answer = args.shift();
	else if (a === "--show") show = true;
}
const dir = path.join(tree, "test/cli/lint/rules");
const rules = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
const extOf = c => c.ext || (c.jsx ? "jsx" : "js");
const union = new Map();
const known = new Set();
for (const rule of rules) {
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, `${rule}.json`), "utf8"))) {
		const key = `${extOf(c)}:${c.code}`;
		if (!union.has(key)) union.set(key, { code: c.code, ext: extOf(c), from: rule });
		if (c.differs) known.add(`${rule}\n${key}`);
	}
}
const cases = [...union.values()];
const flat = text => text.replace(/\r\n?|\n/g, " ");
(async () => {
	const files = cases.map((c, i) => ({ name: `c${String(i).padStart(5, "0")}.${c.ext}`, code: c.code }));
	const mine = await lint(files, { bun: bun || path.join(tree, "build/debug/bun-debug") });
	const tally = { pairs: 0, same: 0, known: 0, different: 0, "bun-rejects": 0, "eslint-rejects": 0, "no-such-rule-line": 0 };
	const perRule = {};
	cases.forEach((c, i) => {
		const r = verify(c.code, c.ext, rules, { plugin: answer === "plugin" });
		const b = mine.get(files[i].name);
		if (r.fatal || r.ext !== c.ext) return void (tally["eslint-rejects"] += 1);
		if (b.rejected) {
			tally["bun-rejects"] += 1;
			return void console.log(`bun-rejects: ${JSON.stringify(c.code)} [${c.ext}] ${b.rejected}`);
		}
		for (const line of b.reports) if (!rules.includes(line.code)) { tally["no-such-rule-line"] += 1; console.log(`a line of no rule with a fixture: ${JSON.stringify(c.code)} [${c.ext}] ${line.code}`); }
		for (const rule of rules) {
			const theirs = [...new Set(r.messages.filter(m => m.ruleId === rule).map(m => `${m.line}:${m.column} ${flat(m.message)}`))].sort();
			const ours = [...new Set(b.reports.filter(m => m.code === rule).map(m => `${m.line}:${m.column} ${m.message}`))].sort();
			if (!theirs.length && !ours.length) continue;
			tally.pairs += 1;
			if (JSON.stringify(theirs) === JSON.stringify(ours)) tally.same += 1;
			else if (known.has(`${rule}\n${c.ext}:${c.code}`)) tally.known += 1;
			else {
				tally.different += 1;
				perRule[rule] = (perRule[rule] || 0) + 1;
				if (show || tally.different <= 40) console.log(`different [${rule}] in a case of ${c.from}: ${JSON.stringify(c.code)} [${c.ext}]\n    eslint: ${theirs.join(" | ") || "(none)"}\n    bun:    ${ours.join(" | ") || "(none)"}`);
			}
		}
	});
	console.log(`${cases.length} cases, ${rules.length} rules: ` + JSON.stringify(tally) + " " + JSON.stringify(perRule));
	process.exit(tally.different || tally["bun-rejects"] || tally["no-such-rule-line"] ? 1 : 0);
})().catch(e => {
	console.error(String(e && e.stack || e));
	process.exit(1);
});
