// Research scratch: getter-return as the port plans it, written as an ESLint rule, against ESLint's own getter-return.
// The plan: which functions are getters is decided from above (a class, an object literal, a call of Object.defineProperty
// and the like mark the functions below them) and not from the function up its parents; a report that depends on
// `Object` or `Reflect` being the global is dropped when the file declares the name anywhere (as `Context::report_if_global`).
// usage: node gr-model.cjs [--cases corpus.json]... [--list cases.json]... [--files list.txt]   prints each source that differs.
"use strict";
const fs = require("fs");
const path = require("path");
const ESLINT = "/workspace/ref/eslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
const astUtils = require(path.join(ESLINT, "lib/rules/utils/ast-utils"));
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });

const model = {
	meta: { messages: { expected: "Expected to return a value in {{name}}.", expectedAlways: "Expected {{name}} to always return a value." }, schema: [] },
	create(context) {
		const sourceCode = context.sourceCode;
		// function node -> null (a getter by its kind) or the global name that its being a getter depends on
		const getters = new Map();
		const held = [];
		let exact = true;
		const stack = [];
		const block = value => (value && /^(?:Arrow)?FunctionExpression$/u.test(value.type) && value.body.type === "BlockStatement" ? value : null);
		function descriptor(object, globalName) {
			for (const property of object.properties) {
				if (property.type !== "Property" || astUtils.getStaticPropertyName(property) !== "get") continue;
				const f = block(property.value);
				if (f && !getters.has(f)) getters.set(f, globalName);
			}
		}
		function report(descriptorOf, options) {
			if (descriptorOf.globalName === null) context.report(options);
			else held.push([descriptorOf, options]);
		}
		return {
			CallExpression(node) {
				const callee = node.callee.type === "ChainExpression" ? node.callee.expression : node.callee;
				if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return;
				const object = callee.object.name;
				const property = astUtils.getStaticPropertyName(callee);
				if ((object === "Object" || object === "Reflect") && property === "defineProperty") {
					const argument = node.arguments[2];
					if (argument && argument.type === "ObjectExpression") descriptor(argument, { name: object, id: callee.object });
				} else if (object === "Object" && (property === "create" || property === "defineProperties")) {
					const argument = node.arguments[1];
					if (argument && argument.type === "ObjectExpression") {
						for (const p of argument.properties) if (p.type === "Property" && p.value.type === "ObjectExpression") descriptor(p.value, { name: object, id: callee.object });
					}
				}
			},
			ObjectExpression(node) {
				for (const property of node.properties) {
					if (property.type === "Property" && property.kind === "get") { const f = block(property.value); if (f) getters.set(f, null); }
				}
			},
			ClassBody(node) {
				for (const member of node.body) {
					if (member.type === "MethodDefinition" && member.kind === "get") { const f = block(member.value); if (f) getters.set(f, null); }
				}
			},
			onCodePathStart(codePath, node) {
				const is = getters.has(node);
				stack.push({ shouldCheck: is, globalName: is ? getters.get(node) : null, hasReturn: false, node, currentSegments: new Set() });
			},
			onCodePathEnd() { stack.pop(); },
			onUnreachableCodePathSegmentStart(segment) { stack.at(-1).currentSegments.add(segment); },
			onUnreachableCodePathSegmentEnd(segment) { stack.at(-1).currentSegments.delete(segment); },
			onCodePathSegmentStart(segment) { stack.at(-1).currentSegments.add(segment); },
			onCodePathSegmentEnd(segment) { stack.at(-1).currentSegments.delete(segment); },
			ReturnStatement(node) {
				const info = stack.at(-1);
				if (!info.shouldCheck) return;
				info.hasReturn = true;
				if (!node.argument) report(info, { node, messageId: "expected", data: { name: astUtils.getFunctionNameWithKind(info.node) } });
			},
			"FunctionExpression:exit"(node) { check(node); },
			"ArrowFunctionExpression:exit"(node) { check(node); },
			"Program:exit"(node) {
				// Every name that a declaration of the file has, in any scope.
				const declared = new Set();
				const todo = [sourceCode.scopeManager.scopes[0]];
				for (const scope of sourceCode.scopeManager.scopes) for (const variable of scope.variables) if (variable.defs.length > 0) declared.add(variable.name);
				for (const [info, options] of held) {
					const approx = !declared.has(info.globalName.name);
					const real = sourceCode.isGlobalReference(info.globalName.id);
					if (approx !== real) exact = false;
					if (model.exactGlobals ? real : approx) context.report(options);
				}
				model.lastExact = exact;
			},
		};
		function check(node) {
			const info = stack.at(-1);
			if (!info.shouldCheck) return;
			let reachable = false;
			for (const segment of info.currentSegments) if (segment.reachable) reachable = true;
			if (!reachable) return;
			report(info, { node, loc: astUtils.getFunctionHeadLoc(node, sourceCode), messageId: info.hasReturn ? "expectedAlways" : "expected", data: { name: astUtils.getFunctionNameWithKind(info.node) } });
		}
	},
};

function run(code, ts, jsx, rules) {
	const tries = ts ? ["module"] : ["module", "commonjs", "script"];
	let first = null;
	for (const sourceType of tries) {
		const languageOptions = ts ? { parser: tsParser, sourceType, parserOptions: { ecmaFeatures: { jsx } } } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: true } } };
		const messages = linter.verify(code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { m: { rules: { model } } }, languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules }], { filename: ts ? (jsx ? "c.tsx" : "c.ts") : "c.js" });
		if (!messages.some(m => m.fatal)) return messages;
		first = first || messages;
	}
	return first;
}
const key = m => `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`;
const args = process.argv.slice(2);
const sources = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--cases") for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) sources.push({ code: c.code, ts: c.kind === "ts", jsx: !!c.jsx });
	else if (args[i] === "--list") for (const raw of JSON.parse(fs.readFileSync(args[++i], "utf8"))) { const c = typeof raw === "string" ? { code: raw, ext: "js" } : raw; sources.push({ code: c.code, ts: /^ts/u.test(c.ext || "js"), jsx: c.ext === "tsx" }); }
	else if (args[i] === "--files") for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) { try { sources.push({ code: fs.readFileSync(f, "utf8"), ts: /\.tsx?$/u.test(f), jsx: /x$/u.test(f), name: f }); } catch {} }
}
const count = { sources: sources.length, rejected: 0, sameWithExactGlobals: 0, differWithExactGlobals: 0, sameAsPlanned: 0, differAsPlanned: 0, reports: 0, approximationNotExact: 0 };
for (const s of sources) {
	const real = run(s.code, s.ts, s.jsx, { "getter-return": 2 });
	if (real.some(m => m.fatal)) { count.rejected++; continue; }
	const want = real.map(key).sort();
	count.reports += want.length;
	model.exactGlobals = true;
	const exact = run(s.code, s.ts, s.jsx, { "m/model": 2 }).map(key).sort();
	model.exactGlobals = false;
	const planned = run(s.code, s.ts, s.jsx, { "m/model": 2 }).map(key).sort();
	if (!model.lastExact) count.approximationNotExact++;
	if (JSON.stringify(exact) === JSON.stringify(want)) count.sameWithExactGlobals++;
	else { count.differWithExactGlobals++; console.log(`LOOK-DOWN DIFFERS ${JSON.stringify((s.name || s.code).slice(0, 200))}\n   eslint ${want.join(" | ") || "(none)"}\n   model  ${exact.join(" | ") || "(none)"}`); }
	if (JSON.stringify(planned) === JSON.stringify(want)) count.sameAsPlanned++;
	else { count.differAsPlanned++; console.log(`declared-anywhere differs ${JSON.stringify((s.name || s.code).slice(0, 200))}\n   eslint ${want.join(" | ") || "(none)"}\n   model  ${planned.join(" | ") || "(none)"}`); }
}
console.log(JSON.stringify(count));
