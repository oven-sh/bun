"use strict";
// The bound lies in a variable of the file that what is called in the turns writes: it shortens it, lengthens it and makes it a fraction, a text, NaN and an object while the loop runs.
// Whatever happens is folded into one sum in the order in which it happens. The function with the loop is entered by value, so that its own code runs.
const said = [], nothing = { weight: 0 };
function size(holder) { const n = holder.count; if (holder.rest) return n + holder.more - 1; return n; }
function pick(holder, at) { if (holder.hook) holder.hook(at); const n = holder.items.length - (holder.rest ? 1 : 0); if (at < n) return holder.items[at]; if (holder.rest) { const last = holder.items[n]; const behind = at - n; if (last.many) { if (behind < last.many.length) return last.many[behind]; return last.many.length ? last.many[last.many.length - 1] : undefined; } return last; } return undefined; }
let n = 0;
function each(first, second, visit, bad) { const a = size(first), b = size(second); const least = second.rest ? b - 1 : b; n = first.rest ? least : Math.min(a, least); for (let i = 0; i < n; i++) { const x = pick(first, i) || nothing; if (x.weight === 2) continue; const y = pick(second, i) || nothing; visit(x, y); if (x.weight === 5) break; if (y.weight === bad + 1) return 1000 + i; } return 3000; }
function holder(rest, count, hook) { const made = JSON.parse(`{"rest":${rest},"more":1,"count":0,"hook":null,"items":[{"weight":1},{"weight":2},{"weight":3},{"weight":4},{"weight":5},{"weight":6}]}`); made.count = count; made.hook = hook || null; return made; }
let sum = 0; function add(x, y) { sum = (sum * 31 + x.weight * 3 + y.weight) % 1000003; }
function f(first, second, bad) { return each(first, second, add, bad) + ":" + sum; }
const entry = [f];
let plan = {};
function write(at) { const next = plan[at]; if (next !== undefined) n = next; }
const plans = [{}, { 1: 3 }, { 2: 9 }, { 2: 3.5 }, { 2: "4" }, { 0: 0 }, { 3: NaN }, { 1: { valueOf() { sum = (sum * 31 + 307) % 1000003; return 4; } } }, { 3: 2147483648 }, { 2: -0 }, { 2: null }];
for (let round = 0; round < 3; round++) for (plan of plans) { try { said.push(entry[0](holder(true, 5, write), holder(false, 4), 99), entry[0](holder(true, 5), holder(false, 4, write), 99)); } catch (error) { said.push(error.name + sum); } }
console.log(said.join(" "));
