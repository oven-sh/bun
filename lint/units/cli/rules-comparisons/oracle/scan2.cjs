// Scratch: same scan as scan.cjs, plus the end of the operand (the token before the operator word).
const espree = require("espree");
const isLT = (t, i) => { const c = t.charCodeAt(i); return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029; };
function scan(text, from, to, regexes, jsx, operator) {
	let i = from, depth = 0, newlineBefore = false;
	const templates = []; let braces = 0;
	// The last word, the end of the token before it, and whether only `(` followed it.
	let wordStart = -1, wordEnd = -1, endBeforeWord = from, onlyParensSinceWord = false;
	let lastEnd = from; let inWord = false;
	const other = (end, isOpenParen) => { inWord = false; lastEnd = end; newlineBefore = false; if (!isOpenParen) onlyParensSinceWord = false; };
	const skipString = q => { i++; while (i < to) { const c = text[i]; if (c === "\\") { i += 2; continue; } i++; if (c === q) return true; } return false; };
	const skipTemplateText = () => { while (i < to) { const c = text[i]; if (c === "\\") { i += 2; continue; } if (c === "`") { i++; return true; } if (c === "$" && text[i + 1] === "{") { i += 2; templates.push(braces); braces = 0; return true; } i++; } return false; };
	while (i < to) {
		const c = text[i];
		if (isLT(text, i)) { newlineBefore = true; i++; inWord = false; continue; }
		if (regexes.has(i)) { i += regexes.get(i); other(i); continue; }
		if (jsx.has(i)) { i = jsx.get(i); other(i); continue; }
		if (c === "/" && text[i + 1] === "/") { i += 2; while (i < to && !isLT(text, i)) i++; inWord = false; continue; }
		if (c === "/" && text[i + 1] === "*") { const close = text.indexOf("*/", i + 2); if (close === -1 || close + 2 > to) return { unknown: "comment" }; for (let k = i; k < close; k++) if (isLT(text, k)) newlineBefore = true; i = close + 2; inWord = false; continue; }
		if (c === "-" && text[i + 1] === "-" && text[i + 2] === ">" && newlineBefore) { i += 3; while (i < to && !isLT(text, i)) i++; inWord = false; continue; }
		if (c === '"' || c === "'") { if (!skipString(c)) return { unknown: "string" }; other(i); continue; }
		if (c === "`") { i++; if (!skipTemplateText()) return { unknown: "template" }; other(i); continue; }
		if (c === "{") { braces++; i++; other(i); continue; }
		if (c === "}") { if (braces === 0 && templates.length > 0) { braces = templates.pop(); i++; if (!skipTemplateText()) return { unknown: "template" }; other(i); continue; } braces--; i++; other(i); continue; }
		if (c === "(") { depth++; i++; other(i, true); continue; }
		if (c === ")") { depth--; if (depth < 0) return { parenthesised: true }; i++; other(i); continue; }
		if (c === " " || c === "\t" || /\s/u.test(c) || c === "\ufeff") { i++; inWord = false; continue; }
		const word = /[\p{ID_Continue}$\u200c\u200d\\]/u.test(c);
		if (word) {
			if (!inWord) { endBeforeWord = lastEnd; wordStart = i; onlyParensSinceWord = true; inWord = true; }
			wordEnd = i + 1; lastEnd = i + 1; newlineBefore = false;
		} else { other(i + 1); }
		i++;
	}
	if (i !== to) return { unknown: "overrun" };
	const end = onlyParensSinceWord && text.slice(wordStart, wordEnd) === operator ? endBeforeWord : -1;
	return { parenthesised: false, end };
}
module.exports = { scan };
