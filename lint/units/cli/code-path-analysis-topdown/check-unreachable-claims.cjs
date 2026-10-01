// Research scratch: two claims about ConsecutiveRange of ESLint's no-unreachable, checked on real runs of the rule.
//   contains(node)      <=> node is inside range.endNode (the walk has not left endNode)
//   isConsecutive(node) <=> node is the next sibling of range.endNode in the same list of statements (or of class
//                           elements), and no token stands between them
// The rule here is lib/rules/no-unreachable.js at the pin with the two checks added: it reports as the rule does.
// usage: node check-unreachable-claims.cjs --cases corpus.json [--kind js|ts]   |   --files a.js ...
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const { isAnySegmentReachable } = require(path.join(R, "lib/rules/utils/code-path-utils"));
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const stats = { calls: 0, unreachableCalls: 0, containsTrue: 0, consecutiveTrue: 0, containsMismatch: 0, consecutiveMismatch: 0, reports: 0, sourcesWithReports: 0 };
const mismatches = [];

function isInside(node, ancestor) {
	for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
	return false;
}
function listOf(node) {
	const p = node.parent;
	if (!p) return null;
	for (const key of ["body", "consequent"]) {
		if (Array.isArray(p[key]) && p[key].includes(node)) return p[key];
	}
	return null;
}

const rule = {
	meta: { messages: { unreachableCode: "Unreachable code." }, schema: [] },
	create(context) {
		const sourceCode = context.sourceCode;
		let constructorInfo = null;
		let startNode = null;
		let endNode = null;
		const codePathSegments = [];
		let currentCodePathSegments = new Set();
		const isEmpty = () => !(startNode && endNode);
		const contains = node => node.range[0] >= startNode.range[0] && node.range[1] <= endNode.range[1];
		const isConsecutive = node => contains(sourceCode.getTokenBefore(node));
		function check(node) {
			const c = contains(node);
			const structuralContains = isInside(node, endNode);
			if (c) stats.containsTrue++;
			if (c !== structuralContains) {
				stats.containsMismatch++;
				mismatches.push(["contains", c, node.type, endNode.type, sourceCode.text.slice(0, 200)]);
			}
			if (c) return;
			const k = isConsecutive(node);
			const list = listOf(node);
			const sibling = Boolean(list && list === listOf(endNode) && list.indexOf(node) === list.indexOf(endNode) + 1);
			const before = sourceCode.getTokenBefore(node);
			const noTokenBetween = Boolean(before && before.range[1] <= endNode.range[1]);
			const structuralConsecutive = sibling && noTokenBetween;
			if (k) stats.consecutiveTrue++;
			if (k !== structuralConsecutive) {
				stats.consecutiveMismatch++;
				mismatches.push(["consecutive", k, node.type, endNode.type, sibling, noTokenBetween, sourceCode.text.slice(0, 200)]);
			}
		}
		function reportIfUnreachable(node) {
			let nextNode = null;
			stats.calls++;
			if (node && (node.type === "PropertyDefinition" || !isAnySegmentReachable(currentCodePathSegments))) {
				stats.unreachableCalls++;
				if (isEmpty()) {
					startNode = endNode = node;
					return;
				}
				check(node);
				if (contains(node)) return;
				if (isConsecutive(node)) {
					endNode = node;
					return;
				}
				nextNode = node;
			}
			if (!isEmpty()) {
				stats.reports++;
				context.report({ messageId: "unreachableCode", loc: { start: startNode.loc.start, end: endNode.loc.end }, node: startNode });
			}
			startNode = endNode = nextNode;
		}
		return {
			onCodePathStart() {
				codePathSegments.push(currentCodePathSegments);
				currentCodePathSegments = new Set();
			},
			onCodePathEnd() {
				currentCodePathSegments = codePathSegments.pop();
			},
			onUnreachableCodePathSegmentStart(segment) {
				currentCodePathSegments.add(segment);
			},
			onUnreachableCodePathSegmentEnd(segment) {
				currentCodePathSegments.delete(segment);
			},
			onCodePathSegmentEnd(segment) {
				currentCodePathSegments.delete(segment);
			},
			onCodePathSegmentStart(segment) {
				currentCodePathSegments.add(segment);
			},
			BlockStatement: reportIfUnreachable,
			BreakStatement: reportIfUnreachable,
			ClassDeclaration: reportIfUnreachable,
			ContinueStatement: reportIfUnreachable,
			DebuggerStatement: reportIfUnreachable,
			DoWhileStatement: reportIfUnreachable,
			ExpressionStatement: reportIfUnreachable,
			ForInStatement: reportIfUnreachable,
			ForOfStatement: reportIfUnreachable,
			ForStatement: reportIfUnreachable,
			IfStatement: reportIfUnreachable,
			LabeledStatement: reportIfUnreachable,
			ReturnStatement: reportIfUnreachable,
			SwitchStatement: reportIfUnreachable,
			ThrowStatement: reportIfUnreachable,
			TryStatement: reportIfUnreachable,
			VariableDeclaration(node) {
				if (node.kind !== "var" || node.declarations.some(d => Boolean(d.init))) reportIfUnreachable(node);
			},
			WhileStatement: reportIfUnreachable,
			WithStatement: reportIfUnreachable,
			ExportNamedDeclaration: reportIfUnreachable,
			ExportDefaultDeclaration: reportIfUnreachable,
			ExportAllDeclaration: reportIfUnreachable,
			"Program:exit"() {
				reportIfUnreachable();
			},
			"MethodDefinition[kind='constructor']"() {
				constructorInfo = { upper: constructorInfo, hasSuperCall: false };
			},
			"MethodDefinition[kind='constructor']:exit"(node) {
				const { hasSuperCall } = constructorInfo;
				constructorInfo = constructorInfo.upper;
				if (!node.value.body) return;
				const classDefinition = node.parent.parent;
				if (classDefinition.superClass && !hasSuperCall) {
					for (const element of classDefinition.body.body) {
						if (element.type === "PropertyDefinition" && !element.static) reportIfUnreachable(element);
					}
				}
			},
			"CallExpression > Super.callee"() {
				if (constructorInfo) constructorInfo.hasSuperCall = true;
			},
		};
	},
};

const linter = new Linter();
let tsParser = null;
function verify(code, ts, jsx, sourceType) {
	const config = lo => ({ plugins: { t: { rules: { r: rule, real: require(path.join(R, "lib/rules/no-unreachable")) } } }, rules: { "t/r": 2, "t/real": 2 }, languageOptions: lo });
	if (ts) {
		tsParser = tsParser || require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
		return linter.verify(code, config({ parser: tsParser, parserOptions: { ecmaFeatures: { jsx } } }));
	}
	let first = null;
	for (const type of [sourceType || "module", "commonjs", "script"]) {
		const messages = linter.verify(code, config({ ecmaVersion: "latest", sourceType: type, parserOptions: { ecmaFeatures: { jsx: true } } }));
		if (!messages.some(m => m.fatal)) return messages;
		first = first || messages;
	}
	return first;
}
let cases = [];
if (opt("--cases")) {
	cases = JSON.parse(fs.readFileSync(opt("--cases"), "utf8"));
	if (opt("--kind")) cases = cases.filter(c => c.kind === opt("--kind"));
} else {
	for (const file of args.slice(args.indexOf("--files") + 1)) cases.push({ code: fs.readFileSync(file, "utf8"), kind: /\.tsx?$/u.test(file) ? "ts" : "js", jsx: !/\.ts$/u.test(file) });
}
let copyDiffers = 0;
for (const c of cases) {
	const messages = verify(c.code, c.kind === "ts", c.jsx, c.sourceType);
	const mine = messages.filter(m => m.ruleId === "t/r").map(m => `${m.line}:${m.column}`).join(",");
	const real = messages.filter(m => m.ruleId === "t/real").map(m => `${m.line}:${m.column}`).join(",");
	if (mine !== real) copyDiffers++;
	if (real) stats.sourcesWithReports++;
}
stats.reports /= 1;
console.log(JSON.stringify({ sources: cases.length, ...stats, copyDiffers }));
for (const m of mismatches.slice(0, 30)) console.log(JSON.stringify(m));
