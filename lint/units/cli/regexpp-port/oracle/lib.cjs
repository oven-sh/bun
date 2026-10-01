// Shared by the scripts here: the one-line form of a regexpp AST that the Rust test of src/lint/regexpp prints too.
// A string is written between double quotes, one UTF-16 unit at a time: `\\` and `\"` for those two, the unit itself
// from 0x20 to 0x7e, `\uXXXX` (lower case hex) for every other unit. A file of fixtures is ASCII only.
"use strict";
const path = require("path");

function q(s) {
	let out = '"';
	for (let i = 0; i < s.length; i++) {
		const u = s.charCodeAt(i);
		if (u === 0x22) out += '\\"';
		else if (u === 0x5c) out += "\\\\";
		else if (u >= 0x20 && u <= 0x7e) out += String.fromCharCode(u);
		else out += "\\u" + u.toString(16).padStart(4, "0");
	}
	return out + '"';
}
const b = v => (v ? "1" : "0");
// A bound of a quantifier: decimal up to 2^53 - 1, `inf`, else the 64 bits of the double in hex (`{:#018x}` of `to_bits()` in Rust).
function num(v) {
	if (v === Infinity) return "inf";
	if (Number.isSafeInteger(v)) return String(v);
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, v);
	return "0x" + view.getBigUint64(0).toString(16).padStart(16, "0");
}

// A fixture of regexpp holds `parent`, `resolved` and `references` as paths ("♻️../.."): make them objects again.
function revive(root) {
	const byPath = new Map();
	(function index(n, p) {
		byPath.set(p, n);
		for (const k of Object.keys(n)) {
			if (k === "parent" || k === "resolved" || k === "references") continue;
			const v = n[k];
			if (Array.isArray(v)) v.forEach((el, i) => el && typeof el === "object" && index(el, `${p}/${k}/${i}`));
			else if (v && typeof v === "object") index(v, `${p}/${k}`);
		}
	})(root, "");
	const at = (p, rel) => {
		const target = path.posix.resolve(p || "/", rel.slice("♻️".length)).replace(/^\/$/, "");
		const n = byPath.get(target);
		if (!n) throw new Error(`unresolved ${p} ${rel}`);
		return n;
	};
	for (const [p, n] of byPath) {
		for (const k of ["parent", "resolved", "references"]) {
			if (!(k in n) || n[k] === null) continue;
			n[k] = Array.isArray(n[k]) ? n[k].map(r => at(p, r)) : at(p, n[k]);
		}
		for (const k of ["min", "max"]) if (n.type === "Quantifier" && n[k] === "$$Infinity") n[k] = Infinity;
	}
	return root;
}

// Throws unless every node has raw === source.slice(start, end) (the literal: the whole source) and the parent that holds it.
function checkInvariants(root, source) {
	(function visit(n, parent) {
		const raw = n.type === "RegExpLiteral" ? source : source.slice(n.start, n.end);
		if (n.raw !== raw) throw new Error(`raw of ${n.type} ${n.start}..${n.end} in ${q(source)}`);
		if (n.parent !== parent) throw new Error(`parent of ${n.type} ${n.start}..${n.end} in ${q(source)}`);
		for (const k of Object.keys(n)) {
			if (k === "parent" || k === "resolved" || k === "references") continue;
			const v = n[k];
			if (Array.isArray(v)) v.forEach(el => el && typeof el === "object" && visit(el, n));
			else if (v && typeof v === "object") visit(v, n);
		}
	})(root, root.parent);
}

const span = n => `${n.start}:${n.end}`;
function dump(n) {
	const list = k => `[${n[k].map(dump).join(" ")}]`;
	const head = `${n.type} ${n.start} ${n.end}`;
	switch (n.type) {
		case "RegExpLiteral":
			return `(${head} ${dump(n.pattern)} ${dump(n.flags)})`;
		case "Pattern":
			return `(${head} ${list("alternatives")})`;
		case "Alternative":
			return `(${head} ${list("elements")})`;
		case "Group":
			return `(${head} ${n.modifiers ? dump(n.modifiers) : "-"} ${list("alternatives")})`;
		case "CapturingGroup":
			return `(${head} ${n.name === null ? "-" : q(n.name)} refs[${n.references.map(span).join(" ")}] ${list("alternatives")})`;
		case "Assertion":
			if (n.kind === "lookahead" || n.kind === "lookbehind")
				return `(${head} ${n.kind} ${b(n.negate)} ${list("alternatives")})`;
			if (n.kind === "word") return `(${head} word ${b(n.negate)})`;
			return `(${head} ${n.kind})`;
		case "Quantifier":
			return `(${head} ${num(n.min)} ${num(n.max)} ${b(n.greedy)} ${dump(n.element)})`;
		case "CharacterClass":
			return `(${head} ${b(n.unicodeSets)} ${b(n.negate)} ${list("elements")})`;
		case "CharacterClassRange":
			return `(${head} ${dump(n.min)} ${dump(n.max)})`;
		case "CharacterSet":
			if (n.kind === "any") return `(${head} any)`;
			if (n.kind === "property")
				return `(${head} property ${b(n.strings)} ${q(n.key)} ${n.value === null ? "-" : q(n.value)} ${b(n.negate)})`;
			return `(${head} ${n.kind} ${b(n.negate)})`;
		case "ExpressionCharacterClass":
			return `(${head} ${b(n.negate)} ${dump(n.expression)})`;
		case "ClassIntersection":
		case "ClassSubtraction":
			return `(${head} ${dump(n.left)} ${dump(n.right)})`;
		case "ClassStringDisjunction":
			return `(${head} ${list("alternatives")})`;
		case "StringAlternative":
			return `(${head} ${list("elements")})`;
		case "Character":
			return `(${head} ${n.value})`;
		case "Backreference":
			return `(${head} ${typeof n.ref === "number" ? n.ref : q(n.ref)} ${b(n.ambiguous)} to[${[n.resolved].flat().map(span).join(" ")}])`;
		case "Modifiers":
			return `(${head} ${dump(n.add)} ${n.remove ? dump(n.remove) : "-"})`;
		case "ModifierFlags":
			return `(${head} ${b(n.ignoreCase)}${b(n.multiline)}${b(n.dotAll)})`;
		case "Flags":
			return `(${head} ${b(n.dotAll)}${b(n.global)}${b(n.hasIndices)}${b(n.ignoreCase)}${b(n.multiline)}${b(n.sticky)}${b(n.unicode)}${b(n.unicodeSets)})`;
		default:
			throw new Error(`type ${n.type}`);
	}
}

module.exports = { q, b, num, revive, checkInvariants, dump };
