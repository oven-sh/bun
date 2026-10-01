// Generates switch statements whose case tests are random expressions and variations of each other.
// usage: node gen-dc.cjs <seed> <count> > out.json
"use strict";
let seed = Number(process.argv[2] || 1) >>> 0;
const count = Number(process.argv[3] || 200);
function rnd() {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 4294967296;
}
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const atoms = [
	"a", "b", "c", "x1", "$", "_", "\\u0061", "caseOf", "ainb", "this", "null", "true", "false", "undefined",
	"0", "1", "1.0", "1.", ".5", "0.5", "1e3", "1E3", "1e+3", "1_000", "0x10", "0X10", "0o7", "0b1", "017", "08", "1n", "0x1n",
	"'s'", '"s"', "'a b'", "'a  b'", "'it\\'s'", '"\\""', "'//'", "'/*'", "'*/'", "'case x:'", "')'", "'('", "'`'", "'?'", "':'",
	"`t`", "`a b`", "`${a}`", "`x${a}y${b}z`", "`${`${a}`}`", "`${{a:1}.a}`", "`}`", "`{`", "`\\``", "`$`", "`${a ? b : c}`", "`${'}'}`",
	"/r/", "/r/g", "/a b/", "/[/]/", "/\\//", "/:/", "/?/", "/(/", "/)/", "/'/", "/`/", "/[\\]/]/u",
	"[]", "[a]", "[a,]", "[a, b]", "[,a]", "[...a]", "{}", "{a}", "{a: 1}", "{a: b ? c : d}", "{'a': 1}", "{[a]: 1}", "{a() {}}", "{get a() { return 1 }}", "{...a}",
	"function(){}", "function f(a, b){ return a ? b : 1 }", "function(){ l: for(;;) break l }", "function(){ return /re/.test(a) }",
	"function(){ if (a) /re/.test(b) }", "function(){ a\n/b/g }", "function(){ x = {}\n/b/g }",
	"() => 1", "a => a", "(a) => a", "(a, b) => { return a }", "async () => 1", "async a => a", "() => ({})", "() => { a: 1 }",
	"class {}", "class A { static x = 1; #p = 2; m() { return this.#p } }", "new A", "new A()", "new A(a, b)", "new.target",
];
const ws = [" ", "  ", "\t", "\n", " /* c */ ", "/**/", " // c\n", " /* case */ ", " /* ( */ ", " /* : */ ", "\u00a0", "\u2003", "\ufeff"];
const sp = () => (chance(0.6) ? "" : pick(ws));
const gap = () => (chance(0.5) ? " " : pick(ws));

function expr(d) {
	if (d <= 0 || chance(0.3)) return pick(atoms);
	const k = Math.floor(rnd() * 16);
	const e = () => expr(d - 1);
	switch (k) {
		case 0:
			return `${e()}.${pick(["a", "b", "case", "default", "\\u0062", "if"])}`;
		case 1:
			return `${e()}[${e()}]`;
		case 2:
			return `${e()}(${chance(0.5) ? e() : ""})`;
		case 3:
			return `${e()} ${pick(["+", "-", "*", "/", "%", "**", "==", "===", "!=", "<", ">", "<=", ">=", "<<", ">>", ">>>", "&", "|", "^", "&&", "||", "in", "instanceof", ","])} ${e()}`;
		case 4:
			return `${e()} ? ${e()} : ${e()}`;
		case 5:
			return `(${e()})`;
		case 6:
			return `${pick(["!", "-", "+", "~", "typeof ", "void ", "delete "])}${e()}`;
		case 7:
			return `${e()}?.${pick(["a", "b"])}`;
		case 8:
			return `${e()}?.[${e()}]`;
		case 9:
			return `${e()}?.(${e()})`;
		case 10:
			return `(${e()}).${pick(["a", "b"])}`;
		case 11:
			return `${e()} ?? ${e()}`;
		case 12:
			return `a ${pick(["=", "+=", "&&=", "||=", "??=", ">>>=", "**="])} ${e()}`;
		case 13:
			return `${e()}\`t\${${e()}}u\``;
		case 14:
			return `[${e()}, ${e()}]`;
		default:
			return `{k: ${e()}}.k`;
	}
}

// A variation that keeps or changes the tokens.
function vary(s) {
	const k = Math.floor(rnd() * 9);
	switch (k) {
		case 0:
			return s;
		case 1:
			return `(${s})`;
		case 2:
			return `((${s}))`;
		case 3:
			return `${sp()}${s}${sp()}`;
		case 4:
			// More space where there is a space already (outside of literals this keeps the tokens).
			return s.replace(/ \? /g, () => `${gap()}?${gap()}`).replace(/ : /g, () => `${gap()}:${gap()}`);
		case 5:
			return s.replace(/'/g, '"');
		case 6:
			return `(${sp()}${s}${sp()})`;
		case 7:
			return s.replace(/ ([-+*%|&^]) /g, (m, op) => `${gap()}${op}${gap()}`);
		default:
			return `${s}${pick([".a", "[0]", "()", " + 1"])}`;
	}
}

const out = [];
for (let i = 0; i < count; i++) {
	const n = 2 + Math.floor(rnd() * 3);
	const tests = [];
	const base = expr(3);
	tests.push(base);
	for (let j = 1; j < n; j++) tests.push(chance(0.75) ? vary(pick(tests)) : expr(3));
	let body = "";
	for (const t of tests) {
		const stmt = pick(["", " break;", " { break }", " f(`case x:`); break;", " x = /case/; break;", "\n// case\n", " return <not jsx, a generic>;".slice(0, 0)]);
		body += `${sp()}case${chance(0.7) ? " " : gap()}${t}${sp()}:${stmt}\n`;
	}
	if (chance(0.3)) body += "default: break;\n";
	out.push(`switch${sp()}(q)${sp()}{${body}}`);
}
process.stdout.write(JSON.stringify(out));
