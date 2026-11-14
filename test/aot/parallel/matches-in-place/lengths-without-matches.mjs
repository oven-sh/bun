// STATISTIC: StringsWithoutMatchesElided >= 50
// The length of a string without the matches of a pattern.
const flat = ["alpha-12", "beta", "", " ", "  a  b  ", "aaaa", "aaaaa", "abababa", "d1d1xd1", "NQ_VQ-NQ_VQNQ_V", "a\nb\r\nc", "x".repeat(70) + "7", ("d1".repeat(20) + "dd11").repeat(9), "é1é", "Āb1Ā1", "😀a😀", "\ud83da", "?a=1&b=2", "'q' 'r'"];
const ropes = flat.map((s, i) => s + String(i) + s);
const pieces = flat.map(s => ("xy" + s + "zw").slice(2, 2 + s.length));
const all = [...flat, ...ropes, ...pieces];
function last() { return [RegExp.lastMatch, RegExp.$1, RegExp.leftContext.length, RegExp.rightContext.length, RegExp.input?.length].join("|"); }
const spaces = /\s+/g, trim = /^\s*|\s*$/g, held = /(\d)(\d)?/g;
let variable = /[a-z]+/;
function one(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/a/, "").length; out += n + ":" + last() + ";"; } return out; }
function every(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/a/g, "").length; out += n + ":" + last() + ";"; } return out; }
function two(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/d1/g, "").length; out += n + ":" + last() + ";"; } return out; }
function long(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/NQ_VQ/g, "").length; out += n + ":" + last() + ";"; } return out; }
function overlap(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/aa/g, "").length; out += n + ":" + last() + ";"; } return out; }
function border(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/aba/g, "").length; out += n + ":" + last() + ";"; } return out; }
function wideAtom(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/Ā/g, "").length; out += n + ":" + last() + ";"; } return out; }
function latinAtom(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/é1/g, "").length; out += n + ":" + last() + ";"; } return out; }
function set(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/[^a-z]/g, "").length; out += n + ":" + last() + ";"; } return out; }
function run(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(spaces, "").length; out += n + ":" + last() + ";"; } return out; }
function trimSpaces(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(trim, "").length; out += n + ":" + last() + ";"; } return out; }
function trimPlus(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/^\s+|\s+$/g, "").length; out += n + ":" + last() + ";"; } return out; }
function heldByConst(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(held, "").length; out += n + ":" + last() + ";"; } return out; }
function byVariable(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(variable, "").length; out += n + ":" + last() + ";"; } return out; }
function empty(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/x*/g, "").length; out += n + ":" + last() + ";"; } return out; }
function emptyUnicode(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/(?:)/gu, "").length; out += n + ":" + last() + ";"; } return out; }
function any(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/./, "").length; out += n + ":" + last() + ";"; } return out; }
function unicode(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/./gu, "").length; out += n + ":" + last() + ";"; } return out; }
function sticky(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/a/y, "").length; out += n + ":" + last() + ";"; } return out; }
function stickyGlobal(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/[a-d]/gy, "").length; out += n + ":" + last() + ";"; } return out; }
function back(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/(.)\1/g, "").length; out += n + ":" + last() + ";"; } return out; }
function look(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/a(?=b)/gi, "").length; out += n + ":" + last() + ";"; } return out; }
function behind(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/(?<=d)1/g, "").length; out += n + ":" + last() + ";"; } return out; }
function optional(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s?.replace(/b/g, "")?.length; out += n + ":" + last() + ";"; } return out; }
function compared(list) { let out = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const n = s.replace(/1/g, "").length === s.length ? -1 : 1; out += n + ":" + last() + ";"; } return out; }
for (const f of [one, every, two, long, overlap, border, wideAtom, latinAtom, set, run, trimSpaces, trimPlus, heldByConst, byVariable, empty, emptyUnicode, any, unicode, sticky, stickyGlobal, back, look, behind, optional, compared]) console.log(f.name, f(all));
function counted(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].replace(/d1/g, "").length * 3 + list[i].replace(spaces, "").length; return sum; }
console.log(counted(all));
// lastIndex is stored as by a replace.
const g = /a/g; g.lastIndex = 2; console.log("banana".replace(g, "").length, g.lastIndex);
const plain = /a/; plain.lastIndex = 2; console.log("banana".replace(plain, "").length, plain.lastIndex);
const object = /a/g; object.lastIndex = { valueOf() { console.log("seen"); return 1; } }; console.log("banana".replace(object, "").length, object.lastIndex);
const frozen = Object.freeze(/a/g); try { console.log("banana".replace(frozen, "").length); } catch (e) { console.log(e.name); }
const recompiled = /a/g; console.log("banana".replace(recompiled, "").length); recompiled.compile("[an]", "g"); console.log("banana".replace(recompiled, "").length);
const own = /a/g; Object.defineProperty(own, "exec", { value: () => null }); console.log("banana".replace(own, "").length);
class Heir extends RegExp { exec(s) { const m = super.exec(s); return m && m.index < 2 ? m : null; } }
const heir = new Heir("a", "g"); console.log("banana".replace(heir, "").length);
const made = new RegExp("n" + "a".repeat(all.length > 5 ? 1 : 2), "g"); console.log("banana".replace(made, "").length);
const replaced = { [Symbol.replace](s, by) { return s + by + "!!"; } }; console.log("banana".replace(replaced, "").length);
console.log("banana".replace("a", "").length, "banana".replaceAll("a", "").length, "banana".replace(/a/g, "--").length);
let text = "banana"; const by = "banana".replace(/a/g, ""); console.log(by.length, by, text.replace(/n/g, "").length + by);
