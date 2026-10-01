// Research probe of pass 1b: ESLint at the pin for one rule over case lists, and which of the files the debug build of `bun --lint` rejects or reports on.
// usage: [BUN_DEBUG_BIN=<bun-debug>] node oracle.cjs <rule> [--ts --ext ts|tsx] [--tag name] <cases.json>...   writes /tmp/rs1b/out/<rule>[.<tag>][.<ext>].json; node show.cjs <that file> prints one line per case.
// The answers beside this file: ts-<rule>.txt (typescript-eslint parser 8.58.2), js-for-direction-static-values.txt, the two cross lists (cross.cjs, cross2.cjs).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const args = process.argv.slice(2);
const rule = args.shift();
let ext = "js";
let useTs = false;
let tag = "";
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--ext") ext = args.shift();
	else if (a === "--ts") useTs = true;
	else if (a === "--tag") tag = args.shift();
	else files.push(a);
}
const BUN = process.env.BUN_DEBUG_BIN || "/workspace/wt/parser/build/debug/bun-debug";
const eslintDir = "/workspace/ref/eslint";
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const linter = new Linter({ configType: "flat" });
let tsParser = null;
if (useTs) tsParser = require(require.resolve("@typescript-eslint/parser", { paths: ["/workspace/ref/tseslint"] }));

const cases = [];
const seen = new Set();
for (const f of files) {
	const text = fs.readFileSync(f, "utf8");
	let list;
	if (f.endsWith(".json")) {
		const parsed = JSON.parse(text);
		const flat = Array.isArray(parsed) ? parsed : [...parsed.valid.map(c => ({ ...c, kind: "valid" })), ...parsed.invalid.map(c => ({ ...c, kind: "invalid" }))];
		list = flat
			.map(c => (typeof c === "string" ? { code: c } : c))
			.map(c => {
				const o = c.languageOptions;
				if (!o) return c;
				if (o.globals || (typeof o.ecmaVersion === "number" && o.ecmaVersion < 6)) return { dropped: c.code };
				return { code: c.code, kind: c.kind, sourceType: o.sourceType, jsx: !!(o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx) };
			});
	} else list = text.split(/^----\n/m).map(s => ({ code: s.replace(/\n$/, "") }));
	for (const c of list) {
		if (typeof c.code !== "string") {
			if (c.dropped) console.log("dropped (globals or old edition): " + JSON.stringify(c.dropped));
			continue;
		}
		const key = (c.jsx ? "J" : "") + (c.sourceType || "") + c.code;
		if (seen.has(key)) continue;
		seen.add(key);
		cases.push({ code: c.code, jsx: !!c.jsx, sourceType: c.sourceType, kind: c.kind });
	}
}

function eslint(c, sourceType) {
	const languageOptions = useTs
		? { parser: tsParser, ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: c.jsx || ext === "tsx" } } }
		: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: c.jsx } } };
	return linter.verify(c.code, [{ files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"], languageOptions, rules: { [rule]: "error" } }], { filename: useTs ? `file.${ext}` : undefined });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs1b-"));
const names = [];
cases.forEach((c, i) => {
	let type = c.sourceType || "script";
	let messages = eslint(c, type);
	if (!c.sourceType && messages.some(m => m.fatal)) {
		for (const [t, jsx] of [["module", c.jsx], ["script", true], ["module", true]]) {
			if (useTs && jsx && !c.jsx) continue;
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
	c.eslint = messages.filter(m => !m.fatal).map(m => ({ line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, message: m.message }));
	c.name = `c${String(i).padStart(4, "0")}.${c.jsx && ext === "js" ? "jsx" : ext}`;
	fs.writeFileSync(path.join(dir, c.name), c.code);
	names.push(c.name);
});

const run = spawnSync(BUN, ["--lint", ...names], {
	cwd: dir,
	env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", ASAN_OPTIONS: "detect_leaks=0" },
	encoding: "utf8",
	maxBuffer: 1 << 28,
});
const byName = new Map(names.map(n => [n, []]));
for (const line of (run.stderr || "").split("\n")) {
	const m = /^(c\d+\.[a-z]+)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
	if (m) byName.get(m[1]).push({ line: +m[2], column: +m[3], category: m[4], code: m[5], message: m[6] });
	else if (line.trim()) (byName.get("_") || byName.set("_", []).get("_")).push(line);
}
fs.rmSync(dir, { recursive: true, force: true });

const out = [];
const tally = { ok: 0, "eslint-rejects": 0, "bun-rejects": 0, "both-reject": 0 };
for (const c of cases) {
	const bun = byName.get(c.name);
	const syntax = bun.filter(r => r.category === "error" && (r.code === "syntax" || /^TS\d+$/.test(r.code)));
	const others = bun.filter(r => !syntax.includes(r));
	const kind = syntax.length && c.fatal ? "both-reject" : syntax.length ? "bun-rejects" : c.fatal ? "eslint-rejects" : "ok";
	tally[kind] += 1;
	out.push({
		code: c.code,
		kind: c.kind,
		sourceType: c.type,
		jsx: c.jsx || undefined,
		eslint: c.fatal ? null : c.eslint,
		eslintFatal: c.fatal ? `${c.fatal.line}:${c.fatal.column} ${c.fatal.message}` : undefined,
		bunSyntax: syntax.length ? syntax.map(r => `${r.line}:${r.column} ${r.code} ${r.message}`) : undefined,
		bunOther: others.length ? others.map(r => `${r.line}:${r.column} ${r.category} ${r.code}: ${r.message}`) : undefined,
		parse: kind,
	});
}
fs.mkdirSync("/tmp/rs1b/out", { recursive: true });
const outFile = `/tmp/rs1b/out/${rule}${tag ? "." + tag : ""}${ext === "js" ? "" : "." + ext}.json`;
fs.writeFileSync(outFile, JSON.stringify(out, null, "\t") + "\n");
console.log(`${rule}: ${cases.length} cases: ` + Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ") + ` -> ${outFile}; bun exit ${run.status}${byName.get("_") ? "; unparsed stderr lines " + byName.get("_").length : ""}`);
if (byName.get("_")) console.log(byName.get("_").slice(0, 5).join("\n"));
