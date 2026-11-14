// getters are laid under computed keys that are always one text: a name, a name that the literal has laid already, an index, and __proto__
function subject(on) { const name = on ? "size" : "size"; const index = on ? "7" : "7"; const proto = on ? "__proto__" : "__proto__"; return { z: 0, size: 9, get [name]() { return 1; }, get [index]() { return 2; }, get [proto]() { return 3; }, get last() { return 4; } }; }
function deed(on) { const o = subject(on); const d = Object.getOwnPropertyDescriptor(o, "size"); return Object.keys(o).join() + ";" + String(o.size) + String(o[7]) + String(o.__proto__) + String(o.last) + ";" + typeof d.get + String(d.enumerable) + ";" + String(Object.getPrototypeOf(o) === Object.prototype); }
console.log(deed(true));
console.log(deed(false));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i % 2 === 0);
console.log(text);
