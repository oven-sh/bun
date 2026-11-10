// A local whose first use is its element: texts, lists, views, objects, getters and nothing. The values come out of a field, so no function has a parameter that its uses could tell.
// STATISTIC: ArraysSpeculatedFromIndexedReads >= 1
"use strict";
const out = [], box = JSON.parse("{}"), values = [JSON.parse('[1,[2],{"v":3},"(",null]'), "((a b", "", [], new Uint8Array([40, 1]), { length: 2, 0: "(", 1: "x" }, { get length() { out.push("l"); return 1; }, get 0() { out.push("0"); return "("; } }, null, 7, ["(", "(", "x"], (function () { return arguments; })("(", { v: 1 }), new Proxy(["("], {}), "\u4e2d(", new String("(s")];
function first() { const s = box.v; let c = 0, i = 0; while (s[i] === "(") i++; for (; i < s.length; i++) if (s[i] === " ") c++; return c * 10 + i; }
function asked() { const s = box.v; let c = 0, i = 0; for (; i < 2; i++) if (s[i] && s[i].v) c++; return c + s.length; }
function upper() { const s = box.v; let c = "", i = 0; for (; i < 2; i++) c += s[i].toUpperCase(); return c + s.length; }
function caught() { let c = 0; try { throw box.v; } catch (s) { for (let i = 0; i < 2; i++) if (s[i] === "(") c++; return c + s.length; } }
function joined(t) { const s = t ? box.v : box.w; let c = 0, i = 0; while (s[i] === "(") i++; for (; i < s.length; i++) if (s[i] === "x") c++; return c * 10 + i; }
function changes() { let s = box.v; let c = 0; for (let i = 0; i < 3; i++) { if (s[i] === "(") c++; if (i === 1) s = box.w; } return c + s.length; }
function never() { const s = box.v; let c = 0; for (let i = 0; i < 2; i++) if (s[i] === "(") c++; return c; }
for (let r = 0; r < 60; r++) { out.length = 0; for (const v of values) for (const f of [first, asked, upper, caught, joined, changes, never]) { box.v = v; box.w = values[(r + 3) % values.length]; try { out.push(String(f(r & 1))); } catch (e) { out.push(e.name); } } }
console.log(out.join());
