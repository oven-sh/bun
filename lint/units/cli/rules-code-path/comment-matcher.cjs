// Research scratch (rules-code-path): `isFallThroughComment` of no-fallthrough written without a regular expression, on
// UTF-8 bytes as the port has them, against ESLint's two patterns on random comment texts.
// usage: node comment-matcher.cjs [count] [seed]     writes answers/fallthrough-comment-table.json (a sample for a test)
"use strict";
const fs = require("fs");
const path = require("path");
const DEFAULT_FALLTHROUGH_COMMENT = /falls?\s?through/iu;
const { directivesPattern } = require("/workspace/ref/eslint/lib/shared/directives");
const real = value => DEFAULT_FALLTHROUGH_COMMENT.test(value) && !directivesPattern.test(value.trim());

// The length of the white space character of JavaScript (`\s`, and what `trim` removes) at `at`, or 0.
function space(b, at) {
	const c = b[at];
	if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return 1;
	if (c === 0xc2 && b[at + 1] === 0xa0) return 2;
	if (c === 0xe1 && b[at + 1] === 0x9a && b[at + 2] === 0x80) return 3;
	if (c === 0xe2 && b[at + 1] === 0x80 && ((b[at + 2] >= 0x80 && b[at + 2] <= 0x8a) || b[at + 2] === 0xa8 || b[at + 2] === 0xa9 || b[at + 2] === 0xaf)) return 3;
	if (c === 0xe2 && b[at + 1] === 0x81 && b[at + 2] === 0x9f) return 3;
	if (c === 0xe3 && b[at + 1] === 0x80 && b[at + 2] === 0x80) return 3;
	if (c === 0xef && b[at + 1] === 0xbb && b[at + 2] === 0xbf) return 3;
	return 0;
}
// Whether the ASCII letters of `word` stand at `at`, in either case.
function word(b, at, w) {
	for (let i = 0; i < w.length; i++) if ((b[at + i] | 0x20) !== w.charCodeAt(i) || b[at + i] === undefined) return false;
	return true;
}
function fallsThrough(b) {
	for (let i = 0; i + 11 <= b.length; i++) {
		if (!word(b, i, "fall")) continue;
		const afterFall = i + 4;
		// `s?`: `s`, `S`, or U+017F, which the `iu` flags fold to `s`.
		const s = (b[afterFall] | 0x20) === 0x73 ? 1 : b[afterFall] === 0xc5 && b[afterFall + 1] === 0xbf ? 2 : 0;
		for (const afterS of s ? [afterFall + s, afterFall] : [afterFall]) {
			const w = space(b, afterS);
			for (const at of w ? [afterS + w, afterS] : [afterS]) if (word(b, at, "through")) return true;
		}
	}
	return false;
}
const DIRECTIVES = ["eslint-disable-next-line", "eslint-disable-line", "eslint-disable", "eslint-enable", "eslint-env", "eslint", "exported", "globals", "global"];
function isDirective(b) {
	let from = 0, to = b.length;
	for (let w; from < to && (w = space(b, from)) > 0; ) from += w;
	// Back over white space: a character of it ends at `to`.
	for (;;) {
		let cut = 0;
		for (const len of [1, 2, 3]) if (to - len >= from && space(b, to - len) === len) cut = len;
		if (!cut) break;
		to -= cut;
	}
	const t = b.subarray(from, to);
	return DIRECTIVES.some(d => t.length >= d.length && t.subarray(0, d.length).toString("latin1") === d && (t.length === d.length || space(t, d.length) > 0));
}
const mine = value => { const b = Buffer.from(value, "utf8"); return fallsThrough(b) && !isDirective(b); };

const count = Number(process.argv[2] || 200000);
let state = Number(process.argv[3] || 1) >>> 0 || 1;
const rnd = n => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const pick = a => a[rnd(a.length)];
const PIECES = ["fall", "falls", "Fall", "FALLS", "fal", "fall\u017f", "fall\u212a", "through", "Through", "THROUGH", "throug", "thru", " ", "  ", "\t", "\n", "\r\n", "\u00a0", "\u2028", "\u3000", "\ufeff", "\u200b", "\u1680", "\u180e", "-", "s", "S", "eslint", "eslint-disable", "eslint-disable-line", "eslint-disable-next-line", "eslint-enable", "eslint-env", "eslint-disabled", "exported", "global", "globals", "globalize", "x", ":", "*", "", ""];
let differs = 0;
const table = [];
for (let i = 0; i < count; i++) {
	let value = "";
	for (let k = 1 + rnd(6); k > 0; k--) value += pick(PIECES);
	const a = real(value), b = mine(value);
	if (a !== b) { if (differs++ < 10) console.log("DIFFERS", JSON.stringify(value), a, b); }
}
// A sample for a test of the port: texts built around the pattern, each with ESLint's answer.
const seen = new Set();
for (let i = 0; table.length < 120 && i < 100000; i++) {
	const value = pick(["", "", "", " ", "eslint ", "eslint-disable ", "eslint-disable-line ", "eslint-disable-next-line ", "eslint-enable\t", "eslint-env ", "exported ", "global ", "globals\n", "globalize ", "eslintx ", "x ", "\u00a0", "\ufeffeslint "]) + pick(["fall", "fall", "Fall", "FALL", "fAlL", "fal", "fa\u017f"]) + pick(["", "", "s", "s", "S", "\u017f", "\u212a", "ss"]) + pick(["", "", " ", " ", "\t", "\n", "\u00a0", "\u2028", "\u3000", "\ufeff", "\u200b", "\u180e", "  ", "-", "\r\n"]) + pick(["through", "through", "THROUGH", "Through", "tHrOuGh", "throug", "thru", "t\u212arough"]) + pick(["", " ", "!", " to the next"]);
	if (seen.has(value)) continue;
	seen.add(value);
	if (real(value) !== mine(value)) { differs++; console.log("DIFFERS", JSON.stringify(value)); }
	table.push([value, real(value)]);
}
fs.writeFileSync(path.join(__dirname, "answers/fallthrough-comment-table.json"), "[\n" + table.map(r => JSON.stringify(r).replace(/[\u007f-\uffff]/gu, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"))).join(",\n") + "\n]\n");
console.log(JSON.stringify({ count, differs, table: table.length, matches: table.filter(r => r[1]).length }));
