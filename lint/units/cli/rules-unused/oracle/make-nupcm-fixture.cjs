// Research scratch of "rules-unused": the planned test/cli/lint/rules/no-unused-private-class-members.json.
// node make-nupcm-fixture.cjs [--probe /tmp/ru/nupcm2] > seed/no-unused-private-class-members.fixture.json
// The seed and cases/nupcm-in-targets-ts.json, without the cases that the lint parse of bun rejects; `expect` is ESLint's answer,
// and a case where the probe answers otherwise gets `differs` and `eslint` (none at the run of 2026-10-01).
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const { ask } = require("./nupcm-oracle.cjs");
const probe = process.argv.includes("--probe") ? process.argv[process.argv.indexOf("--probe") + 1] : "/tmp/ru/nupcm2";
const seed = require("../seed/no-unused-private-class-members.json");
const extra = require("../cases/nupcm-in-targets-ts.json").filter(c => !ask(c.code, c.ext).some(l => l.startsWith("FATAL"))).map(c => {
	const expect = ask(c.code, c.ext).map(line => { const m = /^(\d+):(\d+) (.*)$/s.exec(line); return { line: Number(m[1]), column: Number(m[2]), message: m[3] }; });
	return { code: c.code, ext: c.ext, expect };
});
const cases = [...seed, ...extra];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-"));
const files = cases.map((c, i) => { const f = path.join(dir, `c${String(i).padStart(5, "0")}.${c.ext || "js"}`); fs.writeFileSync(f, c.code); return f; });
const answers = new Map();
for (let i = 0; i < files.length; i += 200) {
	const out = execFileSync(probe, files.slice(i, i + 200), { encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
	let current = null;
	for (const line of out.split("\n")) { if (line.startsWith("== ")) { current = []; answers.set(line.slice(3), current); } else if (line && current) current.push(line); }
}
fs.rmSync(dir, { recursive: true, force: true });
const out = [];
let rejected = 0, differs = 0;
cases.forEach((c, i) => {
	const bun = answers.get(files[i]) || ["PARSE_ERROR"];
	if (bun.includes("PARSE_ERROR")) { rejected++; return; }
	const eslint = c.expect.map(r => `${r.line}:${r.column} ${r.message}`).sort();
	const mine = [...bun].sort();
	const item = { code: c.code };
	if (c.ext && c.ext !== "js") item.ext = c.ext;
	if (JSON.stringify(eslint) === JSON.stringify(mine)) item.expect = c.expect;
	else {
		differs++;
		item.expect = mine.map(line => { const m = /^(\d+):(\d+) (.*)$/s.exec(line); return { line: Number(m[1]), column: Number(m[2]), message: m[3] }; });
		item.differs = mine.length > eslint.length ? "extra" : mine.length < eslint.length ? "missing" : "moved";
		item.eslint = c.expect;
	}
	if (c.eslintTest) item.eslintTest = true;
	out.push(item);
});
process.stderr.write(JSON.stringify({ cases: out.length, rejectedByBun: rejected, differs, reports: out.reduce((n, c) => n + c.expect.length, 0), js: out.filter(c => !c.ext).length, ts: out.filter(c => c.ext === "ts").length, eslintTest: out.filter(c => c.eslintTest).length }) + "\n");
process.stdout.write("[\n" + out.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
