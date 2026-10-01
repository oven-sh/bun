// The rule no-unreachable as it can be written on Bun's tree: no node has an end, so ConsecutiveRange of upstream is
// kept as where the range starts, its last node, and whether the walk is still inside that node.
// usage: node no-unreachable-model.cjs [--tests] [--dir <dir>]... [--file <f>]...
// --tests: the cases of tests/lib/rules/no-unreachable.js. Compares `line:column` of every report with ESLint at the pin.
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const bunshape = require("./bunshape.cjs");
const { Driver } = require("./driver.cjs");

// Whether the text of the statement can end with a `;` of its own.
function canEndWithSemicolon(s) {
	switch (s.t) {
		case "SExpr": case "SLocal": case "SReturn": case "SThrow": case "SBreak": case "SContinue": case "SDebugger":
		case "SDoWhile": case "SDirective": case "SImport": case "SExportClause": case "SExportFrom": case "SExportStar":
		case "SEmpty": case "PropertyDefinition":
			return true;
		case "SExportDefault":
			return !s.value.stmt;
		case "SIf":
			return canEndWithSemicolon(s.no || s.yes);
		case "SFor": case "SForIn": case "SForOf": case "SWhile": case "SWith":
			return canEndWithSemicolon(s.body);
		case "SLabel":
			return canEndWithSemicolon(s.stmt);
		case "ExportNamedDeclaration":
			return canEndWithSemicolon(s.inner);
		default:
			return false;
	}
}

// Whether the text of `p` ends where the text of `e` ends: `e` is `p`, or the last part of `p` down to `e`.
function endsWith(p, e) {
	for (;;) {
		if (!p) return false;
		if (p === e) return true;
		switch (p.t) {
			case "SIf": p = p.no || p.yes; break;
			case "SFor": case "SForIn": case "SForOf": case "SWhile": case "SWith": p = p.body; break;
			case "SLabel": p = p.stmt; break;
			case "STry": p = p.lastBlock; break;
			case "ExportNamedDeclaration": p = p.inner; break;
			default: return false;
		}
	}
}

function model(ast, tokens) {
	const reports = [];
	// The code path events: the current segments of each path.
	const stack = [];
	let current = new Set();
	const emit = (name, [a]) => {
		switch (name) {
			case "onCodePathStart": stack.push(current); current = new Set(); break;
			case "onCodePathEnd": current = stack.pop(); break;
			case "onCodePathSegmentStart": case "onUnreachableCodePathSegmentStart": current.add(a); break;
			case "onCodePathSegmentEnd": case "onUnreachableCodePathSegmentEnd": current.delete(a); break;
			default: break;
		}
	};
	const anyReachable = () => [...current].some(s => s.reachable);

	// ConsecutiveRange.
	let startAt = null, endNode = null, endOpen = false;
	const isEmpty = () => endNode === null;
	const reset = (node, at) => { startAt = node ? at : null; endNode = node; endOpen = !!node && !node.isProperty; };
	const merge = node => { endNode = node; endOpen = !node.isProperty; };
	const contains = at => startAt <= at && (endOpen || at < endNode.rangeAt);
	// The two tokens before `at`.
	function before(at) {
		let lo = 0, hi = tokens.length;
		while (lo < hi) { const mid = (lo + hi) >> 1; if (tokens[mid].range[0] < at) lo = mid + 1; else hi = mid; }
		return [tokens[lo - 2], tokens[lo - 1]];
	}
	function isConsecutive(node, at) {
		if (endOpen || !endsWith(node.prevSibling, endNode)) return false;
		const [t0, t1] = before(at);
		if (!t1 || t1.value !== ";" || t1.type !== "Punctuator") return true;
		if (t0 && t0.type === "Punctuator" && t0.value === ";") return false;
		return canEndWithSemicolon(endNode);
	}
	function reportIfUnreachable(node, at, isProperty) {
		let next = null, nextAt = null;
		if (node && (isProperty || !anyReachable())) {
			node.rangeAt = at;
			if (isEmpty()) { reset(node, at); return; }
			if (contains(at)) return;
			if (isConsecutive(node, at)) { merge(node); return; }
			next = node; nextAt = at;
		}
		if (!isEmpty()) reports.push(startAt);
		reset(next, nextAt);
	}

	const constructors = [];
	const REGISTERED = new Set(["SBlock", "SBreak", "SClass", "SContinue", "SDebugger", "SDoWhile", "SExpr", "SDirective", "SForIn", "SForOf", "SFor", "SIf", "SLabel", "SReturn", "SSwitch", "SThrow", "STry", "SWhile", "SWith", "SExportClause", "SExportFrom", "SExportDefault", "SExportStar", "ExportNamedDeclaration", "BlockStatement"]);
	const probe = (when, node) => {
		if (when === "enter") {
			if (REGISTERED.has(node.t)) reportIfUnreachable(node, node.src.range[0], false);
			else if (node.t === "SLocal" && (node.kind !== "var" || node.decls.some(d => d.value))) reportIfUnreachable(node, node.src.range[0], false);
			else if (node.t === "MethodDefinition" && node.property.is_constructor) constructors.push({ hasSuperCall: false });
			else if (node.t === "ESuper" && node.isCallee && constructors.length) constructors.at(-1).hasSuperCall = true;
		} else {
			if (node === endNode) endOpen = false;
			if (node.t === "Program") reportIfUnreachable(null);
			else if (node.t === "MethodDefinition" && node.property.is_constructor) {
				const { hasSuperCall } = constructors.pop();
				const c = node.klass;
				if (c.extends && !hasSuperCall) {
					c.properties.forEach((p, i) => {
						if (!p.is_method && p.kind === "normal" && !p.is_static) {
							p.isProperty = true; p.t = "PropertyDefinition"; p.prevSibling = c.properties[i - 1] || null;
							reportIfUnreachable(p, p.src.range[0], true);
						}
					});
				}
			}
		}
	};
	const driver = new Driver(emit, probe, { siblings: true });
	driver.program(bunshape.program(ast));
	return reports;
}

function lineColumn(source, offset) {
	let line = 1, last = -1;
	for (let i = 0; i < offset; i++) if (source[i] === "\n") { line++; last = i; }
	return `${line}:${offset - last}`;
}

function run(linter, source, languageOptions) {
	let ast = null;
	const grab = { create: context => ({ Program(node) { ast = node; ast.tokens = context.sourceCode.ast.tokens; } }) };
	const messages = linter.verify(source, [{ plugins: { t: { rules: { grab } } }, rules: { "t/grab": 2, "no-unreachable": 2 }, languageOptions }]);
	if (messages.some(m => m.fatal)) return null;
	const expected = messages.filter(m => m.ruleId === "no-unreachable").map(m => `${m.line}:${m.column}`);
	const actual = model(ast, ast.tokens).sort((a, b) => a - b).map(at => lineColumn(source, at));
	return { expected, actual };
}

function main() {
	const args = process.argv.slice(2);
	const linter = new Linter({ configType: "flat" });
	const sources = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--tests") {
			// The cases of ESLint's own test, read by loading the test with a RuleTester that only collects.
			const Module = require("module");
			const collected = [];
			const testerPath = path.join(R, "lib/rule-tester/rule-tester.js");
			const real = Module.prototype.require;
			Module.prototype.require = function (id) {
				const resolved = Module._resolveFilename(id, this);
				if (resolved === testerPath) return class { constructor(c) { this.c = c; } run(name, rule, t) { for (const x of [...t.valid, ...t.invalid]) collected.push({ ...(typeof x === "string" ? { code: x } : x), base: this.c }); } };
				return real.apply(this, arguments);
			};
			require(path.join(R, "tests/lib/rules/no-unreachable.js"));
			Module.prototype.require = real;
			for (const c of collected) sources.push({ name: JSON.stringify(c.code), source: c.code, options: { ...(c.base.languageOptions || {}), ...(c.languageOptions || {}) } });
		} else if (args[i] === "--dir") {
			const todo = [args[++i]];
			while (todo.length) {
				const d = todo.pop();
				let entries = [];
				try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
				for (const e of entries) {
					const p = path.join(d, e.name);
					if (e.isDirectory()) { if (e.name !== ".git") todo.push(p); } else if (/\.(js|cjs|mjs)$/u.test(e.name)) sources.push({ name: p, file: p });
				}
			}
		} else if (args[i] === "--file") sources.push({ name: args[i + 1], file: args[++i] });
		else if (args[i] === "--cases") for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) sources.push({ name: JSON.stringify(c.code || c), source: c.code || c });
	}
	let same = 0, different = 0, rejected = 0, failed = 0, withReports = 0, reports = 0;
	for (const s of sources) {
		let source = s.source;
		if (s.file) { try { source = fs.readFileSync(s.file, "utf8"); } catch { continue; } if (source.length > 2_000_000) continue; }
		let r = null;
		const tries = s.options ? [s.options] : [{ sourceType: "module" }, { sourceType: "commonjs" }, { sourceType: "script" }];
		try {
			for (const t of tries) { r = run(linter, source, { ecmaVersion: "latest", ...t, ...(t.ecmaVersion && t.ecmaVersion < 2022 ? { ecmaVersion: "latest" } : {}) }); if (r) break; }
		} catch (e) {
			failed++;
			console.log("FAILED", s.name, String(e.stack).split("\n").slice(0, 3).join(" | "));
			continue;
		}
		if (!r) { rejected++; continue; }
		if (r.expected.length) { withReports++; reports += r.expected.length; }
		if (JSON.stringify(r.expected) === JSON.stringify(r.actual)) same++;
		else { different++; if (different <= 25) console.log("DIFFERENT", s.name, "\n  eslint:", r.expected.join(" "), "\n  model: ", r.actual.join(" ")); }
	}
	console.log(`sources ${same + different + failed} same ${same} different ${different} failed ${failed} rejected ${rejected} with-reports ${withReports} reports ${reports}`);
	process.exit(different || failed ? 1 : 0);
}
main();
