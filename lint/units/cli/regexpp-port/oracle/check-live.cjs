// Runs the build of regexpp that ESLint resolves on every case of the files that gen-fixtures.cjs wrote and compares.
// usage: node check-live.cjs <dir with literal.txt, test262.txt, visitor.txt>
"use strict";
const fs = require("fs");
const path = require("path");
const { q, checkInvariants, dump } = require("./lib.cjs");
const regexpp = require(process.env.REGEXPP_BUILD || "/workspace/ref/eslint/node_modules/@eslint-community/regexpp");

const unq = s => JSON.parse(s);
// The first string of a line and what follows it.
function split(line) {
	let i = 1;
	while (line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
	return [unq(line.slice(0, i + 1)), line.slice(i + 2)];
}
let cases = 0;
let wrong = 0;
for (const file of ["literal.txt", "test262.txt"]) {
	let options = {};
	for (const line of fs.readFileSync(path.join(process.argv[2], file), "utf8").split("\n")) {
		if (line === "") continue;
		if (line.startsWith("# ")) {
			const [, , version, strict] = line.split(" ");
			options = {};
			if (version !== "-") options.ecmaVersion = Number(version);
			if (strict !== "-") options.strict = strict === "1";
			continue;
		}
		const [source, expected] = split(line);
		let actual;
		try {
			const ast = regexpp.parseRegExpLiteral(source, options);
			checkInvariants(ast, source);
			actual = dump(ast);
		} catch (error) {
			actual = error instanceof regexpp.RegExpSyntaxError ? `! ${error.index} ${q(error.message)}` : `!! ${q(String(error))}`;
		}
		cases++;
		if (actual !== expected) {
			wrong++;
			if (wrong <= 5) console.log(`${file}: ${q(source)}\n  expected ${expected}\n  actual   ${actual}`);
		}
	}
}
let visits = 0;
for (const line of fs.readFileSync(path.join(process.argv[2], "visitor.txt"), "utf8").split("\n")) {
	if (line === "") continue;
	const [source, expected] = split(line);
	const history = [];
	const on = sign => node => history.push(`${sign}${node.type}:${q(node.raw)}`);
	const handlers = {};
	for (const type of "Alternative Assertion Backreference CapturingGroup Character CharacterClass CharacterClassRange CharacterSet ClassIntersection ClassStringDisjunction ClassSubtraction ExpressionCharacterClass Flags Group ModifierFlags Modifiers Pattern Quantifier RegExpLiteral StringAlternative".split(" ")) {
		handlers[`on${type}Enter`] = on("+");
		handlers[`on${type}Leave`] = on("-");
	}
	regexpp.visitRegExpAST(regexpp.parseRegExpLiteral(source, {}), handlers);
	visits++;
	if (history.join(" ") !== expected) {
		wrong++;
		if (wrong <= 5) console.log(`visitor.txt: ${q(source)}`);
	}
}
console.log({ cases, visits, wrong });
process.exit(wrong === 0 ? 0 : 1);
