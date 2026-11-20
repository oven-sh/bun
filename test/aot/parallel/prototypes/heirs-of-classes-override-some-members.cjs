// Constructor functions that a helper lays below a class override some of its members: what they leave alone is the class's for their objects too. Members overridden in front of the first object and behind it, replaced, deleted, hidden by one object, a prototype object that gets another prototype.
// COUNTER: ClassGuardBitsInvalidated >= 1
// Under: --aot-harden=proof-checks: a member that an heir overrides is no member of the class
// Under: --aot-testing=FailSpeculations: each read runs as written
"use strict";
const set = globalThis[JSON.parse('"Object"')].setPrototypeOf;
class Account {
  constructor(owner, amount) { this.owner = owner; this.amount = amount; this.log = 0; }
  get label() { return this.owner + ":" + this.amount; }
  add(n) { this.amount += n; this.log++; return this; }
  fee() { return this.amount > 100 ? 1 : 2; }
  rate() { return 3; }
  total() { return this.amount - this.fee() * this.rate(); }
}
function heir(parent, members, getters) {
  const F = function (owner, amount) { const made = Reflect.construct(parent, [owner, amount], new.target || F); return made; };
  F.prototype = Object.create(parent.prototype);
  F.prototype.constructor = F;
  for (const k of Object.keys(members)) F.prototype[k] = members[k];
  for (const k of Object.keys(getters || {})) Object.defineProperty(F.prototype, k, { get: getters[k], configurable: true });
  return F;
}
function work(list, n) { let all = 0; for (let i = 0; i < n; i++) { const a = list[i % list.length]; a.add(i % 5); all = (all * 13 + a.total() + a.fee() + a.rate() + a.label.length) | 0; } return all; }
const Saver = heir(Account, { fee() { return 0; } });
const Loan = heir(Account, { rate() { return 7; } }, { label() { return "loan " + this.amount; } });
const Deep = heir(Loan, { fee() { return 5; } });
const makes = () => [new Account("a", 10), new Saver("b", 200), new Loan("c", 30), new Deep("d", 400)];
const list = makes();
console.log(work(list, 400), list.map(a => a.label + "/" + a.total()).join(" "));
// behind the first objects
Saver.prototype.rate = function () { return 11; };
console.log(work(list, 400), work(makes(), 200), list.map(a => a.rate()).join());
Saver.prototype.add = function (n) { this.amount += 2 * n; return this; };
console.log(work(list, 100), list.map(a => a.log).join());
// what the class itself has changes
Account.prototype.fee = function () { return this.log; };
console.log(work(list, 100), list.map(a => a.fee()).join());
delete Loan.prototype.rate;
console.log(work(list, 100), list.map(a => a.rate()).join());
delete Deep.prototype.fee;
console.log(work(list, 100), list.map(a => a.fee()).join());
// one object hides a member, another gets an accessor
list[2].rate = () => -1; Object.defineProperty(list[3], "label", { get: () => "own", configurable: true });
console.log(work(list, 100), list.map(a => a.rate() + a.label).join());
// names put there by Object.assign, under a symbol, under a made name
const mark = Symbol("mark"), made = JSON.parse('"fee"');
Object.assign(Loan.prototype, { fee() { return 100; }, [mark]: 4 });
console.log(work(list, 100), list.map(a => String(a[mark])).join());
Deep.prototype[made] = function () { return -100; };
console.log(work(list, 100), work(makes(), 100));
// another prototype above
set(Saver.prototype, { __proto__: Account.prototype, rate() { return 1000; }, fee() { return 1000; } });
console.log(work(list, 100), new Saver("e", 1).total(), new Saver("e", 1) instanceof Account);
set(Deep.prototype, Object.prototype);
try { console.log(work([new Deep("f", 2)], 3)); } catch (e) { console.log(e.constructor.name); }
console.log(work(list.slice(0, 2), 50));
