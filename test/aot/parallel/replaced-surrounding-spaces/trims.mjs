// replace() by nothing of spaces around a text: every kind of space, texts of spaces alone, wide, composed and cut texts, and what the last match is.
const unseen = x => [x][JSON.parse("0")];
const patterns = unseen([/^\s*|\s*$/g, /^\s+|\s+$/g, /^\s+|\s+$/, /^\s*|\s*$/gm, /^\s+|\s+$/gi, /^\s+|\s+$/gu, /^\s+|\s*$/g, /^ +| +$/g, /\s+$/g, /^\s+/g]);
const texts = unseen(["", "a", "  a", "a  ", "  a  ", "   ", "\t\n a b \r\n", " a﻿", " Ā　", " a\n b ", "​a​", "\u0085a", ("  x" + unseen(" y ") + " ").repeat(30), "--  cut  --".slice(2, 9), "\v\f a   ", "é ", " 😀 "]);
const trim = (text, re, by) => text.replace(re, by);
for (const re of patterns) {
  const out = [];
  for (const text of texts) {
    re.lastIndex = 2;
    /(q)/.test("q");
    const made = trim(text, re, "");
    out.push(JSON.stringify(made.length > 30 ? made.length : made), re.lastIndex, JSON.stringify(RegExp.lastMatch), RegExp.leftContext.length, RegExp.rightContext.length, JSON.stringify(trim(text, re, "|")).length, JSON.stringify(trim(text, re, "$&")).length);
    re.lastIndex = 0;
  }
  console.log(out.join(" "));
}
const frozen = Object.freeze(/^\s+|\s+$/g);
for (const text of texts.slice(0, 5)) { try { console.log(trim(text, frozen, "")); } catch (error) { console.log(error.constructor.name); } }
class Own extends RegExp { [Symbol.replace](text, by) { return "own " + text + by; } }
console.log(trim("  a ", new Own("^\\s+|\\s+$", "g"), ""));
const named = /^\s+|\s+$/g; named.exec = function (text) { const found = RegExp.prototype.exec.call(this, text); return found && text.length > 3 ? found : null; };
console.log(trim("  a  ", named, ""), trim(" a", named, ""));
