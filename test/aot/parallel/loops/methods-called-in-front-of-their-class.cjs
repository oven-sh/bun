// A method of a class is called in a loop in front of the class, in a function that runs once.
"use strict";
const lines = [];
globalThis.kinds = {};
globalThis.kinds.Parcel = function Parcel(weight) {
  this.weight = weight;
};
globalThis.kinds.Parcel.prototype.unit = "kg";
function ship() {
  kinds = globalThis.kinds;
  for (let turn = 0; turn < 2; turn++) {
    const found = parcel.cost;
    note(typeof found === "function" ? found.call(parcel) : found);
  }
  class Express extends kinds.Parcel {
    cost() {
      return "cost " + this.weight + super.unit;
    }
  }
  parcel = new Express(4);
  for (let turn = 0; turn < 2; turn++) {
    const found = parcel.cost;
    note(found === Express.prototype.cost, typeof found === "function" ? found.call(parcel) : found);
  }
}
globalThis.parcel = JSON.parse('{"cost":"cheap"}');
globalThis.note = (...values) => lines.push(values.join(":"));
try {
  if (lines.length === 0) ship();
} catch (error) {
  lines.push(error.name);
}
console.log(lines.join(" "));
