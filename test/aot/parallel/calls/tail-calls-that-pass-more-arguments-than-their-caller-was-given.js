"use strict";
// Tail calls that pass more arguments than their caller was given, by every kind of callee, with errors, stack traces, collections and deep chains between them.
function ten(a, b, c, d, e, f, g, h, i, j) { if (a === "throw") throw new RangeError("ten " + j); return [a, b, c, d, e, f, g, h, i, j].join(); }
function direct(x) { return ten(x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
const holder = { ten, count() { return arguments.length; }, rest(...list) { return list.reduce((sum, value) => sum + value, 0); }, get viaGetter() { return ten; } };
function byKey(x, key) { return holder[key](x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
function byName(x) { return holder.ten(x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
function byGetter(x) { return holder.viaGetter(x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
const bound = ten.bind(null, "bound", "second");
function byBound(x) { return bound(x, 1, 2, 3, 4, 5, 6, 7); }
function bySpread(x, list) { return ten(x, ...list); }
function byApply(x) { return ten.apply(null, [x, 1, 2, 3, 4, 5, 6, 7, 8, 9]); }
function byCall(x) { return ten.call(null, x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
function byNative(x) { return Math.max(x, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11); }
const made = new Function("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "return [j, i, h, g, f, e, d, c, b, a].join('')" + (globalThis.never ? "x" : ""));
function byText(x) { return made(x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
class Base { constructor(a, b, c, d, e, f, g, h) { this.sum = a + b + c + d + e + f + g + h; } static make(x) { return Reflect.construct(Base, [x, 1, 2, 3, 4, 5, 6, 7]); } method(a, b, c, d, e, f, g, h, i) { return this.sum + i; } }
function byInstance(o) { return o.method(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function down(n, a, b, c, d, e, f, g, h, i) { return n ? down(n - 1, a + 1, b, c, d, e, f, g, h, i) : a + i; }
function startDown(n) { return down(n, 0, 1, 2, 3, 4, 5, 6, 7, 8); }
function ping(n, a, b, c, d, e, f, g, h) { return n ? pong(n - 1) : a + h; }
function pong(n) { return ping(n, 1, 2, 3, 4, 5, 6, 7, 8); }
function collects(a, b, c, d, e, f, g, h, i, j) { const kept = { a, j }; if (typeof Bun !== "undefined") Bun.gc(true); return kept.a.text + kept.j.text + [b, c, d, e, f, g, h, i].map(o => o.text).join(""); }
function fresh(x) { return collects({ text: x }, { text: "b" }, { text: "c" }, { text: "d" }, { text: "e" }, { text: "f" }, { text: "g" }, { text: "h" }, { text: "i" }, { text: "j" }); }
function frames(a, b, c, d, e, f, g, h, i, j) { return new Error("here").stack.split("\n").slice(1, 5).map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join(" | "); }
function showsFrames(x) { return frames(x, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
function outer(x) { const text = showsFrames(x); return text; }
async function awaits(x) { const first = await direct(x); return byName(first.length); }
function* yields(x) { yield direct(x); return byKey(x, "rest"); }
function inTry(x) { try { return ten(x, 1, 2, 3, 4, 5, 6, 7, 8, 9); } catch (error) { return "caught " + error.message; } finally { counter++; } }
let counter = 0;
function overflow(n, a, b, c, d, e, f, g, h, i) { return 1 + under(n + 1); }
function under(n) { return overflow(n, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
const lines = [];
for (let turn = 0; turn < 300; turn++) {
  const x = turn % 7;
  lines.push([direct(x), byKey(x, turn & 1 ? "ten" : turn & 2 ? "count" : "rest"), byName(x), byGetter(x), byBound(x), bySpread(x, [1, 2, 3, 4, 5, 6, 7, 8, 9]), bySpread(x, []), byApply(x), byCall(x), byNative(x), byText(x), byInstance(Base.make(x)), inTry(x)].join(";"));
}
console.log(lines.length, new Set(lines).size, lines[5], lines[6]);
console.log(startDown(200000), pong(100001), fresh("a"), counter);
for (const call of [direct, byName, byGetter, byApply, byCall, x => byKey(x, "ten"), x => bySpread(x, [1, 2, 3, 4, 5, 6, 7, 8, 9]), inTry]) {
  try { console.log(call("throw")); } catch (error) { console.log(error.name, error.message, error.stack.split("\n").length > 2); }
}
console.log(outer(1));
try { byKey(1, "missing"); } catch (error) { console.log(error.name); }
try { under(0); } catch (error) { console.log(error.name, typeof error.message); }
console.log(direct(1), [...yields(2)].join("/"));
awaits(3).then(value => { console.log(value); return awaits("throw"); }).catch(error => console.log("rejected", error.message));
