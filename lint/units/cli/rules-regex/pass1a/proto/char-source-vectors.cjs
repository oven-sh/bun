// Vectors for a test of src/lint/char_source.rs: ESLint's own lib/rules/utils/char-source.js over a list of literals, its
// offsets (UTF-16 units of the literal) turned into bytes of the UTF-8 literal: a start inside a character of two units is the
// start of that character, an end inside it is its end.
// usage: node char-source-vectors.cjs   one line per literal: kind, the literal as a JSON string, then `start-end` per unit
"use strict";
const { parseStringLiteral, parseTemplateToken } = require("/workspace/ref/eslint/lib/rules/utils/char-source");
const list = [
	["string", '"abc"'], ["string", "'a\\nb'"], ["string", '"\\x41\\u0042\\u{43}"'], ["string", '"\\u{1F44D}"'], ["string", '"👍"'], ["string", '"a👍b"'],
	["string", '"\\👍"'], ["string", '"é\\é"'], ["string", '"\\\n"'], ["string", '"a\\\r\nb"'], ["string", '"\\\u2028x"'], ["string", '"\\0\\08\\101\\7\\400"'],
	["string", '"\\8\\9\\a\\\\"'], ["string", "'\\''"], ["string", '"[\\\\u200D]"'], ["string", '""'],
	["template", "`abc`"], ["template", "`a\nb`"], ["template", "`a\r\nb`"], ["template", "`a\rb`"], ["template", "`\\\r\nb`"], ["template", "`👍\\u{1F44D}\\``"],
	["template", "`a$b\\${c}`"], ["template", "`head${"], ["template", "`\\👍é`"], ["template", "``"],
];
const byteOf = (text, unit, up) => {
	const isLow = i => { const c = text.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff; };
	const at = isLow(unit) ? (up ? unit + 1 : unit - 1) : unit;
	return Buffer.byteLength(text.slice(0, at), "utf8");
};
for (const [kind, literal] of list) {
	const units = (kind === "string" ? parseStringLiteral : parseTemplateToken)(literal);
	console.log([kind, JSON.stringify(literal), ...units.map(u => `${byteOf(literal, u.start, false)}-${byteOf(literal, u.end, true)}`)].join(" "));
}
