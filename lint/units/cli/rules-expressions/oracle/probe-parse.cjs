// Research scratch. Which cases of the given lists `Parser::parse_for_lint` rejects, by the native probe (/tmp/rx/probe: probe/build.py).
// usage: node probe-parse.cjs <list.json>...
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
for (const f of process.argv.slice(2)) {
	const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
	const cases = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c)).filter(c => !(c.languageOptions && c.languageOptions.globals));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rx-probe-"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext || "js"}`);
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const run = spawnSync("/tmp/rx/probe", names, { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
	fs.rmSync(dir, { recursive: true, force: true });
	let current = null, rejected = 0, unmatched = 0;
	for (const line of run.stdout.split("\n")) {
		const m = /^== c(\d+)\./.exec(line);
		if (m) current = cases[Number(m[1])];
		else if (line.startsWith("PARSE_ERROR")) { rejected++; console.log("   rejected", JSON.stringify(current.code)); }
		else if (line.startsWith("UNMATCHED")) { unmatched++; console.log("   UNMATCHED record in", JSON.stringify(current.code), line); }
		else if (current && line.startsWith("  ") && !/^  (E|symbol) /.test(line) && !line.startsWith("S ")) console.log("     ", line.trim());
	}
	console.log(path.basename(f), cases.length, "rejected", rejected, "records that name no node of the walk", unmatched, run.status === 0 ? "" : `exit ${run.status} ${run.signal || ""}`);
}
