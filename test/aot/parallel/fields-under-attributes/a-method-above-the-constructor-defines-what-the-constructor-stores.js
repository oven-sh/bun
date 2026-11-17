"use strict";
class Row {
  seal() {
    Object.defineProperty(this, "mark", { value: 7 });
  }
  constructor(n) {
    this.mark = n;
    this.size = n + 1;
  }
}
function fill(count) {
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(new Row(i));
  return rows;
}
function total(rows) {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) sum += rows[i].mark + rows[i].size;
  return sum;
}
function describe(row) {
  const found = Object.getOwnPropertyDescriptor(row, "mark");
  return [found.value, found.writable, found.enumerable, found.configurable, Object.keys(row).join()].join("|");
}
function attempt(deed) {
  try {
    return String(deed());
  } catch (error) {
    return error.name;
  }
}
const rows = fill(3000);
const before = total(rows);
rows[7].mark = 70;
console.log(before, total(rows), describe(rows[7]));
for (let i = 0; i < rows.length; i += 3) rows[i].seal();
console.log(total(rows), describe(rows[3]), describe(rows[4]));
console.log(attempt(() => (rows[3].mark = 5)), attempt(() => (rows[4].mark = 5)), attempt(() => delete rows[3].mark), attempt(() => delete rows[4].mark));
console.log(attempt(() => rows[3].seal()), attempt(() => rows[4].seal()), describe(rows[3]), describe(rows[4]), total(rows));
