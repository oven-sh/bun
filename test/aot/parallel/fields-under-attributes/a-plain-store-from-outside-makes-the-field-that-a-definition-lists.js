"use strict";
function hide(row) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  Object.defineProperty(row, "mark", { value: 7 + work });
}
class Row {
  constructor(n) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    this.size = n + 1;
  }
  seal() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    hide(this);
    return work;
  }
}
function fill(count) {
  const rows = [];
  for (let i = 0; i < count; i++) { const row = new Row(i); row.mark = i; rows.push(row); }
  return rows;
}
function total(rows) {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) sum += rows[i].mark + rows[i].size;
  return sum;
}
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const rows = fill(3000);
  const before = total(rows);
  rows[7].mark = 70 + work;
  console.log(before, total(rows), rows[7].mark);
}
main();
