// One for-of of which nobody knows what it goes over: lists of fractions, whole numbers, both, with a null, a hole, texts, records; a Set, a Map, a generator, an iterator by hand with and without return(); lists that change in the loop, have another iterator or prototype.
"use strict";
const out = [], log = [], J = JSON.parse;
function sum(what) { let s = 0; for (const x of what) s += x; return s; }
function first(what, most) { let s = 0; for (const x of what) { s += x; if (s > most) break; } return s; }
function grow(what) { let s = 0, n = 0; for (const x of what) { s += x; if (n++ < 2) what.push(0.25); } return s; }
function cut(what) { let s = 0; for (const x of what) { s += x; what.length = 2; } return s; }
function turn(what) { let s = 0; for (const x of what) { s += x; if (s > 1) what[2] = "t"; } return s; }
function hand(list, closes) { return { [Symbol.iterator]() { let at = 0; const it = { next: () => at < list.length ? { done: false, value: list[at++] } : { done: true, value: undefined } }; if (closes) it.return = () => { log.push("closed"); return {}; }; return it; } }; }
function* give(list) { try { for (const x of list) yield x; } finally { log.push("finally"); } }
const makers = [() => J("[0.5,1.5,2.5]"), () => J("[1,2,3]"), () => J("[1,0.5]"), () => J("[0.5,null,2.5]"), () => [0.5, , 2.5], () => J('["a",1]'), () => J('[{"v":1}]'), () => J("[]"), () => new Set(J("[0.5,1.5]")), () => new Map(J('[["a",1]]')),
  () => give(J("[0.5,1.5,2.5]")), () => hand(J("[0.5,1.5,2.5]"), false), () => hand(J("[0.5,1.5,2.5]"), true), () => "ab", () => new Float64Array(J("[0.5,1.5]")),
  () => { const l = J("[0.5,1.5]"); l[Symbol.iterator] = function* () { yield 9; }; return l; }, () => Object.setPrototypeOf(J("[0.5,1.5]"), { [Symbol.iterator]: function* () { yield 8; } }), () => J("5"), () => J("null")];
for (let round = 0; round < 30; round++) {
  out.length = 0; log.length = 0;
  for (const make of makers) for (const f of [sum, w => first(w, 1)]) { try { const y = f(make()); out.push(Object.is(y, -0) ? "-0" : typeof y + String(y)); } catch (e) { out.push(e.name); } }
  for (const f of [grow, cut, turn]) for (const text of ["[0.5,1.5,2.5,3.5]", "[1,2,3,4]"]) { try { out.push(String(f(J(text)))); } catch (e) { out.push(e.name); } }
}
console.log(out.join("|")); console.log(log.join());
