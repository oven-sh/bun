// What the scripts of this directory share: ESLint at the pin with the parser of typescript-eslint for TypeScript cases, and
// `bun --lint` of a debug build as the probe (plain format, at most four processes at a time).
// A case is { code, ext?, jsx?, sourceType? }. `ext` is one of ts, tsx, mts, cts, mjs, cjs; without it the file is .jsx when `jsx`, else .js.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ESLINT_DIR = process.env.ESLINT_DIR || "/workspace/ref/eslint";
const TSESLINT_DIR = process.env.TSESLINT_DIR || "/workspace/ref/tseslint";
const BUN = process.env.BUN_LINT_EXE || "/workspace/wt/cli/build/debug/bun-debug";
const FIXTURES = process.env.LINT_FIXTURES || "/workspace/wt/cli/test/cli/lint/rules";

const TS_EXTS = new Set(["ts", "tsx", "mts", "cts"]);
const EXTS = new Set(["js", "jsx", "mjs", "cjs", ...TS_EXTS]);
const extOf = c => c.ext || (c.jsx ? "jsx" : "js");
const keyOf = c => `${extOf(c)}:${c.code}`;

let linter = null;
let tsParser = null;
function eslint() {
	if (!linter) {
		const { Linter } = require(path.join(ESLINT_DIR, "lib/linter"));
		linter = new Linter({ configType: "flat" });
		// The package has `exports` and no `main`: it is resolved as a module of the directory that depends on it.
		tsParser = require("module").createRequire(TSESLINT_DIR + "/")("@typescript-eslint/parser");
	}
	return { linter, tsParser };
}

// ESLint's messages for `code` as a file of the extension `ext`, with `rules` on as errors.
function verifyAs(code, ext, rules, sourceType, jsx) {
	const { linter, tsParser } = eslint();
	const languageOptions = TS_EXTS.has(ext)
		? { parser: tsParser, ecmaVersion: "latest", sourceType: ext === "cts" ? "commonjs" : "module" }
		: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, rules: Object.fromEntries(rules.map(r => [r, "error"])) }];
	// typescript-eslint reads JSX or not from the extension of the file name.
	return linter.verify(code, config, { filename: `case.${ext}` });
}

// Runs ESLint on a case. Sets c.ext/c.jsx/c.type to what was used: a JavaScript case without a stated kind is read as the
// first of script, module, script with JSX, module with JSX that ESLint's parser takes (round 1 did the same).
function verifyCase(c, rules) {
	const ext = extOf(c);
	if (!EXTS.has(ext)) throw new Error(`unknown extension ${ext}`);
	let messages;
	if (TS_EXTS.has(ext)) {
		c.type = ext === "cts" ? "commonjs" : "module";
		messages = verifyAs(c.code, ext, rules);
	} else if (ext === "mjs" || ext === "cjs") {
		c.type = ext === "mjs" ? "module" : "commonjs";
		messages = verifyAs(c.code, ext, rules, c.type, false);
	} else {
		let type = c.sourceType || "script";
		let jsx = !!c.jsx;
		messages = verifyAs(c.code, jsx ? "jsx" : "js", rules, type, jsx);
		if (!c.sourceType && messages.some(m => m.fatal)) {
			for (const [t, j] of [["module", jsx], ["script", true], ["module", true]]) {
				const other = verifyAs(c.code, j ? "jsx" : "js", rules, t, j);
				if (!other.some(m => m.fatal)) {
					messages = other;
					type = t;
					jsx = j;
					break;
				}
			}
		}
		c.type = type;
		if (jsx) c.jsx = true;
	}
	const fatal = messages.find(m => m.fatal) || null;
	return {
		fatal,
		reports: messages.filter(m => !m.fatal).map(m => ({ line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, rule: m.ruleId, message: m.message })),
	};
}

// One line of the plain format: `name(line,column): category code: text`.
const LINE = /^(c\d+\.[a-z]+)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/;

function run(cmd, args, cwd) {
	return new Promise((resolve, reject) => {
		const env = { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
		delete env.FORCE_COLOR;
		env.ASAN_OPTIONS = env.ASAN_OPTIONS || "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=0";
		const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.on("data", d => (out += d));
		child.stderr.on("data", d => (err += d));
		child.on("error", reject);
		child.on("close", (code, signal) => resolve({ code, signal, out, err }));
	});
}

// `bun --lint` over the cases, each a file of its own: per case the lines about it, as { line, column, category, code, message }.
// `chunk` files go to one process and at most `jobs` (never more than four) processes run at a time.
async function bunLint(cases, { chunk = 400, jobs = 4 } = {}) {
	if (!fs.existsSync(BUN)) throw new Error(`no ${BUN}: build the worktree (bun bd --version) or set BUN_LINT_EXE`);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-oracle-"));
	const names = cases.map((c, i) => `c${String(i).padStart(5, "0")}.${extOf(c)}`);
	const indexOf = new Map(names.map((n, i) => [n, i]));
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const found = cases.map(() => []);
	const chunks = [];
	for (let i = 0; i < names.length; i += chunk) chunks.push(names.slice(i, i + chunk));
	let next = 0;
	const worker = async () => {
		while (next < chunks.length) {
			const files = chunks[next++];
			const r = await run(BUN, ["--lint", ...files], dir);
			if (r.signal || (r.code !== 0 && r.code !== 2) || r.out !== "") throw new Error(`bun --lint ended with ${r.signal || r.code}, stdout ${JSON.stringify(r.out.slice(0, 200))}\n${r.err.slice(-2000)}`);
			for (const line of r.err.split("\n")) {
				if (!line) continue;
				const m = LINE.exec(line);
				if (!m || !indexOf.has(m[1])) throw new Error(`a line that is not of the plain format: ${JSON.stringify(line)}`);
				found[indexOf.get(m[1])].push({ line: Number(m[2]), column: Number(m[3]), category: m[4], code: m[5], message: m[6] });
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.min(4, jobs, chunks.length) }, worker));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	return found;
}

// A syntax error of Bun's parser: the code `syntax`, or the number of a diagnostic of tsc.
const isSyntaxError = l => l.category === "error" && (l.code === "syntax" || /^TS\d+$/.test(l.code));
// The plain format writes a line break inside a message as one space.
const flat = text => text.replace(/\r\n?|\n/g, " ");

// Reads a list of cases: a JSON array of strings or of cases, { valid, invalid } of extract.cjs, or snippets separated by `----` lines.
function readCases(file) {
	const text = fs.readFileSync(file, "utf8");
	if (!file.endsWith(".json")) return text.split(/^----\n/m).map(s => ({ code: s.replace(/\n$/, "") }));
	const parsed = JSON.parse(text);
	const list = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
	return list.map(c => (typeof c === "string" ? { code: c } : c)).filter(c => typeof c.code === "string");
}

function rulesWithFixtures() {
	return fs.readdirSync(FIXTURES).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
}

module.exports = { ESLINT_DIR, TSESLINT_DIR, BUN, FIXTURES, TS_EXTS, extOf, keyOf, verifyCase, bunLint, isSyntaxError, flat, readCases, rulesWithFixtures };
