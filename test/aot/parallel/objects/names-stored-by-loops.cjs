// A loop asks for a name that it stores itself: none of the classes has it as a field.
// STATISTIC: SpeculatedReceiversDispatchedByShape >= 1
(function () {
function later(source) { return eval(source); }
const unknown = later("s => s"), turns = JSON.parse("24"), ATTACHED = ["att", "ached"].join("");
function Plain(name, data) { this.loadedName = name; this.data = data; this.loading = true; }
Plain.prototype.bind = function (text) { return this.loadedName + ":" + text.length; };
function Missing(error) { this.error = error; this.loading = false; }
Missing.prototype.bind = function () { return null; };
function Shared(data) { this.data = data; this.charstrings = data; }
const loader = { bind: function bindAll(fonts) {
  const rules = [], names = [], loaded = [];
  for (let i = 0; i < fonts.length; i++) {
    const font = fonts[i];
    if (font.attached || font.loading == false) continue;
    font.attached = true;
    loaded.push(font);
    let str = "";
    const data = font.data;
    if (data) {
      const length = data.length;
      for (let j = 0; j < length; j++) str += String.fromCharCode(data[j]);
      const rule = font.bind(str);
      if (rule) { rules.push(rule + str.charCodeAt(str.length >> 1)); names.push(font.loadedName); }
    }
  }
  return rules.join() + " " + names.join() + " " + loaded.length;
} };
function bytes(n, k) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * k + 7) & 255; return b; }
let hits = 0;
function translate(name, t) { try { if (name === "bad") throw new Error("no"); unknown(new Shared(t)); return t & 1 ? new Plain(name + t, bytes(40 + t, 3)) : new Plain(name + t, bytes(30, 5 + t)); } catch (e) { return new Missing(e); } }
function load(names, t) { const fonts = []; for (let i = 0; i < names.length; i++) fonts.push(unknown(translate(names[i], t + i))); return loader.bind(unknown(fonts)); }
for (let t = 0; t < turns; t++) { const said = load(["a", "b", "bad", "c"], t); if (t % 5 === 0) console.log(said); }
for (let t = 0; t < 12; t++) {
  const fonts = [new Plain("a" + t, bytes(40 + t, 3)), new Missing("no"), new Plain("d", [65, 66.7, "67", 70000])];
  if (t % 4 === 1) fonts.push({ loadedName: "e", data: "xyz", bind: Plain.prototype.bind });
  if (t % 4 === 2) { unknown(Object).defineProperty(fonts[0], ATTACHED, { get() { ++hits; return hits & 1; }, set(v) { hits += 10; } }); fonts[2].bind = text => "own" + text.length; }
  if (t % 4 === 3) fonts[0] = new Proxy(fonts[0], { get(o, k) { if (k === ATTACHED) ++hits; return o[k]; } });
  const all = unknown(loader).bind;
  console.log(all(fonts), all(fonts), hits, Object.keys(fonts[0]).join());
}
for (const odd of [[{}], [null], [{ data: { length: 2, 0: 72, 1: 73 }, bind: String }], [new Missing("x"), 5]]) { try { console.log(unknown(loader).bind(odd)); } catch (e) { console.log(e.name); } }
})();
