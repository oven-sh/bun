// Dry run of test/cli/lint/rules.test.ts as it is in the tree: the probe's reports written as the plain format of the
// command line (sorted by file, start, end, code and text, an equal one once; a line break of a text as a space), then
// read as the test reads them. The probe has the text of the research for every rule, not the modules of the tree.
// usage: node simulate.cjs <rule> <directory of the fixtures> <probe>
//   the test of <rule> over its own cases, then the test of every other rule, of which only the lines of <rule> are judged:
//   such a line is unexpected there when the case is not a case of <rule> too.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const [rule, rulesDir, probe] = process.argv.slice(2);
const rules = fs.readdirSync(rulesDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -".json".length)).sort();
const fixtures = Object.fromEntries(rules.map(r => [r, JSON.parse(fs.readFileSync(path.join(rulesDir, `${r}.json`), "utf8"))]));
const key = c => `${c.jsx ? "jsx" : "js"}:${c.code}`;
const keys = new Map(rules.map(r => [r, new Set(fixtures[r].map(key))]));
const unescape = t => t.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));

// What `bun --lint` would write to stderr for the cases, from the reports of the probe.
function lint(cases, names) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-"));
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
	return { rejected, once, stderr: once.map(d => `${d.name}(${d.line},${d.column}): error ${d.code}: ${d.text.replace(/\r\n?|\n/g, " ")}`).join("\n") + "\n" };
}

// The body of the test for `tested`. `judged`: the code whose lines are judged, or null for every line.
function test(tested, judged) {
	const cases = fixtures[tested];
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.jsx ? "jsx" : "js"}`);
	const indexOf = new Map(names.map((name, i) => [name, i]));
	const { rejected, once, stderr } = lint(cases, names);
	const expected = cases.map((c, i) => c.expect.map(r => `${names[i]}(${r.line},${r.column}): error ${tested}: ${r.message.replace(/\r\n?|\n/g, " ")}`));
	const received = cases.map(() => []);
	const unexpected = [];
	for (const line of stderr.split("\n").filter(Boolean)) {
		const [, name, category, code] = /^(c\d+\.jsx?)\(\d+,\d+\): (\w+) ([\w-]+): /.exec(line) ?? [];
		if (judged && code !== judged) continue;
		const index = indexOf.get(name);
		const other = keys.get(code);
		if (index === undefined) unexpected.push(line);
		else if (code === tested) received[index].push(line);
		else if (other ? !other.has(key(cases[index])) : !(category === "warning" && code === "syntax")) unexpected.push(`${line}    <- ${JSON.stringify(cases[index].code)}`);
	}
	const wrong = judged ? [] : cases.map((c, i) => ({ code: c.code, expected: expected[i], received: received[i] })).filter(c => JSON.stringify(c.received) !== JSON.stringify(c.expected));
	return { cases, rejected, once, unexpected, wrong };
}

let bad = 0;
{
	const { cases, rejected, once, unexpected, wrong } = test(rule, null);
	for (const w of wrong.slice(0, 5)) console.log(JSON.stringify(w));
	for (const u of unexpected.slice(0, 5)) console.log(u);
	const others = [...new Set(once.filter(d => d.code !== rule).map(d => d.code))].sort();
	const own = once.filter(d => d.code === rule).length;
	console.log(
		`${rule}: ${cases.length} cases, ${wrong.length} wrong, ${unexpected.length} unexpected lines, ${rejected} files that do not parse; ${own} lines of this rule, ${once.length - own} of other rules (${others.join(", ")}); exit code ${once.length ? 2 : 0}`,
	);
	bad += wrong.length + unexpected.length + rejected + (once.length ? 0 : 1);
}
for (const other of rules) {
	if (other === rule) continue;
	const { cases, once, unexpected } = test(other, rule);
	for (const u of unexpected.slice(0, 5)) console.log(u);
	console.log(`${other}: ${cases.length} cases, ${once.filter(d => d.code === rule).length} lines of ${rule}, ${unexpected.length} of them in a case that ${rule} does not have`);
	bad += unexpected.length;
}
process.exit(bad ? 1 : 0);
