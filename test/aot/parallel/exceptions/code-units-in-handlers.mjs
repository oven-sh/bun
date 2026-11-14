// What a catch reads of x behind String.fromCharCode(x), which takes the code unit of x.
console.log(new Map([["constructor", 1]]).size);
const list = JSON.parse("[65, 70001, \"66\", -1, null, 1.5, 4294967361]");
let boom = 0;
function sink(t) { if (boom-- === 0) throw new Error("sink " + t.charCodeAt(0)); return t; }
const o = { sink, get trap() { if (boom-- === 0) throw new Error("trap"); return 1; } };
function a(list, k) { try { for (let i = 0; i < list.length; i++) { var unit = list[i]; if (unit >= 5760) k++; o.sink(String.fromCharCode(unit)); } } catch (e) { return e.message + " " + String(unit); } }
function b(list, k) { let s = ""; try { for (let i = 0; i < list.length; i++) { var unit = list[i]; if (unit >= 5760) k++; s += String.fromCharCode(unit); s += o.trap; } } catch (e) { return e.message + " " + String(unit); } }
function c(list, k) { let t; try { for (let i = 0; i < list.length; i++) { var unit = list[i]; if (unit >= 5760) k++; t = String.fromCharCode(unit); if (boom-- === 0) throw new Error("own"); } } catch (e) { return e.message + " " + String(unit) + t; } }
function d(list, k) { let t; try { for (let i = 0; i < list.length; i++) { var unit = list[i]; if (unit >= 5760) k++; t = String.fromCharCode(unit); t = t.at(0) + o.trap + sink(t); } } catch (e) { return e.message + " " + String(unit) + t; } }
function e(list) { let t; for (let i = 0; i < list.length; i++) { let unit = list[i]; try { t = String.fromCharCode(unit); null_(); } catch (e) { t = String(unit); } if (boom-- === 0) return t; } }
function null_() { if (boom === 0) throw new Error("null"); }
function* g(list, k) { let s = ""; try { for (let i = 0; i < list.length; i++) { var unit = list[i]; if (unit >= 5760) k++; s += String.fromCharCode(unit); o.trap; yield s; } } catch (e) { yield e.message + " " + String(unit); } }
for (let turn = 0; turn < 3; turn++) for (let at = 0; at < 14; at++) for (const f of [a, b, c, d, e]) { boom = at; console.log(f.name, at, f(list)); boom = at; console.log([...g(list)].join()); }
