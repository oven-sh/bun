// Dry run of test/cli/lint/rules.test.ts for one rule: the probe's reports written as the plain format of the command line
// (sorted by file, start, end, code and text, an equal one once; a line break of a text as a space), then read as the test reads them.
// usage: node simulate.cjs <rule> <directory of the fixtures> <probe>
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const [rule, rulesDir, probe] = process.argv.slice(2);
const rules = fs.readdirSync(rulesDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -".json".length)).sort();
const unescape = t => t.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
const cases = JSON.parse(fs.readFileSync(path.join(rulesDir, `${rule}.json`), "utf8"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-"));
const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.jsx ? "jsx" : "js"}`);
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
fs.writeFileSync(path.join(dir, "list"), names.map(n => path.join(dir, n)).join("\n") + "\n");
const raw = execFileSync(probe, ["@" + path.join(dir, "list")], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" } });
fs.rmSync(dir, { recursive: true, force: true });
const all = [];
let rejected = 0;
for (const line of raw.split("\n")) {
	const p = line.split("\t");
	if (p.length === 2 && p[1] !== "OK") rejected += 1;
	if (p.length < 6) continue;
	const [l, col] = p[3].split(":").map(Number);
	all.push({ name: path.basename(p[0]), start: +p[1], len: +p[2], line: l, column: col, code: p[4], text: unescape(p.slice(5).join("\t")) });
}
all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.start - b.start || a.start + a.len - (b.start + b.len) || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0)));
const once = all.filter((d, i) => i === 0 || JSON.stringify(d) !== JSON.stringify(all[i - 1]));
const stderr = once.map(d => `${d.name}(${d.line},${d.column}): error ${d.code}: ${d.text.replace(/\r\n?|\n/g, " ")}`).join("\n") + "\n";
// From here on: the body of the test.
const expected = cases.map((c, i) => c.expect.map(r => `${names[i]}(${r.line},${r.column}): error ${rule}: ${r.message.replace(/\r\n?|\n/g, " ")}`));
const received = cases.map(() => []);
const unexpected = [];
for (const line of stderr.split("\n").filter(Boolean)) {
	const [, name, category, code] = /^(c\d+\.jsx?)\(\d+,\d+\): (\w+) ([\w-]+): /.exec(line) ?? [];
	const lines = received[names.indexOf(name)];
	if (!lines) unexpected.push(line);
	else if (code === rule) lines.push(line);
	else if (!rules.includes(code) && !(category === "warning" && code === "syntax")) unexpected.push(line);
}
const wrong = cases.map((c, i) => ({ code: c.code, expected: expected[i], received: received[i] })).filter(c => JSON.stringify(c.received) !== JSON.stringify(c.expected));
for (const w of wrong.slice(0, 5)) console.log(JSON.stringify(w));
const others = [...new Set(once.filter(d => d.code !== rule).map(d => d.code))].sort();
console.log(
	`${rule}: ${cases.length} cases, ${wrong.length} wrong, ${unexpected.length} unexpected lines, ${rejected} files that do not parse; ${once.filter(d => d.code === rule).length} lines of this rule, ${once.filter(d => d.code !== rule).length} of other rules (${others.join(", ")})`,
);
process.exit(wrong.length || unexpected.length || rejected ? 1 : 0);
