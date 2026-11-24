// STATISTIC: RowHoldersOfSubclasses >= 1
// A ledger is an heir of Array whose elements are lists: a method that a loop copies reads them, and the loop asks once, in front, for the storage of the ledger.
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
  dueSince(first, guest) {
    let due = 0;
    for (let day = first; day < this.days; day++) due += this.dueOn(day, guest);
    return due;
  }
  remindersUnder(limit, guest) {
    let reminders = 0;
    let saved = 0;
    for (let day = 0; day < this.days; day++) {
      saved += this.dueOn(day, guest);
      if (saved < limit) continue;
      reminders++;
      saved = 0;
    }
    return reminders;
  }
}
const ledger = new Ledger(50);
let all = 0;
for (let round = 0; round < 60; round++) all += ledger.dueSince(round % 5, round % 3);
console.log(all, ledger.dueSince(0, 0), ledger.dueSince(7, 1), ledger.dueSince(49, 2));
console.log(ledger.remindersUnder(100, 0), ledger.remindersUnder(55.5, 1), ledger.remindersUnder(0, 2));
