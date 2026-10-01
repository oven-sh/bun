// Compares, for each source, what a rule can observe of the code paths: ESLint at the pin on its own tree against the
// driver (driver.cjs) on the same tree in Bun's shape (bunshape.cjs).
// The stream: every code path event with its segment ids, every loop, the arrows of each path when it ends, and the
// current segments at the nodes that the five rules read.
// usage: node compare.cjs [--fixtures] [--dir <dir>]... [--file <file>]... [--max n] [--verbose] [--drop <virtual,...>]
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const debug = require(path.join(R, "lib/linter/code-path-analysis/debug-helpers"));
const bunshape = require("./bunshape.cjs");
const { Driver } = require("./driver.cjs");

const PROBE = new Set([
	"BlockStatement", "BreakStatement", "ClassDeclaration", "ContinueStatement", "DebuggerStatement", "DoWhileStatement",
	"ExpressionStatement", "ForInStatement", "ForOfStatement", "ForStatement", "IfStatement", "LabeledStatement",
	"ReturnStatement", "SwitchStatement", "ThrowStatement", "TryStatement", "VariableDeclaration", "WhileStatement",
	"WithStatement", "ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration", "SwitchCase",
	"FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration", "CallExpression", "NewExpression", "ThisExpression",
	"Super", "Program", "PropertyDefinition", "MethodDefinition", "StaticBlock", "YieldExpression", "AwaitExpression",
	"ClassExpression", "ConditionalExpression", "LogicalExpression", "AssignmentExpression", "MemberExpression",
]);
const id = s => s.id + (s.reachable ? "" : "!");

function key(node) {
	return `${node.type}@${node.range[0]}-${node.range[1]}`;
}

// ESLint itself.
function real(linter, source, languageOptions) {
	const out = [];
	let ast = null;
	const stack = [];
	let current = null;
	const isForUpdate = node => Boolean(node && node.parent && node.parent.type === "ForStatement" && node.parent.update === node);
	const rule = {
		create: () => ({
			onCodePathStart(codePath, node) {
				stack.push(current);
				current = new Set();
				out.push(`pathstart ${codePath.id} ${codePath.origin} upper=${codePath.upper ? codePath.upper.id : "-"}`);
			},
			onCodePathEnd(codePath) {
				out.push(`pathend ${codePath.id} final=${codePath.finalSegments.map(id)} returned=${codePath.returnedSegments.map(id)} thrown=${codePath.thrownSegments.map(id)} ${debug.makeDotArrows(codePath)}`);
				current = stack.pop();
			},
			onCodePathSegmentStart(segment, node) {
				current.add(segment);
				out.push(`start ${id(segment)} prev=${segment.prevSegments.map(id)} allPrev=${segment.allPrevSegments.map(id)}${isForUpdate(node) ? " forUpdate" : ""}`);
			},
			onCodePathSegmentEnd(segment) {
				current.delete(segment);
				out.push(`end ${id(segment)}`);
			},
			onUnreachableCodePathSegmentStart(segment) {
				current.add(segment);
				out.push(`ustart ${id(segment)}`);
			},
			onUnreachableCodePathSegmentEnd(segment) {
				current.delete(segment);
				out.push(`uend ${id(segment)}`);
			},
			onCodePathSegmentLoop(from, to) {
				out.push(`loop ${id(from)} ${id(to)}`);
			},
			"*"(node) {
				if (node.type === "Program") ast = node;
				if (PROBE.has(node.type)) out.push(`enter ${key(node)} [${[...current].map(id)}]`);
			},
			"*:exit"(node) {
				if (PROBE.has(node.type)) out.push(`exit ${key(node)} [${[...current].map(id)}]`);
			},
		}),
	};
	const messages = linter.verify(source, { plugins: { t: { rules: { r: rule } } }, rules: { "t/r": 2 }, languageOptions });
	return { out, ast, fatal: messages.find(m => m.fatal) };
}

// The driver on the same tree in Bun's shape. ESLint runs the analysis of the whole file first and hands the events to
// the rules afterwards (SourceCode#traverse collects steps): a rule reads the finished graph. So the steps are kept
// here and written out when the walk has ended.
function driven(ast, options) {
	const steps = [];
	const emit = (name, args) => steps.push([name, args]);
	const probe = (when, node) => {
		const src = node.src;
		if (src && src.type && PROBE.has(src.type) && !node.noProbe) steps.push([when, [src]]);
	};
	const driver = new Driver(emit, probe, options);
	driver.program(bunshape.program(ast));
	const out = [];
	const stack = [];
	let current = null;
	for (const [name, [a, b]] of steps) {
		switch (name) {
			case "onCodePathStart":
				stack.push(current);
				current = new Set();
				out.push(`pathstart ${a.id} ${a.origin} upper=${a.upper ? a.upper.id : "-"}`);
				break;
			case "onCodePathEnd":
				out.push(`pathend ${a.id} final=${a.finalSegments.map(id)} returned=${a.returnedSegments.map(id)} thrown=${a.thrownSegments.map(id)} ${debug.makeDotArrows(a)}`);
				current = stack.pop();
				break;
			case "onCodePathSegmentStart":
				current.add(a);
				out.push(`start ${id(a)} prev=${a.prevSegments.map(id)} allPrev=${a.allPrevSegments.map(id)}${b && b.isForUpdate ? " forUpdate" : ""}`);
				break;
			case "onCodePathSegmentEnd":
				current.delete(a);
				out.push(`end ${id(a)}`);
				break;
			case "onUnreachableCodePathSegmentStart":
				current.add(a);
				out.push(`ustart ${id(a)}`);
				break;
			case "onUnreachableCodePathSegmentEnd":
				current.delete(a);
				out.push(`uend ${id(a)}`);
				break;
			case "onCodePathSegmentLoop":
				out.push(`loop ${id(a)} ${id(b)}`);
				break;
			case "enter":
			case "exit":
				out.push(`${name} ${key(a)} [${[...current].map(id)}]`);
				break;
			default:
				throw new Error(name);
		}
	}
	return out;
}

function* walk(dir, max) {
	const todo = [dir];
	while (todo.length) {
		const d = todo.pop();
		let entries;
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries.sort((a, b) => (a.name < b.name ? 1 : -1))) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) {
				if (e.name !== ".git") todo.push(p);
			} else if (/\.(js|cjs|mjs|jsx)$/u.test(e.name)) {
				yield p;
			}
		}
	}
}

function main() {
	const args = process.argv.slice(2);
	const files = [];
	const options = {};
	let max = Infinity;
	let verbose = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--fixtures") for (const f of fs.readdirSync(path.join(R, "tests/fixtures/code-path-analysis")).sort()) files.push(path.join(R, "tests/fixtures/code-path-analysis", f));
		else if (args[i] === "--dir") files.push(...walk(args[++i]));
		else if (args[i] === "--file") files.push(args[++i]);
		else if (args[i] === "--max") max = Number(args[++i]);
		else if (args[i] === "--verbose") verbose = true;
		else if (args[i] === "--option") options[args[++i]] = true;
		else if (args[i] === "--drop") options.dropVirtual = new Set(args[++i].split(","));
	}
	const linter = new Linter();
	const languageOptionsPattern = /\/\*languageOptions\s((?:.|[\r\n])+?)\*\//u;
	let same = 0, different = 0, rejected = 0, failed = 0, paths = 0, events = 0;
	for (const file of files.slice(0, max)) {
		let source;
		try {
			source = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		if (source.length > 2_000_000) continue;
		const m = file.includes("fixtures/code-path-analysis") ? languageOptionsPattern.exec(source) : null;
		const jsx = file.endsWith(".jsx");
		let r = null;
		const tries = m ? [JSON.parse(m[1])] : [{ sourceType: "module" }, { sourceType: "commonjs" }, { sourceType: "script" }];
		for (const t of tries) {
			const languageOptions = { ecmaVersion: "latest", ...t, parserOptions: { ecmaFeatures: { jsx } } };
			try {
				r = real(linter, source, languageOptions);
			} catch (e) {
				r = { fatal: { message: String(e) } };
			}
			if (!r.fatal) break;
		}
		if (r.fatal || !r.ast) {
			rejected++;
			continue;
		}
		let d;
		try {
			d = driven(r.ast, options);
		} catch (e) {
			failed++;
			console.log("FAILED", file, e.stack.split("\n").slice(0, 4).join(" | "));
			continue;
		}
		if (bunshape.dropped.size) {
			const gone = new Set([...bunshape.dropped].flatMap(n => [`enter ${key(n)} `, `exit ${key(n)} `]));
			r.out = r.out.filter(x => !(x.startsWith("e") && gone.has(x.slice(0, x.indexOf("[")))));
			bunshape.dropped.clear();
		}
		paths += r.out.filter(x => x.startsWith("pathend")).length;
		events += r.out.length;
		let at = 0;
		while (at < r.out.length && at < d.length && r.out[at] === d[at]) at++;
		if (at === r.out.length && at === d.length) {
			same++;
		} else {
			different++;
			if (different <= 15 || verbose) {
				console.log("DIFFERENT", file, "at event", at, "of", r.out.length, "/", d.length);
				for (let i = Math.max(0, at - 4); i < at; i++) console.log("     ", r.out[i]);
				console.log("  eslint:", r.out[at]);
				console.log("  driver:", d[at]);
				for (let i = at + 1; i < at + 3; i++) console.log("    e:", r.out[i], "\n    d:", d[i]);
			}
		}
	}
	console.log(`files ${same + different + failed} same ${same} different ${different} failed ${failed} rejected-by-espree ${rejected} code-paths ${paths} events ${events}`);
	process.exit(different || failed ? 1 : 0);
}
main();
