// Research scratch: the probe of ../probe (Parser::parse_for_lint) over lists of cases: which do not parse, and which
// wrapper records name an operand that the walk does not reach (UNMATCHED).
// usage: node probe-all.cjs [--probe /tmp/rx/probe] <cases.json | answers.jsonl>...
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
let probe = "/tmp/rx/probe";
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--probe") probe = args.shift();
	else files.push(a);
}
const cases = [];
const seen = new Set();
for (const f of files) {
	const text = fs.readFileSync(f, "utf8");
	let list;
	if (f.endsWith(".jsonl")) list = text.split("\n").filter(Boolean).map(l => JSON.parse(l));
	else {
		const parsed = JSON.parse(text);
		list = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
	}
	for (const raw of list) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		if (c.skip || seen.has(ext + c.code)) continue;
		seen.add(ext + c.code);
		cases.push({ code: c.code, ext, fatal: c.fatal });
	}
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-all-"));
const names = cases.map((c, i) => `c${String(i).padStart(5, "0")}.${c.ext}`);
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
const tally = { cases: cases.length, parse_error: 0, unmatched: 0, records: 0 };
for (let from = 0; from < names.length; from += 400) {
	const run = spawnSync(probe, names.slice(from, from + 400), { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
	if (run.error) throw run.error;
	if (run.status !== 0) console.log(`exit ${run.status} signal ${run.signal}: ${run.stderr.slice(0, 600)}`);
	let current = null;
	for (const line of run.stdout.split("\n")) {
		const m = /^== (c\d+)\./.exec(line);
		if (m) current = cases[Number(m[1].slice(1))];
		else if (line.startsWith("PARSE_ERROR")) {
			tally.parse_error++;
			console.log(`PARSE_ERROR [${current.ext}] ${JSON.stringify(current.code)}${current.fatal ? "   (ESLint too)" : ""}`);
		} else if (line.startsWith("UNMATCHED")) {
			tally.unmatched++;
			console.log(`${line}   in [${current.ext}] ${JSON.stringify(current.code)}`);
		} else if (line.startsWith("records=")) tally.records += Number(/records=(\d+)/.exec(line)[1]);
	}
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(tally));
