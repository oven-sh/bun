// STATISTIC: UnrolledLoopStoresSunk >= 2
// A time limit of node:vm ends the run inside a loop that keeps a field in a register: the object has the sum so far.
import vm from "node:vm";
class Base { constructor(n) { this.name = n; } get kind() { return "base"; } }
class Other extends Base { constructor(n) { super(n); this.other = 1; } get kind() { return "other"; } }
const kept = [];
class Account extends Base {
  sum = 0;
  constructor(n, count) { super(n); kept.push(this); for (let i = 0; i < count; i++) this.sum += i; }
  get kind() { return "account"; }
}
class Pair extends Base {
  sum = 0;
  count = 0;
  constructor(n, count) { super(n); kept.push(this); for (let i = 0; i < count; i++) { this.sum += 0.5; this.count++; } }
  get kind() { return "pair"; }
}
const log = [];
for (const o of [new Account("a", 3), new Other("b"), new Account("c", 0), new Account("d", 1.5), new Pair("e", 4), new Pair("f", 0)]) log.push(o.kind, o.sum, o.count);
for (const work of [() => new Account("x", 1e15), () => new Pair("y", 1e15)]) {
  const before = kept.length;
  for (let limit = 100; kept.length === before; limit *= 4) {
    try {
      vm.runInContext("work()", vm.createContext({ work }), { timeout: limit });
      log.push("ended");
    } catch (e) {
      if (kept.length > before) log.push(e.code);
    }
  }
  const last = kept.at(-1);
  log.push(last.sum > 0, last.count === undefined || last.count === last.sum * 2);
}
console.log(log.join(" "));
