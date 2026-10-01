// Research scratch: the two regular expressions of the rules as the hand-written scans that the port needs, against the engine.
// node scanners.cjs [n=300000] [seed=1]
"use strict";
const n = +process.argv[2] || 300000;
let seed = +process.argv[3] || 1;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 4294967296);

// no-regex-spaces: /( {2,})(?: [+*{?]|[^+*{?]|$)/gu over the pattern, as UTF-16 units. Every match: [index, length of group 1].
function spaces(units) {
	const out = [];
	const isQuantifier = u => u === 0x2b || u === 0x2a || u === 0x7b || u === 0x3f;
	let i = 0;
	while (i < units.length) {
		if (units[i] !== 0x20) { i++; continue; }
		let end = i;
		while (end < units.length && units[end] === 0x20) end++;
		const run = end - i;
		if (run < 2) { i = end; continue; }
		if (end === units.length) { out.push([i, run]); break; }
		if (isQuantifier(units[end])) {
			// The last space belongs to the quantifier: two spaces before it are needed.
			if (run >= 3) out.push([i, run - 1]);
			i = end + 1;
			continue;
		}
		out.push([i, run]);
		// The character after the run is part of the match: a surrogate pair is one character.
		const hi = units[end] >= 0xd800 && units[end] <= 0xdbff && end + 1 < units.length && units[end + 1] >= 0xdc00 && units[end + 1] <= 0xdfff;
		i = end + (hi ? 2 : 1);
	}
	return out;
}
function spacesEngine(s) {
	const re = /( {2,})(?: [+*{?]|[^+*{?]|$)/gu;
	const out = [];
	let m;
	while ((m = re.exec(s))) out.push([m.index, m[1].length]);
	return out;
}

// no-useless-escape: /\\\D/gu over the raw text of a string or of a template element. Every match: [index, the character after the backslash].
function escapes(units) {
	const out = [];
	let i = 0;
	while (i + 1 < units.length) {
		if (units[i] !== 0x5c) { i++; continue; }
		const u = units[i + 1];
		if (u >= 0x30 && u <= 0x39) { i++; continue; }
		const hi = u >= 0xd800 && u <= 0xdbff && i + 2 < units.length && units[i + 2] >= 0xdc00 && units[i + 2] <= 0xdfff;
		out.push([i, String.fromCharCode(...units.slice(i + 1, i + (hi ? 3 : 2)))]);
		i += hi ? 3 : 2;
	}
	return out;
}
function escapesEngine(s) {
	const re = /\\\D/gu;
	const out = [];
	let m;
	while ((m = re.exec(s))) out.push([m.index, m[0].slice(1)]);
	return out;
}
const alphabetA = [" ", " ", " ", " ", "+", "*", "{", "?", "a", "[", "]", "\ud83d\udc4d", "\ud83d", "\udc4d", "}"];
const alphabetB = ["\\", "\\", "\\", "0", "9", "a", "d", "\n", "\r", "\u2028", "\ud83d\udc4d", "\ud83d", "\udc4d", "$", "{", "`", "'", "\""];
let bad = 0;
for (let t = 0; t < n; t++) {
	const len = Math.floor(rnd() * 14);
	let a = "", b = "";
	for (let k = 0; k < len; k++) { a += alphabetA[Math.floor(rnd() * alphabetA.length)]; b += alphabetB[Math.floor(rnd() * alphabetB.length)]; }
	const ua = [...a].flatMap(c => c.length === 2 ? [c.charCodeAt(0), c.charCodeAt(1)] : [c.charCodeAt(0)]);
	const ub = [...b].flatMap(c => c.length === 2 ? [c.charCodeAt(0), c.charCodeAt(1)] : [c.charCodeAt(0)]);
	if (JSON.stringify(spaces(ua)) !== JSON.stringify(spacesEngine(a))) { if (bad++ < 5) console.log("spaces", JSON.stringify(a), JSON.stringify(spaces(ua)), JSON.stringify(spacesEngine(a))); }
	if (JSON.stringify(escapes(ub)) !== JSON.stringify(escapesEngine(b))) { if (bad++ < 5) console.log("escapes", JSON.stringify(b), JSON.stringify(escapes(ub)), JSON.stringify(escapesEngine(b))); }
}
console.log(n, "strings each,", bad, "wrong");
