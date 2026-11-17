"use strict";
// What the turns call changes the holders themselves: the lists grow and shrink, the marks turn, the count is stored anew: the bound was read once in front of the loop and stays; what is picked follows the holders.
// Whatever happens is folded into one sum in the order in which it happens. The function with the loop is entered by value, so that its own code runs.
const said = [], nothing = { weight: 0 };
function size(holder) { const n = holder.count; if (holder.rest) return n + holder.more - 1; return n; }
function pick(holder, at) { if (holder.hook) holder.hook(at); const n = holder.items.length - (holder.rest ? 1 : 0); if (at < n) return holder.items[at]; if (holder.rest) { const last = holder.items[n]; const behind = at - n; if (last.many) { if (behind < last.many.length) return last.many[behind]; return last.many.length ? last.many[last.many.length - 1] : undefined; } return last; } return undefined; }
function each(first, second, visit, bad) { const a = size(first), b = size(second); const least = second.rest ? b - 1 : b; const n = first.rest ? least : Math.min(a, least); for (let i = 0; i < n; i++) { const x = pick(first, i) || nothing; if (x.weight === 2) continue; const y = pick(second, i) || nothing; visit(x, y); if (x.weight === 5) break; if (y.weight === bad + 1) return 1000 + i; } return 3000; }
function holder(rest, count, hook) { const made = JSON.parse(`{"rest":${rest},"more":1,"count":0,"hook":null,"items":[{"weight":1},{"weight":2},{"weight":3},{"weight":4},{"weight":5},{"weight":6}]}`); made.count = count; made.hook = hook || null; return made; }
let sum = 0; function add(x, y) { sum = (sum * 31 + x.weight * 3 + y.weight) % 1000003; }
function f(first, second, bad) { return each(first, second, add, bad) + ":" + sum; }
const entry = [f];
let what = "", one, other;
function change(at) { if (at !== 1) return; if (what === "shrink") one.items.length = 2; if (what === "grow") other.items.unshift({ weight: 9 }); if (what === "mark") { one.rest = false; other.rest = true; } if (what === "count") { one.count = 1; other.count = 100; } if (what === "text") other.items = ["a", "b", "c", "d", "e", "f"].map(letter => ({ weight: letter.charCodeAt(0) })); if (what === "swap") one.items = other.items.slice().reverse(); }
for (let round = 0; round < 3; round++) for (what of ["nothing", "shrink", "grow", "mark", "count", "text", "swap"]) { one = holder(true, 5, change); other = holder(false, 5); try { said.push(entry[0](one, other, 99)); } catch (error) { said.push(error.name + sum); } }
console.log(said.join(" "));
