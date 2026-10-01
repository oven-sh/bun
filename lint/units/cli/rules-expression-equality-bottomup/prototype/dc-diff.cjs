// Differential check of the no-duplicate-case algorithm (tok.cjs) against ESLint at the pin.
// usage: node dc-diff.cjs <cases.json> [--show]
"use strict";
const path = require("path");
const fs = require("fs");
const espree = require(path.join(__dirname, "eslint-pin/node_modules/espree"));
const { Linter } = require(path.join(__dirname, "eslint-pin/lib/linter"));
const T = require("./tok.cjs");

const linter = new Linter({ configType: "flat" });

// The start that Bun's tree gives: the first token of the leftmost operand, parentheses not counted.
function bunStart(n) {
	switch (n.type) {
		case "MemberExpression":
			return bunStart(n.object);
		case "CallExpression":
			return bunStart(n.callee);
		case "BinaryExpression":
		case "LogicalExpression":
		case "AssignmentExpression":
			return bunStart(n.left);
		case "ConditionalExpression":
			return bunStart(n.test);
		case "SequenceExpression":
			return bunStart(n.expressions[0]);
		case "TaggedTemplateExpression":
			return bunStart(n.tag);
		case "UpdateExpression":
			return n.prefix ? n.range[0] : bunStart(n.argument);
		case "ChainExpression":
			return bunStart(n.expression);
		default:
			return n.range[0];
	}
}

function walk(n, f) {
	if (!n || typeof n.type !== "string") return;
	f(n);
	for (const k of Object.keys(n)) {
		if (k === "parent") continue;
		const v = n[k];
		if (Array.isArray(v)) for (const x of v) walk(x, f);
		else if (v && typeof v === "object") walk(v, f);
	}
}

function byteOffsets(code) {
	// UTF-16 index -> UTF-8 byte offset.
	const map = new Array(code.length + 1);
	let b = 0;
	for (let i = 0; i < code.length; i++) {
		map[i] = b;
		const cp = code.codePointAt(i);
		if (cp > 0xffff) {
			map[i + 1] = b;
			i += 1;
			b += 4;
		} else b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
	}
	map[code.length] = b;
	return map;
}

function mine(code, jsx) {
	const ast = espree.parse(code, { ecmaVersion: "latest", range: true, loc: true, ecmaFeatures: { jsx } });
	const src = Buffer.from(code, "utf8");
	const at = byteOffsets(code);
	const reports = [];
	walk(ast, n => {
		if (n.type !== "SwitchStatement") return;
		// body_loc of Bun: the open brace of the switch body.
		const afterDisc = at[n.discriminant.range[1]];
		let brace = afterDisc;
		for (;;) {
			brace = T.skipTrivia(src, brace);
			if (src[brace] === 0x29) brace += 1;
			else break;
		}
		if (src[brace] !== 0x7b) throw new Error("no brace");
		const seen = [];
		for (const c of n.cases) {
			if (!c.test) continue;
			const regex = [];
			let hasJsx = false;
			walk(c.test, m => {
				if (m.type === "Literal" && m.regex) regex.push([at[m.range[0]], at[m.range[1]]]);
				if (m.type === "JSXElement" || m.type === "JSXFragment") hasJsx = true;
			});
			regex.sort((x, y) => x[0] - y[0]);
			const start = at[bunStart(c.test)];
			const scan = hasJsx ? null : T.scanCaseTest(src, start, regex);
			// The keyword must be where the text says: else the start of the test is not trusted.
			const kw = scan ? T.findCaseKeyword(src, start, scan.leadingCloses, brace + 1) : -1;
			if (!scan || kw < 0) {
				reports.push({ note: "not comparable", at: start });
				continue;
			}
			if (seen.some(p => T.sameTest(src, p, scan))) {
				reports.push({ start: kw, len: scan.colon + 1 - kw });
			} else seen.push(scan);
		}
	});
	return { reports, at };
}

function theirs(code, jsx) {
	const messages = linter.verify(code, [
		{
			languageOptions: { ecmaVersion: "latest", sourceType: "script", parserOptions: { ecmaFeatures: { jsx } } },
			rules: { "no-duplicate-case": "error" },
		},
	]);
	return messages;
}

function lineColToIndex(code, line, column) {
	// ESLint: 1-based line, 1-based column in UTF-16 units. Line ends as espree counts them.
	let l = 1;
	let i = 0;
	while (l < line) {
		const ch = code[i];
		if (ch === "\r" && code[i + 1] === "\n") i += 1;
		if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") l += 1;
		i += 1;
	}
	return i + column - 1;
}

module.exports = { mine, lineColToIndex };
if (require.main === module) {
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const show = process.argv.includes("--show");
let bad = 0;
let total = 0;
let notComparable = 0;
for (const c of cases) {
	const code = typeof c === "string" ? c : c.code;
	const jsx = typeof c === "object" && !!c.jsx;
	total += 1;
	let m;
	let t;
	try {
		t = theirs(code, jsx);
		if (t.some(x => x.fatal)) {
			console.log("SKIP (espree rejects):", JSON.stringify(code), t[0].message);
			continue;
		}
		m = mine(code, jsx);
	} catch (e) {
		bad += 1;
		console.log("THROW", JSON.stringify(code), e.message);
		continue;
	}
	const want = t.map(x => m.at[lineColToIndex(code, x.line, x.column)]);
	const got = m.reports.filter(r => r.start !== undefined).map(r => r.start).sort((x, y) => x - y);
	notComparable += m.reports.filter(r => r.note).length;
	const same = want.length === got.length && want.every((w, i) => w === got[i]);
	if (!same) {
		bad += 1;
		console.log("DIFF", JSON.stringify(code), "eslint:", JSON.stringify(want), "mine:", JSON.stringify(got));
	} else if (show) {
		console.log("ok  ", JSON.stringify(code), JSON.stringify(m.reports));
	}
}
console.log(`total=${total} differ=${bad} notComparableTests=${notComparable}`);

}
