// Research scratch: the code path events of ESLint at the pin against those of the mapping of cpaprobe on Bun's tree.
// usage: node diff.cjs --cases corpus.json [--kind js|ts] [--rule name] [--limit n] [--show n] [--probe bin]
//        node diff.cjs --files a.js b.ts ...
// Prints one line per source that differs (first event that differs), and the counts.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { replayAll } = require("./replay.cjs");
const { oracle } = require("./oracle.cjs");
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const probe = opt("--probe") || "/tmp/wocp/cpaprobe";
const show = Number(opt("--show") || 40);
let cases = [];
if (opt("--cases")) {
	cases = JSON.parse(fs.readFileSync(opt("--cases"), "utf8"));
	if (opt("--kind")) cases = cases.filter(c => c.kind === opt("--kind"));
	if (opt("--rule")) cases = cases.filter(c => c.rule === opt("--rule"));
	if (opt("--limit")) cases = cases.slice(0, Number(opt("--limit")));
} else {
	const at = args.indexOf("--files");
	for (const file of args.slice(at + 1)) {
		cases.push({ rule: file, code: fs.readFileSync(file, "utf8"), kind: /\.tsx?$/u.test(file) ? "ts" : "js", jsx: !/\.ts$/u.test(file), file });
	}
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-diff-"));
const names = cases.map((c, i) => {
	const ext = c.kind === "ts" ? (c.jsx ? "tsx" : "ts") : "js";
	return `c${String(i).padStart(5, "0")}.${ext}`;
});
cases.forEach((c, i) => fs.writeFileSync(path.join(tmp, names[i]), c.code));
const results = new Map();
for (let from = 0; from < names.length; from += 400) {
	const run = spawnSync(probe, names.slice(from, from + 400), {
		cwd: tmp,
		env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" },
		encoding: "utf8",
		maxBuffer: 1 << 30,
	});
	if (run.status !== 0) console.log(`probe exit ${run.status} ${run.signal} at ${from}: ${String(run.stderr).slice(0, 1500)}`);
	for (const [k, v] of replayAll(run.stdout)) results.set(k, v);
}
fs.rmSync(tmp, { recursive: true, force: true });
const count = { same: 0, differ: 0, bothReject: 0, onlyBunRejects: 0, onlyEslintRejects: 0, replayError: 0, missing: 0 };
let shown = 0;
const byRule = {};
cases.forEach((c, i) => {
	const bun = results.get(names[i]);
	const es = oracle(c.code, { ts: c.kind === "ts", jsx: c.kind === "ts" ? c.jsx : true, sourceType: c.sourceType });
	let what;
	if (!bun) what = "missing";
	else if (bun.error && bun.error.startsWith("replay")) what = "replayError";
	else if (bun.error && es.error) what = "bothReject";
	else if (bun.error) what = "onlyBunRejects";
	else if (es.error) what = "onlyEslintRejects";
	else if (JSON.stringify(bun.events) === JSON.stringify(es.events) && JSON.stringify(bun.arrows) === JSON.stringify(es.arrows)) what = "same";
	else what = "differ";
	count[what]++;
	if (what === "differ" || what === "replayError" || what === "missing") {
		byRule[c.rule] = (byRule[c.rule] || 0) + 1;
		if (shown++ < show) {
			let at = 0;
			if (what === "differ") while (at < bun.events.length && bun.events[at] === es.events[at]) at++;
			console.log(`${what.toUpperCase()} [${c.rule}] ${names[i]} ${JSON.stringify(c.code.length > 300 ? c.code.slice(0, 300) + "..." : c.code)}`);
			if (what === "differ") {
				console.log(`   event ${at}: eslint ${es.events[at]} | bun ${bun.events[at]}   (arrows ${JSON.stringify(bun.arrows) === JSON.stringify(es.arrows) ? "same" : "differ"})`);
				if (args.includes("--arrows")) console.log(`   eslint ${JSON.stringify(es.arrows)}\n   bun    ${JSON.stringify(bun.arrows)}`);
			} else if (bun) console.log(`   ${bun.error.split("\n").slice(0, 4).join(" | ")}`);
		}
	}
	if (args.includes("--rejects") && (what === "onlyBunRejects" || what === "onlyEslintRejects")) {
		console.log(`${what} [${c.rule}] ${JSON.stringify(c.code.slice(0, 200))}  ${(bun.error || es.error).split("\n").slice(0, 2).join(" | ")}`);
	}
});
console.log(JSON.stringify(count), Object.keys(byRule).length ? JSON.stringify(byRule) : "");
