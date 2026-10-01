// Dry run of rules.test.ts.draft: the probe's reports printed as the plain format of the command line (sorted by file,
// start, end, code and text, an equal one once; a line break of a text as a space), then read as the test reads them.
// usage: node simulate-test.cjs [probe]
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const probe = process.argv[2] || "/tmp/c3final/out/lintprobe";
const unescape = t => t.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
let bad = 0;
for (const file of fs.readdirSync(path.join(__dirname, "fixtures")).sort()) {
	const rule = file.slice(0, -".json".length);
	const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8"));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.jsx ? "jsx" : "js"}`);
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	fs.writeFileSync(path.join(dir, "list"), names.map(n => path.join(dir, n)).join("\n") + "\n");
	const raw = execFileSync(probe, ["@" + path.join(dir, "list")], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" } });
	const all = [];
	for (const line of raw.split("\n")) {
		const p = line.split("\t");
		if (p.length < 6) continue;
		const [l, col] = p[3].split(":").map(Number);
		all.push({ name: path.basename(p[0]), start: +p[1], len: +p[2], line: l, column: col, code: p[4], text: unescape(p.slice(5).join("\t")) });
	}
	all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.start - b.start || a.start + a.len - (b.start + b.len) || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0)));
	const once = all.filter((d, i) => i === 0 || JSON.stringify(d) !== JSON.stringify(all[i - 1]));
	const stderr = once.map(d => `${d.name}(${d.line},${d.column}): error ${d.code}: ${d.text.replace(/[\r\n]/g, " ")}`).join("\n") + "\n";
	// From here on: the body of the test.
	const got = cases.map(() => []);
	const unexpected = [];
	for (const line of stderr.split("\n")) {
		const m = /^c(\d{4})\.jsx?\((\d+),(\d+)\): error ([^:]+): (.*)$/.exec(line);
		if (!m) {
			if (line) unexpected.push(line);
		} else if (m[4] === rule) got[+m[1]].push({ line: +m[2], column: +m[3], message: m[5] });
		else if (m[4] === "syntax" || m[4] === "internal-error") unexpected.push(line);
	}
	const printed = r => ({ ...r, message: r.message.replace(/[\r\n]/g, " ") });
	let wrong = 0;
	cases.forEach((c, i) => {
		if (JSON.stringify(got[i]) !== JSON.stringify(c.expect.map(printed))) {
			wrong += 1;
			if (wrong <= 3) console.log(`  ${rule}: ${JSON.stringify(c.code)}\n    got    ${JSON.stringify(got[i])}\n    expect ${JSON.stringify(c.expect)}`);
		}
	});
	bad += wrong + unexpected.length;
	console.log(`${rule}: ${cases.length} cases, ${wrong} wrong, ${unexpected.length} unexpected lines, ${once.length} lines of all rules, ${once.filter(d => d.code === rule).length} of this rule`);
	fs.rmSync(dir, { recursive: true, force: true });
}
console.log(bad === 0 ? "the fixtures are what the test would read" : `${bad} problems`);
