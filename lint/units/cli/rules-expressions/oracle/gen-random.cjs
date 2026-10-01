// Research scratch. Random expressions as a list of cases: node gen-random.cjs <count> <seed> > list.json
"use strict";
let seed = Number(process.argv[3] || 1);
const rnd = n => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const pick = l => l[rnd(l.length)];
const leaves = ["a", "b", "true", "false", "0", "1", "''", "'x'", "null", "undefined", "void 0", "{}", "[]", "[a]", "!a", "!1", "!!a", "(x = 1)", "(x = a)", "(x ||= true)", "(x &&= false)", "(x ??= 1)", "(a, 1)", "(1, a)", "typeof a", "Boolean(1)", "Boolean(a)", "Boolean()", "new Foo", "new Boolean(a)", "`a`", "`${a}`", "`x${a}`", "0n", "1n", "/r/", "a?.b", "(a?.b).c", "f()", "-1", "-a", "typeof b", "(a++)", "(() => a)", "class {}", "this", "String(a)", "(a ? {} : [])", "(a ? 1 : b)", "new Map", "(a).b", "((a))", "(a)(b)", "(a)`t`", "(a)[0]", "(a)++"];
const ops = ["||", "||", "||", "&&", "&&", "??", "==", "===", "!=", "!==", "+", "in", "<", "instanceof", ","];
const prec = { ",": 0, "??": 2, "||": 2, "&&": 3, "==": 5, "===": 5, "!=": 5, "!==": 5, "<": 6, in: 6, instanceof: 6, "+": 7 };
function gen(depth) {
	if (depth === 0 || rnd(5) === 0) return { text: pick(leaves), p: 9, op: null };
	const op = pick(ops);
	const l = gen(depth - 1), r = gen(rnd(3) === 0 ? depth - 1 : 0);
	const wrap = (e, right) => {
		const mixed = (op === "??" && (e.op === "||" || e.op === "&&")) || ((op === "||" || op === "&&") && e.op === "??");
		const need = e.p < prec[op] || (right && e.p === prec[op]) || mixed || rnd(7) === 0;
		return need ? `(${e.text})` : e.text;
	};
	return { text: `${wrap(l, false)} ${op} ${wrap(r, true)}`, p: prec[op], op };
}
const shapes = [e => `if (${e}) {}`, e => `x = ${e.includes(",") ? `(${e})` : e}`, e => `while (${e}) {}`, e => `y = ${e.includes(",") ? `(${e})` : e} ? 1 : 2`, e => `if (a) {} else if (${e}) {} else if (${e}) {}`, e => `function* g() { for (;${e};) { if (c) yield; } do {} while (${e}) }`, e => `(${e})(); [...(${e})]; new (${e});`, e => `if (${e}) {} else if (b || ${e.includes(",") ? `(${e})` : e}) {}`];
const out = [];
for (let i = 0; i < Number(process.argv[2] || 1000); i++) out.push(pick(shapes)(gen(1 + rnd(7)).text));
process.stdout.write(JSON.stringify([...new Set(out)]));
