// COUNTER: FieldsEvictedByRedefinition = 1
"use strict";
// One site defines the name as a data property, another as an accessor. The slot is planned for the data property, and objects with the accessor keep it outside of the slot.
function ticket(row, wait) {
  const made = { wait, row };
  Object.defineProperty(made, "stamp", { value: "row " + row, writable: true });
  if (!(wait < 0)) Object.defineProperty(made, "price", { value: null });
  else Object.defineProperty(made, "price", { get() { return row - wait; } });
  return Object.seal(made);
}
let sum = 0;
for (let turn = 0; turn < 2000; turn++) {
  const made = ticket(turn % 9, turn);
  sum = (sum * 3 + made.wait + made.stamp.length + (made.price !== null ? 50 : 2)) % 999983;
}
const tickets = [ticket(3, 0), ticket(4, -2)];
for (const made of tickets) {
  const { get, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(made, "price");
  let stored = "stored";
  try { made.price = 8; } catch ({ name }) { stored = name; }
  made.stamp = "late " + made.row;
  console.log(made.price, typeof get, writable, enumerable, configurable, Object.keys(made).join(), Object.getOwnPropertyNames(made).join(), JSON.stringify(made), stored, made.stamp, Object.isSealed(made), Object.isFrozen(made));
}
console.log(sum);
