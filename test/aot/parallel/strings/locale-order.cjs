// localeCompare of every pair of short and long texts: cases, digits, punctuation, controls, accents, equal prefixes, lengths around words and half words.
"use strict";
const out = [];
const alphabet = ["a", "A", "b", "B", "z", "Z", "0", "1", "9", "_", "-", " ", "!", "~", "[", "`", "@", "\u0000", "\u0001", "\t", "\n", "\u007f", "é", "ß", "Ж"];
const bases = ["", "f", "fo", "foo", "foo1", "foo12", "foo123", "foo1234", "foo12345", "foo123456", "prefix of a longer text ", "0123456789abcdefghij"];
const texts = []; for (const b of bases) { texts.push(b); for (const c of alphabet) texts.push(b + c, c + b, b + c + b.slice(0, 3)); }
function order(a, b) { return a.localeCompare(b); }
function below(a, b) { if (a.localeCompare(b) < 0) return 1; if (a.localeCompare(b) > 0) return 2; return 3; }
let h = 0; for (let i = 0; i < texts.length; i++) { let row = ""; for (let k = 0; k < texts.length; k++) { const r = order(texts[i], texts[k]); row += r < 0 ? "<" : r > 0 ? ">" : "="; h = (h * 31 + below(texts[i], texts[k])) | 0; } out.push(JSON.stringify(texts[i]) + row); }
out.push(String(h));
for (let i = 0; i < 300; i++) { const a = "foo" + i * 7919 % 1000, b = "foo" + i * 104729 % 1000; out.push(a + " " + b + " " + order(a, b) + order(b, a) + order(a, "foo" + i * 7919 % 1000) + order(a.slice(1), b.slice(1)) + order(a.toUpperCase(), b)); }
out.push(texts.slice().sort((a, b) => a.localeCompare(b)).map(t => JSON.stringify(t)).join());
for (const line of out) console.log(line);
