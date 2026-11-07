// STATISTIC: FlowAppendedFields >= 8
"use strict";
const make = at => ({ id: 7, name: "row", kind: "c" + at, x: 2, done: true, title: "t", w: 5, z: 0 });
const rows = []; for (let at = 0; at < 12; at++) rows.push(make(at));
let key, ref;
function copy(row) {
  const made = {};
  for (const name in row) {
    if (name == "key") key = row[name];
    else if (name == "ref") ref = row[name];
    else made[name] = row[name];
  }
  return made.id + made.name.length + made.kind.length + made.x + (made.done ? 1 : 0) + made.title.length + made.w + made.z;
}
let sum = 0;
for (let turn = 0; turn < 3000; turn++) sum = (sum + copy(rows[turn % 12])) % 1000003;
console.log(sum, key, ref);
