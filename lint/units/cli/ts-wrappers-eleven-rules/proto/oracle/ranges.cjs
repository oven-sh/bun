// SCRATCH of the research unit "ts-wrappers-eleven-rules": checks `Context::node_start` and `Context::node_end` of the planned
// code against the ranges of the nodes of ESLint's parsers. The probe (PROBE_RANGES=1) prints, for every expression of the
// walk, where the node that ESLint has in its place starts and ends; each such range has to be the range of a node of
// espree (JavaScript) or of typescript-estree (TypeScript).
// usage: node ranges.cjs [--show N] <file | cases.json>...     a .json is a list of cases ({ code, ext?, jsx? }) or a fixture
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ESLINT_DIR = "/workspace/ref/eslint";
const TSESLINT_DIR = "/workspace/ref/tseslint";
const BUN = process.env.BUN_LINT_EXE || "/tmp/w1b-topdown/out/tsentry";
const espree = require(path.join(ESLINT_DIR, "node_modules/espree"));
const tsParser = require("module").createRequire(TSESLINT_DIR + "/")("@typescript-eslint/parser");
const TS = new Set(["ts", "tsx", "mts", "cts"]);

const args = process.argv.slice(2);
let show = 40;
const inputs = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = Number(args.shift());
	else inputs.push(a);
}
// Every input becomes { name, ext, code }.
const files = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w1b-ranges-"));
for (const input of inputs) {
	if (input.endsWith(".json")) {
		const parsed = JSON.parse(fs.readFileSync(input, "utf8"));
		const list = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
		list.forEach((c, i) => {
			if (typeof c === "string") c = { code: c };
			const ext = c.ext || (c.jsx ? "jsx" : "js");
			const name = path.join(tmp, `${path.basename(input, ".json").replace(/\W/g, "_")}_${String(i).padStart(5, "0")}.${ext}`);
			fs.writeFileSync(name, c.code);
			files.push({ name, ext, code: c.code });
		});
	} else {
		files.push({ name: path.resolve(input), ext: input.split(".").pop(), code: fs.readFileSync(input, "utf8") });
	}
}

function estreeRanges(file) {
	let ast = null;
	if (TS.has(file.ext)) {
		try {
			ast = tsParser.parse(file.code, { range: true, ecmaFeatures: { jsx: file.ext === "tsx" }, filePath: `x.${file.ext}` });
		} catch (e) {
			return null;
		}
	} else {
		for (const [sourceType, jsx] of [["module", file.ext !== "mjs" && file.ext !== "cjs"], ["script", true], ["commonjs", true]]) {
			try {
				ast = espree.parse(file.code, { ecmaVersion: "latest", sourceType, range: true, ecmaFeatures: { jsx } });
				break;
			} catch (e) {}
		}
		if (!ast) return null;
	}
	const ranges = new Map();
	const seen = new Set();
	(function walk(node) {
		if (!node || typeof node !== "object" || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) return void node.forEach(walk);
		if (typeof node.type === "string" && Array.isArray(node.range)) {
			const key = `${node.range[0]}-${node.range[1]}`;
			if (!ranges.has(key)) ranges.set(key, node.type);
		}
		for (const k of Object.keys(node)) if (k !== "parent" && k !== "tokens" && k !== "comments") walk(node[k]);
	})(ast);
	return ranges;
}

// Byte offsets of the probe to the UTF-16 offsets of the parsers.
function byteToUnit(code) {
	if (!/[^\x00-\x7f]/.test(code)) return null;
	const map = [];
	let unit = 0;
	for (const ch of code) {
		const bytes = Buffer.byteLength(ch);
		for (let i = 0; i < bytes; i++) map.push(unit);
		unit += ch.length;
	}
	map.push(unit);
	return map;
}

const byName = new Map(files.map(f => [f.name, f]));
const tally = { files: 0, skipped: 0, exprs: 0, ok: 0, noEnd: 0, bad: 0 };
const classes = new Map();
const examples = [];
for (let i = 0; i < files.length; i += 200) {
	const chunk = files.slice(i, i + 200);
	const r = spawnSync(BUN, chunk.map(f => f.name), { encoding: "utf8", env: { ...process.env, PROBE_RANGES: "1", ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 30 });
	if (r.status !== 0 && r.status !== 2) throw new Error(`probe ended with ${r.status} ${r.signal}\n${(r.stderr || "").slice(-2000)}`);
	let file = null;
	let ranges = null;
	let map = null;
	for (const line of r.stdout.split("\n")) {
		if (line.startsWith("F\t")) {
			file = byName.get(line.slice(2));
			ranges = file ? estreeRanges(file) : null;
			map = file ? byteToUnit(file.code) : null;
			if (ranges) tally.files++;
			else tally.skipped++;
			continue;
		}
		if (!line.startsWith("R\t") || !ranges) continue;
		const [, tag, op, wrapper, loc, start, end] = line.split("\t");
		if (tag === "e_missing") continue;
		tally.exprs++;
		if (end === "-1") {
			tally.noEnd++;
			const k = `NO-END ${tag} ${op} ${wrapper}`;
			classes.set(k, (classes.get(k) || 0) + 1);
			if (examples.length < show) examples.push(`${k}: ${path.basename(file.name)} @${loc} ${JSON.stringify(file.code.slice(Number(loc), Number(loc) + 60))}`);
			continue;
		}
		const s = map ? map[Number(start)] : Number(start);
		const e = map ? map[Number(end)] : Number(end);
		if (ranges.has(`${s}-${e}`)) {
			tally.ok++;
			continue;
		}
		tally.bad++;
		const k = `BAD ${tag} ${op} ${wrapper}`;
		classes.set(k, (classes.get(k) || 0) + 1);
		if (examples.length < show) examples.push(`${k}: ${path.basename(file.name)} [${s},${e}) ${JSON.stringify(file.code.slice(s, Math.min(e, s + 80)))}`);
	}
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(tally));
for (const [k, n] of [...classes].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(7)}  ${k}`);
for (const e of examples) console.log("  " + e);
