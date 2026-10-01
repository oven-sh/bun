// Research scratch (rules-code-path): the four rules run from Bun's tree as written. The probe (probe/, a copy of
// ../walk-order-code-paths/probe with more trace lines) walks the tree of Parser::parse_for_lint and prints every call
// on CodePathState and, as `@` lines, what the rules read of a node (and what they read of the text, with Bun's lexer:
// where a property and a clause start, the `:` of a clause, the comment before a clause). Here the calls run on
// ESLint's own CodePathState, the rules run on the events and the `@` lines, and the reports are compared with ESLint's
// (typescript-eslint's parser for TypeScript).
// usage: node rules-sim.cjs [--probe bin] [--list cases.json]... [--cases corpus.json] [--files list.txt] [--show n] [--only rule]
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const CP = path.join(R, "lib/linter/code-path-analysis/");
const CodePath = require(path.join(CP, "code-path"));
const CodePathSegment = require(path.join(CP, "code-path-segment"));
const IdGenerator = require(path.join(CP, "id-generator"));
const { constructorSuper, noThisBeforeSuper, RULES } = require("./model.cjs");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });

const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const probe = opt("--probe") || "/tmp/rcp/rcpprobe";
const showMax = Number(opt("--show") || 20);
const only = opt("--only");
const strictHeritage = args.includes("--strict-heritage");

const FALLS = /falls?\s?through/iu;
const DIRECTIVE = /^(eslint(?:-env|-enable|-disable(?:(?:-next)?-line)?)?|exported|globals?)(?:\s|$)/u;
const isFallThroughComment = value => FALLS.test(value) && !DIRECTIVE.test(value.trim());

function simulate(lines, buf) {
	const idGenerator = new IdGenerator("s");
	const reports = [];
	const held = [];
	const report = (rule, at, message) => reports.push({ rule, at, message });
	let codePath = null;
	const stack = [];
	const switches = [];
	let pendingGetter = null, pendingCtor = null, forUpdate = false;
	const notes = { unknownPlace: 0 };
	const text = (from, to) => buf.subarray(from, to).toString("utf8");
	const linesBetween = (from, to) => {
		const s = text(from, to);
		let n = 0;
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			if (c === 10 || c === 0x2028 || c === 0x2029 || (c === 13 && s.charCodeAt(i + 1) !== 10)) n++;
		}
		return n;
	};
	const started = (segment, flagged) => {
		const top = stack.at(-1);
		top.current.add(segment);
		if (top.rec) top.rec.push(segment.reachable ? { k: "start", segment, forUpdate: flagged } : { k: "ustart", segment });
	};
	const ended = segment => {
		const top = stack.at(-1);
		top.current.delete(segment);
		if (top.rec) top.rec.push({ k: segment.reachable ? "end" : "uend", segment });
	};
	const onLooped = (from, to) => {
		const top = stack.at(-1);
		if (from.reachable && to.reachable && top.rec) top.rec.push({ k: "loop", from, to });
	};
	function forward() {
		const state = CodePath.getState(codePath);
		const currentSegments = state.currentSegments;
		const headSegments = state.headSegments;
		const end = Math.max(currentSegments.length, headSegments.length);
		for (let i = 0; i < end; ++i) if (currentSegments[i] !== headSegments[i] && currentSegments[i]) ended(currentSegments[i]);
		state.currentSegments = headSegments;
		for (let i = 0; i < end; ++i) {
			if (currentSegments[i] !== headSegments[i] && headSegments[i]) {
				CodePathSegment.markUsed(headSegments[i]);
				started(headSegments[i], forUpdate);
			}
		}
		forUpdate = false;
	}
	const anyReachable = () => [...stack.at(-1).current].some(s => s.reachable);
	for (const line of lines) {
		if (line.startsWith("@")) {
			const parts = line.split(" ");
			const top = stack.at(-1);
			switch (parts[0]) {
				case "@getter": {
					const name = JSON.parse(line.slice(parts[0].length + parts[1].length + parts[2].length + 3));
					pendingGetter = { at: Number(parts[1]), global: parts[2] === "-" ? null : parts[2], name };
					break;
				}
				case "@ctor":
					// `--strict-heritage`: `as`, `satisfies`, `!` and `<T>` around the superclass make it a node the rules do not know.
					pendingCtor = { keyAt: Number(parts[1]), memberAt: Number(parts[2]), hasExtends: parts[3] === "1", possible: parts[strictHeritage ? 6 : 4] === "1", valid: parts[strictHeritage ? 7 : 5] === "1" };
					break;
				case "@return":
					if (top.getter) {
						top.hasReturn = true;
						if (parts[2] === "0") (top.getter.global ? held : reports).push({ rule: "getter-return", at: Number(parts[1]), message: `Expected to return a value in ${top.getter.name}.`, global: top.getter.global });
					}
					if (top.rec && parts[2] === "1") top.rec.push({ k: "return" });
					break;
				case "@fn-exit":
					if (top.getter && anyReachable()) {
						if (top.getter.at < 0) notes.unknownPlace++;
						(top.getter.global ? held : reports).push({ rule: "getter-return", at: top.getter.at, global: top.getter.global, message: top.hasReturn ? `Expected ${top.getter.name} to always return a value.` : `Expected to return a value in ${top.getter.name}.` });
					}
					break;
				case "@this": if (top.rec) top.rec.push({ k: "this", at: Number(parts[1]) }); break;
				case "@super": if (top.rec) top.rec.push({ k: "superref", at: Number(parts[1]) }); break;
				case "@super-exit": if (top.rec) top.rec.push({ k: "super", at: Number(parts[1]) }); break;
				case "@for-update": forUpdate = true; break;
				case "@switch": switches.push({ previous: null }); break;
				case "@switch-end": switches.pop(); break;
				case "@case-enter": {
					const sw = switches.at(-1);
					const [start, , inBlockFrom, inBlockTo, beforeFrom, beforeTo] = parts.slice(2).map(Number);
					const isDefault = parts[3] === "1";
					const previous = sw.previous;
					if (previous && previous.reachable && !previous.isLast) {
						let isFallthrough = previous.bodyLen > 0;
						if (!isFallthrough) {
							if (previous.colon < 0 || start < 0) notes.unknownPlace++;
							else isFallthrough = linesBetween(previous.colon, start) >= 2;
						}
						if (isFallthrough) {
							const permitted = (inBlockFrom >= 0 && isFallThroughComment(text(inBlockFrom, inBlockTo))) || (beforeFrom >= 0 && isFallThroughComment(text(beforeFrom, beforeTo)));
							if (!permitted) {
								if (start < 0) notes.unknownPlace++;
								report("no-fallthrough", start, `Expected a 'break' statement before '${isDefault ? "default" : "case"}'.`);
							}
						}
					}
					sw.previous = null;
					break;
				}
				case "@case-exit":
					switches.at(-1).previous = { reachable: anyReachable(), bodyLen: Number(parts[2]), isLast: parts[3] === "1", colon: Number(parts[4]) };
					break;
				default: break;
			}
			continue;
		}
		const space = line.indexOf(" ");
		const op = space < 0 ? line : line.slice(0, space);
		const rest = space < 0 ? "" : line.slice(space + 1);
		if (op === "start") {
			if (codePath) forward();
			codePath = new CodePath({ id: idGenerator.next(), origin: rest, upper: codePath, onLooped });
			const isFn = rest === "function";
			const info = { codePath, current: new Set(), getter: isFn ? pendingGetter : null, hasReturn: false, rec: null };
			if (isFn && pendingCtor && pendingCtor.hasExtends) {
				info.rec = [];
				info.superIsConstructor = pendingCtor.possible;
				info.hasValidExtends = pendingCtor.valid;
				info.methodAt = pendingCtor.memberAt >= 0 ? pendingCtor.memberAt : pendingCtor.keyAt;
				info.memberKnown = pendingCtor.memberAt >= 0;
			}
			if (isFn) pendingGetter = pendingCtor = null;
			stack.push(info);
			continue;
		}
		const state = CodePath.getState(codePath);
		if (op === "end") {
			state.makeFinal();
			for (const segment of state.currentSegments) ended(segment);
			state.currentSegments = [];
			const info = stack.pop();
			if (info.rec) {
				for (const machine of [constructorSuper(info, report), noThisBeforeSuper(info, report)]) {
					for (const step of info.rec) machine.step(step);
					machine.end();
				}
			}
			codePath = codePath.upper;
		} else if (op === "F") forward();
		else if (op === "F-unless-reachable") {
			if (!state.forkContext.reachable) forward();
		} else {
			const a = rest ? JSON.parse(rest).map(x => (x === null && /Test$/u.test(op) ? void 0 : x)) : [];
			if (typeof state[op] !== "function") throw new Error(`no call ${op}`);
			state[op](...a);
		}
	}
	if (codePath) throw new Error("a code path is left open");
	return { reports, held, notes };
}

function eslintRun(code, ext) {
	const ts = /^[mc]?ts/u.test(ext);
	const jsx = ext === "jsx" || ext === "tsx";
	let first = null;
	for (const sourceType of ts ? ["module"] : ["module", "commonjs", "script"]) {
		let scopeManager = null;
		const grab = { create: context => ({ Program() { scopeManager = context.sourceCode.scopeManager; } }) };
		const languageOptions = ts ? { parser: tsParser, sourceType, parserOptions: { ecmaFeatures: { jsx } } } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: jsx || ext === "js" } } };
		const messages = linter.verify(code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { t: { rules: { grab } } }, languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "t/grab": 2, ...Object.fromEntries(RULES.map(r => [r, 2])) } }], { filename: `c.${ext}` });
		if (messages.some(m => m.fatal)) { first = first || { fatal: messages.find(m => m.fatal).message }; continue; }
		const declared = new Set();
		for (const scope of scopeManager.scopes) for (const variable of scope.variables) if (variable.defs.length > 0) declared.add(variable.name);
		return { expected: messages.filter(m => RULES.includes(m.ruleId)).map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`), declared };
	}
	return first;
}

function main() {
	const sources = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--list") {
			const raw = JSON.parse(fs.readFileSync(args[++i], "utf8"));
			for (const c of Array.isArray(raw) ? raw : raw.cases) sources.push(typeof c === "string" ? { code: c, ext: "js" } : { code: c.code, ext: c.ext || (c.jsx ? "jsx" : "js") });
		} else if (args[i] === "--cases") {
			for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) sources.push({ code: c.code, ext: c.kind === "ts" ? (c.jsx ? "tsx" : "ts") : c.jsx ? "jsx" : "js" });
		} else if (args[i] === "--files") {
			for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) { try { sources.push({ code: fs.readFileSync(f, "utf8"), ext: /\.[mc]?tsx$/u.test(f) ? "tsx" : /\.[mc]?ts$/u.test(f) ? "ts" : /\.jsx$/u.test(f) ? "jsx" : "js", name: f }); } catch {} }
		}
	}
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-sim-"));
	const count = { sources: sources.length, eslintRejects: 0, bunRejects: 0, bothTake: 0, same: 0, different: 0, samePlaceUnknown: 0, failed: 0, reports: 0, heldDropped: 0 };
	const perRule = {};
	let shown = 0;
	const BATCH = 400;
	for (let base = 0; base < sources.length; base += BATCH) {
		const batch = sources.slice(base, base + BATCH);
		const names = batch.map((s, i) => path.join(dir, `c${String(base + i).padStart(6, "0")}.${s.ext}`));
		batch.forEach((s, i) => fs.writeFileSync(names[i], s.code));
		const r = spawnSync(probe, ["--nodes", ...names], { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" } });
		const traces = new Map();
		let name = null, lines = [];
		for (const line of (r.stdout || "").split("\n")) {
			if (line.startsWith("== ")) { if (name !== null) traces.set(name, lines); name = line.slice(3); lines = []; } else if (line !== "") lines.push(line);
		}
		if (name !== null) traces.set(name, lines);
		batch.forEach((s, i) => {
			const e = eslintRun(s.code, s.ext);
			const lines = traces.get(names[i]);
			const bunRejects = !lines || lines[0] === "PARSE_ERROR" || lines[0] === "CANNOT_READ_OR_INIT";
			if (!e || e.fatal) { count.eslintRejects++; return; }
			if (bunRejects) { count.bunRejects++; return; }
			count.bothTake++;
			const buf = Buffer.from(s.code, "utf8");
			let sim;
			try {
				sim = simulate(lines, buf);
			} catch (err) {
				count.failed++;
				if (shown++ < showMax) console.log("FAILED", JSON.stringify((s.name || s.code).slice(0, 200)), String(err.stack).split("\n").slice(0, 3).join(" | "));
				return;
			}
			if (sim.held.some(h => e.declared.has(h.global))) count.heldDropped++;
			const all = sim.reports.concat(sim.held.filter(h => !e.declared.has(h.global)));
			const place = at => {
				if (at < 0) return "?:?";
				const before = buf.subarray(0, at).toString("utf8");
				let line = 1, last = -1;
				for (let k = 0; k < before.length; k++) {
					const c = before.charCodeAt(k);
					if (c === 10 || c === 0x2028 || c === 0x2029 || (c === 13 && before.charCodeAt(k + 1) !== 10)) { line++; last = k; }
				}
				return `${line}:${before.length - last}`;
			};
			const fmt = list => { const out = list.map(x => `${x.rule} ${place(x.at)} ${x.message}`).sort(); return out.filter((x, k) => k === 0 || out[k - 1] !== x); };
			const keep = x => !only || x.startsWith(only + " ");
			const expected = e.expected.slice().sort().filter(keep);
			const actual = fmt(all).filter(keep);
			count.reports += expected.length;
			for (const x of expected) { const rule = x.split(" ")[0]; perRule[rule] = (perRule[rule] || 0) + 1; }
			if (JSON.stringify(expected) === JSON.stringify(actual)) count.same++;
			else {
				// The same reports but for a place that the probe cannot know (a class member of a TypeScript file)?
				const loose = list => list.map(x => x.replace(/ \S+:\S+ /u, " ")).sort();
				if (actual.some(x => x.includes(" ?:? ")) && JSON.stringify(loose(expected)) === JSON.stringify(loose(actual))) { count.samePlaceUnknown++; return; }
				count.different++;
				if (shown++ < showMax) console.log(`DIFFERENT [${s.ext}] ${JSON.stringify((s.name || s.code).slice(0, 400))}\n   eslint ${expected.join(" | ") || "(none)"}\n   bun    ${actual.join(" | ") || "(none)"}`);
			}
		});
		for (const n of names) fs.rmSync(n, { force: true });
	}
	fs.rmSync(dir, { recursive: true, force: true });
	console.log(JSON.stringify(count), JSON.stringify(perRule));
}
main();
