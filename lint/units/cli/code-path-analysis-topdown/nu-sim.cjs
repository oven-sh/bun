// Research scratch: no-unreachable as it would be written on Bun's tree, against ESLint's rule at the pin.
// The statements, their places in their lists and the class fields come from `cpaprobe --nodes` (Bun's tree as written);
// the reachability comes from the calls of the same trace, replayed on ESLint's CodePathState; the algorithm below is
// the one proposed for src/lint/rules/no_unreachable.rs (no end of a node is used: "inside the end node", "the tail",
// "the statement before in the list", and two tokens before a statement).
// usage: node nu-sim.cjs --cases corpus.json [--kind js|ts] [--rule r] [--show n]   |   --files a.js ...
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { replayAll } = require("./replay.cjs");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const espree = require(path.join(R, "node_modules/espree"));
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const probe = opt("--probe") || "/tmp/cpa-1b/cpaprobe";
const show = Number(opt("--show") || 20);
const linter = new Linter();
let tsParser = null;
const getTs = () => (tsParser = tsParser || require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser"));

function eslintReports(code, ts, sourceType) {
	if (ts) {
		const messages = linter.verify(code, { rules: { "no-unreachable": 2 }, languageOptions: { parser: getTs() } });
		if (messages.some(m => m.fatal)) return { error: messages.find(m => m.fatal).message };
		return { reports: messages.map(m => `${m.line}:${m.column}`), sourceType: "module" };
	}
	let first = null;
	for (const type of [sourceType || "module", "commonjs", "script"]) {
		const messages = linter.verify(code, { rules: { "no-unreachable": 2 }, languageOptions: { ecmaVersion: "latest", sourceType: type, parserOptions: { ecmaFeatures: { jsx: true } } } });
		if (!messages.some(m => m.fatal)) return { reports: messages.map(m => `${m.line}:${m.column}`), sourceType: type };
		first = first || { error: messages.find(m => m.fatal).message };
	}
	return first;
}

// The starts of the tokens of the source, as the re-scan of src/lint/tokens.rs would give them.
function tokensOf(code, ts, sourceType) {
	if (ts) return getTs().parseForESLint(code, { tokens: true, range: true }).ast.tokens.map(t => ({ start: t.range[0], end: t.range[1], value: t.value, punct: t.type === "Punctuator" }));
	return espree
		.tokenize(code, { ecmaVersion: "latest", sourceType: sourceType === "commonjs" ? "commonjs" : sourceType, ecmaFeatures: { jsx: true }, range: true })
		.map(t => ({ start: t.range[0], end: t.range[1], value: t.value, punct: t.type === "Punctuator" }));
}

function simulate(code, events, tokens) {
	const lineStarts = [0];
	for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
	// Offsets of the probe are bytes: the sources here are ASCII, or the case is skipped by the caller.
	const place = at => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= at) lo = mid;
			else hi = mid - 1;
		}
		return `${lo + 1}:${at - lineStarts[lo] + 1}`;
	};
	const tokenIndexAt = at => {
		let lo = 0;
		let hi = tokens.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (tokens[mid].start < at) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	// Whether an empty statement stands before the statement at `at`: the end node cannot own the `;`, or there are two.
	const stray = (at, canOwn) => {
		const i = tokenIndexAt(at);
		const q = tokens[i - 1];
		const p = tokens[i - 2];
		const semi = t => t && t.punct && t.value === ";";
		return semi(q) && (semi(p) || !canOwn);
	};
	const reports = [];
	const reachable = new Map();
	const sets = [];
	let current = new Set();
	const anyReachable = () => [...current].some(id => reachable.get(id));
	const ctors = [];
	// ConsecutiveRange without ends.
	let range = null; // { start, endId, canOwn, inside, tail }
	function reportIfUnreachable(node, always) {
		let next = null;
		if (node && (always || !anyReachable())) {
			if (!range) {
				range = { start: node.start, endId: node.id, canOwn: node.canOwn, inside: !always, tail: always ? node.id : null };
				return;
			}
			if (range.inside) return;
			if (range.tail !== null && node.prev === range.tail && !stray(node.start, always ? true : range.canOwn)) {
				range.endId = node.id;
				range.canOwn = node.canOwn;
				range.inside = !always;
				range.tail = always ? node.id : null;
				return;
			}
			next = node;
		}
		if (range) reports.push(range.start);
		range = next ? { start: next.start, endId: next.id, canOwn: next.canOwn, inside: !always, tail: always ? next.id : null } : null;
	}
	// Where the node starts for ESLint: at `export` before a declaration that is exported, at `{` after `finally`, at `[` of a computed key.
	const exportBefore = at => {
		const i = tokenIndexAt(at);
		const before = tokens[i - 1];
		return before && before.value === "export" ? before.start : at;
	};
	for (const line of events) {
		const parts = line.split(" ");
		switch (parts[0]) {
			case "onCodePathStart":
				sets.push(current);
				current = new Set();
				break;
			case "onCodePathEnd":
				current = sets.pop();
				break;
			case "onCodePathSegmentStart":
				reachable.set(parts[1], true);
				current.add(parts[1]);
				break;
			case "onUnreachableCodePathSegmentStart":
				reachable.set(parts[1], false);
				current.add(parts[1]);
				break;
			case "onCodePathSegmentEnd":
			case "onUnreachableCodePathSegmentEnd":
				current.delete(parts[1]);
				break;
			case "@stmt": {
				const [, kind, at, id, prev, registered, canOwn] = parts;
				if (registered === "0") break;
				let start = Number(at);
				if (registered === "x") start = exportBefore(start);
				if (kind === "finally") start = tokens[tokenIndexAt(start) + 1].start;
				reportIfUnreachable({ start, id, prev: prev === "-" ? null : prev, canOwn: canOwn === "1" }, false);
				break;
			}
			case "@leave": {
				const [, id, tail] = parts;
				if (!range) break;
				if (id === range.endId) {
					range.inside = false;
					range.tail = id;
				} else if (range.tail !== null && tail === range.tail) range.tail = id;
				break;
			}
			case "@ctor-enter":
				ctors.push(false);
				break;
			case "@super-call":
				if (ctors.length) ctors[ctors.length - 1] = true;
				break;
			case "@ctor-exit": {
				const hasSuper = ctors.pop();
				if (parts[1] === "1" && !hasSuper) {
					for (const field of parts.slice(2)) {
						const [at, id, prev, computed] = field.split(",");
						let start = Number(at);
						if (computed === "1") start = tokens[tokenIndexAt(start) - 1].start;
						reportIfUnreachable({ start, id, prev: prev === "-" ? null : prev, canOwn: true }, true);
					}
				}
				break;
			}
			case "@program-exit":
				reportIfUnreachable(null, false);
				break;
			default:
				break;
		}
	}
	return reports.sort((a, b) => a - b).map(place);
}

let cases = [];
if (opt("--cases")) {
	cases = JSON.parse(fs.readFileSync(opt("--cases"), "utf8"));
	if (opt("--kind")) cases = cases.filter(c => c.kind === opt("--kind"));
	if (opt("--rule")) cases = cases.filter(c => c.rule === opt("--rule"));
} else {
	for (const file of args.slice(args.indexOf("--files") + 1)) cases.push({ rule: file, code: fs.readFileSync(file, "utf8"), kind: /\.tsx?$/u.test(file) ? "ts" : "js", jsx: !/\.ts$/u.test(file) });
}
// eslint-disable-next-line no-control-regex -- offsets of the probe are bytes
cases = cases.filter(c => /^[\x00-\x7f]*$/u.test(c.code));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nu-sim-"));
const names = cases.map((c, i) => `c${String(i).padStart(5, "0")}.${c.kind === "ts" ? (c.jsx ? "tsx" : "ts") : "js"}`);
cases.forEach((c, i) => fs.writeFileSync(path.join(tmp, names[i]), c.code));
const results = new Map();
for (let from = 0; from < names.length; from += 400) {
	const run = spawnSync(probe, ["--nodes", ...names.slice(from, from + 400)], { cwd: tmp, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" }, encoding: "utf8", maxBuffer: 1 << 30 });
	for (const [k, v] of replayAll(run.stdout)) results.set(k, v);
}
fs.rmSync(tmp, { recursive: true, force: true });
const count = { same: 0, sameWithReports: 0, differ: 0, skipped: 0, eslintReports: 0 };
let shown = 0;
cases.forEach((c, i) => {
	const bun = results.get(names[i]);
	const es = eslintReports(c.code, c.kind === "ts", c.sourceType);
	if (!bun || bun.error || es.error) {
		count.skipped++;
		return;
	}
	let mine;
	try {
		mine = simulate(c.code, bun.events, tokensOf(c.code, c.kind === "ts", es.sourceType));
	} catch (e) {
		mine = [`ERROR ${e.message}`];
	}
	const theirs = [...es.reports].sort((a, b) => {
		const [al, ac] = a.split(":").map(Number);
		const [bl, bc] = b.split(":").map(Number);
		return al - bl || ac - bc;
	});
	count.eslintReports += theirs.length;
	if (JSON.stringify(mine) === JSON.stringify(theirs)) {
		count.same++;
		if (theirs.length) count.sameWithReports++;
	} else {
		count.differ++;
		if (shown++ < show) console.log(`DIFFER [${c.rule}] ${JSON.stringify(c.code.slice(0, 400))}\n   eslint ${theirs.join(" ")}\n   bun    ${mine.join(" ")}`);
	}
});
console.log(JSON.stringify(count));
