// SCRATCH of the research unit "ts-wrappers-eleven-rules": runs a probe binary (the planned `bun --lint`) over the
// fixtures of the tree and says which cases do not get their `expect`.
// usage: BUN_LINT_EXE=/tmp/tsw/out/tsentry node run-fixtures.cjs [--show] [--dir <fixtures dir>] [rule...]
// A case whose answer is now ESLint's (`eslint` of a case with `differs`) is counted as "now-eslint".
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const BUN = process.env.BUN_LINT_EXE || "/tmp/tsw/out/tsentry";
const args = process.argv.slice(2);
let show = false;
let dir = "/workspace/wt/cli/test/cli/lint/rules";
const rules = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = true;
	else if (a === "--dir") dir = args.shift();
	else rules.push(a);
}
const all = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
const LINE = /^(c\d+\.[a-z]+)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/;
const flat = t => t.replace(/\r\n?|\n/g, " ");
const extOf = c => c.ext || (c.jsx ? "jsx" : "js");
let total = 0, ok = 0, nowEslint = 0, wrong = 0;
for (const rule of rules.length ? rules : all) {
	const cases = JSON.parse(fs.readFileSync(path.join(dir, `${rule}.json`), "utf8"));
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tsw-fx-"));
	const names = cases.map((c, i) => `c${String(i).padStart(5, "0")}.${extOf(c)}`);
	const indexOf = new Map(names.map((n, i) => [n, i]));
	cases.forEach((c, i) => fs.writeFileSync(path.join(tmp, names[i]), c.code));
	const found = cases.map(() => []);
	for (let i = 0; i < names.length; i += 400) {
		const r = spawnSync(BUN, ["--lint", ...names.slice(i, i + 400)], { cwd: tmp, encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", NO_COLOR: "1" }, maxBuffer: 1 << 28 });
		if (r.status !== 0 && r.status !== 2) throw new Error(`probe ended with ${r.status} ${r.signal}\n${(r.stderr || "").slice(-3000)}`);
		for (const line of r.stderr.split("\n")) {
			if (!line) continue;
			const m = LINE.exec(line);
			if (!m || !indexOf.has(m[1])) throw new Error(`not a line of the plain format: ${JSON.stringify(line)}`);
			if (m[5] === rule || m[5] === "internal-error") found[indexOf.get(m[1])].push(`${m[2]}:${m[3]} ${m[6]}`);
			else if (m[4] === "error" && (m[5] === "syntax" || /^TS\d+$/.test(m[5]))) found[indexOf.get(m[1])].push(`SYNTAX ${m[5]} ${m[6]}`);
		}
	}
	fs.rmSync(tmp, { recursive: true, force: true });
	const t = { cases: cases.length, ok: 0, "now-eslint": 0, wrong: 0 };
	cases.forEach((c, i) => {
		const key = r => `${r.line}:${r.column} ${flat(r.message)}`;
		const want = c.expect.map(key);
		const got = found[i];
		if (JSON.stringify(want) === JSON.stringify(got)) return void t.ok++;
		const theirs = c.eslint ? [...new Set(c.eslint.map(key))] : null;
		if (theirs && JSON.stringify(theirs) === JSON.stringify(got)) {
			t["now-eslint"]++;
			if (show) console.log(`  now-eslint (${c.differs}): ${JSON.stringify(c.code)} [${extOf(c)}]\n      was: ${want.join(" | ") || "(none)"}\n      now: ${got.join(" | ") || "(none)"}`);
			return;
		}
		t.wrong++;
		console.log(`  WRONG: ${JSON.stringify(c.code)} [${extOf(c)}]${c.differs ? " differs=" + c.differs : ""}\n      expect: ${want.join(" | ") || "(none)"}\n      got:    ${got.join(" | ") || "(none)"}${theirs ? "\n      eslint: " + (theirs.join(" | ") || "(none)") : ""}`);
	});
	console.log(`${rule}: ${JSON.stringify(t)}`);
	total += t.cases; ok += t.ok; nowEslint += t["now-eslint"]; wrong += t.wrong;
}
console.log(`TOTAL ${JSON.stringify({ cases: total, ok, "now-eslint": nowEslint, wrong })}`);
