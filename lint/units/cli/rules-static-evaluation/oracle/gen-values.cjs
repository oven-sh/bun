// Research scratch: random expressions over the values that get_static_value of the plan knows. node gen-values.cjs <files> <seed> > list.json
"use strict";
const files = Number(process.argv[2] || 200);
let seed = Number(process.argv[3] || 1) >>> 0;
function rnd(n) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); }
const pick = a => a[rnd(a.length)];
const numbers = ["0", "1", "2", "3", "10", "255", "0.5", "1.5", "1e21", "1e-7", "4294967295", "4294967296", "2147483648", "9007199254740993", "0x10", "1_000", ".25", "5e-324", "1e400", "NaN", "Infinity", "-0"];
const strings = ["''", "'a'", "'b'", "'abc'", "'1'", "' 2 '", "'0x10'", "'-1'", "'1e3'", "'Infinity'", "'-Infinity'", "'0b11'", "'0o7'", "'.5'", "'5.'", "'1n'", "'\\n3\\t'", "'\\u00e9'", "'\\ud83d\\ude00'", "'null'", "'true'", "'12345678901234567890'", "'0x1fffffffffffff'", "'0x20000000000001'", "'0x20000000000003'", "'1_0'", "'+1'", "'+-1'", "'\\u00a05\\ufeff'", "`t`", "'/a/'"];
const bigints = ["0n", "1n", "2n", "3n", "10n", "0x10n", "255n", "9007199254740993n", "100000000000000000000n"];
const others = ["null", "undefined", "true", "false", "void 0", "/a/", "/a/gi", "x"];
function leaf() { return pick([numbers, numbers, strings, strings, bigints, others])[0] === undefined ? "0" : pick(pick([numbers, numbers, strings, strings, bigints, others])); }
const binary = ["+", "-", "*", "/", "%", "**", "<<", ">>", ">>>", "|", "^", "&", "==", "!=", "===", "!==", "<", "<=", ">", ">="];
const unary = ["-", "+", "!", "~", "typeof ", "void "];
function expr(depth) {
	if (depth <= 0) return leaf();
	switch (rnd(12)) {
		case 0: case 1: case 2: case 3: case 4: return `(${expr(depth - 1)} ${pick(binary)} ${expr(depth - 1)})`;
		case 5: case 6: return `(${pick(unary)}(${expr(depth - 1)}))`;
		case 7: return `(${expr(depth - 1)} ${pick(["||", "&&", "??"])} ${expr(depth - 1)})`;
		case 8: return `(${expr(depth - 1)} ? ${expr(depth - 1)} : ${expr(depth - 1)})`;
		case 9: return "`a${" + expr(depth - 1) + "}b${" + expr(depth - 1) + "}`";
		case 10: return `(${expr(depth - 1)})${pick([".length", "[0]", "[1]", "[5]", "?.length", ".source", ".flags", ".global"])}`;
		default: return `(${expr(depth - 1)}, ${expr(depth - 1)})`;
	}
}
const out = [];
for (let f = 0; f < files; f++) {
	const stmts = [];
	for (let i = 0; i < 25; i++) stmts.push(`(${expr(1 + rnd(3))});`);
	out.push(stmts.join("\n"));
}
process.stdout.write(JSON.stringify(out));
