// STATISTIC: NumericArraysTestedByOneBit >= 1
"use strict";
function List(count) {
  if (count === undefined) count = 0;
  for (var made = Array(count || 0), k = 0; k < count; ++k) made[k] = 0;
  return made;
}
function Pool(count) {
  this.parts = new List(count);
  this.sums = new List(count);
  this.used = 0;
}
function fill(pool, from) {
  for (let k = 0; k < pool.parts.length; k++) {
    pool.parts[k] = from * 0.5 + k;
    pool.sums[k] = pool.parts[k] * 2 - pool.sums[k];
  }
  pool.used++;
  return pool;
}
function least(pool) {
  let found = 1e9;
  for (let k = 0; k < pool.sums.length; k++) {
    const sum = pool.sums[k];
    found = found < sum ? found : sum;
  }
  return found;
}
const pools = [new Pool(4), new Pool(2), new Pool()];
let total = 0;
for (let turn = 0; turn < 60; turn++) total += least(fill(pools[turn % 2], turn));
console.log(total, pools.map((pool) => pool.parts.join("/") + " " + pool.used).join(), new List(2) instanceof List, new List(3) instanceof Array);
function Maybe(count) {
  if (count > 1) return [count];
  this.count = count;
}
const maybes = [new Maybe(0), new Maybe(1), new Maybe(2)];
console.log(maybes.map((made) => (Array.isArray(made) ? "list " + made[0] : "instance " + made.count)).join());
