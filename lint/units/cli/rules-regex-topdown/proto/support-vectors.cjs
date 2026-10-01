// Research scratch: vectors for support.rs, from ESLint's own code at the pin and from the engine.
// node support-vectors.cjs [n=200000] [seed=1]    one vector per line: <kind> <hex of the input> <expected, or - for nothing>
//   S, T: a string literal, a template token (UTF-8); expected: start:length of every code unit, in bytes, by the rule of
//         char_source.rs: a start inside a surrogate pair is the start of the character, an end inside one is its end.
//   P: a pattern (UTF-16, big endian); expected: index:count of every match of the expression of no-regex-spaces.
//   E: the text of a string literal or of a template element (UTF-8); expected: byte offset:code point (hex) of every match of /\\\D/gu.
"use strict";
const { parseStringLiteral, parseTemplateToken } = require("/workspace/ref/eslint/lib/rules/utils/char-source");
const n = +process.argv[2] || 200000;
let seed = +process.argv[3] || 1;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 4294967296);
const pick = list => list[Math.floor(rnd() * list.length)];
const hex = buf => Buffer.from(buf).toString("hex");
const isHigh = c => c >= 0xd800 && c <= 0xdbff, isLow = c => c >= 0xdc00 && c <= 0xdfff;
// UTF-16 index -> byte offset; an index inside a pair goes down (start) or up (end).
function byteOf(s, index, up) {
	let i = index;
	if (i > 0 && i < s.length && isLow(s.charCodeAt(i)) && isHigh(s.charCodeAt(i - 1))) i += up ? 1 : -1;
	return Buffer.byteLength(s.slice(0, i), "utf8");
}
const units = (s, list) => list.map(u => { const a = byteOf(s, u.start, false), b = byteOf(s, u.start + u.source.length, true); return `${a}:${b - a}`; }).join(",") || "-";
const piecesCommon = ["a", "b", " ", "0", "7", "8", "{", "}", "é", "\u2028", "👍", "𝄞", "\\n", "\\t", "\\b", "\\v", "\\f", "\\r", "\\x41", "\\x0a", "\\u0041", "\\u00e9", "\\ud83d", "\\udc4d", "\\u{41}", "\\u{1F44D}", "\\u{10ffff}", "\\u{0}", "\\0", "\\1", "\\12", "\\123", "\\377", "\\400", "\\4", "\\47", "\\477", "\\8", "\\9", "\\a", "\\e", "\\é", "\\👍", "\\\\", "\\\n", "\\\r\n", "\\\r", "\\\u2028", "\\\u2029", "\\ "];
const piecesS = [...piecesCommon, "'", "\\'", '\\"', "$", "${", "`"];
const piecesT = [...piecesCommon, "'", '"', "\\`", "\\$", "\\{", "$", "$a", "{", "\n", "\r\n", "\r", "\\${"];
const out = [];
for (let t = 0; t < n; t++) {
	const len = Math.floor(rnd() * 8);
	let s = "", tpl = "";
	for (let k = 0; k < len; k++) { s += pick(piecesS); tpl += pick(piecesT); }
	// A template token ends at `${`: no piece may make one with the piece before it.
	tpl = tpl.replace(/\$\{/g, (m, at) => (at > 0 && tpl[at - 1] === "\\" ? m : "$ {"));
	const str = `"${s.replace(/"/g, "x")}"`;
	out.push(`S ${hex(str)} ${units(str, parseStringLiteral(str))}`);
	const end = pick(["`", "${"]), start = pick(["`", "}"]);
	const tok = `${start}${tpl.replace(/`/g, (m, at) => (at > 0 && tpl[at - 1] === "\\" ? m : "x"))}${end}`;
	out.push(`T ${hex(tok)} ${units(tok, parseTemplateToken(tok))}`);
	// The pattern of no-regex-spaces.
	let p = "";
	for (let k = 0, m = Math.floor(rnd() * 14); k < m; k++) p += pick([" ", " ", " ", " ", "+", "*", "{", "?", "a", "[", "]", "👍", "\ud83d", "\udc4d", "}"]);
	const be = Buffer.alloc(p.length * 2);
	for (let k = 0; k < p.length; k++) be.writeUInt16BE(p.charCodeAt(k), k * 2);
	const found = [];
	for (let m, re = /( {2,})(?: [+*{?]|[^+*{?]|$)/gu; (m = re.exec(p)); ) found.push(`${m.index}:${m[1].length}`);
	out.push(`P ${be.toString("hex")} ${found.join(",") || "-"}`);
	// The text of a string for no-useless-escape: well formed, as a file is.
	let e = "";
	for (let k = 0, m = Math.floor(rnd() * 12); k < m; k++) e += pick(["\\", "\\", "\\", "0", "9", "a", "d", "\n", "\r", "\u2028", "👍", "é", "$", "{", "`", "'", '"']);
	const esc = [];
	for (let m, re = /\\\D/gu; (m = re.exec(e)); ) esc.push(`${Buffer.byteLength(e.slice(0, m.index))}:${m[0].slice(1).codePointAt(0).toString(16)}`);
	out.push(`E ${hex(e)} ${esc.join(",") || "-"}`);
	if (out.length >= 20000) { process.stdout.write(out.join("\n") + "\n"); out.length = 0; }
}
process.stdout.write(out.join("\n") + "\n");
