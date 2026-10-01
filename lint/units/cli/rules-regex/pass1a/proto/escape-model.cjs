// Model of the string and template part of no-useless-escape as it is to be written on the bytes of the file, compared with
// ESLint at the pin: random string literals, templates with and without substitutions, tagged templates.
// usage: node escape-model.cjs [count] [seed]
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const config = [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-useless-escape": "error" } }];
function utf8Len(b) { return b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4; }
// After the quote that ends the string literal at `at`.
function stringEnd(src, at) {
	const quote = src[at];
	let i = at + 1;
	while (i < src.length) { if (src[i] === 0x5c) i += 2; else if (src[i] === quote) return i + 1; else i += 1; }
	return src.length;
}
// After the backtick or the `${` that ends the template text which starts after `at` (a backtick or a `}`).
function templateEnd(src, at) {
	let i = at + 1;
	while (i < src.length) { if (src[i] === 0x5c) i += 2; else if (src[i] === 0x60) return i + 1; else if (src[i] === 0x24 && src[i + 1] === 0x7b) return i + 2; else i += 1; }
	return src.length;
}
// The reports of one string literal or one piece of template text: [offset of the backslash, the escaped character as bytes].
function scan(src, at, end, template) {
	const out = [];
	const quote = src[at];
	let i = at;
	while (i < end) {
		if (src[i] !== 0x5c || i + 1 >= end) { i += 1; continue; }
		const c = src[i + 1];
		if (c >= 0x30 && c <= 0x39) { i += 1; continue; }
		const len = utf8Len(c);
		const isLineBreak = c === 0x0a || c === 0x0d || (c === 0xe2 && src[i + 2] === 0x80 && (src[i + 3] === 0xa8 || src[i + 3] === 0xa9));
		let useless = !(isLineBreak || [0x5c, 0x6e, 0x72, 0x76, 0x74, 0x62, 0x66, 0x75, 0x78].includes(c));
		let isQuote;
		if (template) {
			isQuote = c === 0x60;
			if (c === 0x24) useless = src[i + 2] !== 0x7b;
			else if (c === 0x7b) useless = src[i - 1] !== 0x24;
		} else isQuote = c === quote;
		if (useless && !isQuote) out.push([i, src.subarray(i + 1, i + 1 + len).toString("utf8")]);
		i += 1 + len;
	}
	return out;
}
let seed = Number(process.argv[3] || 99);
const rnd = n => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const atoms = ["a", " ", "\\a", "\\n", "\\\\", "\\\\\\", "\\'", "\\\"", "\\`", "\\$", "\\{", "$", "{", "}", "\\}", "\\u0041", "\\x41", "\\0", "\\1", "\\8", "\\👍", "👍", "é", "\\é", "\\\n", "\\\r\n", "\\\u2028", "\\ ", "\\-", "\\/", "\\d", "\\.", "$\\{", "\\$\\{", "\\${", "\\\t", "\\u{1F600}"];
const count = Number(process.argv[2] || 4000);
let compared = 0, wrong = 0, skipped = 0;
for (let t = 0; t < count; t++) {
	const form = rnd(4);
	const body = n => { let s = ""; for (let k = rnd(n); k > 0; k--) s += atoms[rnd(atoms.length)]; return s; };
	let code, pieces;
	const prefix = ["", "é = ", "x =\n"][rnd(3)];
	if (form === 0) { const q = rnd(2) ? "'" : '"'; code = `${prefix}${q}${body(7).replace(/\n|\r|\u2028(?<!\\.)/g, "")}${q};`; }
	else if (form === 1) code = `${prefix}\`${body(7)}\`;`;
	else if (form === 2) code = `${prefix}\`${body(4)}\${'${body(3).replace(/[\n\r\u2028]/g, "")}'}${body(4)}\${y}${body(3)}\`;`;
	else code = `${prefix}tag\`${body(4)}\${\`${body(3)}\`}${body(4)}\`;`;
	const messages = linter.verify(code, config);
	if (messages.some(m => m.fatal)) { skipped++; continue; }
	const src = Buffer.from(code, "utf8");
	// The walk: a string at its quote, a template at its backtick, its later pieces at the `}` of their substitution; a tagged one is not read.
	const ours = [];
	const p = Buffer.byteLength(prefix, "utf8");
	const str = at => ours.push(...scan(src, at, stringEnd(src, at), false));
	const tpl = at => { const end = templateEnd(src, at); ours.push(...scan(src, at, end, true)); return end; };
	if (form === 0) str(p);
	else if (form === 1) tpl(p);
	else if (form === 2) {
		let end = tpl(p); // head, ends after `${`
		str(end); end = stringEnd(src, end); // the string inside the substitution
		end = tpl(end); // middle, starts at `}`
		end += 1; // y
		tpl(end);
	} else {
		// tag`..${`inner`}..`: only the inner template is read.
		const head = templateEnd(src, p + 3);
		tpl(head);
	}
	const lineStarts = [0]; { const re = /\r\n|[\r\n\u2028\u2029]/g; let m; while ((m = re.exec(code))) lineStarts.push(m.index + m[0].length); }
	const theirs = messages.map(m => `${lineStarts[m.line - 1] + m.column - 1} ${m.message}`).sort().join("|");
	const mine = ours.map(([off, ch]) => `${src.subarray(0, off).toString("utf8").length} Unnecessary escape character: \\${ch}.`).sort().join("|");
	compared++;
	if (theirs !== mine) { wrong++; if (wrong <= 8) console.log("WRONG", JSON.stringify(code), "\n  eslint:", theirs, "\n  model: ", mine); }
}
console.log({ compared, wrong, skipped });
