// Differential check of the probe (Bun's parser and lexer, the proposed bun_lint modules) against ESLint at the pin.
// usage: node diff.cjs <rule> [--show] [--out vectors.json] [--probe path] [--eslint dir] <cases.json|cases.txt>...
// cases: a JSON array of strings or of { code, jsx?, sourceType? }, or a text file of snippets separated by `----` lines.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const rule = args.shift();
let show = false;
let out = null;
let probe = "/tmp/c3final/out/lintprobe";
let eslintDir = "/tmp/cmp-probe/eslint-pin";
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = true;
	else if (a === "--out") out = args.shift();
	else if (a === "--probe") probe = args.shift();
	else if (a === "--eslint") eslintDir = args.shift();
	else files.push(a);
}
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const linter = new Linter({ configType: "flat" });

const cases = [];
const seen = new Set();
for (const f of files) {
	const text = fs.readFileSync(f, "utf8");
	let list;
	if (f.endsWith(".json")) {
		const parsed = JSON.parse(text);
		// ESLint's own test cases (extract.cjs): { valid, invalid }, each with the language options of the case.
		const flat = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
		list = flat.map(c => (typeof c === "string" ? { code: c } : c)).map(c => {
			const o = c.languageOptions;
			if (!o) return c;
			// A case that configures globals, or an edition before 2015, is not a case of the defaults.
			if (o.globals || (typeof o.ecmaVersion === "number" && o.ecmaVersion < 6)) return {};
			return { code: c.code, sourceType: o.sourceType, jsx: !!(o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx) };
		});
	} else list = text.split(/^----\n/m).map(s => ({ code: s.replace(/\n$/, "") }));
	for (const c of list) {
		if (typeof c.code !== "string") continue;
		const key = (c.jsx ? "J" : "") + (c.sourceType || "") + c.code;
		if (seen.has(key)) continue;
		seen.add(key);
		cases.push({ code: c.code, jsx: !!c.jsx, sourceType: c.sourceType });
	}
}

function eslint(c, sourceType) {
	return linter.verify(c.code, [
		{
			languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: c.jsx } } },
			rules: { [rule]: "error" },
		},
	]);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsu-diff-"));
const list = [];
cases.forEach((c, i) => {
	c.file = path.join(dir, `c${i}.${c.jsx ? "jsx" : "js"}`);
	fs.writeFileSync(c.file, c.code);
	list.push(c.file);
	// Without a stated kind: the first of script, module, script with JSX, module with JSX that ESLint's parser takes.
	let type = c.sourceType || "script";
	let messages = eslint(c, type);
	if (!c.sourceType && messages.some(m => m.fatal)) {
		for (const [t, jsx] of [["module", c.jsx], ["script", true], ["module", true]]) {
			const other = eslint({ code: c.code, jsx }, t);
			if (!other.some(m => m.fatal)) {
				messages = other;
				type = t;
				c.jsx = jsx;
				break;
			}
		}
	}
	c.type = type;
	c.fatal = messages.find(m => m.fatal) || null;
	c.eslint = messages
		.filter(m => !m.fatal)
		.map(m => ({ line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, message: m.message }));
});
fs.writeFileSync(path.join(dir, "list"), list.join("\n") + "\n");
const raw = execFileSync(probe, ["@" + path.join(dir, "list")], { encoding: "utf8", maxBuffer: 1 << 28 });
// The probe writes a line break of a text as `\\n` and a backslash as two.
const unescape = t => t.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
const byFile = new Map();
for (const line of raw.split("\n")) {
	if (!line) continue;
	const parts = line.split("\t");
	if (!byFile.has(parts[0])) byFile.set(parts[0], { parse: null, reports: [] });
	const entry = byFile.get(parts[0]);
	if (parts.length === 2) entry.parse = parts[1];
	else if (parts[4] === rule || parts[4] === "internal-error") {
		const [l, col] = parts[3].split(":").map(Number);
		entry.reports.push({ line: l, column: col, start: Number(parts[1]), length: Number(parts[2]), message: unescape(parts.slice(5).join("\t")), code: parts[4] });
	}
}
fs.rmSync(dir, { recursive: true, force: true });

const tally = { same: 0, merged: 0, moved: 0, missing: 0, "other-text": 0, extra: 0, "bun-rejects": 0, "eslint-rejects": 0, "both-reject": 0 };
const vectors = [];
const details = [];
for (const c of cases) {
	const bun = byFile.get(c.file) || { parse: "NONE", reports: [] };
	let kind;
	if (bun.parse !== "OK" && c.fatal) kind = "both-reject";
	else if (bun.parse !== "OK") kind = "bun-rejects";
	else if (c.fatal) kind = "eslint-rejects";
	else {
		const key = m => `${m.line}:${m.column} ${m.message}`;
		const theirs = c.eslint.map(key).sort();
		const ours = bun.reports.map(key).sort();
		const theirSet = [...new Set(theirs)];
		const ourSet = [...new Set(ours)];
		if (JSON.stringify(theirs) === JSON.stringify(ours)) kind = "same";
		else if (JSON.stringify(theirSet) === JSON.stringify(ourSet)) kind = "merged";
		else {
			const texts = l => l.map(k => k.slice(k.indexOf(" ") + 1)).sort();
			if (JSON.stringify(texts(theirSet)) === JSON.stringify(texts(ourSet))) kind = "moved";
			else if (ourSet.every(k => theirSet.includes(k))) kind = "missing";
			// As many reports, with another place and another text: the name in a message is read from the source.
			else if (ourSet.length === theirSet.length) kind = "other-text";
			else kind = "extra";
		}
	}
	tally[kind] += 1;
	if (kind !== "same" && kind !== "both-reject") {
		details.push(
			`${kind}: ${JSON.stringify(c.code)}${c.jsx ? " [jsx]" : ""} [${c.type}]\n    eslint: ${
				c.fatal ? "FATAL " + c.fatal.message : c.eslint.map(m => `${m.line}:${m.column} ${m.message}`).join(" | ") || "(none)"
			}\n    bun:    ${bun.parse !== "OK" ? bun.parse : bun.reports.map(m => `${m.line}:${m.column} ${m.message}`).join(" | ") || "(none)"}`,
		);
	}
	const v = { code: c.code, sourceType: c.type };
	if (c.jsx) v.jsx = true;
	v.eslint = c.fatal ? null : c.eslint;
	v.expect = bun.parse !== "OK" ? null : bun.reports.map(({ code, ...rest }) => (code === rule ? rest : { ...rest, code }));
	if (kind !== "same") v.differs = kind;
	vectors.push(v);
}
console.log(`${rule}: ${cases.length} cases: ` + Object.entries(tally).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", "));
if (show) for (const d of details) console.log(d);
if (out) fs.writeFileSync(out, JSON.stringify(vectors, null, "\t") + "\n");
