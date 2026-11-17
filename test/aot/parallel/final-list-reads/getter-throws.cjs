"use strict";
const names = JSON.parse('["boom", "take"]');
let taken = null;
Object.defineProperty(Array.prototype, names[0], { get() { taken = this; throw new Error("boom"); }, configurable: true });
Object.defineProperty(Array.prototype, names[1], { get() { taken = this; this.push("in getter"); this[0] = "zero"; return this.length; }, configurable: true });
function total(n, key) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i * 1.5);
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  if (sum > 1e9) return sum;
  return list[key];
}
function literal(key) {
  return [10, 20, 30][key];
}
function nested(key) {
  const inner = [1, 2];
  const outer = [inner, inner];
  let sum = 0;
  for (let i = 0; i < 2; i++) sum += outer[i][0];
  if (sum > 100) return sum;
  return outer[key];
}
for (const key of [1, names[0], names[1], "length", 7]) {
  for (const f of [k => total(5, k), literal, nested]) {
    try {
      const got = f(key);
      console.log(String(got), taken && taken.length, taken && String(taken[0]));
      if (Array.isArray(got)) got[0] = "text";
    } catch (error) {
      console.log(error.message, taken && taken.length, taken && String(taken[0]));
      if (Array.isArray(taken)) taken.push("late");
    }
    taken = null;
  }
}
