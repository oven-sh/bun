"use strict";
const mark = Symbol("mark"), late = Symbol("late");
function tried(f) { try { return String(f()); } catch (error) { return error.constructor.name; } }
function read(list, key, n) { let out = ""; for (let i = 0; i < n; i++) out += String(list[key]) + " "; return out; }
const a = [1, 2, 3], b = [4, 5, 6]; a[mark] = "own";
console.log(read(a, mark, 3), read(b, mark, 3));
b[late] = "own late"; console.log(read(b, late, 3), read([7], late, 2), read([7], mark, 2));
class Heir extends Array {} Heir.prototype[mark] = "heir above"; const h = new Heir(1, 2); console.log(read(h, mark, 3)); h[mark] = "own"; console.log(read(h, mark, 3), h.map((x) => x).constructor === Heir);
const o = Object.setPrototypeOf([1, 2], { [mark]: "other above", __proto__: Array.prototype }); console.log(read(o, mark, 3)); o[mark] = "own"; console.log(read(o, mark, 3), [...o].join());
