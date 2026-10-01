// Makes test/cli/lint/rules/<rule>.json: the cases of the given lists, with what `bun --lint` prints for the rule as `expect`
// and, where ESLint at the pin answers otherwise, `differs` and ESLint's answer in `eslint`.
// usage: node make-fixture.cjs <rule> --bun <path of bun-debug> [--out <file>] [--keep <fixture.json>] <list>...
// A list: a JSON array of codes or of { code, jsx? }; { valid, invalid } of extract.cjs (its cases get eslintTest);
//         or a .jsonl of cross.cjs --json (only its lines of <rule> are taken).
// --keep: the cases of a fixture that exists stay, in their order, before the new ones.
// Left out, and named on stderr: a case that sets globals or an edition before 2015, and a case that a parser rejects.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });

const args = process.argv.slice(2);
const rule = args.shift();
let bun = null;
let out = null;
const lists = [];
const keep = [];
while (args.length) {
	const a = args.shift();
	if (a === "--bun") bun = args.shift();
	else if (a === "--out") out = args.shift();
	else if (a === "--keep") keep.push(args.shift());
	else lists.push(a);
}
if (!rule || !bun) {
	console.error("usage: node make-fixture.cjs <rule> --bun <bun-debug> [--out file] [--keep fixture.json] <list>...");
	process.exit(1);
}

const cases = [];
const seen = new Map();
function add(code, jsx, eslintTest) {
	if (typeof code !== "string") return;
	const key = (jsx ? "jsx:" : "js:") + code;
	const known = seen.get(key);
	if (known) {
		if (eslintTest) known.eslintTest = true;
		return;
	}
	const c = { code, jsx: !!jsx, eslintTest: !!eslintTest };
	seen.set(key, c);
	cases.push(c);
}
for (const f of keep) for (const c of JSON.parse(fs.readFileSync(f, "utf8"))) add(c.code, c.jsx, c.eslintTest);
for (const f of lists) {
	const text = fs.readFileSync(f, "utf8");
	if (f.endsWith(".jsonl")) {
		for (const line of text.split("\n").filter(Boolean)) {
			const c = JSON.parse(line);
			if (!c.rule || c.rule === rule) add(c.code, c.jsx, false);
		}
		continue;
	}
	const parsed = JSON.parse(text);
	const own = !Array.isArray(parsed);
	for (const raw of own ? [...parsed.valid, ...parsed.invalid] : parsed) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		const o = c.languageOptions || {};
		if (o.globals || (typeof o.ecmaVersion === "number" && o.ecmaVersion < 6)) {
			console.error(`left out, not a case of the defaults: ${JSON.stringify(c.code)}`);
			continue;
		}
		add(c.code, c.jsx || !!(o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx), own);
	}
}

// ESLint: the first of script, module, then the same with JSX, that its parser takes. A case that is not JSX stays a .js file.
function eslint(c) {
	for (const [type, jsx] of [["script", c.jsx], ["module", c.jsx]]) {
		const messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType: type, parserOptions: { ecmaFeatures: { jsx } } }, rules: { [rule]: "error" } }]);
		if (!messages.some(m => m.fatal)) return messages.map(m => ({ line: m.line, column: m.column, message: m.message }));
	}
	return null;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "make-fixture-"));
const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.jsx ? "jsx" : "js"}`);
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
const byName = new Map(names.map((n, i) => [n, i]));
const ours = cases.map(() => []);
const rejected = new Set();
// At most 200 files in one run: the command line stays short.
for (let from = 0; from < names.length; from += 200) {
	const run = spawnSync(bun, ["--lint", ...names.slice(from, from + 200)], {
		cwd: dir,
		env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" },
		encoding: "utf8",
		maxBuffer: 1 << 28,
	});
	if (run.error) throw run.error;
	for (const line of run.stderr.split("\n")) {
		const m = /^(c\d+\.jsx?)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
		if (!m) continue;
		const index = byName.get(m[1]);
		if (index === undefined) continue;
		if (m[5] === "syntax" && m[4] === "error") rejected.add(index);
		else if (m[5] === rule) ours[index].push({ line: Number(m[2]), column: Number(m[3]), message: m[6] });
	}
}
fs.rmSync(dir, { recursive: true, force: true });

const tally = { same: 0, moved: 0, missing: 0, extra: 0, "other-text": 0 };
const fixture = [];
cases.forEach((c, i) => {
	const theirs = eslint(c);
	if (theirs === null || rejected.has(i)) {
		console.error(`left out, ${theirs === null ? "ESLint's parser" : "Bun's parser"} rejects: ${JSON.stringify(c.code)}`);
		return;
	}
	const key = m => `${m.line}:${m.column} ${m.message.replace(/\r\n?|\n/g, " ")}`;
	const a = [...new Set(theirs.map(key))].sort();
	const b = [...new Set(ours[i].map(key))].sort();
	const texts = l => l.map(k => k.slice(k.indexOf(" ") + 1)).sort();
	let kind = "same";
	if (JSON.stringify(a) !== JSON.stringify(b)) {
		if (JSON.stringify(texts(a)) === JSON.stringify(texts(b))) kind = "moved";
		else if (b.every(k => a.includes(k))) kind = "missing";
		else if (a.every(k => b.includes(k))) kind = "extra";
		else kind = "other-text";
	}
	tally[kind] += 1;
	const entry = { code: c.code };
	if (c.jsx) entry.jsx = true;
	entry.expect = ours[i];
	if (kind !== "same") {
		entry.differs = kind;
		entry.eslint = theirs;
		console.error(`${kind}: ${JSON.stringify(c.code)}\n    eslint: ${a.join(" | ") || "(none)"}\n    bun:    ${b.join(" | ") || "(none)"}`);
	}
	if (c.eslintTest) entry.eslintTest = true;
	fixture.push(entry);
});
const text = "[\n" + fixture.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n";
if (out) fs.writeFileSync(out, text);
else process.stdout.write(text);
console.error(`${rule}: ${fixture.length} cases, ${fixture.filter(c => c.expect.length).length} with a report: ` + Object.entries(tally).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", "));
