// Random function bodies full of jumps, loops, switches, tries, labels, classes and dead code: writes them as a JSON
// list for no-unreachable-model.cjs --cases and as files for compare.cjs --dir.
// usage: node fuzz.cjs <count> <seed> <out.json> [<out dir>]
"use strict";
const fs = require("fs");
const [count, seed, outJson, outDir] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5]];
let state = seed >>> 0 || 1;
const rnd = n => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const pick = a => a[rnd(a.length)];
let names = 0;
// What is left to build of one case: when it is used up, only leaves are made.
let budget = 0;
const id = () => pick(["a", "b", "c", "d", "x", "y"]);
function expr(depth) {
	if (--budget <= 0 || depth <= 0) return pick([id(), id(), "1", "0", "true", "false", "null", "''", "'s'", "this", `${id()}.${id()}`, `${id()}()`, "0n", "1n", "`t`", "/r/"]);
	switch (rnd(22)) {
		case 0: return `${expr(depth - 1)} && ${expr(depth - 1)}`;
		case 1: return `${expr(depth - 1)} || ${expr(depth - 1)}`;
		case 2: return `${expr(depth - 1)} ?? (${expr(depth - 1)})`;
		case 3: return `(${expr(depth - 1)} ? ${expr(depth - 1)} : ${expr(depth - 1)})`;
		case 4: return `${id()} = ${expr(depth - 1)}`;
		case 5: return `${id()} ||= ${expr(depth - 1)}`;
		case 6: return `${id()}?.${id()}${pick(["", `?.(${expr(depth - 1)})`, `[${expr(depth - 1)}]`, `.${id()}`, "?.()"])}`;
		case 7: return `(${id()}?.${id()})?.[${expr(depth - 1)}]`;
		case 8: return `(${expr(depth - 1)}, ${expr(depth - 1)})`;
		case 9: return `[${id()}, ${id()} = ${expr(depth - 1)}] = ${id()}`;
		case 10: return `({ ${id()}, ${id()}: ${id()} = ${expr(depth - 1)}, ...${id()} } = ${id()})`;
		case 11: return `() => ${expr(depth - 1)}`;
		case 12: return `function () { ${stmts(1, 2, { fn: true })} }`;
		case 13: return `new ${id()}(${expr(depth - 1)})`;
		case 14: return `!${expr(depth - 1)}`;
		case 15: return `{ ${id()}, [${expr(depth - 1)}]: ${expr(depth - 1)}, m() { ${stmts(1, 1, { fn: true })} } }.x`.replace(/^\{/u, "({").replace(/\}\.x$/u, "})");
		case 16: return `\`a\${${expr(depth - 1)}}b\``;
		case 17: return `${id()} &&= ${expr(depth - 1)}`;
		case 18: return `class { f = ${expr(depth - 1)}; static { ${stmts(1, 1, { fn: false })} } }`;
		case 19: return `(${expr(depth - 1)}) + (${expr(depth - 1)})`;
		case 20: return `${id()}[${expr(depth - 1)}] ??= ${expr(depth - 1)}`;
		default: return expr(0);
	}
}
// ctx: fn (return allowed), loop (continue allowed), brk (break allowed), labels (open labels), gen
function stmt(depth, ctx) {
	const e = () => expr(rnd(3));
	if (--budget <= 0 || depth <= 0) {
		const simple = [`${e()};`, `${e()};`, `var ${id()} = ${e()};`, `var ${id()};`, `let z${names++} = ${e()};`, ";", "debugger;", `throw ${e()};`];
		if (ctx.fn) simple.push("return;", `return ${e()};`, "return;");
		if (ctx.loop) simple.push("continue;", "continue;");
		if (ctx.brk) simple.push("break;", "break;");
		if (ctx.labels.length) simple.push(`break ${pick(ctx.labels)};`);
		if (ctx.loopLabels.length) simple.push(`continue ${pick(ctx.loopLabels)};`);
		if (ctx.gen) simple.push(`yield ${e()};`);
		return pick(simple);
	}
	const inner = (extra, n = 2) => stmts(depth - 1, n, { ...ctx, ...extra });
	const one = extra => stmt(depth - 1, { ...ctx, ...extra });
	switch (rnd(24)) {
		case 0: return `{ ${inner({})} }`;
		case 1: return `if (${e()}) ${one({})}`;
		case 2: return `if (${e()}) ${one({})} else ${one({})}`;
		case 3: return `if (${e()}) { ${inner({})} } else { ${inner({})} }`;
		case 4: return `while (${pick([e(), "true", "1", "false", "(true)"])}) ${one({ loop: true, brk: true })}`;
		case 5: return `do { ${inner({ loop: true, brk: true })} } while (${pick([e(), "true", "0"])});`;
		case 6: return `for (${pick(["", "var i = 0", `${id()} = 0`, "let j"])}; ${pick(["", e(), "true"])}; ${pick(["", `${id()}++`, e()])}) { ${inner({ loop: true, brk: true })} }`;
		case 7: return `for (${pick(["var k", "const k", id(), `[${id()}]`, `{ ${id()} }`, `var [${id()} = ${e()}]`])} ${pick(["in", "of"])} ${e()}) ${one({ loop: true, brk: true })}`;
		case 8: {
			let s = `switch (${e()}) { `;
			const n = rnd(4);
			let hasDefault = false;
			for (let i = 0; i < n; i++) {
				if (!hasDefault && rnd(4) === 0) { s += "default: "; hasDefault = true; } else s += `case ${e()}: `;
				if (rnd(4)) s += `${inner({ brk: true }, rnd(3))} `;
			}
			return `${s}}`;
		}
		case 9: return `try { ${inner({})} } catch${pick(["", " (e)", " ({ m })"])} { ${inner({})} }`;
		case 10: return `try { ${inner({})} } finally { ${inner({})} }`;
		case 11: return `try { ${inner({})} } catch (e) { ${inner({})} } finally { ${inner({})} }`;
		case 12: { const l = `L${names++}`; return `${l}: { ${inner({ labels: [...ctx.labels, l] })} }`; }
		case 13: { const l = `L${names++}`; return `${l}: while (${e()}) { ${inner({ loop: true, brk: true, labels: [...ctx.labels, l], loopLabels: [...ctx.loopLabels, l] })} }`; }
		case 14: { const l = `L${names++}`; return `${l}: for (;;) { ${inner({ loop: true, brk: true, labels: [...ctx.labels, l], loopLabels: [...ctx.loopLabels, l] })} }`; }
		case 15: return `function g${names++}(p = ${e()}) { ${stmts(depth - 1, 2, { fn: true, loop: false, brk: false, labels: [], loopLabels: [], gen: false })} }`;
		case 16: return `class K${names++} extends ${id()} { ${pick(["f;", "f = 1;", "static s;", "", "f; g = 2;"])} ${pick(["", "m() { return; x; }"])} ${pick(["", `constructor() { ${stmts(depth - 1, 2, { fn: true, loop: false, brk: false, labels: [], loopLabels: [], gen: false })} ${pick(["", "super();"])} }`])} ${pick(["", "h;", "static { x; }", "h; i;"])} }`;
		case 17: return `with (${id()}) ${one({})}`;
		case 18: { const l = `L${names++}`; return `${l}: ${one({ labels: [...ctx.labels, l] })}`; }
		case 19: return `for (;;) ${one({ loop: true, brk: true })}`;
		default: return stmt(0, ctx);
	}
}
function stmts(depth, n, ctx) {
	const full = { fn: false, loop: false, brk: false, labels: [], loopLabels: [], gen: false, ...ctx };
	const out = [];
	const k = 1 + rnd(n + 1);
	for (let i = 0; i < k; i++) out.push(stmt(rnd(depth + 1), full));
	return out.join(" ");
}
const cases = [];
for (let i = 0; i < count; i++) {
	names = 0;
	budget = 60 + rnd(120);
	const gen = rnd(5) === 0;
	const body = stmts(3, 4, { fn: true, gen });
	cases.push(`function${gen ? "*" : ""} f() { ${body} }`);
}
fs.writeFileSync(outJson, JSON.stringify(cases));
if (outDir) {
	fs.mkdirSync(outDir, { recursive: true });
	cases.forEach((c, i) => fs.writeFileSync(`${outDir}/f${String(i).padStart(5, "0")}.js`, c));
}
console.log("cases", cases.length);
