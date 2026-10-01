// Research scratch of "rules-static-evaluation". getStaticValue of eslint-utils 4.10.1 (the copy that ESLint at the pin runs) against
// the probe (/tmp/rse/probe sv, ../probe): one expression statement per case, or several in one file.
// usage: node static-values.cjs [--show] [--ts] <list.json>...     a list: an array of codes (each a file of expression statements)
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const { getStaticValue } = require("/workspace/ref/eslint/node_modules/@eslint-community/eslint-utils");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const show = process.argv.includes("--show");
const ts = process.argv.includes("--ts");
const bits = new DataView(new ArrayBuffer(8));
function canon(r) {
	if (r === null) return "none";
	const v = r.value;
	if (v === undefined) return "undefined";
	if (v === null) return "null";
	if (typeof v === "boolean") return String(v);
	if (typeof v === "number") {
		if (Number.isNaN(v)) return "number NaN";
		bits.setFloat64(0, v);
		return "number " + bits.getBigUint64(0).toString(16).padStart(16, "0");
	}
	if (typeof v === "bigint") return "bigint " + v;
	if (typeof v === "string") return "string " + Array.from({ length: v.length }, (_, i) => v.charCodeAt(i).toString(16).padStart(4, "0")).join("");
	if (v instanceof RegExp) return "regexp " + String(v);
	return "other";
}
let out;
const plugin = { rules: { sv: { create(context) { return { "Program:exit"(program) {
	program.body.forEach((stmt, index) => { if (stmt.type === "ExpressionStatement") out.push([index, canon(getStaticValue(stmt.expression, context.sourceCode.getScope(stmt)))]); });
} }; } } } };
function eslint(code) {
	out = [];
	const config = ts
		? [{ files: ["**/*.ts"], plugins: { p: plugin }, languageOptions: { parser: tsParser, sourceType: "module" }, rules: { "p/sv": "error" } }]
		: [{ plugins: { p: plugin }, languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "p/sv": "error" } }];
	let messages = linter.verify(code, config, ts ? { filename: "a.ts" } : undefined);
	if (messages.some(m => m.fatal) && !ts) { out = []; messages = linter.verify(code, [{ ...config[0], languageOptions: { ecmaVersion: "latest", sourceType: "module" } }]); }
	return messages.some(m => m.fatal) ? null : out;
}
let total = 0, same = 0;
const kinds = {};
for (const f of process.argv.slice(2).filter(a => a.endsWith(".json"))) {
	const cases = JSON.parse(fs.readFileSync(f, "utf8")).map(c => (typeof c === "string" ? c : c.code));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rse-sv-"));
	const names = cases.map((c, i) => `c${String(i).padStart(5, "0")}.${ts ? "ts" : "js"}`);
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c));
	const ours = cases.map(() => null);
	for (let from = 0; from < names.length; from += 300) {
		const run = spawnSync("/tmp/rse/probe", ["sv", ...names.slice(from, from + 300)], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
		for (const line of run.stdout.split("\n")) {
			let m = /^c(\d+)\.\w+: (OK|PARSE_ERROR)/.exec(line);
			if (m) { ours[Number(m[1])] = m[2] === "OK" ? [] : null; continue; }
			m = /^c(\d+)\.\w+#(\d+): (.*)$/.exec(line);
			if (m && ours[Number(m[1])]) ours[Number(m[1])].push([Number(m[2]), m[3]]);
		}
		if (run.status !== 0) console.log(`probe exit ${run.status} ${run.signal || ""} ${run.stderr.slice(0, 600)}`);
	}
	fs.rmSync(dir, { recursive: true, force: true });
	cases.forEach((c, i) => {
		const theirs = eslint(c);
		if (theirs === null || ours[i] === null) { console.log(`left out (${ours[i] === null ? "Bun" : "ESLint"} rejects): ${JSON.stringify(c)}`); return; }
		const mine = new Map(ours[i]);
		for (const [index, value] of theirs) {
			total++;
			const got = mine.get(index);
			if (got === value) { same++; if (show) console.log(`same    ${JSON.stringify(c)}#${index}: ${value}`); continue; }
			// "unknown": the probe has no value where upstream has one. "WRONG": the probe has another value than upstream.
			const kind = got === "none" ? (value === "other" ? "unknown-object" : "unknown") : (value === "none" ? "WRONG-extra" : "WRONG");
			kinds[kind] = (kinds[kind] || 0) + 1;
			if (kind !== "unknown-object" || show) { const lines = c.split("\n"); console.log(`${kind} ${JSON.stringify(lines.length > index && lines.length > 1 ? lines[index] : c + "#" + index)}\n    eslint-utils: ${value}\n    probe:        ${got}`); }
		}
	});
}
console.log(`all: values ${total}, same ${same}, differ ${total - same} ${JSON.stringify(kinds)}`);
