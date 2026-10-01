// Prototype of the source-text tokenizer that the rules use. Works on a Buffer of UTF-8 bytes.
// Everything is byte offsets. No recursion: brackets are kept on an explicit stack.
"use strict";

const PUNCT4 = [">>>="];
const PUNCT3 = ["...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??="];
const PUNCT2 = [
	"=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=",
	"&=", "|=", "^=", "<<", ">>", "**",
];
const PUNCT1 = "{}()[];,<>+-*/%&|^!~?:=.@";

function isDigit(c) {
	return c >= 0x30 && c <= 0x39;
}
function isAsciiIdentStart(c) {
	return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24;
}
function isAsciiIdentPart(c) {
	return isAsciiIdentStart(c) || isDigit(c);
}

// Decodes one UTF-8 sequence. Returns [codePoint, length]; malformed input is one byte of U+FFFD.
function decode(src, i) {
	const b0 = src[i];
	if (b0 < 0x80) return [b0, 1];
	if (b0 >= 0xc2 && b0 <= 0xdf && i + 1 < src.length) return [((b0 & 0x1f) << 6) | (src[i + 1] & 0x3f), 2];
	if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < src.length)
		return [((b0 & 0x0f) << 12) | ((src[i + 1] & 0x3f) << 6) | (src[i + 2] & 0x3f), 3];
	if (b0 >= 0xf0 && b0 <= 0xf4 && i + 3 < src.length)
		return [
			((b0 & 0x07) << 18) | ((src[i + 1] & 0x3f) << 12) | ((src[i + 2] & 0x3f) << 6) | (src[i + 3] & 0x3f),
			4,
		];
	return [0xfffd, 1];
}

function isSpace(cp) {
	return (
		cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d || cp === 0x20 ||
		cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 ||
		cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0xfeff
	);
}
function isLineEnd(cp) {
	return cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029;
}

// Skips white space and comments. Returns the new offset, or -1 for a block comment without an end.
// `-->` after a line end is a comment to the end of its line, as in Bun's lexer.
function skipTrivia(src, i) {
	let newline = false;
	for (;;) {
		if (i >= src.length) return i;
		const c = src[i];
		if (c === 0x2f && src[i + 1] === 0x2f) {
			i = lineEnd(src, i + 2);
			continue;
		}
		if (c === 0x2f && src[i + 1] === 0x2a) {
			const end = src.indexOf("*/", i + 2);
			if (end < 0) return -1;
			for (let k = i + 2; k < end; ) {
				const [cp, n] = decode(src, k);
				if (isLineEnd(cp)) newline = true;
				k += n;
			}
			i = end + 2;
			continue;
		}
		if (newline && c === 0x2d && src[i + 1] === 0x2d && src[i + 2] === 0x3e) {
			i = lineEnd(src, i + 3);
			continue;
		}
		const [cp, n] = decode(src, i);
		if (!isSpace(cp)) return i;
		if (isLineEnd(cp)) newline = true;
		i += n;
	}
}

// The offset of the line end at or after i, or the length of the text.
function lineEnd(src, i) {
	while (i < src.length) {
		const [cp, n] = decode(src, i);
		if (isLineEnd(cp)) break;
		i += n;
	}
	return i;
}

// The end of the identifier name that starts at i (escapes are part of it), or i when there is none.
function identEnd(src, i) {
	let first = true;
	for (;;) {
		if (i >= src.length) return i;
		const c = src[i];
		if (c < 0x80) {
			if (first ? isAsciiIdentStart(c) : isAsciiIdentPart(c)) {
				i += 1;
			} else if (c === 0x5c && src[i + 1] === 0x75) {
				if (src[i + 2] === 0x7b) {
					const close = src.indexOf("}", i + 3);
					if (close < 0) return i;
					i = close + 1;
				} else {
					if (i + 6 > src.length) return i;
					i += 6;
				}
			} else {
				return i;
			}
		} else {
			const [cp, n] = decode(src, i);
			if (isSpace(cp)) return i;
			i += n;
		}
		first = false;
	}
}

// The cooked bytes of an identifier name (escapes decoded).
function cookIdent(src, s, e) {
	const raw = src.subarray(s, e);
	if (raw.indexOf(0x5c) < 0) return raw;
	let out = "";
	const text = raw.toString("utf8");
	for (let i = 0; i < text.length; ) {
		if (text[i] === "\\" && text[i + 1] === "u") {
			if (text[i + 2] === "{") {
				const close = text.indexOf("}", i);
				out += String.fromCodePoint(parseInt(text.slice(i + 3, close), 16));
				i = close + 1;
			} else {
				out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
				i += 6;
			}
		} else {
			out += text[i];
			i += 1;
		}
	}
	return Buffer.from(out, "utf8");
}

function digitsEnd(src, i, pred) {
	while (i < src.length && (pred(src[i]) || src[i] === 0x5f)) i += 1;
	return i;
}
const isHex = c => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isOct = c => c >= 0x30 && c <= 0x37;
const isBin = c => c === 0x30 || c === 0x31;

// The end of the numeric literal that starts at i (a digit, or a dot before a digit).
function numberEnd(src, i) {
	const c0 = src[i];
	const c1 = src[i + 1];
	if (c0 === 0x30 && (c1 === 0x78 || c1 === 0x58 || c1 === 0x6f || c1 === 0x4f || c1 === 0x62 || c1 === 0x42)) {
		const pred = c1 === 0x78 || c1 === 0x58 ? isHex : c1 === 0x6f || c1 === 0x4f ? isOct : isBin;
		let e = digitsEnd(src, i + 2, pred);
		if (src[e] === 0x6e) e += 1;
		return e;
	}
	let e = i;
	let sawDot = false;
	if (c0 === 0x2e) {
		sawDot = true;
		e = digitsEnd(src, i + 1, isDigit);
	} else {
		e = digitsEnd(src, i, isDigit);
		if (c0 === 0x30 && e > i + 1) {
			// A leading zero: legacy octal when every digit is below 8, and that one has no fraction.
			let legacy = true;
			for (let k = i; k < e; k++) if (src[k] === 0x38 || src[k] === 0x39) legacy = false;
			if (legacy) return e;
		}
		if (src[e] === 0x6e) return e + 1;
		if (src[e] === 0x2e) {
			sawDot = true;
			e = digitsEnd(src, e + 1, isDigit);
		}
	}
	if (src[e] === 0x65 || src[e] === 0x45) {
		let k = e + 1;
		if (src[k] === 0x2b || src[k] === 0x2d) k += 1;
		if (isDigit(src[k])) e = digitsEnd(src, k, isDigit);
	}
	void sawDot;
	return e;
}

// The end of the string literal whose quote is at i, or -1.
function stringEnd(src, i) {
	const q = src[i];
	let k = i + 1;
	while (k < src.length) {
		const c = src[k];
		if (c === 0x5c) {
			k += 2;
			continue;
		}
		if (c === q) return k + 1;
		if (c === 0x0a || c === 0x0d) return -1;
		k += 1;
	}
	return -1;
}

// Scans template characters from i (just after a backtick or after the brace that ends a substitution).
// Returns [end, opensSubstitution]: end is after the closing backtick or after "${".
function templateChunkEnd(src, i) {
	let k = i;
	while (k < src.length) {
		const c = src[k];
		if (c === 0x5c) {
			k += 2;
			continue;
		}
		if (c === 0x60) return [k + 1, false];
		if (c === 0x24 && src[k + 1] === 0x7b) return [k + 2, true];
		k += 1;
	}
	return [-1, false];
}

const K = { Word: 1, Private: 2, Number: 3, String: 4, Template: 5, Regex: 6, Punct: 7 };

// Tokens of the expression that starts at `start` and ends before the colon of its case clause.
// regex: sorted list of [start, end) of the regular expression literals inside the expression.
// Returns null when the text cannot be read as expected.
function scanCaseTest(src, start, regex) {
	const tokens = [];
	// One entry per open bracket: the byte that closes it, and the count of `?` that wait for their `:`.
	const stack = [];
	let pendingTop = 0;
	let leadingCloses = 0;
	let trailingCloses = 0;
	let i = start;
	let r = 0;
	for (;;) {
		i = skipTrivia(src, i);
		if (i < 0 || i >= src.length) return null;
		const c = src[i];
		while (r < regex.length && regex[r][0] < i) r += 1;
		let s = i;
		let kind;
		if (r < regex.length && regex[r][0] === i) {
			i = regex[r][1];
			kind = K.Regex;
		} else if (isDigit(c) || (c === 0x2e && isDigit(src[i + 1]))) {
			i = numberEnd(src, i);
			kind = K.Number;
		} else if (c === 0x27 || c === 0x22) {
			i = stringEnd(src, i);
			if (i < 0) return null;
			kind = K.String;
		} else if (c === 0x60) {
			const [e, opens] = templateChunkEnd(src, i + 1);
			if (e < 0) return null;
			i = e;
			kind = K.Template;
			if (opens) {
				stack.push({ close: 0x60, pending: pendingTop });
				pendingTop = 0;
			}
		} else if (c === 0x23) {
			i = identEnd(src, i + 1);
			if (i === s + 1) return null;
			kind = K.Private;
		} else if (c >= 0x80 || isAsciiIdentStart(c) || c === 0x5c) {
			i = identEnd(src, i);
			if (i === s) return null;
			kind = K.Word;
		} else {
			kind = K.Punct;
			const rest = src.subarray(i, i + 4).toString("latin1");
			let p = null;
			if (PUNCT4.includes(rest.slice(0, 4))) p = rest.slice(0, 4);
			else if (PUNCT3.includes(rest.slice(0, 3))) p = rest.slice(0, 3);
			else if (PUNCT2.includes(rest.slice(0, 2)) && !(rest.slice(0, 2) === "?." && isDigit(src[i + 2])))
				p = rest.slice(0, 2);
			else if (PUNCT1.includes(rest[0])) p = rest[0];
			else return null;
			i += p.length;
			if (p === "(" || p === "[" || p === "{") {
				stack.push({ close: p === "(" ? 0x29 : p === "[" ? 0x5d : 0x7d, pending: pendingTop });
				pendingTop = 0;
			} else if (p === ")" || p === "]" || p === "}") {
				const top = stack[stack.length - 1];
				if (top === undefined) {
					if (p !== ")") return null;
					leadingCloses += 1;
					trailingCloses += 1;
					tokens.push({ s, e: i, kind, leading: true });
					continue;
				}
				if (p === "}" && top.close === 0x60) {
					// The brace that ends a substitution starts the next chunk of its template.
					stack.pop();
					pendingTop = top.pending;
					const [e, opens] = templateChunkEnd(src, i);
					if (e < 0) return null;
					i = e;
					kind = K.Template;
					if (opens) {
						stack.push({ close: 0x60, pending: pendingTop });
						pendingTop = 0;
					}
				} else {
					if (top.close !== p.charCodeAt(0)) return null;
					stack.pop();
					pendingTop = top.pending;
				}
			} else if (p === "?") {
				pendingTop += 1;
			} else if (p === ":") {
				if (pendingTop > 0) {
					pendingTop -= 1;
				} else if (stack.length === 0) {
					// The colon of the case clause.
					const own = tokens.slice(0, tokens.length - trailingCloses);
					return { tokens: own, innerOpens: leadingCloses - trailingCloses, leadingCloses, colon: s };
				}
			}
		}
		trailingCloses = 0;
		tokens.push({ s, e: i, kind });
	}
}

function tokenBytes(src, t) {
	if (t.kind === K.Word) return cookIdent(src, t.s, t.e);
	if (t.kind === K.Private) return Buffer.concat([Buffer.from("#"), cookIdent(src, t.s + 1, t.e)]);
	return src.subarray(t.s, t.e);
}

function sameTest(src, a, b) {
	if (a.innerOpens !== b.innerOpens || a.tokens.length !== b.tokens.length) return false;
	for (let i = 0; i < a.tokens.length; i++) {
		const x = a.tokens[i];
		const y = b.tokens[i];
		if (x.kind !== y.kind) return false;
		if (!tokenBytes(src, x).equals(tokenBytes(src, y))) return false;
	}
	return true;
}

// The offset of the open parenthesis that is `parens` parentheses before `at`, when only white space
// and comments are between them. Tries each `(` before `at`, nearest first, and checks it forward.
// Returns -1 when none fits within `limit` candidates. parens is at least 1.
function backOver(src, at, parens, limit = 64) {
	let from = at - 1;
	for (let tries = 0; tries < limit; tries++) {
		if (from < 0) return -1;
		const c = src.lastIndexOf(0x28, from);
		if (c < 0) return -1;
		from = c - 1;
		if (onlyTriviaAndParens(src, c, at, parens)) return c;
	}
	return -1;
}

// True when only white space, comments and exactly `parens` open parentheses are between from and to.
function onlyTriviaAndParens(src, from, to, parens) {
	let i = from;
	let seen = 0;
	for (;;) {
		i = skipTrivia(src, i);
		if (i < 0 || i > to) return false;
		if (i === to) return seen === parens;
		if (src[i] !== 0x28) return false;
		seen += 1;
		i += 1;
	}
}

function isWordAt(src, at, word) {
	if (at < 0 || at + word.length > src.length) return false;
	if (src.subarray(at, at + word.length).toString("latin1") !== word) return false;
	if (at > 0) {
		let k = at - 1;
		while (k > 0 && (src[k] & 0xc0) === 0x80) k -= 1;
		const [cp, n] = decode(src, k);
		if (k + n !== at) return false;
		if (cp >= 0x80) return isSpace(cp);
		if (isAsciiIdentPart(cp) || cp === 0x5c || cp === 0x23 || cp === 0x2e) return false;
	}
	const after = src[at + word.length];
	if (after !== undefined && (isAsciiIdentPart(after) || after === 0x5c)) return false;
	if (after !== undefined && after >= 0x80) {
		const [cp] = decode(src, at + word.length);
		if (!isSpace(cp)) return false;
	}
	return true;
}

function lineStart(src, at) {
	let i = at;
	while (i > 0 && src[i - 1] !== 0x0a && src[i - 1] !== 0x0d) i -= 1;
	return i;
}

// True when a `case` keyword can stand at `at`: after the open brace, a colon, a semicolon, a close brace,
// or on a new line. Goes back over white space and block comments.
function keywordCanStandAt(src, at, floor) {
	let i = at;
	let newline = false;
	for (;;) {
		if (i <= floor) return true;
		let k = i - 1;
		while (k > 0 && (src[k] & 0xc0) === 0x80) k -= 1;
		const [cp, n] = decode(src, k);
		if (k + n === i && isSpace(cp)) {
			if (cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029) newline = true;
			i = k;
			continue;
		}
		if (i >= 2 && src[i - 1] === 0x2f && src[i - 2] === 0x2a) {
			const open = src.lastIndexOf("/*", i - 3);
			if (open < floor) return false;
			i = open;
			continue;
		}
		if (newline) return true;
		const c = src[i - 1];
		return c === 0x7b || c === 0x7d || c === 0x3a || c === 0x3b;
	}
}

// The offset of the `case` keyword of the test that starts at valueStart, or -1.
// parens: the count of open parentheses between the keyword and the test.
// floor: the offset after the open brace of the switch body.
// Tries each `case` before the test, nearest first, at most `limit` of them. One where a keyword can
// stand wins. Without such a one, the nearest that has only white space, comments and the parentheses
// between itself and the test.
function findCaseKeyword(src, valueStart, parens, floor, limit = 8) {
	let from = valueStart - 4;
	let nearest = -1;
	for (let tries = 0; tries < limit; ) {
		if (from < floor) break;
		const at = src.lastIndexOf("case", from);
		if (at < floor) break;
		from = at - 1;
		if (!isWordAt(src, at, "case")) continue;
		tries += 1;
		if (!onlyTriviaAndParens(src, at + 4, valueStart, parens)) continue;
		if (keywordCanStandAt(src, at, floor)) return at;
		if (nearest < 0) nearest = at;
	}
	return nearest;
}

module.exports = {
	K, scanCaseTest, sameTest, skipTrivia, identEnd, numberEnd, stringEnd, cookIdent, backOver,
	onlyTriviaAndParens, findCaseKeyword, keywordCanStandAt, isWordAt, decode, isSpace, templateChunkEnd,
};
