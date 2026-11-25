"use strict";
// The loop begins where the caller says: just below 2 ** 31 with its bound beyond, just below 2 ** 53, below zero, at a fraction, at a text: the counter goes on as a number and the callees are handed the number itself.
// Whatever happens is folded into one sum in the order in which it happens. The function with the loop is entered by value, so that its own code runs.
const said = [], nothing = { weight: 0 };
function size(holder) { const n = holder.count; if (holder.rest) return n + holder.more - 1; return n; }
function pick(holder, at) { if (holder.hook) holder.hook(at); const n = holder.items.length - (holder.rest ? 1 : 0); if (at < n) return holder.items[at]; if (holder.rest) { const last = holder.items[n]; const behind = at - n; if (last.many) { if (behind < last.many.length) return last.many[behind]; return last.many.length ? last.many[last.many.length - 1] : undefined; } return last; } return undefined; }
function each(first, second, visit, bad, from) { const a = size(first), b = size(second); const least = second.rest ? b - 1 : b; const n = first.rest ? least : Math.min(a, least); for (let i = from; i < n; i++) { const x = pick(first, i) || nothing; if (x.weight === 2) continue; const y = pick(second, i) || nothing; visit(x, y); if (x.weight === 5) break; if (y.weight === bad + 1) return 1000 + i; } return 3000; }
function holder(rest, count, hook) { const made = JSON.parse(`{"rest":${rest},"more":1,"count":0,"hook":null,"items":[{"weight":1},{"weight":2},{"weight":3},{"weight":4},{"weight":5},{"weight":6}]}`); made.count = count; made.hook = hook || null; return made; }
let sum = 0; function add(x, y) { sum = (sum * 31 + x.weight * 3 + y.weight) % 1000003; }
function f(first, second, bad, from) { return each(first, second, add, bad, from) + ":" + sum; }
const entry = [f];
function seen(at) { sum = (sum * 31 + at % 1009 + (typeof at).length) % 1000003; }
for (let round = 0; round < 3; round++) for (const [from, bound] of [[0, 3], [2147483644, 2147483650], [2147483645, 2147483647], [2147483646, 2147483648.5], [9007199254740989, 9007199254740991], [-3, -0], [0.5, 3], ["1", 3], [-0, 2]]) { try { said.push(entry[0](holder(true, 5, seen), holder(false, bound), 99, from)); } catch (error) { said.push(error.name + sum); } }
console.log(said.join(" "));
