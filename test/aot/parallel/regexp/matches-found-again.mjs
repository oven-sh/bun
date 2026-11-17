// text.replace(re, key => captured[key]) in long strings: what was found under a match is remembered until the function is called.
// STATISTIC: KeyedLookupFunctions >= 5
const shown = v => { let h = 0; for (let i = 0; i < v.length; i++) h = Math.imul(h, 31) + v.charCodeAt(i) | 0; return v.length + " " + h + " " + v.slice(0, 60); };
const pieces = [];
for (let i = 0; i < 2600; i++) pieces.push(["w" + i % 700, "a", "bb", "1", "12", "n", "none", "x"][i % 8]);
const text = pieces.join(" "), wide = text + " ሴ", short = "a & b < c > a", empty = "";
const words = () => { const o = {}; for (let i = 0; i < 700; i++) o["w" + i] = i % 3 ? "<" + i + ">" : ""; o.a = "A"; o.bb = "a longer replacement than sixteen characters"; o[1] = "one"; o[12] = 12; o.x = null; return o; };
const replaceIn = (s, map) => s.replace(/\b\w+\b/g, key => map[key]);
function changes(s) { let map = words(), turns = 0; Object.defineProperty(map, "none", { get() { turns++; if (turns % 50 === 0) map = words(); map.a = "A" + turns; map["w" + turns] = "changed"; return "got"; } }); return s.replace(/\b\w+\b/g, key => map[key]); }
function throwsAt(s, last) { let turns = 0; const map = words(); Object.defineProperty(map, "none", { get() { if (++turns === last) throw new RangeError("stop"); return "."; } }); try { return s.replace(/\w+/g, key => map[key]); } catch (e) { return e.name + turns; } }
function widens(s) { const map = words(); map.w9 = "••"; map.w10 = "é"; return s.replace(/\w+/g, key => map[key]); }
function numbers(s) { const map = { a: 1.5, bb: -0, 1: 1e21, 12: 12n, n: true, x: undefined }; return s.replace(/\w+/g, key => map[key]); }
function array(s) { const map = ["zero", , "two"]; map[12] = "twelve"; map.a = "named"; return s.replace(/\w+/g, key => map[key]); }
function again(s) { const map = words(); let all = ""; for (let i = 0; i < 4; i++) { all = s.replace(/\w+/g, key => map[key]); map.a = "turn " + i; delete map["w" + i * 8]; } return all; }
function inside(s) { const map = words(); let inner = 0; return s.replace(/none|a/g, key => { inner += "a a".replace(/a/g, k => map[k]).length; return map[key] ?? inner; }); }
const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escape = s => s.replace(/[&<>]/g, c => escapes[c]);
for (let turn = 0; turn < 2; turn++) {
  for (const s of [text, wide, short, empty]) {
    console.log(shown(replaceIn(s, words())), shown(changes(s)), throwsAt(s, 30).slice(0, 20), shown(widens(s)));
    console.log(shown(numbers(s)), shown(array(s)), shown(again(s)), shown(inside(s)), shown(escape(s)));
  }
}
console.log(escape("a && b << c"), replaceIn("x a 1", { x: "y" }), replaceIn("nothing", null ?? {}));
