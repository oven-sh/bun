// Research scratch. Random expressions through the prototype and ESLint: node fuzz.cjs [count] [seed]
"use strict";
const { run } = require("./proto.cjs");
let seed = Number(process.argv[3] || 1);
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = l => l[rnd(l.length)];
const leaves = ["a", "b", "true", "false", "0", "1", "''", "'x'", "null", "undefined", "void 0", "{}", "[]", "[a]", "!a", "!1", "!!a", "(x = 1)", "(x = a)", "(x ||= true)", "(x &&= false)", "(x ??= 1)", "(a, 1)", "(1, a)", "typeof a", "Boolean(1)", "Boolean(a)", "Boolean()", "new Foo", "new Boolean(a)", "`a`", "`${a}`", "`x${a}`", "0n", "1n", "/r/", "a?.b", "(a?.b).c", "f()", "-1", "-a", "a++", "() => a", "class {}", "this", "String(a)", "(a ? {} : [])", "(a ? 1 : b)", "new Map"];
const ops = ["||", "||", "&&", "&&", "??", "==", "===", "!=", "!==", "+", "in", "<", "instanceof", ","];
const prec = { ",": 0, "??": 2, "||": 2, "&&": 3, "==": 5, "===": 5, "!=": 5, "!==": 5, "<": 6, in: 6, instanceof: 6, "+": 7 };
function gen(depth) {
	if (depth === 0 || rnd(4) === 0) return { text: pick(leaves), p: 9, op: null };
	const op = pick(ops);
	let l = gen(depth - 1), r = gen(depth - 1);
	const wrap = (e, right) => {
		const mixed = (op === "??" && (e.op === "||" || e.op === "&&")) || ((op === "||" || op === "&&") && e.op === "??");
		const need = e.p < prec[op] || (right && e.p === prec[op]) || mixed || rnd(6) === 0;
		return need ? `(${e.text})` : e.text;
	};
	return { text: `${wrap(l, false)} ${op} ${wrap(r, true)}`, p: prec[op], op };
}
const count = Number(process.argv[2] || 2000);
const shapes = [e => `if (${e}) {}`, e => `x = ${e.includes(",") ? `(${e})` : e}`, e => `while (${e}) {}`, e => `y = ${e.includes(",") ? `(${e})` : e} ? 1 : 2`, e => `if (a) {} else if (${e}) {} else if (${e}) {}`, e => `function* g() { for (;${e};) { if (c) yield; } do {} while (${e}) }`, e => `(${e})(); [...(${e})]; new (${e});`];
let same = 0, differ = 0, fatal = 0;
for (let i = 0; i < count; i++) {
	const code = pick(shapes)(gen(1 + rnd(4)).text);
	const r = run(code, {});
	if (r.fatal) { fatal++; continue; }
	if (JSON.stringify(r.eslint) === JSON.stringify(r.proto)) same++;
	else { differ++; if (differ <= 15) console.log(`DIFFER ${JSON.stringify(code)}\n    eslint: ${r.eslint.join(" | ")}\n    proto:  ${r.proto.join(" | ")}`); }
}
console.log(`random cases ${count}: same ${same}, differ ${differ}, rejected by the parser ${fatal}`);
