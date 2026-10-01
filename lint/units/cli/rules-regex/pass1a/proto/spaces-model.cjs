// The scan that stands for `/( {2,})(?: [+*{?]|[^+*{?]|$)/gu` of no-regex-spaces, compared with the expression itself.
// usage: node spaces-model.cjs [count] [seed]   every match as (index, length) over random texts of spaces, quantifiers and letters
"use strict";
// units: the pattern as UTF-16 units. Every match: [index, length of the run that is reported].
function scan(units) {
	const out = [];
	const isQuantifier = u => u === 0x2b || u === 0x2a || u === 0x7b || u === 0x3f;
	let i = 0;
	while (i < units.length) {
		if (units[i] !== 0x20) { i += 1; continue; }
		let end = i;
		while (units[end] === 0x20) end += 1;
		const run = end - i;
		if (run < 2) { i = end; continue; }
		if (end < units.length && isQuantifier(units[end])) {
			// The last space belongs to the quantifier: a run of two is no match, and nothing after its first space is one.
			if (run >= 3) out.push([i, run - 1]);
			i = end + 1;
		} else {
			out.push([i, run]);
			// The expression takes the character after the run, which is no space and no quantifier; a surrogate pair is one character.
			i = end + (end < units.length ? (units[end] >= 0xd800 && units[end] <= 0xdbff && units[end + 1] >= 0xdc00 && units[end + 1] <= 0xdfff ? 2 : 1) : 0);
			if (end >= units.length) break;
		}
	}
	return out;
}
function reference(text) {
	const re = /( {2,})(?: [+*{?]|[^+*{?]|$)/gu;
	const out = [];
	let m;
	while ((m = re.exec(text))) out.push([m.index, m[1].length]);
	return out;
}
let seed = Number(process.argv[3] || 5);
const rnd = n => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const atoms = [" ", " ", " ", "  ", "   ", "+", "*", "{", "?", "a", "}", "👍", "\n", "[", "]"];
const count = Number(process.argv[2] || 200000);
let wrong = 0;
for (let t = 0; t < count; t++) {
	let text = "";
	for (let k = rnd(12); k > 0; k--) text += atoms[rnd(atoms.length)];
	const units = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
	const a = JSON.stringify(scan(units)), b = JSON.stringify(reference(text));
	if (a !== b) { wrong++; if (wrong <= 10) console.log("WRONG", JSON.stringify(text), "scan", a, "expression", b); }
}
console.log({ compared: count, wrong });
