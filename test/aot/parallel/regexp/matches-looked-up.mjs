// text.replace(re, key => captured[key]): a match under whose key the captured object holds a plain value is looked up, and the function is not called.
// STATISTIC: KeyedLookupFunctions >= 4
const log = [];
const words = () => { const o = {}; for (let i = 0; i < 300; i++) o["w" + i] = "<" + i + ">"; o.a = "A"; o[1] = "I"; o[10] = 10; o.n = null; return o; };
let text = "";
for (let i = 0; i < 1800; i++) text += ["w" + i % 310, "a", "1", "10", "n", "none", "constructor", "w7"][i % 8] + (i % 5 ? " " : ".");
const shown = v => { let h = 0; for (let i = 0; i < v.length; i++) h = Math.imul(h, 31) + v.charCodeAt(i) | 0; return v.length + " " + h + " " + v.slice(0, 70); };
function unpacked(p, d) { const k = [function (e) { return d[e]; }]; return p.replace(/\b\w+\b/g, k[0]); }
const table = words();
function byModule(p) { return p.replace(/\b\w+\b/g, key => table[key]); }
function assigned(p) { let map = { get a() { map = { a: "second", w7: "seven", 1: "one" }; return "first"; }, w7: "before" }; return p.replace(/\b\w+\b/g, key => map[key]); }
function converted(p) { let map = { a: { toString() { map = words(); return "object"; } }, 1: [1, 2] }; return p.replace(/\b\w+\b/g, key => map[key]); }
function late(p) { const call = key => map[key]; let seen; try { seen = p.replace(/\w+/g, call); } catch (e) { seen = e.name; } const map = words(); return seen + p.replace(/\w+/g, call); }
function proxied(p) { const map = new Proxy({ a: 1 }, { get(target, key) { log.push(key.length); return key + "!"; } }); return p.replace(/\b\w+\b/g, key => map[key]); }
function inherited(p) { const map = Object.create({ a: "above", w7: "seven above" }, { 1: { value: "own" } }); return p.replace(/\b\w+\b/g, key => map[key]); }
function missing(p) { const map = Object.create(null); return p.replace(/\b\w+\b/g, key => map[key]); }
function shape(p) { const map = { a: "A", w7: "ሴ", n: "" }; return p.replace(/[anw]7?/g, key => map[key]); }
function elements(p) { const map = ["zero", "one", , "three"]; map[10] = "ten"; return p.replace(/\d+/g, key => map[key]); }
function characters(p) { const map = "abcdefghijkl"; return p.replace(/\d+/g, key => map[key]); }
function deleted(p) { const map = words(); delete map.w7; delete map.a; return p.replace(/\w+/g, key => map[key]); }
function symbols(p) { const map = { a: Symbol("s") }; try { return p.replace(/\w+/g, key => map[key]); } catch (e) { return e.name; } }
for (let turn = 0; turn < 3; turn++) {
  console.log(shown(unpacked(text, words())), shown(byModule(text)), shown(assigned(text)), shown(converted(text)));
  console.log(shown(late(text)), shown(proxied(text)), log.splice(0).length, shown(inherited(text)), shown(missing(text)));
  console.log(shown(shape(text)), shown(elements(text)), shown(characters(text)), shown(deleted(text)), symbols(text));
  table["w" + turn] = "changed"; table.constructor = "own";
}
