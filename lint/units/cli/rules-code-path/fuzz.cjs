// Research scratch (rules-code-path): random sources for the four rules. Constructors of classes with `extends` whose
// bodies are full of jumps, loops, `super()`, `this` and `super.x`; getters with such bodies; `switch` statements with
// comments and blank lines between the clauses.
// usage: node fuzz.cjs <count> <seed> <out.json> [ctor|getter|switch|all]
"use strict";
const fs = require("fs");
const [count, seed, outJson, what = "all"] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
let state = seed >>> 0 || 1;
const rnd = n => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const pick = a => a[rnd(a.length)];
let names = 0;
let budget = 0;
const id = () => pick(["a", "b", "c", "d", "x", "y"]);
function leaf(ctx) {
	const leaves = [id(), id(), "1", "0", "true", "false", "null", "''", `${id()}.${id()}`, `${id()}()`];
	if (ctx.ctor) leaves.push("this", "this.p", "this.m()", "super.p", "super.m()", "super[a]", "super()", "super()", "super(a)", "this", "super()");
	return pick(leaves);
}
function expr(depth, ctx) {
	if (--budget <= 0 || depth <= 0) return leaf(ctx);
	const e = () => expr(depth - 1, ctx);
	switch (rnd(20)) {
		case 0: return `${e()} && ${e()}`;
		case 1: return `${e()} || ${e()}`;
		case 2: return `(${e()}) ?? (${e()})`;
		case 3: return `(${e()} ? ${e()} : ${e()})`;
		case 4: return `${id()} = ${e()}`;
		case 5: return `${id()} ||= ${e()}`;
		case 6: return `${id()} &&= ${e()}`;
		case 7: return `${id()} ??= ${e()}`;
		case 8: return `(${e()}, ${e()})`;
		case 9: return `() => ${expr(depth - 1, { ...ctx })}`;
		case 10: return `function () { ${stmts(1, 2, { ...ctx, ctor: false, fn: true, loop: false, brk: false, labels: [], loopLabels: [] })} }`;
		case 11: return `new ${id()}(${e()})`;
		case 12: return `!${e()}`;
		case 13: return `${id()}?.${id()}?.(${e()})`;
		case 14: return `foo(${e()}, ${e()})`;
		case 15: return `[${e()}, ...${id()}]`;
		case 16: return `\`a\${${e()}}b\``;
		case 17: return `class extends ${heritage()} { ${pick(["", "f = 1;", `constructor() { ${stmts(1, 2, { ctor: true, fn: true, loop: false, brk: false, labels: [], loopLabels: [] })} }`])} }`;
		default: return leaf(ctx);
	}
}
function stmt(depth, ctx) {
	const e = () => expr(rnd(3), ctx);
	if (--budget <= 0 || depth <= 0) {
		const simple = [`${e()};`, `${e()};`, `${e()};`, `var ${id()} = ${e()};`, ";", `throw ${e()};`];
		if (ctx.fn) simple.push("return;", `return ${e()};`);
		if (ctx.loop) simple.push("continue;");
		if (ctx.brk) simple.push("break;", "break;");
		if (ctx.labels.length) simple.push(`break ${pick(ctx.labels)};`);
		if (ctx.loopLabels.length) simple.push(`continue ${pick(ctx.loopLabels)};`);
		if (ctx.ctor) simple.push("super();", "super();", "this.x = 1;", "super.y;", "this;");
		return pick(simple);
	}
	const inner = (extra, n = 2) => stmts(depth - 1, n, { ...ctx, ...extra });
	const one = extra => stmt(depth - 1, { ...ctx, ...extra });
	switch (rnd(22)) {
		case 0: return `{ ${inner({})} }`;
		case 1: return `if (${e()}) ${one({})}`;
		case 2: return `if (${e()}) ${one({})} else ${one({})}`;
		case 3: return `if (${e()}) { ${inner({})} } else { ${inner({})} }`;
		case 4: return `while (${pick([e(), "true", "1", "false"])}) ${one({ loop: true, brk: true })}`;
		case 5: return `do { ${inner({ loop: true, brk: true })} } while (${pick([e(), "true", "0"])});`;
		case 6: return `for (${pick(["", "var i = 0", `${id()} = 0`, e()])}; ${pick(["", e(), "true"])}; ${pick(["", `${id()}++`, e(), e()])}) { ${inner({ loop: true, brk: true })} }`;
		case 7: return `for (${pick(["var k", "const k", id()])} ${pick(["in", "of"])} ${e()}) ${one({ loop: true, brk: true })}`;
		case 8: return switchStmt(depth, ctx, false);
		case 9: return `try { ${inner({})} } catch${pick(["", " (e)"])} { ${inner({})} }`;
		case 10: return `try { ${inner({})} } finally { ${inner({})} }`;
		case 11: return `try { ${inner({})} } catch (e) { ${inner({})} } finally { ${inner({})} }`;
		case 12: { const l = `L${names++}`; return `${l}: { ${inner({ labels: [...ctx.labels, l] })} }`; }
		case 13: { const l = `L${names++}`; return `${l}: while (${e()}) { ${inner({ loop: true, brk: true, labels: [...ctx.labels, l], loopLabels: [...ctx.loopLabels, l] })} }`; }
		case 14: { const l = `L${names++}`; return `${l}: for (;;) { ${inner({ loop: true, brk: true, labels: [...ctx.labels, l], loopLabels: [...ctx.loopLabels, l] })} }`; }
		case 15: return `for (;;) ${one({ loop: true, brk: true })}`;
		default: return stmt(0, ctx);
	}
}
const COMMENTS = ["// falls through", "/* falls through */", "// fall through", "// fallthrough", "/* FALLS THROUGH */", "// no break", "/* eslint-disable falls through */", "// falls  through", "/* x */ // falls through", "// falls through\n/* y */", "// globals falls through", "//falls\tthrough", "/*\n falls through\n*/"];
function switchStmt(depth, ctx, withComments) {
	const e = () => expr(rnd(2), ctx);
	let s = `switch (${e()}) {`;
	const n = rnd(5);
	let hasDefault = false;
	for (let i = 0; i < n; i++) {
		s += pick([" ", "\n", "\n\n", " ", withComments ? `\n${pick(COMMENTS)}\n` : " ", withComments ? ` ${pick(COMMENTS)}\n` : "\n"]);
		if (!hasDefault && rnd(4) === 0) { s += "default:"; hasDefault = true; } else s += `case ${e()}:`;
		const k = rnd(6);
		if (k === 0) s += "";
		else if (k === 1) s += ` { ${stmts(depth - 1, 2, { ...ctx, brk: true })}${withComments ? pick(["", ` ${pick(COMMENTS)}\n`, "\n"]) : ""} }`;
		else s += ` ${stmts(depth - 1, rnd(3), { ...ctx, brk: true })}`;
	}
	return `${s}${pick([" ", "\n", withComments ? `\n${pick(COMMENTS)}\n` : " "])}}`;
}
function stmts(depth, n, ctx) {
	const full = { fn: false, loop: false, brk: false, labels: [], loopLabels: [], ctor: false, ...ctx };
	const out = [];
	const k = 1 + rnd(n + 1);
	for (let i = 0; i < k; i++) out.push(stmt(rnd(depth + 1), full));
	return out.join(" ");
}
const HERITAGE = ["B", "B", "B", "B", "B", "null", "undefined", "(B)", "B.c", "B()", "class {}", "'x'", "1", "a && b", "a || b", "a ?? b", "(a ? b : c)", "(a, b)", "void 0", "this", "new B", "`b`", "tag`b`", "(a = b)", "(a += b)", "(a &&= b)", "(a ||= b)", "(a ??= 1)", "function () {}", "(() => {})", "-a", "!a", "[]", "({})", "a?.b", "(a?.b)", "(a, null)", "(a ? null : 1)", "(a || null)", "(null && a)", "/r/", "1n", "true"];
const heritage = () => pick(HERITAGE);
function ctorCase() {
	const body = stmts(3, 4, { fn: true, ctor: true });
	const params = pick(["", "", "a", "a = this.x", "a = super()", "{ a = this }", "...r"]);
	return `class A extends ${heritage()} { ${pick(["", "f = this.x;", "static s = 1;", "m() { this.x; }"])} constructor(${params}) { ${body} } ${pick(["", "g;", "static { this.z; }"])} }`;
}
function getterCase() {
	const body = () => stmts(3, 3, { fn: true });
	switch (rnd(8)) {
		case 0: return `var o = { get ${pick(["a", "'b'", "[c]", "1"])}() { ${body()} } };`;
		case 1: return `class A { ${pick(["", "static "])}get ${pick(["a", "#p", "'b'", "[c]"])}() { ${body()} } }`;
		case 2: return `Object.defineProperty(o, 'k', { get: function () { ${body()} } });`;
		case 3: return `Reflect.defineProperty(o, 'k', { get() { ${body()} } });`;
		case 4: return `Object.defineProperties(o, { k: { get: () => { ${body()} } } });`;
		case 5: return `Object.create(null, { k: { ${pick(["get", "async get", "*get", "set get"])}(${rnd(2) ? "" : "v"}) { ${body()} } } });`;
		case 6: return `var o = { get a() { ${body()} }, b: { get c() { return function () { ${body()} }; } } };`;
		default: return `(class { get a() { ${body()} } static get b() { return () => { ${body()} }; } });`;
	}
}
function switchCase() {
	return `function f() { ${stmts(1, 1, { fn: true })} ${switchStmt(3, { fn: true, loop: false, brk: false, labels: [], loopLabels: [], ctor: false }, true)} ${stmts(1, 1, { fn: true })} }`;
}
const cases = [];
for (let i = 0; i < count; i++) {
	names = 0;
	budget = 40 + rnd(100);
	const kind = what === "all" ? pick(["ctor", "ctor", "getter", "switch"]) : what;
	cases.push(kind === "ctor" ? ctorCase() : kind === "getter" ? getterCase() : switchCase());
}
fs.writeFileSync(outJson, JSON.stringify(cases));
console.log("cases", cases.length);
