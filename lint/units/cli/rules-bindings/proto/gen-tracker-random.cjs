// Research scratch: random programs that alias Math, JSON and the global object through variables, for tracker-down.cjs.
// usage: node gen-tracker-random.cjs <count> <seed> > list.json
"use strict";
let seed = Number(process.argv[3] || 1);
const rnd = n => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) % n); };
const pick = a => a[rnd(a.length)];
const VARS = ["a", "b", "c", "g"];
const ROOTS = ["Math", "JSON", "globalThis", "self", "Reflect"];
function expr(depth) {
	const k = rnd(depth > 2 ? 6 : 14);
	switch (k) {
		case 0: case 1: return pick(VARS);
		case 2: case 3: return pick(ROOTS);
		case 4: return `${pick(VARS)}.${pick(["Math", "JSON", "x"])}`;
		case 5: return `${pick(["globalThis", "self", ...VARS])}[${pick(["'Math'", "`JSON`", "'Ma' + 'th'", "k"])}]`;
		case 6: return `(${expr(depth + 1)} || ${expr(depth + 1)})`;
		case 7: return `(${pick(VARS)} ? ${expr(depth + 1)} : ${expr(depth + 1)})`;
		case 8: return `(${expr(depth + 1)}, ${expr(depth + 1)})`;
		case 9: return `(${pick(VARS)} = ${expr(depth + 1)})`;
		case 10: return `${expr(depth + 1)}?.Math`;
		case 11: return `(${expr(depth + 1)} ?? ${expr(depth + 1)})`;
		case 12: return `(${expr(depth + 1)}).JSON`;
		default: return `(${pick(VARS)} ||= ${expr(depth + 1)})`;
	}
}
function pattern() {
	const k = rnd(6);
	if (k === 0) return `{ Math: ${pick(VARS)} }`;
	if (k === 1) return `{ JSON: ${pick(VARS)} = ${expr(2)} }`;
	if (k === 2) return `{ ['Math']: ${pick(VARS)}, x: ${pick(VARS)} }`;
	if (k === 3) return `[${pick(VARS)} = ${expr(2)}]`;
	if (k === 4) return `{ JSON: ${pick(VARS)}, ...${pick(VARS)} }`;
	return pick(VARS);
}
function stmt(depth) {
	const k = rnd(depth > 1 ? 8 : 12);
	switch (k) {
		case 0: return `var ${pattern()} = ${expr(0)};`;
		case 1: return `${pick(VARS)} = ${expr(0)};`;
		case 2: return `${expr(0)}();`;
		case 3: return `new (${expr(0)})();`;
		case 4: return `(${pattern()} = ${expr(0)});`;
		case 5: return `${pick(VARS)}();`;
		case 6: return `${pick(VARS)}.Math(); ${pick(VARS)}.JSON();`;
		case 7: return `let ${pick(VARS)}${rnd(2) ? ` = ${expr(0)}` : ""};`;
		case 8: return `function f${rnd(3)}(${pick(VARS)} = ${expr(1)}) { ${stmt(depth + 1)} ${stmt(depth + 1)} }`;
		case 9: return `{ ${stmt(depth + 1)} ${stmt(depth + 1)} }`;
		case 10: return `try { ${stmt(depth + 1)} } catch (${pick(VARS)}) { ${stmt(depth + 1)} }`;
		default: return `(() => { ${stmt(depth + 1)} ${stmt(depth + 1)} })();`;
	}
}
const out = [];
const count = Number(process.argv[2] || 100);
while (out.length < count) {
	const n = 2 + rnd(7);
	let code = "";
	for (let i = 0; i < n; i++) code += stmt(0) + " ";
	out.push(code.trim());
}
console.log(JSON.stringify(out));
