// Research scratch: which cases of a list the parser of a build of `bun --lint` rejects, and what the rules of that build say.
// usage: node bun-parse.cjs <bun-debug> <cases.json>...   a case: a string or { code, ext?, jsx? }; .js cases are written as .js (or .jsx)
// Prints one line per case that gets any line: the code and the lines. One run of the binary per list.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const [bun, ...lists] = process.argv.slice(2);
for (const list of lists) {
	const cases = JSON.parse(fs.readFileSync(list, "utf8"));
	const flat = Array.isArray(cases) ? cases : [...cases.valid, ...cases.invalid];
	const items = flat.map(c => (typeof c === "string" ? { code: c } : c));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rr-bun-"));
	const ext = c => c.ext || (c.jsx || (c.languageOptions && c.languageOptions.parserOptions && c.languageOptions.parserOptions.ecmaFeatures && c.languageOptions.parserOptions.ecmaFeatures.jsx) ? "jsx" : "js");
	const names = items.map((c, i) => `c${String(i).padStart(4, "0")}.${ext(c)}`);
	items.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const lines = items.map(() => []);
	for (let from = 0; from < names.length; from += 200) {
		const r = spawnSync(bun, ["--lint", ...names.slice(from, from + 200)], { cwd: dir, env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" }, encoding: "utf8", maxBuffer: 1 << 28 });
		for (const line of r.stderr.split("\n").filter(Boolean)) {
			const m = /^c(\d+)\.\w+\((\d+),(\d+)\): (.*)$/.exec(line);
			if (m) lines[Number(m[1])].push(`${m[2]},${m[3]}: ${m[4]}`);
			else console.log("OTHER", line);
		}
	}
	let n = 0;
	items.forEach((c, i) => { if (lines[i].length) { n++; console.log(JSON.stringify(c.code), ext(c), "\n     ", lines[i].join(" | ")); } });
	console.log(`${list}: ${items.length} cases, ${n} with a line`);
	fs.rmSync(dir, { recursive: true, force: true });
}
