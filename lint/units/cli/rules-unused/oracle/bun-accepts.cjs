// Research scratch of "rules-unused": which cases of a list the lint parse of bun takes (a probe prints PARSE_ERROR for the others).
// usage: node bun-accepts.cjs [--probe /tmp/ru/nupcm] <list.json>...   prints the rejected cases and a count.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const args = process.argv.slice(2);
let probe = "/tmp/ru/nupcm";
const lists = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--probe") probe = args[++i]; else lists.push(args[i]);
for (const list of lists) {
	const j = JSON.parse(fs.readFileSync(list, "utf8"));
	const cases = (Array.isArray(j) ? j : [...j.valid, ...j.invalid]).map(c => (typeof c === "string" ? { code: c, ext: "js" } : { code: c.code, ext: c.ext || (c.jsx ? "jsx" : "js") }));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accepts-"));
	const files = cases.map((c, i) => { const f = path.join(dir, `c${String(i).padStart(5, "0")}.${c.ext}`); fs.writeFileSync(f, c.code); return f; });
	let rejected = 0, answered = 0;
	for (let i = 0; i < files.length; i += 200) {
		let out = "";
		try { out = execFileSync(probe, files.slice(i, i + 200), { encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { out = (e.stdout || "") + "\nCRASH\n"; console.log("probe ended badly in a batch"); }
		let current = null;
		for (const line of out.split("\n")) {
			if (line.startsWith("== ")) { current = line.slice(3); answered++; }
			else if (line === "PARSE_ERROR") { rejected++; const c = cases[files.indexOf(current)]; console.log(`REJECTED [${c.ext}] ${JSON.stringify(c.code).slice(0, 220)}`); }
		}
	}
	fs.rmSync(dir, { recursive: true, force: true });
	console.log(JSON.stringify({ list: path.basename(list), cases: cases.length, answered, rejected }));
}
