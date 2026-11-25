// The same ledger where a day is missing, is no list, is a view, is frozen, stands above the ledger, or leaves while it is read.
"use strict";
class Ledger extends Array {
  constructor(days) {
    super();
    this.days = days;
    for (let day = 0; day < days; day++) this.push([0.5 + day, day % 7, (day * 5) % 11]);
  }
  dueOn(day, guest) {
    return this[day][guest] * 2 + day;
  }
  due(guest) {
    let due = 0;
    for (let day = 0; day < this.days; day++) due += this.dueOn(day, guest);
    return due;
  }
}
class Doubled extends Ledger {
  dueOn(day, guest) {
    return super.dueOn(day, guest) * 2;
  }
}
const told = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
};
for (let round = 0; round < 200; round++) new Ledger(9).due(round % 3);
console.log(told(() => new Doubled(9).due(1)), told(() => new Ledger(0).due(1)));
const changes = {
  hole: ledger => delete ledger[4],
  text: ledger => (ledger[4] = "four"),
  none: ledger => (ledger[4] = undefined),
  view: ledger => (ledger[4] = new Float32Array([0.1, 2, 3])),
  short: ledger => (ledger[4] = [7]),
  frozen: ledger => Object.freeze(ledger),
  shorter: ledger => (ledger.length = 5),
  strings: ledger => (ledger[4] = ["1", "2", "3"]),
  getter: ledger => Object.defineProperty(ledger, 4, { get: () => [1, 2, 3] }),
};
for (const [name, change] of Object.entries(changes)) {
  const ledger = new Ledger(9);
  console.log(name, told(() => (change(ledger), ledger.due(1))), told(() => ledger.due(2)));
}
const leaving = new Ledger(9);
leaving[3] = [1, { valueOf: () => ((leaving[5] = [0, 100, 0]), 3) }, 2];
console.log(told(() => leaving.due(1)));
Ledger.prototype[6] = [9, 9, 9];
const above = new Ledger(9);
delete above[6];
console.log(told(() => above.due(0)));
