// The first code point of a string, in loops and outside them.
const texts = ["", "a", "é", "ÿ", "Ā", "あx", "\u{1f0a1}", "\u{1f0a1}z", "\ud83c", "\ud83cx", "\udca1", "\udca1\ud83c", "\u{10ffff}", "0" + "1".repeat(20), "ab".slice(1), "\u{1f600}bc".slice(0, 2), "q" + String(texts0()), "\u{1f0ae}".repeat(3)];
function texts0() { return "rope".repeat(9); }
const show = v => (Number.isNaN(v) ? "NaN" : String(v));
function points(list) { let text = ""; for (const t of list) text += show(t.codePointAt(0)) + "/" + show(t.codePointAt()) + "/" + show(t.charCodeAt(0)) + "/" + show(t.codePointAt(1)) + "/" + show(t.at(0)) + "/" + show(t.charAt(0)) + " "; return text; }
function low(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum = sum * 3 + (list[i].codePointAt(0) & 0xf); return sum % 1000003; }
function at(list, k) { let text = ""; for (let i = 0; i < list.length; i++) text += show(list[i].codePointAt(k)) + " "; return text; }
console.log(points(texts), low(texts), at(texts, 0), at(texts, 1), at(texts, -1), at(texts, undefined), at(texts, "0"), at(texts, 0.5), at(texts, -0));
const one = texts.map(t => t.codePointAt(0)), alone = t => t.codePointAt(0);
console.log(one.map(show).join(), texts.map(alone).map(show).join(), texts.map(t => [...t].length).join());
for (const bad of [5, {}, [], Symbol("x")]) try { console.log(low([bad])); } catch (error) { console.log(error.constructor.name, error.message); }
