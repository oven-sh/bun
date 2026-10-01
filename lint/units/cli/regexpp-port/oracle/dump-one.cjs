// Prints what regexpp answers for one source, in the form of the fixture files. The source is read as a JSON string.
// usage: node dump-one.cjs literal '"/a|b/u"' [ecmaVersion] [strict 0|1]
//        node dump-one.cjs pattern '"a|b"' <flags: -, u, v, uv> [ecmaVersion] [strict 0|1]
"use strict";
const { q, checkInvariants, dump } = require("./lib.cjs");
const regexpp = require(process.env.REGEXPP_BUILD || "/workspace/ref/eslint/node_modules/@eslint-community/regexpp");
const [kind, text, ...rest] = process.argv.slice(2);
const source = JSON.parse(text);
const flags = kind === "pattern" ? rest.shift() : "";
const options = {};
if (rest[0] !== undefined && rest[0] !== "-") options.ecmaVersion = Number(rest[0]);
if (rest[1] !== undefined && rest[1] !== "-") options.strict = rest[1] === "1";
let result;
try {
	const ast =
		kind === "pattern"
			? new regexpp.RegExpParser(options).parsePattern(source, 0, source.length, { unicode: flags.includes("u"), unicodeSets: flags.includes("v") })
			: regexpp.parseRegExpLiteral(source, options);
	checkInvariants(ast, source);
	result = dump(ast);
} catch (error) {
	result = error instanceof regexpp.RegExpSyntaxError ? `! ${error.index} ${q(error.message)}` : "!!";
}
console.log(`${q(source)} ${result}`);
