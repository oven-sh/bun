// Research scratch: random programs that are dense in control flow, for the code path mapping and for no-unreachable.
// usage: node gen.cjs <count> <seed> <out.json> [--ts]     every program is one function body in a file (a script).
// With --ts the programs carry TypeScript syntax: only keyword types, so that no identifier stands inside a type.
"use strict";
const fs = require("fs");
const count = Number(process.argv[2]);
let seed = Number(process.argv[3]) >>> 0;
const out = process.argv[4];
const TS = process.argv.includes("--ts");
// Without the declarations that leave no statement in Bun's tree (their names are Identifier nodes for ESLint).
const NO_DECL = process.argv.includes("--no-decl");
function rnd() {
	// mulberry32
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = list => list[Math.floor(rnd() * list.length)];
const chance = p => rnd() < p;
const ids = ["a", "b", "c", "d", "e", "f", "g"];
let labelCount = 0;

function expr(depth, ctx) {
	if (depth <= 0 || chance(0.3)) {
		return pick([pick(ids), pick(ids), pick(ids), "1", "0", "true", "false", "null", "'s'", "this", "/r/", "1n", "`t`", "undefined"]);
	}
	const d = depth - 1;
	const e = () => expr(d, ctx);
	const kinds = [
		() => `(${e()} && ${e()})`,
		() => `(${e()} || ${e()})`,
		() => `(${e()} ?? ${e()})`,
		() => `${e()} && ${e()}`.replace(/\?\?/gu, "||"),
		() => `(${e()} ? ${e()} : ${e()})`,
		() => `${pick(ids)}(${chance(0.5) ? e() : ""}${chance(0.3) ? `, ${e()}` : ""})`,
		() => `${pick(ids)}.${pick(ids)}`,
		() => `${pick(ids)}?.${pick(ids)}`,
		() => `${pick(ids)}?.[${e()}]`,
		() => `${pick(ids)}?.(${chance(0.5) ? e() : ""})`,
		() => `${pick(ids)}?.${pick(ids)}.${pick(ids)}(${e()})?.${pick(ids)}`,
		() => `(${pick(ids)}?.${pick(ids)})?.${pick(ids)}`,
		() => `${pick(ids)}[${e()}]`,
		() => `(${pick(ids)} = ${e()})`,
		() => `(${pick(ids)} ${pick(["||=", "&&=", "??=", "+="])} ${e()})`,
		() => `(${pick(ids)} => ${expr(d, { ...ctx, gen: false })})`,
		() => `(function () { ${stmts(d, { ...ctx, fn: true, loop: false, sw: false, labels: [], loopLabels: [], gen: false })} })`,
		() => `(() => { ${stmts(d, { ...ctx, fn: true, loop: false, sw: false, labels: [], loopLabels: [], gen: false })} })`,
		() => `[${e()}, ...${pick(ids)}]`,
		() => `({ ${pick(ids)}, ${pick(ids)}: ${e()}, [${e()}]: 1 })`,
		() => `\`x\${${e()}}y\``,
		() => `new ${pick(ids)}(${e()})`,
		() => `(${e()}, ${e()})`,
		() => `!${e()}`,
		() => `(${e()} + ${e()})`,
		() => `([${pick(ids)}, ${pick(ids)} = ${e()}] = ${e()})`,
		() => `({ ${pick(ids)}, ${pick(ids)}: ${pick(ids)} = ${e()} } = ${e()})`,
		() => (ctx.gen ? `(yield ${e()})` : `void ${e()}`),
		() => `import(${e()})`,
		() => (TS ? `(${e()} as any)` : `(${e()})`),
		() => (TS ? `${pick(ids)}!` : `(${pick(ids)})`),
		() => (TS ? `(<number>${e()})` : `(+${e()})`),
		() => (TS ? `(${e()} satisfies number)` : `(-${e()})`),
	];
	return pick(kinds)();
}

function stmts(depth, ctx) {
	const n = 1 + Math.floor(rnd() * 4);
	let s = "";
	for (let i = 0; i < n; i++) s += stmt(depth, ctx) + " ";
	return s;
}

function stmt(depth, ctx) {
	const e = () => expr(2, ctx);
	if (depth <= 0) {
		const leaf = [
			() => `${e()};`,
			() => `${e()};`,
			() => `var ${pick(ids)} = ${e()};`,
			() => `var ${pick(ids)};`,
			() => `{ let u${labelCount++}${TS && chance(0.5) ? ": number" : ""} = ${e()}; }`,
			() => ";",
			() => "debugger;",
			() => (ctx.fn ? `return${chance(0.5) ? ` ${e()}` : ""};` : `${e()};`),
			() => `throw ${e()};`,
			() => (ctx.loop || ctx.sw ? "break;" : `${e()};`),
			() => (ctx.loop ? "continue;" : `${e()};`),
			() => (ctx.labels.length ? `break ${pick(ctx.labels)};` : `${e()};`),
			() => (ctx.loopLabels.length ? `continue ${pick(ctx.loopLabels)};` : `${e()};`),
		];
		return pick(leaf)();
	}
	const d = depth - 1;
	const inLoop = { ...ctx, loop: true };
	const kinds = [
		() => stmt(0, ctx),
		() => stmt(0, ctx),
		() => stmt(0, ctx),
		() => `if (${e()}) ${stmt(d, ctx)}${chance(0.5) ? ` else ${stmt(d, ctx)}` : ""}`,
		() => `if (${e()}) { ${stmts(d, ctx)} }${chance(0.5) ? ` else { ${stmts(d, ctx)} }` : ""}`,
		() => `while (${chance(0.3) ? pick(["true", "1", "(true)", TS ? "true as boolean" : "!0"]) : e()}) ${stmt(d, inLoop)}`,
		() => `do ${stmt(d, inLoop)} while (${chance(0.3) ? "true" : e()});`,
		() => `for (${pick(["", `var i = ${e()}`, `i = ${e()}`, "let j = 0"])}; ${pick(["", e(), "true"])}; ${pick(["", e(), "i++"])}) ${stmt(d, inLoop)}`,
		() => `for (${pick(["var k", "const k", "k", "[k, l = 1]", "k.m", "const { k, l: m = 2 }"])} ${pick(["of", "in"])} ${e()}) ${stmt(d, inLoop)}`.replace(/\[k, l = 1\] in|const \{ k, l: m = 2 \} in/u, "k in"),
		() => `{ ${stmts(d, ctx)} }`,
		() => {
			const l = `L${labelCount++}`;
			const kind = pick(["block", "loop", "stmt"]);
			if (kind === "loop") {
				return `${l}: while (${e()}) ${stmt(d, { ...ctx, loop: true, labels: [...ctx.labels, l], loopLabels: [...ctx.loopLabels, l] })}`;
			}
			if (kind === "block") return `${l}: { ${stmts(d, { ...ctx, labels: [...ctx.labels, l] })} }`;
			return `${l}: ${stmt(d, { ...ctx, labels: [...ctx.labels, l] })}`;
		},
		() => {
			const hasCatch = chance(0.7);
			const hasFinally = !hasCatch || chance(0.4);
			return `try { ${stmts(d, ctx)} }${hasCatch ? ` catch${chance(0.7) ? ` (${pick(["err", "{ x }", "[y = 1]"])})` : ""} { ${stmts(d, ctx)} }` : ""}${hasFinally ? ` finally { ${stmts(d, ctx)} }` : ""}`;
		},
		() => {
			const n = Math.floor(rnd() * 4);
			let body = "";
			let usedDefault = false;
			const inSwitch = { ...ctx, sw: true };
			for (let i = 0; i < n; i++) {
				if (!usedDefault && chance(0.3)) {
					usedDefault = true;
					body += `default: ${chance(0.7) ? stmts(d, inSwitch) : ""}`;
				} else body += `case ${e()}: ${chance(0.7) ? stmts(d, inSwitch) : ""}`;
			}
			return `switch (${e()}) { ${body} }`;
		},
		() => `function fn${labelCount++}(${chance(0.5) ? `${pick(ids)} = ${e()}` : ""}) { ${stmts(d, { ...ctx, fn: true, loop: false, sw: false, labels: [], loopLabels: [], gen: false })} }`,
		() => `function* gn${labelCount++}() { ${stmts(d, { ...ctx, fn: true, loop: false, sw: false, labels: [], loopLabels: [], gen: true })} }`,
		() => {
			const ext = chance(0.7);
			const inner = { ...ctx, fn: true, loop: false, sw: false, labels: [], loopLabels: [], gen: false };
			const members = [];
			const n = Math.floor(rnd() * 5);
			let ctor = false;
			for (let i = 0; i < n; i++) {
				const k = pick(["field", "field", "static", "method", "ctor", "block", "semi", "getter"]);
				if (k === "field") members.push(`${TS && chance(0.2) ? "private " : ""}p${i}${chance(0.7) ? ` = ${e()}` : ""};`);
				else if (k === "static") members.push(`static s${i} = ${e()};`);
				else if (k === "method") members.push(`m${i}() { ${stmts(d, inner)} }`);
				else if (k === "getter") members.push(`get g${i}() { ${stmts(d, inner)} }`);
				else if (k === "block") members.push(`static { ${stmts(d, { ...inner, fn: false })} }`);
				else if (k === "semi") members.push(";");
				else if (!ctor) {
					ctor = true;
					members.push(`constructor() { ${ext && chance(0.5) ? "super(); " : ""}${stmts(d, inner)} }`);
				}
			}
			return `class K${labelCount++}${ext ? ` extends ${pick(ids)}` : ""} { ${members.join(" ")} }`;
		},
		() => (TS && NO_DECL ? "var tv: string;" : TS ? pick([`interface I${labelCount++} {}`, `type T${labelCount++} = number;`, `declare const dc${labelCount++}: number;`, `enum En${labelCount++} { A, B = 1 }`, `declare function df${labelCount++}(): void;`, "var tv: string;"]) : ";"),
	];
	return pick(kinds)();
}

const cases = [];
for (let i = 0; i < count; i++) {
	labelCount = 0;
	const body = stmts(3, { fn: true, loop: false, sw: false, labels: [], loopLabels: [], gen: false });
	cases.push({ rule: "gen", code: `function top(a, b, c, d, e, f, g) { ${body} }`, kind: TS ? "ts" : "js", jsx: false, sourceType: "commonjs" });
}
fs.writeFileSync(out, JSON.stringify(cases));
