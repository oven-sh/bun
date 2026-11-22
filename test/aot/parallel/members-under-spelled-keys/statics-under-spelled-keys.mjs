// Static members under symbols and texts in constants, beside static fields, replaced behind warm calls.
const make = Symbol("make"), count = "count", seen = Symbol("seen");
class Pool {
  static total = 0;
  static [seen] = 0;
  static [make](n) { Pool.total = (Pool.total + n) | 0; Pool[seen]++; return Pool.total; }
  static get [count]() { return Pool.total; }
  static plain(n) { return n + Pool.total; }
}
class Deep extends Pool { static [make](n) { return super[make](n + 1); } }
function run(turns) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = work;
  for (let i = 0; i < turns; i++) sum = (sum + Pool[make](i) + Deep[make](i) + Pool.count + Pool.plain(i) + Deep[seen]) | 0;
  return sum;
}
console.log(run(500));
Pool[make] = n => 1;
console.log(run(500));
Object.defineProperty(Pool, count, { value: 3 });
delete Deep[make];
console.log(run(500), Reflect.ownKeys(Pool).map(String).join(), Reflect.ownKeys(Deep).map(String).join());
