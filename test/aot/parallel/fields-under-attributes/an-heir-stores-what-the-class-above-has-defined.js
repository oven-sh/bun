"use strict";
class Base {
  constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; Object.defineProperty(this, "mark", { value: n + work, writable: true }); this.size = n + 1; }
}
class Heir extends Base {
  constructor(n) { super(n); let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.mark = n + 2 + work; }
}
function fill(count) { const rows = []; for (let i = 0; i < count; i++) rows.push(i % 2 ? new Heir(i) : new Base(i)); return rows; }
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].mark + rows[i].size; return sum; }
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const rows = fill(3000);
  rows[work].mark = 5;
  const found = Object.getOwnPropertyDescriptor(rows[1], "mark");
  console.log(total(rows), Object.keys(rows[1]).join(), rows[1].mark, found.writable, found.enumerable, found.configurable);
}
main();
