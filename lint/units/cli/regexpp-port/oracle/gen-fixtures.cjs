// Writes the fixtures of regexpp's own tests in the one-line form of lib.cjs.
// usage: node gen-fixtures.cjs <out dir>      (reads /workspace/ref/regexpp at the pin of src/lint/UPSTREAM_PORTED)
//   literal.txt  test/fixtures/parser/literal/*.json          (regexpp, MIT)
//   test262.txt  test/fixtures/parser/literal/test262/*.json  (from test262, BSD: keep its LICENSE beside the file)
//   visitor.txt  test/fixtures/visitor/full.json
// A line `# <file> <ecmaVersion or -> <strict 0, 1 or ->` gives the options of the cases after it.
// A case of a literal: `<source> <dump>` or `<source> ! <index> <message>`.
// A case of the visitor: `<source>` then `+Type:<raw>` for an enter and `-Type:<raw>` for a leave.
"use strict";
const fs = require("fs");
const path = require("path");
const { q, b, revive, checkInvariants, dump } = require("./lib.cjs");

const REF = process.env.REGEXPP || "/workspace/ref/regexpp";
const out = process.argv[2];
if (!out) throw new Error("usage: node gen-fixtures.cjs <out dir>");
fs.mkdirSync(out, { recursive: true });

function literal(dir, files) {
	const lines = [];
	let cases = 0;
	for (const name of files) {
		const fixture = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
		const o = fixture.options;
		lines.push(`# ${name} ${o.ecmaVersion ?? "-"} ${o.strict === undefined ? "-" : b(o.strict)}`);
		for (const [source, result] of Object.entries(fixture.patterns)) {
			cases++;
			if ("ast" in result) {
				const ast = revive(result.ast);
				checkInvariants(ast, source);
				lines.push(`${q(source)} ${dump(ast)}`);
			} else {
				lines.push(`${q(source)} ! ${result.error.index} ${q(result.error.message)}`);
			}
		}
	}
	return { text: lines.join("\n") + "\n", cases };
}

const dir = path.join(REF, "test/fixtures/parser/literal");
const json = d => fs.readdirSync(d).filter(f => f.endsWith(".json")).sort();
const own = literal(dir, json(dir));
const t262 = literal(path.join(dir, "test262"), json(path.join(dir, "test262")));
fs.writeFileSync(path.join(out, "literal.txt"), own.text);
fs.writeFileSync(path.join(out, "test262.txt"), t262.text);

const visitor = JSON.parse(fs.readFileSync(path.join(REF, "test/fixtures/visitor/full.json"), "utf8"));
if (Object.keys(visitor.options).length !== 0) throw new Error("visitor fixture has options");
const events = Object.entries(visitor.patterns).map(
	([source, history]) =>
		q(source) +
		history
			.map(h => {
				const m = /^(enter|leave):([A-Za-z]+):([\s\S]*)$/.exec(h);
				return ` ${m[1] === "enter" ? "+" : "-"}${m[2]}:${q(m[3])}`;
			})
			.join(""),
);
fs.writeFileSync(path.join(out, "visitor.txt"), events.join("\n") + "\n");

for (const f of ["literal.txt", "test262.txt", "visitor.txt"]) {
	const text = fs.readFileSync(path.join(out, f), "latin1");
	if (/[^\x0a\x20-\x7e]/.test(text)) throw new Error(`${f} is not printable ASCII`);
	console.log(f, text.length, "bytes", text.split("\n").length - 1, "lines");
}
console.log({ literal: own.cases, test262: t262.cases, visitor: events.length });
