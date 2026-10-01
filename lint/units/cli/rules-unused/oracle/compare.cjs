// Research scratch of "rules-unused": the probe (probe/src/main.rs, the rule as planned, on bun's tree) against ESLint.
// usage: node compare.cjs [--probe /tmp/ru/nupcm] [--show N] [--json out.json] <list.json | --files files.txt | file>...
//   A list is an array of strings or { code, ext? } (default ext js), or the output of extract.cjs ({ valid, invalid }).
//   Prints every case where the two differ, then counts: same, missing (ESLint reports, the probe does not), extra, moved,
//   and the cases one of the parsers rejects.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { ask } = require("./nupcm-oracle.cjs");

const args = process.argv.slice(2);
let probe = "/tmp/ru/nupcm", show = 40, jsonOut = null;
const cases = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--probe") probe = args[++i];
	else if (a === "--show") show = Number(args[++i]);
	else if (a === "--json") jsonOut = args[++i];
	else if (a === "--files") for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) cases.push({ file: f });
	else if (a.endsWith(".json")) {
		const j = JSON.parse(fs.readFileSync(a, "utf8"));
		const list = Array.isArray(j) ? j : [...j.valid, ...j.invalid];
		for (const c of list) cases.push(typeof c === "string" ? { code: c, ext: "js" } : { code: c.code, ext: c.ext || "js" });
	} else cases.push({ file: a });
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nupcm-"));
cases.forEach((c, i) => {
	if (c.file) {
		c.code = fs.readFileSync(c.file, "utf8");
		c.ext = /\.d\.ts$/.test(c.file) ? "ts" : path.extname(c.file).slice(1);
		c.path = c.file;
	} else {
		c.path = path.join(dir, `c${String(i).padStart(5, "0")}.${c.ext}`);
		fs.writeFileSync(c.path, c.code);
	}
});
// The probe, 200 files a run.
const got = new Map();
for (let i = 0; i < cases.length; i += 200) {
	const batch = cases.slice(i, i + 200).map(c => c.path);
	let out = "";
	try {
		out = execFileSync(probe, batch, { encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
	} catch (e) {
		out = (e.stdout || "") + "\nCRASH\n";
	}
	let current = null;
	for (const line of out.split("\n")) {
		if (line.startsWith("== ")) { current = []; got.set(line.slice(3), current); }
		else if (line && current) current.push(line);
	}
}
const count = { same: 0, missing: 0, extra: 0, moved: 0, bunRejects: 0, eslintRejects: 0, bothReject: 0, noAnswer: 0, reports: 0 };
const differences = [];
for (const c of cases) {
	let eslint;
	try { eslint = ask(c.code, c.ext); } catch (e) { eslint = [`FATAL throw ${String(e.message).split("\n")[0]}`]; }
	const bun = got.get(c.path);
	const eslintFatal = eslint.length === 1 && eslint[0].startsWith("FATAL");
	const bunFatal = !bun || bun.includes("PARSE_ERROR") || bun.includes("CANNOT_READ_OR_INIT");
	let kind;
	if (!bun) kind = "noAnswer";
	else if (eslintFatal && bunFatal) kind = "bothReject";
	else if (eslintFatal) kind = "eslintRejects";
	else if (bunFatal) kind = "bunRejects";
	else {
		count.reports += eslint.length;
		const a = [...eslint].sort(), b = [...bun].sort();
		if (JSON.stringify(a) === JSON.stringify(b)) kind = "same";
		else {
			const onlyE = a.filter(x => !b.includes(x)), onlyB = b.filter(x => !a.includes(x));
			kind = onlyE.length && onlyB.length ? "moved" : onlyE.length ? "missing" : "extra";
		}
	}
	count[kind]++;
	if (kind !== "same" && kind !== "bothReject") differences.push({ kind, where: c.file || c.code, ext: c.ext, eslint, bun: bun || null });
}
for (const d of differences.slice(0, show)) console.log(`${d.kind} [${d.ext}] ${JSON.stringify(d.where)}\n    eslint: ${d.eslint.join(" | ") || "(none)"}\n    bun:    ${(d.bun || ["-"]).join(" | ") || "(none)"}`);
console.log(JSON.stringify({ cases: cases.length, ...count }));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(differences, null, "\t") + "\n");
fs.rmSync(dir, { recursive: true, force: true });
