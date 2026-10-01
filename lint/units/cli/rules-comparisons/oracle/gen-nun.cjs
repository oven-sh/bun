// Scratch: generated corpus for the parenthesis question of no-unsafe-negation.
const { verdicts, eslintReports, offsetOf } = require("./scan.cjs");

const operands = [
	"a",
	"a.b",
	"a[0]",
	'a["x)"]',
	"a['(']",
	"f()",
	'f(")")',
	'f("(")',
	"f(/\\)/)",
	"f(/[(]/g)",
	"f(/=[(]/)",
	"f(x /= /=[)]/)",
	"f(`)`)",
	"f(`(${g(')')}`)",
	"f(`${`(${'('}`}(`)",
	"f(`${ {a:'('}.a }(`)",
	"a /* ) */ .b",
	"a // (\n .b",
	"(a)",
	"((a))",
	"(a, b)",
	'new C(")")',
	"new C",
	'function(){ return ")" }',
	"function(){ if (x) /\\(/.test(y) }",
	"function(){ return x / 2 / (1) }",
	"function(){ return x /(2)/ 1 }",
	'class { static x = "(" }',
	'[")"]',
	'{ ")": 1 }',
	"a++",
	"a?.b",
	'a?.[")"]',
	"tag`(`",
	"tag`${ '(' })`",
	"<a/>",
	"<a>)</a>",
	'<a b="(" />',
	"<a b='\"(' />",
	'<a b={")"} />',
	"<a>{/* ( */}</a>",
	"<>(</>",
	"<a>{<b>(</b>}</a>",
	"<a.b>(</a.b>",
	"<a>'(</a>",
	'f(1 / 2 / 3, ")")',
	"f(x / y, /[)]/)",
	"f(x /2/ y, '(')",
	"!a",
	"-a",
	"typeof a",
	"await_",
	"'\\''+'('",
	'"\\\\"',
	'"\\\\" + ")"',
	"`\\``",
	"`\\${(`",
	"`$(`",
	"`}(${ '}' }{)`",
	"/[/]\\)/",
	"/\\//.x(')')",
	"\u00e9['(']",
	"'\u{1F600})'",
	"a.in",
	"a.instanceof",
];
const wrappers = [
	v => `!${v}`,
	v => `(!${v})`,
	v => `((!${v}))`,
	v => `( /* ( */ !${v} /* ) */ )`,
	v => `(\n// (\n!${v}\n// )\n)`,
	v => `! /* ( */ ${v}`,
	v => `(! /* ) */ ${v})`,
];
const contexts = [
	e => e,
	e => `if (${e}) {}`,
	e => `x = ${e}`,
	e => `foo(${e})`,
	e => `[${e}]`,
	e => "`${" + e + "}`",
	e => `(${e})`,
	e => `a(")") + (${e})`,
];
const operators = ["in", "instanceof"];
const rights = ["b", "(b)", "/* ( */ b", "(b).c", "(\n// )\n b)"];

let checked = 0;
let candidates = 0;
let skipped = 0;
let bad = 0;
let parenthesised = 0;
for (const operand of operands) {
	for (const wrap of wrappers) {
		for (const context of contexts) {
			for (const operator of operators) {
				for (const right of rights) {
					const code = context(`${wrap(operand)} ${operator} ${right}`);
					const msgs = eslintReports(code, "module");
					if (msgs === null) {
						skipped++;
						continue;
					}
					checked++;
					const reported = new Set(msgs.map(m => offsetOf(code, m.line, m.column)));
					for (const v of verdicts(code, "module")) {
						candidates++;
						const expected = reported.has(v.at);
						if (v.result.unknown) {
							bad++;
							console.log(`UNKNOWN ${v.result.unknown} ` + JSON.stringify(code));
							continue;
						}
						if (v.result.parenthesised) parenthesised++;
						if (!v.result.parenthesised !== expected) {
							bad++;
							console.log(
								`MISMATCH eslint=${expected} scan=${!v.result.parenthesised} ` + JSON.stringify(code),
							);
						}
						reported.delete(v.at);
					}
					for (const at of reported) {
						bad++;
						console.log("MISSED " + at + " " + JSON.stringify(code));
					}
				}
			}
		}
	}
}
console.log(
	`${checked} cases parsed, ${skipped} did not parse, ${candidates} candidates, ${parenthesised} parenthesised, ${bad} disagreements`,
);
