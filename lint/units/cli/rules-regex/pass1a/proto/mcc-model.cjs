// Model of no-misleading-character-class as it is to be written on Bun's data, compared with ESLint at the pin.
// The pattern is UTF-16 units (regexpp keeps its unit); every position that is reported is a BYTE offset of the UTF-8 file:
//   a regular expression literal: the bytes of the pattern, an index inside a surrogate pair rounds down (start) or up (end);
//   a string literal or a template without a substitution: char-source.js on the bytes of the literal, one entry per unit.
// usage: node mcc-model.cjs [count] [seed]    random regex literals, strings and templates as the pattern of `new RegExp`
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const { RegExpParser, visitRegExpAST } = require("/workspace/ref/eslint/node_modules/@eslint-community/regexpp");
const linter = new Linter({ configType: "flat" });
const config = [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-misleading-character-class": "error" } }];

// ---- char_source.rs: one entry [start, end) in bytes per UTF-16 unit of the value ----
function utf8Len(b) { return b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4; }
function escapeUnits(src, pos, out) {
	// `pos` is at the backslash. Returns the offset after the sequence.
	const start = pos;
	const c = src[pos + 1];
	let end = pos + 2;
	let units = 1;
	const hex = n => { end += n; };
	switch (c) {
		case 0x78: hex(2); break; // x
		case 0x75: // u
			if (src[end] === 0x7b) {
				let e = end + 1, v = 0;
				while (src[e] !== 0x7d) { v = v * 16 + parseInt(String.fromCharCode(src[e]), 16); e++; }
				end = e + 1;
				units = v > 0xffff ? 2 : 1;
			} else hex(4);
			break;
		case 0x0d: if (src[end] === 0x0a) end++; units = 0; break;
		case 0x0a: units = 0; break;
		case 0xe2: if (src[pos + 2] === 0x80 && (src[pos + 3] === 0xa8 || src[pos + 3] === 0xa9)) { end = pos + 4; units = 0; break; } // U+2028, U+2029
		// falls through
		default:
			if (c >= 0x30 && c <= 0x37) {
				const max = c <= 0x33 ? 3 : 2;
				let n = 1;
				while (n < max && src[pos + 1 + n] >= 0x30 && src[pos + 1 + n] <= 0x37) n++;
				end = pos + 1 + n;
			} else if (c >= 0x80) {
				// The backslash takes the first unit of the character: a character of two units leaves its second as a unit of its own.
				const len = utf8Len(c);
				end = pos + 1 + len;
				// Its second unit is the rest of the character: it starts after the backslash.
				if (len === 4) { out.push([start, end]); out.push([start + 1, end]); return end; }
			}
	}
	for (let i = 0; i < units; i++) out.push([start, end]);
	return end;
}
function parseStringLiteral(src) {
	const quote = src[0];
	const out = [];
	let pos = 1;
	for (;;) {
		const c = src[pos];
		if (c === undefined || c === quote) break;
		if (c === 0x5c) { pos = escapeUnits(src, pos, out); continue; }
		const len = utf8Len(c);
		out.push([pos, pos + len]);
		if (len === 4) out.push([pos, pos + len]);
		pos += len;
	}
	return out;
}
function parseTemplateToken(src) {
	const out = [];
	let pos = 1;
	for (;;) {
		const c = src[pos];
		if (c === undefined || c === 0x60 || (c === 0x24 && src[pos + 1] === 0x7b)) break;
		if (c === 0x5c) { pos = escapeUnits(src, pos, out); continue; }
		if (c === 0x0d && src[pos + 1] === 0x0a) { out.push([pos, pos + 2]); pos += 2; continue; }
		const len = utf8Len(c);
		out.push([pos, pos + len]);
		if (len === 4) out.push([pos, pos + len]);
		pos += len;
	}
	return out;
}
// ---- the rule ----
const isCombining = cp => /^\p{M}$/u.test(String.fromCodePoint(cp));
const isEmojiModifier = c => c >= 0x1f3fb && c <= 0x1f3ff;
const isRegional = c => c >= 0x1f1e6 && c <= 0x1f1ff;
const isSurrogatePair = (l, t) => l >= 0xd800 && l < 0xdc00 && t >= 0xdc00 && t < 0xe000;
const isCpEscape = ch => /^\\u\{[\da-f]+\}$/iu.test(ch.raw);
function* sequences(nodes) {
	let seq = [];
	for (const node of nodes) {
		switch (node.type) {
			case "Character": seq.push(node); break;
			case "CharacterClassRange": seq.push(node.min); yield seq; seq = [node.max]; break;
			default: if (seq.length > 0) { yield seq; seq = []; }
		}
	}
	if (seq.length > 0) yield seq;
}
const kinds = {
	surrogatePairWithoutUFlag: ["Unexpected surrogate pair in character class. Use 'u' flag.", function* (c) { for (let i = 1; i < c.length; i++) if (isSurrogatePair(c[i - 1].value, c[i].value) && !isCpEscape(c[i - 1]) && !isCpEscape(c[i])) yield [c[i - 1], c[i]]; }],
	surrogatePair: ["Unexpected surrogate pair in character class.", function* (c) { for (let i = 1; i < c.length; i++) if (isSurrogatePair(c[i - 1].value, c[i].value) && (isCpEscape(c[i - 1]) || isCpEscape(c[i]))) yield [c[i - 1], c[i]]; }],
	combiningClass: ["Unexpected combined character in character class.", function* (c) { for (let i = 1; i < c.length; i++) if (isCombining(c[i].value) && !isCombining(c[i - 1].value)) yield [c[i - 1], c[i]]; }],
	emojiModifier: ["Unexpected modified Emoji in character class.", function* (c) { for (let i = 1; i < c.length; i++) if (isEmojiModifier(c[i].value) && !isEmojiModifier(c[i - 1].value)) yield [c[i - 1], c[i]]; }],
	regionalIndicatorSymbol: ["Unexpected national flag in character class.", function* (c) { for (let i = 1; i < c.length; i++) if (isRegional(c[i].value) && isRegional(c[i - 1].value)) yield [c[i - 1], c[i]]; }],
	zwj: ["Unexpected joined character sequence in character class.", function* (c) {
		let sequence = null;
		for (let i = 1; i + 1 < c.length; i++) {
			if (c[i].value === 0x200d && c[i - 1].value !== 0x200d && c[i + 1].value !== 0x200d) {
				if (sequence && sequence.at(-1) === c[i - 1]) sequence.push(c[i], c[i + 1]);
				else { if (sequence) yield sequence; sequence = c.slice(i - 1, i + 2); }
			}
		}
		if (sequence) yield sequence;
	}],
};
const parser = new RegExpParser();
// Byte offset of a UTF-16 index of UTF-8 text: `up` for an end, else an index inside a pair is the start of its character.
function byteOf(bytes, index, up) {
	let units = 0, pos = 0;
	while (pos < bytes.length) {
		const len = utf8Len(bytes[pos]);
		const n = len === 4 ? 2 : 1;
		if (units >= index) return pos;
		if (units + n > index) return up ? pos + len : pos;
		units += n;
		pos += len;
	}
	return pos;
}
// `at`: byte offset of the literal in the file. kind: "regex" | "string" | "template". Returns [{ start, end, message }] in bytes.
function verify(file, at, kind, units, flags) {
	let ast;
	try { ast = parser.parsePattern(units, 0, units.length, { unicode: flags.includes("u"), unicodeSets: flags.includes("v") }); } catch { return []; }
	const found = new Map();
	visitRegExpAST(ast, { onCharacterClassEnter(cc) { for (const seq of sequences(cc.elements)) for (const k of Object.keys(kinds)) { if (!found.has(k)) found.set(k, []); found.get(k).push(...kinds[k][1](seq)); } } });
	const out = [];
	let codeUnits = null;
	for (const [k, matches] of found) for (const chars of matches) {
		const first = chars[0].start, last = chars.at(-1).end - 1;
		let start, end;
		if (kind === "regex") {
			const close = file.lastIndexOf(0x2f, file.length); // not used: the pattern is given by the caller
			const pattern = file.subarray(at + 1);
			start = at + 1 + byteOf(pattern, first, false);
			end = at + 1 + byteOf(pattern, last + 1, true);
		} else {
			codeUnits ??= (kind === "string" ? parseStringLiteral : parseTemplateToken)(file.subarray(at));
			start = at + codeUnits[first][0];
			end = at + codeUnits[last][1];
		}
		out.push({ start, end, message: kinds[k][0] });
	}
	return out;
}
// ---- the comparison ----
let seed = Number(process.argv[3] || 7);
const rnd = n => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const plain = ["a", "A", "-", "^", " ", "👍", "👶", "🏻", "🇯", "🇵", "👨", "👩", "👦", "\u200d", "\u0301", "\u20e3", "❇", "\ufe0f", "é", ".", "x"];
const reAtoms = [...plain, "\\u{1F44D}", "\\uD83D", "\\uDC4D", "\\u{D83D}", "\\u{DC4D}", "\\u0301", "\\u{301}", "\\u200d", "\\u{1F3FB}", "\\u{1F1EF}", "\\x41", "\\n", "\\\\", "\\]", "\\👍", "\\d", "a-z"];
const strAtoms = [...reAtoms.map(a => a.replace(/\\/g, "\\\\")), "\\u{1F44D}", "\\uD83D", "\\uDC4D", "\\u0301", "\\u200d", "\\x41", "\\101", "\\0", "\\a", "\\👍", "\\\n", "\\\r\n", "\\u{1F3FB}", "\\u{200D}", "\\t"];
const tplExtra = ["\n", "\r\n", "\r", "\\`", "$", "\\${"];
function build(atoms, max) { let s = ""; for (let k = 1 + rnd(max); k > 0; k--) s += atoms[rnd(atoms.length)]; return s; }
const count = Number(process.argv[2] || 3000);
let compared = 0, same = 0, moved = 0, wrong = 0, skipped = 0;
const toUnits = (buf, off) => buf.subarray(0, off).toString("utf8").length;
for (let t = 0; t < count; t++) {
	const form = rnd(3);
	const flags = ["", "", "u", "v", "i"][rnd(5)];
	const prefix = ["", "é ", "👍/**/ ", "\n "][rnd(4)];
	let literal, code, kind;
	const body = () => (rnd(3) ? "" : build(plain, 2)) + "[" + (rnd(5) ? "" : "^") + build(form === 0 ? reAtoms : form === 1 ? strAtoms : [...strAtoms.filter(a => !/^\\[0-7]/.test(a)), ...tplExtra], 7) + "]" + (rnd(3) ? "" : "[" + build(plain, 3) + "]");
	if (form === 0) { kind = "regex"; literal = "/" + body().replace(/\//g, "") + "/" + flags; code = `${prefix}x = ${literal};`; }
	else if (form === 1) { kind = "string"; const q = rnd(2) ? "'" : '"'; literal = q + body().replace(/['"]/g, "") + q; code = `${prefix}x = new RegExp(${literal}, "${flags}");`; }
	else { kind = "template"; literal = "`" + body().replace(/`(?<!\\`)/g, "") + "`"; code = `${prefix}x = new RegExp(${literal}, "${flags}");`; }
	const messages = linter.verify(code, config);
	if (messages.some(m => m.fatal)) { skipped++; continue; }
	const file = Buffer.from(code, "utf8");
	const at = Buffer.byteLength(code.slice(0, code.indexOf(literal, prefix.length)), "utf8");
	// The value as Bun's tree has it: the engine's own reading of the literal.
	let units;
	if (kind === "regex") units = literal.slice(1, literal.lastIndexOf("/"));
	else { try { units = (0, eval)(literal); } catch { skipped++; continue; } }
	const sub = kind === "regex" ? file.subarray(0, at + 1 + Buffer.byteLength(units, "utf8")) : file;
	const ours = verify(sub, at, kind, units, flags);
	// ESLint's positions as UTF-16 offsets of the file.
	const lineStarts = [0]; { const re = /\r\n|[\r\n\u2028\u2029]/g; let m; while ((m = re.exec(code))) lineStarts.push(m.index + m[0].length); }
	const theirs = messages.map(m => ({ start: lineStarts[m.line - 1] + m.column - 1, end: lineStarts[m.endLine - 1] + m.endColumn - 1, message: m.message }));
	const key = l => l.map(r => `${r.start}-${r.end} ${r.message}`).sort().join("|");
	const exact = key(ours.map(r => ({ start: toUnits(file, r.start), end: toUnits(file, r.end), message: r.message })));
	compared++;
	if (exact === key(theirs)) { same++; continue; }
	// ESLint's offsets rounded the way the model rounds: a start down to its character, an end up.
	const isLow = i => { const c = code.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff && code.charCodeAt(i - 1) >= 0xd800 && code.charCodeAt(i - 1) <= 0xdbff; };
	const rounded = key(theirs.map(r => ({ start: isLow(r.start) ? r.start - 1 : r.start, end: isLow(r.end) ? r.end + 1 : r.end, message: r.message })));
	if (exact === rounded) { moved++; continue; }
	wrong++;
	if (wrong <= 8) console.log("WRONG", JSON.stringify(code), "\n  eslint:", key(theirs), "\n  model: ", exact);
}
console.log({ compared, same, movedOnlyByRounding: moved, wrong, skipped });
