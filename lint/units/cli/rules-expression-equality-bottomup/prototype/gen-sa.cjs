// Generates assignments whose two sides are references and patterns that are variations of each other.
// usage: node gen-sa.cjs <seed> <count> > out.json
"use strict";
let seed = Number(process.argv[2] || 1) >>> 0;
const count = Number(process.argv[3] || 200);
function rnd() {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 4294967296;
}
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const ids = ["a", "b", "c", "é", "\\u0061", "x1", "$", "async", "of", "get", "undefined"];
const bases = ["a", "b", "c", "this", "é", "\\u0061", "'s'", '"s"', "1", "1.0", "0x1", "1n", "0x1n", "null", "true", "false", "/r/g", "/r/gi", "/r/ig", "`t`", "f()", "new A", "[x]", "{}"];
const names = ["a", "b", "c", "case", "null", "true", "é", "\\u0062", "x1"];
const keys = ["b", "'b'", '"b"', "`b`", "0", "0.0", "'0'", "0x0", "1e3", "1000", "'1000'", "1n", "0x1n", "'1'", "null", "'null'", "true", "/r/gi", "/r/ig", "'/r/gi'", "c", "c.d", "c[d]", "c?.d", "this", "c()", "c + 1", "-1", "`b${c}`", "'b c'", "'é'", "(c)", "( 'b' )"];
const ws = [" ", "  ", "\t", "\n", " /* c */ ", "/**/", " // c\n", "\u00a0", "\u2003"];
const sp = () => (chance(0.75) ? "" : pick(ws));

function ref(d, allowOptional) {
	if (d <= 0 || chance(0.25)) return pick(bases);
	const k = Math.floor(rnd() * 8);
	const inner = () => ref(d - 1, allowOptional);
	switch (k) {
		case 0:
		case 1:
			return `${inner()}${sp()}.${sp()}${pick(names)}`;
		case 2:
		case 3:
			return `${inner()}${sp()}[${sp()}${pick(keys)}${sp()}]`;
		case 4:
			return allowOptional ? `${inner()}${sp()}?.${sp()}${pick(names)}` : `${inner()}.${pick(names)}`;
		case 5:
			return allowOptional ? `${inner()}?.[${pick(keys)}]` : `${inner()}[${pick(keys)}]`;
		case 6:
			return `(${sp()}${inner()}${sp()})${sp()}.${pick(names)}`;
		default:
			return `(${inner()})[${pick(keys)}]`;
	}
}

function target(d) {
	// A simple assignment target: an identifier or a member expression without an optional chain at its top.
	if (chance(0.3)) return pick(ids);
	const r = ref(d, false);
	return /^[\w$\\é]+$/u.test(r) && !/^\d/.test(r) && !["this", "null", "true", "false"].includes(r) ? r : `${r}.${pick(names)}`;
}

function pattern(d) {
	if (d <= 0 || chance(0.4)) return target(2);
	const k = Math.floor(rnd() * 4);
	if (k === 0) {
		const n = 1 + Math.floor(rnd() * 3);
		const items = [];
		for (let i = 0; i < n; i++) {
			const r = rnd();
			if (r < 0.1) items.push("");
			else if (r < 0.2) items.push(`${pattern(d - 1)} = ${pick(ids)}`);
			else items.push(pattern(d - 1));
		}
		if (chance(0.2)) items.push(`...${pattern(d - 1)}`);
		return `[${items.join(", ")}]`;
	}
	if (k === 1) {
		const n = 1 + Math.floor(rnd() * 3);
		const props = [];
		for (let i = 0; i < n; i++) {
			const r = rnd();
			const id = pick(["a", "b", "c", "x1"]);
			if (r < 0.25) props.push(id);
			else if (r < 0.35) props.push(`${id} = ${pick(ids)}`);
			else if (r < 0.45) props.push(`${pick(["'k'", "1", "1.0", "[`k`]", "[k]", "k", "0x1", "1n"])}: ${pattern(d - 1)} = ${pick(ids)}`);
			else props.push(`${pick(["'k'", "1", "1.0", "[`k`]", "['k']", "[k]", "k", "0x1", "1n", "[1]", "[null]", "null"])}: ${pattern(d - 1)}`);
		}
		if (chance(0.2)) props.push(`...${target(1)}`);
		return `{${props.join(", ")}}`;
	}
	return target(2);
}

// Turns a pattern text into an expression text that often is the same, sometimes is not.
function vary(s) {
	let out = s;
	const k = Math.floor(rnd() * 10);
	switch (k) {
		case 0:
			break;
		case 1:
			out = out.replace(/'/g, '"');
			break;
		case 2:
			out = out.replace(/\./g, () => (chance(0.5) ? "?." : "."));
			break;
		case 3:
			out = out.replace(/ = \S+?(?=[,\]}])/g, "");
			break;
		case 4:
			out = out.replace(/\b1\.0\b/g, "1").replace(/\b0x1\b/g, "1");
			break;
		case 5:
			out = out.replace(/, /g, () => `${sp()},${sp()}`);
			break;
		case 6:
			out = out.replace(/\[`k`\]|\['k'\]|'k'/g, "k");
			break;
		case 7:
			out = out.replace(/\.\.\./g, chance(0.5) ? "...z, ..." : "");
			break;
		case 8:
			out = out.replace(/\.(\w+)/g, (m, n) => (chance(0.4) ? `['${n}']` : m));
			break;
		default:
			out = `(${out})`;
	}
	return out;
}

const out = [];
for (let i = 0; i < count; i++) {
	const left = pattern(3);
	let right = chance(0.85) ? vary(left) : pattern(3);
	// Default values are not valid on the right side.
	if (chance(0.8)) right = right.replace(/ = [^,\]}]+(?=[,\]}])/g, "");
	const op = left.startsWith("[") || left.startsWith("{") ? "=" : pick(["=", "=", "=", "&&=", "||=", "??=", "+="]);
	const wrap = chance(0.3);
	const stmt = `${sp()}${left}${sp()}${op}${sp()}${right}${sp()}`;
	const shape = pick(["expr", "expr", "expr", "nested", "for", "class", "arrow", "seq"]);
	let code;
	switch (shape) {
		case "nested":
			code = `x = (${stmt});`;
			break;
		case "for":
			code = `for (${left.startsWith("[") || left.startsWith("{") ? left : "[" + left + " = a]"} of y) { (${stmt}); }`;
			break;
		case "class":
			code = `class K extends B { #a; #b; m() { (${stmt}); this.#a = this${pick([".", "?."])}#${pick(["a", "b"])}; super.x = super${pick([".x", "['x']", "[x]"])}; } }`;
			break;
		case "arrow":
			code = `f((p = p, [q = q], {r = r}) => (${stmt}));`;
			break;
		case "seq":
			code = `(${stmt}), (${stmt});`;
			break;
		default:
			code = wrap || left.startsWith("{") ? `(${stmt});` : `${stmt};`;
	}
	out.push(code);
}
process.stdout.write(JSON.stringify(out));
