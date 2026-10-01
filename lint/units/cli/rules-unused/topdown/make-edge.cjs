// Research scratch of "rules-unused" (pass 1b): generated cases of no-unused-private-class-members: each way to
// declare a private name, crossed with each place a member can stand in and each thing that can stand around it.
// usage: node make-edge.cjs js|ts [--small] > out.json
//   all of them (7,084 js, 33,516 ts) are for nupcm-sim.cjs and nupcm-real.cjs; --small (cases/edge-js.json, cases/edge-ts.json) is for the fixture.
"use strict";
const ts = process.argv[2] === "ts";
const decls = ["#x;", "#x = 1;", "static #x;", "#x() {}", "static #x() {}", "get #x() { return 1; }", "set #x(v) {}", "get #x() { return 1; } set #x(v) {}", "static get #x() { return 1; }", "async #x() {}", "*#x() {}"];
if (ts) decls.push("declare #x: number;", "#x(): void; #x() {}", "accessor #x = 1;", "readonly #x = 1;", "static readonly #x: number = 1;", "#x!: number;", "#x?: number;", "private y = 1; #x = 1;");
const members = ["this.#x", "(this.#x)", "a.#x", "this.b.#x", "((this.#x))"];
if (ts) members.push("this.#x!", "(this.#x as any)", "(<any>this.#x)", "(this.#x satisfies any)", "(this.#x)!", "(this.#x!)", "this.#x!!");
// `M` is the member.
const places = [
	"M;", "M = 1;", "M += 1;", "M -= 1;", "M ??= 1;", "M ||= 1;", "M &&= 1;", "M++;", "M--;", "++M;", "--M;",
	"x = M;", "x = M = 1;", "x = (M += 1);", "x = M++;", "f(M++);", "f(M = 1);", "f(M += 1);", "(M++, 0);", "(0, M++);", "(0, M += 1);", "(0, M = 1);",
	"[M] = a;", "[M = 1] = a;", "[...M] = a;", "[, M] = a;", "({ y: M } = a);", "({ y: M = 1 } = a);", "({ ...M } = a);", "({ [M]: y } = a);", "({ [M]: M } = a);",
	"[[M]] = a;", "[{ y: M }] = a;", "({ y: [M] } = a);", "({ y: { z: M } } = a);", "[[...M]] = a;", "x = [M] = a;", "f([M] = a);",
	"for (M in a);", "for (M of a);", "for ([M] of a);", "for ({ y: M } of a);", "for ([M = 1] of a);", "for ([...M] of a);",
	"for (M++;;) break;", "for (M += 1;;) break;", "for (M = 1;;) break;", "for (;;M++) break;", "for (;;M += 1) break;", "for (;M;) break;", "for (const k in M);", "for (const k of M);", "for (let i = M;;) break;",
	"l: M++;", "if (a) M++;", "if (a) M += 1; else M -= 1;", "while (a) M++;", "do M++; while (a);", "for (;;) M++;", "{ M++; }", "try { M++; } catch {}", "switch (a) { case 1: M++; }",
	"() => M++;", "() => M = 1;", "() => M += 1;", "() => { M++; };", "(function () { M++; });",
	"M.y = 1;", "M.y++;", "M[0] = 1;", "[M.y] = a;", "M.y;", "delete M.y;", "typeof M;", "void M;", "!M;", "-M;",
	"M();", "new M();", "M``;", "`${M}`;", "x = [M];", "x = { y: M };", "x = { ...M };", "x = { [M]: 1 };", "f(...M);", "f(M);",
	"return M;", "return M = 1;", "return M++;", "throw M;", "M ? 1 : 2;", "a ? M : 2;", "a ? M++ : 2;", "M && 1;", "a && M++;", "a && (M = 1);", "a && (M += 1);", "x ||= M;",
	"M = M + 1;", "M += M;", "M = M;", "[M, M] = a;", "M = 1, M;", "switch (M) {}", "while (M) break;", "do {} while (M);", "if (M) {}",
	"#x in this;", "x = #x in a;", "if (#x in a) {}", "(#x in a) && f();",
	"class B extends (M) {}", "class B { [M] = 1; }", "class B { #x; m() { M; } }", "class B { #x; m() { M = 1; } }", "class B { m() { M; } }", "class B { static { M; } }", "class B extends (M) { #x; }",
	"class B { #x; m() { M; } } M = 1;", "class B { get #x() { return 1; } m() { M = 1; } }", "class B { #y; m() { M; } }", "x = class { #x; }; M;", "x = class { #x; m() { return M; } };",
];
if (ts) places.push("(M++) as any;", "(M += 1) as any;", "(M = 1) as any;", "(M++)!;", "(M += 1)!;", "<any>(M++);", "(M++) satisfies any;", "(M as any)++;", "(M as any) += 1;", "[M as any] = a;", "({ y: M as any } = a);", "for ((M as any) of a);", "let y: number = M;", "const z = M as number;", "M!.y;", "enum E { A = 1 } M;", "namespace N { export const q = 1; } M;", "function g(this: any, p = 1) {} M;");
if (ts) places.push("class B { #x(a = M): void; #x() {} }", "class B { declare y: number; #x = M; }", "abstract class B { abstract y(a?: any): void; m() { M; } }");
const small = process.argv.includes("--small");
const keyPlaces = new Set(["M;", "M = 1;", "M += 1;", "M++;", "x = M;", "x = M++;", "[M] = a;", "({ y: M } = a);", "for (M in a);", "for (M++;;) break;", "#x in this;", "class B { #x; m() { M; } }", "M = M + 1;", "() => M++;"]);
const tsOnly = new Set(places.slice(places.indexOf("(M++) as any;")));
const out = [];
for (const d of decls) for (const p of places) for (const m of members) {
	if (small) {
		const plain = m === "this.#x", first = d === "#x = 1;";
		const keep = (first && plain && (!ts || tsOnly.has(p))) || (!first && plain && keyPlaces.has(p) && (!ts || decls.indexOf(d) >= 11)) || (d === "#x;" && !plain && keyPlaces.has(p) && (!ts || members.indexOf(m) >= 5));
		if (!keep) continue;
	}
	// A place that does not hold the member twice is tried with each form of the member; the others only with the plain one.
	const body = p.split("M").join(m);
	out.push({ code: `class A { ${d} m(a, x, f, y) { ${body} } }`, ext: ts ? "ts" : "js" });
}
// Where the member stands outside a method.
for (const d of decls) for (const m of members.slice(0, 2)) {
	if (small && (ts || !(d === "#x = 1;" || d === "static #x;") || m !== "this.#x")) continue;
	for (const body of [`y = ${m};`, `static y = A.#x;`, `static { ${m.replace("this", "A")}++; }`, `static { ${m} = 1; }`, `[${m.replace("this", "A")}] = 1;`, `m(p = ${m}) {}`, `m([p = ${m}]) {}`, `m({ q = ${m} }) {}`, `get y() { return ${m}; }`, `set y(v) { ${m} = v; }`, `constructor() { ${m} = 1; }`, `constructor() { ${m}++; }`]) out.push({ code: `class A { ${d} ${body} }`, ext: ts ? "ts" : "js" });
}
process.stdout.write(JSON.stringify(out));
process.stderr.write(`${out.length} cases\n`);
