"use strict";
function tag(row, hidden) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (hidden) Object.defineProperty(row, "mark", { value: work, writable: true, configurable: true });
}
class Row {
  constructor(n, hidden) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    tag(this, hidden);
    this.mark = n + work;
    this.size = n + 1;
  }
}
function fill(count) { const rows = []; for (let i = 0; i < count; i++) rows.push(new Row(i, i === 3)); return rows; }
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].mark + rows[i].size; return sum; }
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const rows = fill(3000);
  console.log(total(rows), Object.keys(rows[3]).join(), Object.keys(rows[4]).join());
}
main();
