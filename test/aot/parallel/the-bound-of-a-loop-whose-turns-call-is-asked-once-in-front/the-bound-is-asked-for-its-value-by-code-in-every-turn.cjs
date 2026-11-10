"use strict";
// The bound is an object: its valueOf runs once for each comparison, in its order among the calls of the turns, may answer otherwise each time, and may throw; a symbol throws at the first comparison.
// Whatever happens is folded into one sum in the order in which it happens. The function with the loop is entered by value, so that its own code runs.
const said = [], nothing = { weight: 0 };
function size(holder) { const n = holder.count; if (holder.rest) return n + holder.more - 1; return n; }
function pick(holder, at) { if (holder.hook) holder.hook(at); const n = holder.items.length - (holder.rest ? 1 : 0); if (at < n) return holder.items[at]; if (holder.rest) { const last = holder.items[n]; const behind = at - n; if (last.many) { if (behind < last.many.length) return last.many[behind]; return last.many.length ? last.many[last.many.length - 1] : undefined; } return last; } return undefined; }
function each(first, second, visit, bad) { const a = size(first), b = size(second); const least = second.rest ? b - 1 : b; const n = first.rest ? least : Math.min(a, least); for (let i = 0; i < n; i++) { const x = pick(first, i) || nothing; if (x.weight === 2) continue; const y = pick(second, i) || nothing; visit(x, y); if (x.weight === 5) break; if (y.weight === bad + 1) return 1000 + i; } return 3000; }
function holder(rest, count, hook) { const made = JSON.parse(`{"rest":${rest},"more":1,"count":0,"hook":null,"items":[{"weight":1},{"weight":2},{"weight":3},{"weight":4},{"weight":5},{"weight":6}]}`); made.count = count; made.hook = hook || null; return made; }
let sum = 0; function add(x, y) { sum = (sum * 31 + x.weight * 3 + y.weight) % 1000003; }
function f(first, second, bad) { return each(first, second, add, bad) + ":" + sum; }
const entry = [f];
let asked = 0;
const shrinking = { valueOf() { sum = (sum * 31 + 101 + asked) % 1000003; return 5 - asked++; } };
const byText = { toString() { sum = (sum * 31 + 211) % 1000003; return "2"; } };
const bySymbol = { [Symbol.toPrimitive](hint) { sum = (sum * 31 + hint.length) % 1000003; return 2; } };
const throwing = { valueOf() { if (asked++ > 2) throw new RangeError("enough"); return 100; } };
for (let round = 0; round < 3; round++) for (const bound of [3, shrinking, byText, bySymbol, throwing, Symbol("no number"), 2]) { asked = 0; try { said.push(entry[0](holder(true, 5), holder(false, bound), 99)); } catch (error) { said.push(error.name + sum); } }
console.log(said.join(" "));
