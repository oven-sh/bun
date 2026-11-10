"use strict";
// STATISTIC: ArrayOrStringLoopsVersioned >= 4
// The value of a for-of, a field read in front, the result of a call, an element of a list: nothing is proven of them, and the loop compares their elements with a character. It asks in front for a text or a list, whatever the front end drew from use.
const words = JSON.parse('["alpha","Beta,","",",,","\\u00e9,\\ud83d\\ude00",["a",",","bc"],[",",null,1],[]]');
words.push("x,".repeat(20).slice(1), [",", , ","], new String("a,"), { length: 2, 0: ",", 1: "a" }, new Uint8Array([44]), 7, true);
function ofEach(list) { let c = 0; for (const w of list) for (let i = 0; i < w.length; i++) if (w[i] === ",") c++; return c; }
const box = JSON.parse('{"v":"ab,c,","u":["a",","]}');
function ofField(b, name) { const v = name ? b.v : b.u; let c = 0; for (let i = 0; i <= v.length; i++) { const h = v[i]; if (h === "," || h === "a") c++; } return c; }
const table = new Map([["t", "x,x,"], ["l", JSON.parse('["x",","]')]]);
function ofResult(k) { const l = table.get(k); let c = 0; for (let i = 0; i < l.length; i++) if (l[i] >= "a" && l[i] <= "z") c++; return c; }
function ofElement(list, k) { const w = list[k]; let c = 0; for (let i = w.length - 1; i >= 0; i--) if ("," == w[i]) c++; return c; }
for (let turn = 0; turn < 3; turn++) {
  console.log(ofEach(words), ofField(box, true), ofField(box, false), ofResult("t"), ofResult("l"));
  for (let k = 0; k < words.length; k++) console.log(ofElement(words, k));
}
for (const bad of [[null], [undefined]]) { try { console.log(ofEach(bad)); } catch (e) { console.log(e.name); } }
